# BRIEF lay-W — three visual bugs the owner found (2026-11-06)

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-lay-common.md` (its rules are absolute: every test/tsc/check inside the memory-capped `systemd-run` scope; never hand a DOM node to an assertion), PLAN `plans/PLAN-session-layout-simplify-2026-11-05.md` §3, and `plans/REPORT-lay-{B,C,D}-2026-11-05.md` incl. their fix sections (what changed in widgets, the runtime and CSS). STYLE-GUIDE §2.8, §5.3, §6.16 (Author's note, Scene Portraits, Stats parts) and §9 a11y by line range.

## Owner's words (2026-11-06)
"Character image widgets don't render properly. Scenario widget is missing styling. Cursor behavior (i.e. pointer) not working correctly."

## Leads (verify, don't trust)
1. **Character images** = Scene Portraits, especially the common layout's **Last character** / **Last persona** panels (`scene-portraits#character` / `#persona`, Fit, Stage arrangement, one face) and the Stats Characters sheet portrait. Suspect the new Fit measuring in `src/lib/client/sessionLayout/ZoneColumn.svelte` (want = the widget root's content height; a root whose height comes from `block-size:100%` / absolute positioning / a picture that loads later measures 0 → the panel is treated as EMPTY and hidden (lay-D-fix), or only grows) and `zoneHeights.ts` floors. Also check the faces sheet's two-column CSS (`stats.faces-sheet[data-sheet]`, lay-C) and any portrait CSS scoped under the removed `[data-sp-backing]` / `messages.root` rules.
2. **Scenario styling**: lay-B added `authors-note.scenario` / `authors-note.scenario-text` (+ its own Save / Discard / *Unsaved changes*) to `AuthorsNoteWidget.svelte`; `src/lib/client/styles/widgets.css` has NO rule for them (grep confirms 0). Style them exactly like the note's own field/label/text/actions (`authors-note.field`, `.label`, `.text`, `.save` … ≈widgets.css:6384–6460), one look for both sections.
3. **Cursor**: interactive things in session widgets / panels don't show the right cursor. Find which (tab buttons, chips, faces, widget buttons, panel cards, the zone switch, the editor canvas cards…) and why — candidates: CSS rules lay-C deleted with the `[data-sp-backing]` block or `.empty` rules, `pointer-events` changes in `ZoneColumn` (`.zone-cell.empty`), PanelTabs rewrite, a host-element (`sp-*`) cursor rule lost, an overlay (zone column / empty cell absolutely positioned) sitting on top of real controls and stealing the pointer. Compare with `git diff` of widgets.css and the sessionLayout files.

## How
Reproduce each in a browser FIRST on an isolated dev instance (memory `reference_isolated_dev_instance_recipe`: own port, scratch data dir under your scratchpad, never :5173 — the owner's server may be up; stop with SIGTERM, never kill -9). Build a Story session with two characters + a persona and a few lines (drive the app's socket from the page: memory `reference_drive_the_app_socket_from_the_page` — `typedSocketOrNull()` has `emit` only; read results by navigating). If the app won't boot because another programme (cv-*) is mid-edit, report that with the log lines and stop; never edit their files. Screenshot before/after into `.playwright-mcp/lay-W-*.png`. Fix, then confirm in the browser at 1440×900 and 390×844.

## Files owned
`src/lib/client/styles/widgets.css`, `src/lib/client/sessionLayout/{ZoneColumn.svelte,zoneHeights.ts,PanelTabs.svelte,SideMount.svelte,SessionLayoutRender.svelte}` and their tests; SDK `../serene-pub-sdk/core-catalog/components/shared/{scene-portraits,stats,authors-note}/**` and `components/genres/story/authors-note/**` and their sdk-tests — only if the fix belongs there. If you touch SDK component source, run `npm run sdk:build` ONLY when `pgrep -af "vite dev"` shows no server on :5173 (inside a capped scope), else report "blocked on your dev server". Stop your own walk instance before building.

## Done means
Each bug reproduced, root-caused (file:line), fixed and confirmed in the browser; targeted tests green in capped runs (add a test per fix where one can catch it). Final message = report: per bug cause → fix → evidence (screenshot names); changed files; tests; anything not done.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
