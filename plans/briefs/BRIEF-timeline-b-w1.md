# BRIEF — `timeline-b` worker 1 — a lorebook's Timeline switch: the server leftovers

Supervisor: lane `timeline-b`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Drizzle + PGlite, Vitest 4).
Use absolute paths. Read files by line range: `pipelines/runtime/host.ts` (13k lines), `sockets/lorebooks.ts` (5.9k),
`lorebooks/ownBook.ts` (3.3k) are very large: search by name, read ranges, re-read the region right before each edit,
never reformat. All server paths below are under `src/lib/server/`.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; do not run one.)
- Never `kill -9`. **No migration**: never `npm run db:generate`, never edit `db/schema.ts`. Nothing under `../serene-pub-sdk`.
- A peer session edits widget files (`PluginFrame`, `widgetWire`, `sessionPageProjections`, SDK surfaces) and another
  lane works in this checkout: touch nothing outside **Files owned**.

## Background (read first)

Lane `timeline-a` built `lorebooks.timeline_enabled` (drizzle `timelineEnabled`, boolean, default **on**) — the 🚧
**Timeline** switch — and its rule. Read, in full: `lorebooks/timeline.ts` (the only reader of the column:
`timelineOf`, `timelineOfBook`, `bookTimelineSql`, `sessionTimelineOf`, `sessionTimelineSql`, `holdsSomethingDated`,
`TIMELINE_OFF_SENTENCES`), `lorebooks/timelinePass.ts`, and `plans/REPORT-timeline-a-2026-11-14.md`. The setter
already rides `lorebooks:update` (`sockets/lorebooks.ts` ~1006–1088). `LineReading.timelineOff`
(`state/reading.ts`) is `true` / `false` when the reader asked, absent when not.

Owner rulings this builds (quote them in your report where they decide something):
- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled";
  "No history entries for undated lorebooks, maybe scenes only."; "Switch off, allow, but prompt the user with a
  recommendation to clone as a timeless variant instead. Do not provide SDK api for this yet."
- 2026-11-14: a new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created." (This
  lane builds "ask when created" only: the New lorebook dialog sends the value.)
- Standing: nothing is deleted by the switch; lorebook-wide actions are the lorebook owner's alone.

## Rules (quoted from CLAUDE.md and the lane brief)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Never seed a row at a fixed id.
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing."
- "Sockets: one domain context per event family is the only listener and the only place that toasts" (client side; you add no event).
- Read the switch only through `lorebooks/timeline.ts`; a write of the column may name `timelineEnabled` in `.set()` / `.values()`.
- It is a session, never a chat. No other product's name in any file. Comments state the rule, not the story.
- **No SDK change, no new socket event, no new setting.** New names: only those this brief names (each marked 🚧).
- Tests: only your files, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-b-w1-<n>.log 2>&1"`
  from the repo root, one run at a time. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
  if a run is up (another worker or another session shares this checkout), wait and check again each minute (never
  `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. An int test that opens a DB inside an `it` takes a
  60 s timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-b-w1-tsc.log 2>&1`
  and report only errors in your files (a client worker is editing at the same time; its errors are not yours). Do not
  run `npm run check` or `npm test`.
- Model new tests on lane timeline-a's: `sockets/lorebooks.timeline.int.test.ts`, `lorebooks/timelinePass.int.test.ts`,
  `lorebooks/ownBook.timeline.int.test.ts`, `pipelines/runtime/host.timelineOff.int.test.ts`,
  `state/timelineOff.int.test.ts` (find them with `ls`, read how they open a DB and call handlers).

## Files owned (only these)

`sockets/lorebooks.ts` (create, update's emit, `lorebooks:get`'s counts, the import read only) ·
`sockets/lorebookStoryTime.ts` (`lorebooks:setClock` / `lorebooks:setCalendar` refusals only; the lane brief said
`sockets/lorebooks.ts`, the handlers live here) · `sockets/entries.ts` (the session history write only) ·
`messages/writes.ts` (`historyDateOfSessionWrite` ~329 only) · `state/clockProposal.ts` (`clockMoveProblem` ~78
only; the lane brief said `state/clockMoves.ts`, the function lives here) · `pipelines/runtime/host.ts`
(`changeLoreEntry` ~2461 only) · `lorebooks/ownBook.ts` (Apply's waiting rule only) · `lorebooks/timeline.ts` ·
`lorebooks/timelinePass.ts` · `startup/index.ts` (one task) · `utils/lorebookExportBuilder.ts` ·
`utils/lorebookExportMapper.ts` (only if the import read needs it) · `src/lib/shared/sockets/types.ts` (the payload
fields named below) · new test files beside each, and existing timeline-a test files you extend.
Not yours: any client file, `NOMENCLATURE.md`, `docs/*` (the supervisor queues those), `sockets/import.ts`, the attic,
primers, `StartSessionForm.svelte`, `SessionViewPanel.svelte`.

## Build

### 1. `lorebooks:create` takes an optional `timelineEnabled` (`sockets/lorebooks.ts` ~697–759)

`Sockets.Lorebooks.Create.Params` (`shared/sockets/types.ts`, namespace `Create` ~283) gains
`timelineEnabled?: boolean` (doc it 🚧 like `Update.Params.timelineEnabled` ~8590: "The new book's **Timeline**
switch; absent = on."). Validate as the update does (`typeof !== "boolean"` → throw `"The timeline is on or off."`).
Written on the blank insert only (~732–739: `...(timelineEnabled !== undefined ? { timelineEnabled } : {})`).
With `starterKit`, it is not read (as `primaryRuleset` is not). Absent = on, so the start form's own
`lorebooks:create` (`components/sessionForms/StartSessionForm.svelte` ~957, which sends nothing) behaves as today.

### 2. Export and import carry the switch

- Export (`utils/lorebookExportBuilder.ts` ~507–527, beside `serenepub.storyTime`): **only when the switch is off**
  (read it with `timelineOf(lorebook)`), write `extensions.serenepub.timelineEnabled: false`. Nothing else moves; no
  `formatVersion` bump (convention: `utils/lorebookExportMapper.ts` ~20–27, ~748–751 — additive optional keys, "a file
  without it imports as before"). A timelined book's export must be byte-identical to today's.
- Import: `importLorebookDocument` (`sockets/lorebooks.ts` ~5642) → `createLorebookFromParsedCard` → the insert
  ~5180–5200 (beside `...importedStoryTime(card.extensions?.serenepub)`): `timelineEnabled: false` only when the file
  says exactly `false`; anything else (absent, malformed) = on. Check the parsed card keeps the key (round trip test).
  Do not touch the other insert (~5289, the overwrite path) or any other arrival path (one-file import
  `sockets/import.ts`, attic, primers); name the overwrite path under Noticed.

### 3. Refusals while the switch is off

One new sentence only, added to `TIMELINE_OFF_SENTENCES` in `lorebooks/timeline.ts`:
`dated: "This lorebook has no timeline, so nothing dated is written to it."` (🚧 provisional copy). Otherwise reuse
`history` / `clock`.

a. **The session history write** (`sockets/entries.ts`, the create path ~912–927, `if (params.sessionId != null)`):
   when the entry type is history (`entryDeclaration(typeId)?.roles.order`, as `datedAtStoryNow` reads it) and the
   session's governing book has its timeline off (`sessionTimelineOf(db, params.sessionId)`, or the reading's
   `timelineOff` if the write already carries it), throw `TIMELINE_OFF_SENTENCES.history` before anything is written
   or forked. This is Summarize to lorebook's **New** history day. `messages/writes.ts` `historyDateOfSessionWrite`
   (~329) must never be reached with the switch off; its `{ year: 1, month: 1, day: 1 }` fallback stays for a
   timelined book with no dates. Change `writes.ts` only if a caller other than `entries.ts` ~925/~1011 can reach it
   with the switch off (check; `grep -rn historyDateOfSessionWrite`). A person's own create (no `sessionId`) is not
   refused here.
b. **The lorebook's own clock and calendar** (`sockets/lorebookStoryTime.ts`): `lorebooks:setClock` (~259) refuses
   with `TIMELINE_OFF_SENTENCES.clock`, `lorebooks:setCalendar` (~219) with `TIMELINE_OFF_SENTENCES.dated`, both
   after the owner and primer checks, both for a set and a clear, read with `timelineOfBook`. `lorebooks:storyTime`
   and `lorebooks:checkCalendar` (reads) are unchanged.
c. **`clockMoveProblem`** (`state/clockProposal.ts` ~78): with the session's timeline off, return
   `TIMELINE_OFF_SENTENCES.clock`. Add `sessionTimelineSql()` to its existing select (no extra query; read the value
   through `timelineOf`).
d. **`changeLoreEntry` re-dating a history entry** (`pipelines/runtime/host.ts` ~2461–2591): when the stored entry
   is history (`HISTORY_TYPE_ID`) and `a.line.reading.timelineOff === true`, drop the date parts from the change
   (`patch` keys that set the history date: find them with `historyDateColumns` in `state/lineSql.ts` / the history
   type's declared fields; year, month, day and any time-of-day parts) before the hold decision, so neither a held
   change nor an in-place write carries them; the rest of the change goes through. If nothing is left, it returns
   false as an empty change does today. Do not touch `host.ts` ~11779 or any other region.
e. **Apply** (`lorebooks/ownBook.ts`): when the target lorebook's switch is off, nothing dated is applied and nothing
   is dropped; it waits with a reason, through the places reasons already reach the screen:
   - A **dated held change** (`held.year != null`): `heldChangeVerdict` (~1447–1510) returns
     `verdict(TIMELINE_OFF_SENTENCES.dated)` (`done: false`) before any other check. Read the switch from
     `reading.timelineOff === true` if Apply's reading carries it (verify: the reading comes from `sessionReadingOf`);
     otherwise `timelineOfBook(t, stored.lorebookId)`. That one function serves the list (`overlayItemsOf` ~1768,
     shown by `SessionViewPanel.svelte` ~694–699 which hides that row's Apply) and Apply (~2015, ~2377 →
     `stillHeld` with the reason).
   - A **notes' history day** (an own-book entry of `HISTORY_TYPE_ID`, dated or not) in `applyOverlayItems`
     (~1914; the move/merge split ~2060–2075): with the target's switch off (read once, `timelineOfBook(t, bookId)`),
     it neither moves nor merges: `heldDays.push({ notesEntryId: own.id, reason: TIMELINE_OFF_SENTENCES.history })`
     and continue — the reply's waiting days, as `MERGE_HELD_REASONS` already reach `SessionViewPanel.svelte`
     ~174–177. Undated non-history entries move as today.
   - Do not edit `SessionViewPanel.svelte`. If a reason cannot reach it without an edit there, stop and report.

### 4. Open sessions learn of a flip (`sockets/lorebooks.ts`, `lorebooks:update` ~942–1131)

`story:moved` is **not** a socket event. After the update's transaction commits, **only when `timelineEnabled`
changed** (add the stored value to the existing `owned` select ~1014 and compare; none when another field changes or
the value is the same), emit the existing scoped `state:changed` with `{ sessionId }` to each session the switch
governs, with the pattern `tellSessions` has in `sockets/lorebookState.ts` ~215–228
(`broadcastToSessionUsers(socket.io, s.id, "state:changed", { sessionId: s.id })`, a failure logged, never a refusal):
sessions whose `lorebook_id` is this book, and the session whose notes are this book when that session has no
`lorebook_id` (its notes are its whole world). Then check on the client, read only, whether the session page
re-reads its story clock (`sessions:storyClock`) when it hears `state:changed` (start at
`src/lib/client/components/sessionPage/sessionPageInbox.svelte.ts` ~273–285 and
`src/lib/client/state/sessionState.svelte.ts` `onChanged`). Do not edit the client: report what you find.

### 5. The counts for the prompt, on `lorebooks:get` for the owner

In `buildLorebookGet` (`sockets/lorebooks.ts` ~765–858), in the `access === "owner"` branch beside `sharedWith`,
add 🚧 `timelineCounts: { datedChanges: number; historyEntries: number; clockSet: boolean }`:
`datedChanges` = this book's `entry_amendments` with `year` set + its `cast_amendments`; `historyEntries` = its
entries of `HISTORY_TYPE_ID` (dated or not); `clockSet` = the book's own `story_clock_year` or any of its lines'
(`lorebook_branches`) is set. One query (subselects), reusing the predicates `holdsSomethingDated` uses
(`lorebooks/timeline.ts` ~122–156; put the counting function in `timeline.ts`, exported, beside it). Type it on the
`lorebooks:get` response's lorebook in `shared/sockets/types.ts` (optional; owner only; doc 🚧 "What switching the
Timeline off would hide: Book settings' prompt."). A shared reader's reply has no `timelineCounts`.

### 6. The one-time pass, corrected and registered

`lorebooks/timelinePass.ts` `settleTimelineSwitches` and `lorebooks/timeline.ts` `holdsSomethingDated`. The rule
(lane brief A6 with its corrections 2 and 3, which rule):

> "Off" is only: no `overlay_of`, not a kit or primer, nothing dated, no history entry, no clock, default calendar,
> one line, and no session of a story-time or unresolvable genre reading it or owning it.

- **Any history entry, dated or not, counts** (not only one with a numeric year, `timeline.ts` ~139): change
  `holdsSomethingDated`'s history predicate to "any history entry" and its doc comment to match.
- **Starter kits and primers** (`lorebooks.kind`: verify the values; a primer is a provided `starter_kit` row) are
  never decided by the pass: skipped, left as they are (on).
- **Sessions:** a book stays on when any session reading it (`sessions.lorebook_id = book.id`) or owning it (the book
  is that session's notes, `lorebooks.session_id`) — **archived or not** — has a genre that keeps story time, or a
  genre that does not resolve. `keepsTime` lives only in the live genre registry: `getGenre(genreId)?.keepsTime ===
  "story"`, read as `rulesets/genreFit.ts` ~110 reads it (see its imports ~14–20); `rulesets/genreOffer.ts` ~25 is only
  a type. Read `sessions.genre_id` through `tx`. **A genre id that does not resolve (retired, plugin disabled or
  missing) keeps the book on.** A session with `genre_id` null: treat as unresolvable (on) unless you find code that
  defines a null genre's time; say which in the report.
- Notes over a lorebook copy it (as built). Keep the `{ on, off, notesCopied }` return.
- **Register it** in `startup/index.ts` as a task named `timeline-switch` with `doneMarker: "timeline-switch"` (the
  marker name NOMENCLATURE already records) and `failsHealth: true`, placed **after** the `plugins` task (~467–472)
  so plugin genres are registered, following the `seat-members` task's shape (~305–330). Update the header comments of
  `timelinePass.ts` (it is registered now; the rule above) and the task's own comment.
- Tests (extend `lorebooks/timelinePass.int.test.ts`): each "stays on" reason (something dated; an undated history
  entry; a session of a story-time genre reading it; the same session archived; a session whose genre does not
  resolve; whole-world notes of a story-time session, e.g. an unplayed Living session's notes); a hand-made lorebook
  with no session and nothing dated goes off; a book read only by a session of a real-time genre (e.g. Chat or the
  Guide; check `keepsTime` in the registry) goes off; a starter kit with nothing dated stays on; a second run changes
  nothing.

## Done means

New or extended int tests, all passing, covering: create with and without the field (and with a kit, not read);
export has no key when on and the same bytes as before (assert the key's absence and that `extensions.serenepub` has
no other new key), key present when off, import round trip off → off and on → on; each refusal in §3 and its on-path
unchanged (session history write, setClock, setCalendar, `clockMoveProblem`, `changeLoreEntry` dropping only the date
parts, Apply's dated held change waiting with the reason in the list and in Apply's `stillHeld`, a notes' history day
waiting with the reason in the reply); the `state:changed` emit on a flip reaching an attached session and a
whole-world-notes session, and none when only the name changes; the counts (owner gets them, a shared reader does
not); the pass cases in §6. Run the timeline-a suites you touched as well (`sockets/lorebooks.timeline.int`,
`timelinePass.int`, `ownBook.timeline.int`, `runtime/host.timelineOff.int`, `state/timelineOff.int`) and any existing
suite of a function you changed that you can find quickly (`grep -l` the function name in `*.test.ts`). `tsc` clean
in your files.

## Report — `plans/briefs/REPORT-timeline-b-w1.md`

Changed files (with the line ranges you touched in `host.ts` and `ownBook.ts`); tests run with results and log paths;
every sentence and name added (🚧); each assumption; what §4's client check found; anything you could not do and why;
**Noticed, not done**.
