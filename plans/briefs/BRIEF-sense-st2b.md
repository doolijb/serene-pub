# BRIEF — lane `sense-st2b` — close the undo rule's review findings, and simplify the Lair's clock

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/briefs/BRIEF-sense-st2.md`
and `plans/REPORT-sense-st2-2026-11-11.md`; `plans/REPORT-sense-clk2-2026-11-11.md`, `-clk3-`, `-clk4-` (the clock as
built, and the scope review at the end of clk4's). `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and
your workers word for word. Two independent parts; begin each by re-reading the cited lines.

## Part A — the undo rule (scope review of `sense-st2`, and three owner rulings of 2026-11-11)

Rulings, verbatim choices: the round's clock move on a swipe — "Keep the round's move on a swipe"; the Dungeon
Crawler's reveal — "Follow the rule, change the copy".

1. **A scene boundary goes with a turn only when nothing sits after it.** `state/write.ts` ~916 calls
   `takeSceneBoundariesAt` (`scenes/liveScenes.ts` ~1964–2049) in both cases. A row regenerate accepts any row id
   (`sockets/sessions.ts` ~9328), and a plugin's delete of an older row (`runtime/host.ts` ~9853) now takes
   boundaries too; either can delete or reopen a scene that later lines already sit in. Rule: in either case, a
   boundary at the row is taken only when no later live line of the session sits at or after it in that scene's
   channel; otherwise it stays exactly as it is. Back's newest-row case behaves as today. If a boundary a **person**
   set at that row (Start scene, Mark as scene, a selection) can be told from one the turn wrote, say so in the
   report and recommend; do not build a second rule. Tests: regenerate and delete of an older row with later lines
   keep the scene; of the newest row take it. Fix the stale comment at `liveScenes.ts` ~1964.
2. **A failed re-tell must not lose annex values.** After a failed run, `utils/generationStatus.ts` ~244 and the
   inner call in `restoreRetractedState` (`write.ts` ~1324) retract as replaced, so the failed run's own delta rows
   that touch kept keys stay; `restoreAnnexDeltas` (`sessions/annexChanges.ts` ~301–331) then lands the newest row
   for the message, which is the failed run's. Fix so the restore lands what the swipe took (take the failed run's
   deltas fully first, or land the newest row that was taken). Test with a fixture genre whose re-tell writes a
   `keepOnRetell` field and then fails: every value is as before the swipe.
3. **The reveal follows the rule.** `../serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/reveal.ts` ~111 and
   ~117 and `docs/genre-dungeon-crawler.md` ~270–272 stop saying it cannot be taken back; say instead that Back past
   it hides the notes again. Provisional copy, listed in the report.
4. **The round's move on a replacement is ruled, not interim.** Remove "interim" from
   `../serene-pub-sdk/guides/storage.md` ~74–76 and any ★ST2-1 comment; the sentence in `docs/sessions.md` ~285
   stands. `docs/stats-and-states.md:90`: "a reply's fixed tick" becomes "a round's move".
5. **`sessions/retakeTurn.ts` `deleteTurnYield`** takes scene boundaries by the same rule as 1 (call the one
   function per row if that is the smallest change).
6. **Say who wrote `utils/generationStatus.ts` ~249–268** (a seat-change announcement in a failed reply's cleanup).
   If `sense-st2` added it, list it in the report as beyond that brief; do not remove it.

Files owned (A): `state/write.ts`, `scenes/liveScenes.ts` (`takeSceneBoundariesAt` only), `sessions/annexChanges.ts`,
`sessions/retakeTurn.ts` (`deleteTurnYield` only), their tests and `sessions/oneUndoRule.int.test.ts`, the three doc
files, `reveal.ts` (the two strings).

## Part B — the Lair's clock is the round tick, in every preset (owner, 2026-11-11)

Told that the Lair's fixed round move sits behind the keeper's model call and stalls when it fails, the owner chose:
"Round tick in every Lair preset (Recommended)" — described as: "Code only, can never stall, identical to Story. The
routine moves time only when 'Move the clock' is switched on. Removes the step-aside gate and the Lair routine's name
from the shared round tick." This replaces the earlier rulings that the Lair's routine owns the clock and that Words
only alone uses the tick.

1. `core:spec/round-tick` goes back to: the round worth, the `moves` gate, the `at` gate, the `advance` outlet. The
   `modes` query and the `keeper` junction go. Its outlet key returns to what it was before the gate.
2. The Lair registers the round tick in its genre defaults, as Story does; the per-preset registration in
   `seed/presets.ts` (Words only) goes.
3. The keeper loses its round-worth move: `ReckonTerms.ownsTheClock`, the reckon script's `clockUnnamed` and the
   `round` branch in `shared/reckoning.ts` go. The keeper moves the clock only when its *Move the clock* is on and
   it names a move; that ships off in every Lair preset, as in Story.
4. Tests: `sdk-tests/coreClockOwners.test.ts` (every Lair preset → `[round-tick]`), `coreGenreDefaults.test.ts`,
   `src/lib/server/pipelines/routines/clockOwners.int.test.ts` (each Lair preset: one move of the round worth per
   round, with the keeper Off and at Review; worth 0 moves nothing). Docs: `docs/genre-lair.md`,
   `docs/lorebook-time.md`, `../serene-pub-sdk/guides/time.md`. NOMENCLATURE §4 round tick, §9 round worth, a §25 row
   that retires `ownsTheClock` / `clockUnnamed` (never shipped).
5. **Keep** the empty-branch store rule (`sdk/src/document.ts` `orderedChains`, `boot/store.ts` `chainsOf`) and its
   tests: adjust only the cases that used the round tick's keeper junction as their example, with a fixture junction.

Files owned (B): in the SDK `core-catalog/src/shared/roundTick.ts`, `shared/reckoning.ts`, `genres/lair/keeper.ts`,
`genres/defaults.ts`, `seed/presets.ts` (the Words only registration), `sdk-tests/coreClockOwners.test.ts`,
`coreGenreDefaults.test.ts`, `junctionEmptyBranch.test.ts`; in the app `routines/clockOwners.int.test.ts`,
`boot/clauseChainRoundTrip.int.test.ts`; the docs and NOMENCLATURE rows above.

## Pins

Spec hashes and the SDK digest will move (round-tick, lair-keeper, the Dungeon Crawler's reveal). **Report each
recorded-vs-code pair; do not re-pin**: the lead re-pins once after this lane, in
`src/lib/server/pipelines/boot/specHashes.test.ts`, `registryHashes.test.ts` and `sdk-tests/coreCatalog.test.ts`.
Those three pin tests are expected red at hand-back for that reason and no other.

## Out of scope

ST3 (annex per key, draws, runtime keys); the tie-break in the chain rule; `replyRoad.int.test.ts`; migrations.

## Done means

Part A's and B's tests pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean; one
`npm run sdk:build` after the last SDK edit, after `pgrep -af "vite dev"` and `pgrep -af "vitest|tsx --test"` show
nothing else live.

## Report

**Return the full report as your final message**, after every worker has finished: per part, what changed, the rule
as built, tests and results, every pin pair that moved, provisional copy, open ★, **Noticed, not done**.
