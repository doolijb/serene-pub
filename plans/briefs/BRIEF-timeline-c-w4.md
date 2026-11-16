# BRIEF — worker `timeline-c-w4` — client: the session page knows its lorebook's timeline

Supervisor: lane `timeline-c` (brief `plans/briefs/BRIEF-timeline-c.md`). Report to
`plans/briefs/REPORT-timeline-c-w4.md` (write it last; if the write is refused, put the whole report in your final
message).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The session page holds one value — whether the lorebook it reads keeps a timeline — re-reads it when the switch
flips, and hides the Summarize modal's history day choice when it is off (a scene summary then files under no
history entry). Then list every other story-clock, date or history control the session page shows.

Owner rulings this builds (verbatim):
- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled";
  "No history entries for undated lorebooks, maybe scenes only."
- 2026-11-13: "By default, Story Minimal will use an undated book. Messages will just display real time."
- Plan §2 (ruled): "The lorebook decides whether story time moves; the preset only picks the default for a new
  session's lorebook."
- 2026-11-13: "Do not provide SDK api for this yet": no widget, plugin or pipeline API carries the switch. **Do not
  edit the Chronicle, `sdk/src/widgets.ts`, the `history-entries` request
  (`sessionPage/requests/historyEntries.ts`) or any SDK file.**
- 2026-11-05: "There's always a lorebook." Never write "no lorebook"; say "a session whose lorebook is its own
  notes".

## What the server now gives you (built and tested)

`sessions:storyClock`'s reply (`Sockets.Sessions.StoryClock.Reading`, `src/lib/shared/sockets/types.ts` ~4609) now
has `timeline: boolean`: the attached lorebook's switch, else the notes'; `true` when the session reads no book
row. When a lorebook's switch flips, the server emits `state:changed` (scoped by `sessionId`) to every session
that reads it.

## Build

Line numbers are approximate; re-read before editing.

1. **`src/lib/client/components/sessionPage/sessionPageData.svelte.ts`**: hold the value the way `storyCalendar`
   is held (~182–187, setter ~1170–1178, getter ~1400–1404): a `{ sessionId, timeline }` state, a setter
   `setStoryTimeline(forSessionId, value: unknown)` (non-boolean reads as `true`), and a getter (name it, e.g.
   `storyTimeline`) that is `true` until read and for any other session. Doc comments 🚧.
2. **`src/routes/sessions/[id]/+page.svelte`** — the clock read (~456–472): the same `asks.readStoryClock` answer
   also calls `data.setStoryTimeline(id, r?.timeline)`. **Re-read on `state:changed`**: register through the
   page's existing inbox (`inbox`, created ~185) with `inbox.on("state:changed", …)` inside an `$effect` that
   returns the release; act only when `msg.sessionId` is the loaded session; never a socket listener in the view,
   never `socket.on`/`off` here. Coalesce: at most one read in flight; a `state:changed` that arrives meanwhile
   makes exactly one more read after it. Put the coalescing in a small testable function (in
   `sessionPageData.svelte.ts` or beside the page's existing helpers in a file you own; name it) rather than inline
   logic you can't test. Pass the value to the Summarize modal mount (~1038–1060) as `timeline={…}`. Change nothing
   else in the page.
3. **`src/lib/client/components/modals/SummarizeLoreModal.svelte`**: new optional prop `timeline?: boolean`
   (default `true`), doc comment 🚧. With it false:
   - the **History entry** block for scenes (~1094–1150, "History entry *" heading, the select and its **New**
     action) is not rendered — nothing drawn in its place;
   - `canGenerate` (~303–311) no longer requires `selectedHistoryEntryId` for a scene; `generateScene` (~723–730)
     no longer returns early without it, and `scenes:create` (~788–800) sends `historyEntryId: null` (the server
     accepts null: `src/lib/server/sockets/scenes.ts` ~322–337, ~458);
   - the history entries list need not be asked for (skip the ask when off if it is a simple guard; otherwise
     leave it).
   With it true (or left out) everything is as today.
4. **Messages**: change nothing. An unstamped message already shows its real time
   (`../serene-pub-sdk/core-catalog/components/shared/messages/SessionMessage.svelte` ~362–367); the SDK test
   `sdk-tests/conversationSceneMarks.test.ts` ~253 covers it and the server test that no stamp is written with the
   timeline off exists (`state/timelineOff.int` or `runtime/host.timelineOff.int`). Just cite them.
5. **The audit (read only, report each):** list every place on the session page and its modals that shows a story
   clock, a story date, a history entry choice or a clock control — at least: `sessionPage/CollectModal.svelte`
   (the clock step, ~21–25, ~271), `modals/ProcessSceneModal.svelte`, the Chronicle widget
   (`../serene-pub-sdk/core-catalog/components/shared/chronicle/ChronicleWidget.svelte` ~313–350), the story clock
   requests (`sessionPage/requests/storyClock.ts`), the session header and any panel the page mounts. For each:
   file:line, what it shows or offers with the timeline off today (read the code: does the server refuse the
   move with `TIMELINE_OFF_SENTENCES`, does it show empty words?), and the smallest change that would hide it.
   **Edit none of them** (not your files); the supervisor queues them. The edit form's reading
   (`SessionLorebookReading`) is another worker's.

## Tests

- The coalescing function and the re-read: `state:changed` for this session reads once; for another session not
  at all; three arriving during one read make exactly one more read; the held value follows the reply (unit or DOM
  test beside the file you put it in).
- `sessionPageData` setter/getter: true before read, false after a `timeline: false` reply, true for another
  session.
- Extend `src/lib/client/components/modals/summarizeLoreModal.writes.dom.test.ts` (its describe "the history a
  scene is filed under", ~142): with `timeline={false}` the History entry block is absent and a scene summary is
  made — `scenes:create` emitted with `historyEntryId: null`; with the timeline on the block is there as today.

How to run (from `/home/jody/github/serene-pub`, one run at a time; first check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows nothing — another worker and another session share
this checkout — and wait if one is up; never `pgrep -f "vitest run"` in a loop):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-c-w4-<n>.log 2>&1"`
Run your tests plus `summarizeLoreModal.crosstalk.dom.test.ts` and any existing `sessionPageData`/`sessionPageInbox`
tests (find them). Already failing, not yours: `sessionPage/narrateDraft.dom`. Never pipe vitest into `head`. Keep
asserts on small strings and booleans (a failing assert on a big happy-dom element can eat memory). Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors expected). Not `npm run check`, not
`npm test`.

## Files owned (edit only these)

`src/routes/sessions/[id]/+page.svelte` (the clock read, the re-read, the modal prop), 
`src/lib/client/components/sessionPage/sessionPageData.svelte.ts`,
`src/lib/client/components/modals/SummarizeLoreModal.svelte`, a new helper file under
`src/lib/client/components/sessionPage/` only if the coalescing can't sit in `sessionPageData.svelte.ts`, and test
files beside these. `sessionPageInbox.svelte.ts` only if `inbox.on` truly can't serve (say why first).

## Out of scope — never built

The Chronicle and every SDK file; `PluginFrame`, `widgetWire`, `sessionPageProjections` and the SDK
`surfaces`/`testing` packages (a peer session's files); the `history-entries` request; the start form and the edit
form; any server file; hiding anything outside the three owned files.

## Stop and ask (in your report, then stop) when

A change outside Files owned seems needed; a name beyond the prop, the setter, the getter and the coalescing
function seems needed; the server's reply does not carry `timeline`.

## Rules (quoted from CLAUDE.md and the lane brief)

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't build in this task at all.)
- "Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." Read written state inside effect-called methods through `untrack` (the page's existing clock effect shows the pattern).
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- It is a session, never a chat. No other product's name in any file. "Comments state the rule, not the story (a ratchet test counts phrases such as "no longer")."
- Never `git checkout` / `restore` / `stash`. Never `prettier --write` a directory or glob. Never `kill -9`.
- Mark every new name and sentence 🚧 and list it in your report. Decide implementation inside this scope and name
  each choice.

## Report

Changed files; each test run (files, pass/fail counts, log path); every name added (🚧); the audit table; Noticed,
not done.
