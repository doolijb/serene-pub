# BRIEF — `sense-b1-w1` — the held amendment's schema, migration and resolver

You are a `lane-worker` for lane `sense-b1` (supervisor: the agent that launched you). Repo
`/home/jody/github/serene-pub`; the SDK is the sibling `/home/jody/github/serene-pub-sdk` (you do not edit it).
Use absolute paths. Return your report as your final message (no report file).

## The lane in one paragraph

Stage B's thin slice: a pipeline's change to an entry of the session's **attached lorebook** is no longer written
into that lorebook. It is stored as a **held amendment** 🚧 — an `entry_amendments` row whose `lorebook_id` is the
session's **own book** (`lorebooks.session_id = the session`), whose `entry_id` is the attached lorebook's entry,
carrying `source_message_id` (the turn's anchor) and `base` (the value of each changed field as the session read it
when it wrote). Only the session that holds it reads it; Apply later folds it into the lorebook. **You build the
foundation only**: schema, the generated migration, the shared resolver's ordering, and the reading that carries
the holder. Other workers build the write, the readers, Apply and the docs after you.

## Goal

1. **Schema** (`src/lib/server/db/schema.ts`, these two tables only):
   - `entry_amendments` (`entryAmendments`, ~line 9274): add `sourceMessageId: integer("source_message_id")`
     (nullable, plain int, **no foreign key**, as `lore_imprints.message_id`); add
     `base: jsonb("base").$type<Record<string, { v: unknown } | null>>()` (nullable). Make `year` nullable. Add ONE
     CHECK `entry_amendments_undated_check`: `year IS NOT NULL OR (base IS NOT NULL AND month IS NULL)` — an
     undated row is a held one and names no month. The existing `entry_amendments_date_check` stays as it is. No
     new index (the existing `entry_amendments_book_idx` on `lorebook_id` serves every held read).
   - **A held amendment is exactly a row with `base IS NOT NULL`.** That is the one marker every reader uses.
     Write it in the table's doc comment. Rewrite the comment that says "⚠ **An amendment IS a date.**" (~9258)
     to say: an amendment is a date, **except a held amendment** 🚧, which a session keeps in its own book on top
     of an entry of the lorebook it reads, may be undated, and reaches the lorebook only when the lorebook's owner
     applies it. Also fix the `year` column comment ("`year` is required") and the `lorebook_id` comment (the
     pool reads a book's amendments by `lorebook_id`; a held row is filed under the holder's own book, not the
     entry's book, so a by-book read of the entry's book never sees it). Keep comments short and plain.
   - `lore_imprints` (`loreImprints`, ~line 10785): add `origin: text("origin").notNull().default("run")` with
     CHECK `lore_imprints_origin_check`: `origin IN ('run', 'routine', 'press', 'person', 'apply', 'book-run',
     'upgrade')`; add `batch: text("batch")` (nullable); add `cause: jsonb("cause").$type<Record<string, unknown>>()`
     (nullable). Doc comment: one line each — `origin` who or what made the change (only `run` and `apply` are
     written today; the others are reserved names for the lanes that follow), `batch` one Apply press's id (the
     unit a take-back undoes), `cause` who pressed and the session and message the change came from.
2. **Migration — generated, never written by hand.** Immediately before generating, re-check the highest index:
   `ls /home/jody/github/serene-pub/drizzle | tail -3` and the last entry of `drizzle/meta/_journal.json` (0155
   today, `0155_chubby_lockjaw`; another session may add one — yours must be the next number). Then run
   `cd /home/jody/github/serene-pub && npm run db:generate`. If drizzle-kit asks create-or-rename, every column
   here is **created**. Then read the generated `.sql`: it must contain only the statements for the columns,
   the `year` drop-not-null, and the two CHECKs above. **If it contains anything else** (another session's
   uncommitted schema change), stop, touch nothing more, and report the file name and the foreign statements.
   Never edit the generated SQL, snapshot or journal. Never `db:migrate` against the owner's data.
3. **The shared resolver** (`src/lib/shared/lorebooks/amendments.ts`, `src/lib/shared/lorebooks/lineReading.ts`
   amendment ordering only):
   - `Amendment` (and `LineDated`) can carry `held?: { anchor: number | null }`; a held one's `year` may be null.
     Shape the types so a held row cannot be mistaken for a line row (a discriminated union, or a guard), and keep
     every existing line-amendment caller compiling with the least change.
   - `amendmentsOnLine(amendments, line, moment)`: take held rows **out before** the line-step lookup (a held row
     has `branchId` null and would otherwise be read as one of main's). Return the line's amendments exactly as
     today, then the held ones **last**, ordered by anchor ascending (a null anchor first), then id. A held row
     with a date applies only when `moment` is null or its date (day grain, `dayOnly`) is at or before the moment;
     an undated held row always applies. Fork cuts never apply to held rows (they are the session's, not a line's).
   - `amendmentsAheadOnLine`: never lists a held row.
   - Rewrite the header's "⚠ `moment = null` … The `year` column is `NOT NULL` for that reason" paragraph to
     state the exception (held amendments, last, the session's own); add "held amendments" to the Precedence list
     as step 5.
4. **The reading carries the holder** (`src/lib/server/state/reading.ts`, two places only — the supervisor will
   report this as the one edit outside the lane's owned list):
   - `LineReading` gains `holderBookId?: number` with a one-line comment: the session's own book, whose held
     amendments this reading lays on top; absent for every reading that is not a session's reading of its
     attached lorebook.
   - `sessionReadingOf`: when the session has an attached lorebook (`session.lorebookId != null`) and an own book,
     set `holderBookId` to the own book's id on every reading it returns (both the normal return and the
     `BranchRefusal` fallback). Fold the own-book lookup into the existing session select as a scalar subquery
     (`(select id from lorebooks where session_id = sessions.id limit 1)`) so the hot path stays **one query**. A
     session reading its own book alone gets no holder (it has nothing held: held rows exist only beside an
     attached book).
5. **`src/lib/server/state/entriesOnReading.ts`**:
   - `EntryReading` = `Pick<LineReading, "branchId" | "moment" | "forkedAt" | "line" | "holderBookId">`. `MAIN_HEAD`
     has none.
   - `entryOverlaysFor(db, lorebookId, reading, entryIds?)` selects `sourceMessageId` too and reads
     `(lorebook_id = lorebookId AND base IS NULL AND <on the line>)` **OR**, only when
     `reading.holderBookId != null && reading.holderBookId !== lorebookId`,
     `(lorebook_id = reading.holderBookId AND base IS NOT NULL)`; `entryIds` narrows both arms. Map a held row to
     `held: { anchor: sourceMessageId }`. No caller changes: every reader that passes a session's reading gets the
     session's held rows, and the main reading never does.
   - Update the file header (step 2 "What they say": the line's amendments, then the session's held ones).
6. **Compile fallout.** `npx tsc` will flag places that read `Amendment.year` as a number (for example
   `src/lib/server/sockets/entries.ts` ~1264, `heldBy`). Fix only what the type change breaks, minimally and
   without changing behaviour for line amendments; where a held row could reach the code, treat it as "no date"
   in the narrowest honest way (for `heldBy`: skip a held deciding amendment — the field is decided by this
   session's own change, and the response's date cannot name one). List every file and line you touched for this.

## Files owned

- `src/lib/server/db/schema.ts` — the two tables above only.
- The generated migration: `drizzle/0156_*.sql`, `drizzle/meta/0156_snapshot.json`, `drizzle/meta/_journal.json`
  (generated, never hand-edited).
- `src/lib/shared/lorebooks/amendments.ts`, `src/lib/shared/lorebooks/lineReading.ts` (amendment ordering only).
- `src/lib/server/state/reading.ts` — `LineReading.holderBookId` and `sessionReadingOf` only.
- `src/lib/server/state/entriesOnReading.ts`.
- Compile-fallout lines only, in whatever file `tsc` names (list them).
- Tests: `src/lib/shared/lorebooks/amendments.test.ts`, `src/lib/shared/lorebooks/lineReading.test.ts`,
  `src/lib/server/state/entriesOnReading.int.test.ts` (extend), and one new
  `src/lib/server/db/entryAmendmentsHeld.int.test.ts`.

## Files readable

Anything. Useful: `src/lib/server/utils/testDb.ts` (`createTestDb`, `createTestUser`), the existing
`entriesOnReading.int.test.ts` for the PGlite test pattern, `src/lib/server/lorebooks/ownBook.ts` (`ownBookOf`,
`insertOwnBook`), `plans/DESIGN-own-book-write-path-2026-11-11.md` D1, D3 and the Challenger round C1.

## Out of scope

Writing held rows from the host, retraction, any reader other than `entryOverlaysFor`, Apply, branch copy,
`lore_imprints` writers, docs, NOMENCLATURE (the supervisor's), the SDK, any socket.

## Stop and ask (in your report, then stop) when

- the generated SQL holds anything beyond this brief's columns and CHECKs;
- a type change would need edits in more than ~10 files, or would change behaviour for line amendments;
- you need a new exported name beyond `holderBookId` and the `held` marker (name it and why; do not add it);
- an existing test fails for a reason you did not cause (report it; do not fix other people's code).

## Done means

- `amendments.test.ts` / `lineReading.test.ts`: held rows come last after every line step, anchor order then id,
  null anchor first; a dated held row is out before its date and in at and after it, and in at `moment = null`;
  an undated one always in; a fork cut never cuts a held row; `amendmentsAheadOnLine` never lists one; existing
  cases unchanged.
- `entriesOnReading.int.test.ts`: two sessions on one lorebook, each with an own book; a held row in session A's
  own book renaming entry E: `entriesAsRead` on A's `sessionReadingOf` shows the new name; B's does not; the
  lorebook's own reading (`readingOf` / `MAIN_HEAD`) does not; a held row never appears when reading the own book
  itself; `sessionReadingOf` sets `holderBookId` for an attached session and not for a session reading its own
  book alone.
- `entryAmendmentsHeld.int.test.ts`: the migration applied: an undated row without `base` is refused; an undated
  row with `base` and a month is refused; an undated held row is accepted; a dated row without `base` still
  accepted; `lore_imprints.origin` defaults to `run`; an unknown origin is refused. Migrating twice (a second boot)
  changes nothing.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean (report any error outside your fallout
  that is not yours, verbatim, without fixing it).
- Run tests only as below.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not need `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never
  `kill -9` anything. Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite).
  It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- Migrations are generated (`npm run db:generate`) and never hand-edited; a new migration's index must exceed the
  highest applied or it is silently skipped; `0000`–`0093` are byte-identical forever.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Never run the
  whole suite. `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Other sessions are editing this repo (a visual-novel layout lane, speech). Do not touch their files and do not
  "fix" failures that are theirs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything; line numbers have drifted.
- NOMENCLATURE R3: qualify, never the bare noun — "held amendment", never bare "held" in a name. ⚠ "held" is
  already used elsewhere (a ruleset's *held entry*, a change *held for review*); never reuse those names.

## Report (your final message)

Changed files (with the compile-fallout lines listed separately); the migration's file name, index and full SQL;
the type shape you chose for held amendments and why; tests run with pass/fail counts; anything that stopped you;
**Noticed, not done**.
