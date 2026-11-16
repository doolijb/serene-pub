# BRIEF — `timeline-b` worker 3 — Timeline off: the lorebook workspace's shell hides (moment bar, lenses, History scope, Loose ends)

Supervisor: lane `timeline-b`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TypeScript, Tailwind 4,
Skeleton 5, Vitest 4 + happy-dom). Use absolute paths. `lorebooks/LorebooksWorkspace.svelte` is 3.4k lines: search by
name, read ranges, re-read the region right before each edit, never reformat. Client paths are under `src/lib/client/`.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; do not run one.)
- Never `kill -9`. Nothing under `../serene-pub-sdk`, no server file. A peer session edits widget files (`PluginFrame`,
  `widgetWire`, `sessionPageProjections`, SDK surfaces), and worker 4 of this lane edits `EntryWorkspace.svelte`,
  `EntryPool.svelte`, `lorebooks/sections/*`, the cast, graph and place components at the same time: touch nothing
  outside **Files owned**.

## Background

A lorebook has a 🚧 **Timeline** switch (`lorebooks.timeline_enabled`, wire `timelineEnabled`, default on). Off, the
server reads the book as it stands now (it drops any moment it is passed), writes nothing dated, keeps no history,
and its story time does not move; nothing dated is deleted. Book settings has the switch now (worker 2).

**The one source of truth on the client** (built by worker 2, `lorebooks/bookData.svelte.ts`):
`BookData.timelineEnabled` (provided by `LorebooksWorkspace.svelte`'s `setBookData` from the open book's row; true
when not known) and `bookTimeline(): { readonly value: boolean }` (true outside the workspace). **Every hide reads
that one value**; no component reads `book.timelineEnabled` itself (inside `LorebooksWorkspace.svelte`, derive one
local `timelineOn` from the same expression the provider uses, or read it back through the provider, and use only
that).

Owner rulings this builds (quote them in your report where they decide something):
- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled";
  "No history entries for undated lorebooks, maybe scenes only. We can surface a list view purely for scenes, and add
  a history divider and link when enabled".
- 2026-11-14: "The line chip shows whenever a second line exists; lines are untouched by the flag."
- Standing: nothing is deleted by the switch.

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
- Follow the existing hide pattern of advanced controls: `lenses/registry.ts` `lensesShown(advanced)` /
  `lensShown(lens, advanced)` (~154–167) and `lorebooksWorkspace.hiddenLens.dom.test.svelte.ts` ("a route naming
  Graph or Lives draws List while the switch is off — the route itself is left alone, so the switch brings the lens
  back. No navigation, no toast.").
- Tests: only your files, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-b-w3-<n>.log 2>&1"`
  from the repo root, one run at a time. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
  if a run is up (worker 4 or another session shares this checkout), wait and check again each minute (never
  `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. Then
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-b-w3-tsc.log 2>&1`; report only errors
  in your files. Do not run `npm run check` or `npm test`. A failing `assert` on a happy-dom element has OOM-killed
  VS Code: assert on booleans and strings (`!!el`, `el?.textContent`), never pass an element to `expect`.

## Files owned (only these)

`lorebooks/LorebooksWorkspace.svelte` (not the `setBookData` provider's existing fields, which are worker 2's and
done) · `lorebooks/time/MomentBar.svelte` (only if needed) · `lorebooks/lenses/registry.ts` ·
`lorebooks/LensTrack.svelte` · `lorebooks/scopes.ts` · `src/lib/shared/lorebooks/loreRoute.ts` (only if a route
fallback needs it) · `lorebooks/looseEnds.ts` · `lorebooks/LooseEndsQueue.svelte` (only if needed) ·
`lorebooks/LoreRail.svelte` and `lorebooks/ScopePopout.svelte` (only if needed) · new DOM/unit tests beside these and
existing tests of them you extend. Not yours: `EntryWorkspace.svelte`, `EntryPool.svelte`, `lorebooks/sections/*`,
`CastWorkspace.svelte`, `cast/*`, `graphs/*`, `places/*`, `bookData.svelte.ts`, `BookSettings.svelte`, any server file,
`NOMENCLATURE.md`, `docs/*`.

## Build — with the switch off (and with it on, exactly as today)

1. **The moment bar** (`LorebooksWorkspace.svelte` snippet `momentBar` ~2871–2892, mounted ~3289 and ~3303;
   `time/MomentBar.svelte`): not rendered. **The line chip stays when the lorebook has a second line**
   (`branches.length > 0`; `MomentBar.svelte` ~70–75 says when it draws its chip): render `time/BranchChip.svelte`
   alone where the bar was, with the props the bar passes it (~287 in `MomentBar.svelte`: `lorebookId`, `branches`,
   `branchId`, `comparing`, `onBranch`, `onCompare`, placement opening upward as the bar's does). With one line,
   nothing is rendered there. The compare-lines view stays.
2. **No moment is read.** With the switch off the workspace reads at now: the moment it uses everywhere (the
   resolver, the roster, the counts) is null whatever `route.moment` says; the route itself is left alone, so
   switching back on brings it back. The roster (`roster` snippet ~2764–2775, `time/RosterPopover.svelte`) stays (who
   is in the world is not a time control) and gets no moment (it then reads "In the world now"). Do not edit
   `RosterPopover.svelte`; if a sentence inside it is time noise, name it under Noticed.
3. **The Time lens and the Lives lens** (`lenses/registry.ts` ~96–126): not offered by the lens track
   (`LensTrack.svelte`), not reachable by their shortcuts (`lensForKey` ~266), and a route naming either draws the
   default lens (`DEFAULT_LENS`) with the route left alone — extend `lensesShown` / `lensShown` / `lensForKey` with a
   second argument for the timeline, as advanced does. Every other place that offers **Open timeline** from the shell
   (`openLens("time")`, the moment bar's `onOpenTimeline`) is gone with the bar; check for any other.
4. **The History scope** (`src/lib/shared/lorebooks/loreRoute.ts` `LORE_SCOPES` ~28–36, `lorebooks/scopes.ts`
   `railScopes` ~187): not listed in the rail or the compact scope popout, and its figure is not counted in **All**'s
   (`countOf` ~170–180 sums every pool kind: leave history out of it when off). A route naming the History scope, or
   a direct link to a history entry (`#lore=<id>/history…` or a node that is a history entry), draws the lorebook's
   default view (the default scope and lens) with the route left alone. **Scenes stays a scope of its own** in the
   rail (it already is one in `LORE_SCOPES`; check nothing nests it under History when off). Worker 4 hides history
   rows inside the pool lists and the History door in the new-entry picker; you do the scope, the counts and the
   routes. If search results across the book are computed in the shell (`search` ~303, the find row), leave history
   entries out of them when off; if they are computed in `EntryWorkspace`, name it for worker 4 under Noticed.
5. **Loose ends**: the three time chores (`looseEnds.ts` `undated-history`, `doubled-history-date`,
   `history-before-fork`, ~42–90, ~202–240) are neither listed nor counted (the queue, its count in the shell, and any
   badge). Every other chore as today. Take the switch as an argument of the function that builds the list (a pure
   function stays pure).
6. **Lines** are untouched: the compare view, the line chip's Fork/Rename/Delete, and the reading's line as today.

## Done means

DOM/unit tests, all passing, modelled on `lorebooks/lorebooksWorkspace.hiddenLens.dom.test.svelte.ts`,
`lorebooks/lorebooksWorkspace.counts.dom.test.ts`, `lorebooks/scopes.test.ts`, `lorebooks/looseEnds.test.ts`,
`lorebooks/lensTrackAdvanced.dom.test.svelte.ts`:
- switch off: no moment bar; the line chip alone with a second line, nothing with one line; no Time or Lives in the
  lens track; a route naming Time or Lives draws the default lens; no History in the rail; All's count leaves history
  out; a route to the History scope or a history entry draws the default view; a moment in the route is not read;
  Loose ends lists and counts none of the three time chores;
- switch on: each of those exactly as today (bar drawn, lenses offered, History listed and counted, chores listed).
Also re-run the existing suites of the files you touched (`lorebooksWorkspace.*`, `scopes.test`, `looseEnds.test`,
`lensTrackAdvanced`, `loreRail.dom.test`, `crosstalk.dom.test`, `lineConformance.screens.dom.test`, `markers.test`, and
any other `grep -l` hit for a function you changed). `tsc` clean in your files.

## Report — `plans/briefs/REPORT-timeline-b-w3.md`

Changed files; tests run with results and log paths; each hide and where; **each place a hide was not possible or
would have removed something that is not a time control, and why**; each assumption; any label or sentence you
needed and did not add; **Noticed, not done** (including anything for worker 4).
