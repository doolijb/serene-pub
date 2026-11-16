# BRIEF — perf-J worker w1 — curated icon set + lazy per-icon resolver, five OPEN sites

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (the
supervisor reads it); write no report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Five client sites look up **any** lucide name a plugin, genre, widget or layout declares with
`(Icons as any)[name]` on `import * as Icons from "@lucide/svelte"`. A computed lookup stops Rollup tree-shaking, so
the whole 2.25 MB icon set ships. Owner ruling **★P15 (2026-11-13), verbatim:** "Curated list static in the entry +
lazy per-icon import for every other declared name, a minimal fixed-size placeholder while loading so nothing
shifts. **No warning.**"

Build three modules and one component in a new folder `src/lib/client/components/icons/`, then switch the five sites.

### 1. `curatedIcons.ts` — the **curated icon set**

`export const CURATED_ICONS: Record<string, Component>` keyed by lucide **export name** (`BookOpenText`), values
from **named** imports (`import { BookOpenText, … } from "@lucide/svelte"`; alias an import whose name clashes with
a global such as `Map`, `History`, `Image`). Doc comment: what it is (the names drawn at once, with no wait), why
(★P15), what it is not (not an icon map for one site; perf-F's per-site maps stay where they are).

Its contents, exactly the union of:

- **(a)** the icon components that are **values** in the closed-set icon maps perf-F made (only the map values, not
  other static icon uses in those files). The files: `src/lib/client/shell/adminNavIcons.ts`,
  `src/lib/client/admin/sections/history/Page.svelte`, `…/history/IdPage.svelte`, `…/defaults/Page.svelte`,
  `…/pipelines/SlugPage.svelte`, `…/overview/Page.svelte` (all under `src/lib/client/admin/sections/`),
  `src/lib/client/components/shell/JumpOverlay.svelte`, and under `src/lib/client/components/`:
  `connections/{DownloadsView,JobsGrid,ConnectionCard,ManagedConnectionView,ModelRow,DefaultsLedger,ConnectionRow,OnnxEndpointView}.svelte`,
  `connections/connectionTypeIcon.ts`, `loadouts/{LoadoutsLedger,LoadoutsGrid}.svelte`,
  `sidebars/{ConnectionsSidebar,ConnectionServicePicker}.svelte`. Read each map; list the values.
- **(b)** every icon name core **declares**, found by scanning (exclude `*.test.*`, `dist/`, `node_modules/`)
  `/home/jody/github/serene-pub-sdk/core-catalog/src`, `/home/jody/github/serene-pub-sdk/core-catalog/components`,
  `src/lib/server/pipelines`, `src/lib/client/sessionLayout`, `src/lib/shared/widgets` for:
  `icon: "x"` / `icon: 'x'` / `"icon": "x"` literals, and `<sp-icon … name="x"` literal attributes (core widgets draw
  through `sp-icon`; their names belong in the set so a later `SpIcon` switch draws them at once).
  Normalise a kebab name to its export name the way the app does (`split("-")`, capitalise each part, join:
  `book-open-text` → `BookOpenText`); an export name passes through. Drop any name that is not a lucide export and
  list it in your report.

### 2. `lucideIconModules.ts` — the per-icon loaders

```ts
const modules = import.meta.glob([
  "/node_modules/@lucide/svelte/dist/icons/*.js",
  "!/node_modules/@lucide/svelte/dist/icons/index.js"
])
export async function loadLucideIcon(exportName: string): Promise<Component | null>
```

Build (lazily, once) a `Map<exportName, loader>` from the glob keys: file `arrow-down-0-1.js` → `ArrowDown01` with
the same split/capitalise/join (the supervisor checked: over all 1,803 files this reproduces exactly the 1,799 export
names of the barrel, aliases included; the four collisions such as `arrow-down-01`/`arrow-down-0-1` re-export the
same icon). The barrel also exports `LucideX` and `XIcon` forms of every icon; accept them by stripping a leading
`Lucide` or a trailing `Icon` when the bare name is known. Unknown → `null`. **No warning, no console output.**
This module must be reached **only** through a dynamic `import("./lucideIconModules")` from the resolver, so its
~1,800-entry map is its own chunk and never in the entry. Doc comment says so.

### 3. `declaredIcon.svelte.ts` — `declaredIconOf(name, fallback)`

```ts
export function declaredIconOf(name: string | undefined | null, fallback: Component<any>): Component<any>
```

- falsy name → `fallback`.
- `CURATED_ICONS[name]` (after the same `Lucide`/`Icon` strip) → that component, synchronously.
- else: a module-level `const resolved = new Map<string, Component | null>()` — **a memo of immutable modules, not
  state; say so in a comment** (`$state(new Map())` is not reactive on mutation anyway). Hit → the component, or
  `fallback` when `null`. Miss → start the load once per name (a second module-level `Map<string, Promise<…>>` of
  in-flight loads, so two sites asking for one name import once), and return `DeclaredIconPlaceholder`.
- When a load settles, bump one module-level `$state` counter that `declaredIconOf` reads, so a template, a
  `{@const}` or a `$derived` that called it re-runs and swaps the placeholder for the icon (or the fallback). A load
  that rejects counts as unknown (`null`). The resolver takes the name **verbatim** (no kebab conversion: the
  layout/panel sites look up export names verbatim today and must keep showing the fallback for a kebab name;
  `pressRouting` converts kebab first, see below).

### 4. `DeclaredIconPlaceholder.svelte`

The minimal same-size placeholder: an empty `<svg>` with lucide's box — `width={size} height={size}` (`size`
default 24, as lucide's `Icon.svelte`), `xmlns`, `viewBox="0 0 24 24"`, the caller's other props spread (so
`class="size-4"`, `style`, `width`/`height` overrides give the same box), and then `aria-hidden="true"` with any
`aria-label`, `title` or `role` the caller passed dropped. No children, no animation, no spinner.

### 5. The five sites (replace the computed lookup, keep every fallback)

- `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts:350` `iconOf` → `declaredIconOf(p.icon, LayoutPanelTop)`.
- `src/lib/client/sessionLayout/editorMembership.svelte.ts:115` `trayIcon` → `declaredIconOf(t.icon, LayoutPanelTop)`.
- `src/lib/client/components/surfaces/Panel.svelte:149` → `declaredIconOf(instance.icon, instance.role === "primary" ? MessagesSquare : LayoutPanelTop)`.
- `src/lib/client/components/surfaces/SurfaceGrid.svelte:338` and `:402` → `declaredIconOf(inst.icon, LayoutPanelTop)`.
- `src/lib/client/components/sessionPage/pressRouting.svelte.ts:620` `actionIcon` → keep its kebab → PascalCase step,
  then `declaredIconOf(pascal, Play)`.

In those five files replace `import * as Icons from "@lucide/svelte"` with named imports of the icons they use
statically (`Icons.X` → `X`; alias on a clash with a local or global name). Callers elsewhere
(`sideRailModel.svelte.ts`, `MobileLayoutEditor.svelte`, `LayoutEditorToolbar.svelte`, `SessionHostViews.svelte`)
are **not yours** and need no change: they already render the returned value as a component inside templates or
functions called from templates — confirm in your report that each call happens in a reactive context (template,
`{@const}`, `$derived`), file:line.

## Tests (new, beside the modules)

- `src/lib/client/components/icons/curatedIcons.test.ts` (unit): scans (b) as above and the files in (a) for their
  named `@lucide/svelte` imports; fails when a core-declared name is not in `CURATED_ICONS`, or when a
  `CURATED_ICONS` key is neither core-declared nor among the (a) files' named lucide imports (unused); every value
  is a function; a guard that each scan finds more than a minimum count, so a broken regex cannot pass green.
- `src/lib/client/components/icons/lucideIconModules.test.ts` (unit): a non-curated canonical name (e.g. `Anchor`),
  an alias (`AlarmCheck`), `HouseIcon` and `LucideHouse` resolve to a component; `NoSuchIcon` and `""` resolve to
  `null`.
- `src/lib/client/components/icons/declaredIcon.dom.test.svelte.ts` (dom project; a small fixture component
  `DeclaredIconFixture.svelte` that renders `{@const Icon = declaredIconOf(name, fallback)}<Icon size={16} … />` is
  fine), with `vi.mock("./lucideIconModules", …)` controlling a deferred promise and counting calls:
  a curated name renders the icon at once; a non-curated name first renders an empty svg 16×16 with
  `aria-hidden="true"`, then the icon after the promise resolves (`await tick()` / `flushSync`); an unknown name ends
  on the fallback; two mounts of one lazy name call the loader once.
- Run, capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/client/components/icons src/lib/client/sessionLayout src/lib/client/components/surfaces src/lib/client/components/sessionPage/pressRouting* src/lib/client/shell/adminNavIcons.test.ts src/lib/client/components/outputKindIcons.test.ts`
  (expand the globs to real files if vitest wants paths). Report counts.
- `npx tsc --noEmit -p .` — report only errors in your files. `npx prettier --check` on every file you touch.

## Files owned (edit only these)

New: everything under `src/lib/client/components/icons/`. Edit: the five site files above. Nothing else — not
perf-F's maps, not `SpIcon.svelte`, `ActionLegend.svelte`, `CollectSuggestions.svelte` (they hold three more open
lookups; the supervisor queues them), not `vite.config.ts`.

These files may hold other sessions' uncommitted work: re-read right before editing, change only the icon lines,
never revert anything. `sessionLayoutModel.svelte.ts`, `Panel.svelte`, `SurfaceGrid.svelte` were prettier-unclean
before you: format only your own lines by hand and never run `prettier --write` on them.

## Rules that bind (quoted by the supervisor)

- P1: a lazy icon shows the same icon the static one did; the placeholder is the same size. P5: no new setting.
- STYLE-GUIDE §7: "Icons are lucide, stroke 1.6, on the 24px grid: 20px on the rail, 18px in menus and rows, 16px
  inline beside text, 14px for a badge" — icons stay the sizes they are at each site; the placeholder takes the same box.
- A11y: the placeholder is `aria-hidden`; the rendered icon keeps whatever label the site gives it today.
- NOMENCLATURE §22 I4: "App-side tables and widget manifests use the export name verbatim (`'HeartPulse'`); the SDK's
  trigger and action declarations use kebab-case … an export name passes through unchanged and an unknown name draws
  nothing". §24: grep a new name first. Your new names are exactly: `CURATED_ICONS` / `curatedIcons.ts` (the curated
  icon set), `declaredIconOf` / `declaredIcon.svelte.ts`, `loadLucideIcon` / `lucideIconModules.ts`,
  `DeclaredIconPlaceholder.svelte`, and the test fixture. No others. The supervisor writes the §25 ledger entry.
- Svelte 5 runes; `$state(new Map())` / `new Set()` are not reactive on mutation (the memo is deliberately not state).
- No `crypto.randomUUID`, no `navigator.clipboard`. No warning in the UI or console for an unknown name.
- Do not touch the 19 closed-set maps perf-F made.

## Stop and ask (in your report) when

A site's fallback or drawn icon would change; a caller renders the returned value outside a reactive context;
`import.meta.glob` over `/node_modules/...` does not resolve in vitest; you would need a name not listed above.

## Verbatim

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
- You do not need `sdk:build` or `npm run build`; don't run either.

## Report

Changed files; the curated list (name → where each is used/declared, file:line or file); names dropped as non-lucide;
the reactive-context confirmation per caller; tests with counts; tsc/prettier results; anything noticed, not done.
