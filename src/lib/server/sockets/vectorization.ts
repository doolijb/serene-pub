import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
import { and, eq, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	isModelReady,
	isModelCached,
	getLoadError,
	getEmbeddingLastUsedAt,
	getEmbeddingTtlMinutes,
	loadConfiguredEmbeddingModel,
	unloadEmbeddingModel
} from "$lib/server/embedding/index"
import { resolveEmbeddingTarget } from "$lib/server/embedding/target"
import { embeddingReindexCost } from "$lib/server/embedding/reindex"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { refusable } from "./refusable"
import {
	startVectorizationQueue,
	stopVectorization,
	isVectorizationRunning,
	registerProgressEmitter,
	unregisterProgressEmitter,
	registerOwnerEmitter,
	unregisterOwnerEmitter,
	countUnembedded,
	getPriorityQueue,
	getCompletedHistory,
	enqueueSessionGroup,
	enqueueLorebookGroup,
	enqueueCharacterGroup,
	moveQueueGroup,
	removeQueueGroup,
	clearVectorizationFailureTracking,
	clearInlineEmbedCooldown
} from "$lib/server/embedding/vectorizationQueue"
import { messageHasText } from "$lib/server/embedding/messageText"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count rows matching needsEmbedding for a given condition combo */
function needsEmbedding(
	embeddingCol: any,
	modelCol: any,
	currentModel: string
) {
	return or(isNull(embeddingCol), ne(modelCol, currentModel))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * What the embedding section shows: the catalogue, plus the state of whatever is
 * starred.
 *
 * ⚠ It no longer carries `vectorizationEnabled`, `mode`, `apiBaseUrl`,
 * `apiKey`, `apiModel` or `apiDimensions`. Those were the singleton's endpoint
 * halves, echoed to the client so a bespoke panel could edit them — the API key
 * IN PLAINTEXT, which the old comment defended as "admin-only exposure over the
 * wire, already an accepted tradeoff". An embedding endpoint is an ordinary
 * connection now, so its fields are edited through `connections:*` like every
 * other, and nothing has to put a secret on this event at all.
 *
 * What is left is exactly what only the SERVER knows: whether the backend is up.
 * The local catalogue is not here either — a local model is picked through
 * `ConnectionModels` like every other connection's, from the adapter's own
 * `listModels`. `activeConnectionId` is the star, so the client can tell "no
 * embeddings configured" from "configured and not loaded" without a second round
 * trip.
 */
async function buildEmbeddingModelState(): Promise<Sockets.Vectorization.ListModels.Response> {
	const target = await resolveEmbeddingTarget(db)
	const activeModelName = target?.modelId ?? null
	// `isModelCached` only means anything for a local HF model — a host has
	// nothing cached on disk, and readiness there comes entirely from
	// `isModelReady`.
	const cached =
		target?.mode === "local" && target.localModelName
			? await isModelCached(target.localModelName)
			: false

	return {
		activeConnectionId: target?.connectionId ?? null,
		activeModelName,
		modelReady: isModelReady(),
		modelCached: cached,
		loadError: getLoadError()
	}
}

export const vectorizationListModels: Handler<
	Sockets.Vectorization.ListModels.Params,
	Sockets.Vectorization.ListModels.Response
> = {
	event: "vectorization:listModels",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = await buildEmbeddingModelState()
		emitToUser("vectorization:listModels", res)
		return res
	}
}

/**
 * Bring the starred backend up now.
 *
 * The one verb that survives from the four this file used to have
 * (`enable`/`disable`/`setModel`/`setApiConfig`), and it is not a
 * CONFIGURATION verb — it configures nothing. Those four each wrote a column
 * and then loaded; choosing an endpoint is `connections:create`/`update` and
 * choosing WHICH one is `connections:setDefault`, so all that is left is
 * "the server restarted, load it again", which is the button the detail tab
 * shows when the model is not resident.
 */
export const vectorizationLoadModel: Handler<
	Sockets.Vectorization.LoadModel.Params,
	Sockets.Vectorization.LoadModel.Response
> = {
	event: "vectorization:loadModel",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// The download bar. A first local load pulls several hundred
			// megabytes, so the progress the loader already emits is forwarded
			// rather than dropped.
			await loadConfiguredEmbeddingModel((progress) => {
				emitToUser("vectorization:modelDownloadProgress", {
					modelId: progress.modelId,
					status: progress.status,
					percent: progress.percent
				} satisfies Sockets.Vectorization.ModelDownloadProgress.Response)
			})
		} catch (err: any) {
			const res: Sockets.Vectorization.LoadModel.Response = {
				success: false,
				error: err?.message ?? "Failed to load the embedding model"
			}
			emitToUser("vectorization:loadModel", res)
			return res
		}
		const res: Sockets.Vectorization.LoadModel.Response = { success: true }
		emitToUser("vectorization:loadModel", res)
		// LAZY (socket-interest plan, ruling 4): the refreshed model state is
		// a push nobody asked for, so the star read and the on-disk cache
		// check behind it are paid only where an embedding panel is open.
		await emitToUser("vectorization:listModels", () =>
			buildEmbeddingModelState()
		)
		return res
	}
}

/**
 * What switching the embedding star would cost, so the client can say it before
 * asking for a confirmation.
 *
 * A number the SERVER has to produce: it is a count across six stores, and the
 * client has no way to ask for it otherwise. Read on demand rather than ridden
 * along on `listModels`, because it is a count query and that event is polled.
 *
 * ⚠ No rate estimate rides with it. Nothing in the queue measures throughput —
 * there is no rolling rate anywhere in `vectorizationQueue` — and a
 * "roughly N minutes" invented here would be the one number on a
 * cost-disclosure screen that was made up.
 */
export const vectorizationReindexCost: Handler<
	Sockets.Vectorization.ReindexCost.Params,
	Sockets.Vectorization.ReindexCost.Response
> = {
	event: "vectorization:reindexCost",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		// Only a well-formed pair is priced as one; anything else is the
		// untargeted question rather than a guess at what was meant.
		const t = params?.target
		const e = t?.edit
		const edit =
			e && typeof e === "object"
				? {
						...(typeof e.baseUrl === "string"
							? { baseUrl: e.baseUrl }
							: {}),
						...(typeof e.model === "string"
							? { model: e.model }
							: {})
					}
				: undefined
		// A star names both halves; an edit names the connection, and the
		// model only when it renames one.
		const edits = !!edit && Object.keys(edit).length > 0
		const target =
			t &&
			Number.isInteger(t.connectionId) &&
			(Number.isInteger(t.modelId) || edits)
				? {
						connectionId: t.connectionId,
						...(Number.isInteger(t.modelId)
							? { modelId: t.modelId }
							: {}),
						...(edits ? { edit } : {})
					}
				: undefined
		const res: Sockets.Vectorization.ReindexCost.Response =
			await embeddingReindexCost(db, target)
		emitToUser("vectorization:reindexCost", res)
		return res
	}
}

export const vectorizationStartQueue: Handler<
	Sockets.Vectorization.StartQueue.Params,
	Sockets.Vectorization.StartQueue.Response
> = {
	event: "vectorization:startQueue",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await startVectorizationQueue()

		const res: Sockets.Vectorization.StartQueue.Response = { success: true }
		emitToUser("vectorization:startQueue", res)
		return res
	}
}

export const vectorizationStopQueue: Handler<
	Sockets.Vectorization.StopQueue.Params,
	Sockets.Vectorization.StopQueue.Response
> = {
	event: "vectorization:stopQueue",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		stopVectorization()

		const res: Sockets.Vectorization.StopQueue.Response = { success: true }
		emitToUser("vectorization:stopQueue", res)
		return res
	}
}

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

export const vectorizationGetQueue: Handler<
	Sockets.Vectorization.GetQueue.Params,
	Sockets.Vectorization.GetQueue.Response
> = {
	event: "vectorization:getQueue",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res: Sockets.Vectorization.GetQueue.Response = {
			queue: getPriorityQueue(),
			history: getCompletedHistory()
		}
		emitToUser("vectorization:getQueue", res)
		return res
	}
}

export const vectorizationAddToQueue: Handler<
	Sockets.Vectorization.AddToQueue.Params,
	Sockets.Vectorization.AddToQueue.Response
> = {
	event: "vectorization:addToQueue",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (params.sessionId != null) {
			await enqueueSessionGroup(params.sessionId)
		} else if (params.lorebookId != null) {
			// Fetch the lorebook name for the label
			const lb = await db.query.lorebooks.findFirst({
				where: eq(schema.lorebooks.id, params.lorebookId),
				columns: { name: true, userId: true }
			})
			const owner = lb?.userId
				? await db.query.users.findFirst({
						where: eq(schema.users.id, lb.userId),
						columns: { username: true, displayName: true }
					})
				: null
			const ownerDisplayName =
				owner?.displayName ?? owner?.username ?? "Unknown"
			enqueueLorebookGroup(
				params.lorebookId,
				lb?.name ?? `Lorebook #${params.lorebookId}`,
				ownerDisplayName
			)
		} else if (params.characterId != null) {
			const name =
				params.characterName ?? `Character #${params.characterId}`
			await enqueueCharacterGroup(params.characterId, name)
		}

		const res: Sockets.Vectorization.AddToQueue.Response = {
			success: true,
			queue: getPriorityQueue()
		}
		emitToUser("vectorization:addToQueue", res)
		return res
	}
}

export const vectorizationMoveQueueGroup: Handler<
	Sockets.Vectorization.MoveQueueGroup.Params,
	Sockets.Vectorization.MoveQueueGroup.Response
> = {
	event: "vectorization:moveQueueGroup",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		moveQueueGroup(params.groupId, params.direction)

		const res: Sockets.Vectorization.MoveQueueGroup.Response = {
			success: true,
			queue: getPriorityQueue()
		}
		emitToUser("vectorization:moveQueueGroup", res)
		return res
	}
}

export const vectorizationRemoveFromQueue: Handler<
	Sockets.Vectorization.RemoveFromQueue.Params,
	Sockets.Vectorization.RemoveFromQueue.Response
> = {
	event: "vectorization:removeFromQueue",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		removeQueueGroup(params.groupId)

		const res: Sockets.Vectorization.RemoveFromQueue.Response = {
			success: true,
			queue: getPriorityQueue()
		}
		emitToUser("vectorization:removeFromQueue", res)
		return res
	}
}

// ---------------------------------------------------------------------------
// RAG status check
// ---------------------------------------------------------------------------

export const vectorizationCheckRagStatus: Handler<
	Sockets.Vectorization.CheckRagStatus.Params,
	Sockets.Vectorization.CheckRagStatus.Response
> = {
	event: "vectorization:checkRagStatus",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			throw new Error(
				"Access denied. Session not found or no permission to access."
			)
		}
		// Who may hide the notice, the rule `setSessionRagIgnored` refuses by.
		const canHide = sessionAccess.isOwner

		// The star, which is both halves of what this used to ask two columns:
		// whether embeddings are on at all, and which model identity a row's
		// `embedding_model` has to equal to count as current.
		const target = await resolveEmbeddingTarget(db)
		const activeModelName = target?.modelId ?? null

		if (!activeModelName) {
			const res: Sockets.Vectorization.CheckRagStatus.Response = {
				applicable: false,
				lorebook: null,
				queueRunning: isVectorizationRunning(),
				activeModelName,
				ragIgnored: false,
				canHide
			}
			emitToUser("vectorization:checkRagStatus", res)
			return res
		}

		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, params.sessionId),
			columns: { lorebookId: true, metadata: true }
		})
		const ragIgnored = !!(session?.metadata as any)?.ragIgnored

		// The notice waits until a session is past ten messages.
		const totalMessages = await db.$count(
			schema.sessionMessages,
			eq(schema.sessionMessages.sessionId, params.sessionId)
		)
		if (Number(totalMessages) <= 10) {
			const res: Sockets.Vectorization.CheckRagStatus.Response = {
				applicable: false,
				lorebook: null,
				queueRunning: isVectorizationRunning(),
				activeModelName,
				ragIgnored,
				canHide
			}
			emitToUser("vectorization:checkRagStatus", res)
			return res
		}

		/**
		 * The entries of the session's own lorebook, and nothing else: what
		 * Search by meaning searches (`SEMANTIC_SEARCH_SOURCES`, over the one
		 * book `getSessionRagContext` scopes it to).
		 *
		 * ⚠ The queue embeds more than this — messages, the cast, personas,
		 * graph nodes, links, a cast member's own lorebook — and none of it is
		 * ever found by meaning. Counting it kept the notice up over a fully
		 * indexed lorebook, naming a backlog RAG was never waiting on.
		 *
		 * The vector is a row in another table, so `IS NULL` is "no
		 * default-space vector" and stale is "a vector whose model is not the
		 * active one".
		 */
		let lorebook: Sockets.Vectorization.RagTypeCounts | null = null
		if (session?.lorebookId) {
			const entryWhere = eq(
				schema.lorebookEntries.lorebookId,
				session.lorebookId
			)
			const countEntries = async (extra?: SQL) => {
				const [row] = await db
					.select({ n: sql<number>`count(*)` })
					.from(schema.lorebookEntries)
					.leftJoin(
						schema.lorebookEntryVectors,
						and(
							eq(
								schema.lorebookEntryVectors.entryId,
								schema.lorebookEntries.id
							),
							eq(
								schema.lorebookEntryVectors.vectorName,
								DEFAULT_VECTOR_NAME
							),
							eq(schema.lorebookEntryVectors.chunkIndex, 0)
						)
					)
					.where(extra ? and(entryWhere, extra) : entryWhere)
				return Number(row?.n ?? 0)
			}

			const [total, nullCount, staleCount] = await Promise.all([
				countEntries(),
				countEntries(isNull(schema.lorebookEntryVectors.entryId)),
				countEntries(
					and(
						isNotNull(schema.lorebookEntryVectors.entryId),
						ne(schema.lorebookEntryVectors.model, activeModelName)
					)
				)
			])
			lorebook = {
				total,
				nullCount,
				staleCount,
				readyCount: total - nullCount - staleCount
			}
		}

		const res: Sockets.Vectorization.CheckRagStatus.Response = {
			applicable: (lorebook?.total ?? 0) > 0,
			lorebook,
			queueRunning: isVectorizationRunning(),
			activeModelName,
			ragIgnored,
			canHide
		}
		emitToUser("vectorization:checkRagStatus", res)
		return res
	}
}

export const vectorizationSetSessionRagIgnored: Handler<
	Sockets.Vectorization.SetSessionRagIgnored.Params,
	Sockets.Vectorization.SetSessionRagIgnored.Response
> = refusable(
	"vectorization:setSessionRagIgnored",
	async (
		socket,
		params: Sockets.Vectorization.SetSessionRagIgnored.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		// A session-level setting, like the other session-level toggles gated to
		// owners only in sessionsUpdateHandler — guests see the notice, and do
		// not hide it for everyone else in the session (`canHide` keeps the
		// button from them). It hides the RAG notice and nothing else: Search
		// by meaning reads no `ragIgnored`.
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess || !sessionAccess.isOwner) {
			throw new Error(
				"Only the session's owner can hide or show this notice."
			)
		}

		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, params.sessionId),
			columns: { metadata: true }
		})

		const currentMeta = (session?.metadata as Record<string, any>) ?? {}
		await db
			.update(schema.sessions)
			.set({ metadata: { ...currentMeta, ragIgnored: params.ignored } })
			.where(eq(schema.sessions.id, params.sessionId))

		const res: Sockets.Vectorization.SetSessionRagIgnored.Response = {
			success: true,
			ragIgnored: params.ignored
		}
		emitToUser("vectorization:setSessionRagIgnored", res)
		return res
	},
	"The notice could not be hidden or shown."
)

// ---------------------------------------------------------------------------
// Residency
// ---------------------------------------------------------------------------

/**
 * The embedding lane's residency, for the endpoint header and the model view.
 *
 * Separate from `listModels` because the questions differ: that one answers
 * "what is configured and is it validated", this one answers "is the model in
 * memory right now, when was it last used, and how long until it idles out" —
 * the three facts an Unload button needs beside it.
 *
 * ⚠ `loaded` is BARE residency, not "the star is up". A model left resident
 * from a previous star is still occupying memory and is still what Unload would
 * free, so reporting it as not loaded would leave a button that does something
 * beside a line saying there is nothing to do. `listModels.modelReady` is the
 * star-compared question and is unchanged.
 */
async function buildVectorizationStatus(): Promise<Sockets.Vectorization.Status.Response> {
	const target = await resolveEmbeddingTarget(db)
	return {
		starred: target !== null,
		modelId: target?.modelId ?? null,
		loaded: isModelReady(),
		loadError: getLoadError(),
		lastUsedAt: getEmbeddingLastUsedAt(),
		// The starred connection's own window when there is one, and the value
		// the lane is actually armed with otherwise — the same order
		// `loadConfiguredEmbeddingModel` applies them in.
		ttlMinutes: target?.ttlMinutes ?? getEmbeddingTtlMinutes(),
		// What the queue still has to do under the identity now in force. A
		// row embedded by some other model counts as pending, which is what
		// makes this the number that falls to zero when the queue is done.
		pending: await countUnembedded(target?.modelId ?? undefined)
	}
}

export const vectorizationStatus: Handler<
	Sockets.Vectorization.Status.Params,
	Sockets.Vectorization.Status.Response
> = {
	event: "vectorization:status",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = await buildVectorizationStatus()
		emitToUser("vectorization:status", res)
		return res
	}
}

/**
 * Free the embedding model now.
 *
 * ⚠ It does NOT stop the queue, and that is the architecture rather than an
 * oversight: a queue never owns model lifecycle, and nothing may assume a model
 * is resident. The queue's next item loads on demand exactly as it does after an
 * idle timeout — which is what makes this safe to press at any moment, and what
 * would be broken by "helpfully" stopping the lane as well.
 */
export const vectorizationUnloadModel: Handler<
	Sockets.Vectorization.UnloadModel.Params,
	Sockets.Vectorization.UnloadModel.Response
> = {
	event: "vectorization:unloadModel",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		unloadEmbeddingModel("by request")
		const res = await buildVectorizationStatus()
		emitToUser("vectorization:unloadModel", res)
		// The header and the model view both read `listModels`; an unload
		// changes `modelReady` there too.
		await emitToUser("vectorization:listModels", () =>
			buildEmbeddingModelState()
		)
		return res
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerVectorizationHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, vectorizationListModels, emitToUser)
	register(socket, vectorizationLoadModel, emitToUser)
	register(socket, vectorizationReindexCost, emitToUser)
	register(socket, vectorizationStatus, emitToUser)
	register(socket, vectorizationUnloadModel, emitToUser)
	register(socket, vectorizationStartQueue, emitToUser)
	register(socket, vectorizationStopQueue, emitToUser)
	register(socket, vectorizationGetQueue, emitToUser)
	register(socket, vectorizationAddToQueue, emitToUser)
	register(socket, vectorizationMoveQueueGroup, emitToUser)
	register(socket, vectorizationRemoveFromQueue, emitToUser)
	register(socket, vectorizationCheckRagStatus, emitToUser)
	register(socket, vectorizationSetSessionRagIgnored, emitToUser)

	// Progress telemetry (priorityQueue/history) spans every user's sessions/
	// lorebooks/characters instance-wide — only admins should ever receive
	// it. vectorizationCheckRagStatus/vectorizationSetSessionRagIgnored above
	// are correctly per-session-scoped for any user; this is the one piece of
	// this module that isn't for everyone.
	if (socket.user?.isAdmin) {
		registerProgressEmitter(emitToUser)
		socket.on("disconnect", () => unregisterProgressEmitter(emitToUser))
	}
	// An embedded item's badge refresh (`vectorization:itemUpdated`) is its
	// owner's, admin or not (plan A7): every signed-in socket listens for its
	// own user's items.
	const userId = socket.user?.id
	if (typeof userId === "number") {
		registerOwnerEmitter(userId, emitToUser)
		socket.on("disconnect", () =>
			unregisterOwnerEmitter(userId, emitToUser)
		)
	}
}
