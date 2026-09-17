/**
 * The RECOMMENDED LIST of local ONNX models, and the one shape the rest of the
 * app reads it in.
 *
 * Two YAML documents published at
 * `github.com/SerenePub/serene-pub-onnx-list` — `embeddings.yaml` and
 * `ner.yaml` — fetched, cached under the app data directory, and merged over
 * the two built-in catalogues (`embedding/models.ts`, `ner/models.ts`).
 *
 * ## Why a fetched list at all
 *
 * The built-in catalogues are five ids compiled into the build. A model that is
 * published, or one whose repo moves, cannot reach anybody without a release —
 * and the picker is the first screen somebody meets when they turn retrieval on.
 * So the list is data, the build carries a copy of last resort, and the two are
 * merged rather than switched between: a starred model that is only in the
 * built-in catalogue must never vanish from the picker because a fetch
 * succeeded.
 *
 * ## The three-step fallback, and why each step exists
 *
 *   1. **A cached copy younger than 24h is used without touching the network.**
 *      This is asked on every model list and every download, which is far more
 *      often than a curated list changes.
 *   2. **A fetch failure falls back to the cached copy at ANY age.** An
 *      offline instance keeps the list it last saw; a stale list is a better
 *      answer than an empty picker.
 *   3. **No cache and no network falls back to the built-in catalogues.** The
 *      part that always works.
 *
 * ## `last_token` pooling is EXCLUDED
 *
 * `embedding/index.ts` pools with `{ pooling: "mean" }` and nothing here can
 * change that: the pooling choice is baked into every vector already stored, so
 * changing it invalidates the index. A `last_token` model pooled with the mean
 * produces plausible, meaningless vectors — the one failure shape that looks
 * like it worked — so such an entry is dropped from the list rather than
 * offered. Removing this exclusion is a decision about stored vectors, not about
 * this file.
 *
 * ## Ids are never rewritten
 *
 * The `id` is what `pipeline()` is given, what the cache directory is named
 * after, and what every embedded row is stamped with. An entry whose id this
 * file changed would orphan an index.
 */

import type { EmbeddingModelDef } from "$lib/server/embedding/models"
import type { NerModelDef } from "$lib/server/ner/models"

/** The two local ONNX lanes. One word, used as a directory name and a list key. */
export type OnnxModality = "embeddings" | "ner"

/**
 * One list entry at the shape the wire carries it.
 *
 * `NonNullable`, because `LocalModelState.catalog` is optional on the ROW (a
 * model nothing published knows nothing) while a projection of a list entry
 * always produces an object — an absent KEY inside it is the honest answer for
 * a field that modality does not publish.
 */
export type OnnxCatalogView = NonNullable<
	Sockets.Connections.LocalModelState["catalog"]
>

const LIST_BASE =
	"https://raw.githubusercontent.com/SerenePub/serene-pub-onnx-list/main"

const LIST_FILE: Record<OnnxModality, string> = {
	embeddings: "embeddings.yaml",
	ner: "ner.yaml"
}

/** How long a cached copy is used without asking the network again. */
const FRESH_MS = 24 * 60 * 60 * 1000

/**
 * One entry as the YAML document writes it — snake_case, and every field
 * optional because a published document is not a type.
 *
 * ⚠ Validation is by REJECTION, entry by entry: a malformed row is dropped and
 * the rest of the list still loads. A whole list that fails to parse falls back;
 * one bad row must not.
 */
interface RawListEntry {
	id?: unknown
	name?: unknown
	dtype?: unknown
	size?: unknown
	dimensions?: unknown
	max_input_tokens?: unknown
	pooling?: unknown
	prefixes?: { query?: unknown; document?: unknown }
	labels?: unknown
	tier?: unknown
	tags?: unknown
	details?: {
		parameter_size?: unknown
		released?: unknown
		license?: unknown
		languages?: unknown
		description?: unknown
	}
}

const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() ? v.trim() : undefined

/**
 * A string kept EXACTLY as published — no trim.
 *
 * ⚠ For the prefixes only, and the reason is one character: `"query: "` ends in
 * a space, and trimming it turns `query: ` + `a dragon` into `query:a dragon`.
 * Every model on the list whose prefixes are mandatory would then be embedded
 * with a subtly wrong input, which is the class of defect that produces
 * plausible, worse vectors rather than an error.
 */
const verbatim = (v: unknown): string | undefined =>
	typeof v === "string" && v ? v : undefined

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined

const strArray = (v: unknown): string[] | undefined => {
	if (!Array.isArray(v)) return undefined
	const out = v.map(str).filter((s): s is string => !!s)
	return out.length ? out : undefined
}

const TIERS = ["fast", "balanced", "best"] as const
type Tier = (typeof TIERS)[number]
const tierOf = (v: unknown): Tier | undefined =>
	TIERS.includes(v as Tier) ? (v as Tier) : undefined

const POOLINGS = ["mean", "cls", "last_token"] as const
type Pooling = (typeof POOLINGS)[number]
const poolingOf = (v: unknown): Pooling | undefined =>
	POOLINGS.includes(v as Pooling) ? (v as Pooling) : undefined

/** The fields both defs share, lifted off a raw entry. */
function commonFields(raw: RawListEntry) {
	const sizeMb = num(raw.size)
	const d = raw.details ?? {}
	return {
		id: str(raw.id)!,
		name: str(raw.name) ?? str(raw.id)!,
		description: str(d.description) ?? "",
		sizeLabel: sizeMb != null ? `~${sizeMb} MB` : "",
		sizeMb,
		tier: tierOf(raw.tier),
		dtype: str(raw.dtype) as EmbeddingModelDef["dtype"],
		maxInputTokens: num(raw.max_input_tokens),
		tags: strArray(raw.tags),
		license: str(d.license),
		released: str(d.released),
		languages: str(d.languages),
		parameterSize: str(d.parameter_size)
	}
}

function embeddingEntry(raw: RawListEntry): EmbeddingModelDef | null {
	if (!str(raw.id) || !str(raw.name)) return null
	const dimensions = num(raw.dimensions)
	// A width nobody published is a width that would be guessed, and the guess
	// would be stamped onto an index.
	if (dimensions == null) return null
	const pooling = poolingOf(raw.pooling)
	// See the header: the loader pools with the mean and cannot be changed here.
	if (pooling === "last_token") return null
	const common = commonFields(raw)
	const query = verbatim(raw.prefixes?.query)
	const document = verbatim(raw.prefixes?.document)
	return {
		...common,
		tier: common.tier ?? "balanced",
		dimensions,
		...(pooling ? { pooling } : {}),
		...(query || document
			? {
					prefixes: {
						...(query ? { query } : {}),
						...(document ? { document } : {})
					}
				}
			: {})
	}
}

function nerEntry(raw: RawListEntry): NerModelDef | null {
	if (!str(raw.id) || !str(raw.name)) return null
	const labels = strArray(raw.labels)
	// The label set is the whole product of an entity model; an entry without
	// one cannot be described in a picker.
	if (!labels) return null
	return { ...commonFields(raw), labels }
}

/**
 * Merge a fetched list over a built-in catalogue.
 *
 * A UNION, fetched winning on a shared id. The fetched entry is the richer one
 * (it carries pooling, prefixes, an input window and a licence the compiled
 * catalogue never had), and the union is what guarantees a model somebody has
 * already starred keeps appearing even if the published list drops it.
 *
 * ⚠ **The result carries each id exactly once, first occurrence winning** —
 * including when the FETCHED half repeats one. A published document is data
 * from outside this build and can gain a duplicated entry between one release
 * and the next; the consumer of this list is a model sync whose
 * `(connection_id, model)` unique index refuses the second row, so a duplicate
 * that got this far would cost an endpoint its whole listing rather than show
 * one model twice. The two catalogues below overlap by design
 * (`Xenova/bert-base-NER` is in both), which is what makes this the ordinary
 * path rather than a defensive one.
 */
function mergeById<T extends { id: string }>(fetched: T[], builtIn: T[]): T[] {
	const have = new Set<string>()
	const out: T[] = []
	for (const m of [...fetched, ...builtIn]) {
		if (have.has(m.id)) continue
		have.add(m.id)
		out.push(m)
	}
	return out
}

// ---------------------------------------------------------------------------
// The cached copy on disk
// ---------------------------------------------------------------------------

/**
 * Where the raw YAML is kept.
 *
 * Beside the other caches under the app data directory rather than in the model
 * directories: this is a document about models, not a model, and a person
 * clearing model files should not lose the list that names them.
 */
export async function listCacheDir(): Promise<string> {
	// `utils/appDataDir` and never the `$lib/server/utils` barrel: that barrel
	// opens PGlite at module scope, and `embedding/models.ts` imports this file
	// — which is itself imported by the adapter, which has to stay light.
	const path = await import("node:path")
	const { getAppDataDir } = await import("$lib/server/utils/appDataDir")
	return path.join(getAppDataDir(), "cache", "onnx-list")
}

async function readCached(
	modality: OnnxModality
): Promise<{ text: string; ageMs: number } | null> {
	try {
		const path = await import("node:path")
		const fs = await import("node:fs/promises")
		const file = path.join(await listCacheDir(), LIST_FILE[modality])
		const [text, stat] = await Promise.all([
			fs.readFile(file, "utf8"),
			fs.stat(file)
		])
		return { text, ageMs: Date.now() - stat.mtimeMs }
	} catch {
		return null
	}
}

async function writeCached(modality: OnnxModality, text: string) {
	try {
		const path = await import("node:path")
		const fs = await import("node:fs/promises")
		const dir = await listCacheDir()
		await fs.mkdir(dir, { recursive: true })
		// Written beside and renamed: a half-written cache file read by the next
		// boot would parse as a truncated list rather than as a miss.
		const file = path.join(dir, LIST_FILE[modality])
		const tmp = `${file}.tmp-${process.pid}`
		await fs.writeFile(tmp, text, "utf8")
		await fs.rename(tmp, file)
	} catch (err) {
		// A cache that cannot be written is a slower list, not a failure.
		console.warn(`[onnx-list] could not cache ${modality} list:`, err)
	}
}

async function fetchList(modality: OnnxModality): Promise<string | null> {
	try {
		const res = await fetch(`${LIST_BASE}/${LIST_FILE[modality]}`, {
			signal: AbortSignal.timeout(15_000)
		})
		if (!res.ok) return null
		const text = await res.text()
		return text.trim() ? text : null
	} catch {
		return null
	}
}

/**
 * The `models:` array of one document, or null when the text is not a list this
 * file recognises.
 *
 * Null is the signal to fall through to the next source — a document that
 * arrived truncated, or an HTML error page a proxy substituted for the YAML,
 * must not empty a picker that a cached copy could still fill.
 */
async function parseEntries(text: string): Promise<RawListEntry[] | null> {
	try {
		// Dynamic for the same reason as `listCacheDir` — see there.
		const yaml = await import("yaml")
		const models = (yaml.parse(text) as any)?.models
		return Array.isArray(models) ? (models as RawListEntry[]) : null
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// The per-process memo
// ---------------------------------------------------------------------------

interface Memo<T> {
	at: number
	models: T[]
}

let embeddingMemo: Memo<EmbeddingModelDef> | null = null
let nerMemo: Memo<NerModelDef> | null = null
let embeddingInflight: Promise<EmbeddingModelDef[]> | null = null
let nerInflight: Promise<NerModelDef[]> | null = null

/**
 * The raw entries for one modality, from whichever of the three sources
 * answers first. Returns null when none did.
 */
async function loadRaw(modality: OnnxModality): Promise<RawListEntry[] | null> {
	const cached = await readCached(modality)
	if (cached && cached.ageMs < FRESH_MS) {
		const entries = await parseEntries(cached.text)
		if (entries) return entries
	}
	const fetched = await fetchList(modality)
	if (fetched) {
		const entries = await parseEntries(fetched)
		// Cached only once it parsed: storing a document we could not read would
		// mean re-reading the same unusable bytes for 24 hours.
		if (entries) {
			await writeCached(modality, fetched)
			return entries
		}
	}
	// The network said nothing usable. Whatever is on disk, however old.
	if (cached) {
		const entries = await parseEntries(cached.text)
		if (entries) return entries
	}
	return null
}

async function loadEmbeddingList(): Promise<EmbeddingModelDef[]> {
	const { EMBEDDING_MODELS } = await import("$lib/server/embedding/models")
	const raw = await loadRaw("embeddings")
	const fetched = (raw ?? [])
		.map(embeddingEntry)
		.filter((m): m is EmbeddingModelDef => m !== null)
	return mergeById(fetched, EMBEDDING_MODELS)
}

async function loadNerList(): Promise<NerModelDef[]> {
	const { NER_MODELS } = await import("$lib/server/ner/models")
	const raw = await loadRaw("ner")
	const fetched = (raw ?? [])
		.map(nerEntry)
		.filter((m): m is NerModelDef => m !== null)
	return mergeById(fetched, NER_MODELS)
}

/**
 * Every embedding model this build will offer: the published list merged over
 * the built-in catalogue.
 *
 * Memoised for the process and refreshed after 24h. Concurrent callers share one
 * load — a model list, a download and a connection test can all ask within a
 * second of each other, and three parallel fetches of the same document would be
 * three chances to write the cache file at once.
 */
export async function recommendedEmbeddingModels(): Promise<
	EmbeddingModelDef[]
> {
	if (embeddingMemo && Date.now() - embeddingMemo.at < FRESH_MS)
		return embeddingMemo.models
	if (!embeddingInflight) {
		embeddingInflight = loadEmbeddingList()
			.then((models) => {
				embeddingMemo = { at: Date.now(), models }
				return models
			})
			.finally(() => {
				embeddingInflight = null
			})
	}
	return embeddingInflight
}

/** The entity-model half of `recommendedEmbeddingModels`. Same contract. */
export async function recommendedNerModels(): Promise<NerModelDef[]> {
	if (nerMemo && Date.now() - nerMemo.at < FRESH_MS) return nerMemo.models
	if (!nerInflight) {
		nerInflight = loadNerList()
			.then((models) => {
				nerMemo = { at: Date.now(), models }
				return models
			})
			.finally(() => {
				nerInflight = null
			})
	}
	return nerInflight
}

/**
 * What the list said the last time it was loaded, without loading it.
 *
 * ⚠ Empty until something has awaited the async form, and that is deliberate:
 * `findModel` is synchronous and is called on the load path, where a network
 * fetch cannot be introduced. The list is warmed by every model list, download
 * and connection test, so by the time a load happens it is populated; before
 * then the built-in catalogue answers, which is the same answer it gave before
 * this file existed.
 */
export function recommendedEmbeddingSnapshot(): EmbeddingModelDef[] {
	return embeddingMemo?.models ?? []
}

export function recommendedNerSnapshot(): NerModelDef[] {
	return nerMemo?.models ?? []
}

/** Test seam — the memo is module state, and tests need a clean one. */
export function resetRecommendedLists() {
	embeddingMemo = null
	nerMemo = null
	embeddingInflight = null
	nerInflight = null
}

/**
 * One list entry as `LocalModelState.catalog` carries it.
 *
 * The wire shape is the union of what the two modalities publish, so one
 * projection serves both — an embedding entry has no `labels`, an entity entry
 * no `dimensions`, and an absent key is the honest answer for either.
 */
export function catalogView(
	def: EmbeddingModelDef | NerModelDef
): OnnxCatalogView {
	const embedding = def as EmbeddingModelDef
	const ner = def as NerModelDef
	const view: OnnxCatalogView = {}
	if (def.tier) view.tier = def.tier
	if (def.sizeMb != null) view.sizeMb = def.sizeMb
	if (def.dtype) view.dtype = def.dtype
	if (embedding.dimensions != null) view.dimensions = embedding.dimensions
	if (def.maxInputTokens != null) view.maxInputTokens = def.maxInputTokens
	if (embedding.pooling) view.pooling = embedding.pooling
	if (embedding.prefixes) view.prefixes = embedding.prefixes
	if (ner.labels) view.labels = ner.labels
	if (def.languages) view.languages = def.languages
	if (def.tags) view.tags = def.tags
	if (def.license) view.license = def.license
	if (def.released) view.released = def.released
	if (def.parameterSize) view.parameterSize = def.parameterSize
	if (def.description) view.description = def.description
	return view
}
