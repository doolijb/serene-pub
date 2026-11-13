# BRIEF — lane `sense-clk4` — an empty junction branch survives the spec store; finish the Words only clock

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/briefs/BRIEF-sense-clk.md`
(its **Verbatim rules** bind you and your workers word for word), `plans/briefs/BRIEF-sense-clk3.md` part A (the
ruling and what "done" is), `plans/briefs/BRIEF-sense-clk3-w1.md`, and `../serene-pub-sdk/INTEGRATING.md` on the
spec document, its hash and the store.

## Where it stands (2026-11-11)

Part A of `sense-clk3` is on disk but not finished. The round tick (`../serene-pub-sdk/core-catalog/src/shared/
roundTick.ts`) gained a junction `clock.moves.clocked.at.keeper` on `core:query/session-settings@1`'s
`routineModes.core:spec/lair-keeper`: two **empty** branches (`review`, `full`) and an otherwise branch `tick`
holding the `advance` outlet. The SDK compiles and validates it: chains `["review","full","tick"]`.

**The defect:** `src/lib/server/pipelines/boot/store.ts` `chainsOf` (~1184) rebuilds a clause's chains from the
nodes and nested clauses that sit in them ("chains are not stored"). A branch with no member vanishes on load, so
the stored junction has only `tick`, it fires as the default, and Words only with the keeper on moves the clock
twice. This is a general store defect: any author's empty branch silently falls through to the default.

A document's hash keeps array order (`sdk/src/hash.ts` sorts object keys only), so the chains a load rebuilds must
come back in the same order the compiler wrote, or the document re-publishes on every boot. `branches` is stored
(jsonb, so its key order is not the declaration order).

## Goal

1. **First, measure.** List every junction in core's compiled specs (`CORE_SPECS`) and in the test fixtures that has
   a branch with no member, and say whether any is declared before a non-empty branch. Report the list.
2. **One ordering rule, on both sides, so the two can never disagree.** Recommended: a clause's chains are its
   member-holding branches in position order (as today), then its member-less branches by name. The store's
   `chainsOf` adds the member-less ones from the stored `branches` keys; the SDK's compile step orders `chains` by
   the same rule. If goal 1 finds an existing core spec whose hash this would move, or you find a simpler rule that
   moves none, say so and take the one that moves fewest pins; if the rule would change which branch **runs** for
   any existing spec, stop and report.
3. **Tests.** Store round trip: a document with an empty branch, declared first, in the middle and last, loads with
   the same hash it was saved with, and a second boot publishes nothing. Executor: the empty branch is taken (nothing
   runs, the default does not fire). SDK: compile orders chains by the rule.
4. **Finish Part A.** `clockOwners.int.test.ts`'s Words only keeper-on case goes green (one move, not two).
   Update `sdk-tests/coreGenreDefaults.test.ts` (lines ~276–287: the old outlet key `clock.moves.clocked.at.advance`
   and clause; the parity list now has `lair-words-only` registering `round-ended → round-tick`). Re-pin
   `core:spec/round-tick@1.0.0` in `src/lib/server/pipelines/boot/specHashes.test.ts`, the SDK digest in
   `sdk-tests/coreCatalog.test.ts`, and `registryHashes.test.ts` if it moves, each with a dated `sense-clk4` note.
   NOMENCLATURE: §4 **round tick** row ("Story, and the Lair's Words only, where it steps aside while Keep the books
   is at Review or Full"), §9 **round worth** row, one §25 row for Part A.

## Files owned

`src/lib/server/pipelines/boot/store.ts` (`chainsOf` and its call site only) and its tests; in the SDK the compile
step that writes `clause.chains` and its tests; `core-catalog/src/shared/roundTick.ts`;
`sdk-tests/coreGenreDefaults.test.ts`, `coreClockOwners.test.ts`, `coreCatalog.test.ts`;
`src/lib/server/pipelines/routines/clockOwners.int.test.ts`; the hash pin files; the NOMENCLATURE rows above.

## Out of scope

Storing chains in a new column (no migration); any new predicate kind; `replyRoad.int.test.ts`; everything else.

## Stop and ask when

The rule would change which branch runs, or move the hash of a spec that shipped at pr-7 other than by this lane's
own round-tick change; a migration would be needed; the SDK's published document shape would change.

## Done means

Goal 3's tests and `clockOwners.int` (6/6), `roundTick.int`, `roundWorth.genres.int`, `specHashes`, `registryHashes`
pass; SDK `coreClockOwners`, `coreGenreDefaults`, `coreCatalog`, the compile tests pass;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean; `pgrep` check, then `npm run sdk:build` once
after the last SDK edit.

## Report

**Return the full report as your final message** (the lead saves it): goal 1's list, the rule chosen and why, pins
moved, changed files in each repo, tests and results, open ★, **Noticed, not done**.
