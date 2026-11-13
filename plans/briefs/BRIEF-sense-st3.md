# BRIEF — lane `sense-st3` — the annex holds declared fields only; one change record for session rows

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full,
**`plans/DESIGN-st3-annex-and-runtime-2026-11-11.md`** — the design, and at its end the challenger round with the
**design as amended, which wins wherever the two differ**. Then plan §1.3 (the four rules), §1.6 and §1.9 rows F1 and
F8 in `plans/PLAN-sensible-engine-2026-11-11.md`; `plans/REPORT-sense-st2-2026-11-11.md` and
`plans/REPORT-sense-st2b-2026-11-11.md` (the undo rule this builds on); CLAUDE.md Hard rules and "0.6 is in users'
hands"; NOMENCLATURE §1, §23, §24, §25; `../serene-pub-sdk/guides/storage.md` and `INTEGRATING.md` lines ~1008 and
~1434. `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers word for word.

## Rulings (owner, 2026-11-11, verbatim)

- Core's runtime values: "Move to columns (Recommended)" — described as: "The annex becomes purely the modders' home
  … Ruleset decks follow Back; turn order and read marks do not. Needs a migration and a boot pass."
- "Yes, a turn owns what it wrote" (draws were named in that ruling and are not taken today).

## Build, in two steps inside this lane, with **one generated migration**

Begin by re-reading every cited line and listing, in your first worker brief, every reader and writer you find of
the six runtime keys and of `annex_deltas`. The design's lists are a floor, not the whole.

**Step 1 — runtime values leave the annex** (design ST3a as amended, items 1–4 of the challenger round)

- Schema: four nullable jsonb columns on `sessions` (`turn_order`, `turn_tally`, `lane_reads`, `ruleset_decks`) and
  the new table. Proposed name **`session_imprints`** 🚧 (the owner has been shown the name and has not ruled it:
  keep the name in one place in code so it can change before release). Columns per the design, plus `status`
  (`standing` / `settled`) and, for `annex` rows, `owner_version` and the key's audience before/after. The
  `subject_kind` CHECK has all four kinds from the start: `seat-bench`, `ruleset-conversion`, `deck`, `annex`.
  Then `npm run db:generate`: **re-check the highest index in `drizzle/` and `drizzle/meta/_journal.json`
  immediately before generating (0154 today; another session is building).** Never hand-write or renumber.
- The four columns are **never sent to a client**: add them to both excluded-column lists in
  `sockets/sessions.ts` (~441, ~2079), with a test on `sessions:list` and `sessions:get`.
- `coreAnnexIn`, `coreAnnexKeySql`, `coreAnnexSetSql` are deleted so the compiler lists every site; each site reads
  or writes its column or the table. `seatKeys.ts`'s boot pass and fold-time rekey work on the columns.
- Seat benches, ruleset conversions and deck draws are session imprint rows. Draws: one row per write, anchored
  with `turnAnchorOf` in every mode, propose included. "Fell in story" reads the newest standing `seat-bench` row.
- **One retraction function shared by `lore_imprints` and the new table** (the imprints' rule; session rows always
  revert). `retractStateAnchoredTo` / `restoreRetractedState` use it; the hand-edited JSON logs go.
- The settle line marks session imprint rows settled as it marks lore imprints.
- A branch: fold the parent's post-fork session imprints backwards onto `ruleset_decks`, `ruleset_version` and the
  bench flags; replay `turn_tally`; remap message ids and seat ids in the copied rows. The F1 test.
- `TIMELESS` shrinks to `retake-quietly`; `annexForPipelines`' strip goes.

**Step 2 — annex changes per key** (design ST3b as amended)

- An annex write files one `annex` row per changed key; `annex_deltas` is no longer written or read.
  `keepOnRetell` becomes "skip that key's rows on a replacement"; the in-place narrowing, `kept`, `except` and the
  failed-re-tell special case are deleted, and their tests are rewritten to the new shape, not weakened.
- `annexAt` folds per-key rows. `annex-changed` may name the keys that changed **only if** that is additive to its
  published payload; otherwise leave it and report.
- **No Clear button** in this lane.

**Stored data (both steps, one data upgrade; second boot changes nothing)**

- Each session's `annex.core` runtime keys move to their column or to rows, and are removed from the document.
- Each `annex_deltas` row becomes per-key rows by diffing `before` and `after`, runtime keys skipped; then the
  migration drops `annex_deltas`. If drizzle's generated order makes "convert, then drop" impossible in one
  migration, stop and report the two options; do not hand-edit the migration.
- Old `rewind_taken` JSON: a revive step converts an old record's `annexDeltas`, `seatBenches` and `conversions`
  into the new rows when it is revived, so Back before the upgrade and Forward after restores everything.
- Test the upgrade on a database built at 0154 with a session that has: a core document with all six keys, deltas
  across several owners, a rewound turn, a settled line, a branch.

**Docs and ledgers in the same change:** `../serene-pub-sdk/guides/storage.md` (~43–46, ~82: draws are taken; ~352:
`keepOnRetell`; say that when two turns draw from one deck and the earlier is taken, its cards stay spent),
`INTEGRATING.md` ~1008 and ~1434, `docs/sessions.md`, `docs/rulesets.md` if it describes decks, the comments at
`coreAnnex.ts:6-42` and `schema.ts:2649-2653`, `:3133-3137`; NOMENCLATURE §25 and the rows for annex, imprint, deck.

## Files owned

`src/lib/server/db/schema.ts` (the four columns, the new table, dropping `annex_deltas`), the one generated
migration and its journal entry, the data upgrade under `src/lib/server/db/dataUpgrades/`,
`sessions/coreAnnex.ts`, `sessions/annexChanges.ts`, `sessions/annexInspect.ts`, `sessions/turnOrder.ts`,
`turnTally.ts`, `attention.ts`, `sessions/seatKeys.ts`, `sessions/branch.ts` (the annex and runtime parts),
`sessions/rewind.ts`, `sessions/settle.ts`, `sessions/convertRuleset.ts`, `sessions/creationModes.ts` (its delta
write), `state/write.ts` (retract and restore), `lorebooks/imprints.ts` (only to share the one retraction function;
its behaviour must not change), `rulesets/resolve.ts` (decks), `messages/store.ts` (~635–640), the lines in
`pipelines/runtime/host.ts` and `sockets/sessions.ts` that read or write a runtime key or a delta, every other
reader the compiler lists (those lines only), the tests beside each, and the docs above.

## Out of scope

The lorebook annex and `lore_imprints`' behaviour; the user annex; where the annex lives or its published API; the
settle line's rule; what a branch inherits beyond the design's item 3; a Clear button; the Session data panel beyond
no longer listing runtime keys; ST4, ST5; anything about Apply.

## Stop and ask when

The migration needs anything beyond four columns, one table and one drop; "convert then drop" cannot be done with a
generated migration and a data upgrade; a published SDK name or payload would change other than additively; the
shared retraction function would change what a lore imprint does; the upgrade cannot be made a no-op on a second
boot; a runtime key turns out to be read by a plugin-facing port.

## Done means

Tests: the upgrade case above (and a second boot writes nothing); neither session payload carries the four columns;
swipe, regenerate, Back and delete take a draw, and a propose-mode turn regenerated does not spend twice; Forward
restores it; two turns drawing from one deck behave as the design states; Back before the upgrade and Forward after;
the F1 branch test; `keepOnRetell` and the failed re-tell under the per-key shape; the settle line; the existing
suites for `annexChanges`, `oneUndoRule`, `rewind`, `branch`, `seatKeys`, `setSeatBench`, `convertRuleset`,
`turnTally`, `turnOrder`, `attention`, `imprints`, `settle` and the Dungeon Crawler socket tests pass.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. If the SDK changed (docs only is expected):
`pgrep` checks, one `npm run sdk:build`, then report the `coreCatalog` digest if it moved; **do not re-pin**.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-st3-2026-11-11.md`): the full list of readers and writers moved, the migration's name and index,
the table as built, the upgrade's counts on the test database, what was deleted, changed files in each repo, tests and
results, pins that moved, open ★, provisional names and copy, **Noticed, not done**.
