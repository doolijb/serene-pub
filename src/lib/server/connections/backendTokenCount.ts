/**
 * Counting tokens with the MODEL'S OWN tokenizer, where its server will say
 * (B2, 2026-10-03).
 *
 * ## Why
 *
 * The budget was measured with an estimate — the connection's chosen
 * tokenizer, or four characters a token — and an estimate that comes in under
 * the server's count sends a prompt larger than the window. KoboldCPP then
 * trims the FRONT of it by its own count (2881 against 2850, measured), which
 * moves the start of the prompt on every turn and throws away the whole prompt
 * cache of a model that only reuses an exact prefix.
 *
 * ## The shape: synchronous counts over an asynchronous cache
 *
 * The SDK counts synchronously (loading is async, counting is sync — see
 * `@serene-pub/sdk/tokenizers`), and a server's count is an HTTP request. So
 * a count is answered from a cache of the server's own answers, keyed by the
 * text; a text the cache does not hold is answered with the estimate scaled by
 * how far the estimate has been off for this server ({@link UNCOUNTED_FLOOR}
 * until it knows), and queued to be counted in the background. Conversation
 * lines, character cards and lore entries recur turn after turn, so from the
 * second turn on nearly every count is the server's.
 *
 * Supported where the server exposes its tokenizer: KoboldCPP
 * (`/api/extra/tokencount`) and llama.cpp (`/tokenize`). Ollama, LM Studio and
 * the hosted services publish no such endpoint; they keep the estimate, which
 * is what every run used before.
 *
 * ⚠ Nothing here can fail a turn. An unreachable server, an odd answer, a
 * timeout — the estimate answers, and the server is left alone for a minute.
 */

import { createHash } from "node:crypto"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"

/** How a server is asked to count one text. */
export interface TokenCountEndpoint {
	url: string
	body: (text: string) => Record<string, unknown>
	read: (json: unknown) => number | null
}

/**
 * Where (and whether) a connection type's server counts tokens.
 *
 * `null` for every type without a tokenize endpoint, and for a base URL that
 * is empty — the caller then keeps the estimate.
 */
export function tokenCountEndpointFor(
	type: string | null | undefined,
	baseUrl: string | null | undefined
): TokenCountEndpoint | null {
	const base = normalizeBaseUrl(baseUrl)
	if (!base) return null
	if (
		type === CONNECTION_TYPE.KOBOLDCPP ||
		type === CONNECTION_TYPE.KOBOLDCPP_MANAGED
	)
		return {
			url: `${base}/api/extra/tokencount`,
			body: (text) => ({ prompt: text }),
			read: (json) => {
				const v = (json as { value?: unknown } | null)?.value
				return typeof v === "number" && Number.isFinite(v) ? v : null
			}
		}
	if (type === CONNECTION_TYPE.LLAMACPP)
		return {
			url: `${base}/tokenize`,
			body: (text) => ({ content: text, add_special: false }),
			read: (json) => {
				const t = (json as { tokens?: unknown } | null)?.tokens
				return Array.isArray(t) ? t.length : null
			}
		}
	return null
}

/**
 * What an uncounted text is scaled by before the server has answered
 * anything: estimates run UNDER real counts often enough (JSON cards, names,
 * non-English text) that assuming them exact is how a prompt overflows.
 */
export const UNCOUNTED_FLOOR = 1.15
/** Added over the learned ratio for a text not counted yet — per-text spread. */
export const UNCOUNTED_MARGIN = 1.05
/** Texts shorter than this never move the learned ratio; their ratio is noise. */
const RATIO_MIN_TOKENS = 16
const CACHE_LIMIT = 8000
const QUEUE_LIMIT = 512
const REQUEST_TIMEOUT_MS = 5000
const BACKOFF_MS = 60_000

/** A text's cache key: content-addressed, so a long card is not held twice. */
const keyOf = (text: string): string =>
	createHash("sha1").update(text).digest("base64")

/**
 * One server's counts, shared by every run that budgets against it.
 *
 * Process-level, keyed by the endpoint URL: a count is a fact about the model
 * that server holds, not about any one run.
 */
export class BackendTokenCounts {
	private cache = new Map<string, number>()
	private queue = new Map<string, string>()
	private draining = false
	private ratio: number | null = null
	private backoffUntil = 0
	private estimateFor: ((t: string) => number) | null = null

	constructor(
		readonly endpoint: TokenCountEndpoint,
		private fetchImpl: typeof fetch = fetch
	) {}

	/** The server's count, when it has given one. */
	known(text: string): number | undefined {
		return this.cache.get(keyOf(text))
	}

	/**
	 * A synchronous count: the server's when known, else the estimate scaled
	 * up — and, when `enqueue`, the text queued to be counted for next time.
	 */
	count(text: string, estimate: (t: string) => number, enqueue: boolean): number {
		if (!text) return 0
		const key = keyOf(text)
		const hit = this.cache.get(key)
		if (hit !== undefined) {
			// Refresh: the newest-used texts are the ones worth keeping.
			this.cache.delete(key)
			this.cache.set(key, hit)
			return hit
		}
		if (enqueue && this.queue.size < QUEUE_LIMIT && !this.queue.has(key)) {
			this.queue.set(key, text)
			this.drainSoon()
		}
		const scale = Math.max(this.ratio ?? UNCOUNTED_FLOOR, 1) * UNCOUNTED_MARGIN
		return Math.ceil(estimate(text) * scale)
	}

	/**
	 * The estimate the learned ratio is measured against — the run's own, set
	 * by `backendCounter`, so the ratio says how far THAT estimate runs off.
	 */
	setEstimate(estimate: (t: string) => number): void {
		this.estimateFor = estimate
	}

	/**
	 * Count the queued texts, one at a time, in the background, learning the
	 * ratio from each answer so the estimate for what is still uncounted
	 * improves before the cache covers it.
	 */
	private drainSoon(): void {
		if (this.draining) return
		this.draining = true
		setTimeout(() => void this.drain(), 0)
	}

	/** Exposed for tests; the queue drains on its own otherwise. */
	async drain(): Promise<void> {
		this.draining = true
		try {
			while (this.queue.size) {
				if (Date.now() < this.backoffUntil) {
					this.queue.clear()
					return
				}
				const [key, text] = this.queue.entries().next().value as [string, string]
				this.queue.delete(key)
				const n = await this.ask(text)
				if (n === null) {
					this.backoffUntil = Date.now() + BACKOFF_MS
					this.queue.clear()
					return
				}
				this.remember(key, n)
				const est = this.estimateFor?.(text)
				if (est && est >= RATIO_MIN_TOKENS) {
					const r = n / est
					this.ratio = this.ratio === null ? r : this.ratio * 0.8 + r * 0.2
				}
			}
		} finally {
			this.draining = false
		}
	}

	private remember(key: string, n: number): void {
		this.cache.set(key, n)
		if (this.cache.size > CACHE_LIMIT)
			this.cache.delete(this.cache.keys().next().value!)
	}

	private async ask(text: string): Promise<number | null> {
		try {
			const res = await this.fetchImpl(this.endpoint.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(this.endpoint.body(text)),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			})
			if (!res.ok) return null
			return this.endpoint.read(await res.json())
		} catch {
			return null
		}
	}
}

const POOL = new Map<string, BackendTokenCounts>()

/** The shared counts for one endpoint. */
export function backendTokenCountsFor(
	endpoint: TokenCountEndpoint
): BackendTokenCounts {
	let counts = POOL.get(endpoint.url)
	if (!counts) {
		counts = new BackendTokenCounts(endpoint)
		POOL.set(endpoint.url, counts)
	}
	return counts
}

/**
 * The counter a run budgets with: the server's counts over the estimate.
 *
 * `enqueue` false for a preview — the composer runs one on every debounced
 * keystroke, and each draft would otherwise be a request to the model's
 * server. A preview still reads every count a real turn has already learned.
 */
export function backendCounter(
	counts: BackendTokenCounts,
	estimate: (v: unknown) => number,
	opts: { enqueue: boolean }
): (v: unknown) => number {
	const estimateText = (t: string) => estimate(t)
	counts.setEstimate(estimateText)
	return (v: unknown) => {
		const text = typeof v === "string" ? v : JSON.stringify(v ?? "")
		return counts.count(text, estimateText, opts.enqueue)
	}
}
