# BRIEF — worker `full-direct-2-w1` — host.ts: links and history days that meet the session's notes

Supervisor: lane `full-direct-2`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`. (`prettier --check` already fails on `host.ts` at HEAD: never `--write` it.)
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This task needs no `sdk:build`: do not run one.)
- Never `kill -9`. No migration, no schema change, no new setting, event, socket or published name.

## Words

A session's **notes** (code: *own book*, `ownBookOf`) is the `lorebooks` row with `session_id` set; the
**lorebook** is `sessions.lorebook_id`. **Full** is the lorebook write setting; under Full on the owner's own
lorebook a session writes on the **"book" route** (`sessionLoreWriteTo` → `route: "book"`). A row **waits** in the
notes until Apply moves it into the lorebook (automatic Apply runs as each scene closes). An **imprint** is the
record by which Back / swipe / regenerate take a turn's write back. **Rule C** (owner, 2026-11-10): a line owns a
history day only strictly after its fork date; a dateless fork owns no dated day
(`historyOwnerStep`, `historyDayOwnerRefusal` in `src/lib/server/scenes/historyEntryOfDate.ts`). History holds one
entry per date on a line.

`host.ts` = `src/lib/server/pipelines/runtime/host.ts` (12.8k lines: read by line range, search by name; line
numbers below are approximate).

## Rules you must keep (quoted)

- "No write is refused that is held today." A write the notes took before is never refused now. **And no write
  that succeeds today may be refused by your change.** If one would be, stop that part and report it.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
  Inside the transaction call helpers with `tx as unknown as Db`, never `db`.
- Comments state the rule, not the story: no "used to", "previously", "no longer", "now", lane names or dates in
  comments (`src/lib/shared/conformance/commentHistory.test.ts` is a ratchet on these phrases). Keep the 🚧 marks
  the surrounding code uses for host-internal provisional behaviour.
- A dated session's change to an existing lorebook entry still waits in the notes: do not touch
  `lorebookChangeHeld` or `changeLoreEntry`'s hold.
- Lock order: the lorebook's advisory lock first, then the notes' (`select pg_advisory_xact_lock(<id>)`), as
  `create-lore-entry` does for a notes match (~11744–11754).

## Files owned

`src/lib/server/pipelines/runtime/host.ts` — only: `fileOntoHistoryDay` (~2413), the `core:outlet/create-lore-entry`
case (~11523–12041), the `core:outlet/link-lore-entries` case (~12285–12404), and new private helpers placed beside
`sessionLoreWriteTo` / `ownBookDaysCounted` (~1638–1785). One new test file:
`src/lib/server/pipelines/runtime/host.notesMeet.int.test.ts`. Nothing else. Do not edit
`scenes/historyEntryOfDate.ts`, `lorebooks/imprints.ts`, `lorebooks/ownBook.ts`, `lorebooks/sessionLine.ts`, any
other test file, any doc.

Readable: everything. Fixtures to copy from: `host.fullDirect.int.test.ts` (`world`, `waiting`, `hostOf`, Back /
Forward through the real rewind), `host.scenesEndRoute.int.test.ts` (a session whose scenes end by themselves, scene
close / automatic Apply), `host.historyWrites.int.test.ts`, `host.forkTiming.int.test.ts` (pending line fork,
`lineOnFirstWrite`).

## Shared piece: the notes as the "book" route writes to them

Today the only way the book route reaches the notes is `sessionLoreWriteTo(…, { notes: true })` (in
`create-lore-entry`'s `notesAlso.landing`), which drops `alsoReads` and the history-day dating unless scenes end by
themselves (~1691–1713). Add one private helper (your name; plain, e.g. `notesBesideBook`) that, for a book-route
target, returns null when the session has no notes or the notes are the lorebook, else:

- `lorebookId`: the notes' id (`ownBookOf(db, sessionId)`; never creates).
- `sourceMessageId`: `turnAnchorOf(db, sessionId, turnMessageId)` (what a notes row anchors to).
- `line: LoreWriteLine`: `branchId: null`; `historyEntryId: (await ownBookDaysCounted(db, sessionId))?.dating?.historyEntryId ?? null`;
  `reading`: the notes' main head (`{ lorebookId: notesId, branchId: null, moment: null, forkedAt: null, line: MAIN_LINE }`);
  `alsoReads: { lorebookId: <the lorebook>, reading: target.line.reading }`.

Compute it before the transaction on `db`. In `create-lore-entry`, replace `notesAlso` (`landing` + `reading`) with
it, so the extra `sessionLoreWriteTo(…, { notes: true })` call goes and a notes match's links carry the dating.

## Build 1 — a link to a row waiting in the notes lands in the notes

**`link-lore-entries` on the book route** (~12317–12384). Today both ends resolve in the lorebook only, after the
line forks; an end that is a notes row is refused ("not in this session's lorebook").

Inside the transaction, after the lorebook lock and **before** `forkedLoreLine`, when the notes exist:
1. For each end (`p.from`, `p.to`), ask whether it answers to **exactly one seen notes row**: an id that is a
   notes row the session sees (read with `entriesAsRead(tx, notesId, notesReading, "session", null, [id])`), or a
   name for which `entryNamed(name, <notes rows as read>)` is `kind: "one"` (`$lib/server/state/entriesOnReading`,
   `linkEndId` in host.ts). Anything else (no hit, a tie, unseen, a non-notes id) is **not** a notes end and goes
   on exactly as today — this is what keeps every write that succeeds today succeeding (a name with two notes
   rows and one lorebook entry still links the lorebook entry), and keeps today's refusal sentences.
2. If neither end is a notes row: unchanged code path (fork, resolve `from` on the forked line, `writeLoreLink`
   to the lorebook with the raw `to`).
3. If either end is a notes row: take the notes' lock; **do not fork**; resolve the other end against the
   lorebook as today but on `target.line.reading` (`resolveLoreLinkEnd(tx, lorebookId, raw, node.key,
   target.line.reading)`), unless it is itself a notes row; then
   `writeLoreLink(tx, notesId, fromId, { …req, to: toId }, node.key, notesLine)` with ids for both ends.
   Imprint the made link with `lorebookId: notesId`; the anchor is `imprintAnchor(sessionId) ??
   linkAnchorOf(sessionId, null, { line: notesLine, sourceMessageId })` (a press-started run imprints a notes link
   at the newest message, as the notes route does). `recordLoreSources` with `lorebookId: notesId`. The settle on
   `sources` is untouched. The result's `lorebookId` is the notes'.

**`create-lore-entry`'s `links`** (~11658, ~11902–11953):
- A notes match (`inNotes`): unchanged except that its line is the helper's notes line (so its links are dated).
- An entry of the lorebook (a new one, or a lorebook match): for each requested link, ask step 1's question of
  its `to`, **before the fork**. A link whose `to` is a notes row is written into the notes
  (`writeLoreLink(tx, notesId, entryId, { …link, to: notesRowId }, node.key, notesLine)`, after taking the notes'
  lock), imprinted and source-recorded with `lorebookId: notesId`. Every other link is written as today.
- The fork: today `foundId === null || links.length` forks. Make it: an insert (or a history day that lands in
  the lorebook) forks, as today; a match forks only when at least one of its links lands in the lorebook. A match
  whose links all land in the notes forks nothing.
- `linkIds` stays one id per requested link, in order.

Say in the report: on the book route a name that answers to one notes row now resolves to the notes row, even
when the lorebook has an entry of that name too.

## Build 2 and Build 3 — where a history day lands on the book route (decided before the fork)

Today on the book route a history write always forks (`foundId` is null for history) and `fileOntoHistoryDay` then
looks only in the lorebook: (a) a day still waiting in the notes for that date is missed and a second day made in
the lorebook, so after the scene-close merge the paragraphs are out of order; (b) a session whose scenes end by
themselves (`target.scenesEndByThemselves`) is refused a day rule C would refuse on its line ("…with no fork
date…", `historyEntryOfDate.ts` ~252). Before the `full-direct` lane such a session's day always went to the notes
(no fork, no refusal).

1. **One date.** Move the date computation out of `fileOntoHistoryDay` (~2441–2474) into a helper the outlet calls
   first, so the decision and the write use the same date. The year-less-month refusal and "history needs a date"
   stay word for word. The default date (no `year` in `fields`) counts the notes' days
   (`(await ownBookDaysCounted(tx, sessionId))?.now ?? (await sessionStoryNowOf(tx, sessionId))`) when the line has
   `alsoReads` (as today) **or** the target is the book route with notes; otherwise `sessionStoryNowOf` as today.
   A filing tool's `toNotes` write keeps today's date. `fileOntoHistoryDay` takes the computed date (it still
   refuses a null one with today's sentence).
2. **The decision**, for `typeId === HISTORY_TYPE_ID` on the book route when the notes exist and the date is not
   null, inside the transaction after the lorebook lock, before `forkedLoreLine`: take the notes' lock, then the
   day goes to the notes when either
   - **(Build 3)** the notes hold a day for that date: `historyEntryOfDate(tx, { lorebookId: notesId, branchId: null, date }, { create: false })` is not null; or
   - **(Build 2)** `target.scenesEndByThemselves` and rule C would refuse the day on the line:
     - line fork pending (`pendingLineFork(tx, sessionId, lorebookId)`): the fork would be made at the session's
       moment (`ensureSessionLine`, `lorebooks/sessionLine.ts` ~146–163). Its fork date is
       `forkDateOf({ forkYear: m?.year ?? null, forkMonth: m?.month ?? null, forkDay: m?.day ?? null, … })` with
       `m = target.line.reading.moment` (`$lib/shared/lorebooks/lineReading`). Refused when that is null or
       `compareDates(dayOnly(date), forkDate) <= 0` (exactly what `historyOwnerStep` answers for the new line);
     - otherwise: `historyDayOwnerRefusal(tx, { lorebookId, branchId: target.line.branchId, date })` is not null.
       If it throws, the day does not go to the notes (the write goes on and is refused as today).
   Any other Full session keeps today's refusal; a session with no notes keeps today's behaviour.
3. **A day that goes to the notes**: no fork; `fileOntoHistoryDay` with `lorebookId: notesId`, the notes line,
   `sourceMessageId` from the helper (a day it makes anchors to the turn), the same `anchor`. It then finds the
   waiting day and adds the paragraph after what it holds (imprinted on the notes), or makes the notes' day.
   `writeBookId` is the notes, so the links, sources and imprints are the notes'. The outlet's result reports
   `lorebookId: notesId` and `route: "own-book"` for it, matched or made (today the made branch at ~12034 always
   returns the lorebook and `target.route`: return the book the row is in).
4. A day that does not go to the notes: exactly today's path (fork, rule C refusal, find-or-make on the line).

## Tests (new file `host.notesMeet.int.test.ts`; each `it` that opens a DB takes a 60 s timeout)

Through the real outlets (`h.commit!`) and the real Back / Forward and scene close, as the fixtures above do:
1. Book route, a room waiting in the notes (inserted the way `waiting(w)` does): `link-lore-entries` from a
   lorebook room to it, by name and by id → one relationship in the notes, none in the lorebook, dated with the
   notes' dating (give the notes a history day newer than the lorebook's, assert `history_entry_id`); a session
   with `lineOnFirstWrite` set keeps it set (no fork); Back takes the link, Forward puts it back.
2. Both ends lorebook entries → unchanged (lorebook row; a pending fork forks).
3. A name with one notes row and one lorebook entry links the notes row; a name with two notes rows and one
   lorebook entry still links the lorebook entry (not refused).
4. `create-lore-entry` new room with `links` naming the waiting room → entry in the lorebook, that link in the
   notes, a link to a lorebook room in the lorebook; a notes match with `links` → its links carry the dating; a
   lorebook match whose only link goes to a notes row on a pending fork forks nothing.
5. Build 2: a session whose scenes end by themselves, line fork pending, no moment → its history day is written
   in the notes (not refused, `lineOnFirstWrite` still set); the same on a forked line for a day on or before the
   fork date; a day after the fork date lands on the line in the lorebook. At the next scene close (automatic
   Apply) the day stays waiting in the notes: assert what Apply records for it (the rule-C reason, `ownBook.ts`
   ~2050–2058, when the line's reading holds a day for that date). If it is moved instead, do not change
   `ownBook.ts`: report exactly what happens.
6. Build 2 negative: a session whose scenes do **not** end by themselves, fork pending, no moment → still refused
   with the "…with no fork date…" sentence.
7. Build 3: the lorebook holds day D ("A"), the notes hold a waiting day D ("B"); a history write for D ("C") →
   the notes' day reads "B\n\nC", the lorebook's still "A", no second day anywhere; with no `year` in `fields` and
   the notes' D newer than the lorebook's newest day, the write files onto the notes' D. Then scene close →
   the lorebook's D reads "A", "B", "C" in that order, one entry. Back after the write (before scene close) takes
   "C" out of the notes' day.

Then run, from the repo root, one run at a time (another session shares this checkout: first check
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait while a vitest runs):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/host.notesMeet.int.test.ts src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts src/lib/server/pipelines/runtime/host.scenesEndRoute.int.test.ts src/lib/server/pipelines/runtime/host.ownBookFull.int.test.ts src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts src/lib/server/pipelines/runtime/host.forkTiming.int.test.ts src/lib/server/messages/loreLinks.int.test.ts > plans/full-direct-2-w1.log 2>&1"
```

Never pipe vitest into `head`. Also `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report
errors in files you touched; ignore others). A failure in an existing test file you did not touch: report it with
its assertion; do not edit that file.

## Stop and report (do not improvise) when

A change would refuse a write that succeeds today; a file outside the owned list is needed; `scenes/
historyEntryOfDate.ts`, `ownBook.ts` or `imprints.ts` would have to change; a new name, setting or migration seems
needed.

## Report (your final message)

What each part does now, with the host.ts functions you added or changed; the decisions you made inside this brief;
tests run with pass/fail counts and the log path; tsc result; anything you stopped on; **Noticed, not done**.
