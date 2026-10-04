import { db } from "$lib/server/db"
import { spriteLabelFromFilename } from "$lib/shared/sprites"
import * as schema from "$lib/server/db/schema"
import {
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import {
	importedKeyColumns,
	mapImportedEntry,
	normalizeNativeWorldInfoEntry
} from "$lib/server/utils/lorebookImportMapper"
import { insertLegacyMany } from "$lib/server/messages/store"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import type { Handler } from "$lib/shared/events"
import * as fsPromises from "fs/promises"
import * as path from "path"
import * as os from "os"
import { eq, and } from "drizzle-orm"
import { v4 as uuid } from "uuid"
import { createMedia } from "$lib/server/media"
import {
	extractCharacterFromPNG,
	readCharacterFile,
	parseSillyTavernChatFile,
	listSillyTavernPersonas,
	normalizeTimestamp,
	mapGroupReplyStrategy,
	authorsNoteFromChatMetadata,
	type CharacterCardV2,
	type CharacterBook,
	type SillyTavernGroup,
	type WorldInfo
} from "$lib/server/utils/sillyTavernParsers"
import {
	resolveSillyTavernDataRoot,
	SILLYTAVERN_DIRS
} from "$lib/shared/utils/sillyTavernPaths"
import { characterFieldsFromParsedData } from "./characters"
import {
	ENTRY_INSERT_BATCH,
	assertBookWithinImportLimits,
	assertEntryWithinImportLimits,
	extractLorebookLevelExtraJson,
	queueImportedBook,
	syncLorebookBindings
} from "./lorebooks"
import { importFailureSentence } from "$lib/server/imports/importFailure"
import {
	IMPORT_FILE_CAPS,
	cardFileTooLarge,
	lorebookFileTooLarge,
	megabytes
} from "$lib/shared/imports/fileCaps"
import { assertImportJsonShape } from "$lib/server/imports/jsonShape"
import { personaFieldsFromParsedData } from "$lib/server/utils/personaCard"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"

/**
 * An imported session announces itself (PLAN-turn-order §4.1): one
 * `session-updated` under the `system` cause, once its cast and messages are
 * in, so the genre's turn-order spec runs and the session has an order the
 * first time it opens instead of waiting for its first event. No `changed`:
 * the whole row is new, and the cause says why. Best-effort — the import has
 * landed.
 */
export async function announceImportedSession(
	db: Db,
	opts: { sessionId: number; userId: number }
): Promise<void> {
	try {
		const [{ emitSessionEvent }, { sessionEvents }] = await Promise.all([
			import("$lib/server/pipelines/runtime/sessionEvents"),
			import("@serene-pub/sdk")
		])
		await emitSessionEvent(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			event: sessionEvents.sessionUpdated,
			payload: { sessionId: opts.sessionId, cause: { kind: "system" } }
		})
	} catch (err) {
		console.warn(`[import] session-updated for session ${opts.sessionId} failed:`, err)
	}
}

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
	/** Every byte this import has staged so far (`STAGING_LIMITS`). */
	stagedBytes: number
}

const importSessions = new Map<string, ImportSession>()
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes of inactivity

/**
 * What one SillyTavern import may stage on the server's disk (S4 review:
 * nothing bounded it). Mutable only so a test can lower it.
 */
export const STAGING_LIMITS = {
	/** Every file one import uploads, together. */
	sessionBytes: 4 * 1024 * 1024 * 1024,
	/** A batch that would leave less than this free on the disk is refused. */
	freeBytesFloor: 1024 * 1024 * 1024
}

/** Every staging directory is `<tmp>/serene-pub-import-<import session id>`. */
const STAGING_PREFIX = "serene-pub-import-"

/**
 * Remove staging directories no live import owns and nothing has touched for
 * longer than an import may sit idle — what a restart leaves behind, since
 * the in-memory sweep below forgets them (S4 review). Another process's live
 * import keeps its directory fresh: every staged batch touches it.
 */
async function sweepOrphanedStaging(): Promise<void> {
	const live = new Set([...importSessions.values()].map((s) => s.dir))
	let names: string[]
	try {
		names = await fsPromises.readdir(os.tmpdir())
	} catch {
		return
	}
	const now = Date.now()
	await Promise.all(
		names
			.filter((n) => n.startsWith(STAGING_PREFIX))
			.map(async (n) => {
				const dir = path.join(os.tmpdir(), n)
				if (live.has(dir)) return
				try {
					const st = await fsPromises.stat(dir)
					if (!st.isDirectory() || now - st.mtimeMs <= SESSION_TTL_MS) return
					await fsPromises.rm(dir, { recursive: true, force: true })
				} catch {
					// Gone already, or not ours to remove.
				}
			})
	)
}
void sweepOrphanedStaging()

// lorebooks:import enforces LOREBOOK_IMPORT_LIMITS for the exact same
// unbounded-import-DoS reason (lorebooks.ts) — this bulk SillyTavern-folder
// import has its own, differently-shaped item lists (character_book entries,
// world-info entries, session messages), so it gets its own smaller guard here
// rather than reusing that one, using the same ceiling for consistency.
export const MAX_BULK_IMPORT_ITEMS = 5000
export function assertWithinBulkImportLimit(
	count: number,
	itemDescription: string
) {
	if (count > MAX_BULK_IMPORT_ITEMS) {
		throw new Error(
			`${itemDescription} has too many items (${count}); the maximum supported is ${MAX_BULK_IMPORT_ITEMS}.`
		)
	}
}

/**
 * A SillyTavern World Info file, measured on disk before it is read and
 * parsed (plan S4): the same ceiling `lorebooks:import` holds a lorebook file
 * to, refused in the same sentence.
 */
export async function readWorldInfoFile(worldPath: string): Promise<WorldInfo> {
	const text = await readStagedText(worldPath, lorebookFileTooLarge)
	assertImportJsonShape(text, "This lorebook file")
	return JSON.parse(text) as WorldInfo
}

/**
 * A staged text file, measured on disk before it is read: `tooLarge` says
 * the sentence refusing its size, or null when it fits.
 */
async function readStagedText(
	file: string,
	tooLarge: (bytes: number) => string | null
): Promise<string> {
	const refusal = tooLarge((await fsPromises.stat(file)).size)
	if (refusal) throw new Error(refusal)
	return fsPromises.readFile(file, "utf8")
}

/**
 * A staged SillyTavern settings or group file — small JSON, held to the
 * lorebook file's ceilings, which are far past any real one.
 */
async function readStagedJson(file: string, subject: string): Promise<any> {
	const text = await readStagedText(file, (bytes) =>
		bytes > IMPORT_FILE_CAPS.lorebookBytes
			? `${subject} is ${megabytes(bytes)}, larger than the ${megabytes(IMPORT_FILE_CAPS.lorebookBytes)} Serene Pub will read.`
			: null
	)
	assertImportJsonShape(text, subject)
	return JSON.parse(text)
}

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

const SPRITE_FILE = /\.(png|apng|jpe?g|webp|gif|avif)$/i

/**
 * A SillyTavern character's sprite folder, imported as sprites
 * (DESIGN-sprites §4). Top-level images land in the default set; each
 * subfolder but `backgrounds` is a sprite set of that name. Every path goes
 * through `resolveSafePath`, like the rest of this import. Returns how many
 * sprites were stored.
 */
async function importSillyTavernSprites(
	dataDir: string,
	folder: string,
	userId: number,
	characterId: number
): Promise<number> {
	const charactersRoot = path.join(dataDir, SILLYTAVERN_DIRS.characters)
	let root: string
	try {
		root = resolveSafePath(charactersRoot, folder)
	} catch {
		return 0
	}
	let entries: import("fs").Dirent[]
	try {
		entries = await fsPromises.readdir(root, { withFileTypes: true })
	} catch {
		return 0
	}
	const { importSprites, SPRITE_IMPORT_LIMITS } = await import(
		"$lib/server/sprites"
	)
	const items: { set?: string; label: string; bytes: Buffer; filename: string }[] = []
	// Each image is measured on disk before it is read, against the same
	// ceilings `importSprites` holds a card's sprites to: a folder was read
	// whole into memory before any of them applied (S4 review). An image
	// past them is left behind unread, as `importSprites` would skip it.
	let total = 0
	const readImages = async (dir: string, set?: string) => {
		for (const e of await fsPromises.readdir(dir, { withFileTypes: true })) {
			if (items.length >= SPRITE_IMPORT_LIMITS.count) return
			if (!e.isFile() || !SPRITE_FILE.test(e.name)) continue
			const label = spriteLabelFromFilename(e.name)
			if (!label) continue
			const file = resolveSafePath(dir, e.name)
			const { size } = await fsPromises.stat(file)
			if (
				size > SPRITE_IMPORT_LIMITS.bytes ||
				total + size > SPRITE_IMPORT_LIMITS.totalBytes
			)
				continue
			total += size
			items.push({
				...(set ? { set } : {}),
				label,
				bytes: await fsPromises.readFile(file),
				filename: e.name
			})
		}
	}
	await readImages(root)
	for (const e of entries) {
		if (!e.isDirectory() || e.name.toLowerCase() === "backgrounds") continue
		await readImages(resolveSafePath(root, e.name), e.name)
	}
	if (items.length === 0) return 0
	const result = await importSprites(db, userId, characterId, items, "sillytavern")
	return result.added
}

/** Resolves a client-supplied relative path to a safe location inside
 * `root` — rejects traversal and absolute paths. Shared by the staging
 * write path (root = import staging dir) and the execute-phase reads (root =
 * the relevant SillyTavern subdirectory) — the latter's accepted relative
 * paths can legitimately contain one subdirectory segment (eg. a SillyTavern
 * chat's "CharacterName/CharacterName - 2024-01-01@12h00m00s.jsonl"), so this
 * only rejects genuine traversal (".."/absolute), not slashes in general. */
function resolveSafePath(root: string, relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, "/")
	if (
		!normalized ||
		normalized.startsWith("/") ||
		normalized.includes("..") ||
		path.isAbsolute(normalized)
	) {
		throw new Error(`Invalid file path: ${relativePath}`)
	}
	const resolvedRoot = path.resolve(root)
	const resolved = path.resolve(resolvedRoot, normalized)
	if (
		resolved !== resolvedRoot &&
		!resolved.startsWith(resolvedRoot + path.sep)
	) {
		throw new Error(`Invalid file path: ${relativePath}`)
	}
	return resolved
}

function resolveStagedFilePath(
	session: ImportSession,
	relativePath: string
): string {
	return resolveSafePath(session.dir, relativePath)
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
		// UI-only restriction (Settings › Import, settingsTabs/ImportSettingsTab.svelte) isn't enforcement —
		// without this, any authenticated non-admin user could drive the whole
		// SillyTavern import pipeline directly via sockets.
		if (!socket.user!.isAdmin) {
			throw new Error("Unauthorized")
		}

		try {
			await sweepOrphanedStaging()
			const importSessionId = uuid()
			const dir = path.join(
				os.tmpdir(),
				`${STAGING_PREFIX}${importSessionId}`
			)
			await fsPromises.mkdir(dir, { recursive: true })
			importSessions.set(importSessionId, {
				userId,
				dir,
				lastActivity: Date.now(),
				stagedBytes: 0
			})

			const result = { success: true, importSessionId }
			emitToUser("import:sillytavern:startSession", result)
			return result
		} catch (error) {
			const result = {
				success: false,
				error: importFailureSentence(error, "SillyTavern import start")
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
		// UI-only restriction (Settings › Import, settingsTabs/ImportSettingsTab.svelte) isn't enforcement —
		// without this, any authenticated non-admin user could drive the whole
		// SillyTavern import pipeline directly via sockets.
		if (!socket.user!.isAdmin) {
			throw new Error("Unauthorized")
		}

		try {
			const session = getImportSession(message.importSessionId, userId)
			const blob = Buffer.from(message.blob)

			// The manifest must account for the upload exactly, and the
			// import stays under its quota and off a full disk (S4 review:
			// staging had no bound at all).
			const lengths = Array.isArray(message.manifest)
				? message.manifest.map((e) => e?.length)
				: []
			if (
				!Array.isArray(message.manifest) ||
				!lengths.every((n) => Number.isSafeInteger(n) && n >= 0) ||
				lengths.reduce((a, b) => a + b, 0) !== blob.length
			) {
				throw new Error(
					"This upload doesn't match its own list of files, so nothing was saved."
				)
			}
			if (session.stagedBytes + blob.length > STAGING_LIMITS.sessionBytes) {
				throw new Error(
					`This SillyTavern folder is larger than the ${megabytes(STAGING_LIMITS.sessionBytes)} Serene Pub will stage for one import.`
				)
			}
			const disk = await fsPromises.statfs(session.dir)
			if (disk.bavail * disk.bsize - blob.length < STAGING_LIMITS.freeBytesFloor) {
				throw new Error(
					"The server's disk is nearly full, so Serene Pub stopped staging this import."
				)
			}
			session.stagedBytes += blob.length

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
			// Fresh for `sweepOrphanedStaging` in any process sharing the
			// temp directory: a live import is never an orphan.
			const now = new Date()
			await fsPromises.utimes(session.dir, now, now)

			const result = { success: true, staged: message.manifest.length }
			emitToUser("import:sillytavern:stageFiles", result)
			return result
		} catch (error) {
			const result = {
				success: false,
				error: importFailureSentence(error, "SillyTavern import staging")
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
		// UI-only restriction (Settings › Import, settingsTabs/ImportSettingsTab.svelte) isn't enforcement —
		// without this, any authenticated non-admin user could drive the whole
		// SillyTavern import pipeline directly via sockets.
		if (!socket.user!.isAdmin) {
			throw new Error("Unauthorized")
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
			const charactersDir = path.join(dataDir, SILLYTAVERN_DIRS.characters)
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
				const settings = await readStagedJson(
					path.join(dataDir, "settings.json"),
					"This SillyTavern settings file"
				)

				// ST keys a persona by its avatar file; the name the user
				// knows it by is `power_user.personas[file]`.
				for (const persona of listSillyTavernPersonas(settings)) {
					personas.push({ name: persona.name, selected: true })
				}
			} catch (error) {
				console.log("No personas found in settings.json")
			}

			// Scan SillyTavern's individual chats (each imports as a session).
			// These files are deliberately never staged to disk at scan time
			// (see deferredSessionPaths on the Params type) — only their
			// relative paths are sent, so list what's available from that
			// instead of reading the (nonexistent, at this point) `chats/`
			// directory on disk. The folder is SillyTavern's, under
			// SillyTavern's name (R5): `chats/<character file>/<chat>.jsonl`.
			const sessions: Array<{
				filename: string
				name: string
				characterNames: string[]
				isGroup: boolean
				selected: boolean
				disabled: boolean
				disabledReason?: string
			}> = []

			try {
				for (const relativePath of message.deferredSessionPaths ?? []) {
					const prefix = `${SILLYTAVERN_DIRS.chats}/`
					if (!relativePath.startsWith(prefix)) continue
					const match = relativePath
						.slice(prefix.length)
						.match(/^([^/]+)\/(.+\.jsonl)$/)
					if (!match) continue
					const [, characterName, chatFile] = match
					const chatName = chatFile.replace(/\.jsonl$/, "")
					sessions.push({
						filename: `${characterName}/${chatFile}`,
						name: chatName,
						characterNames: [characterName],
						isGroup: false,
						selected: true,
						disabled: false
					})
				}
			} catch (error) {
				console.log("No SillyTavern chats found")
			}

			// Scan SillyTavern groups (each group's chat imports as a session)
			const groupsDir = path.join(dataDir, SILLYTAVERN_DIRS.groups)
			const groupSessions: Array<{
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
						const group = (await readStagedJson(
							path.join(groupsDir, groupFile),
							"This SillyTavern group file"
						)) as SillyTavernGroup

						groupSessions.push({
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
			const worldsDir = path.join(dataDir, SILLYTAVERN_DIRS.worlds)
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
						const fallbackName = worldFile.replace(".json", "")
						// Listed by its file name, unread, when it is past the
						// lorebook ceiling: the import then says why it stopped.
						const { size } = await fsPromises.stat(worldPath)
						const world = lorebookFileTooLarge(size)
							? null
							: await readWorldInfoFile(worldPath)

						lorebooks.push({
							filename: worldFile,
							name: world?.name || fallbackName,
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
					sessions,
					groupSessions,
					lorebooks
				}
			}
			emitToUser("import:sillytavern:scan", result)
			return result
		} catch (error) {
			const result = {
				success: false,
				error: importFailureSentence(error, "SillyTavern import scan")
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
		// UI-only restriction (Settings › Import, settingsTabs/ImportSettingsTab.svelte) isn't enforcement —
		// without this, any authenticated non-admin user could drive the whole
		// SillyTavern import pipeline directly via sockets.
		if (!socket.user!.isAdmin) {
			throw new Error("Unauthorized")
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

		// ── Counters & tracking ──────────────────────────────────────────────
		// Outside the try: a failure that stops the import still reports what
		// had already landed, rather than "import failed" over saved rows.
		const stats = {
			characters: 0,
			sprites: 0,
			personas: 0,
			sessions: 0,
			lorebooks: 0,
			errors: 0
		}
		// What failed: one sentence per item, in the person's words — the
		// database's and the machine's go to the server log (`importFailureSentence`).
		const errors: string[] = []
		// What did not finish for an item that DID land (plan A13).
		const warnings: string[] = []
		// The books this import made, by id → name: each gets its cast tags
		// read and is queued for its vectors and annotations, however the
		// import ends (`finishMadeBooks`).
		const madeBooks = new Map<number, string>()
		const tagsRead = new Set<number>()

		/**
		 * What an entry save gives a book, for each book this import made: its
		 * cast tags read (`syncLorebookBindings`) — before any session seats a
		 * cast in it, so a member a tag names keeps its number — once.
		 */
		async function readMadeBooksTags() {
			for (const [id, name] of madeBooks) {
				if (tagsRead.has(id)) continue
				tagsRead.add(id)
				try {
					await syncLorebookBindings({ lorebookId: id })
				} catch (e) {
					warnings.push(
						`Lorebook "${name}" was imported, but the cast members its entries name were not all added: ${importFailureSentence(e, `lorebook "${name}"'s cast tags`)}`
					)
				}
			}
		}

		/**
		 * Every book this import made, finished however the import ends: its
		 * tags read if a stop came first, and queued for its vectors and
		 * annotations, as an entry save queues them — after the sessions,
		 * whose cast the annotation vocabulary reads.
		 */
		async function finishMadeBooks() {
			await readMadeBooksTags()
			for (const [id, name] of madeBooks) queueImportedBook(id, name)
		}

		try {
			// ── Resolve the same data dir the scan phase used ────────────────────
			const session = getImportSession(importSessionId, userId)
			const dataDir = await resolveStagedDataDir(session)

			// Map ST name → newly inserted DB ID (for session / character linking)
			const characterNameToId = new Map<string, number>()
			const personaNameToId = new Map<string, number>()
			// Lorebook name → DB id, populated as lorebooks are created or found
			const lorebookNameToId = new Map<string, number>()
			// Character DB id → its lorebook DB id (set when character_book is imported)
			const characterIdToLorebookId = new Map<number, number>()

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

			// A persona is a character, so this is `findCharacterId` narrowed
			// to the ones the user plays — narrowed rather than merged,
			// because an import naming a persona must not silently attach some
			// NPC that happens to share the name.
			async function findPersonaId(name: string): Promise<number | null> {
				const existing = await db.query.characters.findFirst({
					where: and(
						eq(schema.characters.userId, userId),
						eq(schema.characters.name, name),
						eq(schema.characters.isPersona, true),
						eq(schema.characters.isDeleted, false)
					)
				})
				return existing?.id ?? null
			}

			// A book is matched by name (docs/importing-from-sillytavern.md): one
			// this user already has, or this import made, is reused as it is.
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

			/**
			 * Make a book whole (plan A13): its row, with the book's own
			 * settings the file states (`extraJson`), and every entry, in one
			 * transaction and in batches — so a failure leaves no half-made
			 * book behind. `entries` are a card book's (CCv2/V3) or World
			 * Info's already renamed (`normalizeNativeWorldInfoEntry`): the
			 * same shape, run through the mapper `lorebooks:import` runs —
			 * key-shape regex detection, declared whole-word intent, the
			 * preserved `extensions` bag and the 1-3 priority clamp come from
			 * there rather than from a second copy of the rules here.
			 */
			async function createImportedBook(
				name: string,
				description: string,
				extraJson: Record<string, any>,
				entries: any[]
			): Promise<number> {
				// The one-file lorebook import's book-level ceilings, in its
				// sentences, as its per-entry ones are met before this.
				assertBookWithinImportLimits(name, description)
				const id = await db.transaction(async (tx) => {
					const [lb] = await tx
						.insert(schema.lorebooks)
						.values({ userId, name, description, extraJson })
						.returning({ id: schema.lorebooks.id })
					const rows = entries.map((entry, position) =>
						entryInsert({
							typeId: WORLD_LORE_TYPE_ID,
							// `position` has no column default on the one
							// table and is unique per (lorebook, type).
							...(mapImportedEntry(
								entry,
								WORLD_LORE_TYPE_ID,
								position
							) as any),
							// One file key, one stored key: the mapper's
							// joined string would be re-split on every comma,
							// tearing a regex `{1,3}` or "Smith, John" in two
							// (finding #146).
							...importedKeyColumns(entry),
							lorebookId: lb.id
						})
					)
					for (let i = 0; i < rows.length; i += ENTRY_INSERT_BATCH)
						await tx
							.insert(schema.lorebookEntries)
							.values(rows.slice(i, i + ENTRY_INSERT_BATCH))
					return lb.id
				})
				lorebookNameToId.set(name, id)
				madeBooks.set(id, name)
				stats.lorebooks++
				return id
			}

			/**
			 * What a session needs once it is in (its transaction committed):
			 * its persona marked as one, its cast seated in the book it reads
			 * — as reading a book into a session seats it
			 * (`runLorebookBindingCheck`, plan A13) — and its one push. None of
			 * it can undo the session, so a step that fails is a warning.
			 */
			async function afterSessionImported(
				label: string,
				sessionId: number,
				lorebookId: number | null,
				personaId: number | null
			) {
				if (personaId) {
					try {
						await markCharacterAsPersona(personaId)
					} catch (e) {
						warnings.push(
							`${label} was imported, but the character you play in it was not marked as a persona: ${importFailureSentence(e, `${label}'s persona`)}`
						)
					}
				}
				if (lorebookId) {
					try {
						const { runLorebookBindingCheck } = await import("./sessions")
						// Seated only: an import asks nothing about the book's
						// cast members no card stands behind — one prompt per
						// imported session would be noise nobody asked for.
						await runLorebookBindingCheck(
							socket,
							sessionId,
							lorebookId,
							emitToUser,
							{ askAboutOrphans: false }
						)
					} catch (e) {
						warnings.push(
							`${label} was imported, but its characters were not all added to its lorebook's cast. They are added when its cast next changes. ${importFailureSentence(e, `${label}'s cast`)}`
						)
					}
				}
				// One push for the whole imported history, after it: the new
				// row has a line to quote from the moment it appears.
				try {
					broadcastSessionRow(socket.io, sessionId)
				} catch (e) {
					console.error(`[import] ${label}: the session row push failed:`, e)
				}
				await announceImportedSession(db, { sessionId, userId })
			}

			// ── Phase 1: Characters ──────────────────────────────────────────────
			for (const charItem of selectedData.characters) {
				try {
					const filePath = resolveSafePath(
						path.join(dataDir, SILLYTAVERN_DIRS.characters),
						charItem.filename
					)
					const card = await readCharacterFile(filePath)
					if (!card?.data?.name) continue

					const d = card.data

					// Insert character record — routed through the same
					// canonical field allowlist personas:importCard/
					// characters:importCard use, rather than a hand-rolled
					// duplicate, so a future field added to that allowlist
					// (eg. explicitly stripping a sensitive column) can't
					// silently drift out of sync with this bulk-import path.
					const [newChar] = await db
						.insert(schema.characters)
						.values({
							...characterFieldsFromParsedData(d),
							userId,
							isFavorite: false,
							extensions: d.extensions ?? {}
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
							// An import is an upload like any other (28 §8
							// rule 6): it lands under the entity it produced,
							// through the same choke point, rather than
							// getting its own tree and its own path format.
							// Derivation happens on first request, so a bulk
							// import pays for no thumbnail it does not need.
							const created = await createMedia(db, {
								userId,
								characterId: newChar.id,
								bytes: buffer,
								filename: charItem.filename
							})
							await db
								.update(schema.characters)
								.set({ avatarMediaId: created.file.id })
								.where(eq(schema.characters.id, newChar.id))
						} catch (e) {
							console.warn(
								`Could not copy avatar for ${d.name}:`,
								e
							)
						}
					}

					// Sprites (DESIGN-sprites §4): SillyTavern keeps a
					// character's expressions in `characters/<file name>/`,
					// labelled by file name up to the first `-` or `.`
					// (`joy.png`, `joy-2.png`), and a sprite-folder override
					// in a subfolder — which is exactly a sprite set here.
					// `backgrounds/` is where its CHARX import files a card's
					// backgrounds, not sprites.
					try {
						const imported = await importSillyTavernSprites(
							dataDir,
							fileBasename,
							userId,
							newChar.id
						)
						stats.sprites += imported
					} catch (e) {
						console.warn(`Could not import sprites for ${d.name}:`, e)
					}

					// Import embedded character book as lorebook. The
					// character is in by now, so a book that fails is the
					// book's failure, and the line says the character landed.
					if (d.character_book?.entries?.length) {
						const lbName =
							d.character_book.name || `${d.name} Lorebook`
						try {
							assertWithinBulkImportLimit(
								d.character_book.entries.length,
								`Character "${d.name}"'s embedded lorebook`
							)
							// The one-file lorebook import's per-entry
							// ceilings, in its sentences, before the book is
							// made (S4 review).
							d.character_book.entries.forEach((entry, i) =>
								assertEntryWithinImportLimits(entry, i)
							)
							const existingId = await findLorebookId(lbName)
							// A book of this name — the user's, or one this
							// import made — is reused as it is, and the card's
							// own entries are left out: said, never silent.
							if (existingId !== null)
								warnings.push(
									`Character "${d.name}" reads the lorebook "${lbName}" that already existed; the card's own lorebook of that name was not imported.`
								)
							const lbId =
								existingId ??
								(await createImportedBook(
									lbName,
									d.character_book.description ?? "",
									extractLorebookLevelExtraJson(d.character_book),
									d.character_book.entries
								))
							await db
								.update(schema.characters)
								.set({ lorebookId: lbId })
								.where(eq(schema.characters.id, newChar.id))
							characterIdToLorebookId.set(newChar.id, lbId)
						} catch (e) {
							errors.push(
								`Character "${d.name}" was imported without its lorebook "${lbName}": ${importFailureSentence(e, `character "${d.name}"'s lorebook "${lbName}"`)}`
							)
							stats.errors++
						}
					}
				} catch (e) {
					errors.push(
						`Character "${charItem.name}": ${importFailureSentence(e, `character "${charItem.name}"`)}`
					)
					stats.errors++
				}
			}

			// ── Phase 2: Personas ────────────────────────────────────────────────
			let settingsData: any = null
			try {
				settingsData = await readStagedJson(
					path.join(dataDir, "settings.json"),
					"This SillyTavern settings file"
				)
			} catch {
				/* no settings.json */
			}

			// ST keys each persona by its avatar file (`User Avatars/<file>`),
			// the scan by the name ST shows — so find the file by name here.
			const stPersonas = listSillyTavernPersonas(settingsData)
			for (const personaItem of selectedData.personas) {
				try {
					const stPersona = stPersonas.find(
						(p) => p.name === personaItem.name
					)
					const description = stPersona?.description ?? ""

					// `personaFieldsFromParsedData` carries `isPersona: true` —
					// an ST persona import is the user saying they play it.
					const [newPersona] = await db
						.insert(schema.characters)
						.values({
							...personaFieldsFromParsedData({
								name: personaItem.name,
								description
							}),
							userId
						})
						.returning()

					personaNameToId.set(personaItem.name, newPersona.id)
					stats.personas++

					// Copy the persona's avatar from ST's `User Avatars/`
					// if it was uploaded.
					const avatarFilename =
						stPersona?.avatar ?? `${personaItem.name}.png`
					const avatarSrc = resolveSafePath(
						path.join(dataDir, SILLYTAVERN_DIRS.userAvatars),
						avatarFilename
					)
					try {
						const tooLarge = cardFileTooLarge(
							(await fsPromises.stat(avatarSrc)).size
						)
						if (tooLarge) throw new Error(tooLarge)
						const buffer = await fsPromises.readFile(avatarSrc)
						const created = await createMedia(db, {
							userId,
							characterId: newPersona.id,
							bytes: buffer,
							filename: avatarFilename
						})
						await db
							.update(schema.characters)
							.set({ avatarMediaId: created.file.id })
							.where(eq(schema.characters.id, newPersona.id))
					} catch {
						/* no avatar file — that's fine */
					}
				} catch (e) {
					errors.push(
						`Persona "${personaItem.name}": ${importFailureSentence(e, `persona "${personaItem.name}"`)}`
					)
					stats.errors++
				}
			}

			// ── Phase 3: Lorebooks (World Info) ──────────────────────────────────
			for (const lbItem of selectedData.lorebooks) {
				try {
					const worldPath = resolveSafePath(
						path.join(dataDir, SILLYTAVERN_DIRS.worlds),
						lbItem.filename
					)
					const worldData = await readWorldInfoFile(worldPath)

					const lbName = worldData.name || lbItem.name
					// A book of this name is reused as it is, and the file is
					// not imported: an item not imported when the person
					// already had it, and said once when a card above just
					// brought a book of that name in.
					const existingId = await findLorebookId(lbName)
					if (existingId !== null) {
						if (madeBooks.has(existingId))
							warnings.push(
								`Lorebook "${lbName}" was not imported again: a character's lorebook of that name came in with this import.`
							)
						else {
							errors.push(
								`Lorebook "${lbName}" was not imported: you already have a lorebook with that name.`
							)
							stats.errors++
						}
						continue
					}
					const worldEntries: WorldInfo["entries"] = Array.isArray(
						worldData.entries
					)
						? worldData.entries
						: Object.values((worldData as any).entries ?? {})
					// A book about to be made meets its ceilings first — the
					// count, and the one-file import's per-entry ones in its
					// sentences (S4 review).
					assertWithinBulkImportLimit(
						worldEntries.length,
						`Lorebook "${lbName}"`
					)
					// ST's *native* World Info shape: the same facts as a
					// `character_book` entry under different names, so it is
					// renamed once and then mapped by the same function
					// everything else is.
					//
					// ⚠ `entry.order` is not `priority`. It is ST's insertion
					// index, defaulting to 100, so clamping it into Serene
					// Pub's 1-3 band read "every imported entry is maximum
					// priority" — a fact the file never stated. Native World
					// Info declares no priority, so imported entries take the
					// mapper's default of 1, which is what the same book gets
					// through `lorebooks:import`.
					const normalizedEntries = worldEntries.map((entry) =>
						normalizeNativeWorldInfoEntry(entry)
					)
					normalizedEntries.forEach((entry, i) =>
						assertEntryWithinImportLimits(entry, i)
					)
					await createImportedBook(
						lbName,
						worldData.description ?? "",
						extractLorebookLevelExtraJson(worldData),
						normalizedEntries
					)
				} catch (e) {
					errors.push(
						`Lorebook "${lbItem.name}": ${importFailureSentence(e, `lorebook "${lbItem.name}"`)}`
					)
					stats.errors++
				}
			}

			await readMadeBooksTags()

			// Fallback persona: prefer the DB default, then any existing persona for this user.
			// Imported personas are inserted with isDefaultPersona=false, so we need the secondary
			// fallback for fresh installs where no default has been set yet.
			const defaultPersona =
				(await db.query.characters.findFirst({
					where: and(
						eq(schema.characters.userId, userId),
						eq(schema.characters.isDefaultPersona, true),
						eq(schema.characters.isDeleted, false)
					)
				})) ??
				(await db.query.characters.findFirst({
					where: and(
						eq(schema.characters.userId, userId),
						eq(schema.characters.isPersona, true),
						eq(schema.characters.isDeleted, false)
					)
				}))

			// ── Phase 4: SillyTavern chats → sessions ───────────────────────────
			for (const sessionItem of selectedData.sessions) {
				const label = `Session "${sessionItem.name}"`
				try {
					const chatPath = resolveSafePath(
						path.join(dataDir, SILLYTAVERN_DIRS.chats),
						sessionItem.filename
					)
					const parsed = await parseSillyTavernChatFile(chatPath)
					if (!parsed)
						throw new Error(
							"The chat file is missing or empty, so there is nothing to import."
						)
					assertWithinBulkImportLimit(parsed.messages.length, label)

					const charName = sessionItem.characterNames[0]
					const characterId =
						characterNameToId.get(charName) ??
						(await findCharacterId(charName))

					// Resolve lorebook: prefer explicit world_info from the chat's metadata,
					// fall back to the character's embedded lorebook
					const worldInfoName =
						parsed.header.chat_metadata?.world_info
					const sessionLorebookId = worldInfoName
						? await findLorebookId(worldInfoName)
						: characterId
							? (characterIdToLorebookId.get(characterId) ?? null)
							: null

					// Resolve persona from the chat's user_name header, fall back to default
					const sessionPersonaName = parsed.header.user_name
					const sessionPersonaId = sessionPersonaName
						? (personaNameToId.get(sessionPersonaName) ??
							(await findPersonaId(sessionPersonaName)))
						: null
					const resolvedPersonaId =
						sessionPersonaId ?? defaultPersona?.id ?? null
					// The line it reads, as a session made here reads one.
					const sessionLine = await importedSessionLine(sessionLorebookId)
					// 🚧 The chat's Author's Note, as the Chat session's own
					// (AN1) — an imported chat is a Chat session, which
					// declares the note. Absent: the row is what it was.
					const sessionNote = authorsNoteFromChatMetadata(
						parsed.header.chat_metadata
					)

					// The session, its members and its history land whole or
					// not at all — one transaction, the history in batches.
					const newSession = await db.transaction(async (tx) => {
						const [row] = await tx
							.insert(schema.sessions)
							.values({
								userId,
								name: sessionItem.name,
								isGroup: false,
								lorebookId: sessionLorebookId,
								...(sessionNote
									? { genreFields: { authorsNote: sessionNote.note } }
									: {}),
								...sessionLine
							})
							.returning()
						if (characterId) {
							await tx.insert(schema.sessionCharacters).values({
								sessionId: row.id,
								characterId,
								position: 0
							})
						}
						if (resolvedPersonaId) {
							await tx.insert(schema.sessionPersonas).values({
								sessionId: row.id,
								personaId: resolvedPersonaId
							})
						}
						await insertImportedHistory(
							tx,
							row.id,
							userId,
							parsed.messages,
							() => characterId ?? null
						)
						return row
					})
					stats.sessions++
					if (sessionNote?.importNote)
						warnings.push(`${label} was imported, but ${sessionNote.importNote}.`)
					await afterSessionImported(
						label,
						newSession.id,
						sessionLorebookId,
						resolvedPersonaId
					)
				} catch (e) {
					errors.push(`${label}: ${importFailureSentence(e, label)}`)
					stats.errors++
				}
			}

			// ── Phase 5: SillyTavern group chats → group sessions ───────────────
			for (const groupItem of selectedData.groupSessions) {
				const label = `Group session "${groupItem.name}"`
				try {
					// Re-read group JSON to get the id of its chat file
					const groupPath = resolveSafePath(
						path.join(dataDir, SILLYTAVERN_DIRS.groups),
						groupItem.filename
					)
					const groupData = (await readStagedJson(
						groupPath,
						"This SillyTavern group file"
					)) as SillyTavernGroup

					const memberIds: (number | null)[] = await Promise.all(
						groupItem.memberNames.map(
							async (name) =>
								characterNameToId.get(name) ??
								(await findCharacterId(name))
						)
					)

					// The group's chat history is parsed before the session is
					// made, so its world_info can pick the book. SillyTavern
					// names the file after the group's CURRENT chat,
					// `group chats/<chat_id>.jsonl` — not the group's own id,
					// which only matches for a group made before `chat_id`
					// existed. Both come from parsed JSON content, not
					// re-validated like groupItem.filename above, so they need
					// the same traversal guard before being used in a path.
					const groupChatId =
						groupData.chat_id ||
						groupData.id ||
						groupItem.filename.replace(".json", "")
					const groupChatFile = resolveSafePath(
						path.join(dataDir, SILLYTAVERN_DIRS.groupChats),
						`${groupChatId}.jsonl`
					)
					// Null when the group has no history file yet; a damaged
					// one is this item's failure, never an empty group.
					const groupParsed = await parseSillyTavernChatFile(groupChatFile)
					if (groupParsed)
						assertWithinBulkImportLimit(
							groupParsed.messages.length,
							label
						)

					const groupWorldInfoName =
						groupData.chat_metadata?.world_info ??
						groupParsed?.header.chat_metadata?.world_info ??
						null
					const groupLorebookId = groupWorldInfoName
						? await findLorebookId(groupWorldInfoName)
						: null

					// Persona link: resolve from history header user_name, fall
					// back to default — a group with no history gets one too.
					const groupPersonaName =
						groupParsed?.header.user_name ?? null
					const groupPersonaId = groupPersonaName
						? (personaNameToId.get(groupPersonaName) ??
							(await findPersonaId(groupPersonaName)))
						: null
					const resolvedGroupPersonaId =
						groupPersonaId ?? defaultPersona?.id ?? null
					const groupLine = await importedSessionLine(groupLorebookId)
					// The group chat's Author's Note (AN1), as a solo chat's.
					const groupNote = authorsNoteFromChatMetadata(
						groupParsed?.header.chat_metadata?.note_prompt
							? groupParsed.header.chat_metadata
							: groupData.chat_metadata
					)

					// Whole or not at all, as a solo session.
					const newSession = await db.transaction(async (tx) => {
						const [row] = await tx
							.insert(schema.sessions)
							.values({
								userId,
								name: groupItem.name,
								isGroup: true,
								lorebookId: groupLorebookId,
								...(groupNote
									? { genreFields: { authorsNote: groupNote.note } }
									: {}),
								...groupLine
							})
							.returning()
						const members = groupItem.memberNames
							.map((_, i) => ({
								sessionId: row.id,
								characterId: memberIds[i],
								position: i
							}))
							.filter(
								(m): m is typeof m & { characterId: number } =>
									!!m.characterId
							)
						if (members.length)
							await tx.insert(schema.sessionCharacters).values(members)
						if (resolvedGroupPersonaId) {
							await tx.insert(schema.sessionPersonas).values({
								sessionId: row.id,
								personaId: resolvedGroupPersonaId
							})
						}
						if (groupParsed)
							await insertImportedHistory(
								tx,
								row.id,
								userId,
								groupParsed.messages,
								(msg) =>
									memberIds[groupItem.memberNames.indexOf(msg.name)] ??
									null
							)
						return row
					})
					stats.sessions++

					// The group's activation strategy, as a rebind of the
					// session's speaker node (2026-09-21) — only `manual` is
					// one; the rest inherit round robin. After the session is
					// in: a rebind that fails leaves round robin, and says so.
					const importedStrategy = mapGroupReplyStrategy(
						groupData.activation_strategy
					)
					if (importedStrategy) {
						try {
							// The Turn order control is a rebind of the
							// session genre's turn-order spec's `strategy`
							// node (R27, R28), found in core-catalog's table
							// — never a slug built here.
							const [{ setSessionNodeRebind }, { TURN_ORDER_BY_GENRE }] =
								await Promise.all([
									import("$lib/server/pipelines/entities/bindings"),
									import("@serene-pub/core-catalog")
								])
							const turnOrder = TURN_ORDER_BY_GENRE.find(
								(t) => t.genre.id === newSession.genreId
							)
							if (turnOrder)
								await setSessionNodeRebind(db, {
									sessionId: newSession.id,
									userId,
									spec: turnOrder.spec,
									nodeKey: turnOrder.strategyNode,
									definitionId: importedStrategy
								})
						} catch (e) {
							warnings.push(
								`${label} was imported, but it takes turns in order rather than its SillyTavern setting: ${importFailureSentence(e, `${label}'s turn order`)}`
							)
						}
					}
					if (groupNote?.importNote)
						warnings.push(`${label} was imported, but ${groupNote.importNote}.`)
					await afterSessionImported(
						label,
						newSession.id,
						groupLorebookId,
						resolvedGroupPersonaId
					)
				} catch (e) {
					errors.push(`${label}: ${importFailureSentence(e, label)}`)
					stats.errors++
				}
			}

			await finishMadeBooks()

			const r: Sockets.Import.SillyTavern.Execute.Response = {
				success: true,
				conclusion: !landedAny(stats)
					? "nothing"
					: stats.errors
						? "partial"
						: "complete",
				message: importSummary(stats),
				errors: errors.length ? errors : undefined,
				warnings: warnings.length ? warnings : undefined
			}
			await cleanupImportSession(importSessionId)
			emitToUser("import:sillytavern:execute", r)
			return r
		} catch (error) {
			const sentence = importFailureSentence(
				error,
				"SillyTavern import"
			)
			// The books that landed before the stop are finished all the same.
			await finishMadeBooks()
			await cleanupImportSession(importSessionId)
			// What landed before the stop is in: say so, and why it stopped —
			// apart from the items that failed, which `errors` counts.
			const r: Sockets.Import.SillyTavern.Execute.Response = landedAny(stats)
				? {
						success: true,
						conclusion: "stopped",
						message: importSummary(stats),
						stoppedBecause: sentence,
						errors: errors.length ? errors : undefined,
						warnings: warnings.length ? warnings : undefined
					}
				: { success: false, error: sentence }
			emitToUser("import:sillytavern:execute", r)
			return r
		}
	}
}

/**
 * A chat's history, as rows of one session, in batches inside the session's
 * transaction (plan A13): the order is the file's, so ids follow it.
 * `characterOf` names who spoke a character's line.
 */
async function insertImportedHistory(
	tx: Db,
	sessionId: number,
	userId: number,
	messages: ImportedChatMessage[],
	characterOf: (msg: ImportedChatMessage) => number | null
): Promise<void> {
	const rows = messages
		.filter((msg) => !msg.is_system)
		.map((msg) => {
			const metadata: Record<string, any> = {}
			if (msg.swipes && msg.swipes.length > 1) {
				metadata.swipes = {
					currentIdx: msg.swipe_id ?? 0,
					history: msg.swipes
				}
			}
			return {
				sessionId,
				userId,
				characterId: msg.is_user ? null : characterOf(msg),
				role: msg.is_user ? "user" : "character",
				content: msg.mes,
				metadata,
				createdAt: normalizeTimestamp(msg.send_date)
					.toISOString()
					.split("T")[0]
			}
		})
	for (let i = 0; i < rows.length; i += HISTORY_INSERT_BATCH)
		await insertLegacyMany(tx, rows.slice(i, i + HISTORY_INSERT_BATCH))
}

/** One line of a parsed SillyTavern chat file. */
type ImportedChatMessage = NonNullable<
	Awaited<ReturnType<typeof parseSillyTavernChatFile>>
>["messages"][number]

/** Messages one INSERT writes on a SillyTavern import (plan A13). */
const HISTORY_INSERT_BATCH = 500

/** Whether anything an import counts landed (sprites ride on a character). */
function landedAny(stats: {
	characters: number
	personas: number
	sessions: number
	lorebooks: number
}): boolean {
	return stats.characters + stats.personas + stats.sessions + stats.lorebooks > 0
}

/**
 * The line an imported session reads its book on — the columns
 * `sessionLinePatch` gives a session made here (the book's most recently
 * used line) — read before the session's transaction, which may use only
 * its own handle.
 */
async function importedSessionLine(
	lorebookId: number | null
): Promise<Partial<typeof schema.sessions.$inferInsert>> {
	if (!lorebookId) return {}
	const { sessionLinePatch } = await import("./sessions")
	// Names no clock and brings no stats, so it checks no date and needs
	// no lock.
	return sessionLinePatch(db, { before: null, lorebookId })
}

/** "Imported 3 characters, 2 sprites, …", or that nothing was. */
function importSummary(stats: {
	characters: number
	sprites: number
	personas: number
	sessions: number
	lorebooks: number
	errors: number
}): string {
	const parts: string[] = []
	const count = (n: number, one: string) =>
		n ? parts.push(`${n} ${one}${n !== 1 ? "s" : ""}`) : 0
	count(stats.characters, "character")
	count(stats.sprites, "sprite")
	count(stats.personas, "persona")
	count(stats.sessions, "session")
	count(stats.lorebooks, "lorebook")
	return parts.length
		? `Imported ${parts.join(", ")}.${stats.errors ? ` ${stats.errors} item(s) had errors.` : ""}`
		: "Nothing was imported."
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
