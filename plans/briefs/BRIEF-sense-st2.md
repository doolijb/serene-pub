# BRIEF — lane `sense-st2` — one undo rule: a turn owns what it wrote

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then plan §1.3 Rule 1, §1.5, §1.6, the
ST2 row in §1.7, ★S2 in Part 3 and §5.8–§5.9 in `plans/PLAN-sensible-engine-2026-11-11.md`; review rows A2 and B4 in
`plans/REVIEW-sensibility-2026-11-11.md`; `docs/sessions.md` (swipe, regenerate, Back, Forward, delete; line ~285
says a swipe "takes back everything the old reply changed"); `../serene-pub-sdk/guides/storage.md` (the table of what
each verb does to each home); `../serene-pub-sdk/INTEGRATING.md` on the annex; NOMENCLATURE §1, §24, §25.
`plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers word for word.

## The owner's ruling (2026-11-11, verbatim)

Asked: "When a turn is replaced (swipe or regenerate), should everything that turn wrote go back with it, including
its clock moves and scene boundaries? This narrows your 2026-10-17 ruling 'a swipe re-tells, never re-plans'."
Answer: "Yes, a turn owns what it wrote (Recommended)" — described to them as: "Swipe, regenerate and Back all take
back the same set: state, clock moves, scene boundaries, draws. A genre can declare what it keeps across a re-tell.
One undo rule for modders."

## Goal

1. **Inventory first, in the report.** Every caller of `retractStateAnchoredTo`
   (`src/lib/server/state/write.ts:811`; known: `sockets/sessions.ts` ~9326 and ~9962, `sessions/rewind.ts` ~646,
   `pipelines/runtime/host.ts` ~9842, `utils/generationStatus.ts` ~243) with the verb it serves and the `ticks`,
   `scenes`, `annex` flags it passes, and what each flag keeps today. Include what a seat-bench retraction does under
   `annex: 'keep'` (A2). Re-read the lines: they have moved.
2. **Two cases, not three flags.** The function takes the case, **replaced** (swipe, regenerate, a failed run's
   cleanup) or **leaves** (Back, delete), and both take back everything the message wrote: values, proposals,
   configurations, clock moves of every cause, scene boundaries, zone snapshots, lore, cast versions, annex deltas,
   seat changes, draws. The only thing a case may differ in is what Forward can restore; if you find another real
   difference, report it before building around it. The `ticks` / `scenes` / `annex` options go.
   - The round's tick is now an event run after the round ends (`core:spec/round-tick`, cause `'tick'`); Story's
     per-reply tick is gone. Confirm which message a round tick's move is anchored to, and that replacing that
     message takes it back and a re-driven round ticks once, not twice. The old sentence "the re-driven reply never
     ticks again" (write.ts ~789) described the removed step.
3. **A genre declares what it keeps on a re-tell.** One optional key on an annex field's declaration, proposed name
   `keepOnRetell` (check §24 and grep both repos for a collision; record it in §25; an unknown value is a
   declare-time finding). A field so declared keeps its value when its turn is **replaced**; it still goes when the
   turn **leaves**. Absent means it goes. The Dungeon Crawler declares it on its plan fields, so a swipe there still
   re-tells from the same plan (the 2026-10-17 behaviour, now that genre's declaration and nobody else's). A2: with
   the plan kept, whatever the plan decided about seats is kept with it or taken with it, never split; say which you
   chose and why.
4. **A run a person started with a press** anchors its annex writes to the newest message, as own-book lore writes
   already do (`turnAnchorOf`). Today they have no anchor and are permanent at once. A person's own edit in a form
   is not a turn's write and stands.
5. **Forward** restores what either case took. The settle line (`assertRetractable`) is untouched.
6. **Docs in the same change:** `docs/sessions.md`, `../serene-pub-sdk/guides/storage.md` (the verbs table becomes
   two rows of behaviour), `docs/genre-dungeon-crawler.md` if it describes the swipe, NOMENCLATURE §25.

## Files owned

`src/lib/server/state/write.ts` (`retractStateAnchoredTo`, `restoreRetractedState` and what they call),
`state/clockMoves.ts`, the scene-boundary take-back it calls, the five call sites (those lines only),
`sessions/rewind.ts`, the annex delta write path where the press anchor is set, and the tests beside each.
In `../serene-pub-sdk/`: the annex field declaration type and its validation, the Dungeon Crawler's annex field
declarations, the storage guide, tests and pins these move.

## Out of scope

Annex per key and retiring `annex_deltas` (ST3, next lane: do not reshape the delta table); runtime keys to
columns; the settle line; On revision; branches; Apply; any UI beyond a changed sentence; a migration (stop if one
is needed).

## Stop and ask when

A migration or stored-data change would be needed; a published name other than the one new key would change;
taking scene boundaries on a replacement would delete a scene that later messages already sit in (report the case
and your recommendation); the two cases cannot be made to take the same set for a reason in the data.

## Done means

Tests that fail before and pass after: swipe, regenerate, Back and delete each take back a value, a clock move, a
scene boundary, an annex write and a seat change made by the turn; Forward restores them after Back; a Dungeon
Crawler swipe keeps its plan fields and whatever rides them; a press-started annex write is taken by Back past it; a
round tick is taken with its round and re-ticks once. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
clean. **SDK build:** another lane (`sense-clk4`) is also building the SDK. Do your SDK edits last; before
`npm run sdk:build`, check `pgrep -af "vite dev"` and `pgrep -af "vitest|tsx --test"`; if any other test run is
live, wait for it to end; build once. Then `sdk-tests/coreCatalog.test.ts`: report the digest if it moved, do
**not** re-pin it (the lead re-pins once per wave).

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-st2-2026-11-11.md`):
the inventory table, what each case takes, the name chosen, changed files in each repo, tests and results, pins that
moved, open ★, provisional copy, **Noticed, not done**. Wait for every worker to finish before you report.
