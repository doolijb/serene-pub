/**
 * The context window — computed **once**, here, for everything that sizes to it (R-8).
 *
 * ## Why one function
 *
 * It was computed four ways. `core:task/context-budget@1` read
 * `sampling.contextTokens || 4096` and `responseTokens || 512` with a safety
 * margin; the reply dispatch handed every adapter a literal `tokenLimit: 4096`;
 * `dispatchStep` read `connection.contextWindow ?? values.contextTokens ?? 4096`
 * with no margin; and the config panel showed `(contextTokens - responseTokens)
 * × 0.95` with the margin hard-coded. Each was a defensible local decision, and
 * together they were a budget sized to one window, a request sent against
 * another, and a number on screen that matched neither — silently, and in the
 * direction that truncates. C13 says the previewed payload is the sent one; the
 * *window it was sized to* was not.
 *
 * So: the budget, the dispatch and the panel all call the functions below with
 * the same two inputs — the sampling config's switched-on values and the
 * resolved connection pair — and the three literals are gone.
 *
 * ## The model's own window (0114)
 *
 * A model may state a context window of its own (`connection_models.context_window`).
 * It is a fact about the model, never a knob on a node (17 §1a), and where it
 * is set it **caps** the sampling config's: a config asking for 16k against a
 * model that holds 8k gets a budget the model can actually take. Null on every
 * row the backfill created, so nothing moves until somebody sets one.
 *
 * ## What stays with the adapters
 *
 * The values an adapter puts on the wire (`num_ctx`, `max_context_length`) are
 * still read off `sampling.contextTokens` by the adapters themselves. The window
 * computed here reaches them as the constructor's `tokenLimit` — the same seam
 * `dispatchStep` always used — and not as a rewrite of the sampling values: a
 * config with Context Tokens switched **off** sends none, and injecting the
 * computed window into it would switch a sampler on from a place nobody set it
 * (Ollama's `num_ctx` allocates KV cache with no clamp).
 */

/** What the two computations read off a resolved connection pair, if there is one. */
export interface WindowConnection {
	/** The model's own window, or null for "the sampling config decides". */
	contextWindow?: number | null
}

/** A positive integer read leniently, or null for "not stated". */
function positiveInt(raw: unknown): number | null {
	// `ResolvedSampling` is `Record<string, unknown>` and is not coerced on
	// read — `resolveSamplingValues` passes stored values through untouched —
	// so a row holding `"8192"` yields the string. A numeric string is a
	// legitimate shape here and is read as the number it spells.
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && raw.trim() !== ""
				? Number(raw)
				: NaN
	if (!Number.isFinite(n) || n <= 0) return null
	return Math.floor(n)
}

/** What "the user did not say" has always meant for a window. */
export const DEFAULT_CONTEXT_WINDOW = 4096
/** …and for the reply's allowance. */
export const DEFAULT_REPLY_RESERVE = 512
/** The declared default of `context-budget.params.safetyMargin`. */
export const DEFAULT_SAFETY_MARGIN = 0.05

/**
 * The window a request is sent against.
 *
 * The sampling config's `contextTokens` where it is switched on, else the
 * default; capped by the model's own window where the model states one.
 */
export function contextWindowFrom(
	sampling: Record<string, unknown> | null | undefined,
	connection?: WindowConnection | null
): number {
	const configured =
		positiveInt(sampling?.contextTokens) ?? DEFAULT_CONTEXT_WINDOW
	const model = positiveInt(connection?.contextWindow)
	return model === null ? configured : Math.min(configured, model)
}

/** The tokens reserved for the reply — the config's `responseTokens`, else the default. */
export function replyReserveFrom(
	sampling: Record<string, unknown> | null | undefined
): number {
	return positiveInt(sampling?.responseTokens) ?? DEFAULT_REPLY_RESERVE
}

export interface ContextBudget {
	/** The window the request is sent against. */
	window: number
	/** Tokens held back for the reply. */
	reserved: number
	/** Tokens the context may occupy: `(window - reserved) × (1 - margin)`, never negative. */
	total: number
	remaining: number
	available: number
}

/**
 * Tokens the context may occupy, from the window the reply will be sent
 * against.
 *
 * Derived, never typed. The window and the reply's allowance are both
 * parameters of the sampling config the reply is sent under, so the whole
 * calculation is `context - response - drift`. There is no `reserveForReply`
 * here: the reserve IS the response allowance, read rather than typed, because
 * one number with two homes is free to disagree with the model actually being
 * called and warns nobody when it does.
 */
export function contextBudgetFrom(input: {
	sampling?: Record<string, unknown> | null
	connection?: WindowConnection | null
	safetyMargin?: unknown
}): ContextBudget {
	const window = contextWindowFrom(input.sampling, input.connection)
	const reserved = replyReserveFrom(input.sampling)
	const marginRaw = Number(input.safetyMargin ?? DEFAULT_SAFETY_MARGIN)
	const margin = Number.isFinite(marginRaw)
		? marginRaw
		: DEFAULT_SAFETY_MARGIN
	const total = Math.max(0, Math.floor((window - reserved) * (1 - margin)))
	return { window, reserved, total, remaining: total, available: total }
}
