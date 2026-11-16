# REPORT — lane `perf-M` — plugin frames may take the one-row streamed post — 2026-11-14

(Supervisor's report, saved to disk by the lead; the harness refused the supervisor's write. Worker briefs `plans/briefs/BRIEF-perf-M-w1.md`, `-w2.md`; w1's report `plans/REPORT-perf-M-w1.md`. Lead's acceptance note at the end.)

Built under ★P14 (2026-11-13) and ★M-1 (owner, 2026-11-14: a frame may declare on its `ready` message that it takes single-row posts; a frame that says nothing is unchanged).

## The `ready` shape (`sdk/src/surfaces.ts`, `FrameHostMessage`)
`| { t: 'ready'; takes?: 'message'[] }` — 🚧 `@experimental`, rulings ★P14/★M-1 in the doc. No type alias (a second name). Doc: not a grant, not a read; absent/empty/without `'message'` → full lists; read afresh on every `ready`, a new port starts without it; an older host keeps sending full lists, so a declaring frame must still handle `messages` and `channel`. Host reads `Array.isArray(m.takes) && m.takes.includes("message")`; unknown entries ignored; a non-array says nothing.

## Changed files
**App:** `frames/widgetWire.svelte.ts` — file-local `peerDeclaredOneMessage` + `takesOneMessage()` (~:236-245); the two `opts.peerTakesOneMessage` reads in `push()` call it (~:382, ~:423); the `ready` branch sets the flag before `push()` (~:595); `attach()` clears it (~:851); the option doc no longer says "a frame never does". New `frames/pluginFrame.oneMessage.dom.test.svelte.ts` (7 tests mounting the real `PluginFrame`). `frames/widgetWire.oneMessage.dom.test.svelte.ts` (perf-H's) + `describe("declared on ready (★M-1)")` 4 tests, `open()`/`ready()` take payloads, `attachFresh()`. `NOMENCLATURE.md` §25 bullet (2026-11-14). `PluginFrame.svelte` unchanged.
**SDK:** `sdk/src/surfaces.ts` (`takes`; the `{ t: 'message' }` member doc says when and to whom; `FRAME_PROTOCOL` doc paragraph, protocol 2, no version bump); `cli/src/testing.ts` (`mountComponent`'s `pushSection` posts a streamed update as `{ t: 'message' }` as `ComponentMount` does, comparing by projected content; file-local `streamedRow`, `heldMessages`/`heldChannels`; `@public` tag placement fixed); `sdk-tests/surfaces.test.ts` (one assertion); new `sdk-tests/componentHarnessMessage.test.ts` (6); `guides/frames.md` ("Talking to Serene Pub": `ready { takes? }`, the `message` cell corrected, one paragraph). `INTEGRATING.md`, `docs/plugins.md` untouched (they do not describe frame messages).

## Snapshot sequences (ready, 5 streamed frames on row 3, settle, add, remove)
Declared: `messages:3, message:3:H, message:3:He, message:3:Hel, message:3:Hell, message:3:Hello, messages:3, messages:4, messages:3`. Silent: `messages:3` ×7, `messages:4`, `messages:3`, each byte-equal to `{ t: "messages", messages: <full list> }`. Also: a declared frame's row carries no `embedding`/`debugMeta`/`userId`; `takes: []`, `["something-else"]`, `"message"` behave as silent; a replayed `ready` without `takes` turns single rows off; a new port + silent `ready` → full lists; with `channels`, a generating row on an unheld lane is not posted.

## Tests
App `frames/` + `host/` capped against the new dist: 39 files / 257 passed. tsc filtered clean. SDK `sdk-tests` capped: 147 passed (harness, wire, surfaces, framePort, guideSnippets, receiverRules, pluginHarness…); harness files pushing generating rows 88 passed; rerun after the supervisor's edits 48 passed; `sdk-tests` tsc clean; `tsc -p cli/tsconfig.build.json` clean. Prettier: new files clean; `widgetWire.svelte.ts`, `surfaces.ts`, `testing.ts`, `guides/frames.md`, `surfaces.test.ts` unclean at HEAD — hunks hand-formatted. `sdk:build` run by the lead (exit 0).

## Decisions
Declaration read in the wire (the option is fixed at construction; overwriting the caller's options was the only alternative) — wider than "ready handler and attach() only", scope reviewer accepted. Works on any wire (no effect on components). The brief's "first frame of a run is a full list" was not written: a retake of a held row keeps its id and can stream as `message` from its first frame; the doc gives the exact rule (a row's first appearance is an add → full list; `message` only replaces a held row). Harness compares by content (test authors build fresh objects). Name `takes` (the owner's word; §24 grep: only unrelated local fields `back.takes`, `rulesetWords.ts`, flagged ⚠ in §25; `understands` offered as the collision-free alternative). File-local helpers not ledgered.

## Scope review: nothing blocking, five Low
(1) wire edits beyond the two hunks → accepted as necessary; (2) first-frame wording → accepted as a brief correction; (3) file-local names not in §25 → rejected (ledger records published/wire names); (4) reports not on disk → this report; (5) `{ t: 'message' }` lacks `@experimental` → predates, Noticed. Confirmed: P1 holds (silent frame byte-identical), the security boundary holds (`projectMessageRow`; unheld lane gets nothing).

## Open ★
None. Soft: `takes` vs `understands` — **lead: `takes` stays.**

## Noticed, not done
`ui-preview/src/lib/framePort.ts:207` (frame preview harness) never posts `message`. The `{ t: 'message' }` member lacks an `@experimental` doc tag. `PluginFrame.svelte:70` prop doc said "re-sent wholesale on change" (now true only for a silent frame) — **lead fixed the line**. perf-H's §25 entry still says a frame never declares (ledger is append-only; perf-M's entry states the change). `state_referenced_locally` warnings in the oneMessage tests. `cli/src/scaffoldComponent.ts:122` posts a bare `ready` (correct for a component).

## Lead's acceptance note
Accepted 2026-11-14. The exact first-appearance rule replaces the brief's wording. `takes` stands. The preview harness and the `@experimental` tag are queued for the SDK's owner pass, not fixed in passing.
