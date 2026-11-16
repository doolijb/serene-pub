# REPORT — lane `perf-J` — the client entry: lazy views, curated icons, lazy icons — 2026-11-13

Brief: `plans/briefs/BRIEF-perf-J.md`. Worker briefs: `BRIEF-perf-J-w1.md` (icons), `BRIEF-perf-J-w2.md` (views),
scope review `BRIEF-perf-J-scope.md`. Rulings applied: ★P7, ★P15 (owner, 2026-11-13).

## Headline

The entry's static graph fell from **7.74 MB raw / 1.92 MB gz to 3.98 MB raw / 0.71 MB gz** (−49 % / −63 %): every
sidebar, Admin and Library view, TipTap, CodeMirror and the theme editor left it. **The whole lucide set did not.**
It is still in the entry (`chunks/DfDIPQrF.js`, 2.18 MB raw / 146 kB gz, 1,435 icons) because of a sixth open
lookup the brief and perf-F's classification missed: `hostElements/SpIcon.svelte:14`
(`(Icons as unknown as Record<string, unknown>)[pascal(attrs.name)]`), statically reached through
`routes/+layout.svelte:22 → hostElements/registry.ts:28`. Two more such lookups sit on the session page
(`sessionPage/ActionLegend.svelte:48`, `sessionPage/CollectSuggestions.svelte:33`). perf-F's grep pattern
(`(Icons|Lucide)( as [a-zA-Z<>]+)?\)?\[`) cannot match `as unknown as Record<…>`. None of the three files is in this
lane's brief → **★J1** below; each is a two-line switch to `declaredIconOf`, and the curated set already holds every
core `<sp-icon name>` literal for exactly that.

## Changed files

New (`src/lib/client/components/icons/`; the folder pre-existed with the two vendor marks):
- `curatedIcons.ts` — `CURATED_ICONS`, the **curated icon set** (148 names, named imports).
- `declaredIcon.svelte.ts` — `declaredIconOf(name, fallback)`: curated → that component at once; else a plain
  module-level `Map` memo of loaded modules (commented: a memo of immutable modules, not state), an in-flight `Map`
  so one name imports once, one `$state` counter bumped when a load settles so the calling template / `{@const}` /
  `$derived` re-reads; unknown or failed → the site's fallback. No warning, no console output.
- `lucideIconModules.ts` — `loadLucideIcon(exportName)` over `import.meta.glob("/node_modules/@lucide/svelte/dist/icons/*.js", !index.js)`,
  keyed by the barrel's own file→export rule (checked: reproduces all 1,799 export names incl. aliases); accepts the
  `LucideX` / `XIcon` spellings the barrel also exported. Reached only by dynamic `import()`.
- `DeclaredIconPlaceholder.svelte` — empty `<svg>` in lucide's own box and attribute order (`{...rest}`, then
  `width/height={size}`, class `lucide-icon lucide …`), `aria-hidden="true"`, caller's `aria-label`/`title`/`role`
  and lucide paint props dropped. No children, no animation.
- Tests: `curatedIcons.test.ts`, `lucideIconModules.test.ts`, `declaredIcon.dom.test.svelte.ts` + `DeclaredIconFixture.svelte`.

The five OPEN sites (each now named imports + `declaredIconOf`, every fallback unchanged):
`sessionLayout/sessionLayoutModel.svelte.ts` (`iconOf`), `sessionLayout/editorMembership.svelte.ts` (`trayIcon`),
`components/surfaces/Panel.svelte` (`IconCmp` `$derived`), `components/surfaces/SurfaceGrid.svelte` (two
`{@const}`), `components/sessionPage/pressRouting.svelte.ts` (`actionIcon`, kebab→Pascal step kept). Callers that
render the returned value (not edited) all do so reactively: `ArrangeCanvas.svelte:384`,
`MobileLayoutEditor.svelte:607,678,919`, `LayoutEditorToolbar.svelte:789`, `SessionHostViews.svelte:533`.

Lazy views (the "lazy-loading wrappers … where they are mounted"):
- `components/Layout.svelte` — the `{#snippet sidebarView}` chain: all 16 branches (`AdminView`, `LibraryView`, 14
  sidebars) are `{#await import()}` → `<LoadingState />` → `{:then { default: X }}` (original names, props, binds
  and comments kept) → `{:catch}{@render viewLoadFailed()}`; 16 static imports gone, `LoadingState` imported,
  `{#snippet viewLoadFailed()}` added. `HANDLED_ERROR_EVENTS` untouched (the `sessions:fireTurn:error` entry in the
  diff is another session's earlier work).
- `routes/+layout.svelte` — `HelpSidebar` in the `startupError && isDocsRoute` branch, same shape.
- `components/CustomThemeManager.svelte` — the `CustomThemeEditor` mount.
- `components/pipelines/SchemaForm.svelte` — the JSON field's `CodeField` mount (the one edge that kept CodeMirror in
  the entry: `Layout → PipelineReviewModal → SchemaForm → CodeField`); `schemaFormObject.dom.test.ts` +1 case.
- `admin/AdminView.svelte` — read, unchanged: its sections already load by `import()`; its static imports are small
  shell pieces.

Docs: `STYLE-GUIDE.md` §7 one sentence (a declared icon outside the curated set draws an empty box of its size
until it loads). `NOMENCLATURE.md` — one §25 bullet appended at the file's end (lane perf-J). `docs/session-layout.md`
unchanged (a plugin panel icon arriving a beat late is not a behaviour a reader acts on). `vite.config.ts` unchanged.

## Decisions taken (inside the brief; named so they can be undone)

1. **No single "lazy icon component taking a name".** A component value passed around cannot carry a bound name
   through Svelte 5's public API; the brief's value sites (`iconOf`, `trayIcon`, `actionIcon`) hand components to
   files outside the lane. So the lazy unit is the resolver `declaredIconOf`, which returns the curated component, the
   placeholder (then the loaded icon via one reactive counter), or the fallback. Same behaviour, no wrapper, callers
   untouched. Scope review: accept.
2. **Resolver takes the export name verbatim**; `pressRouting` keeps its own kebab step. The layout/panel sites
   looked names up verbatim before, so a kebab name there still draws the fallback (P1: no site changes icon).
3. **Curated set includes core's `<sp-icon name="…">` literals** besides `icon:` literals (both are names core's
   widgets declare), so the ★J1 SpIcon switch draws core icons at once.
4. **The first-open beat is `LoadingState`** (STYLE-GUIDE §6.7 "Loading is `LoadingState` … never a blank pane"),
   default props, no delay — the existing affordance; no new spinner or words. `ShellLoading` was not used: it draws
   the whole shell before the user is known, not a pane.
5. **A failed chunk load** (stale chunk after an update) shows `AdminView`'s existing block verbatim (sentence +
   **Reload**), with `p-4` added because the sidebar pane has no inset of its own (AdminView's sits in a `mx-5`
   wrapper). Field-level reuse is ★J3.
6. **Per-mount wrapping stopped at two mounts** — see ★J2.

## Curated list (148 names) with uses

Generated by `perf-J-uses.mjs` (scratchpad) with the test's own scan; "map:" = a perf-F closed-map file whose named
lucide imports carry it (the test's "used" rule); other entries are the core files declaring it (`icon:` or
`<sp-icon name>`). Every name has at least one use; none was dropped as non-lucide (three are lucide aliases:
`AlertTriangle`, `CheckSquare`, `Loader2`).

| Name | Where (core declaration files; "map:" = a perf-F closed-map file importing it) |
|---|---|
| Activity | map: shell/adminNavIcons, map: components/connections/ManagedConnectionView |
| AlertTriangle | core-catalog/components/shared/messages/SessionMessage |
| Archive | core-catalog/components/shared/state/SlotControl |
| Armchair | core-catalog/components/shared/messages/SessionComposer |
| ArrowDown | core-catalog/components/shared/messages/SceneDivider, core-catalog/components/shared/state/ListEditor |
| ArrowLeft | core-catalog/components/shared/messages/SessionComposer, map: components/connections/ManagedConnectionView |
| ArrowLeftRight | map: components/connections/ModelRow |
| ArrowRight | map: admin/sections/history/IdPage, map: components/connections/ConnectionCard, map: components/connections/ConnectionRow |
| ArrowUp | core-catalog/components/shared/messages/SceneDivider, core-catalog/components/shared/state/ListEditor |
| AudioLines | map: admin/sections/defaults/Page, map: components/connections/JobsGrid, map: components/connections/ManagedConnectionView, map: components/connections/DefaultsLedger +3 more |
| Ban | core-catalog/components/shared/messages/SessionComposer |
| Bed | core-catalog/src/genres/dungeon-crawler/rest, core-catalog/src/genres/story/rest |
| Blocks | map: shell/adminNavIcons |
| BookCheck | core-catalog/components/shared/messages/SessionContainer |
| BookImage | core-catalog/src/registry/widgets |
| BookMarked | core-catalog/components/shared/messages/MessageControls, map: components/shell/JumpOverlay |
| BookOpen | core-catalog/src/registry/widgets, core-catalog/components/shared/state/SlotControl, map: components/shell/JumpOverlay |
| BookOpenText | core-catalog/src/genres/story/narrate, core-catalog/components/shared/messages/NextCharacterBlock, core-catalog/components/shared/messages/SessionMessage, core-catalog/components/shared/turn-order/TurnOrderWidget |
| Box | map: components/connections/DownloadsView |
| Boxes | map: admin/sections/defaults/Page, map: components/connections/JobsGrid, map: components/connections/ConnectionCard, map: components/connections/DefaultsLedger +3 more |
| Braces | map: shell/adminNavIcons |
| Brackets | map: shell/adminNavIcons |
| Brain | core-catalog/components/shared/messages/MessagePartsView, map: components/connections/ManagedConnectionView |
| BrainCircuit | core-catalog/components/shared/messages/MessagePartsView, core-catalog/components/shared/messages/SessionMessage |
| Cable | map: shell/adminNavIcons, map: components/shell/JumpOverlay, map: components/connections/OnnxEndpointView, map: components/connections/connectionTypeIcon +1 more |
| Calendar | core-catalog/src/registry/widgets, core-catalog/components/shared/messages/SessionContainer |
| CalendarClock | core-catalog/components/shared/chronicle/ChronicleWidget |
| CalendarPlus | core-catalog/components/shared/messages/SceneDivider |
| Check | core-catalog/components/shared/messages/MessageBlocksView, core-catalog/components/shared/messages/SceneDivider, core-catalog/components/shared/state/SlotControl, map: components/sidebars/ConnectionServicePicker |
| CheckSquare | core-catalog/components/shared/messages/MessagesWidget |
| ChevronDown | core-catalog/components/shared/messages/MessagePartsView, core-catalog/components/shared/messages/SessionComposer, core-catalog/components/shared/messages/SessionContainer, core-catalog/components/shared/messages/SessionMessage +1 more |
| ChevronLeft | core-catalog/components/shared/messages/SessionMessage |
| ChevronRight | core-catalog/components/shared/chronicle/ChronicleWidget, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/SessionMessage, core-catalog/components/shared/state/PieceCard +4 more |
| ChevronsDown | core-catalog/components/shared/messages/SessionMessage, map: admin/sections/history/Page |
| ChevronsUp | core-catalog/components/shared/messages/SessionMessage |
| ChevronUp | core-catalog/components/shared/messages/TurnLine, map: components/connections/ManagedConnectionView |
| CircleArrowUp | map: shell/adminNavIcons |
| CircleOff | core-catalog/components/shared/lore-entries/LoreEntriesWidget |
| Clapperboard | map: admin/sections/defaults/Page, map: components/connections/JobsGrid, map: components/connections/DefaultsLedger, map: components/loadouts/LoadoutsLedger +1 more |
| ClipboardCheck | core-catalog/components/shared/messages/TurnLine |
| ClipboardList | core-catalog/src/registry/widgets, core-catalog/components/shared/annex/AnnexWidget |
| Clock | core-catalog/src/shared/timePasses |
| Cloud | map: components/connections/connectionTypeIcon |
| CloudSun | core-catalog/src/registry/widgets, core-catalog/components/shared/messages/SessionMessage |
| Compass | core-catalog/src/genres/lair/nudge |
| Cpu | map: components/connections/DownloadsView, map: components/connections/connectionTypeIcon |
| Database | map: shell/adminNavIcons, map: admin/sections/overview/Page |
| Dices | core-catalog/src/genres/lair/roll, core-catalog/src/genres/lair/rollAnswer, core-catalog/components/shared/messages/MessageBlocksView, core-catalog/components/shared/messages/SessionContainer |
| Diff | map: admin/sections/pipelines/SlugPage |
| DoorOpen | core-catalog/src/genres/lair/roomAnswer |
| Download | core-catalog/components/shared/messages/MessageMediaStrip, map: admin/sections/overview/Page, map: components/connections/DownloadsView, map: components/connections/ManagedConnectionView +1 more |
| Drama | core-catalog/src/shared/speakMessage, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/SpokenLine |
| Ear | core-catalog/src/genres/lair/whisper |
| Ellipsis | core-catalog/components/shared/messages/SceneDivider, core-catalog/components/shared/messages/SessionComposer, core-catalog/components/shared/messages/SpokenLine, core-catalog/components/shared/scene-portraits/ScenePortraitsWidget +1 more |
| EllipsisVertical | core-catalog/components/shared/messages/MessageComposer, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/SessionComposer |
| ExternalLink | core-catalog/components/shared/chronicle/ChronicleWidget, core-catalog/components/shared/messages/SceneDivider, core-catalog/components/shared/places/PlacesWidget, map: admin/sections/history/IdPage +2 more |
| Eye | core-catalog/src/genres/lair/reveal, core-catalog/src/genres/story/look, core-catalog/components/shared/messages/MessageComposer, core-catalog/components/shared/messages/SceneDivider +2 more |
| FileText | core-catalog/components/shared/session-runs/SessionRunsWidget, map: admin/sections/defaults/Page, map: components/shell/JumpOverlay, map: components/connections/JobsGrid +3 more |
| Film | core-catalog/components/shared/chronicle/ChronicleWidget, core-catalog/components/shared/messages/MessagesWidget, core-catalog/components/shared/messages/SceneDivider, core-catalog/components/shared/messages/SessionMessage |
| Flag | core-catalog/src/genres/dungeon-crawler/goal, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/MessagesWidget, core-catalog/components/shared/messages/SceneCueChip +1 more |
| FlagOff | core-catalog/components/shared/chronicle/ChronicleWidget, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/SceneDivider |
| Gauge | map: shell/adminNavIcons, map: components/connections/ManagedConnectionView |
| Ghost | core-catalog/components/shared/messages/SessionMessage |
| GitBranch | core-catalog/components/shared/messages/MessageControls |
| GitCommitHorizontal | map: admin/sections/pipelines/SlugPage |
| Globe | core-catalog/components/shared/messages/MessagesWidget, map: shell/adminNavIcons, map: admin/sections/overview/Page, map: components/shell/JumpOverlay |
| GripVertical | core-catalog/components/shared/messages/SceneDivider |
| Hammer | core-catalog/src/genres/lair/buildRoom |
| HandHelping | core-catalog/components/shared/messages/StateProposalList, core-catalog/components/shared/state/PieceCard, core-catalog/components/shared/stats/StatsWidget |
| Handshake | core-catalog/components/shared/messages/SessionMessage |
| HardDrive | map: components/connections/DownloadsView |
| HeartPulse | core-catalog/src/registry/widgets |
| History | core-catalog/src/registry/widgets, core-catalog/components/shared/messages/MessageBlocksView, core-catalog/components/shared/messages/StateProposalList, core-catalog/components/shared/stats/StatsWidget +4 more |
| Hourglass | core-catalog/components/shared/messages/NextCharacterBlock, core-catalog/components/shared/messages/StateProposalList, core-catalog/components/shared/messages/TurnLine, core-catalog/components/shared/stats/StatsWidget |
| Image | core-catalog/src/genres/story/generateImage, core-catalog/components/shared/stats/StatsWidget, map: admin/sections/defaults/Page, map: components/connections/JobsGrid +4 more |
| ImageOff | core-catalog/components/shared/album/AlbumWidget, core-catalog/components/shared/backdrop/BackdropWidget, core-catalog/components/shared/messages/MessageMediaStrip |
| Images | core-catalog/components/shared/scene-portraits/ScenePortraitsWidget |
| Info | core-catalog/components/shared/messages/MessageControls |
| LayoutTemplate | map: shell/adminNavIcons |
| ListOrdered | core-catalog/src/registry/widgets |
| ListTree | core-catalog/components/shared/session-runs/SessionRunsWidget |
| Loader2 | core-catalog/components/shared/messages/SessionContainer, map: admin/sections/defaults/Page, map: admin/sections/overview/Page, map: components/connections/ManagedConnectionView |
| Lock | core-catalog/components/shared/composer/ComposerWidget, core-catalog/components/shared/messages/SessionContainer, core-catalog/components/shared/scene-portraits/ScenePortraitsWidget, core-catalog/components/shared/state/PieceCard +2 more |
| Map | core-catalog/src/genres/lair/fileRoom, core-catalog/src/registry/widgets |
| MessageCircleQuestion | core-catalog/src/genres/story/ask |
| MessageCircleReply | core-catalog/src/genres/dungeon-crawler/interview, core-catalog/src/genres/story/answer |
| MessageSquare | map: components/shell/JumpOverlay, map: components/sidebars/ConnectionsSidebar |
| MessageSquareText | core-catalog/components/shared/messages/SessionContainer, map: shell/adminNavIcons |
| MessagesSquare | core-catalog/components/shared/messages/MessagesWidget, client/sessionLayout/editorMembership.svelte, map: shell/adminNavIcons |
| Mic | core-catalog/components/shared/messages/SpokenLine |
| Minus | core-catalog/components/shared/state/ListEditor |
| Mountain | core-catalog/src/shared/illustrateScene |
| MountainSnow | core-catalog/src/registry/widgets |
| MousePointerClick | core-catalog/src/registry/widgets, map: admin/sections/pipelines/SlugPage |
| Network | core-catalog/components/shared/chronicle/ChronicleWidget, map: admin/sections/pipelines/SlugPage |
| NotebookPen | core-catalog/src/registry/widgets, core-catalog/components/shared/messages/MessagePartsView |
| Package | map: shell/adminNavIcons, map: components/connections/ManagedConnectionView, map: components/connections/OnnxEndpointView, map: components/sidebars/ConnectionsSidebar |
| Paintbrush | core-catalog/components/shared/stats/StatsWidget |
| Paperclip | core-catalog/components/shared/messages/SessionComposer |
| Pen | core-catalog/components/shared/messages/MessageComposer |
| Pencil | core-catalog/components/shared/annex/AnnexWidget, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/state/PieceCard, map: admin/sections/history/Page +2 more |
| Pin | core-catalog/components/shared/lore-entries/LoreEntriesWidget |
| Play | core-catalog/components/shared/messages/MessageBlocksView, core-catalog/components/shared/messages/NextCharacterBlock, core-catalog/components/shared/turn-order/TurnOrderWidget, map: components/connections/ConnectionCard +2 more |
| Plus | core-catalog/components/shared/chronicle/ChronicleWidget, core-catalog/components/shared/state/ListEditor, core-catalog/components/shared/state/PieceList, map: admin/sections/history/Page +3 more |
| Puzzle | core-catalog/components/shared/messages/MessagePartsView, map: shell/adminNavIcons, map: admin/sections/overview/Page |
| Receipt | core-catalog/src/registry/widgets, core-catalog/components/shared/messages/MessageControls |
| Redo2 | core-catalog/components/shared/composer/ComposerWidget |
| RefreshCw | core-catalog/components/shared/lore-entries/LoreEntriesWidget, core-catalog/components/shared/messages/SessionMessage, core-catalog/components/shared/messages/TurnLine, core-catalog/components/shared/routine-log/RoutineLogWidget +5 more |
| RotateCcw | core-catalog/components/shared/messages/SessionMessage |
| Scale | map: shell/adminNavIcons |
| ScanText | map: admin/sections/defaults/Page, map: components/connections/JobsGrid, map: components/connections/DefaultsLedger, map: components/connections/OnnxEndpointView +4 more |
| Scissors | core-catalog/components/shared/messages/SceneDivider |
| ScrollText | core-catalog/src/genres/dungeon-crawler/reveal, map: admin/sections/pipelines/SlugPage |
| Search | core-catalog/components/shared/lore-entries/LoreEntriesWidget, core-catalog/components/shared/routine-log/RoutineLogWidget, core-catalog/components/shared/session-runs/SessionRunsWidget, map: admin/sections/pipelines/SlugPage +2 more |
| Send | core-catalog/components/shared/messages/SessionComposer |
| Server | map: components/connections/DownloadsView |
| Settings | map: shell/adminNavIcons, map: components/connections/ManagedConnectionView, map: components/connections/OnnxEndpointView, map: components/sidebars/ConnectionsSidebar |
| Settings2 | map: components/shell/JumpOverlay, map: components/connections/ModelRow |
| Shapes | map: shell/adminNavIcons |
| Shirt | core-catalog/components/shared/scene-portraits/ScenePortraitsWidget |
| Sigma | core-catalog/components/shared/state/SlotControl, core-catalog/components/shared/stats/StatsWidget |
| SkipForward | core-catalog/components/shared/messages/NextCharacterBlock |
| SlidersHorizontal | map: shell/adminNavIcons, map: admin/sections/pipelines/SlugPage, map: components/loadouts/LoadoutsGrid |
| Sparkles | core-catalog/components/shared/messages/StateProposalList, map: components/connections/JobsGrid |
| Square | core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/MessagesWidget, core-catalog/components/shared/messages/SessionComposer, core-catalog/components/shared/messages/SessionMessage +5 more |
| SquareCode | map: shell/adminNavIcons |
| SquareUserRound | core-catalog/src/registry/widgets, core-catalog/components/shared/scene-portraits/ScenePortraitsWidget |
| Tag | map: components/shell/JumpOverlay |
| Target | core-catalog/components/shared/messages/SessionMessage, map: shell/adminNavIcons, map: admin/sections/overview/Page |
| Ticket | map: shell/adminNavIcons, map: admin/sections/pipelines/SlugPage |
| Trash2 | core-catalog/components/shared/state/PieceCard, map: admin/sections/history/Page, map: admin/sections/history/IdPage, map: components/connections/ManagedConnectionView +2 more |
| TriangleAlert | map: components/connections/ConnectionCard, map: components/connections/DefaultsLedger, map: components/connections/ConnectionRow, map: components/connections/OnnxEndpointView |
| Type | map: admin/sections/defaults/Page, map: components/connections/JobsGrid, map: components/connections/DefaultsLedger, map: components/loadouts/LoadoutsLedger +2 more |
| Undo2 | core-catalog/components/shared/composer/ComposerWidget |
| User | core-catalog/components/shared/messages/MessagesWidget |
| UserPlus | core-catalog/components/shared/messages/SessionComposer |
| UserRound | core-catalog/src/genres/story/narrateCharacter, core-catalog/components/shared/attendance/AttendanceWidget, core-catalog/components/shared/scene-portraits/ScenePortraitsWidget, map: components/shell/JumpOverlay |
| Users | core-catalog/src/registry/widgets, core-catalog/components/shared/messages/NextCharacterBlock, core-catalog/components/shared/turn-order/TurnOrderWidget, map: shell/adminNavIcons +2 more |
| UsersRound | map: components/shell/JumpOverlay |
| Volume2 | core-catalog/src/shared/speakMessage, core-catalog/components/shared/messages/MessageControls, core-catalog/components/shared/messages/SessionMessage |
| VolumeX | core-catalog/components/shared/messages/SpokenLine |
| Wand | core-catalog/components/shared/chronicle/ChronicleWidget |
| Workflow | map: shell/adminNavIcons, map: admin/sections/pipelines/SlugPage, map: admin/sections/overview/Page, map: components/sidebars/ConnectionsSidebar |
| Wrench | core-catalog/components/shared/messages/MessagePartsView |
| X | core-catalog/components/shared/backdrop/BackdropWidget, core-catalog/components/shared/messages/MessageMediaStrip, core-catalog/components/shared/messages/MessagesWidget, core-catalog/components/shared/messages/SceneCueChip +8 more |
| Zap | core-catalog/src/genres/lair/trap, core-catalog/components/shared/messages/SessionMessage, map: shell/adminNavIcons, map: admin/sections/history/Page +9 more |
| ZoomIn | core-catalog/components/shared/map-canvas/MapCanvas |
| ZoomOut | core-catalog/components/shared/map-canvas/MapCanvas |

## Bundle — before / after (`npm run build`, no dev server up; script `perf-J-measure.sh`)

| | before | after |
|---|---|---|
| `nodes/0.*.js` | 2,715,145 B raw / 840,838 B gz | 383 B raw / 295 B gz (the layout node is now a stub; its code moved into shared chunks — read the entry graph row, not this one) |
| largest chunk | `nodes/0` 2,715,145 B | `QniZfim0.js` 2,259,616 B (SDK + three; not in the entry, same as before's `C-qXYZqC`) |
| largest chunk in the entry graph | `nodes/0` 2,715,145 B, then lucide 2,255,772 B | lucide `DfDIPQrF.js` 2,178,521 B (146 kB gz) — still there, ★J1 |
| **entry static graph** (`entry/*` + `nodes/0` + their static imports) | 246 files, **7,736,539 B raw / 1,919,271 B gz** | 185 files, **3,975,771 B raw / 713,549 B gz** |
| client `.js` files | 563 | 654 |
| client `.js` total raw | 18,616,494 B | 21,668,728 B |

TipTap/ProseMirror now sits in `C6IMZbny.js` (967 kB, lazy, Lorebooks); CodeMirror and every sidebar in their own
lazy chunks.

**Chunking (step 4).** A plain template `import(\`@lucide/svelte/icons/${k}\`)` cannot resolve a bare specifier at
build time, so the glob is used. While SpIcon keeps the barrel in the entry, Rollup emits **no per-icon chunks**: the
1,803 glob targets are facades over code already in the lucide chunk and land in one lazy chunk `CVOXA_h3.js`
(2,004,034 B raw, of which 1.77 MB is the facades' licence comments; **36 kB gz**) plus the loader table
`DoWhRnEl.js` (938,877 B raw, **20 kB gz**; each entry repeats Vite's preload-deps list). Both load once, on the first
non-curated name, never at startup; neither is in the entry graph. Once ★J1 lands, the barrel leaves the entry and
each icon becomes its own chunk: a standalone Vite 6.4.3 build of the same glob (scratchpad `perf-J-exp/`) emitted
**1,596 chunks, 2.75 MB total, median 1.5 kB each, loader table 266 kB raw / 51 kB gz** — under the brief's ~2,000
stop line. Not measured in the app build (two builds allowed). No `manualChunks` needed.

## Tests

- Lane run (capped, before the final whitespace/placeholder touch-ups): `icons/`, `sessionLayout/`, `surfaces/`,
  `pressRouting*`, `adminNavIcons`, `outputKindIcons`, `headerBackTakes.dom`, `layoutHandledErrors`, `railViews`,
  `adminView.dom`, `sceneRunSaidOnce.dom`, `pipelines/`, `settingsImportSection.dom`: **70 files, 826 passed, 1 failed**.
  The failure is `surfaces/panel.dom.test.svelte.ts` "a remote widget … the token arrives" (expects `['messages']`,
  gets `['message']`): perf-H's in-progress `{t:'message'}` row patch in `widgetWire.svelte.ts`, not this lane.
- Re-run after the touch-ups: `icons/`, `schemaFormObject.dom`, `railViews`, `layoutHandledErrors`: **6 files, 31 passed**.
- New: curated-set test (4: scan guard, every core name present, no unused key, all components); loader test (4:
  canonical, alias, `HouseIcon`/`LucideHouse`, unknown/empty → `null`); resolver dom test (5: curated at once; lazy
  → 16×16 empty `aria-hidden` svg then the icon; unknown → fallback; falsy → fallback; two mounts import once);
  SchemaForm JSON field shows `[role=status]` then the field.
- No dom test mounts `Layout.svelte` today, so the views' first open has no dom test (brief: "where one exists");
  `railViews.test.ts` (reads the chain as source) stays green.
- `tsc --noEmit -p .` (8 GB heap): exit 0, no errors. `svelte-check` not run (OOM risk; the lead's grouped run).
- Prettier: all new files, `editorMembership`, `pressRouting`, `+layout`, `CustomThemeManager` clean.
  `Layout.svelte`, `SchemaForm.svelte`, `sessionLayoutModel`, `Panel`, `SurfaceGrid`, `STYLE-GUIDE.md` were unclean
  before; the lane's lines are hand-wrapped so prettier's diff touches none of them.
- `npm run build`: green, twice (before/after).

## Open ★

- **★J1 — finish ★P15: switch the three remaining open lookups.** `hostElements/SpIcon.svelte:14` (fallback: draws
  nothing — pass a component that renders nothing, or keep its `{#if}` on a null check),
  `sessionPage/ActionLegend.svelte:48` (fallback `Play`), `sessionPage/CollectSuggestions.svelte:33` (fallback: none
  drawn) → `declaredIconOf(pascal, fallback)`. Recommend: add the three files to a short follow-up (one worker, ~20
  lines, plus a third `npm run build` to confirm the barrel leaves the entry). Trade-off: SDK widgets that draw a
  non-core `sp-icon` name show the empty box for a beat on first draw. Expected gain ≈ −2.0 MB raw / −125 kB gz more
  off the entry. Also fix `shell/adminNav.ts:13`'s stale `Icons[item.icon]` comment then.
- **★J2 — the other 13 field mounts.** Ten `CodeField` mounts (`rulesets/{NewPage,RulesetLibraryField,RulesetFunctionRow,RulesetDocumentField}`,
  `PluginSettingsFields`, `comfy/WorkflowEditorDialog`, `SessionSettingField`, `TemplateEditor`, `ScriptField` →
  `scripts/IdPage`) and three TipTap `LoreContentField` mounts (`DayOne`, `EntryCoreFields`, `DatedEntryPanel`) were
  **not** wrapped. They already left the entry and load on first open of the view that holds them. Wrapping each would
  add a second beat inside an opened view and touches ~18 dom tests that read `.cm-editor` / mock `LoreContentField`
  synchronously, including another session's live `lorebooks/entryEarmark.dom.test.ts`. Recommend: leave them;
  the brief named them, so the owner decides.
- **★J3 — the failure copy at field level.** `SchemaForm`'s JSON field (used by session settings, widget settings,
  connection forms, the review gate) says "This page did not load…" if CodeMirror's chunk fails. Recommend the same
  sentence with "This field did not load." — or keep the reuse. The views keep the AdminView sentence.

## Noticed, not done

- `nodes/0.*.js` is no longer a meaningful entry metric (383 B); later measurements (W9) should use the entry-graph
  number (script in scratchpad `perf-J-measure.sh`).
- `@lucide/svelte`'s per-icon files each carry a ~1 kB licence comment that survives minification (1.77 MB in the
  lazy facade chunk; ~1.4 MB in the entry's lucide chunk). `build.esbuild.legalComments` or a banner-dedupe would cut
  it; outside this lane's `vite.config.ts` allowance.
- An unknown declared name now draws the empty box for a moment before its fallback (the loader table must load to
  know); before, the fallback showed at once. Within ★P15's "placeholder while loading".
- ~350 files still `import * as Icons from "@lucide/svelte"` with static members only; those tree-shake and are not
  on the problem path. The brief's "remove it from the entry path entirely" is met for computed use in the five
  sites; `Layout.svelte` keeps the namespace for static members.
- `LoginForm`, `SetupGate`, `AccessibleShell`, `AccessibleLoginForm` stay static in `+layout.svelte` (not in ★P7's list).
- Dev mode (`vite dev`) not walked: the glob reads raw files under `node_modules/@lucide/svelte`, which Vite may also
  pre-bundle; a second copy of lucide's `Icon.svelte` in dev is harmless but a walk should confirm a plugin icon draws.
- `panel.dom.test.svelte.ts` fails on perf-H's in-progress wire change (above).

## Scope review (one round)

`scope-reviewer` on the diff against the brief: in scope; no new setting, flag, event or socket; `HANDLED_ERROR_EVENTS`
untouched by the lane; P1 holds at all five sites; §25 bullet covers the names. Findings: (1) medium — the lucide set
still ships through `SpIcon`: **accept**, raised as ★J1 and stated in the headline, W6-b not marked fully done;
(2) low — the reused failure copy reads wrong at field level, and `p-4` differs from AdminView: **accept**, ★J3, and
`p-4` named as a choice (decision 5). Deviations (resolver instead of component; two mounts only; `vite.config.ts`
untouched): accepted by the reviewer, conditional on ★J2 being raised (it is).
