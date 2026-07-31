import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { generateSummary } from "$lib/server/utils/summarizer"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { resolveTaskConfig } from "$lib/server/utils/resolveTaskConfig"
import { resolveOrCreateBinding } from "$lib/server/utils/characterBindingSync"
import {
	buildSceneCastList,
	reconcileParticipantsAndMentioned,
	reconcileSuggestedNames,
	resolveCharacterRefs
} from "$lib/server/utils/summarizer/availableSceneCast"
import { lorebookBindingListHandler } from "./lorebooks"
import { withChatTriggerLock } from "$lib/server/utils/chatTriggerLock"
import { checkChatAccess } from "$lib/server/utils/chatAccess"

// Reject-fast dedup for chatsSummarizeHandler — withChatTriggerLock alone
// only serializes (queues) a second concurrent request for the same chat;
// each run here is a full batch+synthesis LLM pipeline, so a double-click
// or multiple tabs should be rejected outright, not silently re-run right
// after the first finishes.
const inFlightSummarizeChatIds = new Set<number>()

export const chatsSummarizeHandler: Handler<
	Sockets.Chats.Summarize.Params,
	Sockets.Chats.Summarize.Response
> = {
	event: "chats:summarize",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const {
			chatId,
			messageIds,
			loreType,
			topic,
			lorebookBindingCharacterId,
			lorebookBindingPersonaId
		} = params

		// topic is re-interpolated into every batch prompt plus the synthesis
		// prompt, so an oversized value multiplies LLM cost by batch count
		// with no cap otherwise — this is the one check that actually
		// matters, since it's reachable by a raw socket emit regardless of
		// the client's own maxlength.
		if (topic && topic.length > 300) {
			throw new Error("Topic must be 300 characters or fewer.")
		}

		// Verify the user owns the chat — shared helper, not an ad-hoc
		// reimplementation (see chatAccess.ts's own comment: a local
		// eq(chats.userId, userId)-only check is exactly how a guest-lockout
		// bug happened here before).
		const chatAccess = await checkChatAccess(chatId, userId)
		if (!chatAccess.isOwner) {
			throw new Error("Chat not found or access denied.")
		}
		const chat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, chatId)
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

		// Serializes against Regenerate/Continue/SwipeRight etc. on this same
		// chat (withChatTriggerLock, same lock chats.ts's generation handlers
		// use), and rejects a second concurrent chats:summarize for this chat
		// outright rather than queuing it to run again right after the first
		// finishes — each run is a full batch+synthesis LLM pipeline, not
		// something a double-click/multiple tabs should silently multiply.
		if (inFlightSummarizeChatIds.has(chatId)) {
			throw new Error("A summarization is already running for this chat.")
		}
		inFlightSummarizeChatIds.add(chatId)
		return await withChatTriggerLock(chatId, async () => {
			try {

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
				const charIds = [
					...new Set(
						rawMessages
							.filter((m) => m.characterId)
							.map((m) => m.characterId!)
					)
				]
				const personaIds = [
					...new Set(
						rawMessages.filter((m) => m.personaId).map((m) => m.personaId!)
					)
				]

				// Fetch names directly from the entity tables
				const characters =
					charIds.length > 0
						? await db.query.characters.findMany({
								where: inArray(schema.characters.id, charIds)
							})
						: []
				const personas =
					personaIds.length > 0
						? await db.query.personas.findMany({
								where: inArray(schema.personas.id, personaIds)
							})
						: []

				const characterMap = new Map(characters.map((c) => [c.id, c.name]))
				const personaMap = new Map(
					personas.map((p) => [p.id, resolvePersonaName(p)])
				)

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
				const { contextConfig, promptConfig } =
					await getUserConfigurations(userId)

				const systemSettings = await db.query.systemSettings.findFirst()
				const userSettings = await db.query.userSettings.findFirst({
					where: (us, { eq }) => eq(us.userId, userId)
				})

				// Determine which summarize config to use
				const summarizeConfigType =
					loreType === "world"
						? "world"
						: loreType === "character"
							? "character"
							: "scene"
				const summarizeConfigId =
					loreType === "world"
						? (userSettings?.activeSummarizeWorldConfigId ??
							systemSettings?.defaultSummarizeWorldConfigId)
						: loreType === "character"
							? (userSettings?.activeSummarizeCharacterConfigId ??
								systemSettings?.defaultSummarizeCharacterConfigId)
							: (userSettings?.activeSummarizeSceneConfigId ??
								systemSettings?.defaultSummarizeSceneConfigId)

				let summarizePromptConfig: {
					batchSystemPrompt: string
					synthSystemPrompt: string
					nameSystemPrompt: string
					characterExtractionSystemPrompt?: string | null
				} | null = null
				if (summarizeConfigId) {
					if (loreType === "world")
						summarizePromptConfig =
							(await db.query.worldSummarizeConfigs.findFirst({
								where: (c, { eq }) => eq(c.id, summarizeConfigId)
							})) ?? null
					else if (loreType === "character")
						summarizePromptConfig =
							(await db.query.characterSummarizeConfigs.findFirst({
								where: (c, { eq }) => eq(c.id, summarizeConfigId)
							})) ?? null
					else
						summarizePromptConfig =
							(await db.query.sceneSummarizeConfigs.findFirst({
								where: (c, { eq }) => eq(c.id, summarizeConfigId)
							})) ?? null
				}

				// Resolve per-sub-task connection + sampling
				const [batchResolved, synthResolved, nameResolved] = await Promise.all([
					resolveTaskConfig({
						taskType: "summarize_batch",
						summarizeConfigId,
						summarizeConfigType
					}),
					resolveTaskConfig({
						taskType: "summarize_synth",
						summarizeConfigId,
						summarizeConfigType
					}),
					resolveTaskConfig({
						taskType: "summarize_name",
						summarizeConfigId,
						summarizeConfigType
					})
				])

				if (!batchResolved.connection) {
					throw new Error(
						"No AI connection configured. Please set up a connection first."
					)
				}

				// For a fresh scene draft, build the lorebook's known cast *before*
				// generation — no sceneId exists yet (scenes:create hasn't run), so
				// the cast list is built untimelined (see buildSceneCastList's
				// null-sceneId handling). This must reach the extraction prompt
				// itself (via generateSummary's knownCast option below), not just
				// the post-hoc resolve step — otherwise the model has no [id: N]
				// list to reference and the resolve step silently drops every
				// castId it hallucinates in response to the output contract's
				// example (see the plan for this fix).
				const knownCast =
					loreType === "scene"
						? await buildSceneCastList(null, chat.lorebookId!, chatId)
						: undefined

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
					knownCast,
					batchConnection: batchResolved.connection,
					batchSampling: batchResolved.sampling,
					synthConnection: synthResolved.connection,
					synthSampling: synthResolved.sampling,
					nameConnection: nameResolved.connection,
					nameSampling: nameResolved.sampling,
					onProgress: (data) => {
						emitToUser(
							"chats:summarize:progress",
							data satisfies Sockets.Chats.Summarize.Progress
						)
					},
					onLlmCall: (entry) => {
						emitToUser(
							"chats:summarize:trace",
							entry satisfies Sockets.Chats.Summarize.TraceEntry
						)
					}
				})

				// For character lore, resolve or create the lorebook binding
				let lorebookBindingId: number | null = null
				if (
					loreType === "character" &&
					(lorebookBindingCharacterId || lorebookBindingPersonaId)
				) {
					lorebookBindingId = await resolveOrCreateBinding({
						lorebookId: chat.lorebookId!,
						characterId: lorebookBindingCharacterId,
						personaId: lorebookBindingPersonaId
					})
				}

				let participantCharacters: number[] | undefined
				let mentionedCharacters: number[] | undefined
				let suggestedParticipantCharacters: string[] | undefined
				let suggestedMentionedCharacters: string[] | undefined
				if (loreType === "scene") {
					const participants = resolveCharacterRefs(
						result.participantCharacters ?? [],
						knownCast!
					)
					const mentioned = resolveCharacterRefs(
						result.mentionedCharacters ?? [],
						knownCast!
					)
					participantCharacters = participants.ids
					mentionedCharacters = mentioned.ids
					;({
						participants: suggestedParticipantCharacters,
						mentioned: suggestedMentionedCharacters
					} = reconcileSuggestedNames(
						participants.suggestedNames,
						mentioned.suggestedNames
					))

					// Guarantee: whoever actually sent a message in this range is a
					// participant, regardless of what the extraction LLM decided —
					// charIds/personaIds (every distinct sender) were already
					// computed above for building sender names.
					const senderBindingIds = new Set<number>()
					for (const characterId of charIds) {
						senderBindingIds.add(
							await resolveOrCreateBinding({
								lorebookId: chat.lorebookId!,
								characterId
							})
						)
					}
					for (const personaId of personaIds) {
						senderBindingIds.add(
							await resolveOrCreateBinding({
								lorebookId: chat.lorebookId!,
								personaId
							})
						)
					}

					;({
						participants: participantCharacters,
						mentioned: mentionedCharacters
					} = reconcileParticipantsAndMentioned(
						participantCharacters,
						mentionedCharacters,
						senderBindingIds
					))
				}

				// A new unbound "background" binding can still be minted above via
				// resolveOrCreateBinding for a message sender's first appearance in
				// this lorebook (unrelated to extraction — extracted-but-unmatched
				// names are now deferred suggestions, not eager rows) — push a fresh
				// list to the client now, before chats:summarize:complete, so the
				// modal's dropdown/chip names are warm.
				if (emitToUser) {
					await lorebookBindingListHandler.handler(
						socket,
						{ lorebookId: chat.lorebookId! },
						emitToUser
					)
				}

				const response: Sockets.Chats.Summarize.Response = {
					content: result.content ?? result.raw,
					name: result.name,
					raw: result.raw,
					lorebookId: chat.lorebookId!,
					batchCount: result.batchCount,
					lorebookBindingId,
					participantCharacters,
					mentionedCharacters,
					suggestedParticipantCharacters,
					suggestedMentionedCharacters
				}

				emitToUser("chats:summarize:complete", response)
				return response
			} finally {
				inFlightSummarizeChatIds.delete(chatId)
			}
		})
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

		// Verify ownership — shared helper, see chatsSummarizeHandler above.
		const chatAccess = await checkChatAccess(chatId, userId)
		if (!chatAccess.isOwner) {
			throw new Error("Chat not found or access denied.")
		}
		const chat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, chatId)
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
