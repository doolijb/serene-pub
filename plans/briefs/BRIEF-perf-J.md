# BRIEF — lane `perf-J` — the client entry: lazy views, curated icons, lazy icons

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `.claude/guides/review.md` §2. Plan:
`plans/PLAN-performance-2026-11-13.md` — Part 1, W6 rows, Part 3 **rulings table** (★P7 and ★P15 are ruled, the
original recommendations under it are history), §4.2b row perf-J. Build on `plans/REPORT-perf-F-2026-11-13.md`
step 4 (19 closed-set icon maps already explicit; 5 OPEN sites remain; bundle numbers to beat).
`STYLE-GUIDE.md`: read the sizes/icons and loading-state sections before touching any visible element.

## The rulings (owner, 2026-11-13)

- **★P7:** sidebars, Admin and Library views, `CustomThemeEditor`, `CodeField` and the TipTap fields load on
  first open. The first-open beat uses the shell's **existing** loading affordance (find it: what the shell shows
  while a route's data loads) — **no new spinner**.
- **★P15:** a **curated set** of icon names stays static in the entry; **every other** lucide name a plugin, genre,
  widget or layout declares is loaded **lazily per icon** (`@lucide/svelte/icons/<kebab>` — 6,796 per-icon
  modules exist in `node_modules/@lucide/svelte/dist/icons`). While it loads, a **minimal same-size placeholder**
  (an empty box with the icon's width and height, no spinner, no animation) so nothing shifts. An unknown name shows
  the existing fallback for that site, silently. **No warning**, not in the UI, not in the console.

## What to build

1. **Curated set.** Enumerate: every name the 19 closed-set maps already import, plus every icon name core's own
   genres, widgets, layouts and surfaces declare (grep `icon:` across `../serene-pub-sdk/core-catalog`,
   `src/lib/server/pipelines`, `src/lib/client/sessionLayout`, `src/lib/shared/widgets`). That list, as named
   imports, is the static set — one module (name per §24; it is not an "icon map", perf-F's maps are per site).
   List it in the report with where each name is used, and add a test that fails if a listed name is unused or a
   core declaration names an icon outside the list.
2. **Lazy icon component.** One Svelte component (name per §24; grep first — `LazyIcon`, `DeclaredIcon`,
   `IconByName` are candidates; check §22 Icons for the canon word) taking a kebab name and the usual size props:
   static set → render at once; else dynamic `import()` of the per-icon module with the placeholder box until it
   resolves; module missing → the site's fallback. Memoise resolved modules in a module-level `Map` (a memo of
   immutable modules, not state — say so in a comment). Replace the five OPEN sites (`sessionLayoutModel.svelte.ts:350`,
   `editorMembership.svelte.ts:115`, `surfaces/Panel.svelte:149`, `surfaces/SurfaceGrid.svelte:338,402`,
   `sessionPage/pressRouting.svelte.ts:620`) and remove `import * as Icons from "@lucide/svelte"` from the entry
   path entirely. Where a site resolves to a component *value* passed around (not rendered in place), the lazy
   component is what is passed.
3. **Lazy views.** `{#await import()}` for `CustomThemeEditor`, `CodeField`, the TipTap fields; sidebars, Admin
   and Library views by active view in `Layout.svelte` / `AdminView.svelte` / `routes/+layout.svelte`. Keep the
   shell's nav reactivity (memory `feedback_no_watch_instance_breaks_sveltekit_page_reactivity`; the shell must know
   the user before pages mount, `feedback_shell_must_know_user_before_pages_mount`). The peer session asked that
   `HANDLED_ERROR_EVENTS` in `Layout.svelte:133` keep room for an `entries:earmark:error` entry it may add — do
   not reshape that set.
4. **Chunking.** If Vite emits one chunk per lazy icon (expected ~6,800 tiny files on a full-glob import), prefer an
   explicit per-name `import()` (Vite then emits only the chunks reachable at build time — which, for an open set,
   means a glob is required). Use `import.meta.glob("/node_modules/@lucide/svelte/dist/icons/*.svelte")` with
   `{ eager: false }` only if a plain dynamic template import does not resolve; measure the chunk count and total
   bytes either way, and report both. `vite.config.ts` may be touched only for `build.rollupOptions.output.manualChunks`
   or `chunkSizeWarningLimit`, and perf-L also edits that file later — keep your edit to one contiguous block.
5. Measure with `npm run build` (not under a running dev server): `build/client/_app/immutable/nodes/0.*.js`,
   the largest chunk, total entry JS raw and gz, chunk count. Before and after, in the report.

## Rules you quote into every worker brief

- P1: a lazy icon shows the same icon the static one did; the placeholder is the same size. P5: no new setting.
- STYLE-GUIDE sizes: icons are 14/16/20 px at the sites they already are; the placeholder takes the same box.
- A11y: the placeholder is `aria-hidden`; the rendered icon keeps whatever label the site gives it today.
- NOMENCLATURE §1 R1–R6, §22 Icons, §24, §25 append for the component and the curated-set module.
- Svelte 5 runes; `$state(new Map())` is not reactive (the memo above is deliberately not state).
- No `crypto.randomUUID`, no `navigator.clipboard`.
- Do not touch the 19 closed-set maps perf-F made except to import from the curated module if that removes a
  duplicate import; ★P16 ruled their reformat stays.

## Files owned

`src/lib/client/components/Layout.svelte`, `src/lib/client/admin/AdminView.svelte`, `src/routes/+layout.svelte`,
`src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts`, `src/lib/client/sessionLayout/editorMembership.svelte.ts`,
`src/lib/client/components/surfaces/Panel.svelte`, `src/lib/client/components/surfaces/SurfaceGrid.svelte`,
`src/lib/client/components/sessionPage/pressRouting.svelte.ts`, a new `src/lib/client/components/icons/` folder
(the lazy component, the curated set, their tests), the lazy-loading wrappers for the editors/fields where they are
mounted (list each in the report), `vite.config.ts` (one contiguous block, see 4), `STYLE-GUIDE.md` (one line if
a rule moves), `NOMENCLATURE.md` §25 (append only), `docs/session-layout.md` if a visible behaviour moves.

## Out of scope

Any new spinner or loading copy; warnings; a plugin-facing icon API or manifest field; icon packs other than lucide;
changing which icon any site shows; touching `sessionStore`, `widgetWire`, `RemoteWidget` (perf-H's).

## Stop and ask when

CLAUDE.md §Decisions applies; the shell has no loading affordance that fits (then propose one ★, do not invent);
a lazy view breaks nav reactivity in a dom test; the chunk count after step 4 exceeds ~2,000 files (report, ask).

## Done means

- Tests: curated-set test (unused/unlisted name fails); lazy component dom test (static name renders at once; lazy
  name shows a same-size placeholder then the icon; unknown name shows the fallback; two mounts of one lazy name
  import once); each lazy view mounts on first open in a dom test where one exists today; `headerBackTakes.dom`,
  `layoutHandledErrors`, `sessionLayout*`, `surfaces*`, `pressRouting*`, `adminNavIcons`, `outputKindIcons` green.
- `npx tsc --noEmit -p .` clean on touched files; `npx prettier --check` on each; `npm run build` green with the
  numbers in the report.

## Report

`plans/REPORT-perf-J-2026-11-13.md`: changed files, the curated list with uses, bundle numbers before/after,
chunk count, tests with counts, open ★, **Noticed, not done**.

Every worker brief carries verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
