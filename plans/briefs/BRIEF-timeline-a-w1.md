# BRIEF — `timeline-a` worker 1 — the Timeline flag: boot pass, notes copy, owner-only setter

Supervisor: lane `timeline-a`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Drizzle + PGlite, Vitest 4).
Use absolute paths. Read files by line range; `host.ts`, `db/schema.ts`, `sockets/sessions.ts`, `sockets/lorebooks.ts`
and `lorebooks/ownBook.ts` are very large: search by name, read ranges.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build` at all; do not run one.)
- Never `kill -9`. Never `npm run db:generate` (the migration is done: `drizzle/0160_sharp_dormammu.sql`); never edit `db/schema.ts`.

## Goal

A lorebook now has a stored flag `lorebooks.timeline_enabled` (boolean, NOT NULL, default **true**; drizzle field
`timelineEnabled`) — the **Timeline** switch (owner, 2026-11-14). On = everything as today. Off = the book is read as it
stands now, written undated, its story time does not move (worker 2 builds that behaviour; you build none of it).
The reader module already exists and you use it, never the column directly:
`src/lib/server/lorebooks/timeline.ts` — `timelineOf(row)`, `timelineOfBook(db, id)`, `sessionTimelineOf(db, sessionId)`,
`sessionTimelineSql()`, `holdsSomethingDated(db, id, { defaultCalendar })`, `TIMELINE_OFF_SENTENCES`. Read it first.
(Exception: a write of the column — the setter, the pass, the notes copy — names `timelineEnabled` in its `.set()` /
`.values()`; that is fine.)

You build four things.

### 1. The one-shot boot pass — new file `src/lib/server/lorebooks/timelinePass.ts`

`export async function settleTimelineSwitches(db: Db): Promise<{ on: number; off: number; notesCopied: number }>`

- One `db.transaction(async (tx) => …)`; inside it use **only `tx`** (the outer `db` deadlocks PGlite silently).
- Every lorebook with `overlay_of IS NULL` (lorebooks, starter kits, and session notes that are their session's whole
  world): `on = await holdsSomethingDated(tx, id, { defaultCalendar })`, where `defaultCalendar` is `null` for a
  book with `session_id IS NULL`, and for session notes (`session_id` set) the calendar the notes are born with:
  `genreCalendarOf(tx, sessionId)` from `src/lib/server/lorebooks/ownBook.ts` (it is a private `async function`
  today; add `export` to it — that one word is the only change you make to `genreCalendarOf`). Write
  `timelineEnabled = on` only where it differs; count `on` / `off` by the resulting value.
- Then every notes book with `overlay_of` set copies its overlaid lorebook's value (one `update … from …` statement
  where the two differ; count rows as `notesCopied`). Rule (correction 4 of the lane brief): "A session that reads an
  attached lorebook follows **that lorebook's** switch; its notes copy the switch when they are made and when the
  parent's switch changes."
- Header comment states the rule, not the story: runs once, never again (boot marker); a person's later switch-off
  stands, and a lorebook that gains a dated row later is not switched on by it; fresh installs have nothing to do.

Register it in `src/lib/server/startup/index.ts` (only that registration): a new entry in `startupTasks` placed
**right after** the `dc-crawl-clock` entry and before `summaries-to-routine`, shaped like the `dc-cairns` entry:
`name: "timeline-switch"`, `failsHealth: true`, `doneMarker: "timeline-switch"`, `run` dynamically imports the pass
and logs one line only when something changed, e.g.
`[timeline-switch] N lorebook(s) keep their timeline, M have none; K session note(s) follow their lorebook`.
Its doc comment: 🚧, what it does, why after `attic` and `dc-crawl-clock` (0.5.3 history arrives through the attic;
the crawl-clock pass sets session clocks), one-shot by boot marker (`startup/bootMarkers.ts`).

### 2. Session notes copy the switch when made — `src/lib/server/lorebooks/ownBook.ts`

Only these two functions:
- `insertOwnBook` (~195): when `row.overlayOf != null`, the new row's `timelineEnabled` is the overlaid book's
  (`await timelineOfBook(tx, row.overlayOf)`); with no overlay, leave the column default (do not set it).
- `copyOwnBookToBranch` (~724; the insert at ~752 that copies the parent's calendar and clock): add
  `timelineEnabled: parent.timelineEnabled` beside them.
Another lane edits this file too (`writeEntryKeys`, Apply): re-read the region right before each edit, change only
these lines, never reformat.

### 3. The owner-only setter — `src/lib/server/sockets/lorebooks.ts` and `src/lib/shared/sockets/types.ts`

- `types.ts`, `namespace Lorebooks` › `namespace Update` › `interface Params` (~8515): add beside `loreWriteMode`:
  ```ts
  /**
   * 🚧 The book's **Timeline** switch, sent only when changed (never read off `lorebook`). Off: the book is read as it
   * stands now, written undated, and its story time does not move; nothing dated is deleted. The book's owner only.
   * A session's notes that overlay a lorebook follow it and refuse this.
   */
  timelineEnabled?: boolean
  ```
- `lorebooksUpdateHandler` (~942): read `params.timelineEnabled` the way `loreWriteMode` is read (sent on its own;
  anything other than `true` / `false` / `undefined` is refused with `"The timeline is on or off."`). Owner only —
  the existing owner check block (~1006–1023, `eq(schema.lorebooks.userId, userId)`, "Lorebook not found.") must run
  for it too; extend that select with `overlayOf`. Notes rule: refuse only notes that overlay a lorebook
  (`overlayOf !== null`) with the existing sentence `"A session's own notes follow their session's lorebook."`;
  notes that are their session's whole world (`sessionId !== null`, `overlayOf === null`) may be switched. Keep the
  existing refusals for `primaryRuleset` / `loreWriteMode` on notes exactly as they are.
- In the existing transaction (`tx` only), set `timelineEnabled` on the row when sent, and in the same transaction
  copy it to every notes book overlaying this one:
  `tx.update(schema.lorebooks).set({ timelineEnabled }).where(eq(schema.lorebooks.overlayOf, row.id))`.
- The flag is already on the wire: `WireLorebook = SelectLorebook` carries every column on `lorebooks:get` and the
  update reply. Change nothing there; confirm it in your report.

### 4. Tests (new files; templates named)

Int tests open a PGlite test DB; copy the harness of
`src/lib/server/sessions/dcCrawlClock.int.test.ts` (the `vi.mock("$lib/server/db", …createTestDb…)`, a
`fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-<name>-"))` data dir, `releaseDataDir` in `afterAll`,
`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Never seed a row at a hardcoded id.

a. `src/lib/server/lorebooks/timelinePass.int.test.ts`:
   - a plain book with nothing dated → off; one book per fact → on: a clock on the book; a branch row; a session
     reading it with a clock; a history entry whose `fields.year` is a number (and one whose year is the string
     `"1200"` stays off); a dated entry amendment; a cast amendment; a cast version (`character_versions`) with a year;
     a link (`narrative_relationships`) with `history_entry_id`; a stat (`attribute_values`) with `history_entry_id`
     of the book's history entry; a declared calendar on a lorebook (non-null `story_calendar`).
   - notes: a session with no lorebook whose notes were made by `insertOwnBook` (born calendar) and nothing dated →
     off; the same with a session clock → on; notes overlaying a book copy that book's result.
   - **one-shot**: run `runWithBootMarker(db, { name, doneMarker: "timeline-switch", run: () => settleTimelineSwitches(db).then(() => {}) })`
     (from `src/lib/server/startup/bootMarkers.ts`; it needs a `system_settings` row id 1 — the template inserts it),
     then switch a dated book off by hand and add a dated row to an off book, run it again: both stay as set, and
     every book's flag is byte-identical to after the first run.
b. Notes copy (`src/lib/server/lorebooks/ownBook.timeline.int.test.ts`): `insertOwnBook` with `overlayOf` of an off
   book makes off notes, of an on book on notes; with no overlay the column default (on); `copyOwnBookToBranch`
   copies an off parent's value (see `ownBook.branchNotes.int.test.ts` for how it is driven).
c. Setter (`src/lib/server/sockets/lorebooks.timeline.int.test.ts`; drive the handler as
   `lorebooks.bookSettings.int.test.ts` does): the owner switches it off and the reply's `lorebook.timelineEnabled`
   is false; overlay notes of that book follow (false) and follow back on; a user it is merely shared with, or
   another user, cannot change it (refused, value unchanged); overlay notes refuse it with the sentence; a garbage
   value is refused.
d. A duplicate and a starter copy keep the flag: add one test each, beside the existing ones, only if the file can
   take it without restructuring — `src/lib/server/sockets/lorebooks.duplicate.int.test.ts` (duplicate an off book →
   copy is off) and `src/lib/server/lorebooks/starterKits.int.test.ts` (a kit row that is off → a lorebook made from
   it is off). Otherwise a new file `src/lib/server/lorebooks/timelineCopies.int.test.ts`.

## Files owned (the only files you may edit or create)

`src/lib/server/lorebooks/timelinePass.ts` (new) · `src/lib/server/startup/index.ts` (the one registration) ·
`src/lib/server/lorebooks/ownBook.ts` (`export` on `genreCalendarOf`, `insertOwnBook`, the `copyOwnBookToBranch`
insert — nothing else) · `src/lib/server/sockets/lorebooks.ts` (`lorebooksUpdateHandler` only) ·
`src/lib/shared/sockets/types.ts` (the one param) · the test files named above.

## Files readable

Anything. Useful: `src/lib/server/lorebooks/timeline.ts`, `src/lib/server/startup/bootMarkers.ts`,
`src/lib/server/sessions/dcCrawlClock.ts` (+ its test), `src/lib/server/utils/lorebookDuplicate.ts`,
`src/lib/server/lorebooks/starterKits.ts` (`bookFromKit`), `src/lib/server/utils/testDb.ts`.

## Out of scope — never build

Any behaviour of the flag (reading, writing, clocks, history: worker 2); a default for new lorebooks or for any preset;
any client or UI; any SDK file; docs and NOMENCLATURE (the supervisor writes them); export/import format; any other
function in `ownBook.ts` (`ownBookFor`, `ensureOwnBooks`, Apply…); `sockets/sessions.ts`; `sockets/import.ts`;
`attic/`. Comments state the rule, not the story.

## Rules your work depends on (quoted from CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- "Never `kill -9` the dev server."
- Vitest: "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Stop and ask (write it in your report and stop that part) when

A file outside the owned list is needed; a new name beyond `settleTimelineSwitches`, `timelinePass.ts`,
`"timeline-switch"` and `timelineEnabled` is needed; the pass cannot tell "holds something dated" from stored facts;
anything here contradicts what you find in the code.

## Running tests

Only your own test files, one run at a time. Before **every** run:
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — if any vitest is running, wait (re-check every
minute or so with a single command; do not loop `pgrep -f "vitest run"`). Then, from the repo root:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/timeline-a-w1.log 2>&1"`
and read the log with `tail`/`grep`. Typecheck your files with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"`.

## Done means

The four parts built; the tests in a–d pass; `tsc` shows no error in your files; `npx prettier --check` on each file
you changed (report, don't reformat others' code).

## Report

Your final message: changed files (absolute paths); what each change does in one line; tests run, exact command and
result counts; anything you could not do and why; **Noticed, not done**.
