# REPORT — lane `perf-F` — the client does per-row work while a reply streams, and ships explicit icon maps — 2026-11-13

Supervisor's report, relayed to disk by the lead (the harness refused the supervisor's own write). Steps 1, 3 built;
step 2's in-lane half built, its row-patch half queued (★P14); step 4 built for every closed-set lookup, bundle
unchanged (★P15). Nothing committed; no new event, setting, user-facing name or lazy import. Worker briefs:
`plans/briefs/BRIEF-perf-F-w1..w4.md`.

## Step 1 — page-side deriveds (B5): verified, then built

A counting test (40-row session, newest row generating, 50 `upsertMessage` frames with new content, reasoning and
`updatedAt`, `flushSync` each) showed every page derived rerunning per frame. Built: **live rows** in
`sessionStore.svelte.ts` — each held row is a plain object of enumerable getters over per-field `$state.raw` cells; a
frame for a held row with the same key set patches only the cells whose value differs (`Object.is` / structural
deep-equal), so the row object and the rows array keep their identity; a row with a different key set is replaced;
`previous` is a pre-patch snapshot (`witnessMessage` unchanged); `load`/`merge` patch by the same rule, `merge`
rewrites `windows` only when ids change; `prependMessages` still skips held ids. Reads through `[[Get]]` (spread,
JSON, `structuredClone`, `postMessage`, `$state.snapshot`, socket.io) are value-identical. `rewindStateWith`
(`shared/sessions/rewind.ts`, that function only) is one backward loop, no allocation. `sessionPageData`,
`openSessionView`, `SessionHostViews` needed no change.

| derived (50 frames, 40 rows) | before | after |
|---|---|---|
| `rows`, composed `session`, `lastMessage`, `hasGeneratingMessage`, `generating`, `lastAuthorLine`, `rewind`, `lorebookFixed`, `lastSettledMessageKey` | 50 each | 0 each |
| `generatingOf` / `lorebookFixedOf` calls (page + view) | 100 + 100 | 0 + 0 |
| rows array same reference across frames | no | yes |

Also tested: a settle frame reruns exactly the readers of `isGenerating`; replace path gives one `rows` rerun;
`sourceOf(row)` is the latest incoming object; after every frame the derived values equal a fresh plain computation.
Identity reliance grepped (untrack near rows, row identity compares, WeakMaps by row, in-place mutation): none needs a
new row object. The genre `PluginFrame` is handed the now-stable array and still streams because the wire's `push()`
reads every row field inside its effect.

## Step 2 — widgets (B4): in-lane half built, row patch queued ★P14

`RemoteWidget.svelte` uses new `host/remoteMessages.svelte.ts` (`createRemoteMessages`): per-row projection and
snapshot cached in a `WeakMap` keyed by `sourceOf(row)`; plain (pending-reply) rows projected fresh as before;
`readsMessages` gate unchanged. `widgetWire.svelte.ts` gets a per-section identity memo (`heldFrom` /
`postChangedFrom`): a section whose input is the same reference is skipped before any stringify or clone, for the
sections whose providers provably replace rather than mutate (annex, turn order, attendance, actions, props, theme,
locale); session, settings, scoped, viewer, layout, grants keep today's JSON comparison. Messages still post on every
push. Savings of this half alone: wire `JSON.stringify` over 50 messages-only pushes 600 → 150 (asserted);
`projectMessageRow` calls over 50 frames on 40 rows 2000 → 50; posted values equal a fresh full projection after
every frame. The brief's "50 row patches and one list" test is impossible until ★P14: `{t:'message'}`
(`sdk/src/surfaces.ts:225`) has no receiver in `sdk/src/componentWire.ts` or in plugin iframes.

## Step 3 — SDK rows (B6): built

(The brief's path `core-catalog/src/shared/ui/conversation/conversation.svelte.ts` does not exist; the file is
`core-catalog/components/shared/messages/conversation.svelte.ts`.) `conversation.svelte.ts` computes once per list
change `anyGenerating`, `rowById(id)`, `isScened(id)`, `messageCount` via new pure `rowFacts.ts`; `SessionMessage`
reads them O(1) (`isDiceLine(msg, asked ? [asked] : [])` — same answer, it only ever `find`s that id);
`SessionContainer`'s `cueAt`, `settledMarkAfter`, `lanePlaces`, `laneById`, `lastOwnId` keyed on a new `laneKey`
beside `msgOrderKey` with bodies under `untrack`; `MessagesWidget`'s `selectable` is a function called at press
time, tabs' `seen` effect and `dots` keyed on `newsKey`. New `sdk-tests/conversationRowFacts.test.ts` pins the
equivalences. `sdk:build` passed (peer cleared it); `sdk:test` 4689/4696 — the 7 failures are not this lane's
(three were the peer's and are fixed; `deriveDontSpell`, `surface.test.ts:447`, `vocabulary.test.ts:195` are older);
every conversation suite green.

## Step 4 — icon map (G1 / W6-a): closed sets mapped, bundle unchanged ★P15

24 computed lucide lookups classified: 19 CLOSED (converted to explicit maps over named imports, every fallback
kept; new shared `shell/adminNavIcons.ts` with a test that fails on a missing or unused entry;
`routes/+layout.svelte` now imports `X` by name), 5 OPEN (`sessionLayoutModel.svelte.ts:350`,
`editorMembership.svelte.ts:115`, `surfaces/Panel.svelte:149`, `surfaces/SurfaceGrid.svelte:338/402`,
`sessionPage/pressRouting.svelte.ts:620` — any lucide kebab name a package declares). Bundle after `npm run build`:
`nodes/0.*.js` 2,713,102 → 2,713,045 B; largest (lucide) chunk 2,250,911 → 2,255,772 B. The whole set stays while
any OPEN lookup remains (★P15).

## Changed files

App: `sessions/store/sessionStore.svelte.ts` (peer's `mergeRunStatus` untouched), `shared/sessions/rewind.ts`
(`rewindStateWith` only), `components/host/RemoteWidget.svelte`, `components/frames/widgetWire.svelte.ts`,
`routes/+layout.svelte`, `admin/AdminView.svelte` and the 19 icon files, new `sessionStore.streaming.dom.test.svelte.ts`,
`host/remoteMessages.svelte.ts` + dom test, `frames/widgetWire.perToken.dom.test.svelte.ts`,
`shell/adminNavIcons.ts` + test. Unchanged by this lane: `derive.ts`, `records.ts`, `openSessionView.svelte.ts`,
`sessionPageData.svelte.ts`, `sessionPageProjections.ts`, `SessionHostViews.svelte`.
SDK: `core-catalog/components/shared/messages/{SessionMessage,SessionContainer,MessagesWidget}.svelte`,
`conversation.svelte.ts`, new `rowFacts.ts`, new `sdk-tests/conversationRowFacts.test.ts`. `TurnLine.svelte` untouched.

## Tests

Lane app tests after `sdk:build`, capped: 130 files / 1,097 passed (store, shared/sessions, frames, host, sessionPage
remote/composer/stream, projections, shell, admin). `tsc` exit 0. Prettier: new files clean; `sessionStore.svelte.ts`,
`rewind.ts`, `widgetWire.svelte.ts`, `RemoteWidget.svelte` were unclean at HEAD, own lines formatted by hand; SDK
`.svelte` files have no prettier parser configured. `svelte-check` not run by the lane (OOM at 47 s for a worker); the
lead's grouped run covers it.

## Open ★

- **★P14** (row patch across the worker boundary) — see the plan.
- **★P15** (package-declared icon names keep the whole icon set) — see the plan.
- Step 2 follow-on for the owners of session, settings and scoped: if those objects are replaced rather than mutated,
  their sections can take the identity skip too (150 → ~0 stringifies per 50 frames).

## Noticed, not done

`adminNav.ts` header still says `Icons[item.icon]`; `SessionHostViews.svelte` and `RemoteWidget.svelte` keep
`import * as Icons` with static members only (tree-shakes); `rewindStateWith` reruns when `reasoning` moves in the
`step === "message"` + "nothing" case (value unchanged); `lorebookFixedOf` tracks a streaming row's `metadata` only
when it is the only row; `sessionPageData` ~703–707/~858 `Math.min(...)` spreads in handlers; `RemoteWidget` callers
pass inline `props={{…}}` so that skip never fires there; SDK `rows` re-filter and `msgOrderKey` still O(N) once per
token; `emitRedacted` still deep-walks every frame (B2's other half).

---

## Lead's acceptance note (2026-11-13)

- **Prettier churn in the 20 icon files (worker w2 ran `prettier --write`; ~747/286 lines, whitespace and wrapping
  only, behaviour unchanged).** The lead checked that none of the 20 files carried another session's edits before w2
  (absent from the tree's modified list at session start). A restore-from-HEAD-and-redo was prepared
  (`plans/briefs/BRIEF-perf-F-w5.md`) but the permission system declined it, as it had declined the worker's own
  restore; the lead did not work around that. **The reformat stays as is; ★P16 for the owner:** keep it (the files
  were prettier-unclean at HEAD; this makes them clean) or authorise the redo brief, which is scripted and quick.
- Everything else accepted as reported. Scope review follows.

- **Scope review (four findings, all accepted, fixed by the lead):** (1) the client's "live row" collided with
  NOMENCLATURE §9's **live row** (the server's streaming placeholder) — renamed to **cell row** (`cellRow`,
  `patchCells`) in code, comments and tests; (2) §25 bullet added for the lane's names; (3) a guard test
  `components/outputKindIcons.test.ts` checks the four `OUTPUT_KIND_COMPONENTS` maps against `OUTPUT_KIND_ICONS`;
  (4) the unused `onProject` parameter dropped from `createRemoteMessages`. The review's one nit, `newsKey` writing
  `m.role ?? ""` where `newestNewsOn` tests `?? 'user'`, is fixed in the SDK source (`MessagesWidget.svelte`); the
  built dist lags until the next `sdk:build`, which the peer runs at the end of its current lane (behaviour identical
  either way, since the server always sends a role). Correctness checks (a) getters vs consumers, (b) section
  providers replace rather than mutate, (c) `laneKey` inputs — no objection.
