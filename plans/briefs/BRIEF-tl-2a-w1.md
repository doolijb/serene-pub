# BRIEF — worker `tl-2a-w1` — guard test: nothing but the known places writes a session's lorebook

App repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-2a`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` in this task.)

Never `prettier --write` (nor a scratch-copy equivalent). Never `git checkout / restore / stash` in either repo.

## Goal

The owner's ruling (★B-5, 2026-11-08): "The book is chosen when the session is made and never moved after — not before play, not after." The rule lives in `src/lib/server/sessions/bookLock.ts` (`bookChangeRefusal`, sentence `BOOK_LOCK_REFUSAL` = "A session keeps the lorebook it started with."), enforced in `src/lib/server/sockets/sessions.update.ts` ~151–167. Write a **source-scanning guard test** that fails when any server code other than the known, ruled places writes the `sessions.lorebook_id` column (`schema.sessions.lorebookId`).

## Files owned

- NEW `src/lib/server/sessions/bookLock.guard.test.ts` — the only file you may create or edit.

## Files readable

- `src/lib/server/sessions/settingsWrite.guard.test.ts` — **the pattern to copy**: TypeScript-AST scanner (`ts.createSourceFile`), self-tests of the scanner ("finds each form" / "ignores look-alikes"), a corpus walk over `src/lib/server` and `src/routes` excluding `*.test.ts`, `*.spec.ts`, `.d.ts`, an `ALLOWED` list by file with an exact count per form and a reason, checked in both directions (an entry whose count changed fails and names itself), and `UNSEEN_INSERTS`. Follow its structure, naming style and comment style closely.
- `src/lib/server/sessions/bookLock.ts`, `src/lib/server/lorebooks/ownBook.ts` ~1215–1270 (`shareAsLorebook`), `src/lib/server/lorebooks/foldInParent.ts` header and ~1670–1680 (`readOnlyNotes`).

## The scan — differences from the settingsWrite pattern

`lorebookId` is a key on many tables (entries, scenes, branches, bindings…), so unlike settingsWrite the **table must be resolved**:

- `update` form: a call `X.set(arg)` (one argument) whose callee object is a call `Y.update(T)`, where `T` is the sessions table, and `arg` holds an object literal with a property named `lorebookId` (search through spreads, conditionals, nested literals, as `holdsKey` does; not into function bodies). Also `Y.insert(T)…onConflictDoUpdate({ set })` with `lorebookId` in `set` where T is sessions.
- "T is the sessions table": the expression text `schema.sessions` or `sessions`, or an identifier that the same file binds with `const <id> = schema.sessions` (aliases such as `const S = schema.sessions` exist in `conversations/store.ts`, `sessions/closeOut.ts`, `sessions/seatKeys.ts`, `sessions/sessionImprints.ts`). Strip parentheses / `as` casts.
- `sql` form: a string or template literal matching `update "?sessions"? set … lorebook_id` (case-insensitive; template spans joined as `?`, like the pattern). Do NOT flag `lorebook_branch_id` (the session's *line*, which is not the lorebook): use a word boundary that excludes it, e.g. `\blorebook_id\b`.
- Inserts are **not** flagged: making a session is choosing its book, never a move (`sessions.create.ts`, `import.ts`, `branch.ts`, the attic, fixtures).
- No `json-helper` form.

## The allow-list (verified by the supervisor; re-verify the counts)

Every one of these is a ruled transition, not a bypass. Exactly these, with these reasons:

| file | form | count | reason |
|---|---|---|---|
| `src/lib/server/lorebooks/ownBook.ts` | update | 1 | `shareAsLorebook`: a session with no lorebook surfaces its own notes as one and reads them as its lorebook (★27-10, 2026-11-05: "[own books] can be surfaced") |
| `src/lib/server/lorebooks/foldInParent.ts` | update | 1 | `foldInParent` step 12: after copying the attached lorebook into the notes, the session reads only its notes (★27-10: "overlays can have their parent merged in place"; the fold's guard compares reads before and after) |

`src/lib/server/sockets/sessions.update.ts` must show **zero** hits (it reads the column and refuses a change through `bookChangeRefusal`; the allowlist update never writes it): assert that explicitly in its own test, named for the book lock.

The failure message of "every other write is allow-listed" says: `"a session keeps the lorebook it started with (sessions/bookLock.ts); refuse through bookChangeRefusal, never allow-list a caller"`.

The file's header comment states the ruling (quote ★B-5 above), the forms, the allow-list rule, and its **limits** (a `.set(obj)` whose object is built in a variable, or a column name built at run time, is not seen; the FK `on delete set null` when a lorebook is deleted is not code and not scanned). Keep it about as long as the pattern's header.

Scanner self-tests must include: finds `tx.update(schema.sessions).set({ lorebookId: x })`, an alias `const S = schema.sessions; db.update(S).set({ ...(a ? { lorebookId } : {}) })`, `onConflictDoUpdate` on sessions, raw `UPDATE sessions SET lorebook_id = 1`; ignores `tx.update(schema.scenes).set({ lorebookId: 1 })`, `tx.update(schema.sessions).set({ lorebookBranchId: 1 })`, `UPDATE sessions SET lorebook_branch_id = 1`, `db.insert(schema.sessions).values({ lorebookId: 1 })`, `db.select({ lorebookId: schema.sessions.lorebookId })`.

## Out of scope

Editing any other file. Changing what any writer does. A new sentence or name.

## Stop and ask when

A hit appears that is not in the table above (report the file:line and stop: do not allow-list it yourself); the counts differ.

## Done means

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/bookLock.guard.test.ts > plans/tl-2a-w1.log 2>&1"` from the app root passes (it is a plain unit test, no database). Before running, wait until no other vitest is up: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Never pipe vitest into `head`. Then `npx prettier --check src/lib/server/sessions/bookLock.guard.test.ts`.

## Report (your final message)

File created; the hits the scan found (file:line form); test result line; prettier result; anything noticed but not done.
