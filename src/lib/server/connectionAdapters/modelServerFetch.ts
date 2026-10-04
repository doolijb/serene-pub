/**
 * The HTTP client timeouts for requests to a model server.
 *
 * Node's built-in `fetch` (undici) has two timeouts of its own, both five
 * minutes by default: `headersTimeout` (request sent → response headers) and
 * `bodyTimeout` (silence between two pieces of the body). Neither is visible
 * from an adapter, and both are shorter than the bounds the adapters
 * deliberately chose (`idleTimeout.ts`):
 *
 * - KoboldCPP answers a streamed request's headers at once and then sends
 *   nothing while it processes the prompt — a long prompt on slow hardware
 *   tripped `bodyTimeout` at five minutes, well inside the adapter's ten-
 *   minute idle watchdog.
 * - A non-streamed reply sends its headers when the whole reply is ready —
 *   every generation longer than five minutes tripped `headersTimeout`,
 *   inside the adapter's thirty-minute flat bound.
 *
 * So requests to a model server go through one dispatcher whose timeouts sit
 * just ABOVE the adapters' own: `headersTimeout` over the non-streaming bound,
 * `bodyTimeout` over the streaming idle bound. The adapter's watchdog, with
 * its own sentence, is always the one that fires; undici is the backstop for
 * a client with no watchdog (the OpenAI and Anthropic SDKs). Every other fetch
 * in the app keeps undici's defaults.
 *
 * ⚠ undici is not a dependency: Node bundles it without exporting `Agent`.
 * The class is reached through the global dispatcher Node's fetch installs
 * under undici's cross-version key (`Symbol.for("undici.globalDispatcher.1")`
 * — the same key the npm package uses, which is what makes it stable). If
 * that ever fails, `modelServerDispatcher()` answers `undefined` and the
 * request goes out on the defaults — the old behaviour, never a crash.
 */
import { LLM_IDLE_TIMEOUT_MS, LLM_NONSTREAMING_TIMEOUT_MS } from "./idleTimeout"

/** How far above an adapter's own bound undici's sits, so the adapter's fires first. */
const BACKSTOP_MARGIN_MS = 30_000

/** Request sent → response headers. Over the non-streaming bound: that reply's headers come with it. */
export const MODEL_SERVER_HEADERS_TIMEOUT_MS =
	LLM_NONSTREAMING_TIMEOUT_MS + BACKSTOP_MARGIN_MS

/** Silence between two pieces of the body. Over the streaming idle bound. */
export const MODEL_SERVER_BODY_TIMEOUT_MS =
	LLM_IDLE_TIMEOUT_MS + BACKSTOP_MARGIN_MS

/** An undici dispatcher, structurally — `RequestInit.dispatcher` on Node. */
export type ModelServerDispatcher = object

const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1")

type AgentClass = new (opts: {
	headersTimeout: number
	bodyTimeout: number
}) => ModelServerDispatcher

/** undici's `Agent`, off the global dispatcher — undefined when that is not an `Agent`. */
function undiciAgentClass(): AgentClass | undefined {
	const read = () =>
		(globalThis as Record<symbol, unknown>)[GLOBAL_DISPATCHER] as
			| { constructor?: { name?: string } }
			| undefined
	// Node loads its bundled undici — which installs the global dispatcher —
	// the first time any of its globals is touched. `Headers` is one, and
	// touching it sends nothing anywhere (unlike priming with a `fetch`, which
	// a test's stub would record).
	if (!read()) void new Headers()
	const ctor = read()?.constructor
	// A proxy or a mock installed as the global dispatcher is not something
	// to clone with different options: keep the defaults rather than guess.
	return ctor?.name === "Agent" ? (ctor as unknown as AgentClass) : undefined
}

/** Builds a dispatcher with the given timeouts — `undefined` when undici's `Agent` is out of reach. */
export function dispatcherWithTimeouts(opts: {
	headersTimeout: number
	bodyTimeout: number
}): ModelServerDispatcher | undefined {
	try {
		const Agent = undiciAgentClass()
		return Agent ? new Agent(opts) : undefined
	} catch {
		return undefined
	}
}

let shared: ModelServerDispatcher | null | undefined

/** The one dispatcher for model-server requests, built on first use. */
export function modelServerDispatcher(): ModelServerDispatcher | undefined {
	if (shared === undefined)
		shared =
			dispatcherWithTimeouts({
				headersTimeout: MODEL_SERVER_HEADERS_TIMEOUT_MS,
				bodyTimeout: MODEL_SERVER_BODY_TIMEOUT_MS
			}) ?? null
	return shared ?? undefined
}

/**
 * `fetch` for a model server: the global `fetch`, read at call time (so a
 * test's stub still sees the call), with the model-server dispatcher.
 */
export const modelServerFetch: typeof fetch = (input, init) => {
	const dispatcher = modelServerDispatcher()
	return globalThis.fetch(
		input,
		dispatcher ? ({ ...init, dispatcher } as RequestInit) : init
	)
}

/**
 * The same, as `fetchOptions` for a client library that takes them (the
 * OpenAI and Anthropic SDKs) — empty when there is no dispatcher to hand.
 * Typed without the four fields those libraries reserve for themselves.
 */
export function modelServerFetchOptions(): Omit<
	RequestInit,
	"method" | "body" | "headers" | "signal"
> {
	const dispatcher = modelServerDispatcher()
	return dispatcher ? ({ dispatcher } as RequestInit) : {}
}
