# REPORT — lane `time-t6a-drop` (2026-11-15): the per-message seated set is removed

Saved by the lead from the supervisor's report. Owner 2026-11-15, asked "Drop yesterday's unused per-message
stamp?": "Yes".

- **Migration** `drizzle/0166_message_firsthand_drop.sql` (generated; renamed from the generator's name as
  0162–0165 were): `ALTER TABLE "session_messages" DROP COLUMN "firsthand_cast_member_ids";` and nothing else.
  0165 untouched. New `src/lib/server/db/messageFirsthandDrop0166.int.test.ts`: a 0165 database with a stamped
  and a NULL row keeps its rows, loses the column, equals a fresh install, and a second boot changes nothing.
- **Deleted:** `messages/firsthand.ts` and its test, `pipelines/runtime/host.firsthand.int.test.ts`,
  `sessions/branch.firsthand.int.test.ts`, `sockets/sessions.firsthand.int.test.ts`,
  `db/messageFirsthand0165.int.test.ts`.
- **Edited:** `db/schema.ts`, `messages/store.ts`, `pipelines/runtime/host.ts` (~8770), `sockets/sessions.ts`
  (both Reassign branches), `sessions/branch.ts`, `sockets/import.ts`, `shared/widgets/messageV1.test.ts`,
  `NOMENCLATURE.md`; SDK `sdk/src/widgets.ts` (`MESSAGE_HOST_FIELDS`, the "Withheld" paragraph),
  `sdk-tests/messageRowContract.test.ts`. The filter (`firsthandFilter.ts`, `firsthandFor` / `firsthandBy`) was
  not touched and does not read the column.
- **Verification (lane's):** `sdk:build` 16:39; `sdk:test` 4747/4752 (the known four); app batches 119/120 and
  105/106 files (the two failures are standing baseline: `0108_layering_registrations.int`,
  `genreFieldDefaults.int`); `tsc` 0; `npm run check` 0 errors.
- **Lead fix:** the stale clause about the column in `contracts/src/queries.ts`'s `firsthandFor` doc comment
  removed (needs the next `sdk:build`).

## Grouped verification (lead, 2026-11-15)

- Full vitest run 7 (`plans/lead-full7.log`): 2,503 files, 21 failed, 26 tests failed; the same 21 files as run 6, none new.
- `npm run build`: exit 0. `tsc --noEmit`: 0 errors. `npm run check`: 0 errors, 9 warnings (standing).
