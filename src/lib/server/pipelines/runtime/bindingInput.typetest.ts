/**
 * Core's binding inputs, asserted at COMPILE time (ruling 2026-09-10).
 *
 * ⚠ **Not a vitest file, and the extension is load-bearing.** `.typetest.ts`
 * matches neither project's `include` in `vitest.config.ts` (`*.test.ts` /
 * `*.spec.ts`), so nothing runs it — which is right, because there is nothing
 * to run. It is checked by `npm run check`, and every `@ts-expect-error` below
 * **fails that check if the error it expects stops happening**.
 *
 * That is the only shape of guard available for this class of defect. A handler
 * reading `input.topK` off a node with no such port does not throw, does not
 * log and does not fail a test: it gets `undefined` and falls through to the
 * literal behind the `??`. `core:query/vector-search@1` searched at a hardcoded
 * 40 for the life of the mechanism that way, while a rendered, validated, saved
 * and scope-resolved `12` reached nothing; `core:query/session-history@1`'s
 * `limit` did the same, for 100. Both were found by hand, twice.
 *
 * A widening bug — the SDK's `describe*` losing its slots generic, an `any`
 * slipped into `InputOf`, `DeclaredNames` losing its `never` guard — therefore
 * shows up here as "unused '@ts-expect-error' directive", which reads as
 * nonsense until you know why this file exists. Hence this comment.
 *
 * The SDK carries the same assertions against the derivation itself
 * (`sdk-tests/nodeInput.assert.ts`); this file asserts them **through the app's
 * own aliases**, which is the layer core's handlers are actually written in.
 */

import type * as C from "@serene-pub/contracts"
import { ok, reads } from "@serene-pub/sdk"
import type { NodeInput, SharedInput, Unsupplied } from "./bindingTypes"

// ── The two reads that shipped ──────────────────────────────────────────────

declare const search: NodeInput<typeof C.vectorSearch>

// ✅ declared in-ports, and the declared parameters, typed from the schema
const _vectors: unknown = search.vectors
const _topK: number | undefined = search.params?.topK
const _falloff: number | undefined = search.params?.similarityFalloff

// @ts-expect-error — `topK` is a PARAMETER of this node, not an in-port. This
// exact expression is what the binding ran for the life of the mechanism.
search.topK

// @ts-expect-error — `minScore` was declared, never read, then deleted outright
// (a similarity floor is not portable across embedding models). A read of it
// must not compile it back into existence.
search.params?.minScore

declare const history: NodeInput<typeof C.sessionHistory>
const _limit: number | undefined = history.params?.limit

// @ts-expect-error — the second defect, the same shape: `limit` is a parameter,
// and the top-level read took a literal 100 on every run.
history.limit

// ── The exemptions are exemptions, not a hole ───────────────────────────────

declare const historyExempt: NodeInput<
	typeof C.sessionHistory,
	Unsupplied<"limit" | "channel", "the ruling of 2026-09-09, restated">
>
// ✅ named at the site, so the read compiles and the population stays countable
const _fallback: unknown = historyExempt.limit
// @ts-expect-error — but only the names that were named. An exemption is not a
// return to `any`.
historyExempt.somethingElse

// ── Slots are the node's own, not a fixed vocabulary ────────────────────────

declare const userMessage: NodeInput<typeof C.userMessage>
const _scripts: unknown = userMessage.scripts
// @ts-expect-error — this input type declares no `parameters` slot. Under the
// old fixed slot vocabulary every node in the catalog accepted this and handed
// back `undefined`.
userMessage.params
// @ts-expect-error — nor a `template` slot, which that vocabulary also allowed
// on every node
userMessage.template

// ── One handler, several types: the intersection ────────────────────────────

declare const lore: SharedInput<
	[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]
>
const _loreScope: unknown = lore.scope
const _scanDepth: number | undefined = lore.params?.scanDepth
// @ts-expect-error — not a port on any of the three
lore.limit
// @ts-expect-error — `text` WAS a port on all three, filled by nothing and
// read by nothing, and was culled (R-12, 2026-09-16). A read must not compile
// it back.
lore.text

// A handler bound to the four turn strategies may read only what all four
// declare. They come from one `turnStrategy()` helper, so that is all of it —
// and this is what makes the fact checked rather than assumed.
declare const speaker: SharedInput<
	[
		typeof C.turnRoundRobin,
		typeof C.turnRandom,
		typeof C.turnManual,
		typeof C.turnNarrator
	]
>
const _candidates: unknown = speaker.candidates
const _messages: unknown = speaker.messages
// @ts-expect-error — `speaker` is not an in-port any more (PLAN-turn-order
// §4.4): an explicit pick never enters a strategy, it fires the entry
speaker.speaker

// ── Handlers declare what they read, and the declaration is checked ────────
//
// R-12 (2026-09-16). `reads<C>()` is the runtime shadow of `InputOf<C>`: the
// arrays a handler declares are typed against the same contract its `input`
// is, so the two lists cannot name different things. A misspelt parameter in
// EITHER place fails to compile — and this is the half that lets the guard
// (`boot/declaredReads.ts`) trust what a handler says it reads.

declare const search2: NodeInput<typeof C.vectorSearch>
// @ts-expect-error — a typo in the READ: `simliarityFalloff` is nobody's param
search2.params?.simliarityFalloff

const searchHook = async (_input: NodeInput<typeof C.vectorSearch>) =>
	ok({ main: [] })

// ✅ the declaration names the node's own ports and params
reads<typeof C.vectorSearch>(searchHook, {
	ports: ["scope", "vectors"],
	params: ["maxEntries", "topK", "similarityFalloff"]
})
reads<typeof C.vectorSearch>(searchHook, {
	ports: [],
	// @ts-expect-error — the same typo in the DECLARATION fails the same way
	params: ["simliarityFalloff"]
})
reads<typeof C.vectorSearch>(searchHook, {
	// @ts-expect-error — `topK` is a parameter, not a port; the exact confusion
	// that shipped, refused at the declaration as well as at the read
	ports: ["topK"]
})

// A shared handler declares against the intersection, in the tuple spelling.
const loreHook = async (
	_input: SharedInput<
		[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]
	>
) => ok({ main: [] })
reads<[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]>(
	loreHook,
	{ ports: ["scope"], params: ["scanDepth", "titleWeight"] }
)
reads<[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]>(
	loreHook,
	{
		// @ts-expect-error — culled from all three (R-12); a declaration must
		// not resurrect it either
		ports: ["text"]
	}
)

// And a definition with no parameters admits no parameter name at all.
reads<typeof C.userMessage>(
	async (input: NodeInput<typeof C.userMessage>) => ok(input),
	{
		ports: [],
		// @ts-expect-error — nothing to declare: the schema is empty
		params: ["anything"]
	}
)

export {}
