# BRIEF playtest2-L2-w3 — a provided book keeps its cast's names and faces: the two holes, and the owner-present rule

Lane `playtest2-L2` · worker w3 · report `plans/REPORT-playtest2-L2-w3-2026-11-04.md` (if the harness refuses the write, put the full report in your final message).

## Background (read, do not edit `providedMarks.ts`)
- Ruled 2026-11-04 (§0-D): a cast member's own name, own nickname and face are refused on a **provided** book (one that comes with the pub or a plugin); the person's clone accepts them. The sentence is `PROVIDED_BOOK_CAST_REFUSAL` in `src/lib/server/plugins/providedMarks.ts`: *"A lorebook that comes with the pub or a plugin keeps its cast's names and faces; clone it to give them your own."* Reuse it; no new sentence.
- Today's check is `providedCastProblem(book, stored, update)` in `src/lib/server/lorebooks/castOwnNames.ts`; it refuses whenever `markedBook(book.extraJson, book.uuid)` is non-null. Called once, from `updateLorebookBindingHandler` in `src/lib/server/sockets/lorebooks.ts` (~1645-1662).
- **M2e's rule** for "this book is provided" is *core's, and any plugin still installed*: `mark && await providedOwnerPresent(db, mark.plugin)` (`providedMarks.ts` ~143; used at `sockets/lorebooks.ts` ~724 and ~1030). A book whose plugin was uninstalled is a person's book like any other.

## Goal
1. `castOwnNames.ts`:
   - Add one exported `async function providedBookKeepsCast(db: Db, book: { uuid: string; extraJson: unknown }): Promise<boolean>` = `const mark = markedBook(book.extraJson, book.uuid); return !!mark && (await providedOwnerPresent(db, mark.plugin))`. Import `providedOwnerPresent` from `providedMarks` (import only). Take `db` as a parameter — the module must not statically import `$lib/server/db` (keep the ⚠ line); import the `Db` type the way `providedMarks.ts` does.
   - `providedCastProblem` becomes `async (db, book, stored, update)` and gates on `providedBookKeepsCast(db, book)` instead of the bare `markedBook`. Its comparison logic is unchanged. Update its doc comment (one sentence on the owner-present rule).
2. `sockets/lorebooks.ts`, `updateLorebookBindingHandler` (~1656): `await providedCastProblem(db, book, …)`. Nothing else in that block.
3. `sockets/lorebooks.ts`, `uploadMemberFaceHandler` (~1831-1900): after the access check and **before** the bytes are judged or any file is written, read the member's book (`uuid`, `extraJson`) and `throw new Error(PROVIDED_BOOK_CAST_REFUSAL)` when `await providedBookKeepsCast(db, book)`. This refuses adding a picture to a provided book's picture list. Touch nothing else in the file — the lorebook list/picker/attach readers are another programme's (M2e) and are off limits.
4. `src/lib/server/sockets/amendments.ts`, the cast overlay validator `cleanCastFields` (~447-540): when the cleaned fields carry `faceMediaId` or `retold`, read the member's book and base row (`faceMediaId`, `retold`, `ownName`, `ownNickname` of `lorebook_bindings` where `id = subject.memberId`) and refuse with `await providedCastProblem(db, book, stored, fieldsForCompare)` **before** `faceMediaProblem` judges the picture (so a provided book answers with the cast sentence, not a picture sentence). Compare the face as the validator will store it (`cardIdOf(fields.faceMediaId)`, or null). On an amendment **update** (the handler at ~907-950 builds the cast subject), compare against that amendment's own stored `fields` where they carry the key, else the base row — so re-saving an existing dated overlay that changes neither is not refused. You may add an optional `amendmentId?: number` to the private `CastSubject` interface to get there. A dated `name` change is out of scope (see below).

## Tests
- `src/lib/server/lorebooks/castOwnNames.int.test.ts`: the existing provided-book block marks the book with plugin `"acme"` but no `plugins` row — under the new rule that book counts as uninstalled. Insert a `plugins` row for `"acme"` in that setup (required columns: `pluginId`, `name`, `bundleSource`, `bundleHash`; never a fixed `id`) so the existing cases keep refusing. Add: **a book whose plugin was uninstalled (mark, no plugins row) accepts a new own name**; **a `core`-marked book refuses** (no plugins row needed).
- New `src/lib/server/sockets/lorebooks.providedCast.int.test.ts`: **a face upload to a provided book is refused** with `PROVIDED_BOOK_CAST_REFUSAL` and writes no `files` row (count before/after); the same upload to the clone (`duplicateLorebookRows`) or an uninstalled plugin's book succeeds; **a dated face change** (`amendments:create` cast overlay with `faceMediaId` and/or `retold: { face: true }` differing from the base row) **on a provided book is refused**; a dated overlay that changes only e.g. `summary` is not. Copy the DB/test scaffolding from `castOwnNames.int.test.ts` (`vi.mock("$lib/server/db", …)` + `createTestDb`, `releaseDataDir`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, a temp dir prefixed `serene-pub-vitest-l2-provided-`). For the upload bytes use a tiny real PNG buffer (find one used by an existing `uploadMemberFace` test: `grep -rn uploadMemberFace src/lib/server --include=*.test.ts`). Read the amendments handler's params from `src/lib/server/sockets/amendments.ts` and an existing `amendments.int.test.ts` case.

## Files owned (edit only these)
`src/lib/server/lorebooks/castOwnNames.ts`, `castOwnNames.int.test.ts`, `src/lib/server/sockets/lorebooks.ts` (the two blocks named above only), `src/lib/server/sockets/amendments.ts` (`cleanCastFields`, the private `CastSubject`, and the update handler's subject line only), the new `lorebooks.providedCast.int.test.ts`.
NOT yours: `providedMarks.ts` (import only), `shared/sockets/types.ts`, `NOMENCLATURE.md`, every other block of `sockets/lorebooks.ts`, `server/plugins/**`.

## Rules (from CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." If a check runs inside a transaction, pass `tx`.
- "Never seed a row at a hardcoded id."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- No new error string, field, event or export beyond `providedBookKeepsCast`. If you think you need one, stop and say so.

## Out of scope — never built
A dated `name` / `aliases` change on a provided book (note it under Noticed if it is open); faces in the book file; any setting.

## Done means
Green, run like this (read the log after; never pipe vitest into `head`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/lorebooks/castOwnNames.int.test.ts src/lib/server/sockets/lorebooks.providedCast.int.test.ts src/lib/server/sockets/amendments.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-L2-w3.log 2>&1; echo exit=$?'
```
`npx prettier --check` each changed file (say whether it already failed at HEAD: `git show HEAD:<file> | npx prettier --stdin-filepath <file> --check`). Never `tsc` over the project, `npm run check`, or `npm test`.

## Report
Changed files with one line each · tests run, exact command, pass/fail counts · assumptions made · Noticed, not done.

## Verbatim lane rules
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an SDK build.)
