# REPORT — lane `sense-st3` — 2026-11-11 (saved by the lead; condensed from the supervisor's message)

Both steps built: runtime values leave the annex; annex changes are recorded per key. One generated migration, one
data upgrade. No stop condition hit. Six workers, at most two at a time.

## Migration

`drizzle/0155_chubby_lockjaw.sql` (idx 155, generated; drizzle-kit's create-or-rename prompt answered "create").
Creates `session_imprints`, drops `annex_deltas`, adds four nullable jsonb columns to `sessions` (`turn_order`,
`turn_tally`, `lane_reads`, `ruleset_decks`). Nothing more.

## The table: `session_imprints` 🚧 (provisional name, ★ST3-1)

`id`; `session_id` (cascade); `message_id` (nullable int, as `lore_imprints`); `run_id`; `subject_kind`;
`subject_key`; `before` / `after` (`{v}` or null); `owner_version`, `audience_before`, `audience_after` (annex rows
only); `status` default `standing`; `created_at`. CHECKs: `subject_kind` IN (`seat-bench`, `ruleset-conversion`,
`deck`, `annex`); `status` IN (`standing`, `settled`). Indexes: `message_id` where not null; (`session_id`,
`subject_kind`, `subject_key`, `id`). The SQL name appears only in `schema.ts`, the migration and the upgrade's raw
SQL; TypeScript uses `schema.sessionImprints` and the file `sessions/sessionImprints.ts`.

## Readers and writers moved

- **Columns:** `turnOrder.ts` (`readStoredTurnOrder`, `writeTurnOrder`), `turnTally.ts` (`writeLaneTally`,
  `writeTurnTally`), `channels/attention.ts` (`markLaneRead`, `sessionChannelsFor`), `rulesets/resolve.ts`
  (`decksFor`, `writeDecks`, `sessionTurnFacts`), `settings.ts` ~216/~253, `publishedValues.ts` ~171/~184,
  `moments.ts` `seatedOf`, `evaluate.ts` ~295, `turnPlan.ts` ~372, `yourMove.ts`, `turnOrderPush.ts`,
  `sockets/sessions.ts` ~10773, `rewind.ts` ~623–660 and `retallyStoryLane`, `host.ts` (four lines),
  `seatKeys.ts` (the `annex_core` step and its candidate SQL rekey the two columns).
- **Never sent to a client:** all four columns excluded in both lists in `sockets/sessions.ts` (`sessions:list`;
  `getSessionFromDB`, used by `:get`, `:create`, `:update`). Test: `sockets/sessions.runtimeColumns.int.test.ts`.
  Other socket files were not checked.
- **Writers that file session imprints:** `host.ts` `writeAnnexDocument` (one `annex` row per changed key; timeless
  keys file none) and set-seat-bench; `creationModes.ts`; `convertRuleset.ts` (before/after are version strings);
  `resolve.ts` `writeDecks` (one `deck` row per key written, `turnAnchorOf` in every mode); `settle.ts`
  `settleSessionImprints`; `sockets/sessions.ts` ~5760 reads `standingSeatBenches`; `seatKeys.ts` store renamed
  `annex_imprints`; `annexChanges.ts` `annexAt` folds per-key rows.
- **Retraction:** `state/write.ts` `retractStateAnchoredTo` makes one `retractSessionImprints` call (on a
  replacement it passes `keep` and `above`); `restoreRetractedState` retracts with `above: taken.imprintMark`, then
  `restoreSessionImprints`; `reviveRetractedState(raw, sessionId?)` converts pre-ST3 records.
  `messages/store.ts` `retractLoreOf` takes every kind on a delete; `retakeTurn.ts` loses its own loop.
- **Branch (F1):** decks and ruleset version folded back to the fork; bench flags put back on the branch's seats;
  turn tally copied then its story lane replayed; turn order and read marks copied as they stand; rows up to the
  fork copied with message ids and seat keys remapped (`copySessionImprintsToBranch`).
- **One rule:** `lorebooks/imprints.ts` exports the pure `retractionAct` (plus `wrap`, `unwrap`, `Wrapped`);
  `retractImprints` acts on it, lore behaviour unchanged; `sessionImprints.ts` calls it with `alwaysRevert: true`.

## Deleted

`coreAnnexIn`, `coreAnnexKeySql`, `coreAnnexSetSql`, `annexForPipelines`, `ownerDocForPipelines`;
`recordAnnexDelta`, `retractAnnexDeltasAnchoredTo`, `restoreAnnexDeltas`, `landOwner`, `heldKeysOnly`,
`laterDeltaStands`, `inMemberForm`, `withTimeless`, `AnnexDeltaTaken`; `retractSeatBenchesAnchoredTo`,
`SeatBenchRecord`, `RulesetConversionRecord`, the `RetractedState` fields `annexDeltas`, `conversions`,
`seatBenches`; the in-place narrowing, `kept`, `except`, the failed-re-tell pass; the JSON logs
`rulesetConversions` and `seatBenches`; the table `annex_deltas`. Kept: `CORE_RUNTIME_KEYS` (the upgrade's strip
list), `readCoreAnnex`, `lockSessionAnnex`, `AnnexDeltaSide` ⏳ (to read an old `rewind_taken`).

## Data upgrade: `db/dataUpgrades/0155_chubby_lockjaw.ts`

`before` copies `annex_deltas` to a temp table inside the anchor's transaction; `run` moves the four keys to
columns (only where NULL), files `ruleset-conversion` and `seat-bench` rows (at or below the settle line: `settled`,
`before` NULL; message gone: skipped), strips the six keys (removes an empty `core`), turns each delta into per-key
`annex` rows (runtime keys and `core:revision-points` skipped). Test database: 3 sessions, 6 column values, 2
seat-bench, 1 ruleset-conversion, 5 annex rows. Second boot: nothing runs; dumps identical. Back before the upgrade
and Forward after: restores the bench, the conversion and two annex keys.

## Tests

New: `lorebooks/imprints.rule.test.ts`, `sessions/sessionImprints.int.test.ts`, `sessionImprints.undo.int.test.ts`,
`branch.asOfFork.int.test.ts`, `sockets/sessions.runtimeColumns.int.test.ts`, `rulesets/deckDraws.undo.int.test.ts`
(8), `db/dataUpgrades/0155_chubby_lockjaw.int.test.ts` and `.forward.int.test.ts`. Rewritten to the per-key shape:
`oneUndoRule`, `annexChanges.{keepOnRetell,int,memberForm}`, `seatKeys*`, `settle.int`, `convertRuleset.int`,
`resolve.int`, `benchedSeats.int`, `setSeatBench.int`, `branch.revision.int`. Fixture-only edits outside owned
files: `rewind.int`, `rewindMirror.int`, `channelEntries.int`, `narratorCarryOn.int`, `creationModes.int`,
`memberForm.int`. Lane's final run: 59 files, 466 tests, all passing; `tsc` clean.

## Supervisor's own edits

`sessionImprints.ts`: `retractSessionImprints` reported `changed: false` after a deck, conversion or annex revert
(fixed); Forward re-files the row in member form. Comments: `host.ts` ~9353, `plugins/annexMigrate.ts` ~49,
`lorebooks/foldInParent.ts` ~1104 (the last two outside owned files).

## Decisions inside scope

`RetractedState.imprintMark` with `above` replaces `kept` / `except`; a bench revert that moves no seat is
`dropped` and not re-applied (a person's later drag wins, ruling 2026-11-10); restore after an owner upgrade
migrates a key as a one-key document; timeless keys file no row; `takenSummaryOf` keeps the key `annexDeltas` (it
rides the deletion outlet's `taken` port); new internal names `annex_imprints` (seat-keys store),
`isTimelessAnnexKey`, `standingSeatBenches`, `copySessionImprintsToBranch`.

## Open ★

- **★ST3-1** the name `session_imprints` / `sessionImprints`.
- **★ST3-2** `annex-changed` naming changed keys: needs an optional `keys?: string[]` on the SDK payload; not built.
- **★ST3-3** a branch copies annex audiences as they stand now, not as at the fork; rows carry `audience_before`.
- **★ST3-4** a fork below the settle line cannot fold settled rows back (their `before` is gone); as before ST3.
- **★ST3-5** a branch replays only the story lane of the turn tally.

## Provisional copy 🚧

SDK `guides/storage.md` (draws; two turns on one deck; `keepOnRetell` per key), `INTEGRATING.md`,
`docs/sessions.md` ~285, ~295, ~481, `docs/rulesets.md` ~56, the NOMENCLATURE rows.

## Noticed, not done

- `docs/session-actions.md` ~141 does not say decks, ruleset version and benches stand as at the fork.
- NOMENCLATURE has no row of its own for decks.
- `seatKeys.ts`: `coreFormSql` / `coreCardSql` still look inside `annex -> 'core'` (harmless); `rekeyTurnTally` has
  no caller; header says "fifteen stores".
- `moments.ts` `seatedOf` returns a field named `core` holding `{ turnOrder, turnTally }`.
- `write.ts` `keepOnRetellRow` repeats `splitAnnexKey` inline.
- `branch.ts` imports `rewind.ts` dynamically (import cycle).
- Generated docs not regenerated. Socket files other than `sockets/sessions.ts` not checked for whole-row sends.
- `coreCatalog` digest not checked by the lane (SDK change is docs only).

## Scope review and the lead's follow-up (2026-11-11)

Lead's own run before the review: `tsc` clean; 29 files, 207 tests pass (upgrade, session imprints, branch, undo
rule, annex changes, rewind, settle, seat keys, conversion, deck draws, lore imprints, payload exclusion, both pin
tests). No pin moved.

The review found the lane in scope and raised four points; all fixed by the lead:

1. **A plugin-facing read returned the four columns** (`pipelines/runtime/host.ts`, `case "sessions"`: any query
   node's `read("sessions")`). It now selects every column but the four. Test added in
   `sockets/sessions.runtimeColumns.int.test.ts`. Noticed, not done: the same read still returns `annex`,
   `annexAudiences` and `drafts`, as it did before the lane.
2. **"Fell in the story" vanished once the settle line passed the bench** (`standingSeatBenches` read standing rows
   only; the upgrade files below-line benches as settled). The status filter is gone: a row not taken back counts.
   Test added. The brief's wording ("newest standing row") was the cause.
3. **Forward re-filed a row whose value it did not put back** (`restoreSessionImprints`): a later take-back would
   have written `before` over what a person set meanwhile. A row is filed again only when its write landed. Test
   extended.
4. Stale wording: NOMENCLATURE §4 set-seat-bench row, `sessions/rewind.ts` (two comments),
   `sessions/annexVersions.ts`, `state/write.ts` ~1287.

After the fixes: `tsc` clean; 11 files, 104 tests pass.

Review notes kept for later: `session_imprints.message_id` has no foreign key (as `lore_imprints`), so a future raw
message delete would leave rows standing; `npm run db:migrate` skips data-upgrade hooks (true of every anchored
upgrade); `lane_reads` on a branch holds the parent's message ids (predates the lane).
