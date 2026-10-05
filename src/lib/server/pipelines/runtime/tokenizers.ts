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
 * The SDK does not depend on these four packages and must never: they are
 * ~69 MB, an author who installed the SDK to write one node definition should
 * not download a BPE merge table, and the app already carries them for the
 * legacy path. Linked to a sibling checkout (`npm run sdk:link`), a bare
 * specifier written inside the SDK resolves against *that* tree, where they are
 * not installed.
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
import {
	getDefinition,
	resolveConfig,
	slotConnectionId,
	SLOT_VALUE,
	type ConfigWorld,
	type SpecDocument
} from "@serene-pub/sdk"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { spineProviders } from "$lib/server/pipelines/runtime/specShape"

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
 * Resolved off the RUN's connection — the one the executor will resolve for
 * the node the budget sizes to — read from the same world the run is about to
 * resolve against, with the SDK's own primitives (`resolveConfig`, the pick
 * then the instance default by shape). Not a second walk of the database
 * (R-8): the capability default is already IN the world (`activeConnection`),
 * and so is a pipeline panel's per-node pick, which a walk of
 * `resolveCapabilityTarget` alone cannot see. The tokenizer therefore follows
 * the connection the request goes to, which is what a connection carries one
 * for.
 *
 * Which node: the context-budget node's `connection` ref names it
 * (`slot.connectionOf('generate')` on the shipped specs); a document with no
 * budget node budgets for its first spine provider, the preview target.
 *
 * ⚠ The tokenizer has to be resident before the first block is counted, so it
 * is read here, before `run`, rather than at the node — which is why this is a
 * pre-run read of the world and not a fact the executor reports back. The two
 * cannot disagree: `resolveConfig` is the executor's own resolution, over the
 * same rows, and the shape fallback is the one its `resolveSlot` takes.
 *
 * Returns `undefined` rather than an id when nothing is set up, which the SDK
 * reads as "no preference" and answers with the rough estimate — silently,
 * because a host that configured nothing has no problem to report.
 */
export function tokenizerFor(
	world: ConfigWorld,
	doc: SpecDocument
): string | undefined {
	return budgetConnectionOf(world, doc)?.metadata?.tokenizer ?? undefined
}

/**
 * The connection THIS run's budget is sized for — the one `tokenizerFor`
 * reads its tokenizer off, by the same resolution. Exported so the backend
 * token counter (`connections/backendTokenCount.ts`) asks the same
 * connection the budget describes, never a second walk.
 */
export function budgetConnectionOf(
	world: ConfigWorld,
	doc: SpecDocument
): ConfigWorld["connections"][number] | undefined {
	try {
		const budget = doc.nodes.find(
			(n) => n.definitionId === "core:task/context-budget"
		)
		const ref = budget?.config?.["connection"] as
			| { __ref?: unknown; ofNode?: unknown }
			| undefined
		const named =
			ref && ref.__ref === "slot" && typeof ref.ofNode === "string"
				? doc.nodes.find((n) => n.key === ref.ofNode)
				: undefined
		const target = named ?? spineProviders(doc)[0]
		if (!target) return undefined
		const stored = resolveConfig(world, [target.key])[target.key]?.[
			"connection"
		]?.[SLOT_VALUE]
		const shape = getDefinition(`${target.definitionId}@${target.definitionVersion}`)?.shape
		const chosenId =
			stored == null
				? shape
					? world.activeConnection[shape]
					: undefined
				: slotConnectionId(stored)
		if (chosenId == null) return undefined
		return world.connections.find((c) => String(c.id) === String(chosenId))
	} catch {
		return undefined
	}
}
