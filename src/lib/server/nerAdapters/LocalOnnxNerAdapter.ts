/**
 * Named entities from an ONNX model running in THIS process.
 *
 * No wire, no key, no host: `@huggingface/transformers` loads a
 * token-classification pipeline and the weights sit in the app data directory.
 * Which is why this adapter is thin — the work it would otherwise do is
 * residency (load, idle-unload, readiness) and span arithmetic, and both belong
 * to the instance rather than to a call. `$lib/server/ner` owns them.
 *
 * ⚠ **Every reference to `@huggingface/transformers` must stay behind a dynamic
 * import**, here and in everything this reaches. `onnxruntime-node` is a native
 * addon with no Android build, and a static import crashes server boot on a
 * phone whether or not anybody configured local entity extraction — the same
 * rule the adapter registry's thunks exist for.
 */

import {
	BaseNerAdapter,
	type EntitySpan,
	type ExtractEntitiesRequest,
	type NerAdapterExports,
	type NerModelOption,
	type NerResidency
} from "./BaseNerAdapter"
import { NER_MODELS } from "$lib/server/ner/models"
import { recommendedNerModels } from "$lib/server/localModels/onnxList"

export class LocalOnnxNerAdapter extends BaseNerAdapter {
	async extractEntities(req: ExtractEntitiesRequest): Promise<EntitySpan[]> {
		// Before the model is named, let alone loaded: the lane annotates
		// whatever is stale, and a row whose annotated text is empty must not
		// wake a model to be told it says nothing.
		if (!req.text.trim()) return []

		const model = req.model ?? this.connection.model
		if (!model)
			throw new Error(
				"This entity connection names no model. Choose one on the connection."
			)

		// Dynamic, and not only for Android: `ner/index` is the module that holds
		// the loaded pipeline, and importing it statically from here would make
		// the adapter registry's thunk pointless.
		const { loadNerModel, extractNerSpans, getLoadedNerModelId } =
			await import("$lib/server/ner")

		// The annotation lane's path, row after row: its broker loaded this model,
		// and the loader refused anything unknown on the way in. Checking the
		// list again here would cost a registry query per row for a downloaded
		// model.
		if (getLoadedNerModelId() === model)
			return await extractNerSpans(req.text)

		// Refused HERE, against this adapter's own list, rather than deep inside
		// the loader. The loader checks platform support first, so on a machine
		// where `onnxruntime-node` will not load, a mistyped model name would
		// come back as "local entity extraction is not available on this system"
		// — two different problems wearing one sentence. The catalogue is checked
		// without touching the database; the registry is consulted only on a
		// miss, so the common path stays one array scan.
		if (!NER_MODELS.some((m) => m.id === model)) {
			const { models } = await listModels(this.connection)
			if (!models.some((m) => m.model === model))
				throw new Error(`Unknown entity model: ${model}`)
		}

		// A caller with no broker behind it (a test, a one-off extraction) loads
		// on demand. The lane never reaches this line: its broker leased the
		// model resident before the row was picked.
		await loadNerModel(model)
		return await extractNerSpans(req.text)
	}
}

/**
 * This backend's residency, for the annotation lane's broker: `$lib/server/ner`,
 * the module that holds the loaded pipeline.
 *
 * ⚠ Built from the module's own functions rather than handed over as an object
 * it exports, so every test that stubs `$lib/server/ner` stubs this too.
 */
async function residency(): Promise<NerResidency> {
	const {
		getLoadedNerModelId,
		isNerModelLoading,
		isNerModelReady,
		loadNerModel,
		setNerTtlMinutes
	} = await import("$lib/server/ner")
	return {
		resident: () => (isNerModelReady() ? getLoadedNerModelId() : null),
		loading: () => isNerModelLoading(),
		async load(model, ttlMinutes) {
			// Set before the load so the idle timer starts on the connection's
			// own number rather than on the previous star's.
			setNerTtlMinutes(ttlMinutes)
			await loadNerModel(model)
		}
	}
}

/**
 * What this machine can extract with: the recommended list, plus any ONNX file
 * the local model registry holds whose modality is `ner`.
 *
 * Both halves matter and neither replaces the other. The list is curated models
 * with known label sets and sizes, which is what a first-time setup needs;
 * `local_models` is whatever the user actually downloaded, and its `modality`
 * column is the one place that says an `.onnx` file is an entity model rather
 * than an embedding one (`kind` cannot: the header sniff files a BERT as
 * `text`).
 *
 * ⚠ The list is the PUBLISHED one merged over the compiled catalogue
 * (`localModels/onnxList`) — the same ids, and the same reasoning as the
 * embedding adapter next door.
 *
 * The registry half is behind a dynamic import and a try/catch because a model
 * list must still answer when the database is unavailable — the catalogue is the
 * part that always works.
 */
async function listModels(
	_connection: SelectConnection
): Promise<{ models: NerModelOption[]; error?: string }> {
	// ⚠ One id, one entry, first occurrence winning — across BOTH halves, for
	// the reason the embedding adapter next door states: the consumer is
	// `syncConnectionModels`, whose `(connection_id, model)` unique index
	// refuses a second row for an id it already wrote, so a listing naming one
	// model twice would abort that endpoint's whole sync.
	const catalogue: NerModelOption[] = []
	const have = new Set<string>()
	const add = (option: NerModelOption) => {
		if (!option.model || have.has(option.model)) return
		have.add(option.model)
		catalogue.push(option)
	}

	for (const m of await recommendedNerModels())
		add({
			model: m.id,
			name: m.name,
			description: `${m.sizeLabel} · ${m.labels.join(", ")} · ${m.description}`
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
					eq(schema.localModels.modality, "ner"),
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
 * (`getLocalNerUnsupportedReason` attempts the real import once and caches
 * whether it threw) — so the answer here and the answer the loader gives are one
 * fact. Predicting it from `process.platform` is what went stale when upstream
 * dropped Intel Mac support mid-release.
 */
async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }> {
	const { getLocalNerUnsupportedReason } = await import("$lib/server/ner")
	const reason = await getLocalNerUnsupportedReason()
	if (reason) return { ok: false, error: reason }
	// The endpoint only: connections have no default model, so a test names
	// none. Reachability is the platform probe above; the catalogue rides
	// along for the models section to offer.
	const { models } = await listModels(connection)
	return { ok: true, extra: { models } }
}

const exports: NerAdapterExports = {
	Adapter: LocalOnnxNerAdapter,
	listModels,
	testConnection,
	residency
}

export default exports
