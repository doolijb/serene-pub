# BRIEF — lane `time-t10`, worker w1 — the server core: the "dated writes passed" query, the decider, the Branch move, the pipeline guard

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t10`. You run in parallel with worker w2 (client files only; you never touch them).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU, no migration. Leave the owner's `vite preview` (port 4173) alone.

## Goal

When a session's story clock is moved **back** to before dated things that session has already written into its lorebook, the move follows the session's **On revision** setting and is confirmed first. You build the server core the two person doors (worker w3, later) and the pipeline outlet use.

Owner rulings (quote, do not reinterpret):
- 2026-11-14 (★12): "The clock moved back uses **On revision** (no separate answer for deleting a turn and for moving the clock)"; "The clock moved back past the session's own writes uses the session's existing *On revision* (overwrite or branch). No new setting; 'flashback' is the same line, writing at the earlier date."
- 2026-11-13: "When a session's story clock moves back past things that session already wrote, a choice is required, never made silently."
- 2026-10-16: **On revision** (`sessions/revision.ts`: `overwrite` / `branch`).
- P1: no silent automatic action — a pipeline's move back past the session's writes is refused with a sentence.

Under **Overwrite** nothing already written is removed (today's behaviour: a clock set is a column write; later-dated rows are cut by the reading's moment, `src/lib/shared/lorebooks/lineReading.ts` `rowReadsOnLine` ~360–375). Under **Branch** the session branches at its newest message and the branch's clock is set to the date moved to; the branch rides its parent's line and forks the line "at the session's day" on its first write (`src/lib/server/lorebooks/sessionLine.ts` header and `ensureSessionLine` ~115–125; `src/lib/server/sessions/branch.ts` ~160–185). No change to `branch.ts`.

## Files owned (edit only these)

1. **New** `src/lib/server/sessions/clockMoveBack.ts`, and its test **new** `src/lib/server/sessions/clockMoveBack.int.test.ts`.
2. `src/lib/server/sessions/revision.ts` — add only what is listed below; widen its header comment by one paragraph.
3. `src/lib/server/pipelines/runtime/host.ts` — a SHARED file: ONLY the three lines described in §D, inside the clock outlet (~10613–10660). Nothing else in it.
4. **New** `src/lib/server/pipelines/runtime/host.clockMoveBack.int.test.ts`.

Readable: anything. Wire types are already written by the supervisor in `src/lib/shared/sockets/types.ts`: `Sockets.Sessions.StoryClock.ClockMoveBackNotice` `{ mode: "overwrite" | "branch"; count; latestLabel; toLabel; sentence }` (do not edit types.ts).

## Build

### A. `revision.ts` additions (pure words and one branch helper)

```ts
/** 🚧 The confirmation's sentence for a clock moved back past the session's dated writes. Pure. */
export function clockMoveBackSentence(mode: OnRevision, count: number, latestLabel: string, toLabel: string): string
```
Exactly these sentences (🚧, do not reword):
- overwrite: `This moves the story back before ${n} thing${n === 1 ? "" : "s"} this session has written, the latest dated ${latestLabel}. They stay in the lorebook and read again from their dates.`
- branch: `This branches the session here and moves the branch's story back to ${toLabel}. What this session has written dated after that stays on the line it leaves.`

```ts
/** 🚧 Refusals of a pipeline's clock move back past the session's dated writes (P1). */
export const CLOCK_MOVE_BACK_REFUSALS = {
  /** A person's Time passes… press (`cause: 'action'`): its run cannot stop to ask. */
  action: "This would move the story back before things this session has written. Use Move the clock… to choose what happens.",
  /** Any other pipeline or routine move. */
  run: "The story clock was not moved back: this session has written at later dates. Move it by hand to choose what happens."
} as const
export const NOTHING_TO_BRANCH_AT = "This session has no messages yet, so there is nothing to branch from."  // 🚧
```

```ts
/** Fork the session at its newest live message through the `branch` built-in, for a clock moved back under Branch. No revised-turn mark. */
export async function branchForClockMove(db: Db, opts: { sessionId: number; userId: number; io?: unknown }): Promise<{ ok: true; sessionId: number } | { ok: false; error: string }>
```
Share the naming and the `runBuiltIn(kind: "branch", payload: { fromMessage, title })` call with `branchForRevision` through one private helper (refactor `branchForRevision` to use it; its behaviour must not change: `branch.revision.int.test.ts` and `revision.int.test.ts` stay green). The newest live message: as `messageBefore` but without the `lt`, `liveMessageWhere()`, `orderBy desc(id)`. None → `{ ok: false, error: NOTHING_TO_BRANCH_AT }`.

### B. `clockMoveBack.ts` — the query and the one decider

```ts
export type ClockMoveBackNotice = Sockets.Sessions.StoryClock.ClockMoveBackNotice

/** A person's requested move, as the clock door names it. */
export type PersonClockMove = { to: StoryClock } | { follow: true } | { by: number; unit: StoryTimeUnit }

/** A refusal carrying the notice: thrown by the clock door until the person confirms. */
export class ClockMoveBackRefusal extends StoryClockRefusal { constructor(readonly notice: ClockMoveBackNotice) { super(notice.sentence) } }

/**
 * The session's own dated writes on its line that read at `from` and not at `to` — what the move from `from`
 * to `to` passes. Read only.
 */
export async function datedWritesPassed(db: Db, sessionId: number, from: StoryDate, to: StoryDate): Promise<{ count: number; latest: StoryDate | null }>

/** THE decider for a person's move: null = proceed exactly as today; else the notice to confirm. */
export async function clockMoveBackNotice(db: Db, sessionId: number, move: PersonClockMove): Promise<ClockMoveBackNotice | null>

/** For a pipeline's move, inside its transaction: the refusal sentence, or null. */
export async function clockMoveBackRefusal(db: Db, sessionId: number, from: StoryClock, to: StoryClock, cause: ClockMoveCause): Promise<string | null>

/** A confirmed move under Branch: branch at the newest message (`branchForClockMove`), then set the BRANCH's clock to `to` (null = follow its line's present) with `sessionLinePatch`, as `setSessionStoryClock` writes a clock (`sockets/storyClock.ts` ~204–220: dynamic import of `sessionLinePatch` from `$lib/server/sockets/sessions`, inside one `db.transaction`, `tx` only). The parent session is not written. */
export async function moveClockBackOnBranch(db: Db, opts: { sessionId: number; userId: number; to: StoryClock | null; io?: unknown }): Promise<{ ok: true; sessionId: number; from: StoryClock | null } | { ok: false; error: string }>
```

**`datedWritesPassed`** — the sources (correction 4 of the lane brief; `entry_amendments` has NO session column, do not use it as a session source):
1. `sessionReadingOf(db, sessionId)` (`state/reading.ts`); none → `{ count: 0, latest: null }`. `book = reading.lorebookId`, `line = reading.line`. Only rows of that book count (a session's own notes book is not "its lorebook" here).
2. **Entry versions:** `lore_imprints` rows with `session_id = sessionId`, `subject_kind = 'version'`, `lorebook_id = book`, any `status` (settled and kept rows still mean the write stands) → distinct `subject_id` → `entry_amendments` rows by id with `year IS NOT NULL` → date `{ year, month, day }`, `branchId`. A version another session also wrote into counts. A deleted version simply has no row.
3. **Ties:** `lore_imprints` with `subject_kind = 'relationship'` (same session and book) → distinct `subject_id` → `narrative_relationships` (`branchId`, `historyEntryId`) → the history entry's date: `historyEntryDate(lorebookEntries.fields)` (`state/reading.ts` ~454). No history entry or no date → undated → not counted.
4. **Cast versions:** `character_versions` with `source_session_id = sessionId`, `lorebook_id = book`, `year IS NOT NULL` → date `{ year, month, day, hour: atHour }`, `branchId`.
5. **Scenes:** `scenes` with `session_id = sessionId`, `lorebook_id = book` → date: the filed history entry's date (`historyEntryId` → `historyEntryDate`) else the opened clock's day (`openedStoryClockYear/Month/Day`, day only; no year → undated, not counted); `branchId`. One per scene (the history day it is filed under is not counted again).
6. A row counts when `rowReadsOnLine(row, line, date, from) && !rowReadsOnLine(row, line, date, to)` (`$lib/shared/lorebooks/lineReading`). `latest` is the greatest counted date by `compareDates` (`$lib/shared/lorebooks/storyDate`). Keep it to a handful of `select`s with `inArray`; no N+1.

**`clockMoveBackNotice`**:
- Read the session row's clock columns and its reading. No session, no book, or `reading.timelineOff` → null.
- `from` = `storyMoveStartOf(db, sessionId, row).present` (`state/storyTime.ts` ~464); null → null.
- Destination: `to` as given; `follow` → the line's present (`storyNowOf(db, book, reading.branchId, { line: reading.line })` then `clockOfNow`), null → null; `by`/`unit` → `advanceStoryTime(from, by, unit, await bookCalendarOf(db, book))` (`$lib/shared/lorebooks/storyDate`); a `problem` → null (the step's own refusal follows later).
- `compareDates(destination, from) >= 0` → null (forward or same: as today).
- `datedWritesPassed(db, sessionId, from, destination)`; count 0 → null.
- `mode = await sessionOnRevision(db, sessionId)`; labels by `formatDate(date, calendar)`; sentence by `clockMoveBackSentence`. Return the notice.

**`clockMoveBackRefusal`**: `compareDates(to, from) >= 0` → null; `datedWritesPassed(db, sessionId, from, to).count === 0` → null; else `cause === "action" ? CLOCK_MOVE_BACK_REFUSALS.action : CLOCK_MOVE_BACK_REFUSALS.run`. `ClockMoveCause` from `state/clockMoves.ts`. It runs inside the outlet's transaction: use only the handle you are given.

### D. The pipeline guard in `host.ts` (three lines, nothing else)

Inside the clock outlet's `db.transaction(async (tx) => { const t = …; const done = …` (~10640–10660), right after `done` is computed and BEFORE `if (target && … by === 0) return done`:
```ts
const { clockMoveBackRefusal } = await import("$lib/server/sessions/clockMoveBack")
const back = await clockMoveBackRefusal(t, sessionId, done.from, done.clock, cause)
if (back) throw new StoryClockRefusal(back)
```
The throw rolls the move back; the existing catch already turns a `StoryClockRefusal` into a skip under `onRefusal: 'skip'` (Time passes… uses it: SDK `core-catalog/src/shared/timePasses.ts` ~88–95; the ledger and receipt carry the sentence through `clockSkipReason`) and a halt otherwise. Keepers and rounds only move forward today (`state/clockProposal.ts` ~67–73), so the `run` sentence guards a path nothing takes yet.

## Rules your work depends on

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`. Modules under `sessions/` take a `db` handle; do not statically import `$lib/server/db` in `clockMoveBack.ts`.
- Comments state the rule, not the story. Mark new names and sentences 🚧.
- Never `prettier --write` beyond the lines you changed (never on a whole file of the shared `host.ts`).
- An int test that opens a DB inside an `it` needs a 60 s timeout.
- It is a **session**, never a *chat*.
- If anything here needs a new setting, event, migration or published SDK name, or you cannot tell the session's own writes from others', STOP and report.

## Tests (write them; run each as below, one at a time)

Before each run: `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` — if a vitest is running (another session shares the checkout), wait and check again. Then:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t10-w1-<name>.log 2>&1"` and read the log (never pipe vitest into `head`). Copy fixtures from existing int tests (e.g. `src/lib/server/sessions/branch.revision.int.test.ts`, `src/lib/server/sockets/storyClock.int.test.ts`, `src/lib/server/pipelines/runtime/host.datedVersion.int.test.ts`, `src/lib/server/lorebooks/imprints.version.int.test.ts`).

`clockMoveBack.int.test.ts`:
- a move back past nothing, a forward move, a session with no clock and no present, a lorebook with the Timeline off → `clockMoveBackNotice` null;
- a session that wrote a dated version (an imprint of kind `version`) at a later date → a notice: mode overwrite, count, `latestLabel`, the exact sentence; set `on_revision = 'branch'` → the branch sentence; `follow` and `by: -n` moves are judged the same way;
- another session's later version (its imprint) does not count; a cast version with `source_session_id` and a scene of the session count; an undated tie does not;
- `moveClockBackOnBranch`: the new session's clock is the date moved to; the parent session's clock and the line are unchanged; the branch's reading does not read the later dated version (use the existing readers, e.g. `entryOnReadingSql`/`sessionReadingOf` as `branch.revision.int.test.ts` reads); a first dated write on the branch after the move forks its line at the date moved to (`ensureSessionLine` → the new `lorebook_branches` row's fork date), and the old line still has the later version;
- Overwrite: after a plain clock set back, the later version is still in the lorebook and reads again when the clock is set past its date.
`host.clockMoveBack.int.test.ts`: a `cause: 'action'` back move past the session's dated write under `onRefusal: 'skip'` moves nothing and the skipped ledger row / receipt carries `CLOCK_MOVE_BACK_REFUSALS.action`; a `cause: 'keeper'`/`'tick'` back move with `onRefusal: 'halt'` halts with the `run` sentence; a back move past nothing still moves. Follow how existing `host.*.int.test.ts` files drive the advance-story-clock outlet.
Also re-run `src/lib/server/sessions/revision.int.test.ts src/lib/server/sessions/branch.revision.int.test.ts` and the existing host clock tests (`ls src/lib/server/pipelines/runtime/ | grep -i clock`).

Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report errors in your files (w2 may be mid-edit in client files; ignore those, but name them).

## Report (your final message)

Changed files; each test command with pass/fail counts; the exact exported signatures as built; any deviation from this brief and why; Noticed, not done. Under 400 words.
