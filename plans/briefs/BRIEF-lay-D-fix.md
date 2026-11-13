# BRIEF lay-D-fix — editor review follow-ups + the empty-panel band (lead-supervised worker)

You are a lane-worker. Read `plans/briefs/BRIEF-lay-common.md` (rules apply: EVERY test/tsc/check run inside the memory-capped `systemd-run` scope; never hand a DOM node to an assertion). App = /home/jody/github/serene-pub. Lane lay-F is editing docs/NOMENCLATURE/STYLE-GUIDE at the same time — never touch those.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
Never `git show HEAD:<file> > <file>` or any other whole-file restore; if prettier reformats a file, undo only your own change by hand.

Rules quoted: STYLE-GUIDE.md:414 "Touch target | 44px, everywhere a finger can land." STYLE-GUIDE §6.5 (Fit / Fill as a segmented control): "the chosen one `preset-pressed` with `aria-pressed`." Owner R10 (2026-11-05): "don't have most widgets show placeholder text when there's nothing to show" — an empty widget draws nothing.

## Items
1. **Touch size**: `src/lib/client/sessionLayout/MobileLayoutEditor.svelte` — the pushed screen's **Back** (≈:826-834) and the bar's **Layout settings** (≈:871-874) use `.medit-chip` (`min-block-size: 2.25rem`, ≈:1415). Make `.medit-chip` 2.75rem (as `.medit-seg-btn` ≈:1350), checking the bar still fits at 390px (it may wrap).
2. **Landmark names follow the content (no new copy)**: the desktop `<aside aria-label="Layout settings">` (`SessionLayoutEditor.svelte` ≈:475-477) and the phone's pushed `.medit-push` (≈:825) take their name from the inspector's own heading via `aria-labelledby` (give `ArrangeInspector.svelte`'s `<h2>` ≈:106/:129 a stable id per instance — no `crypto.randomUUID`; a module counter is fine — and expose it). Make the phone's pushed screen a named region (`role="region"` or `dialog` semantics consistent with its inert background; justify in the report).
3. **Pressed state**: the NEW Priority control on desktop (`ArrangeCanvas.svelte` ≈:566-568, CSS ≈:949-955) uses `preset-pressed` for the chosen segment (keep `aria-pressed`). Leave Fit / Fill's existing `.on` as it is (pre-existing; note it).
4. **Empty panel draws nothing**: in the live session an EMPTY Turn line panel draws a blank ~25px band (its card chrome) between Messages and the Composer. Rule: a panel whose shown widget renders no content (its measured widget root has zero content height — the existing ResizeObserver in `src/lib/client/sessionLayout/ZoneColumn.svelte`, ≈:35–:80 `wants` / `floorOf`) takes NO height, draws NO card/border/padding and adds NO gap; it stays mounted so it reappears the moment content arrives. Applies to any widget, not just Turn line (Fit panels only; a Fill panel keeps its share). Keep `allocateZone`'s contract (a 0 want with height fit → 0 px, no floor) — update `zoneHeights.ts` / `floorOf` if the 120 floor would otherwise apply, and the grid gap handling in ZoneColumn (e.g. collapse the empty track and its gap). Tests: `zoneHeights.test.ts` (fit want 0 → 0 px, no floor; a Fill neighbour gets the room) and `zoneColumn.dom.test.svelte.ts` (an empty fit panel is not drawn as a card and adds no gap; it draws when content appears).

## Files owned
`src/lib/client/sessionLayout/{MobileLayoutEditor.svelte,SessionLayoutEditor.svelte,ArrangeInspector.svelte,ArrangeCanvas.svelte,ZoneColumn.svelte,zoneHeights.ts,PanelTabs.svelte (only if the empty state needs a data attribute/CSS there)}` and their tests (`arrangeCanvas.dom`, `arrangeInspector.dom`, `zoneHeights.test`, `zoneColumn.dom`, and a mobile-editor dom test if one exists).

## Done means
Those test files + `retiredInventory.test.ts` + `panelTabs.dom.test.svelte.ts` green in capped runs; capped `npx tsc --noEmit -p .` 0 errors in your files; capped `npm run check` no new errors (the 22 in PanelRail/PanelsMenu are known). Final message = report: changed files, tests + results, anything not done.
