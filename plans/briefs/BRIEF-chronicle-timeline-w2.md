# BRIEF — worker `chronicle-timeline-w2` — the app half: the `history-entries` answer with the timeline off, and tests

App repo `/home/jody/github/serene-pub`. Supervisor: lane `chronicle-timeline`. Report back as your final message:
changed files, each test command you ran with its pass/fail counts, anything you could not do, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You never run `sdk:build`, `npm test`, `npm run check`, `tsc` or a dev server.** The SDK is already built with
the new field. You run only the targeted vitest files below.

## Rules you work under

- Edit ONLY the files under **Files owned**. Never `prettier --write`; never reformat lines you did not change.
  Keep the file's style (tabs, double quotes, no semicolons).
- Comments state the rule, not the story (no "the lane added", no "previously"); mark new behaviour 🚧 as the
  neighbouring comments do.
- No other product's name in any file. It is a **session**, never a *chat*.
- **No new names** in any SDK package and no new exported name in the app except the one parameter below. Never
  touch `src/lib/server/**`, `requests/startHistoryEntry.ts`, `requests/compileHistoryEntry.ts`, the SDK repo,
  or any other file.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- **Never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs). Never `assert`/`expect` on a whole
  happy-dom element so it prints: compare `=== null` booleans, `textContent` strings, attribute strings.

## Owner rulings (quoted)

- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled"; "No history entries for undated lorebooks, maybe scenes only."
- 2026-11-13: "Do not provide SDK api for this yet" (the Timeline switch and the timeless copy).
- 2026-11-15: approved exactly one new SDK name, an optional, read-only, `@experimental` `timeline?: boolean` on
  `HistoryEntriesV1` (already in the built SDK). Its contract, verbatim from `sdk/src/widgets.ts`:
  > Whether the lorebook this session reads keeps a timeline. False: the answer carries no time. `clock` has no
  > present, `current` is null, `scenes` and `earlier` are empty, `earlierTotal` is 0 and the open scene's
  > `since` is empty; `unfiledDays` is one group (`date` null, `label` empty) holding every scene of this
  > session on its line, filed or not, in played order. Absent or true reads as a timeline (a host that
  > predates it).

## Files owned

- `src/lib/client/components/sessionPage/requests/historyEntries.ts`
- `src/lib/client/components/sessionPage/requests/historyEntries.test.ts`
- `src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts`

## What to build

### 1. `requests/historyEntries.ts`

- `readChronicle(deps, earlierLimit, answering = false)`: a third parameter. Its doc line: *true on the
  `history-entries` answer path: with the timeline off it reads no history entries and no lines.*
  `answerHistoryEntries` passes `true`; `start-history-entry` and `compile-history-entry` call it with two
  arguments and keep reading exactly as today (do not edit those files).
- `const timeline = reading.timeline !== false` (the `sessions:storyClock` reply's `timeline`; it is
  `Partial`, so absent = a timeline).
- Every answer carries `timeline` (a boolean), including the early `empty` return for a guest and for no
  lorebook (put it in `empty`).
- When `!timeline`, `clock` is a well-formed `StoryClockV1` with no present: `{ present: null, label: "", own:
  false, linePresent: null, linePresentLabel: "", behind: false }` (on every path). `deps.noteStoryClock` and
  `deps.noteStoryCalendar` are called exactly as today.
- When `!timeline && answering` (after the guest / no-lorebook return):
  - `deps.readHistory` and `deps.readLines` are NOT called; `currentRow` is null;
  - `current: null`, `scenes: []`, `earlier: []`, `earlierTotal: 0`;
  - `unfiledDays`: exactly one group `{ date: null, label: "", scenes }` where `scenes` is every scene of this
    session (the existing `scenes` filter by `sessionId`) on its line (`(s.branchId ?? null) === branchId`),
    **filed or not** (ignore `historyEntryId`), sorted by the existing `order` map (played order), through the
    existing `sceneOf`. Do NOT use `unfiledScenesByDay` on this path (it drops filed scenes, sorts by id and
    groups by date);
  - the open scene's `since` is `""`;
  - `openScene`, `summaryMode`, `unsummarizedScenes`, `ungraphedScenes` (the `extendCountsOf` counts) and
    `opensScenes` exactly as today; `readOpenScenes` is still read.
- With the timeline on, or `answering` false, everything is as today apart from the `timeline` field (and, with
  `answering` false and the timeline off, the no-present clock).
- Add one 🚧 bullet to the module doc: with the timeline off the answer reads no history entries or lines and
  lists every scene of this session on its line in played order, as one group; start-history-entry and
  compile-history-entry still read them (the server refuses them with its own sentence).

### 2. `requests/historyEntries.test.ts`

Read the file's existing deps fixtures first and reuse them. Existing tests that compare whole answers may now
need `timeline: true` added to their expectations: add it, change nothing else in them. New tests (in a
`describe("🚧 a lorebook with no timeline", …)`):
- the storyClock reply has `timeline: false`, owner: `readHistory` / `readLines` never called; answer has
  `timeline: false`, `current: null`, `scenes: []`, `earlier: []`, `earlierTotal: 0`, `clock.present: null`,
  `clock.label: ""`; `unfiledDays` is one group with `date: null`, `label: ""` holding the session's scenes on its
  line in played order — **including a scene filed under a history entry**, excluding another session's scene and
  another line's scene; the open scene's `since` is `""` while `readOpenScenes` returned a non-empty `since`.
- `timeline: true` and `timeline` absent from the reply: `timeline: true` on the answer and the history read as
  before.
- a guest (`isOwner: false`) with `timeline: false`: `timeline: false`, a clock with no present, history never
  asked.
- `readChronicle(deps, 0)` (no third argument) with `timeline: false` still calls `readHistory` and `readLines`
  (what start-history-entry and compile-history-entry rely on).

### 3. `remoteChronicle.dom.test.ts`

Reuse `mountChronicle`, `ANSWER`, `part`, `text`, `kinds`. New tests (each `{ timeout: 120_000 }`, like the file's):
- **timeline off, owner:** answer `{ ...ANSWER, timeline: false, current: null, scenes: [], earlier: [],
  earlierTotal: 0, clock: <no present>, unfiledDays: [{ date: null, label: "", scenes: [two scenes] }] }`: no
  `clock` part, no `now` part, no `unfiled` part, no `earlier` part; a `note` part with text
  `This lorebook keeps no timeline, so there are no dates here.`; a `scenes` section with two `scene` rows; its
  `open` button pressed asks `open-lore` with params `{ lorebookId: 4, scope: "scenes" }` (no `sceneId`).
- **timeline off, guest:** `ownerOnly: true`, viewer `GUEST`: no `clock` part; the texts of the `note` parts
  include `This session's scenes are its lorebook owner's to read.`.
- **a flip redraws:** an `answer` function reading a `let timeline = true`; mount (clock part present); set
  `timeline = false`; `await view.event({ kind: "story:moved" })`, wait 300 ms, `await view.settle()` (as the
  existing story:moved test does); the clock part is gone and the note shows; flip back to true, the same
  again, and the clock part is back.

## Running the tests

One file at a time, each only after checking that no vitest is running
(`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` prints nothing) and no `npm run sdk:test` is running
(`pgrep -af "sdk-tests|node --test" | grep -v pgrep` prints nothing; if busy, wait a minute and check again):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/components/sessionPage/requests/historyEntries.test.ts > plans/chronicle-timeline-request.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/components/sessionPage/requests/startHistoryEntry.test.ts src/lib/client/components/sessionPage/requests/compileHistoryEntry.test.ts > plans/chronicle-timeline-start.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts > plans/chronicle-timeline-remote.log 2>&1"
```

Read each log with `tail -40` (never pipe vitest itself into anything). All must pass. The second command runs
two files you must not edit: if one fails because of your change, fix it in `historyEntries.ts`, never in them.
