/**
 * Where a person goes to add or remove a model on each kind of endpoint.
 *
 * The rows themselves are populated by the sync (`server/connections/modelSync`)
 * for every type alike — what differs per type is what a person can DO about
 * the list from the connections sidebar:
 *
 * - **Runtime-owned** (Ollama, managed KoboldCPP text and image): models are
 *   pulled, downloaded and deleted in that manager, and the connection's
 *   rows follow it. The sidebar offers no Add and no Remove here, only a
 *   door to the manager — two places to delete a gguf is one place too many.
 * - **Local ONNX** (embeddings, entities): the listing is the recommended
 *   list plus the local model registry, so a hand-typed id would be a row
 *   nothing can load — which is why `manualAddAllowed` is false here and the
 *   group's own **Add from Hugging Face…** form is the add instead: it takes
 *   an `org/name` and the server validates it against the Hub before a row
 *   exists. The rows themselves ARE actionable — download, cancel, retry,
 *   make active — through `rowAction` below.
 * - **Everything else** (OpenAI-compatible, Anthropic, LM Studio, llama.cpp,
 *   plain KoboldCPP, A1111, OpenAI embeddings): a person may name a model by
 *   hand — a compatible host that serves no `/models`, a catalogue that lags
 *   a launch, a llama.cpp that lists only what is loaded — and may remove a
 *   row they have finished with.
 *
 * Client-only: the server has no per-type policy, deliberately (see the sync
 * module's header). This table is about controls, not about truth.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"

/**
 * A runtime this pub RUNS, whose own view owns this endpoint's models.
 *
 * `panel` keeps its name and its two values — they are the manager kinds
 * `enableManager` takes — but it is not a `panelsCtx.openPanel` key: the
 * managers fold into their connection with the 2026-09-17 ruling (R2),
 * so the door it opens is that connection's view.
 */
export interface ModelManager {
	panel: "ollama" | "koboldcpp"
	label: string
}

/** The runtime that owns this endpoint's models, or null. */
export function managerFor(
	type: string | null | undefined
): ModelManager | null {
	if (!type) return null
	if (isKoboldCppManagedType(type))
		return { panel: "koboldcpp", label: "KoboldCPP" }
	if (
		type === CONNECTION_TYPE.OLLAMA ||
		type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
	)
		return { panel: "ollama", label: "Ollama" }
	return null
}

const LOCAL_ONNX_TYPES: readonly string[] = [
	CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
	CONNECTION_TYPE.LOCAL_ONNX_NER
]

/** Runs in this process off a catalogue and the local registry. */
export function isLocalOnnxType(type: string | null | undefined): boolean {
	return !!type && LOCAL_ONNX_TYPES.includes(type)
}

/** Whether the sidebar offers a free-text Add on this endpoint. */
export function manualAddAllowed(type: string | null | undefined): boolean {
	if (!type) return false
	if (managerFor(type)) return false
	if (isLocalOnnxType(type)) return false
	return true
}

/** Whether the sidebar offers Remove on this endpoint's rows. Same rule. */
export function removeAllowed(type: string | null | undefined): boolean {
	return manualAddAllowed(type)
}

/**
 * Endpoints whose API names ONE model — the one it happens to have loaded —
 * rather than a set a person could choose between.
 *
 * llama.cpp's `/v1/models` answers with the single model the server was
 * started on; a plain (external) KoboldCPP has no admin API at all, so it
 * cannot be asked to switch and does not reliably say what it is running.
 * Neither offers a choice, so neither gets a Models tab.
 */
const SINGLE_MODEL_TYPES: readonly string[] = [
	CONNECTION_TYPE.LLAMACPP,
	CONNECTION_TYPE.KOBOLDCPP
]

/**
 * Whether this endpoint's API lists models a person can SELECT — which is
 * what earns a connection view its Models tab (owner ruling 2026-09-25:
 * every connection has Settings; Models appears only where there is a
 * choice to make; the tab strip is drawn only when there is more than one
 * tab).
 *
 * ⚠ Not "has model rows". Every type can hold rows — a person may name one
 * by hand on any endpoint `manualAddAllowed` admits — so a row count would
 * make the tab appear and vanish as a sync lands, flipping the view under
 * somebody's cursor. This is a fact about the API, and it does not move.
 *
 * ⚠ Defaults to TRUE for a type not named here, matching this module's
 * header ("everything else … may name a model by hand"). A new type that
 * cannot list should be added to `SINGLE_MODEL_TYPES`; the opposite mistake —
 * a new listing API hidden behind no tab — would leave its models
 * unselectable, which is the worse failure.
 */
export function listsAvailableModels(
	type: string | null | undefined
): boolean {
	if (!type) return false
	return !SINGLE_MODEL_TYPES.includes(type)
}

/**
 * One sentence on where this endpoint's models come from, for the group and
 * the model view. Null where the list is simply what the host says and a
 * person may add to it.
 */
export function modelsSourceHint(
	type: string | null | undefined
): string | null {
	const manager = managerFor(type)
	if (manager)
		return `Models are downloaded and removed in the ${manager.label} connection; this list follows it.`
	if (isLocalOnnxType(type))
		return "Models come from the recommended list and anything added by Hugging Face id. Download one to this machine, then make it active."
	return null
}

/**
 * What KIND of endpoint a row belongs to, for the one branch the index really
 * has: a group's shape, and what a row in it can be asked to do.
 *
 * Five values and no sixth: they are the four cases with their own status
 * line, header badge and row action, plus everything else. ⚠ Not a modality —
 * a modality says what a model is FOR (§10), and two of these share one
 * (`local-onnx` and `ollama-embeddings` are both `embeddings`) while one
 * endpoint of kind `koboldcpp-managed` serves three.
 */
export type EndpointKind =
	| "koboldcpp-managed"
	| "ollama"
	| "onnx-embeddings"
	| "onnx-entities"
	| "api"

export function endpointKind(type: string | null | undefined): EndpointKind {
	if (isKoboldCppManagedType(type ?? "")) return "koboldcpp-managed"
	if (
		type === CONNECTION_TYPE.OLLAMA ||
		type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
	)
		return "ollama"
	if (type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS) return "onnx-embeddings"
	if (type === CONNECTION_TYPE.LOCAL_ONNX_NER) return "onnx-entities"
	return "api"
}

/** True for the two kinds whose rows carry `local` disk state. */
export function isOnnxKind(kind: EndpointKind): boolean {
	return kind === "onnx-embeddings" || kind === "onnx-entities"
}

/**
 * The ONE action a model row offers beside opening it.
 *
 * ⚠ One, never a menu. The row itself is the button that opens the model, and
 * every other control for a pair lives in its detail view; what is left out
 * here is the thing a person came to the list to do — get the files, or put
 * this model in charge.
 *
 * `makeActive` is never a write of its own. It is the same
 * registration as the star everywhere else (§10 capability default), so the
 * view routes it through `onSelectDefault(model, { kind: "one", capability })`
 * and the costed confirmation appears. A second path that skipped the dialog
 * would throw a person's stored vectors away without the sentence saying so.
 */
export type RowActionVerb =
	| "download"
	| "cancel"
	| "retry"
	| "makeActive"
	| "load"
	| "cancelKcpp"

export interface RowAction {
	verb: RowActionVerb
	label: string
}

/** The fields of a model row this decision reads. */
export interface RowActionRow {
	/** What the endpoint answers to — a managed KoboldCPP's is its GGUF filename. */
	model: string
	local?: {
		state?: "not_downloaded" | "downloading" | "on_disk" | "error"
	} | null
}

/** Facts the row cannot know about itself. */
export interface RowActionContext {
	/** A capability default already points at this pair. */
	isDefault?: boolean
	/** The managed process has this file resident. */
	kcppLoaded?: boolean
	/** An unfinished KoboldCPP download names this file. */
	kcppDownloading?: boolean
}

export function rowAction(
	kind: EndpointKind,
	row: RowActionRow,
	ctx: RowActionContext = {}
): RowAction | null {
	if (isOnnxKind(kind)) {
		switch (row.local?.state) {
			case "downloading":
				return { verb: "cancel", label: "Cancel" }
			case "error":
				return { verb: "retry", label: "Retry" }
			case "on_disk":
				return ctx.isDefault
					? null
					: { verb: "makeActive", label: "Make active" }
			case "not_downloaded":
				return { verb: "download", label: "Download" }
			default:
				// No `local` at all: the server has not answered for this row
				// yet, and an action guessed from silence is one that fails on
				// press. The row still opens.
				return null
		}
	}
	if (kind === "koboldcpp-managed") {
		if (ctx.kcppDownloading) return { verb: "cancelKcpp", label: "Cancel" }
		if (ctx.kcppLoaded) return null
		return { verb: "load", label: "Load" }
	}
	// Ollama's models are the manager's, and an API's are the host's: there is
	// nothing this list can do to either that is not already a door elsewhere.
	return null
}

// ── Formatting the facts a row shows ────────────────────────────────────────
//
// Decimal units (1 MB = 1,000,000 bytes), because that is what the Hub's own
// size figures are and a row that says 420 MB beside a page that says 440 MB
// reads as two different files.

const MB = 1_000_000
const GB = 1_000_000_000

/** "1.2 GB" / "420 MB" / "980 kB". Null for an absent or nonsense size. */
export function formatBytes(bytes: number | null | undefined): string | null {
	if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
	if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
	if (bytes >= MB) return `${Math.round(bytes / MB)} MB`
	return `${Math.max(1, Math.round(bytes / 1000))} kB`
}

/** The recommended list quotes megabytes; the same ladder from there. */
export function formatMegabytes(mb: number | null | undefined): string | null {
	if (mb == null || !Number.isFinite(mb) || mb < 0) return null
	return formatBytes(mb * MB)
}

/**
 * A context or input length as people say it: 8192 → "8k", 512 → "512",
 * 128000 → "128k".
 *
 * ⚠ Two ladders, on purpose. Token limits are quoted in both conventions — a
 * local model's 8192 and 32768 are binary, a cloud model's 128000 and 200000
 * are decimal — and one divisor gets half of them wrong ("33k context" for a
 * 32768 window). Decimal is asked FIRST and binary is the fallback, not the
 * other way round: 128000 is 125 × 1024, so a binary-first rule answers "125k"
 * for the one number every OpenAI page calls 128k.
 */
export function formatTokens(n: number | null | undefined): string | null {
	if (n == null || !Number.isFinite(n) || n <= 0) return null
	if (n < 1000) return String(Math.round(n))
	const divisor = n % 1000 === 0 ? 1000 : n % 1024 === 0 ? 1024 : 1000
	return `${Math.round(n / divisor)}k`
}

/** A row this module can place in a tier and order within it. */
export interface OnnxOrderableRow {
	name: string
	local?: {
		catalog?: {
			tier?: "fast" | "balanced" | "best"
			sizeMb?: number
		} | null
	} | null
}

const ONNX_TIER_ORDER = ["fast", "balanced", "best", "added"] as const
const KNOWN_ONNX_TIERS: ReadonlySet<string> = new Set([
	"fast",
	"balanced",
	"best"
])

/**
 * The recommended list's three tiers, in order, then whatever a person
 * added — each tier's rows by size ascending (undefined last), then name.
 *
 * A pure grouping-and-sort so the rule ("the small one before the good one")
 * has a test of its own rather than living only in a template's `{#each}`.
 */
export function orderOnnxRows<T extends OnnxOrderableRow>(
	rows: T[]
): { tier: string; rows: T[] }[] {
	const buckets = new Map<string, T[]>()
	for (const row of rows) {
		const tier = row.local?.catalog?.tier
		const key = tier && KNOWN_ONNX_TIERS.has(tier) ? tier : "added"
		const bucket = buckets.get(key)
		if (bucket) bucket.push(row)
		else buckets.set(key, [row])
	}
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) => {
			const sizeA = a.local?.catalog?.sizeMb
			const sizeB = b.local?.catalog?.sizeMb
			if (sizeA == null && sizeB != null) return 1
			if (sizeA != null && sizeB == null) return -1
			if (sizeA != null && sizeB != null && sizeA !== sizeB)
				return sizeA - sizeB
			return a.name.localeCompare(b.name)
		})
	}
	return ONNX_TIER_ORDER.filter((key) => buckets.has(key)).map((key) => ({
		tier: key,
		rows: buckets.get(key) as T[]
	}))
}

/**
 * "0.4 of 1.2 GB" — one unit for both halves, so the two numbers can be
 * compared at a glance. Null when the total is unknown, because "0.4 of ? GB"
 * is a progress bar that says nothing.
 */
export function formatProgress(
	downloaded: number | null | undefined,
	total: number | null | undefined,
	unit: "MB" | "GB"
): string | null {
	if (total == null || !Number.isFinite(total) || total <= 0) return null
	const divisor = unit === "GB" ? GB : MB
	const done = Number.isFinite(downloaded ?? NaN) ? (downloaded as number) : 0
	const scale = (n: number) => {
		const v = n / divisor
		return v >= 10
			? String(Math.round(v))
			: (Math.round(v * 10) / 10).toFixed(1)
	}
	return `${scale(done)} of ${scale(total)} ${unit}`
}
