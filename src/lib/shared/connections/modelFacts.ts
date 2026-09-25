/**
 * What a HOST said about one of its models, in one shape.
 *
 * ## Why this exists
 *
 * `normalizeProbedModels` (beside this file) reduced every listing to
 * `{ model, name }`, and every other key a host sent died there. That was fine
 * while the only consumer was a `<select>`. It is the reason no screen in the
 * app can say how big a model's context is, what a message costs, or which
 * quantisation is on disk — the facts arrive on every sync and are thrown away
 * before the database sees them.
 *
 * OpenRouter sends `context_length` and `pricing` on every entry. Ollama sends
 * `details.parameter_size`, `details.quantization_level` and `size`. LM Studio's
 * SDK hands over `maxContextLength` and `paramsString`. The managed KoboldCPP
 * adapter already JOINs `local_models`, which holds `quantization` and
 * `size_bytes`, and drops both. None of that needed a new request; it needed a
 * place to put it.
 *
 * ## Sparse by construction, and never inferred
 *
 * Every field is optional and an absent field means **unknown**, which renders
 * as `—`. That is the same rule `connectionRowStatus` states for sentences: a
 * silent fact is left out, never guessed. A local GGUF has a quantisation and no
 * price; a cloud model has a price and no quantisation; one table shows both and
 * neither invents the other.
 *
 * ⚠ **Not `connection_models.context_window`.** That column is the *admin's
 * override* — "how many tokens this model can actually hold, or NULL for the
 * sampling config decides" — and exactly one place reads it (`dispatchStep`).
 * `facts.contextWindow` is *what the host claimed*. They are two different
 * questions and NOMENCLATURE R5 applies: reconcile at the seam, never merge. A
 * sync writes only `facts`; nothing about a person's override is touched by a
 * host changing its mind.
 *
 * ⚠ Client-safe. No adapter import, no SDK import, no Svelte — the sync writes
 * it on the server, the model table renders it in the browser, and the test
 * suite reads it with neither.
 */

/** Where a fact bag came from. One per bag, not per field. */
export type ModelFactsSource =
	/** The service's own listing — the strongest claim available. */
	| "host"
	/** A recommended list (the GGUF YAML, the ONNX lists). */
	| "list"
	/** Read off a file this install owns. */
	| "file"

/** Money a service charges, per million tokens. */
export interface ModelPricing {
	/** Per million INPUT tokens, in `currency`. */
	inPerMTok?: number
	/** Per million OUTPUT tokens. */
	outPerMTok?: number
	/**
	 * ISO 4217. Always spelled, never assumed: a service that bills in credits
	 * and one that bills in dollars print the same number otherwise.
	 */
	currency?: string
}

/**
 * Everything a host may say about one model. Every field optional.
 *
 * ⚠ Additive only. A new fact is a new optional field here plus a column in the
 * model table; every service that does not have it keeps rendering `—`. Nothing
 * else in the app has to learn about it.
 */
export interface ModelFacts {
	/** Tokens the model can hold, as the HOST reports it. Never an override. */
	contextWindow?: number
	/** The most tokens it will write in one reply. */
	maxOutputTokens?: number
	/** What it costs. Absent for anything local, which is free by construction. */
	pricing?: ModelPricing
	/** "12.2B", "7B" — the host's own string, not parsed into a number. */
	parameters?: string
	/** "Q4_K_M", "IQ4_XS". Meaningless for a cloud model; absent there. */
	quantization?: string
	/** The weights on disk. Absent for anything this install does not hold. */
	sizeBytes?: number
	/** "llama", "qwen2" — the architecture family. */
	family?: string
	/** ISO 8601. Kept as the host's date, never re-derived from a version. */
	released?: string
	/**
	 * What the model accepts, in the host's own words ("text", "image", "file").
	 *
	 * ⚠ **Not a capability claim.** The app's capability layer
	 * (`connection_models.capabilities`) is graded and probed and is what the
	 * resolver reads; this is a label a host printed, good enough to show in a
	 * "Can do" column and not good enough to route on.
	 */
	inputModalities?: string[]
	/** Vector width, for an embedding model. */
	dimensions?: number
	/** One line the host wrote. Display only; never parsed. */
	description?: string
	/** Where this bag came from. */
	source: ModelFactsSource
}

/** True when a bag carries nothing worth storing beyond its provenance. */
export function factsAreEmpty(facts: ModelFacts | null | undefined): boolean {
	if (!facts) return true
	return !Object.entries(facts).some(
		([key, value]) => key !== "source" && value != null
	)
}

// ── Reading one entry ───────────────────────────────────────────────────────

const num = (v: unknown): number | undefined => {
	if (typeof v === "number" && Number.isFinite(v)) return v
	if (typeof v === "string" && v.trim()) {
		const n = Number(v)
		if (Number.isFinite(n)) return n
	}
	return undefined
}

/**
 * A string, or nothing.
 *
 * ⚠ `"unknown"` is NOTHING. Ollama answers `quantization_level: "unknown"` for
 * a model whose GGUF does not record one, and taking it literally put the word
 * "unknown" in the quantisation slot of a model row — which reads as a fact
 * about the file rather than as the absence of one. Absent is `—`; the app does
 * not have a third thing to say here.
 */
const str = (v: unknown): string | undefined => {
	if (typeof v !== "string") return undefined
	const t = v.trim()
	if (!t) return undefined
	const lower = t.toLowerCase()
	if (lower === "unknown" || lower === "none" || lower === "n/a")
		return undefined
	return t
}

const strList = (v: unknown): string[] | undefined => {
	if (!Array.isArray(v)) return undefined
	const out = v.map(str).filter((s): s is string => !!s)
	return out.length ? out : undefined
}

/** Drop every key whose value is nullish, so an empty bag really is `{}`. */
function compact(facts: ModelFacts): ModelFacts {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(facts)) {
		if (value == null) continue
		if (Array.isArray(value) && !value.length) continue
		if (typeof value === "object" && !Array.isArray(value)) {
			const inner = compact(value as unknown as ModelFacts)
			if (factsAreEmpty({ ...inner, source: facts.source })) continue
			out[key] = inner
			continue
		}
		out[key] = value
	}
	return out as unknown as ModelFacts
}

/**
 * OpenRouter (and any OpenAI-compatible host generous enough to copy it).
 *
 * ⚠ Its prices are **per token, as strings** — `"0.000003"` — so the ×1e6 here
 * is the whole reason this is not a field copy. A free model prices at `"0"`,
 * which is a real answer and must survive as `0` rather than being dropped as
 * falsy.
 */
function readOpenAiCompatible(e: Record<string, unknown>): ModelFacts {
	const pricing = e.pricing as Record<string, unknown> | undefined
	const architecture = e.architecture as Record<string, unknown> | undefined
	const topProvider = e.top_provider as Record<string, unknown> | undefined
	const perMTok = (v: unknown): number | undefined => {
		const n = num(v)
		return n == null ? undefined : n * 1_000_000
	}
	const created = num(e.created)
	return compact({
		contextWindow: num(e.context_length) ?? num(e.max_context_length),
		maxOutputTokens:
			num(topProvider?.max_completion_tokens) ??
			num(e.max_completion_tokens),
		pricing: pricing
			? {
					inPerMTok: perMTok(pricing.prompt),
					outPerMTok: perMTok(pricing.completion),
					currency: "USD"
				}
			: undefined,
		inputModalities:
			strList(architecture?.input_modalities) ??
			(str(architecture?.modality)
				? // "text+image->text" — the left side is what it accepts.
					str(architecture?.modality)!.split("->")[0].split("+")
				: undefined),
		description: str(e.description),
		// Unix seconds, which is what every OpenAI-shaped host sends.
		released: created ? new Date(created * 1000).toISOString() : undefined,
		source: "host"
	})
}

/** Ollama's `/api/tags`: the sizes are bytes and `details` holds the rest. */
function readOllama(e: Record<string, unknown>): ModelFacts {
	const details = e.details as Record<string, unknown> | undefined
	return compact({
		parameters: str(details?.parameter_size),
		quantization: str(details?.quantization_level),
		family: str(details?.family),
		sizeBytes: num(e.size),
		released: str(e.modified_at),
		source: "host"
	})
}

/** LM Studio's SDK, whose fields are already camelCase and already typed. */
function readLmStudio(e: Record<string, unknown>): ModelFacts {
	return compact({
		contextWindow: num(e.maxContextLength),
		parameters: str(e.paramsString),
		quantization: str(e.quantization),
		family: str(e.architecture),
		sizeBytes: num(e.sizeBytes),
		inputModalities: e.vision === true ? ["text", "image"] : undefined,
		source: "host"
	})
}

/**
 * Anything that already speaks this shape: the Anthropic catalogue constant, the
 * managed KoboldCPP rows carrying their `local_models` join, an ONNX listing.
 *
 * A nested `facts` object is passed through rather than re-read, because the
 * producer knew more than a guess from key names ever could.
 */
function readDeclared(e: Record<string, unknown>): ModelFacts | null {
	const declared = e.facts
	if (!declared || typeof declared !== "object") return null
	const f = declared as Record<string, unknown>
	const pricing = f.pricing as Record<string, unknown> | undefined
	return compact({
		contextWindow: num(f.contextWindow),
		maxOutputTokens: num(f.maxOutputTokens),
		pricing: pricing
			? {
					inPerMTok: num(pricing.inPerMTok),
					outPerMTok: num(pricing.outPerMTok),
					currency: str(pricing.currency) ?? "USD"
				}
			: undefined,
		parameters: str(f.parameters),
		quantization: str(f.quantization),
		sizeBytes: num(f.sizeBytes),
		family: str(f.family),
		released: str(f.released),
		inputModalities: strList(f.inputModalities),
		dimensions: num(f.dimensions),
		description: str(f.description),
		source:
			(str(f.source) as ModelFactsSource | undefined) &&
			["host", "list", "file"].includes(String(f.source))
				? (f.source as ModelFactsSource)
				: "host"
	})
}

/**
 * Every fact one listing entry carries, or `null` when it carries none.
 *
 * Shape-sniffed rather than switched on the connection type, deliberately: the
 * OpenAI-compatible family is nine services wide and growing by preset, a host
 * may answer in a shape its type does not predict, and the sniff costs one
 * property test. An entry that matches nothing yields `null`, which stores as no
 * facts at all rather than as an empty object nobody can tell from a failure.
 */
export function readModelFacts(entry: unknown): ModelFacts | null {
	if (!entry || typeof entry !== "object") return null
	const e = entry as Record<string, unknown>

	// A producer that already speaks ModelFacts wins over any sniff.
	const declared = readDeclared(e)
	if (declared && !factsAreEmpty(declared)) return declared

	let facts: ModelFacts | null = null
	if (e.details && typeof e.details === "object") facts = readOllama(e)
	else if (e.maxContextLength != null || e.paramsString != null)
		facts = readLmStudio(e)
	else if (
		e.pricing != null ||
		e.context_length != null ||
		e.architecture != null ||
		e.top_provider != null
	)
		facts = readOpenAiCompatible(e)

	if (!facts || factsAreEmpty(facts)) return null
	return facts
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * "200k", "32k", "1.2M" — a context window as a person reads it.
 *
 * Its own formatter and not `modelManagement.formatTokens`, which rounds to `k`
 * from 1000 and so prints a 1,048,576-token window as "1049k".
 */
export function formatContext(
	tokens: number | null | undefined
): string | null {
	if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return null
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000
		return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`
	}
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
	return String(tokens)
}

/**
 * "$3.00", "$0.80", "Free" — a price per million tokens.
 *
 * ⚠ `0` is **Free**, not "unknown" and not "$0.00". A host that prices a model
 * at zero is making a claim, and it is the claim a person most wants to see.
 */
export function formatPrice(
	perMTok: number | null | undefined,
	currency = "USD"
): string | null {
	if (perMTok == null || !Number.isFinite(perMTok) || perMTok < 0) return null
	if (perMTok === 0) return "Free"
	const symbol = currency === "USD" ? "$" : `${currency} `
	if (perMTok < 0.01) return `${symbol}${perMTok.toFixed(4)}`
	if (perMTok < 1) return `${symbol}${perMTok.toFixed(2)}`
	return `${symbol}${perMTok.toFixed(2)}`
}
