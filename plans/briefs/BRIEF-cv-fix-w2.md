# BRIEF cv-fix-w2 — a parent's notes outlive it; seated by; avatar face; book export cards

Worker for lane **cv-fix** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context (read these)
- `plans/REPORT-cv-time-2026-11-05.md` — its **★cv-time-1** and the **Lead dispositions** at the end (item 6 here), and its "Queued" item 1 (item 7 here).
- `plans/REPORT-cv-writers-2026-11-05.md` — the "Queued" bullets on `handleCharacterAvatarUpload` and `lorebookExportBuilder.ts` (items 11, 12).
- Owner ruling (plan §33.3, 2026-11-05): _"Deleting a parent: its never-surfaced notes **outlive it while any branch rides them** and are deleted with the last patron. No hand-off, no re-pointing."_
- **Already done by the supervisor — do not redo:** `lorebooks.session_id` lost its FK in `src/lib/server/db/schema.ts` (now a plain `integer("session_id")`), and migration **0146 was regenerated** (it now also holds `ALTER TABLE "lorebooks" DROP CONSTRAINT "lorebooks_session_id_sessions_id_fk"`). Do not touch `drizzle/**` or `schema.ts`.
- Another worker (w1) runs at the same time. It edits `src/lib/server/lorebooks/ownBook.ts` **only inside `loreWriteTargetFor`**, plus `characters/versions.ts`, `versionsLift.ts`, `state/write.ts`, `state/durable.ts`, `lorebooks/sessionLine.ts`. Never edit those (except your own region of `ownBook.ts`); **re-read `ownBook.ts` right before each edit**.

## Files owned (edit only these)
- `src/lib/server/lorebooks/ownBook.ts` — `purgeOwnBookOf` and new code next to it (not `loreWriteTargetFor`)
- `src/lib/server/sockets/sessions.ts` — only the `sessions:delete` hunk (~2095–2135) and the four `seatCast(` call sites (~1472, ~1488, ~6723, ~7806)
- `src/lib/server/sockets/import.ts` — only the two `seatCast(` call sites (~1358, ~1518)
- `src/lib/server/startup/index.ts` — one new task entry
- `src/lib/server/utils/index.ts` — `handleCharacterAvatarUpload`
- `src/lib/server/utils/lorebookExportBuilder.ts` — the card half (~160–185)
- `src/lib/server/db/characterVersions0146.int.test.ts` (add the FK-drop assertion)
- new test files you create, and existing tests that assert the old cascade (list each)
- **Do not edit `NOMENCLATURE.md` or any `docs/*.md`.** Put proposed §25 rows and doc lines in your report.

## Items

### 6. A parent's own book outlives it while a branch rides it
Facts: `ownBookOf(db, sessionId)` finds the book by `lorebooks.session_id`; listings hide books with `session_id IS NOT NULL`; `overlayChainOf` (`state/reading.ts`) finds ancestors' own books through the descendants' `sessions.branch_ancestry` (`[{sessionId, mark}]`, nearest first, GIN index; query "who has ancestor X": `branch_ancestry @> '[{"sessionId": X}]'::jsonb`, as `descendantReads` in `characters/versions.ts` does).
- **`sessions:delete`** (sockets/sessions.ts ~2097): `purgeOwnBookOf(db, id)` purges the session's own book **unless a live session's `branch_ancestry` names it** — then the book stays (a branch still reads it). Put the check inside `purgeOwnBookOf` (it answers whether it purged, or keep `void` — your call, say which) so every caller gets it.
- **The last patron's delete** purges its ancestors' kept books: after the session row is deleted (the hunk already reads `branch_ancestry` into `gone` before the delete, and runs `sweepRetiredVersions` after), for each ancestor id A whose `sessions` row no longer exists and that no live session's `branch_ancestry` names any more, purge A's own book (`lorebooks.session_id = A`) the same way. Order: run the existing `sweepRetiredVersions` first, then the book purge. Best effort as the sweep is (a failure is logged; the delete stands). One helper in `ownBook.ts` for "purge the kept own books of these gone sessions that nobody rides" (🚧, name it, e.g. `purgeKeptOwnBooks(db, sessionIds)`), reused by the boot sweep.
- **Boot sweep** (`startup/index.ts`, a new task right after `own-books`): removes every own book (`session_id IS NOT NULL`) whose session row is gone and that no live session's ancestry names. One query when there is nothing to do. Log only when it removed something. It is permanent (the backstop for any future delete path that skips the purge), not ⏳. Give the task a distinctive name and say it in your report (e.g. `kept-own-books`); `failsHealth` like its neighbours if a failure should show on the launcher's health — your call, say which.
- The purge itself stays `purgeLorebook(tx, id)` (`lorebooks/tableRegistry.ts`, keyless rows) then delete the `lorebooks` row, in one transaction (CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently").
- Tests (new file, e.g. `src/lib/server/lorebooks/keptOwnBooks.int.test.ts`; drive `sessionsDeleteHandler` the way `src/lib/server/state/retractCastVersions.int.test.ts` or `src/lib/server/sessions/branch.ancestry.int.test.ts` do, and `branchSession` to make a branch):
  (a) deleting a session no branch rides purges its own book (as today);
  (b) deleting a parent while a branch rides it keeps the parent's own book and its cast members; the branch still reads them (e.g. `overlayChainOf` still lists it, or a branch seat keeps its `cast_member_id`);
  (c) deleting that last branch purges the parent's kept book; with two branches, deleting one keeps it and deleting the second purges it; a grandchild chain (A → B → C, delete A then B, then C) ends with every kept book gone;
  (d) the boot sweep removes an orphaned own book (session row deleted raw) nobody rides, keeps one a live branch rides, and **a second run changes nothing** (the "second boot is a no-op" rule: "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing").
- `characterVersions0146.int.test.ts`: add that after migrating, `lorebooks` has no FK on `session_id` (query `pg_constraint`/`information_schema`), and that a `lorebooks` row may name a session id that does not exist.
- Then grep the suite for tests that relied on the cascade (a session deleted raw, `db.delete(schema.sessions)`, then the own book expected gone) and run them: `src/lib/server/lorebooks/ownBook.int.test.ts`, the `sessions:delete` tests (`grep -rln "sessionsDeleteHandler\|sessions:delete" src --include=*.test.ts`), `retractCastVersions.int.test.ts`, `branch.ancestry.int.test.ts`. A test that deletes the session row raw and expected the book to go by cascade now needs `purgeOwnBookOf` or the handler; fix it, list it, and say why.

### 7. Pass `seatedBy` at the seat call sites
`seatCast({ seatedBy?: number | null })` (`sessions/seats.ts`) writes `session_characters.seated_by_user_id` — acting rights follow the seater (owner 2026-11-05: _"The person who seated it"_). Callers that don't pass it get the held card's owner. Pass `seatedBy: <the acting user's id>` (the socket's user — `socket.user!.id` / the handler's `userId` variable) at: `sockets/sessions.ts` create (~1472, ~1488), update (~6723), add character (~7806); `sockets/import.ts` (~1358, ~1518 — use the importing user). Envoy seats (`pipelines/entities/envoys.ts`) stay as they are. Test: one int test per socket path that matters most — at least session create with another user's shared card (seated by = the creator, not the card's owner) and one import path; reuse fixtures from `src/lib/server/sessions/actingRights.int.test.ts` / `sockets/sessions.seatCast.int.test.ts`.

### 11. `handleCharacterAvatarUpload` sets the version's face (`utils/index.ts` ~101)
Today it writes `characters.avatar_media_id` directly (a ⏳ card copy). Make it set the face on the card's **current card version** through the versions module, in one transaction: `ensureCardVersion(tx, character.id)` then `updateCardVersion(tx, version.id, { faceMediaId: created.file.id })` (both in `src/lib/server/characters/versions.ts`; `updateCardVersion` already writes the ⏳ copies — `avatar_media_id` among them — when the version is the current one). Import them with `await import(...)` if a static import would pull the db into a leaf test's graph; check `utils/index.ts`'s existing imports. Leave the callers' own follow-up face writes as they are (list them under Noticed). Test: an upload sets the current version's `face_media_id` and `characters.avatar_media_id` alike (extend an existing avatar test such as `characterAvatarAndUpdate.int.test.ts` only if it is the natural home; else a new small int file).

### 12. Book export writes each card as its current version (`utils/lorebookExportBuilder.ts` ~160–185)
`buildCharacterCardV3` and `buildPersonaExportCard` are fed the raw `characters` row, so the content and likeness in a book export are stale. Feed them `cardAsOfVersion(row, current)` (`src/lib/server/characters/cardIO.ts`), where `current` is the card's current card version (`ensureCardVersion`, or one query for all exported cards' current versions — highest `number` per `card_id` — to avoid N round trips; your call). Keep `tags` as today. Only the card half: the member half (own names, sprite set from frozen binding columns, ~190–196) is out of scope — list it under Noticed. Test: export a book whose card has a v2 with a changed description → the embedded card carries v2's description and label (`character_version`). Look for the existing export test (`grep -rln "lorebookExportBuilder\|buildLorebookExport" src --include=*.test.ts`).

## Rules (quoted)
- CLAUDE.md Hard rules: "Never `kill -9` the dev server"; "Inside `db.transaction(async (tx) => …)` use only `tx`"; "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Every session has a lorebook — never write 'no book'" (comments and log lines included). The own book is said **Session notes** in the UI, _own book_ in code.
- Sockets: "one domain context per event family … is the only listener, and the only place that toasts" — do not add emits/toasts beyond what the delete hunk already does.
- New exported names are 🚧; grep each before using it (NOMENCLATURE §24 step 2); propose §25 rows in your report.
- Tests: targeted only, `npx vitest run --maxWorkers=4 <files>`; **never pipe vitest into `head`**; DB-in-`it` tests need a 60 s timeout; list `/tmp/serene-pub-vitest-*` before and after; delete only the dirs your runs left, by name.
- Prettier: only your hunks in old files; new test files pass `npx prettier --check`.
- `npx tsc --noEmit -p .`: no error in your files.

## Stop and ask (in your report; carry on with the rest) when
a ★ is unruled, a user-visible word is new, a schema or migration change would be needed, or a fix needs a file you don't own.

## Done means
Your new tests plus `characterVersions0146.int.test.ts`, `ownBook.int.test.ts`, every `sessions:delete` test, `retractCastVersions.int.test.ts`, `branch.ancestry.int.test.ts`, `actingRights.int.test.ts`, `sockets/sessions.seatCast.int.test.ts`, the `sockets/import*` tests, the avatar test and the export test, all green; `tsc` clean on your files.

## Report (your final message)
Names and signatures first; changed files; tests with counts; proposed §25 rows; proposed `docs/sessions.md` line for "Delete a session" (the notes staying while a branch reads them); open ★; Noticed, not done.
