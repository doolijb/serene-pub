/**
 * The tokenizers a run budgets with — offered to the SDK, and chosen per run.
 *
 * ## Why this file exists at all
 *
 * `connections.token_counter` is a user-facing setting: a person opens a
 * connection form, picks "OpenAI GPT-4o", and reasonably expects their context
 * to be measured in GPT-4o tokens. On the legacy path it was — `generateResponse`
 * builds a `TokenCounters` from that column, and there is a comment beside it
 * about the bug where a truthy default short-circuited the choice. On the
 * pipeline path it was not: `RunOptions.countTokens` was never passed, so the
 * executor fell back to `roughTokens` (four characters per token, flat) and the
 * setting changed nothing about a pipeline run's budget or its receipt.
 *
 * That is a parity regression against 0.5, not a missing feature, which is why
 * the fix is wiring rather than design.
 *
 * ## Why the loaders live here and not in the SDK
 *
 * The SDK owns the vocabulary, the resolution, the caching, the fallback and —
 * critically — the rule that **loading is async and counting is sync** (see
 * `@serene-pub/sdk/tokenizers`). What it cannot own is the `import()` itself.
 * The SDK is consumed through a `file:` link to a sibling checkout, so a bare
 * specifier written inside it resolves against *that* tree, where these four
 * packages are not installed and must never be: they are ~69 MB, an author who
 * installed the SDK to write one node type should not download a BPE merge
 * table, and the app already carries them for the legacy path.
 *
 * So core registers eight loaders and passes an id. `defineTokenizer` is the
 * same seam `defineWireFormat` already is.
 *
 * ## ⚠ The dynamic imports are not stylistic
 *
 * `gpt-tokenizer`, `llama3-tokenizer-js` and `@lenml/tokenizer-gemma` all use
 * Unicode regex property escapes (`\p{L}`, `\p{N}`) in their BPE pretokenization
 * patterns — the standard tiktoken-style split regex. That throws a SyntaxError
 * while PARSING, not running, under nodejs-mobile's Android build of V8, which
 * lacks full ICU. Deferring the parse to the moment a counter is actually used
 * is what keeps an Android install working for everybody who never selected one
 * of those. `llama-tokenizer-js` and `mistral-tokenizer-js` do not use `\p{…}`,
 * and are dynamic here only because `load()` is the same shape for all eight —
 * `TokenCounterManager` still imports those two statically for the adapters.
 *
 * This mirrors `$lib/server/utils/TokenCounterManager` deliberately and the two
 * must agree; `tokenizerParity.test.ts` is what asserts they do rather than a
 * comment asking nicely.
 */

import { defineTokenizer } from "@serene-pub/sdk/tokenizers"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

/**
 * What a counter measures when handed something that is not a string.
 *
 * The SDK's own counters coerce the same way (`countableText`), and they must:
 * a wire payload is a messages array as often as it is prose, and the figure in
 * a receipt has to be a measurement of the same thing the budget spent.
 */
const text = (v: unknown): string =>
	typeof v === "string" ? v : JSON.stringify(v ?? "")

defineTokenizer({
	id: TokenCounterOptions.OPENAI_GPT2,
	load: async () => {
		const { countTokens } = await import("gpt-tokenizer/encoding/r50k_base")
		return (v) => countTokens(text(v))
	}
})

defineTokenizer({
	id: TokenCounterOptions.OPENAI_GPT35,
	load: async () => {
		const { countTokens } = await import(
			"gpt-tokenizer/encoding/cl100k_base"
		)
		return (v) => countTokens(text(v))
	}
})

defineTokenizer({
	id: TokenCounterOptions.OPENAI_GPT4,
	load: async () => {
		const { countTokens } = await import(
			"gpt-tokenizer/encoding/cl100k_base"
		)
		return (v) => countTokens(text(v))
	}
})

defineTokenizer({
	id: TokenCounterOptions.OPENAI_GPT4O,
	load: async () => {
		const { countTokens } = await import(
			"gpt-tokenizer/encoding/o200k_base"
		)
		return (v) => countTokens(text(v))
	}
})

defineTokenizer({
	id: TokenCounterOptions.LLAMA,
	load: async () => {
		const { default: llamaTokenizer } = await import("llama-tokenizer-js")
		return (v) => llamaTokenizer.encode(text(v)).length
	}
})

defineTokenizer({
	id: TokenCounterOptions.LLAMA3,
	load: async () => {
		const { default: llama3Tokenizer } = await import("llama3-tokenizer-js")
		return (v) => llama3Tokenizer.encode(text(v)).length
	}
})

defineTokenizer({
	id: TokenCounterOptions.MISTRAL,
	load: async () => {
		const { default: mistralTokenizer } = await import(
			"mistral-tokenizer-js"
		)
		return (v) => mistralTokenizer.encode(text(v)).length
	}
})

defineTokenizer({
	id: TokenCounterOptions.COHERE,
	load: async () => {
		// `fromPreTrained()` rebuilds the vocab and merges from scratch, which is
		// expensive — and is exactly why the SDK awaits `load()` once per process
		// rather than per count. The old counter called it on every invocation.
		const { fromPreTrained } = await import("@lenml/tokenizer-gemma")
		const tokenizer = fromPreTrained()
		return (v) =>
			tokenizer.encode(text(v), { add_special_tokens: false }).length
	}
})

/**
 * Which tokenizer THIS run budgets with.
 *
 * Resolved from the connection the run will most likely dispatch to, by the
 * same rule `connectionStopsFor` uses for the connection's stop guards — the
 * registered default for `text->text`, with the session's own override on top.
 *
 * ⚠ **Tier 2 is deliberately not consulted.** A pipeline config can point one
 * provider node's `connection` slot somewhere else, and that decision is made
 * *inside* the run, when the executor resolves that node's slots. The tokenizer
 * has to be resident before the first block is counted, so there is no moment
 * at which both facts are known. Reaching for it here would mean reimplementing
 * slot resolution outside the executor and guessing which provider counts — two
 * spellings of one rule, which is the failure `capabilityTarget.ts`'s own header
 * is about. A per-node connection override therefore budgets with the default
 * connection's tokenizer; that is a smaller error than the flat estimate this
 * replaces, and an honest one.
 *
 * Returns `undefined` rather than an id when nothing is set up, which the SDK
 * reads as "no preference" and answers with the rough estimate — silently,
 * because a host that configured nothing has no problem to report.
 */
export async function tokenizerFor(
	db: Db,
	sessionId?: number | null
): Promise<string | undefined> {
	try {
		const target = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY,
			sessionOverride: sessionId
				? { connectionId: await sessionConnectionId(db, sessionId) }
				: null
		})
		// The refusal sentence is dropped rather than surfaced, for the reason
		// `connectionStopsFor` gives: nothing here is the run. A turn with no
		// connection fails at dispatch with that same sentence, and raising it
		// from a budgeting lookup would report a missing default twice, from the
		// wrong place, and before the thing that actually needs one.
		if (!target.ok) return undefined
		return target.connection.tokenCounter ?? undefined
	} catch {
		return undefined
	}
}

/** The session's own connection choice — tier 3, and one column of it. */
async function sessionConnectionId(
	db: Db,
	sessionId: number
): Promise<number | undefined> {
	const [row] = await db
		.select({ connectionId: schema.sessions.connectionId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.connectionId ?? undefined
}
