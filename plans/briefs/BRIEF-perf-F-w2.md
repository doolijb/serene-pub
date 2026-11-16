# BRIEF — perf-F worker w2 — explicit icon maps where the icon names are a closed set

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (the
supervisor reads it); write no report file.

## Goal

`import * as Icons from "@lucide/svelte"` followed by a **computed** lookup (`Icons[name]`, `(Icons as any)[name]`)
stops Rollup tree-shaking lucide, so the whole icon set (a 2.24 MB chunk) ships in the entry. A static member
(`Icons.X`, `<Icons.X />`) is fine. Replace computed lookups with an **explicit name → component map** holding exactly
the icons that site can be asked for, built from **named** imports (`import { Users, Settings } from "@lucide/svelte"`).
Every icon drawn stays the same, including each site's fallback (`?? Icons.Boxes` and the like).

## Step 1: classify every site (report the table)

All computed lookups on the client (grep `grep -rnE "(Icons|Lucide)( as [a-zA-Z<>]+)?\)?\[" src/lib/client src/routes`):

AdminView.svelte:111 · admin/sections/history/Page.svelte:278 · history/IdPage.svelte:93 · defaults/Page.svelte:643 ·
pipelines/SlugPage.svelte:585 · overview/Page.svelte:353 · shell/JumpOverlay.svelte:258 ·
connections/DownloadsView.svelte:125 · sessionLayout/sessionLayoutModel.svelte.ts:350 ·
sessionLayout/editorMembership.svelte.ts:115 · connections/JobsGrid.svelte:126 · connections/connectionTypeIcon.ts:69 ·
connections/ConnectionCard.svelte:75 · connections/ManagedConnectionView.svelte:387 · connections/ModelRow.svelte:148 ·
connections/DefaultsLedger.svelte:69 · loadouts/LoadoutsLedger.svelte:28 · loadouts/LoadoutsGrid.svelte:25 ·
sidebars/ConnectionsSidebar.svelte:1666 · sidebars/ConnectionServicePicker.svelte:179 ·
connections/ConnectionRow.svelte:104 · connections/OnnxEndpointView.svelte:136 · sessionPage/pressRouting.svelte.ts:620 ·
surfaces/Panel.svelte:149 · surfaces/SurfaceGrid.svelte:338,402

Classify each, with file:line evidence for where the key comes from:
- **CLOSED**: every value the key can take is a literal in a client or shared code table you can point to (the
  admin nav table `src/lib/client/shell/adminNav.ts`, `ACTION_ICON`, `OUTPUT_KIND_ICONS`, a local `TABS` / `TILE`, an
  overview card list).
- **SERVER**: the name arrives in a server payload. Say where the server gets it, if you can find it quickly.
- **OPEN**: the name comes from a plugin, genre, widget, layout or action declaration (any lucide name a package may
  declare: the SDK documents `icon` as "a lucide kebab name").

## Step 2: convert only the CLOSED sites

- For a site whose keys are the admin nav table (AdminView, and JumpOverlay when its items are only adminNav items):
  create `src/lib/client/shell/adminNavIcons.ts` exporting `ADMIN_NAV_ICONS`, the name → component map of exactly the
  icons `adminNav.ts` uses. Add `src/lib/client/shell/adminNavIcons.test.ts`, which asserts every item in every
  `adminNav` group resolves to a component in the map, so a new nav item without an icon fails a test. Do **not** edit
  `adminNav.ts` (not yours). Its doc comment that mentions `Icons[item.icon]` goes in your report as a follow-up.
- Every other CLOSED site gets a local map in its own file, next to the table it serves.
- Replace `import * as Icons` with named imports in each converted file, **only if** no computed lookup is left in
  it. Static uses (`Icons.X`) become the named import (`X`). Watch for local names that clash with an icon name
  (`History`, `Map`, `Image`, `Link`, `Lock`, `Database`, `Ticket`…): alias the import (`History as HistoryIcon`).
- `src/routes/+layout.svelte`: its `import * as Icons` is used only as `<Icons.X size={16} />` (~482). Make it a
  named import.
- Leave SERVER and OPEN sites untouched. They go in the supervisor's report as a question for the owner.

## Files owned (edit only these)

`src/lib/client/admin/AdminView.svelte`, `src/routes/+layout.svelte`, the CLOSED sites among the list above, the new
`src/lib/client/shell/adminNavIcons.ts` and its test, and tests beside the files you change. **Do not touch**
`src/lib/client/components/sessionPage/SessionHostViews.svelte`, `pressRouting.svelte.ts`, `Layout.svelte`, or any
SERVER/OPEN site. These files may hold other sessions' uncommitted work: re-read before editing, change only the icon
lines, and never revert anything.

## Rules that bind (quoted)

- Owner 2026-11-13: "change how often, never what." Every icon shown, fallback included, is unchanged.
- Lane ruling: "★P7 (lazy-loaded views) is unruled: no view becomes lazy in this lane." No `import()` of icons.
- CLAUDE.md Decisions: no new setting, flag, user-facing name or label. Map constant names are internal; list them.
- No markup or styling change beyond swapping the component reference.

## Stop and ask when

A site you'd call CLOSED has a key you can't prove is in the table; a converted site would change a drawn icon; you'd
need a file outside the owned list.

## Done means

- The classification table in your report.
- `npx vitest run src/lib/client/shell/ src/lib/client/admin/` green (say if a path holds no tests), plus any test
  beside a file you changed.
- `npx prettier --check` on every changed file. `npx tsc --noEmit -p . 2>&1 | grep -E "<each changed file's basename>"`
  prints nothing new. `npx svelte-check --threshold error 2>&1 | grep -E "<changed basenames>"` prints nothing new
  (if svelte-check over the whole tree is too slow, say so and skip it).
- Do not run `npm run build`; the supervisor measures the bundle.
- Report: classification table, changed files, map names, tests with results, follow-ups.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`; don't run one.)
- Never pipe vitest into `head`.
- Never `git checkout` / `restore` / `stash` in either repo.
