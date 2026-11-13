# BRIEF cv-time-w1 — Back / swipe / Forward / message deletes take and restore cast versions

Worker (`lane-worker`, Sonnet) under lane-supervisor **cv-time**. App `/home/jody/github/serene-pub` (all paths below are under `src/lib/server/` unless absolute). Another worker (cv-time-w2) edits `sessions/branch.ts`, `sessions/seats.ts`, `messages/permissions.ts`, `state/handEdits.ts` and one hunk of `sockets/sessions.ts` at the same time — don't touch those. Lanes cv-member and cv-writers edit other files in parallel; touch only what is listed under **Files owned**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build: nothing here touches the SDK.)
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal (plan §32 §7 as amended by §33.2 — §33 wins)
Plan §33.2 (verbatim): "**Branches:** no kept rows. One **retire mark** (`retired_order bigint`): Back, swipe, delete or an in-place change of a row some descendant reads (its cut passes it) marks the row retired (`retired_order` = the next write order) instead of deleting it; an in-place change then inserts the new row. A reader passes a row when `retired_order` is null or greater than its mark for that source; Forward clears the mark. … Retired rows nobody reads any more are swept when the last descendant goes."
Plan §32 §7: "Back / swipe: `retractStateAnchoredTo` … takes the versions into 🚧 `RetractedState.castVersions`. Forward: `reviveRetractedState` and `restoreRetractedState` restore them with id and `write_order`. Message deletes: `deleteLegacyWhere` and `deleteLegacy` (messages/store.ts) reach `retractLoreAnchoredTo` through `retractLoreOf`. It … takes the versions, because SET NULL would leave them behind."

A cast version written by a session's story write (`writeCastVersion` with `session`, already built in `characters/versions.ts`) carries `source_session_id = S`, `source_message_id = anchor` (plain int) and `valid_from_message_id = anchor` (FK → messages, `ON DELETE SET NULL`). Rows written by the boot lift or an author have no source and are never taken.

## What to build

### 1. `characters/versions.ts` — three exported helpers (this file is cv-core's; you add ONLY these three plus reuse of the private `descendantReads`; change nothing else in it)
- 🚧 `retireOrTakeVersions(tx: Db, rows: readonly VersionRow[]): Promise<{ taken: VersionRow[]; retired: VersionRow[] }>` — for each row: when some descendant session of `row.sourceSessionId` still reads it (the existing private `descendantReads(tx, row.sourceSessionId, row)`, which applies each descendant's session cut through `rowPassesSessionCut`), set `retired_order = await nextWriteOrder(tx)` on it; otherwise DELETE it. Answers the rows **as they were before** (so `retiredOrder` null in both lists). A row with no `sourceSessionId` is never a session's write: skip it (in neither list).
- 🚧 `restoreVersions(tx: Db, rows: readonly VersionRow[]): Promise<number>` — Forward: put back rows a retraction answered, **ids and `write_order` kept**, retire mark cleared: an INSERT of the rows exactly as given with `retiredOrder: null`, `ON CONFLICT (id) DO UPDATE SET retired_order = NULL` (a retired row is still there; a taken one is re-inserted; a retired row that the sweep below removed in between is re-inserted too). Returns how many rows it wrote. Its doc comment says it is the one other INSERT of the table besides `insertCharacterVersions` and why (a restore keeps ids, it never draws).
- 🚧 `sweepRetiredVersions(tx: Db, sourceSessionIds: readonly number[]): Promise<number>` — §33.2 "Retired rows nobody reads any more are swept when the last descendant goes": for each source id, every row with that `source_session_id` and `retired_order IS NOT NULL` that **no live descendant** reads any more (`descendantReads` false) is deleted. Called after a session is deleted, with that session's `branch_ancestry` ids (the supervisor wires the call into the delete handler; you only write and test the helper). Returns the count deleted.
Keep the module a leaf: no static import of `$lib/server/db` (it has none today); dynamic imports as the file already does.

### 2. `state/write.ts` — the retract/restore hunks ONLY (`retractLoreAnchoredTo` ~859, `RetractedState` ~881, `reviveRetractedState` ~942, `restoreRetractedState` ~1001, and the `taken`/`changed` assembly inside `retractStateAnchoredTo` ~721). Nothing else in this 3,300-line file.
- `retractLoreAnchoredTo(tx, sessionId, messageIds)`: after the imprints and own-book entries, select `character_versions` rows with `source_message_id IN messageIds` and `retired_order IS NULL`. If any: take `lockStateVersion(tx, sessionId)` first (a fork takes the same lock on the parent before reading its mark, so no fork can straddle the retraction), then `retireOrTakeVersions`. Return `castVersions` = taken + retired (as they were), and count them in `changed`.
- `RetractedState` gains 🚧 `castVersions?: (typeof schema.characterVersions.$inferSelect)[]` — optional (records written before have none), doc comment: the cast versions anchored to the message, as they were — deleted, or retired when a branch still reads them.
- `retractStateAnchoredTo` puts `lore.castVersions` into `taken.castVersions`.
- `reviveRetractedState` revives `castVersions` with `reviveDates(schema.characterVersions, row)` (empty list when absent).
- `restoreRetractedState`: include `castVersions` in the "nothing to put back" check, and inside its transaction call `restoreVersions(t, castVersions)`.
- Do NOT add `castVersions` to `takenSummaryOf` (it is an SDK outlet port's shape — out of scope; just leave it).
- `messages/store.ts` should need **no** change: its delete paths already reach `retractLoreAnchoredTo` via `retractLoreOf`, and the query uses the plain-int `source_message_id`, which the messages cascade can't null. Confirm by test; if it truly needs a change, make the smallest one in `deleteLegacyWhere`/`deleteLegacy`/`retractLoreOf` only and say why.
- `sessions/rewind.ts` should need no change either (Back stores `taken` in `rewind_taken` JSON; Forward revives and restores it). Confirm by test.

### 3. Tests — one new file `state/retractCastVersions.int.test.ts` (60 s timeouts: `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`; own data dir `serene-pub-vitest-cv-time-retract-` removed in `afterAll`). Copy the setup pattern of `characters/versions.write.int.test.ts` (it mocks `$lib/server/db` with `createTestDb`, builds a user, book, card, member via `insertCard`/`insertCastMember`, a session, and calls `writeCastVersion`). Build branches **by hand** (w2 is changing `branchSession` right now): a child session row with `branch_ancestry = [{ sessionId: parent, mark }]` where `mark` is the highest `write_order` at the fork, and copies of the parent's messages up to the fork with `origin_session_id = parent`, `origin_message_id = <parent message id>` (insert legacy rows via `insertLegacy`/`insertLegacyMany` from `messages/store.ts` with those two columns). Read what a session sees with `castVersionsInForce(db, [memberId], { sessionId })` from `cast/memberAsRead.ts`.
Cases (each its own `test`):
1. **Back then Forward restores a cast version**: a story write anchored to the newest message; `rewindTurn` (sessions/rewind.ts) takes it (row gone, session reads the base); `forwardTurn` brings it back with the same `id` and `write_order`, read again. If driving `rewindTurn` needs too much fixture (it checks a turn unit and a door), call `retractStateAnchoredTo(db, messageId, { ticks: "take", scenes: "take" })` + JSON round trip (`JSON.parse(JSON.stringify(taken))` → `reviveRetractedState` → `restoreRetractedState`) instead, and say which you did.
2. **Back with a branch reading it retires it**: parent writes V at message M; branch forked at M (mark ≥ V's write order, copied M with origin M); parent's Back on M → V still exists with `retired_order` set; the branch still reads V; the parent no longer does (reads the base). Forward → `retired_order` null again, parent reads V.
3. **A branch forked earlier does not keep it**: branch forked before M (its copies stop before M) → parent's Back on M deletes V outright.
4. **A swipe of the fork message**: parent writes V at M, branch forked at M; `retractStateAnchoredTo(db, M)` (no opts = a replacement) → V retired; then a new story write by the parent at M gives V′ (write order > mark): the parent reads V′, the branch still reads V. Then `restoreRetractedState(db, taken)` (the replacement failed) → V′ taken back, V's mark cleared, parent reads V.
5. **A delete of an anchored message**: `deleteLegacy(db, M)` (messages/store.ts) with no branch → V deleted (not left behind with a null `valid_from_message_id`); with a branch reading V → V retired and still read by the branch.
6. **`sweepRetiredVersions`**: after case 2's Back (V retired), delete the branch's session row, call `sweepRetiredVersions(db, [parentId])` → V gone; with a second live branch that still reads V → V stays.
Also a unit-level check that `retireOrTakeVersions` answers rows with `retiredOrder` null.

## Rules you must keep (quoted)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."
- CLAUDE.md: "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." and the common brief: "no static `$lib/server/db` import in modules tests mock".
- Common brief: "targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name."
- CLAUDE.md Decisions: "Decide implementation inside the asked scope … name the choice in your report." A new user-visible word, setting, migration or file outside this list → stop and report, don't build.
- No migration is needed (0146 has every column). If you think one is, stop and report.
- Format only your hunks; `state/write.ts` was not prettier-clean before — do not reformat the file.

## Files owned
`src/lib/server/characters/versions.ts` (the three helpers only), `src/lib/server/state/write.ts` (the hunks named above only), `src/lib/server/messages/store.ts` and `src/lib/server/sessions/rewind.ts` (only if a test proves a change is needed), new test `src/lib/server/state/retractCastVersions.int.test.ts`.

## Files readable
Anything. Especially: `characters/versions.ts` (writer, `descendantReads`, `nextWriteOrder`, `writeCastVersion`), `shared/lorebooks/lineReading.ts` (`rowPassesSessionCut`), `state/reading.ts` (`sessionCutsOf`), `cast/memberAsRead.ts` (`castVersionsInForce`), `sessions/rewind.ts`, `messages/store.ts`, `characters/versions.write.int.test.ts`, `state/reading.sessionCuts.int.test.ts`, `plans/REPORT-cv-core-2026-11-05.md`, `plans/REPORT-cv-line-2026-11-05.md`.

## Done means
`npx vitest run src/lib/server/state/retractCastVersions.int.test.ts src/lib/server/characters/versions.write.int.test.ts src/lib/server/characters/versions.int.test.ts src/lib/server/sessions/rewind.int.test.ts src/lib/server/messages/store.int.test.ts src/lib/server/state/write.int.test.ts` all green (run without `| head`); `npx tsc --noEmit -p .` shows no error in your files (filter the output with grep for your paths); `npx prettier --check` on your new test file.

## Report
Your final message: names and signatures, changed files with the hunks, tests run with results, choices you made, anything you could not do, Noticed-not-done. List the `/tmp/serene-pub-vitest-*` dirs your runs created and confirm they are gone.
