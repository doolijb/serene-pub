import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { generateSummary } from "$lib/server/utils/summarizer"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { resolveTaskConfig } from "$lib/server/utils/resolveTaskConfig"

/**
 * Find an existing lorebook binding for the given character or persona, or create
 * a new one with an auto-incremented binding string (e.g. {{char:3}}).
 */
async function resolveOrCreateBinding({
	lorebookId,
	characterId,
	personaId
}: {
	lorebookId: number
	characterId?: number | null
	personaId?: number | null
}): Promise<number> {
	if (!characterId && !personaId) throw new Error("characterId or personaId required")

	// Check for an existing binding
	const existing = await db.query.lorebookBindings.findFirst({
		where: characterId
			? and(eq(schema.lorebookBindings.lorebookId, lorebookId), eq(schema.lorebookBindings.characterId, characterId))
			: and(eq(schema.lorebookBindings.lorebookId, lorebookId), eq(schema.lorebookBindings.personaId, personaId!))
	})
	if (existing) return existing.id

	// Auto-generate next binding string
	const allBindings = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebookId)
	})
	let maxNum = 0
	for (const b of allBindings) {
		const match = b.binding.match(/\{\{char:(\d+)\}\}/)
		if (match) {
			const n = parseInt(match[1], 10)
			if (n > maxNum) maxNum = n
		}
	}
	const bindingStr = `{{char:${maxNum + 1}}}`

	const [created] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: bindingStr, characterId: characterId ?? null, personaId: personaId ?? null })
		.returning()
	return created.id
}

export const chatsSummarizeHandler: Handler<
	Sockets.Chats.Summarize.Params,
	Sockets.Chats.Summarize.Response
> = {
	event: "chats:summarize",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { chatId, messageIds, loreType, topic, lorebookBindingCharacterId, lorebookBindingPersonaId } = params

		// Verify the user owns the chat
		const chat = await db.query.chats.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.id, chatId), eq(c.userId, userId))
		})

		if (!chat) {
			throw new Error("Chat not found or access denied.")
		}

		// Guard: chat must have a lorebook attached
		if (!chat.lorebookId) {
			emitToUser("chats:summarize:error", {
				reason: "no_lorebook",
				error: "This chat has no lorebook attached. Please attach or create one first."
			})
			return null as any
		}

		// Fetch the specified messages in order
		const whereClause =
			messageIds === "all"
				? and(
						eq(schema.chatMessages.chatId, chatId),
						eq(schema.chatMessages.isHidden, false)
					)
				: and(
						eq(schema.chatMessages.chatId, chatId),
						inArray(schema.chatMessages.id, messageIds)
					)

		const rawMessages = await db.query.chatMessages.findMany({
			where: whereClause,
			orderBy: (cm, { asc }) => asc(cm.id)
		})

		if (rawMessages.length === 0) {
			throw new Error("No messages found to summarize.")
		}

		// Collect unique character and persona IDs from messages
		const charIds = [...new Set(rawMessages.filter((m) => m.characterId).map((m) => m.characterId!))]
		const personaIds = [...new Set(rawMessages.filter((m) => m.personaId).map((m) => m.personaId!))]

		// Fetch names directly from the entity tables
		const characters = charIds.length > 0
			? await db.query.characters.findMany({ where: inArray(schema.characters.id, charIds) })
			: []
		const personas = personaIds.length > 0
			? await db.query.personas.findMany({ where: inArray(schema.personas.id, personaIds) })
			: []

		const characterMap = new Map(characters.map((c) => [c.id, c.name]))
		const personaMap = new Map(personas.map((p) => [p.id, (p as any).nickname ?? p.name]))

		const messages = rawMessages.map((msg) => {
			let senderName = "Unknown"
			if (msg.characterId && characterMap.has(msg.characterId)) {
				senderName = characterMap.get(msg.characterId)!
			} else if (msg.personaId && personaMap.has(msg.personaId)) {
				senderName = personaMap.get(msg.personaId)!
			} else if (msg.role === "user") {
				senderName = "User"
			}
			return { senderName, content: msg.content }
		})

		// Get context/prompt configs (connection+sampling resolved per sub-task below)
		const { contextConfig, promptConfig } = await getUserConfigurations(userId)

		const systemSettings = await db.query.systemSettings.findFirst()
		const userSettings = await db.query.userSettings.findFirst({ where: (us, { eq }) => eq(us.userId, userId) })

		// Determine which summarize config to use
		const summarizeConfigType = loreType === "world" ? "world" : loreType === "character" ? "character" : "scene"
		const summarizeConfigId =
			loreType === "world"
				? (userSettings?.activeSummarizeWorldConfigId ?? systemSettings?.defaultSummarizeWorldConfigId)
				: loreType === "character"
					? (userSettings?.activeSummarizeCharacterConfigId ?? systemSettings?.defaultSummarizeCharacterConfigId)
					: (userSettings?.activeSummarizeSceneConfigId ?? systemSettings?.defaultSummarizeSceneConfigId)

		let summarizePromptConfig: { batchSystemPrompt: string; synthSystemPrompt: string; nameSystemPrompt: string; characterExtractionSystemPrompt?: string | null } | null = null
		if (summarizeConfigId) {
			if (loreType === "world") summarizePromptConfig = await db.query.worldSummarizeConfigs.findFirst({ where: (c, { eq }) => eq(c.id, summarizeConfigId) }) ?? null
			else if (loreType === "character") summarizePromptConfig = await db.query.characterSummarizeConfigs.findFirst({ where: (c, { eq }) => eq(c.id, summarizeConfigId) }) ?? null
			else summarizePromptConfig = await db.query.sceneSummarizeConfigs.findFirst({ where: (c, { eq }) => eq(c.id, summarizeConfigId) }) ?? null
		}

		// Resolve per-sub-task connection + sampling
		const [batchResolved, synthResolved, nameResolved] = await Promise.all([
			resolveTaskConfig({ taskType: "summarize_batch", summarizeConfigId, summarizeConfigType }),
			resolveTaskConfig({ taskType: "summarize_synth", summarizeConfigId, summarizeConfigType }),
			resolveTaskConfig({ taskType: "summarize_name", summarizeConfigId, summarizeConfigType })
		])

		if (!batchResolved.connection) {
			throw new Error("No AI connection configured. Please set up a connection first.")
		}

		// Run iterative summarization, streaming progress back to client
		const result = await generateSummary({
			messages,
			loreType,
			topic,
			connection: batchResolved.connection,
			sampling: batchResolved.sampling!,
			contextConfig,
			promptConfig,
			summarizePromptConfig,
			batchConnection: batchResolved.connection,
			batchSampling: batchResolved.sampling,
			synthConnection: synthResolved.connection,
			synthSampling: synthResolved.sampling,
			nameConnection: nameResolved.connection,
			nameSampling: nameResolved.sampling,
			onProgress: (data) => {
				emitToUser("chats:summarize:progress", data satisfies Sockets.Chats.Summarize.Progress)
			},
			onLlmCall: (entry) => {
				emitToUser("chats:summarize:trace", entry satisfies Sockets.Chats.Summarize.TraceEntry)
			}
		})

		// For character lore, resolve or create the lorebook binding
		let lorebookBindingId: number | null = null
		if (loreType === "character" && (lorebookBindingCharacterId || lorebookBindingPersonaId)) {
			lorebookBindingId = await resolveOrCreateBinding({
				lorebookId: chat.lorebookId!,
				characterId: lorebookBindingCharacterId,
				personaId: lorebookBindingPersonaId
			})
		}

		const response: Sockets.Chats.Summarize.Response = {
			content: result.content ?? result.raw,
			name: result.name,
			raw: result.raw,
			lorebookId: chat.lorebookId!,
			batchCount: result.batchCount,
			lorebookBindingId,
			participantCharacters: result.participantCharacters,
			mentionedCharacters: result.mentionedCharacters
		}

		emitToUser("chats:summarize:complete", response)
		return response
	}
}

export const chatsSetLorebookHandler: Handler<
	Sockets.Chats.SetLorebook.Params,
	Sockets.Chats.SetLorebook.Response
> = {
	event: "chats:setLorebook",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { chatId, lorebookId } = params

		// Verify ownership
		const chat = await db.query.chats.findFirst({
			where: (c, { and, eq }) => and(eq(c.id, chatId), eq(c.userId, userId))
		})

		if (!chat) {
			throw new Error("Chat not found or access denied.")
		}

		// If attaching a lorebook, verify the user owns it
		if (lorebookId !== null) {
			const lorebook = await db.query.lorebooks.findFirst({
				where: (l, { and, eq }) =>
					and(eq(l.id, lorebookId), eq(l.userId, userId))
			})
			if (!lorebook) {
				throw new Error("Lorebook not found or access denied.")
			}
		}

		const [updated] = await db
			.update(schema.chats)
			.set({ lorebookId })
			.where(eq(schema.chats.id, chatId))
			.returning()

		const response: Sockets.Chats.SetLorebook.Response = { chat: updated }
		emitToUser("chats:setLorebook", response)
		return response
	}
}

export function registerSummarizeHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, chatsSummarizeHandler, emitToUser)
	register(socket, chatsSetLorebookHandler, emitToUser)
}
