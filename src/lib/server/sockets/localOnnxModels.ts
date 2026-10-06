/**
 * The files behind a local ONNX endpoint: download one, stop a download, delete
 * one, and add a model the recommended list does not name.
 *
 * Admin only, and refused on every endpoint that is not one of the two local
 * ONNX types — a model on a host is the host's business, and there is nothing
 * on this machine to download or delete.
 *
 * A download and an add-by-Hub-id are also refused on a machine that cannot
 * run the runtime (`localOnnxRefusal`, the shared probe): a file that can never
 * load is a few hundred megabytes of nothing. Cancel and remove are not — they
 * only ever free what is already here.
 *
 * ## ⚠ A download is a WARM, not a transfer
 *
 * There is no downloader here. transformers.js's own loaders — the config, the
 * task's model class, the tokenizer — are called for the same task, dtype and
 * cache directory the lane's loader uses, and they fetch whatever is not
 * already there (`fetchModelFiles`). That is deliberate: a hand-rolled
 * downloader would have to guess which files a repo needs (`config.json`, a
 * tokenizer, one of six `onnx/*.onnx` variants chosen by dtype), and a guess
 * that is wrong produces a directory that looks complete and will not load.
 *
 * The consequence is the cancel semantics below.
 *
 * ## ⚠ Cancel cannot interrupt anything
 *
 * transformers.js 4.2.0 exposes **no AbortSignal** on `pipeline()` or on the
 * fetches underneath it. So "cancel" is:
 *
 *   1. mark the entry cancelled — the state pushed meanwhile stays
 *      `downloading` with `error: null`, because nothing has failed and
 *      nothing has stopped; the client says "cancelling" in its own words;
 *   2. let the in-flight fetch finish or fail on its own;
 *   3. THEN delete the partial cache directory and the `local_models` row;
 *   4. settle as `not_downloaded`.
 *
 * A cancel on a 600MB model therefore keeps pulling bytes until that file ends.
 * This is stated rather than hidden because the alternative — reporting
 * `not_downloaded` immediately while the fetch still writes into the directory —
 * would race the delete against the writer and leave a half-repo that reads as
 * absent.
 *
 * ## ⚠ A `downloading` row that outlives the process is a lie
 *
 * `local_models.status` is durable and this process's download map is not. A
 * restart during a download leaves a row saying `downloading` that nothing is
 * driving, and every reader would believe it forever.
 * `reconcileOnnxDownloadsOnBoot` settles those to `error` at startup — see the
 * bottom of this file.
 */

import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { syncConnectionModelsById } from "$lib/server/connections/modelSync"
import {
	connectionModelById,
	connectionModels
} from "$lib/server/connections/models"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
import { NER_CAPABILITY } from "$lib/shared/constants/ner"
import { findModel } from "$lib/server/embedding/models"
import { findNerModel } from "$lib/server/ner/models"
import {
	activeDownload,
	cacheDirFor,
	claimDownload,
	dirSizeBytes,
	invalidateCachedScan,
	localModelState,
	onnxModalityOf,
	releaseDownload,
	removeCached,
	type OnnxDownload,
	type OnnxModality
} from "$lib/server/localModels/onnxCache"
import { localOnnxRefusal } from "$lib/server/localModels/onnxRuntime"
import { buildConnectionsList, connectionModelsView } from "./connections"
import {
	downloadHref,
	notifyDownloadSettled
} from "$lib/server/notifications/downloads"

type EmitToUser = (event: string, data: any) => any

const DENIED = "Access denied. Only admin users can manage connection models."

/** At most four progress pushes a second, per download. */
const PROGRESS_INTERVAL_MS = 250

/**
 * Who is watching each download, by user id.
 *
 * Keyed by user rather than by socket so a second press from the same person
 * does not double every push, and so a second ADMIN pressing the same button
 * still sees the bar move — their request answers the running download's state
 * rather than starting a second one, and without this their view would then sit
 * at that one frame.
 *
 * ⚠ Separate from the download entry itself, which lives in `onnxCache` because
 * the state derivation has to read it. Sockets have no business in that module.
 */
const watchers = new Map<string, Map<number, EmitToUser>>()

function watch(download: OnnxDownload, userId: number, emit: EmitToUser) {
	const byUser = watchers.get(download.key) ?? new Map<number, EmitToUser>()
	byUser.set(userId, emit)
	watchers.set(download.key, byUser)
}

function watchersOf(key: string): EmitToUser[] {
	return [...(watchers.get(key)?.values() ?? [])]
}

function forgetWatchers(key: string) {
	watchers.delete(key)
	lastPushAt.delete(key)
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

interface Resolved {
	endpoint: SelectConnection
	modality: OnnxModality
}

/**
 * The admin gate, the endpoint lookup and the "this is a local ONNX endpoint"
 * check, spelled once for all four handlers.
 *
 * Answers a refusal rather than throwing, for the reason the sibling gate in
 * `connections.ts` gives: a thrown error reaches the client as the dispatcher's
 * generic sentence, and every refusal here names the fix.
 */
async function gate(
	socket: any,
	event: string,
	connectionId: number,
	emitToUser: EmitToUser
): Promise<Resolved | { error: string }> {
	if (!socket.user!.isAdmin) {
		emitToUser(`${event}:error`, { error: DENIED })
		return { error: DENIED }
	}
	const endpoint = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, connectionId)
	})
	if (!endpoint) {
		const error = "Connection not found."
		emitToUser(`${event}:error`, { error })
		return { error }
	}
	const modality = onnxModalityOf(endpoint.type)
	if (!modality) {
		const error = `Models on ${endpoint.name} are managed by its host; downloading applies to local ONNX connections only.`
		emitToUser(`${event}:error`, { error })
		return { error }
	}
	return { endpoint, modality }
}

const isRefusal = (r: Resolved | { error: string }): r is { error: string } =>
	"error" in r

/** The model row on this endpoint, or a refusal naming what was asked for. */
async function modelRow(
	connectionId: number,
	modelId: number
): Promise<SelectConnectionModel | null> {
	const row = await connectionModelById(db, modelId)
	return row && row.connectionId === connectionId ? row : null
}

/** The `DownloadModel.Response` shape, with the state freshly derived. */
async function stateResponse(
	endpoint: SelectConnection,
	row: SelectConnectionModel,
	error?: string
): Promise<Sockets.Connections.DownloadModel.Response> {
	const local = await localModelState(db, endpoint, row)
	return {
		connectionId: endpoint.id,
		modelId: row.id,
		local: local ?? {
			state: "not_downloaded",
			sizeBytes: null,
			loaded: false,
			addedByUser: false
		},
		...(error ? { error } : {})
	}
}

// ---------------------------------------------------------------------------
// The registry row behind a download
// ---------------------------------------------------------------------------

/**
 * The `local_models` row for one warm.
 *
 * ⚠ `kind` is `"unknown"`, not the column's `"text"` default. `kind` is which of
 * KoboldCPP's two loaders opens a file, and neither of them opens an ONNX
 * embedding or entity model — `enginesFor("onnx", …)` answers `["onnx"]`, and
 * `modalityForKind` only ever projects the other way. Recording `"text"` here
 * would file these repos as text generators for every reader of that column.
 *
 * `filename` is UNIQUE table-wide, so the row is matched on it and updated
 * rather than inserted blindly: a retry after a failure, or a second download
 * after a remove, must reuse the row instead of failing on the constraint.
 *
 * `quantization` is the precision this download fetches (`dtypeFor`), or null
 * for the runtime's default. It is what both loaders read for a model the
 * catalogue does not name (`registeredNerModel` in `ner/index.ts`,
 * `registeredEmbeddingModel` in `embedding/index.ts`), so the load asks for
 * the same weights file the download put on disk.
 */
async function beginRegistryRow(
	modality: OnnxModality,
	modelId: string,
	dtype: string | undefined
) {
	const values = {
		filename: modelId,
		modelName: modelId,
		downloadUrl: `https://huggingface.co/${modelId}`,
		modelUrl: `https://huggingface.co/${modelId}`,
		format: "onnx" as const,
		modality,
		kind: "unknown" as const,
		kindSource: "declared" as const,
		quantization: dtype ?? null,
		status: "downloading",
		errorMessage: null
	}
	const [existing] = await db
		.select({ id: schema.localModels.id })
		.from(schema.localModels)
		.where(eq(schema.localModels.filename, modelId))
		.limit(1)
	if (existing) {
		await db
			.update(schema.localModels)
			.set(values)
			.where(eq(schema.localModels.id, existing.id))
		return
	}
	await db.insert(schema.localModels).values(values)
}

async function settleRegistryRow(
	modelId: string,
	patch: {
		status: string
		sizeBytes?: number | null
		errorMessage?: string | null
	}
) {
	await db
		.update(schema.localModels)
		.set(patch)
		.where(eq(schema.localModels.filename, modelId))
}

async function dropRegistryRow(modelId: string, modality: OnnxModality) {
	await db
		.delete(schema.localModels)
		.where(
			and(
				eq(schema.localModels.filename, modelId),
				eq(schema.localModels.modality, modality)
			)
		)
}

// ---------------------------------------------------------------------------
// The warm itself
// ---------------------------------------------------------------------------

/**
 * The precision to request, resolved the way the LOADERS resolve it.
 *
 * ⚠ `extra_json.onnx.dtype` is read as a fallback for a model the list does not
 * name, which is the only case a person can set it in (`connections:addHubModel`
 * is the one writer). The loaders do not read that field; the answer reaches
 * them through the registry row instead (`beginRegistryRow` records it as
 * `local_models.quantization`), which both loaders read for a model the
 * catalogue does not name (`registeredEmbeddingModel`, `registeredNerModel`).
 */
function dtypeFor(
	modality: OnnxModality,
	modelId: string,
	row: SelectConnectionModel
): string | undefined {
	const listed =
		modality === "embeddings"
			? findModel(modelId)?.dtype
			: findNerModel(modelId)?.dtype
	const declared = (row.extraJson as any)?.onnx?.dtype
	return (listed ?? (typeof declared === "string" ? declared : undefined)) as
		| string
		| undefined
}

/** Bytes across every file of one download, as one bar. */
type DownloadTotal = { progress: number; loaded: number; total: number }

/**
 * Fetch every file the lane's loader reads, into this modality's cache
 * directory and nowhere else. Answers the model it built, for the caller to
 * dispose.
 *
 * ## ⚠ Not `pipeline()`, because its file discovery ignores `cache_dir`
 *
 * transformers.js 4.2.0's `pipeline()` decides which files a repo needs
 * (`get_pipeline_files`) before it fetches any, and that step reads the
 * model's `config.json` with no cache directory — so it lands in
 * `env.cacheDir`, the one global the embedding loader sets to ITS directory.
 * An entity model's download left `config.json` among the embedding weights
 * that way. And `env.cacheDir` can't be pointed here for the duration: the
 * embedding lane may load concurrently, and a global assignment races it.
 *
 * So the same steps run by hand, each handed `cache_dir`, in the order
 * `pipeline()` takes them: the config first, then the pipeline's own file list
 * with that config in hand (which then asks nothing of the cache), then the
 * task's model class and its tokenizer. Which files is still the library's
 * answer, never a guess. The model class is the one `pipeline()` picks for
 * the task — `AutoModel` for `feature-extraction`, `AutoModelForTokenClassification`
 * for `token-classification` — named here because the task table that maps
 * them is not exported.
 *
 * ## One bar across every file
 *
 * `pipeline()` sized each file up front and reported one aggregate, so the bar
 * never jumped back as a new file started. This does the same: the sizes are
 * read first, every per-file `progress` event updates its file, and the sum is
 * reported. The model class reports its own `progress_total` over its own
 * files only; that is ignored, because the tokenizer's are not in it.
 */
async function fetchModelFiles(
	modality: OnnxModality,
	modelId: string,
	dtype: string | undefined,
	onTotal: (total: DownloadTotal) => void
): Promise<{ dispose?: () => unknown } | null> {
	const {
		AutoConfig,
		AutoModel,
		AutoModelForTokenClassification,
		AutoTokenizer,
		ModelRegistry
	} = await import("@huggingface/transformers")
	const cache_dir = cacheDirFor(modality)
	const task =
		modality === "embeddings"
			? "feature-extraction"
			: "token-classification"
	const precision = dtype ? { dtype: dtype as any } : {}

	const config = await AutoConfig.from_pretrained(modelId, { cache_dir })
	const files = await ModelRegistry.get_pipeline_files(task, modelId, {
		config,
		...precision
	})

	const loading: Record<string, { loaded: number; total: number }> = {}
	const sizes = await Promise.all(
		files.map((file) =>
			ModelRegistry.get_file_metadata(modelId, file, { cache_dir })
		)
	)
	sizes.forEach((meta, i) => {
		if (!meta.exists) return
		// `config.json` is already here, fetched above.
		const size = meta.size ?? 0
		loading[files[i]] = {
			loaded: files[i] === "config.json" ? size : 0,
			total: size
		}
	})
	const progress_callback = (event: any) => {
		if (event?.status !== "progress" || typeof event.file !== "string")
			return
		loading[event.file] = {
			loaded: Number(event.loaded) || 0,
			total: Number(event.total) || 0
		}
		let loaded = 0
		let total = 0
		for (const file of Object.values(loading)) {
			loaded += file.loaded
			total += file.total
		}
		onTotal({
			progress: total > 0 ? (loaded / total) * 100 : 0,
			loaded,
			total
		})
	}

	const Model =
		modality === "embeddings" ? AutoModel : AutoModelForTokenClassification
	const [model] = await Promise.all([
		Model.from_pretrained(modelId, {
			cache_dir,
			config,
			...precision,
			progress_callback
		}),
		files.includes("tokenizer.json")
			? AutoTokenizer.from_pretrained(modelId, {
					cache_dir,
					progress_callback
				})
			: null
	])
	return model as { dispose?: () => unknown } | null
}

/** When each download last pushed, so the throttle is per download. */
const lastPushAt = new Map<string, number>()

/**
 * Push one progress frame, at most four a second.
 *
 * ⚠ The endpoint and the model row are passed in, not re-read. This runs on
 * every chunk transformers.js reports, and querying two tables per frame would
 * put a few hundred round trips behind a download whose answer is already in
 * hand — neither row can change during a warm in any way this payload shows.
 */
function pushProgress(
	download: OnnxDownload,
	endpoint: SelectConnection,
	row: SelectConnectionModel
) {
	const now = Date.now()
	if (now - (lastPushAt.get(download.key) ?? 0) < PROGRESS_INTERVAL_MS) return
	lastPushAt.set(download.key, now)
	void (async () => {
		const local = await localModelState(db, endpoint, row)
		if (!local) return
		const payload: Sockets.Connections.ModelDownloadProgress.Response = {
			connectionId: endpoint.id,
			modelId: row.id,
			local
		}
		for (const emit of watchersOf(download.key))
			emit("connections:modelDownloadProgress", payload)
	})()
}

/**
 * Warm the cache, then settle everything that observed it.
 *
 * Never throws: it IS the settle path, and a rejection here would be an
 * unhandled one — nothing awaits it except a later request asking whether the
 * download is still live.
 */
async function runWarm(
	download: OnnxDownload,
	endpoint: SelectConnection,
	row: SelectConnectionModel,
	/** The admin who pressed Download — the one told how it settled. */
	initiatorId: number
) {
	const { modality, modelId } = download
	let failure: string | null = null
	try {
		const dtype = dtypeFor(modality, modelId, row)
		await beginRegistryRow(modality, modelId, dtype)
		const warmed = await fetchModelFiles(
			modality,
			modelId,
			dtype,
			(total) => {
				download.percent = Math.max(
					0,
					Math.min(100, Math.round(total.progress))
				)
				download.downloadedBytes = total.loaded
				download.totalBytes = total.total
				pushProgress(download, endpoint, row)
			}
		)
		/**
		 * ⚠ Disposed unconditionally, and that is the point: a DOWNLOAD MUST
		 * NOT LOAD ANYTHING into a lane. This is a private model instance —
		 * `from_pretrained` builds fresh ORT sessions per call and never hands
		 * back the lane's — so disposing it frees exactly what this function
		 * allocated and cannot disturb a model the lane has resident.
		 */
		try {
			await (warmed as any)?.dispose?.()
		} catch {
			// A session that will not close is a leak until the process ends,
			// not a failed download.
		}
	} catch (err: any) {
		failure = err?.message ?? "The download failed."
	}

	// ── Settle ───────────────────────────────────────────────────────────
	invalidateCachedScan(modelId, modality)
	try {
		if (download.cancelled) {
			// The fetch has ended one way or the other; only now is the
			// directory nobody's to delete.
			await removeCached(modelId, modality)
			await dropRegistryRow(modelId, modality)
		} else if (failure) {
			await settleRegistryRow(modelId, {
				status: "error",
				errorMessage: failure
			})
		} else {
			await settleRegistryRow(modelId, {
				status: "complete",
				sizeBytes: await dirSizeBytes(modelId, modality),
				errorMessage: null
			})
		}
	} catch (err) {
		console.error(`[onnx-download] settling ${modelId}:`, err)
	}
	if (!download.cancelled)
		await notifyDownloadSettled({
			userId: initiatorId,
			source: "onnx",
			// `${modality}:${modelId}` — one model id can be downloaded
			// for both lanes, each its own download.
			key: download.key,
			model: row.name || modelId,
			href: downloadHref(endpoint.id),
			...(failure !== null ? { error: failure } : {})
		})

	// Released BEFORE the pushes, so the state they carry is the settled one
	// rather than one more `downloading` frame.
	releaseDownload(download)
	const emitters = watchersOf(download.key)
	forgetWatchers(download.key)

	try {
		// A new model on disk is a new model on this endpoint, so its rows
		// follow the download rather than the next sidebar open. Best effort:
		// a sync failure is recorded on the endpoint, never surfaced as a
		// download failure.
		await syncConnectionModelsById(db, endpoint.id, { force: true })
	} catch (err) {
		console.error(`[onnx-download] post-download model sync:`, err)
	}

	const fresh = await connectionModelById(db, row.id)
	const local = fresh ? await localModelState(db, endpoint, fresh) : null
	for (const emit of emitters) {
		if (local)
			emit("connections:modelDownloadProgress", {
				connectionId: endpoint.id,
				modelId: row.id,
				local
			} satisfies Sockets.Connections.ModelDownloadProgress.Response)
		await emit("connections:list", () => buildConnectionsList())
		await emit("connections:models", () =>
			connectionModelsView(endpoint.id)
		)
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const connectionsDownloadModel: Handler<
	Sockets.Connections.DownloadModel.Params,
	Sockets.Connections.DownloadModel.Response
> = {
	event: "connections:downloadModel",
	handler: async (socket, params, emitToUser) => {
		const resolved = await gate(
			socket,
			"connections:downloadModel",
			params.id,
			emitToUser
		)
		if (isRefusal(resolved))
			return {
				connectionId: params.id,
				modelId: params.modelId,
				local: {
					state: "not_downloaded",
					sizeBytes: null,
					loaded: false,
					addedByUser: false
				},
				error: resolved.error
			}
		const { endpoint, modality } = resolved
		const row = await modelRow(params.id, params.modelId)
		if (!row) {
			const error = "That model is not on this connection."
			emitToUser("connections:downloadModel:error", { error })
			return {
				connectionId: params.id,
				modelId: params.modelId,
				local: {
					state: "not_downloaded",
					sizeBytes: null,
					loaded: false,
					addedByUser: false
				},
				error
			}
		}

		// Before the claim, and so before `runWarm`'s import of transformers:
		// nothing is claimed, no registry row is written, and the answer is the
		// machine's own reason rather than a failed download naming a missing
		// binary.
		const unrunnable = await localOnnxRefusal()
		if (unrunnable) {
			emitToUser("connections:downloadModel:error", { error: unrunnable })
			return await stateResponse(endpoint, row, unrunnable)
		}

		// ⚠ One download per `${modality}:${modelId}`, claimed before anything
		// asynchronous happens after it. Two presses would otherwise write the
		// same files into the same directory concurrently and each report half
		// the progress.
		const { download, claimed } = claimDownload({
			modality,
			modelId: row.model,
			connectionId: endpoint.id,
			connectionModelId: row.id
		})
		watch(download, socket.user!.id, emitToUser)
		if (claimed) {
			lastPushAt.set(download.key, 0)
			download.settled = runWarm(download, endpoint, row, socket.user!.id)
		} else if (!activeDownload(modality, row.model)) {
			// It settled between `claimDownload` handing back the running entry
			// and this line, so the watcher just registered is on a key nothing
			// will ever clean up — and nothing will ever push to it either. The
			// response below already carries the settled state.
			forgetWatchers(download.key)
		}

		const res = await stateResponse(endpoint, row)
		emitToUser("connections:downloadModel", res)
		return res
	}
}

export const connectionsCancelModelDownload: Handler<
	Sockets.Connections.CancelModelDownload.Params,
	Sockets.Connections.CancelModelDownload.Response
> = {
	event: "connections:cancelModelDownload",
	handler: async (socket, params, emitToUser) => {
		const resolved = await gate(
			socket,
			"connections:cancelModelDownload",
			params.id,
			emitToUser
		)
		if (isRefusal(resolved))
			return {
				connectionId: params.id,
				modelId: params.modelId,
				local: {
					state: "not_downloaded",
					sizeBytes: null,
					loaded: false,
					addedByUser: false
				},
				error: resolved.error
			}
		const { endpoint, modality } = resolved
		const row = await modelRow(params.id, params.modelId)
		if (!row) {
			const error = "That model is not on this connection."
			emitToUser("connections:cancelModelDownload:error", { error })
			return {
				connectionId: params.id,
				modelId: params.modelId,
				local: {
					state: "not_downloaded",
					sizeBytes: null,
					loaded: false,
					addedByUser: false
				},
				error
			}
		}
		// Marking it is the whole of the cancel — see this file's header for
		// why nothing is interrupted and when the files are removed.
		const download = activeDownload(modality, row.model)
		if (download) download.cancelled = true
		const res = await stateResponse(endpoint, row)
		emitToUser("connections:cancelModelDownload", res)
		return res
	}
}

/**
 * Which model this modality's capability default names right now.
 *
 * Compared by model IDENTITY rather than by row id: two `connection_models`
 * rows can name one repo, and deleting the files because the OTHER row was
 * starred would stop the lane mid-job just the same.
 */
async function activeModelIdFor(
	modality: OnnxModality
): Promise<string | null> {
	const capability =
		modality === "embeddings" ? EMBEDDING_CAPABILITY : NER_CAPABILITY
	const registered = await capabilityDefault(db, capability)
	if (!registered?.connectionModelId) return null
	const row = await connectionModelById(db, registered.connectionModelId)
	return row?.model ?? null
}

export const connectionsRemoveModelFiles: Handler<
	Sockets.Connections.RemoveModelFiles.Params,
	Sockets.Connections.RemoveModelFiles.Response
> = {
	event: "connections:removeModelFiles",
	handler: async (socket, params, emitToUser) => {
		const fail = async (
			error: string,
			endpoint?: SelectConnection,
			row?: SelectConnectionModel
		) => {
			emitToUser("connections:removeModelFiles:error", { error })
			if (endpoint && row) return stateResponse(endpoint, row, error)
			return {
				connectionId: params.id,
				modelId: params.modelId,
				local: {
					state: "not_downloaded" as const,
					sizeBytes: null,
					loaded: false,
					addedByUser: false
				},
				error
			}
		}
		const resolved = await gate(
			socket,
			"connections:removeModelFiles",
			params.id,
			emitToUser
		)
		if (isRefusal(resolved)) return fail(resolved.error)
		const { endpoint, modality } = resolved
		const row = await modelRow(params.id, params.modelId)
		if (!row) return fail("That model is not on this connection.")

		if (activeDownload(modality, row.model))
			return fail(
				"That model is downloading. Cancel the download first.",
				endpoint,
				row
			)

		if ((await activeModelIdFor(modality)) === row.model)
			return fail(
				"The active model can't be removed from disk. Make another model active first.",
				endpoint,
				row
			)

		await removeCached(row.model, modality)
		await dropRegistryRow(row.model, modality)
		// ⚠ The `connection_models` row STAYS. A catalogue model comes straight
		// back on the next sync, and a user-added one has to stay put or the
		// person's own entry would disappear because they freed some disk.
		const declared = (row.extraJson as any)?.onnx
		if (declared && "dtype" in declared) {
			const { dtype: _dropped, ...rest } = declared
			await db
				.update(schema.connectionModels)
				.set({
					extraJson: {
						...((row.extraJson as any) ?? {}),
						onnx: rest
					}
				})
				.where(eq(schema.connectionModels.id, row.id))
		}

		const fresh = (await connectionModelById(db, row.id)) ?? row
		const res = await stateResponse(endpoint, fresh)
		emitToUser("connections:removeModelFiles", res)
		await emitToUser("connections:list", () => buildConnectionsList())
		await emitToUser("connections:models", () =>
			connectionModelsView(endpoint.id)
		)
		return res
	}
}

// ---------------------------------------------------------------------------
// Adding a model the list does not name
// ---------------------------------------------------------------------------

const HUB_ID = /^[\w.-]+\/[\w.-]+$/

/** The Hub's own sentence for a failed request, or a plain one of our own. */
async function hubRefusal(res: Response, hubId: string): Promise<string> {
	let sentence: string | null = null
	try {
		const body: any = await res.json()
		if (typeof body?.error === "string") sentence = body.error
	} catch {
		// Not JSON. The status line is what is left.
	}
	if (res.status === 404)
		return sentence
			? `${hubId}: ${sentence}`
			: `${hubId}: Repository not found.`
	if (res.status === 401 || res.status === 403)
		return sentence
			? `${hubId}: ${sentence}`
			: `${hubId} is private or gated, so it cannot be downloaded here.`
	return sentence
		? `${hubId}: ${sentence}`
		: `Hugging Face answered ${res.status} for ${hubId}.`
}

async function hubJson(
	url: string
): Promise<{ ok: true; body: any } | { ok: false; res: Response | null }> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
		if (!res.ok) return { ok: false, res }
		return { ok: true, body: await res.json() }
	} catch {
		return { ok: false, res: null }
	}
}

/** `B-PER`/`I-PER`/`O` → the label set a picker can show. */
function labelsFromId2Label(id2label: unknown): string[] {
	if (!id2label || typeof id2label !== "object") return []
	const out: string[] = []
	for (const raw of Object.values(id2label as Record<string, unknown>)) {
		if (typeof raw !== "string") continue
		const label = raw.replace(/^[BI]-/, "")
		if (!label || label === "O" || out.includes(label)) continue
		out.push(label)
	}
	return out
}

export const connectionsAddHubModel: Handler<
	Sockets.Connections.AddHubModel.Params,
	Sockets.Connections.AddHubModel.Response
> = {
	event: "connections:addHubModel",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			emitToUser("connections:addHubModel:error", { error })
			return { connectionId: params.id, error }
		}
		const resolved = await gate(
			socket,
			"connections:addHubModel",
			params.id,
			emitToUser
		)
		if (isRefusal(resolved)) return fail(resolved.error)
		const { endpoint, modality } = resolved

		// A row added here exists to be downloaded, which this machine
		// cannot do — refused before the Hub is asked anything.
		const unrunnable = await localOnnxRefusal()
		if (unrunnable) return fail(unrunnable)

		const hubId = (params.hubId ?? "").trim()
		if (!HUB_ID.test(hubId))
			return fail(
				"A Hugging Face model id looks like `organisation/model-name`."
			)

		const existing = await connectionModels(db, endpoint.id)
		if (existing.some((m) => m.model === hubId))
			return fail(`${hubId} is already listed on this connection.`)

		// ── The repo ────────────────────────────────────────────────────
		const info = await hubJson(
			`https://huggingface.co/api/models/${hubId}?blobs=true`
		)
		if (!info.ok)
			return fail(
				info.res
					? await hubRefusal(info.res, hubId)
					: `Hugging Face could not be reached to check ${hubId}.`
			)
		if (info.body?.private === true || info.body?.gated)
			return fail(
				`${hubId} is private or gated, so it cannot be downloaded here.`
			)
		const files: string[] = Array.isArray(info.body?.siblings)
			? info.body.siblings
					.map((s: any) => s?.rfilename)
					.filter((f: unknown): f is string => typeof f === "string")
			: []
		if (!files.some((f) => f.startsWith("onnx/") && f.endsWith(".onnx")))
			return fail(
				`${hubId} has no ONNX export (an \`onnx/\` folder), so it cannot run here.`
			)

		// ── The config ──────────────────────────────────────────────────
		const config = await hubJson(
			`https://huggingface.co/${hubId}/resolve/main/config.json`
		)
		if (!config.ok)
			return fail(
				config.res
					? await hubRefusal(config.res, hubId)
					: `Hugging Face could not be reached to read ${hubId}'s config.json.`
			)

		const hub: Record<string, unknown> = {}
		if (modality === "embeddings") {
			const hidden =
				config.body?.hidden_size ??
				config.body?.text_config?.hidden_size
			if (typeof hidden !== "number")
				return fail(
					`${hubId}'s config.json publishes no hidden size, so its vector width is unknown.`
				)
			hub.dimensions = hidden
		} else {
			const labels = labelsFromId2Label(config.body?.id2label)
			if (!labels.length)
				return fail(
					`${hubId}'s config.json publishes no id2label, so it is not an entity model.`
				)
			hub.labels = labels
		}
		const window =
			config.body?.max_position_embeddings ??
			config.body?.text_config?.max_position_embeddings
		if (typeof window === "number") hub.maxInputTokens = window

		const dtype =
			typeof params.dtype === "string" && params.dtype.trim()
				? params.dtype.trim()
				: undefined
		const [created] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: endpoint.id,
				model: hubId,
				name: hubId.split("/").pop() || hubId,
				enabled: true,
				extraJson: {
					onnx: {
						// The one flag that makes a row removable — see
						// `LocalModelState.addedByUser`.
						addedByUser: true,
						...(dtype ? { dtype } : {}),
						hub
					}
				}
			})
			.returning()

		const res = await connectionModelsView(endpoint.id)
		const createdView = res.models?.find((m) => m.id === created.id)
		const out: Sockets.Connections.AddHubModel.Response = {
			...res,
			...(createdView ? { created: createdView } : {})
		}
		emitToUser("connections:addHubModel", out)
		await emitToUser("connections:list", () => buildConnectionsList())
		return out
	}
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Settle every `downloading` ONNX row this process cannot be driving.
 *
 * Runs once, as a managed-service startup task. The map of live downloads is
 * per process and empty at boot, so every `format: "onnx"` row still saying
 * `downloading` belongs to a run that ended — a crash, a restart, a `kill`. Left
 * alone it would read as an in-flight download forever, and the one thing a
 * person could do about it (press Download again) would be refused as already
 * running.
 *
 * `error` rather than deleting the row, and rather than `complete`: whatever
 * partial files are on disk are real, the failure is real, and a row that says
 * so is what makes the retry button appear. The files themselves are left where
 * they are — transformers.js resumes by re-fetching only what is missing.
 */
export async function reconcileOnnxDownloadsOnBoot() {
	const stale = await db
		.update(schema.localModels)
		.set({
			status: "error",
			errorMessage: "Download interrupted by a restart"
		})
		.where(
			and(
				eq(schema.localModels.format, "onnx"),
				eq(schema.localModels.status, "downloading")
			)
		)
		.returning({ filename: schema.localModels.filename })
	// No download-failed notification here: who started a download is held
	// only in memory (the watcher map), never on the row, so an interrupted
	// one has nobody known to tell. The row's `error` state is the record.
	if (stale.length)
		console.log(
			`[onnx-download] settled ${stale.length} interrupted download(s): ${stale
				.map((r) => r.filename)
				.join(", ")}`
		)

	// ⚠ NOT awaited. `reconcileOnBoot` runs services in sequence and every one
	// after this waits on it — including KoboldCPP's orphan sweep. Warming the
	// list can mean a network fetch, and a boot must never be held by one.
	void warmRecommendedList()
}

/**
 * Bring the recommended list into this process, if anything here would use it.
 *
 * Not a fetch: a cached copy younger than 24h answers without touching the
 * network, which is the ordinary case on every boot after the first. What this
 * avoids is the FIRST `connections:list` paying for one — the list is awaited by
 * the row projection (every local ONNX row carries its catalogue) and by the
 * adapters' `listModels`, and an admin opening Connections should not be the one
 * waiting on GitHub.
 *
 * ⚠ Only when a local ONNX endpoint exists. An install that has never
 * configured one has nothing to warm, and a boot that reaches out anyway would
 * be a network call nobody asked for. Never throws, and never awaited by its
 * caller: a list that cannot be loaded falls back to the built-in catalogue
 * exactly as it does at any other moment.
 */
async function warmRecommendedList() {
	try {
		const [endpoint] = await db
			.select({ id: schema.connections.id })
			.from(schema.connections)
			.where(
				inArray(schema.connections.type, [
					CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
					CONNECTION_TYPE.LOCAL_ONNX_NER
				])
			)
			.limit(1)
		if (!endpoint) return
		const { recommendedEmbeddingModels, recommendedNerModels } =
			await import("$lib/server/localModels/onnxList")
		await Promise.all([
			recommendedEmbeddingModels(),
			recommendedNerModels()
		])
	} catch (err) {
		console.warn("[onnx-list] could not warm the recommended list:", err)
	}
}

export function registerLocalOnnxModelHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, connectionsDownloadModel, emitToUser)
	register(socket, connectionsCancelModelDownload, emitToUser)
	register(socket, connectionsRemoveModelFiles, emitToUser)
	register(socket, connectionsAddHubModel, emitToUser)
}
