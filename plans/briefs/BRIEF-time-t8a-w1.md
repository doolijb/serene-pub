# BRIEF — worker `time-t8a-w1` — the server half of **move down the tree**

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8a`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK file changes.)

## Goal

One socket action, `amendments:moveDownTheTree`, that moves one or more lorebook entries from the line they are on
to a line that line was forked from, permanently, in one transaction under the book's lock. Only
`lorebook_entries.branch_id` changes. Its tests.

## Owner rulings (quoted; they decide, you do not)

- 2026-11-13: "perpetual entries always sit on the earliest point on their branch … a dropdown and button to
  permanently move the entry down the tree. The dropdown shows the current and parents in descending order"; an
  entry dated before the split "could theoritically be pulled down as well"; "When moving a child before the
  parent, prompt an approval to move the parent, don't allow children to be moved down without the parent."
- Plan §5.8: "Lorebook-wide and permanent actions … are the lorebook owner's alone."
- ★9 ruled: no way back from a move down. Not a merge, not a copy to a sibling line, never a move up. A move is a
  person's action, never automatic.
- Lead's decision ★T8-1: "the move is refused while the entry has a standing per-turn record of being made or
  changed by a session's turn, with a sentence saying a turn can still take it back and that it can move once the
  scene settles or the change is kept."
- History entries are refused by the server, with a sentence (a history entry moved to a line that already holds
  one for that day would break one-entry-per-day).
- The edit history does NOT record a move (`redlineKeysOf` has no line key). Do not add a redline, a cause, or a
  key. Do not call `applyEntryUpdate` for the move (it records redlines); write the column with `tx.update`.
- Supervisor's decision (★T8A-1, open with the owner): an entry moves together with its parents on the same line
  AND every entry filed under it on that line (a stored parent must be shared or on its child's own line,
  `assertAnchorEntry`, because `anchor_entry_id` cascades). The server refuses a request that leaves one behind.

## The rule is already written — use it, do not re-derive it

`src/lib/shared/lorebooks/moveDownTheTree.ts` (and its test, green) holds the whole rule, pure: `TreeRow`,
`moveDownProblems({ ids, rows, target, branches })`, `moveDownSentence(problem, words)`, `takenAlong`,
`linesStartingToRead(rows, source, target, branches)`, `linesBelow`, `reachesBelow`, `forkThatCuts`. Read it
first. Do not edit it; if it is wrong, say so in your report.

## Files owned (edit only these)

- NEW `src/lib/server/lorebooks/moveDownTheTree.ts`
- `src/lib/server/sockets/amendments.ts` — additive: one handler placed after `amendmentsDeleteBranchHandler`,
  one `register(...)` line in `registerAmendmentHandlers`. Reuse `announceReadingMoved` (same file) as it is.
- `src/lib/shared/sockets/types.ts` — additive: `namespace MoveDownTheTree` inside `Sockets.Amendments`, after
  `DeleteBranch` (~10134).
- `src/lib/shared/sockets/interest.ts` — additive: the event in `SCOPED_EVENTS` (scope = `payload?.lorebookId`,
  beside `amendments:list` ~277) and in `GATED_EVENTS` (beside `amendments:list` ~965).
- `src/lib/client/sockets/typedSocket.ts` — additive: the event and its `:error` beside `amendments:deleteBranch`
  (~4310).
- A registry test that must name the event (grep `amendments:list` in `src/lib/shared/sockets/*.test.ts` and
  `src/lib/client/sockets/*.test.ts`; add only what a failing test asks for).
- NEW `src/lib/server/sockets/amendments.moveDownTheTree.int.test.ts`

Files readable: anything. Notably `src/lib/shared/lorebooks/lineReading.ts` (`lineOf`, `rowReadsOnLine`,
`amendmentsOnLine`), `src/lib/server/utils/forkHistory.ts` (the one other writer of an entry's `branch_id`),
`src/lib/server/lorebooks/imprints.ts` (`lore_imprints`, `IMPRINT_STATUSES`), `src/lib/server/sockets/entries.ts`
(`relistEntries` ~681), `src/lib/server/sockets/amendments.ts` (`amendmentsDeleteBranchHandler` ~2299 as the model,
`announceReadingMoved` ~2508), `src/lib/server/sockets/amendments.oneVersion.int.test.ts` (int test pattern),
`src/lib/server/state/reading.ts` (`historyEntryDate` ~454), `src/lib/server/lorebooks/timeline.ts`
(`timelineOfBook`), `src/lib/server/state/storyTime.ts` (`lockBookCalendar`, `bookCalendarOf`).

## The wire (exact; the client worker codes against it)

```ts
namespace MoveDownTheTree {
	interface Params {
		lorebookId: number
		/** The entries to move, all on one line. */
		entryIds: number[]
		/** The line to move them to, below theirs. NULL = main. */
		branchId: number | null
	}
	interface Response {
		lorebookId: number
		branchId: number | null
		entryIds: number[]
	}
}
```
typedSocket: `"amendments:moveDownTheTree": { params: Sockets.Amendments.MoveDownTheTree.Params; response:
Sockets.Amendments.MoveDownTheTree.Response }` and `"amendments:moveDownTheTree:error": { params: never; response:
{ error?: string; lorebookId?: number } }`. A short comment above them saying the refusal is said inside the move
dialog (Layout's `HANDLED_ERROR_EVENTS`).

## `src/lib/server/lorebooks/moveDownTheTree.ts`

Header comment: what it owns (the one writer of an entry's line toward main; the line delete's
`keepHistoryForForks` is the other writer of `branch_id`, for history entries of a deleted line), what it does not
(merge, copy, move up, the edit history). Never statically imports `$lib/server/db`; every function takes its
handle.

1. `export async function moveEntriesDownTheTree(tx: Db, p: { lorebookId: number; entryIds: number[]; target:
   number | null }): Promise<{ moved: { id: number; typeId: string }[]; source: number; startedLines: (number |
   null)[] }>` — call it only inside `db.transaction`, with `tx`, nothing else:
   - `await lockBookCalendar(tx, p.lorebookId)` first.
   - Load the book's lines (`id, name, forkedFromBranchId, forkYear, forkMonth, forkDay`). A non-null target not
     among them: `"That branch is not a line of this lorebook."`.
   - Load every entry of the book (`id, typeId, title, branchId, anchorEntryId, fields`) and map each to a
     `TreeRow`: `name: title?.trim() || "Untitled"`, `isHistory: typeId === HISTORY_TYPE_ID`, `date:
     historyEntryDate(fields)` (the row's own date, exactly what the line readers cut on). A requested id that is
     not in the book: `"Entry not found or access denied."`.
   - `moveDownProblems(...)`; the first problem throws `new Error(moveDownSentence(problem, words))` with
     `words = { lineName: id => id == null ? "main" : <line name>, date: d => formatDate(d, await
     bookCalendarOf(tx, lorebookId)), timeline: await timelineOfBook(tx, lorebookId) }`.
   - Standing per-turn record: any `lore_imprints` row with `subjectKind = 'entry'`, `subjectId` among the ids and
     `status = 'standing'` refuses, naming the first such entry, with exactly:
     `` `A session's turn made or changed ${name} and can still take it back. It can move once that scene settles or the change is kept.` ``
     Export it as a function `standingImprintRefusal(name)`.
   - `tx.update(lorebookEntries).set({ branchId: target }).where(inArray(id, ids))`.
   - `startedLines = linesStartingToRead(movingRows, source, target, lines)`.
2. `export async function sessionsOnLines(db: Db, lorebookId: number, lines: (number | null)[]): Promise<number[]>`
   — sessions with `sessions.lorebook_id = lorebookId` and `lorebook_branch_id` among the non-null lines, plus
   (when `null` is among them) those with `lorebook_branch_id IS NULL`. Empty input → `[]`.
3. `export const NOTES_REFUSAL = "Entries in a session's notes don't move between lines."`

## The handler (in `amendments.ts`)

`amendmentsMoveDownTheTreeHandler = refusable("amendments:moveDownTheTree", body, "The entry could not be moved.",
undefined, (p) => ({ lorebookId: (p as any)?.lorebookId }))`. Body, in order:
1. `assertOwnedBook(db, userId, params.lorebookId)` (refuses a non-owner with `"Lorebook not found."`).
2. The book's `sessionId` non-null (a session's notes; members pass `assertOwnedBook`): throw `NOTES_REFUSAL`.
3. `primerRowEditProblem(db, book.id)`: throw its sentence.
4. Params: `entryIds` a non-empty array of integers (dedupe; more than 500 → `"Move at most 500 entries at once."`),
   `branchId` null or an integer; otherwise `"Choose the entries to move and the line to move them to."`.
5. `const result = await db.transaction((tx) => moveEntriesDownTheTree(tx, {...}))` — only `tx` inside.
6. After the commit: `relistEntries(socket, lorebookId, typeId, emitToUser)` once per distinct moved type; THEN
   `emitToUser("amendments:moveDownTheTree", { lorebookId, branchId, entryIds })` (so the lists land before the
   reply closes the dialog); then `announceReadingMoved((socket as any).io, await sessionsOnLines(db, lorebookId,
   result.startedLines))` (scoped `state:changed` carrying `sessionId`, as the line delete does).
7. Return the same response object.

No `enqueueLorebookAnnotation` (the vocabulary is book-wide, not per line). No SDK change, no migration, no new
setting.

## Tests — `amendments.moveDownTheTree.int.test.ts`

Follow `amendments.oneVersion.int.test.ts` (createTestDb mock, `serene-pub-vitest-…` data dir, 60 s timeouts).
Lines: main ← A (fork Year 3) ← B (fork Year 5) ← D (fork Year 10); C forked from A at Year 2 (B's sibling). Call
the handler's `.handler(socketOf(userId), params, emit)` with an `emit` spy, and assert the refusal's sentence
(the `:error` emit's `error`, or the thrown message). Cases:
1. A perpetual entry on B moves to A, and one on D moves to main.
2. A Beginning that reaches and one that does not, across two forks: on D, Year 7 → B ok; Year 7 → A refused with
   `"‹name› began at Year 7; B left A at Year 5."` (format the dates with the book's calendar as the code does).
3. A child without its parent refused (sentence); the same child with its parent (and any sibling filed under the
   parent) in one request moves, every row on the target.
4. What stays: before the move, write an amendment of the entry on B (`entry_amendments.branch_id = B`) and a link
   on B (`narrative_relationships.branch_id = B`); after it both still have `branch_id = B`; `amendmentsOnLine`
   over the stored amendments applies it on `lineOf(B)` and not on `lineOf(A)`.
5. Every line reads as before except for the moved entry: for main, A, B, C, D compute the set of entry ids read
   (`rowsReadingOnLine` over the stored rows with `historyEntryDate(fields)` as the date) before and after; the
   only difference is the moved id added on the lines `linesStartingToRead` names (perpetual B→A: A and C).
6. A second boot changes nothing: after a move, run `runMigrationsWithUpgrades(testDb, { migrationsFolder:
   path.resolve(process.cwd(), "drizzle") })` (`src/lib/server/db/dataUpgrades/index.ts`) and assert the moved
   entries, the amendment and the link are unchanged.
7. Refusals: a non-owner (`"Lorebook not found."`), a session's notes (`NOTES_REFUSAL`; grep `insertOwnBook` in
   `src/lib/server/lorebooks/ownBook.ts` for how a test makes one), a starter kit (grep `starter_kit` in existing
   `*.int.test.ts` for how one is seeded so `primerRowEditProblem` refuses; if none can be made without a plugin
   install, say so and test `primerRowEditProblem`'s presence in the handler by a mocked module instead), a
   History entry (`moveDownSentence`'s history sentence), a target that is not below (sibling C from B).
8. A standing `lore_imprints` row on the entry refuses with `standingImprintRefusal`; set it `settled` and the move
   lands.
9. `sessionsOnLines`: a session on A and one on main of the book are returned for `[null, A]`, a session on B is
   not.

Run (from the repo root, one file at a time; first check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`
and wait while one runs; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <path> > plans/time-t8a-w1-<name>.log 2>&1"`
Also run the registry tests you touched, and `src/lib/shared/lorebooks/moveDownTheTree.test.ts`.

## Hard rules

- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Sockets: one domain context listens and toasts; views never toast. `socket.off(event, handler)` always with the
  handler. An event in `SCOPED_EVENTS` must carry its scope key (`lorebookId`, `sessionId`) in the payload, or
  `emitToUser` silently sends nothing.
- `$state(new Set())` / `new Map()` is not reactive — `SvelteSet` / `SvelteMap` (client only).
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- It is a **session**, never a chat.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines you changed (check with
  `npx prettier --check <file>` and fix by hand).
- No other product's name in any file. No new name beyond the ones in this brief; if you need one, stop and ask.

## Report (your final message)

Changed files; each test file run with its pass/fail counts and log path; every sentence you added (verbatim);
anything in the brief that did not fit the code; Noticed, not done.
