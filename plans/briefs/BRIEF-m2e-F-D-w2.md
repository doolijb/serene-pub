# BRIEF m2e-F-D-w2 — primer rows are read-only (server)

Lane **m2e-F-D**, worker 2. Supervisor reads your report. Work from `/home/jody/github/serene-pub`. Absolute paths only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`; worker 1 may run one — if a test fails importing `@serene-pub/*`, wait a minute and re-run once.)

## Goal (owner ruling 2026-11-04, ★M2e-D-4: "primer rows read-only, clone only")
A **primer row** — a `lorebooks` row of `kind = "starter_kit"` whose `extra_json.provided` is its OWN genuine mark (`markedBook(extraJson, uuid)` non-null) and whose mark's owner is present (`providedOwnerPresent(db, mark.plugin)`: `core` always, a plugin while its `plugins` row exists) — **refuses every person's edit** with one sentence, through every write door a book has. Cloning it (`starterKits:clone`, `lorebooks:duplicate`, a person's start from it) keeps working. The boot syncs (`syncProvidedPrimers` in `src/lib/server/plugins/providedPrimers.ts`, `syncProvidedBooks` in `providedBooks.ts`) and the admin disable/enable (`setProvidedBookDisabled`) still write: they are not a person's edit — the refusal lives at the socket doors that act for a person, never in the sync or a shared low-level writer.

## What to build
1. In `src/lib/server/plugins/providedMarks.ts`, beside `PROVIDED_BOOK_DELETE_REFUSAL` (additive hunk only; never reformat the file):
   - `primerRowEditRefusal(pluginName: string | null): string` 🚧 — the sentence. `null` (core): `This starter lorebook comes with the pub: clone it to make your own.` A plugin: `This starter lorebook comes with <pluginName>: clone it to make your own.` Doc comment: what it is and what it is not (not `PROVIDED_BOOK_DELETE_REFUSAL`, which is the delete refusal for every provided book; not `STARTER_KIT_SENTENCES.shippedKeep`).
   - `primerRowEditProblem(db: Db, lorebookId: number): Promise<string | null>` 🚧 — the one decider (pattern: `providedCastProblem` in `lorebooks/castOwnNames.ts`): reads the row (`kind`, `uuid`, `extraJson`) with the `db` it is given; returns the sentence when it is a primer row as defined above, else null. For a plugin owner it reads `plugins.name` (fall back to the plugin id). Must NOT statically import `$lib/server/db` (the file doesn't today; keep it that way). Inside a transaction, callers pass `tx`.
2. Call it at every **person-facing** write door that writes a book's own data, right after that door's ownership check, refusing with the door's existing refusal mechanism (`refusable` throw, `refuse(...)`, or `{ error }` — whatever that handler already uses) and writing nothing:
   - `src/lib/server/sockets/lorebooks.ts`: `lorebooksUpdateHandler` (book settings, name, description, Rules, cover via `coverFile`), `createLorebookBindingHandler`, `updateLorebookBindingHandler`, `uploadMemberFaceHandler`, `resolveOrCreateBindingByNameHandler` (only when it would create), and any other handler in that file that writes the book's rows after `assertOwnedBook`/`findOwnedBook` (read them all; list each with its line in your report).
   - `src/lib/server/sockets/entries.ts`: `createEntryHandler`, `updateEntryHandler` (this includes archive/unarchive), `deleteEntryHandler`, `updateEntryPositionsHandler`, `entrySetMarksHandler`, `copyFromLibraryHandler` (copying INTO the primer row), and any other person-facing entry write there.
   - `src/lib/server/sockets/starterKits.ts` `starterKitsSaveFromBookHandler`: when `params.lorebookId` is a primer row, refuse with the read-only sentence instead of `saveOwnBook`.
   - The other socket files that write a book by `lorebookId` after `assertOwnedBook`/`findOwnedBook`: `sockets/narrativeGraph.ts`, `sockets/lorebookStoryTime.ts`, `sockets/lorebookState.ts`, `sockets/amendments.ts`, `sockets/bindingSuggestions.ts`, `sockets/scenes.ts`. Read each such call site: if it is a person's write to that book's own rows (entries, places, graph rows, calendar/clock, state), add the refusal; if it is a read, or a write to a session's own data, leave it. List every site you looked at, with line, write/read, and what you did.
   - Never put the check in `findOwnedBook`/`assertOwnedBook` themselves (they also gate reads and session attach), never in `library/writes.ts`, the pipeline host, or the syncs.
3. **The wire field for the client (lane m2e-F-C builds against it):** in `src/lib/shared/sockets/types.ts`, the `lorebooks:list` row type (near `provided?: { disabled: boolean }`, ~line 7850) and the `lorebooks:get` `lorebook` type (~line 7905) each gain
   `/** 🚧 (m2e-F-D) Present exactly when this is a primer row (a `starter_kit` with its own provided mark, owner present): every edit is refused; clone it. Same meaning as a shipped prompt's `readOnly`. */ readOnly?: true`.
   Also amend `bookAccess`'s doc comment there ("The ONE field the client derives read-only from") to say read-only is `bookAccess !== "owner"` **or** `readOnly`. Set `readOnly: true` on the server where `provided` is set: `sockets/lorebooks.ts` ~421–425 (list rows; `kind` must be read — add it to the select if absent) and ~724–730 (get). Only for a primer row, never for a plain provided book of kind `book`.
4. Tests — a new file `src/lib/server/plugins/primerRowReadOnly.int.test.ts` (copy the db-mock/setup pattern of `src/lib/server/plugins/providedPrimers.int.test.ts`, including `releaseDataDir`; every `it`/`test` that opens or writes the DB gets a 60 s timeout; the `beforeAll` 180 s):
   - after `syncProvidedPrimers`, the first admin owns a core primer row; each door above (at least: `lorebooks:update` settings, `lorebooks:update` with `coverFile`, entry create, entry update, entry archive via update, entry delete, entry positions, binding create, `starterKits:saveFromBook` on it, and one each from narrativeGraph / lorebookStoryTime if you added the check there) is refused with exactly `primerRowEditRefusal(null)` and the row is unchanged;
   - a plugin-owned `starter_kit` row with a genuine mark gives the plugin-name sentence; the same row after its plugin row is deleted is editable (owner gone);
   - an admin kit (`starter_kit` without a mark) and a plain provided book (`kind: "book"`, mark present) are still editable;
   - `lorebooks:list` / `lorebooks:get` carry `readOnly: true` for the primer row and not for the others;
   - cloning it (`starterKits:clone` and a person's start) still works and the clone has no `readOnly`;
   - an upgrade still lands: bump the primer's version in the test the way `providedPrimers.int.test.ts` "an upgrade is a diff" does, sync again, the row's entries change;
   - the admin disable/enable pair still toggles it.
   Run it plus the regression set: `src/lib/server/plugins/providedPrimers.int.test.ts`, `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/sockets/lorebooks.bookSettings.int.test.ts`, `src/lib/server/sockets/avatarAndCover.int.test.ts`, and the existing test file of every socket file you touched (find them with `ls src/lib/server/sockets/<name>*.test.ts`). Command: `cd /home/jody/github/serene-pub && timeout 1500 npx vitest run <files> > <log> 2>&1` (log under `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/m2eFD-w2-*.log`; then `grep`/`tail` the log). **Never pipe vitest into `head`.** If an existing test edits a primer row through a door as setup, change only that setup to write with the db directly, and say so.
   - `npx tsc --noEmit -p .` — no new errors in your files (filter with grep).

## Files owned
`src/lib/server/plugins/providedMarks.ts`, `src/lib/server/plugins/primerRowReadOnly.int.test.ts` (new), `src/lib/server/sockets/{lorebooks,entries,starterKits,narrativeGraph,lorebookStoryTime,lorebookState,amendments,bindingSuggestions,scenes}.ts` (additive hunks only), `src/lib/shared/sockets/types.ts` (the two fields + the one comment), existing test files of those sockets (setup-only changes, stated).
## Files readable
Anything under `src/`. `plans/REPORT-m2e-D-2026-11-04.md` §1 (contracts).
## Out of scope
Client, docs, NOMENCLATURE (the supervisor queues §25 rows). No migration, no new setting, no new socket event, no change to `findOwnedBook`/`assertOwnedBook`/syncs/`library/writes.ts`/pipeline host. No refusal for session-run (pipeline) writes — list any you notice under Noticed. Nothing for later.

## Rules (quoted; they apply to you)
- **Shared files:** a story-playtest programme edits server files right now. Re-read each file (the exact region) immediately before every edit; additive hunks only; never reformat; never `prettier --write`.
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "Never `kill -9` the dev server." · "Never `git checkout` / `restore` / `stash`." · "Never seed a row at a hardcoded id."
- CLAUDE.md Decisions: "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Propose and wait … on anything a user sees … a new name …" — the names in this brief are already chosen; any OTHER new exported name, stop and list it in the report instead of adding it. "Findings along the way go under Noticed, not done, never fixed in passing."
- NOMENCLATURE R1 "One word, one meaning" — `readOnly` here means exactly what a shipped prompt's `readOnly` means ("clone it, never edit it"). R6 — new names are 🚧 in their doc comments. §24: "Say what it is **not**, in the declaration, if a near-neighbour exists."
- CLAUDE.md Hard rule (sessions): a socket view never calls `toaster`; you add no client code.
- `defaultDb`/module `db`: in int tests the module-level `db` of a module first loaded through `$lib/server/db`'s own boot graph is NOT the mocked db. Pass the handler's `db` (or `tx`) explicitly to every helper you call.

## Done means
`primerRowReadOnly.int.test.ts` green; the regression set green (or each failure shown to be pre-existing with the same failure on a run without your change — say how you showed it); tsc clean on your files.

## Report
Write your report to `/home/jody/github/serene-pub/plans/briefs/REPORT-m2e-F-D-w2.md` if the harness lets you; otherwise return it as your final message. Contents: changed files with the hunks' purpose; every door site examined (file:line, write/read, done/left); tests run with pass/fail counts; new names; Noticed, not done.
