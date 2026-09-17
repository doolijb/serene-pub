/**
 * Embeddings from an ONNX model running in THIS process.
 *
 * No wire, no key, no host: `@huggingface/transformers` loads a feature-
 * extraction pipeline and the weights sit in the app data directory. Which is
 * why this adapter is the thinnest of the three — the work it would otherwise do
 * is residency (load, idle-unload, readiness), and residency belongs to the
 * instance rather than to a call. `$lib/server/embedding` owns that and has
 * since long before embeddings were connections; this delegates to it.
 *
 * ⚠ **Every reference to `@huggingface/transformers` must stay behind a dynamic
 * import**, here and in everything this reaches. `onnxruntime-node` is a native
 * addon with no Android build, and a static import crashes server boot on a
 * phone whether or not anybody configured local embeddings — the same rule the
 * adapter registry's thunks exist for.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports,
	type EmbeddingModelOption
} from "./BaseEmbeddingAdapter"
import { EMBEDDING_MODELS } from "$lib/server/embedding/models"
import { recommendedEmbeddingModels } from "$lib/server/localModels/onnxList"

export class LocalOnnxEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(req: EmbedRequest): Promise<EmbedResult> {
		if (req.input.length === 0)
			return {
				vectors: [],
				model: req.model ?? this.connection.model ?? "",
				dimensions: 0
			}

		const model = req.model ?? this.connection.model
		if (!model)
			throw new Error(
				"This local embeddings connection names no model. Choose one on the connection."
			)

		// Refused HERE, against this adapter's own list, rather than deep inside
		// the loader. The loader checks platform support first, so on a machine
		// where `onnxruntime-node` will not load, a mistyped model name would
		// come back as "local embeddings are not available on this system" —
		// two different problems wearing one sentence. The catalogue is checked
		// without touching the database; the registry is consulted only on a
		// miss, so the common path stays one array scan.
		if (!EMBEDDING_MODELS.some((m) => m.id === model)) {
			const { models } = await listModels(this.connection)
			if (!models.some((m) => m.model === model))
				throw new Error(`Unknown embedding model: ${model}`)
		}

		// Dynamic, and not only for Android: `embedding/index` is the module that
		// holds the loaded pipeline, and importing it statically from here would
		// make the adapter registry's thunk pointless.
		const { loadEmbeddingModel, batchEmbed, getLoadedModelId } =
			await import("$lib/server/embedding/index")
		// Idempotent when the right model is already up, which is the common
		// case: the queue loads once and then embeds thousands of rows.
		if (getLoadedModelId() !== model) await loadEmbeddingModel(model)
		const vectors = await batchEmbed(req.input)
		return {
			vectors,
			model,
			dimensions: vectors[0]?.length ?? 0
		}
	}
}

/**
 * What this machine can embed with: the recommended list, plus any ONNX file
 * the local model registry holds whose modality is `embeddings`.
 *
 * Both halves matter and neither replaces the other. The list is curated models
 * with known widths and sizes, which is what a first-time setup needs;
 * `local_models` is whatever the user actually downloaded, and its `modality`
 * column is the one place that says an `.onnx` file is an embedding model rather
 * than a generator (`kind` cannot: the header sniff files a BERT as `text`).
 *
 * ⚠ The list is the PUBLISHED one merged over the compiled catalogue
 * (`localModels/onnxList`), never the compiled catalogue alone — the ids are the
 * same ids, and a model list that showed three of them while the download screen
 * offered nine would be two catalogues wearing one name.
 *
 * The registry half is behind a dynamic import and a try/catch because a model
 * list must still answer when the database is unavailable — the catalogue is the
 * part that always works.
 */
async function listModels(
	_connection: SelectConnection
): Promise<{ models: EmbeddingModelOption[]; error?: string }> {
	// ⚠ One id, one entry, first occurrence winning — across BOTH halves. The
	// consumer is `syncConnectionModels`, whose `(connection_id, model)` unique
	// index refuses a second row for an id it already wrote: a listing that
	// named one model twice would abort that endpoint's whole sync rather than
	// show a duplicate. The halves genuinely overlap (a downloaded model is
	// usually a catalogue model), so this is the ordinary path.
	const catalogue: EmbeddingModelOption[] = []
	const have = new Set<string>()
	const add = (option: EmbeddingModelOption) => {
		if (!option.model || have.has(option.model)) return
		have.add(option.model)
		catalogue.push(option)
	}

	for (const m of await recommendedEmbeddingModels())
		add({
			model: m.id,
			name: m.name,
			dimensions: m.dimensions,
			description: `${m.tier} · ${m.sizeLabel} · ${m.description}`
		})

	try {
		const { db } = await import("$lib/server/db")
		const schema = await import("$lib/server/db/schema")
		const { and, eq } = await import("drizzle-orm")
		const rows = await db
			.select({
				modelName: schema.localModels.modelName,
				filename: schema.localModels.filename,
				description: schema.localModels.description
			})
			.from(schema.localModels)
			.where(
				and(
					eq(schema.localModels.modality, "embeddings"),
					eq(schema.localModels.status, "complete")
				)
			)
		for (const r of rows)
			add({
				model: r.modelName || r.filename,
				name: r.modelName || r.filename,
				description: r.description ?? "Downloaded model"
			})
	} catch (e: any) {
		return { models: catalogue, error: e?.message ?? String(e) }
	}

	return { models: catalogue }
}

/**
 * Whether this machine can run a local model at all.
 *
 * A probe rather than a platform denylist, and it is the runtime's own probe
 * (`getLocalEmbeddingUnsupportedReason` attempts the real import once and caches
 * whether it threw) — so the answer here and the answer the loader gives are one
 * fact. Predicting it from `process.platform` is what went stale when upstream
 * dropped Intel Mac support mid-release.
 */
async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }> {
	const { getLocalEmbeddingUnsupportedReason } = await import(
		"$lib/server/embedding/index"
	)
	const reason = await getLocalEmbeddingUnsupportedReason()
	if (reason) return { ok: false, error: reason }
	// The endpoint only: connections have no default model, so a test names
	// none. Reachability is the platform probe above; the catalogue rides
	// along for the models section to offer.
	const { models } = await listModels(connection)
	return { ok: true, extra: { models } }
}

const exports: EmbeddingAdapterExports = {
	Adapter: LocalOnnxEmbeddingAdapter,
	listModels,
	testConnection
}

export default exports
