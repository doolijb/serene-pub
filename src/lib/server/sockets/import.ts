import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import * as fsPromises from "fs/promises"
import * as path from "path"
import * as os from "os"
import { eq, and } from "drizzle-orm"
import { v4 as uuid } from "uuid"
import { getCharacterDataDir, getPersonaDataDir } from "$lib/server/utils"
import {
	extractCharacterFromPNG,
	readCharacterFile,
	parseChatFile,
	normalizeTimestamp,
	mapGroupReplyStrategy,
	type CharacterCardV2,
	type CharacterBook,
	type ChatMessage,
	type ChatHeader,
	type GroupChat,
	type WorldInfo
} from "$lib/server/utils/sillyTavernParsers"
import { resolveSillyTavernDataRoot } from "$lib/shared/utils/sillyTavernPaths"

// ==================== Import Staging ====================
//
// The SillyTavern import flow is entirely client-driven: the browser reads
// the user's local SillyTavern folder (via a <input webkitdirectory> picker)
// and uploads the relevant files here, into a per-session temp directory
// structured like a real SillyTavern data folder. Scan/execute then read
// from that staged directory exactly like they used to read from a
// server-typed path — none of the parsing/import logic below had to change.

interface ImportSession {
	userId: number
	dir: string
	lastActivity: number
}

const importSessions = new Map<string, ImportSession>()
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes of inactivity

async function cleanupImportSession(sessionId: string) {
	const session = importSessions.get(sessionId)
	if (!session) return
	importSessions.delete(sessionId)
	try {
		await fsPromises.rm(session.dir, { recursive: true, force: true })
	} catch (e) {
		console.warn(`[Import] Failed to clean up session ${sessionId}:`, e)
	}
}

// Sweep sessions abandoned mid-flow (scanned, then the tab was closed
// without ever executing or erroring out).
setInterval(
	() => {
		const now = Date.now()
		for (const [id, session] of importSessions) {
			if (now - session.lastActivity > SESSION_TTL_MS) {
				cleanupImportSession(id)
			}
		}
	},
	5 * 60 * 1000
).unref()

function getImportSession(sessionId: string, userId: number): ImportSession {
	const session = importSessions.get(sessionId)
	if (!session || session.userId !== userId) {
		throw new Error(
			"Import session not found or expired. Please start over."
		)
	}
	session.lastActivity = Date.now()
	return session
}

/** Resolves a client-supplied relative path to a safe location inside the
 * session's staging dir — rejects traversal and absolute paths. */
function resolveStagedFilePath(
	session: ImportSession,
	relativePath: string
): string {
	const normalized = relativePath.replace(/\\/g, "/")
	if (
		!normalized ||
		normalized.startsWith("/") ||
		normalized.includes("..") ||
		path.isAbsolute(normalized)
	) {
		throw new Error(`Invalid file path: ${relativePath}`)
	}
	const sessionRoot = path.resolve(session.dir)
	const resolved = path.resolve(sessionRoot, normalized)
	if (
		resolved !== sessionRoot &&
		!resolved.startsWith(sessionRoot + path.sep)
	) {
		throw new Error(`Invalid file path: ${relativePath}`)
	}
	return resolved
}

/** Finds the SillyTavern data directory within a staged session, same
 * landmark-based resolution the client used to decide what to upload. */
async function resolveStagedDataDir(session: ImportSession): Promise<string> {
	let entries: string[]
	try {
		entries = await fsPromises.readdir(session.dir, { recursive: true })
	} catch {
		entries = []
	}
	const root = resolveSillyTavernDataRoot(entries)
	if (root === null) {
		throw new Error(
			"Could not find SillyTavern data in the uploaded folder. Please make sure you selected the correct SillyTavern folder."
		)
	}
	return path.join(session.dir, root)
}

export const importStartSillyTavernSession: Handler<
	Sockets.Import.SillyTavern.StartSession.Params,
	Sockets.Import.SillyTavern.StartSession.Response
> = {
	event: "import:sillytavern:startSession",
	handler: async (socket, _message, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			throw new Error("User not authenticated")
		}

		try {
			const importSessionId = uuid()
			const dir = path.join(
				os.tmpdir(),
				`serene-pub-import-${importSessionId}`
			)
			await fsPromises.mkdir(dir, { recursive: true })
			importSessions.set(importSessionId, {
				userId,
				dir,
				lastActivity: Date.now()
			})

			const result = { success: true, importSessionId }
			emitToUser("import:sillytavern:startSession", result)
			return result
		} catch (error) {
			const result = {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to start import session"
			}
			emitToUser("import:sillytavern:startSession", result)
			return result
		}
	}
}

export const importStageSillyTavernFiles: Handler<
	Sockets.Import.SillyTavern.StageFiles.Params,
	Sockets.Import.SillyTavern.StageFiles.Response
> = {
	event: "import:sillytavern:stageFiles",
	handler: async (socket, message, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			throw new Error("User not authenticated")
		}

		try {
			const session = getImportSession(message.importSessionId, userId)
			const blob = Buffer.from(message.blob)

			let offset = 0
			for (const entry of message.manifest) {
				const fileData = blob.subarray(offset, offset + entry.length)
				offset += entry.length

				const filePath = resolveStagedFilePath(
					session,
					entry.relativePath
				)
				await fsPromises.mkdir(path.dirname(filePath), {
					recursive: true
				})
				await fsPromises.writeFile(filePath, fileData)
			}

			const result = { success: true, staged: message.manifest.length }
			emitToUser("import:sillytavern:stageFiles", result)
			return result
		} catch (error) {
			const result = {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to stage files"
			}
			emitToUser("import:sillytavern:stageFiles", result)
			return result
		}
	}
}

// ==================== Scan Handler ====================

export const importScanSillyTavern: Handler<
	Sockets.Import.SillyTavern.Scan.Params,
	Sockets.Import.SillyTavern.Scan.Response
> = {
	event: "import:sillytavern:scan",
	handler: async (socket, message, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			throw new Error("User not authenticated")
		}

		const { importSessionId } = message

		if (!importSessionId) {
			const r = { success: false, error: "Import session is required" }
			emitToUser("import:sillytavern:scan", r)
			return r
		}

		try {
			const session = getImportSession(importSessionId, userId)
			const dataDir = await resolveStagedDataDir(session)

			// Scan characters
			const charactersDir = path.join(dataDir, "characters")
			const characters: Array<{
				filename: string
				name: string
				selected: boolean
			}> = []

			try {
				const characterFiles = await fsPromises.readdir(charactersDir)

				for (const filename of characterFiles) {
					if (
						filename.endsWith(".png") ||
						filename.endsWith(".json")
					) {
						const filePath = path.join(charactersDir, filename)
						const card = await readCharacterFile(filePath)

						if (card?.data?.name) {
							characters.push({
								filename,
								name: card.data.name,
								selected: true
							})
						}
					}
				}
			} catch (error) {
				console.log("No characters directory found or empty")
			}

			// Scan personas (stored in settings.json)
			const personas: Array<{ name: string; selected: boolean }> = []

			try {
				const settingsPath = path.join(dataDir, "settings.json")
				const settingsContent = await fsPromises.readFile(
					settingsPath,
					"utf8"
				)
				const settings = JSON.parse(settingsContent)

				if (settings.power_user?.persona_descriptions) {
					for (const [name, description] of Object.entries(
						settings.power_user.persona_descriptions
					)) {
						if (
							typeof description === "object" &&
							description !== null
						) {
							personas.push({
								name: name,
								selected: true
							})
						}
					}
				}
			} catch (error) {
				console.log("No personas found in settings.json")
			}

			// Scan individual chats. These files are deliberately never staged
			// to disk at scan time (see deferredChatPaths on the Params type) —
			// only their relative paths are sent, so list what's available from
			// that instead of reading the (nonexistent, at this point) chats/
			// directory on disk.
			const chats: Array<{
				filename: string
				name: string
				characterNames: string[]
				isGroup: boolean
				selected: boolean
				disabled: boolean
				disabledReason?: string
			}> = []

			try {
				for (const relativePath of message.deferredChatPaths ?? []) {
					const match = relativePath.match(
						/^chats\/([^/]+)\/(.+\.jsonl)$/
					)
					if (!match) continue
					const [, characterName, chatFile] = match
					const chatName = chatFile.replace(/\.jsonl$/, "")
					chats.push({
						filename: `${characterName}/${chatFile}`,
						name: chatName,
						characterNames: [characterName],
						isGroup: false,
						selected: true,
						disabled: false
					})
				}
			} catch (error) {
				console.log("No chats directory found or empty")
			}

			// Scan group chats
			const groupsDir = path.join(dataDir, "groups")
			const groupChats: Array<{
				filename: string
				name: string
				memberNames: string[]
				selected: boolean
				disabled: boolean
				disabledReason?: string
			}> = []

			try {
				const groupFiles = await fsPromises.readdir(groupsDir)

				for (const groupFile of groupFiles) {
					if (groupFile.endsWith(".json")) {
						const groupPath = path.join(groupsDir, groupFile)
						const groupContent = await fsPromises.readFile(
							groupPath,
							"utf8"
						)
						const group = JSON.parse(groupContent) as GroupChat

						groupChats.push({
							filename: groupFile,
							name: group.name,
							memberNames: group.members.map((m) =>
								m.replace(/\.(png|json)$/, "")
							),
							selected: true,
							disabled: false
						})
					}
				}
			} catch (error) {
				console.log("No groups directory found or empty")
			}

			// Scan lorebooks/world info
			const worldsDir = path.join(dataDir, "worlds")
			const lorebooks: Array<{
				filename: string
				name: string
				selected: boolean
			}> = []

			try {
				const worldFiles = await fsPromises.readdir(worldsDir)

				for (const worldFile of worldFiles) {
					if (worldFile.endsWith(".json")) {
						const worldPath = path.join(worldsDir, worldFile)
						const worldContent = await fsPromises.readFile(
							worldPath,
							"utf8"
						)
						const world = JSON.parse(worldContent) as WorldInfo

						lorebooks.push({
							filename: worldFile,
							name: world.name || worldFile.replace(".json", ""),
							selected: true
						})
					}
				}
			} catch (error) {
				console.log("No worlds directory found or empty")
			}

			const result = {
				success: true,
				data: {
					characters,
					personas,
					chats,
					groupChats,
					lorebooks
				}
			}
			emitToUser("import:sillytavern:scan", result)
			return result
		} catch (error) {
			console.error("Error scanning SillyTavern directory:", error)
			const result = {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to scan directory"
			}
			emitToUser("import:sillytavern:scan", result)
			return result
		}
	}
}

// ==================== Execute Import Handler ====================

export const importExecuteSillyTavern: Handler<
	Sockets.Import.SillyTavern.Execute.Params,
	Sockets.Import.SillyTavern.Execute.Response
> = {
	event: "import:sillytavern:execute",
	handler: async (socket, message, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			throw new Error("User not authenticated")
		}

		const { importSessionId, selectedData } = message

		if (!importSessionId || !selectedData) {
			const r = {
				success: false,
				error: "Import session and selected data are required"
			}
			emitToUser("import:sillytavern:execute", r)
			return r
		}

		try {
			// ── Resolve the same data dir the scan phase used ────────────────────
			const session = getImportSession(importSessionId, userId)
			const dataDir = await resolveStagedDataDir(session)

			// ── Counters & tracking ──────────────────────────────────────────────
			const stats = {
				characters: 0,
				personas: 0,
				chats: 0,
				lorebooks: 0,
				errors: 0
			}
			const errors: string[] = []
			// Map ST name → newly inserted DB ID (for chat / character linking)
			const characterNameToId = new Map<string, number>()
			const personaNameToId = new Map<string, number>()
			// Lorebook name → DB id, populated as lorebooks are created or found
			const lorebookNameToId = new Map<string, number>()
			// Character DB id → its lorebook DB id (set when character_book is imported)
			const characterIdToLorebookId = new Map<number, number>()
			// Lorebook names already imported this session (catches within-run duplicates)
			const importedLorebookNames = new Set<string>()

			// Helpers: look up existing records by name for this user
			async function findCharacterId(
				name: string
			): Promise<number | null> {
				const existing = await db.query.characters.findFirst({
					where: and(
						eq(schema.characters.userId, userId),
						eq(schema.characters.name, name)
					)
				})
				return existing?.id ?? null
			}

			async function findPersonaId(name: string): Promise<number | null> {
				const existing = await db.query.personas.findFirst({
					where: and(
						eq(schema.personas.userId, userId),
						eq(schema.personas.name, name),
						eq(schema.personas.isDeleted, false)
					)
				})
				return existing?.id ?? null
			}

			async function findLorebookId(
				name: string
			): Promise<number | null> {
				const fromMap = lorebookNameToId.get(name)
				if (fromMap !== undefined) return fromMap
				const existing = await db.query.lorebooks.findFirst({
					where: and(
						eq(schema.lorebooks.userId, userId),
						eq(schema.lorebooks.name, name)
					)
				})
				if (existing) lorebookNameToId.set(name, existing.id)
				return existing?.id ?? null
			}

			// Returns the existing lorebook ID if one with this name already exists for the
			// user, otherwise inserts a new one and returns its ID.
			async function findOrCreateLorebook(
				name: string,
				description: string
			): Promise<number> {
				const cached = lorebookNameToId.get(name)
				if (cached !== undefined) return cached
				const existing = await db.query.lorebooks.findFirst({
					where: and(
						eq(schema.lorebooks.userId, userId),
						eq(schema.lorebooks.name, name)
					)
				})
				if (existing) {
					importedLorebookNames.add(name)
					lorebookNameToId.set(name, existing.id)
					return existing.id
				}
				const [lb] = await db
					.insert(schema.lorebooks)
					.values({ userId, name, description })
					.returning()
				importedLorebookNames.add(name)
				lorebookNameToId.set(name, lb.id)
				stats.lorebooks++
				return lb.id
			}

			// ── Phase 1: Characters ──────────────────────────────────────────────
			for (const charItem of selectedData.characters) {
				try {
					const filePath = path.join(
						dataDir,
						"characters",
						charItem.filename
					)
					const card = await readCharacterFile(filePath)
					if (!card?.data?.name) continue

					const d = card.data

					// Insert character record
					const [newChar] = await db
						.insert(schema.characters)
						.values({
							userId,
							name: d.name,
							description: d.description ?? "",
							personality: d.personality || null,
							scenario: d.scenario || null,
							firstMessage: d.first_mes || null,
							alternateGreetings: d.alternate_greetings ?? [],
							exampleDialogues: d.mes_example
								? [d.mes_example]
								: [],
							creatorNotes: d.creator_notes || null,
							postHistoryInstructions:
								d.post_history_instructions || null,
							characterVersion: d.character_version || "1.0",
							metadata: {},
							extensions: d.extensions ?? {},
							aliases:
								d.extensions?.serenepub?.aliases ??
								d.extensions?.aliases ??
								[],
							summary: d.extensions?.serenepub?.summary ?? null
						})
						.returning()

					characterNameToId.set(d.name, newChar.id)
					// Also key by filename basename — SillyTavern names chat folders after the
					// character file (without extension), which may differ from the card name.
					const fileBasename = charItem.filename.replace(
						/\.(png|json)$/i,
						""
					)
					if (fileBasename !== d.name)
						characterNameToId.set(fileBasename, newChar.id)
					stats.characters++

					// Copy avatar for PNG cards
					if (charItem.filename.endsWith(".png")) {
						try {
							const buffer = await fsPromises.readFile(filePath)
							const avatarDir = getCharacterDataDir({
								characterId: newChar.id,
								userId
							})
							await fsPromises.mkdir(avatarDir, {
								recursive: true
							})
							const filename = `avatar-${uuid().substring(0, 4)}.png`
							await fsPromises.writeFile(
								path.join(avatarDir, filename),
								buffer
							)
							const avatarUrl = `/images/data/users/${userId}/characters/${newChar.id}/${filename}`
							await db
								.update(schema.characters)
								.set({ avatar: avatarUrl })
								.where(eq(schema.characters.id, newChar.id))
						} catch (e) {
							console.warn(
								`Could not copy avatar for ${d.name}:`,
								e
							)
						}
					}

					// Import embedded character book as lorebook
					if (d.character_book?.entries?.length) {
						const lbName =
							d.character_book.name || `${d.name} Lorebook`
						const lbId = await findOrCreateLorebook(
							lbName,
							d.character_book.description ?? ""
						)
						await db
							.update(schema.characters)
							.set({ lorebookId: lbId })
							.where(eq(schema.characters.id, newChar.id))
						characterIdToLorebookId.set(newChar.id, lbId)
						// Only insert entries for a freshly created lorebook
						const entryCount = await db.$count(
							schema.worldLoreEntries,
							eq(schema.worldLoreEntries.lorebookId, lbId)
						)
						if (entryCount === 0) {
							for (const entry of d.character_book.entries) {
								await db
									.insert(schema.worldLoreEntries)
									.values({
										lorebookId: lbId,
										name: entry.comment || entry.name || "",
										keys: Array.isArray(entry.keys)
											? entry.keys.join(", ")
											: "",
										content: entry.content ?? "",
										enabled: entry.enabled !== false,
										constant: entry.constant ?? false,
										priority:
											entry.priority ??
											entry.insertion_order ??
											1,
										caseSensitive:
											entry.case_sensitive ?? false
									})
							}
						}
					}
				} catch (e) {
					const msg = `Character "${charItem.name}": ${e instanceof Error ? e.message : e}`
					errors.push(msg)
					stats.errors++
				}
			}

			// ── Phase 2: Personas ────────────────────────────────────────────────
			let settingsData: any = null
			try {
				const content = await fsPromises.readFile(
					path.join(dataDir, "settings.json"),
					"utf8"
				)
				settingsData = JSON.parse(content)
			} catch {
				/* no settings.json */
			}

			for (const personaItem of selectedData.personas) {
				try {
					const pd =
						settingsData?.power_user?.persona_descriptions?.[
							personaItem.name
						]
					const description =
						typeof pd === "object" && pd !== null
							? (pd.description ?? "")
							: ""

					const [newPersona] = await db
						.insert(schema.personas)
						.values({
							userId,
							name: personaItem.name,
							description,
							isDefault: false
						})
						.returning()

					personaNameToId.set(personaItem.name, newPersona.id)
					stats.personas++

					// Copy persona avatar if present in ST avatars directory
					const avatarFilename = `${personaItem.name}.png`
					const avatarSrc = path.join(
						dataDir,
						"User Avatars",
						avatarFilename
					)
					try {
						const buffer = await fsPromises.readFile(avatarSrc)
						const avatarDir = getPersonaDataDir({
							personaId: newPersona.id,
							userId
						})
						await fsPromises.mkdir(avatarDir, { recursive: true })
						const filename = `avatar-${uuid().substring(0, 4)}.png`
						await fsPromises.writeFile(
							path.join(avatarDir, filename),
							buffer
						)
						const avatarUrl = `/images/data/users/${userId}/personas/${newPersona.id}/${filename}`
						await db
							.update(schema.personas)
							.set({ avatar: avatarUrl })
							.where(eq(schema.personas.id, newPersona.id))
					} catch {
						/* no avatar file — that's fine */
					}
				} catch (e) {
					const msg = `Persona "${personaItem.name}": ${e instanceof Error ? e.message : e}`
					errors.push(msg)
					stats.errors++
				}
			}

			// ── Phase 3: Lorebooks (World Info) ──────────────────────────────────
			for (const lbItem of selectedData.lorebooks) {
				try {
					const worldPath = path.join(
						dataDir,
						"worlds",
						lbItem.filename
					)
					const content = await fsPromises.readFile(worldPath, "utf8")
					const worldData = JSON.parse(content) as WorldInfo

					const lbName = worldData.name || lbItem.name
					const wasNew =
						!importedLorebookNames.has(lbName) &&
						!(await db.query.lorebooks.findFirst({
							where: and(
								eq(schema.lorebooks.userId, userId),
								eq(schema.lorebooks.name, lbName)
							)
						}))
					const lbId = await findOrCreateLorebook(
						lbName,
						worldData.description ?? ""
					)

					// Only insert entries if this lorebook was just created
					if (wasNew) {
						const entries: WorldInfo["entries"] = Array.isArray(
							worldData.entries
						)
							? worldData.entries
							: Object.values((worldData as any).entries ?? {})

						for (const entry of entries) {
							await db.insert(schema.worldLoreEntries).values({
								lorebookId: lbId,
								name: entry.comment ?? "",
								keys: Array.isArray(entry.key)
									? entry.key.join(", ")
									: "",
								content: entry.content ?? "",
								enabled: !entry.disable,
								constant: entry.constant ?? false,
								priority: entry.order ?? 1,
								caseSensitive: entry.caseSensitive ?? false
							})
						}
					}
				} catch (e) {
					const msg = `Lorebook "${lbItem.name}": ${e instanceof Error ? e.message : e}`
					errors.push(msg)
					stats.errors++
				}
			}

			// Fallback persona: prefer the DB default, then any existing persona for this user.
			// Imported personas are inserted with isDefault=false, so we need the secondary fallback
			// for fresh installs where no default has been set yet.
			const defaultPersona =
				(await db.query.personas.findFirst({
					where: and(
						eq(schema.personas.userId, userId),
						eq(schema.personas.isDefault, true),
						eq(schema.personas.isDeleted, false)
					)
				})) ??
				(await db.query.personas.findFirst({
					where: and(
						eq(schema.personas.userId, userId),
						eq(schema.personas.isDeleted, false)
					)
				}))

			// ── Phase 4: Individual chats ────────────────────────────────────────
			for (const chatItem of selectedData.chats) {
				try {
					const chatPath = path.join(
						dataDir,
						"chats",
						chatItem.filename
					)
					const parsed = await parseChatFile(chatPath)
					if (!parsed) continue

					const charName = chatItem.characterNames[0]
					const characterId =
						characterNameToId.get(charName) ??
						(await findCharacterId(charName))

					// Resolve lorebook: prefer explicit world_info from chat metadata,
					// fall back to the character's embedded lorebook
					const worldInfoName =
						parsed.header.chat_metadata?.world_info
					const chatLorebookId = worldInfoName
						? await findLorebookId(worldInfoName)
						: characterId
							? (characterIdToLorebookId.get(characterId) ?? null)
							: null

					const [newChat] = await db
						.insert(schema.chats)
						.values({
							userId,
							name: chatItem.name,
							isGroup: false,
							lorebookId: chatLorebookId
						})
						.returning()

					if (characterId) {
						await db.insert(schema.chatCharacters).values({
							chatId: newChat.id,
							characterId,
							position: 0
						})
					}

					// Resolve persona from the chat's user_name header, fall back to default
					const chatPersonaName = parsed.header.user_name
					const chatPersonaId = chatPersonaName
						? (personaNameToId.get(chatPersonaName) ??
							(await findPersonaId(chatPersonaName)))
						: null
					const resolvedPersonaId =
						chatPersonaId ?? defaultPersona?.id ?? null
					if (resolvedPersonaId) {
						await db.insert(schema.chatPersonas).values({
							chatId: newChat.id,
							personaId: resolvedPersonaId
						})
					}

					for (const msg of parsed.messages) {
						if (msg.is_system) continue
						const role = msg.is_user ? "user" : "character"
						const metadata: Record<string, any> = {}
						if (msg.swipes && msg.swipes.length > 1) {
							metadata.swipes = {
								currentIdx: msg.swipe_id ?? 0,
								history: msg.swipes
							}
						}
						await db.insert(schema.chatMessages).values({
							chatId: newChat.id,
							userId,
							characterId:
								!msg.is_user && characterId
									? characterId
									: null,
							role,
							content: msg.mes,
							metadata,
							createdAt: normalizeTimestamp(msg.send_date)
								.toISOString()
								.split("T")[0]
						})
					}

					stats.chats++
				} catch (e) {
					const msg = `Chat "${chatItem.name}": ${e instanceof Error ? e.message : e}`
					errors.push(msg)
					stats.errors++
				}
			}

			// ── Phase 5: Group chats ─────────────────────────────────────────────
			for (const groupItem of selectedData.groupChats) {
				try {
					// Re-read group JSON to get the id used for the chat file
					const groupPath = path.join(
						dataDir,
						"groups",
						groupItem.filename
					)
					const groupContent = await fsPromises.readFile(
						groupPath,
						"utf8"
					)
					const groupData = JSON.parse(groupContent) as GroupChat

					const memberIds: (number | null)[] = await Promise.all(
						groupItem.memberNames.map(
							async (name) =>
								characterNameToId.get(name) ??
								(await findCharacterId(name))
						)
					)

					// Group chat history is parsed later; read the file now so we can check
					// the world_info in the header before inserting the chat.
					const groupId =
						groupData.id || groupItem.filename.replace(".json", "")
					const groupChatFile = path.join(
						dataDir,
						"group chats",
						`${groupId}.jsonl`
					)
					let groupParsed: Awaited<ReturnType<typeof parseChatFile>> =
						null
					try {
						groupParsed = await parseChatFile(groupChatFile)
					} catch {
						/* no history file */
					}

					const groupWorldInfoName =
						groupData.chat_metadata?.world_info ??
						groupParsed?.header.chat_metadata?.world_info ??
						null
					const groupLorebookId = groupWorldInfoName
						? await findLorebookId(groupWorldInfoName)
						: null

					const [newChat] = await db
						.insert(schema.chats)
						.values({
							userId,
							name: groupItem.name,
							isGroup: true,
							groupReplyStrategy: mapGroupReplyStrategy(
								groupData.activation_strategy
							),
							lorebookId: groupLorebookId
						})
						.returning()

					for (let i = 0; i < groupItem.memberNames.length; i++) {
						const charId = memberIds[i]
						if (charId) {
							await db.insert(schema.chatCharacters).values({
								chatId: newChat.id,
								characterId: charId,
								position: i
							})
						}
					}

					// Persona link: resolve from history header user_name, fall back to default.
					// Done outside the history try/catch so the link is created even with no messages.
					const groupPersonaName =
						groupParsed?.header.user_name ?? null
					const groupPersonaId = groupPersonaName
						? (personaNameToId.get(groupPersonaName) ??
							(await findPersonaId(groupPersonaName)))
						: null
					const resolvedGroupPersonaId =
						groupPersonaId ?? defaultPersona?.id ?? null
					if (resolvedGroupPersonaId) {
						await db.insert(schema.chatPersonas).values({
							chatId: newChat.id,
							personaId: resolvedGroupPersonaId
						})
					}

					if (groupParsed) {
						for (const msg of groupParsed.messages) {
							if (msg.is_system) continue
							const role = msg.is_user ? "user" : "character"
							const charId = !msg.is_user
								? (memberIds[
										groupItem.memberNames.indexOf(msg.name)
									] ?? null)
								: null
							const metadata: Record<string, any> = {}
							if (msg.swipes && msg.swipes.length > 1) {
								metadata.swipes = {
									currentIdx: msg.swipe_id ?? 0,
									history: msg.swipes
								}
							}
							await db.insert(schema.chatMessages).values({
								chatId: newChat.id,
								userId,
								characterId: charId,
								role,
								content: msg.mes,
								metadata,
								createdAt: normalizeTimestamp(msg.send_date)
									.toISOString()
									.split("T")[0]
							})
						}
					}

					stats.chats++
				} catch (e) {
					const msg = `Group chat "${groupItem.name}": ${e instanceof Error ? e.message : e}`
					errors.push(msg)
					stats.errors++
				}
			}

			// ── Build result message ─────────────────────────────────────────────
			const parts: string[] = []
			if (stats.characters)
				parts.push(
					`${stats.characters} character${stats.characters !== 1 ? "s" : ""}`
				)
			if (stats.personas)
				parts.push(
					`${stats.personas} persona${stats.personas !== 1 ? "s" : ""}`
				)
			if (stats.chats)
				parts.push(`${stats.chats} chat${stats.chats !== 1 ? "s" : ""}`)
			if (stats.lorebooks)
				parts.push(
					`${stats.lorebooks} lorebook${stats.lorebooks !== 1 ? "s" : ""}`
				)

			const summaryMessage = parts.length
				? `Imported ${parts.join(", ")}.${stats.errors ? ` ${stats.errors} item(s) had errors.` : ""}`
				: "Nothing was imported."

			const r = {
				success: true,
				message: summaryMessage,
				errors: errors.length ? errors : undefined
			}
			await cleanupImportSession(importSessionId)
			emitToUser("import:sillytavern:execute", r)
			return r
		} catch (error) {
			console.error("Error executing import:", error)
			const r = {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to execute import"
			}
			await cleanupImportSession(importSessionId)
			emitToUser("import:sillytavern:execute", r)
			return r
		}
	}
}

// ==================== Register Handlers ====================

export function registerImportHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: any) => void
) {
	register(socket, importStartSillyTavernSession, emitToUser)
	register(socket, importStageSillyTavernFiles, emitToUser)
	register(socket, importScanSillyTavern, emitToUser)
	register(socket, importExecuteSillyTavern, emitToUser)
}
