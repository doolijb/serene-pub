# REPORT pl3-w1 — Clone with changes carries the notes' values (★pl2-1)

Status question: none relayed; work done in full.

## Changed files
- `src/lib/server/lorebooks/ownBook.ts` (additive hunks only)
  - New private helper `carryNotesValuesToCopy(t, …)` just above `cloneWithChanges`' doc comment (~lines 990–1115). No new export.
  - `cloneWithChanges` doc comment: one dated `🚧 (★pl2-1, owner 2026-11-05)` sentence.
  - `const keeps = await keepsValuesInOwnBook(db, sessionId)` before the transaction (~1142).
  - Inside the existing `if (own) {…}`, just before the `lorebooks` update (`overlayOf`/`extraJson`): `if (keeps) { carry…; delete carried keys from the rekeyed placeValues }`.
- `src/lib/server/lorebooks/cloneWithChanges.int.test.ts`: imports (`and`, SDK slots, core-catalog, `genreKeeping`), a `systemSettings` insert in `beforeAll`, and a new describe (4 tests) at the end.

## Behaviour
World (`lorebook`, own book) and each person (`cast_member`: own member → copy's member for the same card via `castMemberCards`, each own member once) `attribute_values` AND `attribute_configs` are re-inserted on the copy ordered `valid_from_message_id` NULLs first then id, with `session_id`/`valid_from_message_id` null, `branch_id`/`history_entry_id` mapped through `maps` (kept as-is when unmapped), `source_session_id ?? sessionId`, `source_message_id ?? valid_from_message_id`; slot, value/config, updated_by, note, state_version (values only), scene_id kept. Carried notes rows are then deleted by id. A person the copy holds no member for is left in the notes. Places: each non-null `placeValues[entry][slot]` of a copy entry becomes a `location` row dated at `sessionReadingOf` + `writeDatingAt` (computed once, after the session row moved), `updated_by: "user"`, `source_session_id: sessionId`. All inside the transaction using only `t`; helpers dynamically imported.

## Decisions
- Carried place entries are removed from `placeValues` **whole**, null (cleared) slots included, since a null only meant "read the book's value" and the session no longer reads the overlay. Keys not naming a copy entry are kept.
- The helper runs before the `lorebooks` update so the pruned `extraJson` is written in the one existing update; `ruleFed.placeValues` is the fresh rekeyed object, so mutating it is safe.
- Row ordering is a JS sort (null anchor treated as 0; ids are positive) rather than SQL `NULLS FIRST`.
- `attribute_configs` carries no `state_version` (column does not exist there).
- A world/person row of the notes whose owner has no target is simply not selected/touched (people with no copy member).

## Tests
- `npx vitest run src/lib/server/lorebooks/cloneWithChanges.int.test.ts src/lib/server/lorebooks/ownBook.int.test.ts` → 2 files, 27/27 pass (cloneWithChanges: 6/6, the 2 old + 4 new).
- Mutation check: forcing `keeps = false` made the world/person/place test and the dated test fail (restored afterwards); the stranger and owner tests pass either way by design.
- `npx tsc --noEmit -p . | grep -E "lorebooks/ownBook|cloneWithChanges"` → nothing.
- New tests: (1) a member's world + person + place values read the same after the clone, notes hold none (rows, overlay), copy rows undated by message, original gained none; (2) a person the copy holds no member for stays in the notes and still reads 29; (3) a dated notes value lands on the copy's history entry (the first notes row was dated by a direct `history_entry_id` update, since the write path set no dating in the fixture) and the later value still wins; (4) an owner's own-book session carries nothing (cheap with `world()`).

## Fixture note
The brief says `world()`'s session "can't write its book"; it actually belongs to the book's owner, so `keepsValuesInOwnBook` is false there (that is why it serves test 4). The new tests use a new `memberWorld()` (book of another user, `lorebook_shares` row for the member). A `provided` mark was tried first and is not readable by `assertReadableBook` without more setup.

## Not done / Noticed, not done
- `npx prettier --check src/lib/server/lorebooks/ownBook.ts` already warns (file dirty from other lanes); I did not reformat it.
- Configs are carried but not tested directly (no config-writing fixture); they use the same code path as values.
- Dating of the place rows depends on `sessionReadingOf` before the scenes move to the copy (inside the transaction, as the brief ordered); not covered by a test with a dated reading.
