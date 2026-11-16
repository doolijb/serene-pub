# BRIEF — `timeline-b` worker 5 — Timeline off: three follow-ups (the update outlet's date checks, the entry pool's route, the reading line)

Supervisor: lane `timeline-b`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TypeScript, Drizzle +
PGlite, Vitest 4 + happy-dom). Use absolute paths. `src/lib/server/pipelines/runtime/host.ts` (13k lines),
`lorebooks/EntryWorkspace.svelte` (2.4k) and `lorebooks/LorebooksWorkspace.svelte` (3.4k) are very large: search by
name, read ranges, re-read the region right before each edit, never reformat. Client paths are under `src/lib/client/`.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; do not run one.)
- Never `kill -9`. No migration, nothing under `../serene-pub-sdk`. A peer session edits widget files and another
  lane works in this checkout: touch nothing outside **Files owned**. Worker 6 edits `docs/*` and `NOMENCLATURE.md`
  at the same time.

## Background

A lorebook has a 🚧 **Timeline** switch (`lorebooks.timeline_enabled`, wire `timelineEnabled`, default on). Off, the
book is read as it stands now, written undated, keeps no history and its story time does not move; nothing dated is
deleted. Owner, 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines
aren't enabled". Earlier workers built the server rule's leftovers and the screens; three gaps remain.

On the client the one source of truth is `BookData.timelineEnabled` (`lorebooks/bookData.svelte.ts`, `getBookData()`;
true when not known) and `bookTimeline()`. `EntryWorkspace.svelte` already reads it (worker 4, comments marked
`🚧 No timeline`). `LorebooksWorkspace.svelte` holds `timelineOn` (~321), `momentRead` (~324) and `shownRoute`
(~328–350): with the switch off, a route naming the History scope or a history entry draws the default view, and no
moment is read; **the route itself is left alone**, so switching back on brings it back.

## Rules

- Hidden means render nothing; with the switch on, every screen and every write is exactly as today (assert it).
- Server: "Inside `db.transaction(async (tx) => …)` use only `tx`." Read the switch only through
  `lorebooks/timeline.ts` (here: `line.reading.timelineOff`, which `sessionReadingOf` already carries).
- Client: no `toaster` in views; `socket.off` always with the handler; `SvelteSet`/`SvelteMap`; no
  `crypto.randomUUID`. It is a session, never a chat. Comments state the rule, not the story; mark them 🚧.
- No new copy, names, props or settings. If you need one, stop and say so.
- Tests: only your files, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-b-w5-<n>.log 2>&1"`
  from the repo root, one run at a time. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
  if a run is up, wait and check again each minute (never `pgrep -f "vitest run"` in a loop). Never pipe vitest into
  `head`. An int test that opens a DB inside an `it` takes a 60 s timeout. Then
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-b-w5-tsc.log 2>&1`; report only errors
  in your files. Do not run `npm run check` or `npm test`. Never pass a happy-dom element to `expect`; assert booleans
  and strings.

## Files owned (only these)

`src/lib/server/pipelines/runtime/host.ts` (the update outlet's history re-date checks ~12403–12447 only) ·
`src/lib/server/pipelines/runtime/host.timelineOff.int.test.ts` · `lorebooks/EntryWorkspace.svelte` (its route reads
only) · `lorebooks/entryWorkspace.timeline.dom.test.svelte.ts` (and its fixture `lorebooks/EntryWorkspaceFixture.svelte`
if needed) · `lorebooks/LorebooksWorkspace.svelte` (`readingWhere` ~1067–1080 only) ·
`lorebooks/lorebooksWorkspace.timelineOff.dom.test.svelte.ts`.

## Build

1. **The update outlet's date checks** (`host.ts` ~12403–12447, inside the `update-lore-entry` outlet): a history
   entry "moved" to another day runs `assertDateLands`, `assertHistoryDateFree`, `assertRedateKeepsLines` before
   `changeLoreEntry`. With the session's timeline off, `changeLoreEntry` (~2461) drops the date parts
   (`line.reading.timelineOff === true`), so these checks must not run and must not refuse the rest of the change:
   add `line.reading.timelineOff !== true` to the `moved` condition (~2409–2412 of that block, beside `!held`). Test
   in `host.timelineOff.int.test.ts` (beside the case "a change to a history entry drops its date parts and keeps the
   rest", ~321): with the switch off, an update moving a history entry onto a date another history entry already holds
   still writes the rest of the change (name/content) and keeps the stored date; with it on, the same update is
   refused as today.
2. **The entry pool's route** (`EntryWorkspace.svelte`, `route = $derived(loreRoute.route)` ~363 and its readers
   ~588–598, ~928–930, `momentDate` ~1023, ~1306, ~2281): with the switch off, (a) no moment is read (treat
   `route.moment` as absent everywhere in this file), and (b) a route whose `entryId` names a history entry (and no
   `sceneId`) selects nothing: the pool opens on its default view, as the shell draws it. Derive one local effective
   route in this file from `loreRoute.route` and `book.timelineEnabled` (mirroring the shell's `shownRoute`
   ~328–350) and point those readers at it; never write the route back. Test (extend
   `entryWorkspace.timeline.dom.test.svelte.ts`): off, a route to a history entry opens no editor for it and a route
   moment is not read; on, both as today.
3. **The reading line** (`LorebooksWorkspace.svelte` `readingWhere` ~1067–1080): with the switch off, the
   " as of ‹session clock›" part is not said (the clock is ignored while the book has no timeline); the line part is
   as today. Test (extend `lorebooksWorkspace.timelineOff.dom.test.svelte.ts`) off and on.

## Done means

The tests above pass, plus the existing suites of the files you touched that you can find quickly
(`grep -l` the function or component in `*.test.ts`), and `tsc` clean in your files.

## Report — `plans/briefs/REPORT-timeline-b-w5.md` (if the Write tool refuses a report file, put the whole report in your final message)

Changed files with line ranges; tests run with results and log paths; each assumption; **Noticed, not done**.
