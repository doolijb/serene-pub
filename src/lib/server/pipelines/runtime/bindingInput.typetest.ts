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
const _text: unknown = lore.text
const _scanDepth: number | undefined = lore.params?.scanDepth
// @ts-expect-error — not a port on any of the three
lore.limit

// A handler bound to the four turn strategies may read only what all four
// declare. They come from one `turnStrategy()` helper, so that is all of it —
// and this is what makes the fact checked rather than assumed.
declare const speaker: SharedInput<
	[
		typeof C.turnRoundRobin,
		typeof C.turnRandom,
		typeof C.turnManual,
		typeof C.turnNone
	]
>
const _cast: unknown = speaker.cast
const _characterId: unknown = speaker.characterId
// @ts-expect-error — none of the four declares a `strategy` IN-port; it is an
// out-port, and the binding takes the strategy as a closure argument
speaker.strategy

export {}
