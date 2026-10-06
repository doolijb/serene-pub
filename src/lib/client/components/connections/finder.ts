/**
 * ONE model finder, over four catalogues and one search box.
 *
 * Concept ruling R3 (2026-09-17): the KoboldCPP manager's Available tab and
 * the Ollama manager's Available tab are retired in favour of a single finder
 * scoped by **capability** and **destination**. This module is that finder's
 * arithmetic — every decision it makes that is not markup:
 *
 * - which destinations can hold a model of this scope (`destinationsFor`),
 * - which rows the query keeps (`matchesQuery`),
 * - what each row's tier chip says and whether it is gold (`ggufTierLabel`,
 *   `onnxTierLabel`, and `memoryTier`'s `matchesTier` behind it),
 * - how four differently-shaped catalogue rows become one row shape
 *   (`kcppRecommendedRows`, `ollamaRecommendedRows`, `onnxRecommendedRows`,
 *   `kcppHubRows`, `ollamaHubRows`),
 * - and how two differently-shaped quant lists become one (`quantsFromKcpp`,
 *   `quantsFromOllama`).
 *
 * ## Why the shapes are reconciled here and not in the view
 *
 * The same rule `downloads.svelte.ts` follows for progress (R5): the seam is
 * the place that knows about every source, and nothing downstream branches on
 * which one a row came from. A view that held four `{#if source === …}` blocks
 * would have four subtly different row anatomies within a release.
 *
 * ## Vocabulary
 *
 * A **scope** is which of the four sections the person is shopping for — the
 * word *capability* is the transform id it maps to (`text->text`), and the
 * finder says *scope* for the pill the person pressed so the two can never be
 * confused at a call site (NOMENCLATURE R3).
 */
import { formatBytes, formatMegabytes } from "./modelManagement"
import {
	fitFor,
	fitSentence,
	matchesTier,
	type Fit,
	type MemoryTier
} from "./memoryTier"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	localOnnxDisabledReason,
	type LocalOnnxAvailability
} from "$lib/shared/utils/connectionServiceItems"

// ── Scopes ──────────────────────────────────────────────────────────────────

/** Which of the four sections the finder is shopping for. */
export type FinderScope = "chat" | "images" | "embeddings" | "entities"

export const FINDER_SCOPES: readonly {
	value: FinderScope
	label: string
	/** The transform id this scope is the star for (§10 capability default). */
	capability: string
	/**
	 * What the empty-destination sentence calls a model of this scope,
	 * article and all — "a chat model", "an image model". Written out rather
	 * than assembled from `capabilityLabel`, which answers "Image generation"
	 * and would put a capital in the middle of a sentence and leave the a/an
	 * to a rule that gets "an embeddings" wrong.
	 */
	phrase: string
}[] = [
	{
		value: "chat",
		label: "Chat",
		capability: "text->text",
		phrase: "a chat model"
	},
	{
		value: "images",
		label: "Images",
		capability: "text->image",
		phrase: "an image model"
	},
	{
		value: "embeddings",
		label: "Embeddings",
		capability: "text->embedding",
		phrase: "an embeddings model"
	},
	{
		value: "entities",
		label: "Entities",
		capability: "text->entities",
		phrase: "an entity model"
	}
]

export const DEFAULT_SCOPE: FinderScope = "chat"

/** The scope a transform id belongs to, or null for one no section stars. */
export function scopeForCapability(
	capability: string | null | undefined
): FinderScope | null {
	if (!capability) return null
	return FINDER_SCOPES.find((s) => s.capability === capability)?.value ?? null
}

export function capabilityForScope(scope: FinderScope): string {
	return FINDER_SCOPES.find((s) => s.value === scope)!.capability
}

export function scopePhrase(scope: FinderScope): string {
	return FINDER_SCOPES.find((s) => s.value === scope)!.phrase
}

/** Which KoboldCPP model directory a scope's files belong in. */
export function kcppKindForScope(scope: FinderScope): "text" | "image" | null {
	if (scope === "chat") return "text"
	if (scope === "images") return "image"
	return null
}

// ── Destinations ────────────────────────────────────────────────────────────

export type DestinationKind = "koboldcpp" | "ollama" | "onnx"

export interface Destination {
	/** Unique in the row: `<kind>:<connectionId>`. */
	id: string
	kind: DestinationKind
	connectionId: number
	/** What somebody called the connection. */
	title: string
	/** What it IS — the service chip's word (R5). */
	serviceLabel: string
	/**
	 * "<title> · KoboldCPP", the pill's whole label — or just the title when
	 * somebody called the connection by its service's own word, so the pill
	 * never reads "Ollama · Ollama".
	 */
	label: string
	/** Set only on a KoboldCPP destination: which directory this scope uses. */
	kcppKind?: "text" | "image"
	/**
	 * Why nothing can be downloaded here, as the sentence the pill and the
	 * note show. Only an ONNX destination on a machine whose runtime didn't
	 * load sets it: the pill stays, disabled, because the connection is real
	 * and a missing pill would read as a missing connection.
	 */
	disabledReason?: string
}

/** The fields of a `connections:list` row a destination is derived from. */
export interface DestinationRow {
	id?: number
	name?: string | null
	type?: string | null
}

/**
 * Which kinds can hold which scope, in the order the pills appear.
 *
 * Order is a judgement, not an accident: for chat and images the managed
 * runtime is what a person with no connections is being walked into, and for
 * the two local modalities the ONNX connection is the one this pub downloads
 * into itself rather than hands to another daemon.
 */
const SCOPE_KINDS: Record<FinderScope, readonly DestinationKind[]> = {
	chat: ["koboldcpp", "ollama"],
	images: ["koboldcpp"],
	embeddings: ["onnx", "ollama"],
	entities: ["onnx"]
}

const SERVICE_LABEL: Record<DestinationKind, string> = {
	koboldcpp: "KoboldCPP",
	ollama: "Ollama",
	onnx: "ONNX"
}

/** The connection types each kind accepts, per scope. */
function typesFor(kind: DestinationKind, scope: FinderScope): string[] {
	if (kind === "koboldcpp")
		// ONE KoboldCPP destination per install, whichever scope is on: one
		// endpoint serves chat and images, and the download's `kind` — not the
		// connection — decides which directory the file lands in. ⏳ The image
		// id is listed until the boot fold has retired it.
		return [
			CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		]
	if (kind === "ollama")
		// One Ollama connection per host serves every modality it has (owner
		// ruling 2026-09-25), so the chat row IS the embeddings destination.
		// `ollama-embeddings` stays listed after it only so a row the merge has
		// not reached yet still takes a download; the merge leaves none.
		return scope === "embeddings"
			? [CONNECTION_TYPE.OLLAMA, CONNECTION_TYPE.OLLAMA_EMBEDDINGS]
			: [CONNECTION_TYPE.OLLAMA]
	return scope === "entities"
		? [CONNECTION_TYPE.LOCAL_ONNX_NER]
		: [CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS]
}

/**
 * Every place a model of this scope could land.
 *
 * Derived from the list rather than from what is installable, so a pill is
 * never offered for a runtime this pub has no connection to — pressing it
 * would have nowhere to put the file.
 */
export function destinationsFor(
	scope: FinderScope,
	rows: readonly DestinationRow[],
	opts: {
		/** This machine's local ONNX verdict; absent reads as available. */
		localOnnx?: LocalOnnxAvailability | null
	} = {}
): Destination[] {
	const out: Destination[] = []
	const kcppKind = kcppKindForScope(scope) ?? undefined
	const onnxDisabled = localOnnxDisabledReason(opts.localOnnx)
	for (const kind of SCOPE_KINDS[scope]) {
		const types = typesFor(kind, scope)
		// KoboldCPP is one destination however many managed rows exist: the
		// types array is in preference order, so the text row wins when both
		// are present and the image row stands in when it is all there is.
		const matching = rows.filter(
			(r) => r.id != null && r.type && types.includes(r.type)
		)
		const chosen =
			kind === "koboldcpp"
				? matching
						.slice()
						.sort(
							(a, b) =>
								types.indexOf(a.type as string) -
								types.indexOf(b.type as string)
						)
						.slice(0, 1)
				: matching
		for (const row of chosen) {
			const title = row.name?.trim() || SERVICE_LABEL[kind]
			out.push({
				id: `${kind}:${row.id}`,
				kind,
				connectionId: row.id as number,
				title,
				serviceLabel: SERVICE_LABEL[kind],
				label:
					title.toLowerCase() === SERVICE_LABEL[kind].toLowerCase()
						? title
						: `${title} · ${SERVICE_LABEL[kind]}`,
				...(kind === "koboldcpp" && kcppKind ? { kcppKind } : {}),
				...(kind === "onnx" && onnxDisabled
					? { disabledReason: onnxDisabled }
					: {})
			})
		}
	}
	return out
}

/**
 * The caller's connection if it can take this scope; else the first that can
 * take a download NOW; else the first.
 *
 * "The first" alone defaulted Chat to a KoboldCPP that was not installed while
 * Ollama sat running beside it (walk 2026-09-24, plan C6) — the finder's first
 * screen offered Get buttons that led nowhere.
 *
 * A disabled destination is never "ready", whatever `isReady` says: Embeddings
 * on a machine without the ONNX runtime opens on Ollama when there is one. It
 * is still the answer when the caller asked for it or nothing else exists, so
 * the finder shows its reason rather than an empty pane.
 */
export function pickDestination(
	destinations: readonly Destination[],
	connectionId?: number | null,
	isReady: (destination: Destination) => boolean = () => true
): Destination | null {
	if (connectionId != null) {
		const asked = destinations.find((d) => d.connectionId === connectionId)
		if (asked) return asked
	}
	return (
		destinations.find((d) => !d.disabledReason && isReady(d)) ??
		destinations[0] ??
		null
	)
}

/**
 * Where a destination's files land, as a sentence fragment — or, on a
 * destination nothing can be downloaded to, why not.
 */
export function landingNote(
	destination: Destination,
	kcppModelsDir?: string | null
): string {
	if (destination.disabledReason) return destination.disabledReason
	switch (destination.kind) {
		case "koboldcpp":
			return kcppModelsDir?.trim()
				? `Files land in ${kcppModelsDir.trim()}`
				: "Files land in the KoboldCPP models folder"
		case "ollama":
			return "Pulled into Ollama"
		default:
			return "Downloaded into Serene Pub"
	}
}

// ── Query ───────────────────────────────────────────────────────────────────

/**
 * Substring, case-insensitive, over whichever fields a row has.
 *
 * Never fuzzy: the names here are `TheBloke/Mistral-7B-Instruct`
 * and `bge-small-en-v1.5`, and a fuzzy match over strings that dense returns
 * everything for almost every query.
 */
export function matchesQuery(
	query: string,
	...fields: (string | null | undefined)[]
): boolean {
	const needle = query.trim().toLowerCase()
	if (!needle) return true
	return fields.some((f) => !!f && f.toLowerCase().includes(needle))
}

// ── Tier chips ──────────────────────────────────────────────────────────────

/**
 * The shared GGUF YAML's own tier names, from its `recommended_vram`.
 *
 * The same ladder both managers' Available tabs printed, kept to the letter:
 * a person who has seen "Mainstream" beside a model once should not meet a
 * different word for the same number here.
 */
export function ggufTierLabel(
	recommendedVramGb: number | null | undefined
): string | null {
	if (recommendedVramGb == null || !Number.isFinite(recommendedVramGb))
		return null
	if (recommendedVramGb <= 3) return "Ultra Budget"
	if (recommendedVramGb <= 6) return "Budget"
	if (recommendedVramGb <= 10) return "Mainstream"
	if (recommendedVramGb <= 16) return "High-End"
	return "Enthusiast"
}

/**
 * The recommended list's three tiers (§10 *recommended list*).
 *
 * ⚠ A row the list says nothing about — one added by Hub id — gets NO chip
 * rather than a fourth word. A tier is a claim the catalogue makes, and one
 * invented for a row nobody graded is a claim this app would be making up.
 */
export function onnxTierLabel(tier: string | null | undefined): string | null {
	if (tier === "fast") return "Fast"
	if (tier === "balanced") return "Balanced"
	if (tier === "best") return "Best"
	return null
}

// ── One row shape, four catalogues ──────────────────────────────────────────

export interface FinderTier {
	label: string
	/** Gold when the model the chip is on fits the person's memory tier. */
	matches: boolean
}

/** What is already true of a row's model on this machine. */
export type RowPresence = "on_disk" | "pulled" | null

export interface FinderRow {
	/** Stable within its group. */
	key: string
	name: string
	/** Formatted, or null when nothing quoted a size. */
	sizeLabel: string | null
	/** The middle clause: "7B", "384 dims", "9 labels". */
	facts: string | null
	description: string | null
	/** Human tags from the list's own vocabulary — see `displayTags`. */
	tags: string[]
	tier: FinderTier | null
	/** The file this row would fetch, when the catalogue quotes one. */
	bytes: number | null
	/** Its own size against the memory tier — the gold-button rule. */
	fit: Fit
	presence: RowPresence
	/** 0–100 while this row's own download runs, or null. */
	percent: number | null
	downloading: boolean
}

/**
 * "TheBloke · 1.4 GB · 7B" — the FACTS line. Absent clauses simply drop.
 *
 * ⚠ **The description is not in here**, and was until 2026-09-25. Four clauses
 * joined with `·` into one `truncate` line meant the description was cut off
 * on all but the widest column — the row quoted a sentence it never showed.
 * It has its own line-clamped line on the card now, so this carries only what
 * fits: who published it, how big it is, and what shape it is.
 */
export function secondLine(row: FinderRow): string {
	return [repoOwner(row.name), row.sizeLabel, row.facts]
		.filter((part): part is string => !!part && part.length > 0)
		.join(" · ")
}

/**
 * A repo id split so the row's TITLE is the part that identifies the model.
 *
 * `unsloth/Qwen3.5-4B-GGUF` renders as **Qwen3.5-4B-GGUF** with `unsloth` on
 * the second line. The owner is real information here — people choose a
 * finetuner deliberately, which is not true once a model is installed — so it
 * moves rather than going away. What it stops doing is eating the width: with
 * the owner in the title every row read `bartowski/MN-12B-Lyra-...`,
 * `TheDrummer/Snowpiercer-...`, `mradermacher/Peach-2.0...`, cut in the middle
 * of the only part that differs.
 *
 * ⚠ **Not `nameFromIdentifier`.** That strips the format, the quantisation and
 * the parameter count, which is right for a list of models you already chose
 * and wrong here: the finder lists four sizes of one model at once, and
 * `Qwen3.5-4B-GGUF` and `Qwen3.5-9B-GGUF` would both render as "Qwen3.5".
 */
export function repoTitle(name: string): string {
	const raw = name?.trim() ?? ""
	if (!raw.includes("/")) return raw
	return raw.slice(raw.lastIndexOf("/") + 1) || raw
}

/** The owner of a `owner/repo` id, or empty for a bare name (an Ollama tag). */
export function repoOwner(name: string): string {
	const raw = name?.trim() ?? ""
	const cut = raw.lastIndexOf("/")
	return cut > 0 ? raw.slice(0, cut) : ""
}

/** The index of the first row that outright fits, or -1. */
export function primaryRowIndex(rows: readonly FinderRow[]): number {
	return rows.findIndex((r) => r.fit === "fits" && !r.presence)
}

// The catalogues' own shapes, named locally. Two of them are `any` on the
// wire (the Ollama family predates the typed socket), so the fields this
// module reads are declared here rather than asserted at each access.

type KcppResult = Sockets.KoboldCPP.SearchModels.ModelResult
type KcppRecommended = Sockets.KoboldCPP.RecommendedModels.RecommendedModel

export interface OllamaRecommended {
	name: string
	pull?: string
	/** The list's tag vocabulary; `embedding` marks an embedding model. */
	tags?: string[]
	/** GB, as the YAML quotes it. */
	size?: number
	recommended_vram?: number
	details?: {
		parameter_size?: string
		quantization_level?: string
		description?: string
	}
}

export interface OllamaHubResult {
	name: string
	description?: string
	tags?: string[]
	downloads?: number
	likes?: number
	pullOptions?: { label?: string; pull?: string }[]
}

/** The `local` half of a `connections:list` model row. */
export interface OnnxModelRow {
	id: number
	name: string
	local?: Sockets.Connections.LocalModelState
}

/**
 * The bytes a recommended GGUF row should quote.
 *
 * The recommended quant if the repo publishes one, because that is the file
 * the Get button will actually offer first; otherwise the smallest, which is
 * the one a person short of memory is being shown the row for at all.
 */
export function headlineBytes(
	options: readonly { sizeBytes?: number; label?: string }[]
): number | null {
	const recommended = options.find((o) => isRecommendedQuantLabel(o.label))
	if (recommended?.sizeBytes) return recommended.sizeBytes
	const sized = options
		.map((o) => o.sizeBytes)
		.filter((b): b is number => !!b && Number.isFinite(b))
	if (!sized.length) return null
	return Math.min(...sized)
}

/** Q4_K_M is the balance llama.cpp's own naming makes a claim about. */
export function isRecommendedQuantLabel(label: string | null | undefined) {
	return !!label && label.includes("Q4_K_M")
}

/** Q2/Q3 (and their IQ variants) buy their size with quality. */
export function isLowQualityQuant(label: string | null | undefined) {
	return !!label && /^I?Q[23]/i.test(label.trim())
}

export interface RowContext {
	tier: MemoryTier
	query: string
	/** Model identifiers the destination already holds. */
	present: ReadonlySet<string>
}

/** The recommended GGUF rows a KoboldCPP destination offers. */
export function kcppRecommendedRows(
	models: readonly KcppRecommended[],
	ctx: RowContext
): FinderRow[] {
	return models
		.filter((m) => matchesQuery(ctx.query, m.name, m.description))
		.map((m) => {
			// The Hub's sibling list rarely quotes sizes; the list's own figure
			// is what the row (and its fit) is judged by when it does not.
			const bytes =
				headlineBytes(m.pullOptions ?? []) ?? m.sizeBytes ?? null
			const label = ggufTierLabel(m.recommendedVram)
			const onDisk =
				ctx.present.has(m.name) ||
				(m.pullOptions ?? []).some((o) => ctx.present.has(o.filename))
			return {
				key: `kcpp:${m.name}`,
				name: m.name,
				sizeLabel: formatBytes(bytes),
				facts: m.parameterSize || null,
				description: m.description || null,
				tags: displayTags(m.tags),
				tier: label
					? {
							label,
							matches: matchesTier(m.recommendedVram, ctx.tier)
						}
					: null,
				bytes,
				fit: fitFor(bytes, ctx.tier),
				presence: onDisk ? ("on_disk" as const) : null,
				percent: null,
				downloading: false
			}
		})
}

/** The recommended rows an Ollama destination offers. */
export function ollamaRecommendedRows(
	models: readonly OllamaRecommended[],
	ctx: RowContext
): FinderRow[] {
	return models
		.filter((m) =>
			matchesQuery(ctx.query, m.name, m.details?.description, m.pull)
		)
		.map((m) => {
			// The YAML quotes GB; the Hub and every other size on this screen
			// are decimal, so one divisor for all of them.
			const bytes =
				m.size && Number.isFinite(m.size)
					? m.size * 1_000_000_000
					: null
			const label = ggufTierLabel(m.recommended_vram)
			const pull = m.pull || m.name
			return {
				key: `ollama:${pull}`,
				name: m.name,
				sizeLabel: formatBytes(bytes),
				facts: m.details?.parameter_size || null,
				description: m.details?.description || null,
				// `embedding` is the kind, already said by the scope this row
				// was fetched for — not a chip anyone needs to read.
				tags: displayTags(m.tags).filter((t) => t !== "embedding"),
				tier: label
					? {
							label,
							matches: matchesTier(m.recommended_vram, ctx.tier)
						}
					: null,
				bytes,
				fit: fitFor(bytes, ctx.tier),
				presence:
					ctx.present.has(pull) || ctx.present.has(m.name)
						? ("pulled" as const)
						: null,
				percent: null,
				downloading: false
			}
		})
}

/**
 * The rows a local ONNX connection could still fetch.
 *
 * Its "recommended list" is the connection's own models: the fetched
 * catalogue is projected into `connection_models` at sync, so there is no
 * second list to merge. A model already ON DISK is left out: this is a list of
 * downloads, and one that mixed in the models already here was the complaint
 * (walk 2026-09-24, plan C2). The finder says how many are here instead, and
 * links to them. Arriving and failed rows stay — they are downloads too.
 */
export function onnxRecommendedRows(
	models: readonly OnnxModelRow[],
	ctx: RowContext,
	modality: "embeddings" | "entities"
): FinderRow[] {
	return models
		.filter((m) => m.local?.state !== "on_disk")
		.filter((m) =>
			matchesQuery(ctx.query, m.name, m.local?.catalog?.description)
		)
		.map((m) => {
			const catalog = m.local?.catalog
			const bytes =
				m.local?.sizeBytes ??
				(catalog?.sizeMb ? catalog.sizeMb * 1_000_000 : null)
			const label = onnxTierLabel(catalog?.tier)
			const facts =
				modality === "embeddings"
					? catalog?.dimensions
						? `${catalog.dimensions} dims`
						: null
					: catalog?.labels?.length
						? `${catalog.labels.length} labels`
						: null
			const state = m.local?.state
			return {
				key: `onnx:${m.id}`,
				name: m.name,
				sizeLabel:
					formatBytes(m.local?.sizeBytes) ??
					formatMegabytes(catalog?.sizeMb),
				facts,
				description: catalog?.description || null,
				// The ONNX catalogue carries no tag vocabulary.
				tags: [],
				tier: label
					? { label, matches: fitFor(bytes, ctx.tier) === "fits" }
					: null,
				bytes,
				fit: fitFor(bytes, ctx.tier),
				presence: state === "on_disk" ? ("on_disk" as const) : null,
				percent: m.local?.percent ?? null,
				downloading: state === "downloading"
			}
		})
}

// ── The Hugging Face group ──────────────────────────────────────────────────

export interface HubRow {
	key: string
	/** "org/name", as the Hub spells it. */
	name: string
	/** "7B · 12 sizes · 1.2M downloads · apache-2.0". */
	detail: string
	/** How many files the picker will have to show. */
	fileCount: number
	/** The repo's own sentence. Null when the Hub was quiet. */
	description: string | null
	/** Human tags only — see `displayTags`. Empty when there are none. */
	tags: string[]
}

/**
 * The tags worth showing a person.
 *
 * ⚠ **Machine metadata is dropped.** Hugging Face answers with the licence,
 * the region, the arXiv id, the base model and the datasets all spelled as
 * `prefix:value` tags, mixed in with the human ones (`text-generation`,
 * `conversational`, `en`). The old Ollama manager rendered
 * `tags.slice(0, 4)` raw, so a row's four chips were routinely
 * `license:apache-2.0`, `region:us`, `arxiv:2401.04088`, `base_model:…` —
 * four chips and not one of them a fact anybody reads a chip for.
 *
 * The licence is not lost: `hubDetail` already lifts it into the facts line,
 * which is where one belongs.
 *
 * Deduped and order-preserving, because the Hub repeats itself.
 */
export function displayTags(
	tags: readonly string[] | null | undefined
): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const raw of tags ?? []) {
		const tag = String(raw ?? "").trim()
		if (!tag || tag.includes(":")) continue
		const key = tag.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(tag)
	}
	return out
}

/** "1.2M" / "12k" / "431" — compact, because the row has three other clauses. */
export function formatCount(n: number | null | undefined): string | null {
	if (n == null || !Number.isFinite(n) || n < 0) return null
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`
	return String(Math.round(n))
}

/** The Hub spells a licence as a `license:<id>` tag and nowhere else. */
export function licenseFromTags(
	tags: readonly string[] | null | undefined
): string | null {
	const tag = (tags ?? []).find((t) => t.startsWith("license:"))
	return tag ? tag.slice("license:".length) : null
}

/**
 * "<params> · N sizes · <downloads> downloads · <licence>".
 *
 * Every clause is optional and an absent one is DROPPED, never rendered as
 * "unknown": the two searches answer with different fields, and a line of
 * blanks says the app failed rather than that the Hub was quiet.
 */
export function hubDetail(facts: {
	parameterSize?: string | null
	fileCount?: number
	downloads?: number | null
	license?: string | null
	fileNoun?: string
}): string {
	const parts: string[] = []
	if (facts.parameterSize) parts.push(facts.parameterSize)
	if (facts.fileCount != null && facts.fileCount > 0) {
		const noun = facts.fileNoun ?? "size"
		parts.push(
			`${facts.fileCount} ${noun}${facts.fileCount === 1 ? "" : "s"}`
		)
	}
	const downloads = formatCount(facts.downloads)
	if (downloads) parts.push(`${downloads} downloads`)
	if (facts.license) parts.push(facts.license)
	return parts.join(" · ")
}

/** Most-downloaded first; ties keep the Hub's own order. */
export function rankHub<T extends { downloads?: number | null }>(
	models: readonly T[]
): T[] {
	return models
		.map((model, index) => ({ model, index }))
		.sort(
			(a, b) =>
				(b.model.downloads ?? 0) - (a.model.downloads ?? 0) ||
				a.index - b.index
		)
		.map((entry) => entry.model)
}

export function kcppHubRows(models: readonly KcppResult[]): HubRow[] {
	return rankHub(models).map((m) => ({
		key: `hub:${m.name}`,
		name: m.name,
		fileCount: m.pullOptions?.length ?? 0,
		description: m.description || null,
		// The KoboldCPP search answers with no tags at all — not an empty
		// list it could have filled, a field it does not send.
		tags: [],
		detail: hubDetail({
			fileCount: m.pullOptions?.length ?? 0,
			downloads: m.downloads,
			// No tags, so no licence clause is available on this side — see
			// the module header's rule about absent clauses.
			license: null
		})
	}))
}

export function ollamaHubRows(models: readonly OllamaHubResult[]): HubRow[] {
	return rankHub(models).map((m) => ({
		key: `hub:${m.name}`,
		name: m.name,
		fileCount: m.pullOptions?.length ?? 0,
		description: m.description || null,
		tags: displayTags(m.tags),
		detail: hubDetail({
			fileCount: m.pullOptions?.length ?? 0,
			downloads: m.downloads,
			license: licenseFromTags(m.tags)
		})
	}))
}

// ── Quants ──────────────────────────────────────────────────────────────────

/**
 * One file in the quant picker, whichever list it came from.
 *
 * `url` and `tag` are the two ways a file is asked for and exactly one is
 * set: KoboldCPP fetches a URL itself, Ollama is told a tag and fetches it.
 * `bytes` is optional because the Ollama search does not quote one — see the
 * picker's own note about what that costs.
 */
export interface QuantFile {
	/** "Q4_K_M", or a whole filename for an image checkpoint. */
	name: string
	bytes?: number
	/** KoboldCPP: the file to fetch. */
	url?: string
	/** KoboldCPP: what it will be called on disk. */
	filename?: string
	/** Ollama: the tag to pull. */
	tag?: string
	recommended: boolean
}

export function quantsFromKcpp(
	model: KcppResult,
	kind: "text" | "image"
): QuantFile[] {
	return (model.pullOptions ?? []).map((option) => ({
		name: option.label,
		bytes: option.sizeBytes,
		url: option.downloadUrl,
		filename: option.filename,
		// An image row's labels are whole checkpoint names, not precisions, so
		// the Q4_K_M claim is not one that can be made about them (the same
		// rule `availableTab.isRecommendedQuant` states).
		recommended: kind === "text" && isRecommendedQuantLabel(option.label)
	}))
}

export function quantsFromOllama(model: OllamaHubResult): QuantFile[] {
	return (model.pullOptions ?? [])
		.filter((option) => !!option.pull)
		.map((option) => ({
			name: option.label || (option.pull as string),
			tag: option.pull as string,
			recommended: isRecommendedQuantLabel(option.label)
		}))
}

export type QuantFitTone = "good" | "warn" | "bad" | "muted"

export interface QuantFitNote {
	tone: QuantFitTone
	sentence: string
}

/**
 * The picker's second line: what this file costs on this machine.
 *
 * Null when there is nothing honest to say — "Not sure" suppresses every hint
 * by design, and the Ollama search quotes no byte size at all, so its rows
 * carry a name and nothing else rather than a fit computed from a number
 * nobody supplied.
 */
export function quantFit(
	quant: QuantFile,
	tier: MemoryTier
): QuantFitNote | null {
	const fit = fitFor(quant.bytes, tier)
	if (fit === "unknown") return null
	if (fit === "fits" && isLowQualityQuant(quant.name))
		return { tone: "muted", sentence: "Fits · lower quality" }
	const sentence = fitSentence(fit, tier)
	if (!sentence) return null
	const tone: QuantFitTone =
		fit === "fits" ? "good" : fit === "tight" ? "warn" : "bad"
	return { tone, sentence }
}

// ── One ask at a time ───────────────────────────────────────────────────────

/**
 * Serialises asks whose replies carry no echo of what was asked. The Hub
 * searches and the recommended lists answer on a bare event, so two asks in
 * flight can land out of order and the older one would overwrite the newer.
 * With one in flight and the latest queued behind it, every reply that is
 * not stale is the answer to the newest ask; a reply that lands while another
 * ask is queued is stale by construction and is dropped.
 */
export class SerialAsk {
	private inFlight = false
	private queued: (() => void) | null = null

	/** True while a reply is owed. */
	get pending() {
		return this.inFlight
	}

	/** Emit now, or hold this ask until the owed reply lands. Only the latest
	 * held ask survives — an ask nobody can see the answer to is never sent. */
	ask(emit: () => void) {
		if (this.inFlight) {
			this.queued = emit
			return
		}
		this.inFlight = true
		emit()
	}

	/**
	 * Called first thing in every reply handler. Returns `true` when the reply
	 * is stale (a newer ask was waiting, and has now been sent), so the
	 * handler returns without touching state.
	 */
	settle(): boolean {
		this.inFlight = false
		const next = this.queued
		if (!next) return false
		this.queued = null
		this.ask(next)
		return true
	}

	/** Forget everything — on unmount or a destination change. */
	reset() {
		this.inFlight = false
		this.queued = null
	}
}
