import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
import {
	and,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	sql,
	type SQL
} from "drizzle-orm"
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
import {
	startVectorizationQueue,
	stopVectorization,
	isVectorizationRunning,
	registerProgressEmitter,
	unregisterProgressEmitter,
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
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res: Sockets.Vectorization.ReindexCost.Response =
			await embeddingReindexCost(db)
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

		// The star, which is both halves of what this used to ask two columns:
		// whether embeddings are on at all, and which model identity a row's
		// `embedding_model` has to equal to count as current.
		const target = await resolveEmbeddingTarget(db)
		const activeModelName = target?.modelId ?? null

		const empty: Sockets.Vectorization.RagTypeCounts = {
			total: 0,
			nullCount: 0,
			staleCount: 0,
			readyCount: 0
		}

		if (!activeModelName) {
			const res: Sockets.Vectorization.CheckRagStatus.Response = {
				applicable: false,
				messages: empty,
				characters: empty,
				personas: empty,
				lorebook: null,
				queueRunning: isVectorizationRunning(),
				activeModelName,
				ragIgnored: false
			}
			emitToUser("vectorization:checkRagStatus", res)
			return res
		}

		// Load session metadata + linked content in parallel
		const [session, sessionCharsRows, sessionPersonasRows] =
			await Promise.all([
				db.query.sessions.findFirst({
					where: eq(schema.sessions.id, params.sessionId),
					columns: { lorebookId: true, metadata: true }
				}),
				db
					.select({
						characterId: schema.sessionCharacters.characterId,
						charLorebookId: schema.characters.lorebookId
					})
					.from(schema.sessionCharacters)
					.leftJoin(
						schema.characters,
						eq(
							schema.sessionCharacters.characterId,
							schema.characters.id
						)
					)
					.where(
						eq(schema.sessionCharacters.sessionId, params.sessionId)
					),
				db
					.select({ personaId: schema.sessionPersonas.personaId })
					.from(schema.sessionPersonas)
					.where(
						eq(schema.sessionPersonas.sessionId, params.sessionId)
					)
			])

		const ragIgnored = !!(session?.metadata as any)?.ragIgnored

		// Gather linked IDs
		const characterIds: number[] = []
		const allLorebookIds: number[] = []

		if (session?.lorebookId) allLorebookIds.push(session.lorebookId)

		for (const cc of sessionCharsRows) {
			if (cc.characterId) characterIds.push(cc.characterId)
			if (
				cc.charLorebookId &&
				!allLorebookIds.includes(cc.charLorebookId)
			) {
				allLorebookIds.push(cc.charLorebookId)
			}
		}

		const personaIds: number[] = []
		for (const cp of sessionPersonasRows) {
			if (cp.personaId) personaIds.push(cp.personaId)
		}

		// Count total messages to determine if RAG is applicable
		const totalMessages = await db.$count(
			schema.sessionMessages,
			eq(schema.sessionMessages.sessionId, params.sessionId)
		)

		// Not applicable if session has ≤ 10 messages (all are in context window)
		if (Number(totalMessages) <= 10) {
			const res: Sockets.Vectorization.CheckRagStatus.Response = {
				applicable: false,
				messages: empty,
				characters: empty,
				personas: empty,
				lorebook: null,
				queueRunning: isVectorizationRunning(),
				activeModelName,
				ragIgnored
			}
			emitToUser("vectorization:checkRagStatus", res)
			return res
		}

		// Get IDs of the 10 most recent messages to exclude them
		const recentRows = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, params.sessionId))
			.orderBy(desc(schema.sessionMessages.id))
			.limit(10)
		const recentIds = recentRows.map((r) => r.id)

		// Messages older than the last 10
		const olderWhere = and(
			eq(schema.sessionMessages.sessionId, params.sessionId),
			recentIds.length > 0
				? sql`${schema.sessionMessages.id} NOT IN (${sql.join(
						recentIds.map((id) => sql`${id}`),
						sql`, `
					)})`
				: undefined
		)

		const [msgTotal, msgNull, msgStale] = await Promise.all([
			db.$count(schema.sessionMessages, olderWhere),
			db.$count(
				schema.sessionMessages,
				and(olderWhere, isNull(schema.sessionMessages.embedding))
			),
			db.$count(
				schema.sessionMessages,
				and(
					olderWhere,
					sql`${schema.sessionMessages.embedding} IS NOT NULL`,
					ne(schema.sessionMessages.embeddingModel, activeModelName)
				)
			)
		])

		const messages: Sockets.Vectorization.RagTypeCounts = {
			total: Number(msgTotal),
			nullCount: Number(msgNull),
			staleCount: Number(msgStale),
			readyCount: Number(msgTotal) - Number(msgNull) - Number(msgStale)
		}

		// Characters
		let characters: Sockets.Vectorization.RagTypeCounts = empty
		if (characterIds.length > 0) {
			const charWhere = inArray(schema.characters.id, characterIds)
			const [cTotal, cNull, cStale] = await Promise.all([
				db.$count(schema.characters, charWhere),
				db.$count(
					schema.characters,
					and(charWhere, isNull(schema.characters.embedding))
				),
				db.$count(
					schema.characters,
					and(
						charWhere,
						sql`${schema.characters.embedding} IS NOT NULL`,
						ne(schema.characters.embeddingModel, activeModelName)
					)
				)
			])
			characters = {
				total: Number(cTotal),
				nullCount: Number(cNull),
				staleCount: Number(cStale),
				readyCount: Number(cTotal) - Number(cNull) - Number(cStale)
			}
		}

		// The characters this session's users voice — the same table as the
		// cast, counted apart because the panel reports the two scopes
		// separately and a voiced character is not cast.
		let personas: Sockets.Vectorization.RagTypeCounts = empty
		if (personaIds.length > 0) {
			const personaWhere = inArray(schema.characters.id, personaIds)
			const [pTotal, pNull, pStale] = await Promise.all([
				db.$count(schema.characters, personaWhere),
				db.$count(
					schema.characters,
					and(personaWhere, isNull(schema.characters.embedding))
				),
				db.$count(
					schema.characters,
					and(
						personaWhere,
						sql`${schema.characters.embedding} IS NOT NULL`,
						ne(schema.characters.embeddingModel, activeModelName)
					)
				)
			])
			personas = {
				total: Number(pTotal),
				nullCount: Number(pNull),
				staleCount: Number(pStale),
				readyCount: Number(pTotal) - Number(pNull) - Number(pStale)
			}
		}

		// Lorebook content (aggregate across all linked lorebooks)
		let lorebook: Sockets.Vectorization.RagTypeCounts | null = null
		if (allLorebookIds.length > 0) {
			const nnWhere = inArray(
				schema.lorebookBindings.lorebookId,
				allLorebookIds
			)
			const nrWhere = inArray(
				schema.narrativeRelationships.lorebookId,
				allLorebookIds
			)

			/**
			 * The three entry types, counted once.
			 *
			 * They are one table, and the vector they are counted against is a
			 * row in another — so `IS NULL` becomes "no default-space vector"
			 * and the stale test becomes "a vector whose model is not the
			 * active one". Every clause keeps the meaning it had as a column.
			 */
			const entryWhere = inArray(
				schema.lorebookEntries.lorebookId,
				allLorebookIds
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

			const [
				entryTotal,
				entryNull,
				entryStale,
				nnTotal,
				nnNull,
				nnStale,
				nrTotal,
				nrNull,
				nrStale
			] = await Promise.all([
				countEntries(),
				countEntries(isNull(schema.lorebookEntryVectors.entryId)),
				countEntries(
					and(
						isNotNull(schema.lorebookEntryVectors.entryId),
						ne(schema.lorebookEntryVectors.model, activeModelName)
					)
				),
				db.$count(schema.lorebookBindings, nnWhere),
				db.$count(
					schema.lorebookBindings,
					and(nnWhere, isNull(schema.lorebookBindings.embedding))
				),
				db.$count(
					schema.lorebookBindings,
					and(
						nnWhere,
						sql`${schema.lorebookBindings.embedding} IS NOT NULL`,
						ne(
							schema.lorebookBindings.embeddingModel,
							activeModelName
						)
					)
				),
				db.$count(schema.narrativeRelationships, nrWhere),
				db.$count(
					schema.narrativeRelationships,
					and(
						nrWhere,
						isNull(schema.narrativeRelationships.embedding)
					)
				),
				db.$count(
					schema.narrativeRelationships,
					and(
						nrWhere,
						sql`${schema.narrativeRelationships.embedding} IS NOT NULL`,
						ne(
							schema.narrativeRelationships.embeddingModel,
							activeModelName
						)
					)
				)
			])

			const lbTotal = entryTotal + Number(nnTotal) + Number(nrTotal)
			const lbNull = entryNull + Number(nnNull) + Number(nrNull)
			const lbStale = entryStale + Number(nnStale) + Number(nrStale)

			lorebook = {
				total: lbTotal,
				nullCount: lbNull,
				staleCount: lbStale,
				readyCount: lbTotal - lbNull - lbStale
			}
		}

		const applicable =
			messages.total > 0 ||
			characters.total > 0 ||
			personas.total > 0 ||
			(lorebook?.total ?? 0) > 0

		const res: Sockets.Vectorization.CheckRagStatus.Response = {
			applicable,
			messages,
			characters,
			personas,
			lorebook,
			queueRunning: isVectorizationRunning(),
			activeModelName,
			ragIgnored
		}
		emitToUser("vectorization:checkRagStatus", res)
		return res
	}
}

export const vectorizationSetSessionRagIgnored: Handler<
	Sockets.Vectorization.SetSessionRagIgnored.Params,
	Sockets.Vectorization.SetSessionRagIgnored.Response
> = {
	event: "vectorization:setSessionRagIgnored",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// A session-level setting, like the other session-level toggles gated to
		// owners only in sessionsUpdateHandler — guests can use RAG, not
		// reconfigure it for everyone else in the session.
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess || !sessionAccess.isOwner) {
			throw new Error(
				"Access denied. Only the session owner can change this."
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
	}
}

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
}
