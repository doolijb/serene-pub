# BRIEF — `timeline-b` worker 4 — Timeline off: entries, cast, links and places hides, and the Scenes list

Supervisor: lane `timeline-b`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TypeScript, Tailwind 4,
Skeleton 5, Vitest 4 + happy-dom). Use absolute paths. `lorebooks/EntryWorkspace.svelte` (2.4k lines),
`lorebooks/CastWorkspace.svelte` (2.2k) and `lorebooks/cast/CastMemberForm.svelte` are large: search by name, read
ranges, re-read the region right before each edit, never reformat. Client paths are under `src/lib/client/`.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; do not run one.)
- Never `kill -9`. Nothing under `../serene-pub-sdk`, no server file. A peer session edits widget files (`PluginFrame`,
  `widgetWire`, `sessionPageProjections`, SDK surfaces), and worker 3 of this lane edits `LorebooksWorkspace.svelte`,
  the lens registry, `scopes.ts`, `looseEnds.ts` at the same time: touch nothing outside **Files owned**.

## Background

A lorebook has a 🚧 **Timeline** switch (`lorebooks.timeline_enabled`, wire `timelineEnabled`, default on). Off, the
server reads the book as it stands now (it drops any moment), writes nothing dated (a dated held change waits, a
history day is not written, a compile and filing a scene under a history entry are refused, a pipeline's re-date of a
history entry is dropped), and its story time does not move; nothing dated is deleted. Book settings has the switch
(worker 2). Worker 3 hides, in the shell: the moment bar (the line chip stays alone when there is a second line), the
Time and Lives lenses, the History scope in the rail and in All's count, routes to history, the Loose ends time
chores, and makes the workspace read at now (no moment) while off.

**The one source of truth on the client** (`lorebooks/bookData.svelte.ts`, built by worker 2):
`BookData.timelineEnabled` (true when not known) via `getBookData()`, and `bookTimeline(): { readonly value: boolean }`
(true outside the workspace — use this in any component that can be mounted outside `LorebooksWorkspace`, e.g. in a
session page or a test, where `getBookData()` throws). **Every hide reads that one value**; no component reads a
lorebook row's `timelineEnabled` itself.

Owner rulings this builds (quote them in your report where they decide something):
- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled";
  "No history entries for undated lorebooks, maybe scenes only. We can surface a list view purely for scenes, and add
  a history divider and link when enabled".
- Standing: nothing is deleted by the switch.
- Cold review correction (rules over the lane brief): "**the member Timeline tab is not hidden**
  (`lorebooks/CastWorkspace.svelte` ~840, ~2036–2046; `lorebooks/cast/MemberTimeline.svelte` lists the scenes a member
  is in). With the switch off it keeps its label and its scenes and drops dates and anything about 'later'."

## Rules (quoted from CLAUDE.md, STYLE-GUIDE.md and the lane brief)

- **Hidden means render nothing**: no disabled controls, no explanations in their place. **With the switch on, every
  screen is exactly as today** (assert it in the DOM tests).
- **Stop and report rather than decide** when a hide would also remove something that is not a time control, or when
  you would need a word, label or sentence this brief does not give. Then hide nothing there and say so.
- "Sockets: one domain context per event family is the only listener and the only place that toasts; views never
  call `toaster`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." No
  `crypto.randomUUID`, no `navigator.clipboard`. It is a session, never a chat. No other product's name in any file.
  Comments state the rule, not the story. Mark each hide's comment 🚧 (e.g. `// 🚧 No timeline: …`).
- STYLE-GUIDE §10: sentence case; "Counts live in the copy where they help … not as badges"; "No filler".
- Tests: only your files, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-b-w4-<n>.log 2>&1"`
  from the repo root, one run at a time. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
  if a run is up (worker 3 or another session shares this checkout), wait and check again each minute (never
  `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. Then
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-b-w4-tsc.log 2>&1`; report only errors
  in your files. Do not run `npm run check` or `npm test`. A failing `assert` on a happy-dom element has OOM-killed
  VS Code: assert on booleans and strings (`!!el`, `el?.textContent`), never pass an element to `expect`.

## Files owned (only these)

`lorebooks/EntryWorkspace.svelte` · `lorebooks/EntryPool.svelte` · in `lorebooks/sections/`: `index.ts`,
`EntryInspector.svelte`, `HistoryListActions.svelte`, `HistoryUnfiledGroup.svelte`, `HistorySceneList.svelte`, and the
scene files the Scenes list needs (`SceneRow.svelte`, `SceneEditor.svelte`, `SceneForm.svelte`, `unfiledScenes.ts`,
only where a time control or date lives) · `lorebooks/time/DatedEntryPanel.svelte` · `lorebooks/CastWorkspace.svelte` ·
`lorebooks/cast/CastMemberForm.svelte` · `lorebooks/cast/PresencesPanel.svelte` · `lorebooks/cast/MemberTimeline.svelte`
· `lorebooks/graphs/RelationshipFields.svelte` · `lorebooks/places/PlaceLinks.svelte` · new DOM tests beside these and
existing tests of them you extend. Not yours: `LorebooksWorkspace.svelte`, `lenses/*`, `LensTrack.svelte`,
`scopes.ts`, `looseEnds.ts`, `time/AmendmentList.svelte` and `time/MomentBar.svelte` (hide them at their mounts),
`bookData.svelte.ts`, `BookSettings.svelte`, any server file, `NOMENCLATURE.md`, `docs/*`.

## Build — with the switch off (and with it on, exactly as today)

1. **History**
   - The History door in the new-entry picker (`EntryWorkspace.svelte` `creatableDoors` ~628–635 and its doors from
     `sections/index.ts` ~199–230): not offered.
   - **Add the next date in sequence** (`sections/HistoryListActions.svelte` ~91–97): not drawn.
   - Every compile control: `sections/HistoryUnfiledGroup.svelte` (*Not yet compiled* and its **Compile**, ~75–101),
     `sections/HistorySceneList.svelte` **Compile to Entry** (~191–197), `sections/EntryInspector.svelte`'s Scenes tab
     (~192–200: for a history entry it holds `HistorySceneList`), `time/DatedEntryPanel.svelte` **Recompile** (~205;
     check where the panel is mounted: if only inside the Time lens, which worker 3 hides, say so and leave it).
   - Existing history entries are **hidden from the pool lists and search results** of the lorebook screens (All,
     any list that would draw them), not deleted. The rows still arrive; they are filtered out where drawn.
2. **Dated changes**
   - **Save as of** / **Change the base** (`EntryWorkspace.svelte` ~2003–2085; `canAmend` ~998, ~2136) and the cast
     form's equivalent (`cast/CastMemberForm.svelte` `datedPrimary` ~396–401, **Save as of** ~1902–1943, and any
     "change them outright" / later-count line tied to them): not drawn; the plain **Save** stays and writes in place.
   - `time/AmendmentList.svelte` at both mounts (`EntryWorkspace.svelte` ~2220, `CastWorkspace.svelte` ~1926): not
     rendered.
   - **Off for a while…** (`EntryWorkspace.svelte` menu item ~1976–1982, its form ~1815–1830): not drawn.
3. **Other dated controls**
   - The relationship **When** picker (`graphs/RelationshipFields.svelte` ~198–205; its options are history entries):
     not drawn, and a link saved with the switch off carries no history entry (check what the form sends).
   - Dated place links (`places/PlaceLinks.svelte` `startsWhen` ~328–331 and its uses ~350, ~484, and any **When**
     control in the place link form): a link drawn starts undated and no When control is drawn.
   - `cast/PresencesPanel.svelte` (mount `CastWorkspace.svelte` ~1915): not rendered. If the panel holds anything that
     is not a dated presence (read it whole first), stop and report instead.
   - The member **Timeline** tab (`CastWorkspace.svelte` ~840, ~2036–2046) **stays**, label and scenes; inside
     `cast/MemberTimeline.svelte` with the switch off, drop the dates and anything about "later" (rows, words,
     sorting by date: order by the order the scenes were played instead).
4. **Scenes** (the Scenes scope's list, section `scenes` in `sections/index.ts` ~367–387, drawn by
   `EntryWorkspace.svelte` / `EntryPool.svelte`; scenes arrive by `scenes:listByLorebook`)
   - Switch **off**: the list shows the book's scenes in the order they were played (find how a scene's order is
     known: its session's message ids, `openedAtMessageId`, or its id; say which you used), with no compile control
     and no dates, and no "filed under a history entry" picker or link in the scene editor (`SceneEditor.svelte` /
     `SceneForm.svelte`) — the server refuses saving one with the switch off.
   - Switch **on**: as today, plus, at the end of the Scenes list, a **History** divider with a link to the History
     scope and the count of history entries: the divider is one control reading **History** with the count as its
     figure (a `ListGroupLabel`-style row, `lorebooks`' existing list-group label component; find it), which opens the
     History scope through the same navigation the rail uses (`loreRoute.navigate`, find the scope action); its
     `title` 🚧 *Open History*. **If today's Scenes list already shows a way to History with its count in another
     form, keep today's, build nothing, and report it.**

## Done means

DOM tests, all passing (new files beside the components; model on existing tests:
`lorebooks/lenses/lensMounts.dom.test.svelte.ts`, `lorebooks/cast/memberTabs.dom.test.ts`,
`lorebooks/cast/presencesPanel.dom.test.ts`, `lorebooks/cast/castMemberFormLater.dom.test.ts`,
`lorebooks/relationships.store.dom.test.svelte.ts`, `lorebooks/sections.test.ts`, and any `grep -l` hit for the
component): with the switch off each item of 1–3 is absent, the member Timeline tab is there without dates, and the
Scenes list per 4; with it on each is present exactly as today (and the History divider with its count). Mount
through `bookDataContext(staticBookData(() => ({ …, timelineEnabled: false })))` where a component reads BookData.
Also re-run the existing suites of the files you touched. `tsc` clean in your files.

## Report — `plans/briefs/REPORT-timeline-b-w4.md`

Changed files; tests run with results and log paths; each hide and where; **each place a hide was not possible or
would have removed something that is not a time control, and why**; each assumption (the scene order used); any
label or sentence you needed and did not add; **Noticed, not done** (including anything for worker 3).
