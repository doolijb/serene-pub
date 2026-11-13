# BRIEF — lane `sense-clk3` — two rulings applied: the Lair's Words only clock, and a conversion's stamp

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/briefs/BRIEF-sense-clk.md`
(its **Verbatim rules** bind you and your workers word for word), `plans/REPORT-sense-clk2-2026-11-11.md` and
`plans/REPORT-sense-age2-2026-11-11.md` (what exists; ★CLK2-1 and ★2), NOMENCLATURE §1, §24, §25, `docs/genre-lair.md`,
`docs/rulesets.md`. Two independent parts: one worker each.

## Part A — the Lair's Words only preset (owner, 2026-11-11)

Asked what owns the Lair's clock when *Words only* ships its *Keep the books* routine off, the owner chose:
"Routine; Words only uses the round tick (Recommended)" — described to them as: "the routine owns the clock where it
runs. Words only, which has no routine, falls back to the deterministic round tick. If a GM later switches the
routine on in Words only, the routine takes over and the tick steps aside."

1. *Words only* registers `core:spec/round-tick` (its preset's own registration; Rules and The rules decide do not).
2. **Exactly one move per round in every state.** With the keeper Off in Words only: the round tick moves the round
   worth. With the keeper switched on there: the keeper's move (named, or its round-worth branch) is the only one and
   the round tick moves nothing. Find the least-new way for the tick to know: a condition on what the session
   already publishes about the routine's mode is preferred over any new name. If it cannot be done without a new
   published name or a second writer, stop and report with a recommendation; build step 1 regardless.
3. Extend `sdk-tests/coreClockOwners.test.ts` (Words only → `[round-tick]`) and
   `src/lib/server/pipelines/routines/clockOwners.int.test.ts` (Words only: one move of the round worth; keeper
   switched on in Words only: one move, not two). `docs/genre-lair.md`, `docs/lorebook-time.md` and
   `../serene-pub-sdk/guides/time.md` say it in one sentence each.

Files owned: `../serene-pub-sdk/core-catalog/src/seed/presets.ts` (the Words only registration only),
`core-catalog/src/shared/roundTick.ts`, `core-catalog/src/genres/defaults.ts`, the two tests, the three doc files,
and the pins these move (`sdk-tests/coreCatalog.test.ts`, `src/lib/server/pipelines/boot/specHashes.test.ts`,
`registryHashes.test.ts`): re-pin only with a dated note naming this lane.

## Part B — a ruleset conversion keeps a renamed value's stamp (owner, 2026-11-11)

"Renamed keeps its stamp (Recommended)" — described as: "A rename is a re-key, so the value keeps the time it was
really written. A default added by the conversion gets no stamp and reads as unknown."

1. `src/lib/server/sessions/convertRuleset.ts`: the renamed value (line ~187) carries its old row's five
   `story_clock_*` values **and** its `created_at` (so `realSeconds` follows too); the added-slot default (~242)
   carries no stamp. The `clear` row (~156) is already unstamped.
2. The smallest way: one optional, core-internal field on `setValue`'s change in `src/lib/server/state/write.ts`
   that either supplies a stamp to keep or says "no stamp". Not published, not reachable from a plugin or a socket
   payload. Name it by §24, record it in §25. Every other caller behaves exactly as today.
3. Tests in `src/lib/server/state/valueStamp.int.test.ts` or beside the conversion's own tests: a renamed value's
   `writtenAgo` minutes continue from the original write; an added default reads null; an ordinary `setValue` still
   stamps now.
4. Also add the test the scope review asked for: a branch's as-of read at a copied line sees the copied value rows
   (the `created_at` kept by `sessions/branch.ts` ~735; reader `state/resolve.ts` ~1274). Test only; if it fails,
   report, do not change the code.

Files owned: `sessions/convertRuleset.ts`, the one field in `state/write.ts`, those tests, NOMENCLATURE §25,
`docs/rulesets.md` if it describes conversion.

## Out of scope

Everything else in either report's open ★; `replyRoad.int.test.ts` (under separate diagnosis: do not edit it, and
report rather than chase its failures); migrations; UI.

## Done means

The tests above pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` is clean; if the SDK changed,
`pgrep` check then `npm run sdk:build` once at the end, then `sdk-tests/coreCatalog.test.ts` and
`coreClockOwners.test.ts`, and the app's `specHashes` / `registryHashes` tests.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-clk3-2026-11-11.md`):
how the tick knows to step aside, names chosen, pins moved, changed files in each repo, tests and results, open ★,
**Noticed, not done**.
