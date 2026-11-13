# REPORT — lane `sense-clk4` — 2026-11-11 (saved by the lead; condensed from the supervisor's final message)

A junction branch with no member now survives the spec store. The Lair's Words only, with the keeper switched on,
moves the clock once per round. Every done-means test passes; the only spec pin that moved is `core:spec/round-tick`.

## Measurement

77 core specs, 179 clauses. Only one clause has a member-less branch: `core:spec/round-tick@1.0.0`,
`clock.moves.clocked.at.keeper` (this programme's own unshipped change). In all 179 clauses the order the store
rebuilds already equals the builder's declaration order, so no shipped spec moves. Fixtures: `typedBuilders.test.ts:98`
(one empty branch), canvas `edits.test.ts:359` (two empty, already in name order). History: `coreCatalog.test.ts:1059`
(2026-11-08) records the same defect; Story's composer gate had its empty `otherwise` branches removed for it.

## The rule

**A clause's chains are its member-holding chains in position order, then its member-less chains sorted by name
(code-unit order).** jsonb does not keep `branches` key order, so name order is the only rule the store can rebuild
exactly. It never changes which branch runs: the executor evaluates every chain's predicate and `otherwise` fires
only when no other did.

- SDK: private `orderedChains` in `sdk/src/document.ts`, used only by `compileBuilt`. No new export, no shape change.
  `compile(SpecDocument)` and `importDocument` untouched.
- App: `chainsOf(nodeRows, clauseRows, clauseId, branches?)` in `src/lib/server/pipelines/boot/store.ts` appends every
  stored `branches` key that holds no member, sorted the same way.
- The round tick's keeper compiles and loads as `["tick","full","review"]`.

## Pins moved

SDK digest `4347914b6a33b299` → `0e7f00b22fe88019` (not proven by deletion). App `specHashes`:
`core:spec/round-tick@1.0.0` `123220d7c924ea` → `17442b115a76f`. `registryHashes` did not move.

## Changed files

SDK: `sdk/src/document.ts`; `sdk-tests/junctionEmptyBranch.test.ts` (new, 10); `sdk-tests/coreGenreDefaults.test.ts`;
`sdk-tests/coreCatalog.test.ts`; `core-catalog/src/shared/roundTick.ts` (one docblock sentence).
App: `pipelines/boot/store.ts`; `pipelines/boot/clauseChainRoundTrip.int.test.ts` (5 new: empty branch first, middle,
last, two out of name order, each same hash and `written: false` on re-save; a second boot publishes nothing);
`pipelines/boot/specHashes.test.ts`; `NOMENCLATURE.md` §4 round tick, §9 round worth, §25.

## Tests

App, one capped run: 7 files, 56/56 (`clauseChainRoundTrip.int`, `boot/store.int`, `specHashes`, `registryHashes`,
`clockOwners.int` 6/6, `roundTick.int`, `roundWorth.genres.int`). SDK: `junctionEmptyBranch` 10/10, `route` 10/10,
`coreClockOwners` 7/7, `coreGenreDefaults` 17/17, `coreCatalog` 5/5, plus `junctionResult`, `typedBuilders`,
`conformance`. `tsc` clean in both. `sdk:build` once, no dev server up.

## Open ★

None.

## Noticed, not done

1. The canvas editor's `addClause` creates empty branches in the author's order; a canvas-saved document whose empty
   branches are out of rule order loads in rule order: it runs the same, but its loaded hash differs from the saved
   one. Normalising in the canvas or in `importDocument` would close it.
2. `compile(SpecDocument)` and `importDocument` do not reorder: a hand-written or older-SDK document with an empty
   branch before a non-empty one has the same hash mismatch on load. It runs correctly.
3. Gather, each and loop clauses have no `branches`, so a member-less chain there still vanishes on load. No core
   spec has one.
4. Story's composer gate could have its empty `otherwise` branches restored (owner's call).
5. Existing installs heal: empty branches were always stored in `branches`, so stored specs now load correctly. The
   round tick's new hash republishes it as a new version on boot.
6. Four `/tmp/serene-pub-vitest-*` dirs left in place (not provably this lane's).
7. No scope review yet (lead to run one over clk2, clk3, clk4).

## Scope review of clk2, clk3, clk4 (lead-run, 2026-11-11)

Held: one move per round with shipped defaults in every preset; round worth 0 moves nothing; the reply-tick boot
pass removes only its own keys and is a no-op twice; `round-worth` has one writer; `GIVEN_WRITE_STAMP` cannot be
reached from a payload; every new name is in §25; no other project named. Five findings:

1. **Medium, for the owner.** In the Lair's Rules and The rules decide (and Words only with the keeper on) the
   round-worth move sits inside the keeper's `time` junction, which reads the reckon script's output, which runs
   after the keeper's model call (`shared/reckoning.ts` ~699, ~715, ~891–920). If that call halts or the run is
   skipped, the clock does not move that round. No test covers a failed reckon; `docs/genre-lair.md:160` says "the
   step is fixed, not the model's guess" without the caveat. Options: (a) the round move also stands when the reckon
   halts; (b) accept and say so in the doc and the §9 row; (c) the round tick owns the Lair's clock in every preset.
2. **Low–medium.** clk2 changed `shared/reckoning.ts` (a new field on the exported `ReckonTerms`, the `round`
   branch) and three app tests beyond its owned list. Goal 5 required the routine change; the assumption is recorded
   in REPORT-sense-clk2 under "Assumptions". `sessions/stepSettings.int.test.ts` shows a whole-file reformat that
   cannot be attributed.
3. **Low.** The two sides of the chain rule differ on a tie: a nested clause holding no nodes shares its position
   with the next node (`sdk/src/builder.ts:895`, `:928`); `orderedChains` breaks the tie by declaration order,
   `chainsOf` by nodes first. A chain whose first member is such a clause, beside a sibling chain starting with a
   node, would hash differently on every boot. No core spec has the shape. Fix: one explicit tie-break on both
   sides and a round-trip test. Queued with the leftovers (§5.9 row 8), with "Noticed" 1–3 above.
4. **Low.** `sdk/src/executor.ts` ~2561 still says "the first fired branch in declaration order answers"; with
   member-less chains last that is chain order. One comment line. Queued with 3.
5. **Low, already ★CLK3-2.** The shared round tick names `core:spec/lair-keeper`.
