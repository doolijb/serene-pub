import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
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
import { activityStore } from "$lib/server/utils/activityStore"

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

		// Register the activity BEFORE the lock. The lock is FIFO, so a
		// summarize started during an in-flight generation waits that
		// generation out — without a card first, the user sees nothing at all,
		// and cancelling during the wait is unreachable. Same reasoning as
		// scenes:process. The per-chat-per-type supersede/reject rule lives in
		// startChatSummarize; it replaces the old inFlightSummarizeChatIds set,
		// which was per-chat and so made a world-lore run block a character one.
		const abortController = new AbortController()
		const activityId = activityStore.startChatSummarize(
			{
				userId,
				chatId,
				chatLabel: chat.name ?? undefined,
				loreType: loreType as "world" | "character",
				lorebookId: chat.lorebookId!,
				topic: topic || undefined
			},
			abortController
		)

		/** Terminalise the activity alongside the error event. */
		const failRun = (
			error: string,
			reason: Sockets.Chats.Summarize.ErrorResponse["reason"] = "generation_failed"
		) => {
			activityStore.updateChatSummarize(activityId, {
				status: "error",
				errorMessage: error
			})
			emitToUser("chats:summarize:error", {
				reason,
				error
			} satisfies Sockets.Chats.Summarize.ErrorResponse)
			return null as any
		}

		return await (async () => {
			try {
				// Snapshot inside the lock, LLM outside it.
				//
				// This read is the only chat-state-dependent step —
				// generateSummary performs no DB access at all — so holding the
				// lock across the whole pipeline (as this handler used to)
				// would queue the user's next message behind minutes of LLM
				// calls. That is exactly the trap a minimize-first flow must
				// not set. Same scoping as scenes:process.
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

				const rawMessages = await withChatTriggerLock(
					chatId,
					async () =>
						db.query.chatMessages.findMany({
							where: whereClause,
							orderBy: (cm, { asc }) => asc(cm.id)
						})
				)

				if (abortController.signal.aborted) return null as any

				if (rawMessages.length === 0) {
					return failRun("No messages found to summarize.")
				}

				// Distinct senders, for the scene participant guarantee below.
				// Sender-name resolution itself moved into the pipeline's
				// `summarize_source` read — one place, same mapping.
				const charIds = [
					...new Set(
						rawMessages
							.filter((m) => m.characterId)
							.map((m) => m.characterId!)
					)
				]
				const personaIds = [
					...new Set(
						rawMessages
							.filter((m) => m.personaId)
							.map((m) => m.personaId!)
					)
				]

				// For a fresh scene draft, build the lorebook's known cast *before*
				// generation — no sceneId exists yet (scenes:create hasn't run), so
				// the cast list is built untimelined (see buildSceneCastList's
				// null-sceneId handling). This must reach the extraction prompt
				// itself (via the request the pipeline carries to its cast step),
				// not just the post-hoc resolve step — otherwise the model has no
				// [id: N] list to reference and the resolve step silently drops
				// every castId it hallucinates in response to the output
				// contract's example.
				const knownCast =
					loreType === "scene"
						? await buildSceneCastList(
								null,
								chat.lorebookId!,
								chatId
							)
						: undefined

				/**
				 * The summarize pipeline for this lore type — its own namespace,
				 * with its own prompts, connections and sampling per step, all
				 * resolved through the pipeline config layer rather than the
				 * legacy `*_summarize_configs` tables.
				 *
				 * The run stops **before** its `save` consumer, deliberately:
				 * this handler has never written the entry. What it produces is
				 * a pending result a person reviews in the modal and saves — the
				 * same stop-at-review rule the graph build's proposal encodes
				 * structurally.
				 */
				const { runSpec } = await import(
					"$lib/server/pipelines/runTurn"
				)
				const specsModule = await import(
					"$lib/server/pipelines/specs/summarize"
				)
				const specId =
					loreType === "world"
						? specsModule.SUMMARIZE_WORLD_SPEC_ID
						: loreType === "character"
							? specsModule.SUMMARIZE_CHARACTER_SPEC_ID
							: loreType === "scene"
								? specsModule.SUMMARIZE_SCENE_SPEC_ID
								: specsModule.SUMMARIZE_HISTORY_SPEC_ID

				// Coarse progress from step labels. The pipeline owns batching,
				// so the total is not known up front; the count ticking upward
				// is still an honest "it is working, this far along".
				let batchesSeen = 0
				const progress = (data: Sockets.Chats.Summarize.Progress) => {
					activityStore.updateChatSummarize(activityId, {
						phase: data.phase,
						batch: data.batch,
						totalBatches: data.totalBatches
					})
					emitToUser("chats:summarize:progress", data)
				}

				const receipt = await runSpec({
					db,
					chatId,
					userId,
					specId,
					input: {
						scope: { chatId },
						request: {
							topic: topic || undefined,
							messageIds:
								messageIds === "all" ? undefined : messageIds,
							knownCast
						}
					},
					signal: abortController.signal,
					preview: { atNode: "save" },
					// The executor's inherent node events (F34): identity in,
					// progress card out — no per-trigger wiring, no dispatch
					// labels, and a plugin's summarize pipeline gets the same
					// card for free.
					onNode: (e) => {
						if (e.phase !== "start") return
						if (
							e.typeId.startsWith("core:provider/summarize-batch")
						)
							progress({
								phase: "drafting",
								partial: {},
								batch: ++batchesSeen,
								totalBatches: batchesSeen
							})
						else if (
							e.typeId.startsWith("core:provider/summarize-synth")
						)
							progress({
								phase: "synthesizing",
								partial: {},
								batch: 1,
								totalBatches: 1
							})
						else if (
							e.typeId.startsWith("core:provider/name-entry")
						)
							progress({
								phase: "naming",
								partial: {},
								batch: 1,
								totalBatches: 1
							})
						else if (
							e.typeId.startsWith("core:provider/extract-cast")
						)
							progress({
								phase: "extracting",
								partial: {},
								batch: 1,
								totalBatches: 1
							})
					}
				})

				const nodeOut = (key: string) =>
					(receipt.nodes.find((n: any) => n.nodeKey === key) as any)
						?.output
				const content: string | undefined = nodeOut("synth")?.content
				const entryName: string | undefined = nodeOut("naming")?.name
				const castOut = nodeOut("cast")?.cast

				if (!content) {
					const why =
						receipt.haltReason ??
						"the pipeline stopped without producing a summary"
					return failRun(
						receipt.haltNodeKey
							? `${why} (at '${receipt.haltNodeKey}')`
							: why
					)
				}

				const result = {
					content,
					name: entryName,
					raw: content,
					batchCount: receipt.nodes.filter((n: any) =>
						String(n.typeId ?? "").startsWith(
							"core:provider/summarize-batch"
						)
					).length,
					participantCharacters: castOut?.participants as
						| any[]
						| undefined,
					mentionedCharacters: castOut?.mentioned as any[] | undefined
				}

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

				// A cooperating abort can let the call above resolve normally with
				// a truncated result rather than throw — bail before parking a
				// partial summary in the activity as if it were finished.
				if (abortController.signal.aborted) return null as any

				// Park the result on the activity, not just the socket event.
				// This is the only copy until the user saves, so it has to
				// survive the modal closing.
				activityStore.updateChatSummarize(activityId, {
					status: "review",
					pendingResult: {
						content: response.content,
						name: response.name,
						raw: response.raw,
						lorebookBindingId
					}
				})

				emitToUser("chats:summarize:complete", {
					...response,
					activityId
				})
				return response
			} catch (err) {
				// Narrower than it looks, matching scenes.ts: activityStore
				// .cancel() aborts our controller synchronously, so
				// signal.aborted is already true for any exception that is
				// genuinely our own cancellation — and that path has already
				// removed the activity.
				if (abortController.signal.aborted) return null as any
				activityStore.updateChatSummarize(activityId, {
					status: "error",
					errorMessage:
						err instanceof Error ? err.message : "Unknown error"
				})
				throw err
			}
		})()
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
