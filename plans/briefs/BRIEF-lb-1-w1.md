# BRIEF lb-1-w1 — server: refuse deleting a lorebook a session plays on

Repo `/home/jody/github/serene-pub`. Supervisor: lane `lb-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all in this task: do not run one.)

Also: never `git checkout` / `restore`; never `prettier --write`; no migration; no full test run; no `npm run build`. Other lanes are editing nearby files at the same time (`sockets/import.ts`, `lorebooks/ownBook.ts`, `lorebooks/entryKnowledge.ts`, `pipelines/**`): never edit them. **Re-read any file right before you edit it** and make small targeted edits (`sockets/lorebooks.ts` has other uncommitted work in it: touch only the delete handler and its imports).

## Goal (owner ruling D50, 2026-11-16)

Owner: "Refuse the delete while a session uses it, naming the sessions". Deleting a `lorebooks` row today cascades: `sessions.lorebook_id` is set null (`db/schema.ts` ~2740, `onDelete: "set null"`), and **every session's own notes that overlay the book are deleted with their scenes** (`lorebooks.overlay_of`, `onDelete: "cascade"`, ~1469). So the refusal protects the session's link and its notes.

## Build

1. **One server function** in `src/lib/server/sessions/bookLock.ts` (append; do not change what is there):

   ```ts
   /** 🚧 Why `lorebookId` may not be deleted (D50), or null when no session plays on it. `askerId`'s own sessions are named; anyone else's are counted. */
   export async function bookDeleteRefusal(db: Db, lorebookId: number, askerId: number | null): Promise<string | null>
   ```

   - Sessions that play on book L (one SQL query, `select distinct`, newest `updated_at` first, columns `id`, `name`, `userId`): a `sessions` row `s` where `s.lorebook_id = L`, **or** there is an own-notes row `n` in `lorebooks` with `n.overlay_of = L` and (`n.session_id = s.id`, or `s.branch_ancestry @> jsonb_build_array(jsonb_build_object('sessionId', n.session_id))` — a branch that still reads notes kept past their session; see `purgeKeptOwnBooks` in `lorebooks/ownBook.ts` ~640 for that exact predicate). Archived sessions count (their notes would go too).
   - None → `null`. Else the book's name (`lorebooks.name`, by id) and `bookDeleteSentence(name, { named, others })` from `$lib/shared/lorebooks/sessionNotes` (already written by the supervisor; read it, do not change it): `named` = rows whose `userId === askerId` as `{ id, name }`, `others` = the count of the rest.
   - Inside a transaction the caller passes its `tx` as `db`. Never use the module `db` in this function.

2. **`src/lib/server/sockets/lorebooks.ts` `lorebooksDeleteHandler`** (~1222): inside its transaction, after the provided-book refusal and before `purgeLorebook`, `const refusal = await bookDeleteRefusal(tx as unknown as Db, book.id, userId); if (refusal) throw new Error(refusal)`. `refusable` already turns the thrown message into `lorebooks:delete:error { error }` to the asker. Use only `tx` inside the transaction (CLAUDE.md hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently").

3. **`src/lib/server/library/writes.ts` `undoLibraryChange`, case `"create-lorebook"`** (~498, Back of a lorebook a session's turn made): before `purgeLorebook`, `const refusal = await bookDeleteRefusal(db, id, p.by)` (check the payload's user field name; `p.by` is what `redoLibraryChange` imports as). When refused: the book stays; write the row's payload without `document` (`await writePayload(db, row, { ...p, document: undefined })` or by omitting the key) so a later Forward does not import a second copy (`redoLibraryChange` returns when `!p.document`), then `throw new Error(refusal)`. The caller `revertLibraryChangesAnchoredTo` already catches, logs and skips ("A change that cannot be taken back … is reported and skipped"), so Back of the turn still goes through. Say this in the function's doc comment in one line.

4. **Verify, do not edit**, and report what you find with file:line:
   - `src/lib/server/plugins/providedBooks.ts` ~1529 (`deleteProvidedBooks`, plugin uninstall with `providedBooks: 'delete'`) and `src/lib/server/sockets/starterKits.ts` ~216 (`starterKits:delete`): can a session's `lorebook_id` (or own notes' `overlay_of`) point at such a book? (The supervisor's reading: `sessions.create.ts` ~174 `kitReadRefusal` refuses a starter lorebook as a session's book; `providedMarks.ts` ~200 `isNewAttachOfDisabledBook` refuses only a *disabled* provided book, so an enabled provided book looks attachable. Confirm or correct.) Leave both files unchanged either way.
   - `src/lib/server/sockets/sessions.create.ts` ~1018 (removes the world copy of a refused create): **exempt, do not touch**.
   - `src/lib/server/lorebooks/ownBook.ts` ~619 (a session's own notes, removed with the session): leave.
   - `users:delete` (`sockets/users.ts` ~876) is a soft delete: confirm it removes no `lorebooks` row.
   - Grep once more for any other code that removes a `lorebooks` row (`delete(schema.lorebooks)`, raw `delete from lorebooks`) in `src/lib/server` and `src/routes`, tests excluded, and list it.

## Tests (write, then run)

New file `src/lib/server/sessions/bookDelete.int.test.ts` (copy the harness of `src/lib/server/sessions/bookLock.int.test.ts`: `vi.mock("$lib/server/db", …createTestDb…)`, a `mkdtemp` data dir named `serene-pub-vitest-book-delete-`, `releaseDataDir` in `afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Cover:
- `lorebooksDeleteHandler` (call `.handler(socket, { id }, emit)` with a recording `emit`): a book a session of the owner reads → refused; the recorded `lorebooks:delete:error` carries exactly `bookDeleteSentence(...)` naming the session; the book row, the session's `lorebook_id` and its own notes (a `lorebooks` row with `session_id` = session, `overlay_of` = book) are all still there.
- More than five own sessions → the sentence says "and ‹n› more"; another user's session on the book → counted ("…other people's…"), never named.
- Allowed once the session is deleted (delete the session row and its notes as a test fixture would) **or** once the session no longer reads the book (set `sessions.lorebook_id` null and the notes' `overlay_of` null directly in the fixture, which is what a merge leaves): the delete succeeds and `lorebooks:delete` is emitted with `lorebookId`.
- A book no session reads deletes as before.
- `undoLibraryChange` on a `create-lorebook` row whose book a session now reads: the book stays, the row's payload has no `document`; with no reader it is deleted as before (see `src/lib/server/library/writes.int.test.ts` for how a library row is built; reuse its helpers by copying, not importing test files).

Run, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/bookDelete.int.test.ts > plans/lb-1-w1-1.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/bookLock.guard.test.ts src/lib/server/sessions/bookLock.int.test.ts src/lib/server/library/writes.int.test.ts src/lib/server/library/writes.bookLock.int.test.ts > plans/lb-1-w1-2.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/lorebooks.bookFixes.int.test.ts src/lib/server/sockets/lorebooks.readerAccess.int.test.ts src/lib/server/sockets/lorebooks.entryEdges.int.test.ts src/lib/server/sockets/lorebooks.duplicate.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts > plans/lb-1-w1-3.log 2>&1"
```

Never pipe vitest into `head`. Read the logs with `tail`/`grep`. If an existing test fails because it deletes a book a session reads, report it with the test name; fix the test only if its intent is clearly "the delete works" and the session is incidental (delete the session first in the fixture), and say so. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and report errors in your files only. `npx prettier --check` your changed files.

## Report (your final message, under 300 words)

Changed files; the function's SQL in one line; each verify item with file:line and the answer; tests run with pass/fail counts; anything you could not do; Noticed, not done.
