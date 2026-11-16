# REPORT — lane `time-t6b` (2026-11-15): the firsthand filter is BUILT, opt-in; no shipped pipeline invokes it

Saved by the lead from the supervisor's report. The alternative-method recipe is HELD (★T6B-2).

## Inventory (file:line, verified)

- Nodes: `contracts/src/queries.ts` `sessionHistory` ~48 (in-ports ~258–352), `earlierScenes` ~1388 (~1458–1480).
- Bindings (`runtime/bindings.ts`): session-history ~2473 (`ctx.read("session_messages")`), earlier-scenes ~8722
  (`scenes/earlierScenes.ts` `earlierScenesOf`).
- Host read `host.ts` ~3970–4216; rows through `toMessage` ~12975 (carries `castMemberId` when set, never
  `firsthandCastMemberIds`). The window is 2× the budget, read before any filter.
- Speaker: `$.input.characterId` → member via `seatOf(db, sid, 'character:N')` (`sessions/seats.ts` ~1989), the
  same rule as `messages/store.ts` `speakerMemberOf` ~146.
- Scenes: a range scene holds `opened`..`closed` inclusive on its lane; a tick scene holds `selectedMessageIds`
  (`schema.ts` ~4904–4918, `liveScenes.ts` `liveRangeLineIds` ~351).
- Hidden: `is_hidden`, `rewind_ordinal`, `is_generating`; swipes are versions on one row.
- Stat trail: `statTrailFor` (`state/statTrail.ts` ~228), one member's whole trail per call.
- Receipt: `ctx.log` → `NodeReceipt.notes` (`executor.ts` ~1927), the run inspector's **Notes** tab.

## The rule as built

The brief's rules 1–5. Choices: the option is on when the `firsthandFor` key is present (a wired port arrives
as a key even when null); a read of one row by id is never filtered; a line in both a range and a tick scene
goes to the range scene; a scene with no live line keeps its summary; the place value in force is the newest
message point at or before M, else the newest timeline point.

## Names and sentences (all 🚧)

- In-ports on both nodes: `firsthandFor` (`S.rowIds`), `firsthandBy` (`S.text`): ports, not params.
- `validate()` warning (law `firsthand 2026-11-15`): *'‹key›' reads every earlier scene's summary, while the
  session history beside it leaves out what the speaker was not there for* · *'‹key›' reads every message, while
  the earlier scenes beside it leave out what the speaker was not there for*.
- App module `sessions/firsthandFilter.ts`: `loadFirsthandView`, `FirsthandView`, `FirsthandRead`,
  `wasThereFor`, `keptLineIds`, `keptSceneIds`, `linesReceipt`, `scenesReceipt`, `readsAllReceipt`,
  `placeKeyOf`, `valueInForce`.
- Receipt notes: *‹n› messages left out: ‹name› was not there* · *No messages left out for ‹name›* · *‹n› scene
  summaries left out: ‹name› was not there* · *No scene summaries left out for ‹name›* · suffix * (‹stat› is not
  tracked here, so by scene only)* · *Reads everything: not one cast member's turn*.
- Recipe marker `js recipe <id>` (today: `living-recall`). Guide heading *What a character was there for*.

## Statements per reply (at the binding)

Not invoked: 0. Invoked, no stat: +13 per node (+26 with both). With a stat and 3 members: about +70 per node
(about 19 per `statTrailFor` call, once per member).

## Changed files

SDK: `contracts/src/queries.ts`, `sdk/src/validate.ts` (~1319–1357), new `sdk-tests/firsthand.test.ts`,
`sdk-tests/nodeInput.assert.ts` / `nodeInput.test.ts`, `guides/genres-presets-and-routines.md` (~399–438),
`guides/time.md` (fence info).
App: new `src/lib/server/sessions/firsthandFilter.ts` (+ unit and int tests), `pipelines/runtime/bindings.ts`
(two bindings), new `bindings.firsthand.int.test.ts`, `pipelines/boot/registryHashes.test.ts` (two re-pins),
new `pipelines/scripts/guideRecipes.int.test.ts` (replaces `livingRecallRecipe.int.test.ts`),
`docs/pipelines.md`, `docs/sessions.md`, `NOMENCLATURE.md` (§14 **firsthand** redefined; §25 records ★5 / §5.4
as replaced).

## Verification (lane's)

`sdk:build` 13:48 and 13:59. `sdk:test` 4743/4748 (the known four). App: 10 files, 89 pass, 2 fail, both in
`paramsSlotWiring.test.ts` on `core:spec/speak-message` (baseline, not this lane). SDK guides tests 40/40.
`tsc` 0; `npm run check` 0 errors.

## Open ★

- ★T6B-1 the names and sentences.
- ★T6B-2 the alternative-method recipe: the drafted one (by who was seated per message) needs `host.ts`
  `toMessage` to carry `firsthandCastMemberIds`, widening every history row. Not built; the guide has no second
  recipe yet.
- ★T6B-3 the history read is sized before the filter, so a character that missed a lot reads fewer lines than
  the window holds (stated as a limit; the fix is in `host.ts`).
- ★T6B-4 about 70 statements per node when a stat is named (a grouped multi-member trail read would cut it).

## Queued

INTEGRATING.md: a line for `firsthandFor` / `firsthandBy`.

## Noticed, not done

`prettier --check` flags the lane's files; leftover `/tmp/serene-pub-vitest-*` dirs not attributed; a test
fixture held a row rewound but not hidden (real rewound rows are also hidden).

## Scope review and fix lane `time-t6b-fix` (2026-11-15)

Scope review: in scope; unwired reads are byte-identical; the filter only narrows; Bench plays no part; hash
re-pins need nothing for 0.6 installs. Five findings, all fixed by the fix lane, plus the second recipe.

1. A seat with a name and no card is filtered too: `loadFirsthandView` takes `castMemberId` (from the session
   scope's `currentCastMemberId`, `runTurn.ts` ~1839, ~1965) when there is no card id; both bindings pass it. No
   published port changed.
2. No quadratic loops: pure `firsthandViewOf` builds scenes per channel, a line → tick-scenes map,
   `spokeInSceneIds` and indexed trails once. A 5,000-line, 200-scene fixture is decided in under a second.
3. The place rule reads the messages clock only (`statTrailFor` `mode: "messages"`); a later timeline value no
   longer drops earlier lines. Per node: +13 statements with no stat, +67 with a stat and three members.
4. *witness* removed from published prose and comments; comments state the rule; re-pins carry their "(was …)".
5. The recipes test's `scanRecipes` throws on any fence whose info string contains `recipe` and is not exactly
   `js recipe <id>`.
6. Second recipe, guide subsection 🚧 *Another rule*, id `spoke-or-named`: a script step keeps a history row
   when the speaking seat said it, its text names the seat (whole word, case-folded), or it is a person's line
   (`KEEP_PERSON_LINES = true`); run through the real applier by the recipes test. Limit as written: *It misses a
   character addressed by a nickname or a title, and it never reads scene summaries.* **★T6B-2 is closed.**

New 🚧 names: `firsthandViewOf`, `FirsthandSceneRow`, `FirsthandLineRow`, `spokeInSceneIds`, recipe id
`spoke-or-named`. Verification: `sdk:build` 14:28; `sdk:test` 4743/4748 (the known four); 6 app files 80/80;
`tsc` 0; `npm run check` 0 errors.

Noticed, not done: `sdk/src/validate.ts` ~1320 comment still says "witnessed"; `queries.ts` JSDoc carries
"(opt-in, 2026-11-15)" dates; a stale "Measured 13 and 70" comment in the loader int test.
