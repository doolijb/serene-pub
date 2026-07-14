import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { isAndroidWrapper } from "$lib/server/utils"
import { EMBEDDING_MODELS, findModel } from "$lib/server/embedding/models"
import {
	loadEmbeddingModel,
	activateApiEmbedding,
	buildApiModelId,
	unloadEmbeddingModel,
	getLoadedModelId,
	isModelReady,
	isModelCached,
	getLoadError
} from "$lib/server/embedding/index"
import { systemSettingsGet } from "./systemSettings"
import {
	startVectorizationQueue,
	stopVectorization,
	isVectorizationRunning,
	setProgressEmitter,
	countUnembedded,
	getPriorityQueue,
	getCompletedHistory,
	enqueueChatGroup,
	enqueueLorebookGroup,
	enqueueCharacterGroup,
	moveQueueGroup,
	removeQueueGroup
} from "$lib/server/embedding/vectorizationQueue"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count rows matching needsEmbedding for a given condition combo */
function needsEmbedding(embeddingCol: any, modelCol: any, currentModel: string) {
	return or(isNull(embeddingCol), ne(modelCol, currentModel))
}

async function ragTypeCounts(
	table: any,
	embeddingCol: any,
	modelCol: any,
	currentModel: string,
	scopeCondition?: any
): Promise<Sockets.Vectorization.RagTypeCounts> {
	const base = scopeCondition
		? and(scopeCondition, needsEmbedding(embeddingCol, modelCol, currentModel))
		: needsEmbedding(embeddingCol, modelCol, currentModel)

	const [total, nullCount, staleCount] = await Promise.all([
		db.$count(table, scopeCondition ?? undefined),
		db.$count(table, and(scopeCondition ?? undefined, isNull(embeddingCol))),
		db.$count(
			table,
			and(scopeCondition ?? undefined, ne(modelCol, currentModel), isNull(embeddingCol) ? undefined : undefined)
		)
	])

	// stale = has embedding but wrong model
	const staleOnly = await db.$count(
		table,
		and(
			scopeCondition ?? undefined,
			sql`${embeddingCol} IS NOT NULL`,
			ne(modelCol, currentModel)
		)
	)

	return {
		total: Number(total),
		nullCount: Number(nullCount),
		staleCount: Number(staleOnly),
		readyCount: Number(total) - Number(nullCount) - Number(staleOnly)
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const vectorizationListModels: Handler<
	Sockets.Vectorization.ListModels.Params,
	Sockets.Vectorization.ListModels.Response
> = {
	event: "vectorization:listModels",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = await db.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1),
			columns: {
				vectorizationEnabled: true,
				embeddingModelName: true
			}
		})
		const vecConfig = await db.query.vectorizationConfigs.findFirst({
			where: eq(schema.vectorizationConfigs.id, 1),
			columns: {
				mode: true,
				apiBaseUrl: true,
				apiKey: true,
				apiModel: true,
				apiDimensions: true
			}
		})

		const activeModelName = settings?.embeddingModelName ?? null
		const mode = (vecConfig?.mode as "local" | "api" | undefined) ?? "local"
		// isModelCached() only makes sense for local HF models — API mode has
		// nothing cached on disk, readiness there comes entirely from isModelReady().
		const cached =
			mode === "local" && activeModelName
				? await isModelCached(activeModelName)
				: false

		const res: Sockets.Vectorization.ListModels.Response = {
			models: EMBEDDING_MODELS,
			activeModelName,
			vectorizationEnabled: settings?.vectorizationEnabled ?? false,
			modelReady: isModelReady(),
			modelCached: cached,
			loadError: getLoadError(),
			mode,
			apiBaseUrl: vecConfig?.apiBaseUrl ?? null,
			apiKey: vecConfig?.apiKey ?? null,
			apiModel: vecConfig?.apiModel ?? null,
			apiDimensions: vecConfig?.apiDimensions ?? null
		}
		emitToUser("vectorization:listModels", res)
		return res
	}
}

export const vectorizationEnableVectorization: Handler<
	Sockets.Vectorization.EnableVectorization.Params,
	Sockets.Vectorization.EnableVectorization.Response
> = {
	event: "vectorization:enable",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (isAndroidWrapper()) {
			// Local vectorization needs onnxruntime-node, a native addon whose
			// prebuilt binaries are glibc-linked and can't load under Android's
			// Bionic userspace. External API vectorization (vectorizationSetApiConfig)
			// has no such restriction — it's plain HTTP.
			throw new Error(
				"Local vectorization is not available in the Android app — use an external API instead"
			)
		}
		const modelDef = findModel(params.modelName)
		if (!modelDef) {
			emitToUser("vectorization:enable:error", {
				error: `Unknown model: ${params.modelName}`
			})
			throw new Error(`Unknown model: ${params.modelName}`)
		}

		if (getLoadedModelId() !== params.modelName) {
			await loadEmbeddingModel(params.modelName, (progress) => {
				emitToUser("vectorization:modelDownloadProgress", {
					modelId: progress.modelId,
					status: progress.status,
					percent: progress.percent
				} satisfies Sockets.Vectorization.ModelDownloadProgress.Response)
			})
		}

		await db
			.update(schema.systemSettings)
			.set({
				vectorizationEnabled: true,
				embeddingModelName: params.modelName,
				embeddingModelDimensions: modelDef.dimensions
			})
			.where(eq(schema.systemSettings.id, 1))
		// Keep vectorizationConfigs.mode in sync — without this, switching back
		// to local mode after having used the API backend would leave mode
		// stuck at "api", and the next server restart's boot-resume logic would
		// incorrectly try to reactivate the stale API config instead.
		await db
			.update(schema.vectorizationConfigs)
			.set({ mode: "local" })
			.where(eq(schema.vectorizationConfigs.id, 1))

		setProgressEmitter(emitToUser)

		if (params.startNow) {
			startVectorizationQueue({ startFromBeginning: true })
		}

		const res: Sockets.Vectorization.EnableVectorization.Response = {
			success: true,
			vectorizationEnabled: true
		}
		emitToUser("vectorization:enable", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const vectorizationSetApiConfig: Handler<
	Sockets.Vectorization.SetApiConfig.Params,
	Sockets.Vectorization.SetApiConfig.Response
> = {
	event: "vectorization:setApiConfig",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (!params.baseUrl || !params.model) {
			const res: Sockets.Vectorization.SetApiConfig.Response = {
				success: false,
				error: "Base URL and model are required"
			}
			emitToUser("vectorization:setApiConfig", res)
			return res
		}

		// Validates via a real test embed call before anything is persisted —
		// a config that fails here never reaches an "enabled" state. Returned
		// as a normal response (not thrown), matching connections:test's
		// convention for user-facing validation failures the UI should show
		// inline rather than treat as an unexpected error.
		let dimensions: number
		try {
			;({ dimensions } = await activateApiEmbedding({
				baseUrl: params.baseUrl,
				apiKey: params.apiKey,
				model: params.model
			}))
		} catch (err: any) {
			const res: Sockets.Vectorization.SetApiConfig.Response = {
				success: false,
				error: err?.message ?? "Failed to validate the embeddings API"
			}
			emitToUser("vectorization:setApiConfig", res)
			return res
		}

		const modelId = buildApiModelId(params.baseUrl, params.model)

		await db
			.update(schema.vectorizationConfigs)
			.set({
				mode: "api",
				apiBaseUrl: params.baseUrl,
				apiKey: params.apiKey,
				apiModel: params.model,
				apiDimensions: dimensions
			})
			.where(eq(schema.vectorizationConfigs.id, 1))

		await db
			.update(schema.systemSettings)
			.set({
				vectorizationEnabled: true,
				embeddingModelName: modelId,
				embeddingModelDimensions: dimensions
			})
			.where(eq(schema.systemSettings.id, 1))

		setProgressEmitter(emitToUser)

		if (params.startNow) {
			startVectorizationQueue({ startFromBeginning: true })
		}

		const res: Sockets.Vectorization.SetApiConfig.Response = {
			success: true,
			modelName: modelId,
			dimensions
		}
		emitToUser("vectorization:setApiConfig", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const vectorizationDisableVectorization: Handler<
	Sockets.Vectorization.DisableVectorization.Params,
	Sockets.Vectorization.DisableVectorization.Response
> = {
	event: "vectorization:disable",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		stopVectorization()
		unloadEmbeddingModel()

		await db
			.update(schema.systemSettings)
			.set({ vectorizationEnabled: false })
			.where(eq(schema.systemSettings.id, 1))

		const res: Sockets.Vectorization.DisableVectorization.Response = {
			success: true
		}
		emitToUser("vectorization:disable", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const vectorizationSetModel: Handler<
	Sockets.Vectorization.SetModel.Params,
	Sockets.Vectorization.SetModel.Response
> = {
	event: "vectorization:setModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const modelDef = findModel(params.modelName)
		if (!modelDef) {
			emitToUser("vectorization:setModel:error", {
				error: `Unknown model: ${params.modelName}`
			})
			throw new Error(`Unknown model: ${params.modelName}`)
		}

		stopVectorization()
		unloadEmbeddingModel()

		await loadEmbeddingModel(params.modelName, (progress) => {
			emitToUser("vectorization:modelDownloadProgress", {
				modelId: progress.modelId,
				status: progress.status,
				percent: progress.percent
			} satisfies Sockets.Vectorization.ModelDownloadProgress.Response)
		})

		await db
			.update(schema.systemSettings)
			.set({
				embeddingModelName: params.modelName,
				embeddingModelDimensions: modelDef.dimensions
			})
			.where(eq(schema.systemSettings.id, 1))
		// See vectorizationEnableVectorization — keep boot-resume mode in sync.
		await db
			.update(schema.vectorizationConfigs)
			.set({ mode: "local" })
			.where(eq(schema.vectorizationConfigs.id, 1))

		const res: Sockets.Vectorization.SetModel.Response = {
			success: true,
			modelName: params.modelName,
			dimensions: modelDef.dimensions
		}
		emitToUser("vectorization:setModel", res)
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
		setProgressEmitter(emitToUser)
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
		if (params.chatId != null) {
			await enqueueChatGroup(params.chatId)
		} else if (params.lorebookId != null) {
			// Fetch the lorebook name for the label
			const lb = await db.query.lorebooks.findFirst({
				where: eq(schema.lorebooks.id, params.lorebookId),
				columns: { name: true, userId: true }
			})
			const owner = lb?.userId ? await db.query.users.findFirst({
				where: eq(schema.users.id, lb.userId),
				columns: { username: true, displayName: true }
			}) : null
			const ownerDisplayName = owner?.displayName ?? owner?.username ?? 'Unknown'
			enqueueLorebookGroup(params.lorebookId, lb?.name ?? `Lorebook #${params.lorebookId}`, ownerDisplayName)
		} else if (params.characterId != null) {
			const name = params.characterName ?? `Character #${params.characterId}`
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
		const settings = await db.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1),
			columns: { vectorizationEnabled: true, embeddingModelName: true }
		})

		const vectorizationEnabled = settings?.vectorizationEnabled ?? false
		const activeModelName = settings?.embeddingModelName ?? null

		const empty: Sockets.Vectorization.RagTypeCounts = {
			total: 0,
			nullCount: 0,
			staleCount: 0,
			readyCount: 0
		}

		if (!vectorizationEnabled || !activeModelName) {
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

		// Load chat metadata + linked content in parallel
		const [chat, chatCharsRows, chatPersonasRows] = await Promise.all([
			db.query.chats.findFirst({
				where: eq(schema.chats.id, params.chatId),
				columns: { lorebookId: true, metadata: true }
			}),
			db
				.select({
					characterId: schema.chatCharacters.characterId,
					charLorebookId: schema.characters.lorebookId
				})
				.from(schema.chatCharacters)
				.leftJoin(
					schema.characters,
					eq(schema.chatCharacters.characterId, schema.characters.id)
				)
				.where(eq(schema.chatCharacters.chatId, params.chatId)),
			db
				.select({ personaId: schema.chatPersonas.personaId })
				.from(schema.chatPersonas)
				.where(eq(schema.chatPersonas.chatId, params.chatId))
		])

		const ragIgnored = !!(chat?.metadata as any)?.ragIgnored

		// Gather linked IDs
		const characterIds: number[] = []
		const allLorebookIds: number[] = []

		if (chat?.lorebookId) allLorebookIds.push(chat.lorebookId)

		for (const cc of chatCharsRows) {
			if (cc.characterId) characterIds.push(cc.characterId)
			if (cc.charLorebookId && !allLorebookIds.includes(cc.charLorebookId)) {
				allLorebookIds.push(cc.charLorebookId)
			}
		}

		const personaIds: number[] = []
		for (const cp of chatPersonasRows) {
			if (cp.personaId) personaIds.push(cp.personaId)
		}

		// Count total messages to determine if RAG is applicable
		const totalMessages = await db.$count(
			schema.chatMessages,
			eq(schema.chatMessages.chatId, params.chatId)
		)

		// Not applicable if chat has ≤ 10 messages (all are in context window)
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
			.select({ id: schema.chatMessages.id })
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, params.chatId))
			.orderBy(desc(schema.chatMessages.id))
			.limit(10)
		const recentIds = recentRows.map((r) => r.id)

		// Messages older than the last 10
		const olderWhere = and(
			eq(schema.chatMessages.chatId, params.chatId),
			recentIds.length > 0
				? sql`${schema.chatMessages.id} NOT IN (${sql.join(
						recentIds.map((id) => sql`${id}`),
						sql`, `
					)})`
				: undefined
		)

		const [msgTotal, msgNull, msgStale] = await Promise.all([
			db.$count(schema.chatMessages, olderWhere),
			db.$count(schema.chatMessages, and(olderWhere, isNull(schema.chatMessages.embedding))),
			db.$count(
				schema.chatMessages,
				and(
					olderWhere,
					sql`${schema.chatMessages.embedding} IS NOT NULL`,
					ne(schema.chatMessages.embeddingModel, activeModelName)
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
				db.$count(schema.characters, and(charWhere, isNull(schema.characters.embedding))),
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

		// Personas
		let personas: Sockets.Vectorization.RagTypeCounts = empty
		if (personaIds.length > 0) {
			const personaWhere = inArray(schema.personas.id, personaIds)
			const [pTotal, pNull, pStale] = await Promise.all([
				db.$count(schema.personas, personaWhere),
				db.$count(schema.personas, and(personaWhere, isNull(schema.personas.embedding))),
				db.$count(
					schema.personas,
					and(
						personaWhere,
						sql`${schema.personas.embedding} IS NOT NULL`,
						ne(schema.personas.embeddingModel, activeModelName)
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
			const lbWhere = inArray(schema.worldLoreEntries.lorebookId, allLorebookIds)
			const clWhere = inArray(schema.characterLoreEntries.lorebookId, allLorebookIds)
			const heWhere = inArray(schema.historyEntries.lorebookId, allLorebookIds)
			const nnWhere = inArray(schema.narrativeNodes.lorebookId, allLorebookIds)
			const nrWhere = inArray(schema.narrativeRelationships.lorebookId, allLorebookIds)

			const [
				wleTotal, wleNull, wleStale,
				cleTotal, cleNull, cleStale,
				heTotal, heNull, heStale,
				nnTotal, nnNull, nnStale,
				nrTotal, nrNull, nrStale
			] = await Promise.all([
				db.$count(schema.worldLoreEntries, lbWhere),
				db.$count(schema.worldLoreEntries, and(lbWhere, isNull(schema.worldLoreEntries.embedding))),
				db.$count(schema.worldLoreEntries, and(lbWhere, sql`${schema.worldLoreEntries.embedding} IS NOT NULL`, ne(schema.worldLoreEntries.embeddingModel, activeModelName))),
				db.$count(schema.characterLoreEntries, clWhere),
				db.$count(schema.characterLoreEntries, and(clWhere, isNull(schema.characterLoreEntries.embedding))),
				db.$count(schema.characterLoreEntries, and(clWhere, sql`${schema.characterLoreEntries.embedding} IS NOT NULL`, ne(schema.characterLoreEntries.embeddingModel, activeModelName))),
				db.$count(schema.historyEntries, heWhere),
				db.$count(schema.historyEntries, and(heWhere, isNull(schema.historyEntries.embedding))),
				db.$count(schema.historyEntries, and(heWhere, sql`${schema.historyEntries.embedding} IS NOT NULL`, ne(schema.historyEntries.embeddingModel, activeModelName))),
				db.$count(schema.narrativeNodes, nnWhere),
				db.$count(schema.narrativeNodes, and(nnWhere, isNull(schema.narrativeNodes.embedding))),
				db.$count(schema.narrativeNodes, and(nnWhere, sql`${schema.narrativeNodes.embedding} IS NOT NULL`, ne(schema.narrativeNodes.embeddingModel, activeModelName))),
				db.$count(schema.narrativeRelationships, nrWhere),
				db.$count(schema.narrativeRelationships, and(nrWhere, isNull(schema.narrativeRelationships.embedding))),
				db.$count(schema.narrativeRelationships, and(nrWhere, sql`${schema.narrativeRelationships.embedding} IS NOT NULL`, ne(schema.narrativeRelationships.embeddingModel, activeModelName)))
			])

			const lbTotal = Number(wleTotal) + Number(cleTotal) + Number(heTotal) + Number(nnTotal) + Number(nrTotal)
			const lbNull = Number(wleNull) + Number(cleNull) + Number(heNull) + Number(nnNull) + Number(nrNull)
			const lbStale = Number(wleStale) + Number(cleStale) + Number(heStale) + Number(nnStale) + Number(nrStale)

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

export const vectorizationSetChatRagIgnored: Handler<
	Sockets.Vectorization.SetChatRagIgnored.Params,
	Sockets.Vectorization.SetChatRagIgnored.Response
> = {
	event: "vectorization:setChatRagIgnored",
	handler: async (socket, params, emitToUser) => {
		const chat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, params.chatId),
			columns: { metadata: true }
		})

		const currentMeta = (chat?.metadata as Record<string, any>) ?? {}
		await db
			.update(schema.chats)
			.set({ metadata: { ...currentMeta, ragIgnored: params.ignored } })
			.where(eq(schema.chats.id, params.chatId))

		const res: Sockets.Vectorization.SetChatRagIgnored.Response = {
			success: true,
			ragIgnored: params.ignored
		}
		emitToUser("vectorization:setChatRagIgnored", res)
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
	register(socket, vectorizationEnableVectorization, emitToUser)
	register(socket, vectorizationSetApiConfig, emitToUser)
	register(socket, vectorizationDisableVectorization, emitToUser)
	register(socket, vectorizationSetModel, emitToUser)
	register(socket, vectorizationStartQueue, emitToUser)
	register(socket, vectorizationStopQueue, emitToUser)
	register(socket, vectorizationGetQueue, emitToUser)
	register(socket, vectorizationAddToQueue, emitToUser)
	register(socket, vectorizationMoveQueueGroup, emitToUser)
	register(socket, vectorizationRemoveFromQueue, emitToUser)
	register(socket, vectorizationCheckRagStatus, emitToUser)
	register(socket, vectorizationSetChatRagIgnored, emitToUser)

	// Re-attach progress emitter whenever a new socket connects
	setProgressEmitter(emitToUser)
}
