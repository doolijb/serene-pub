# BRIEF lay-C-fix — three follow-ups from lay-C's scope review (lead-supervised worker)

You are a lane-worker. Read `plans/briefs/BRIEF-lay-common.md` (rules apply: EVERY test/tsc run inside the memory-capped `systemd-run` scope, one file per run; never hand a DOM node to an assertion; 60 s timeouts for DB-in-`it`). App = /home/jody/github/serene-pub. Lane lay-D is editing the layout EDITOR files at the same time (SessionLayoutEditor, ArrangeCanvas, arrangeOps, mobileEdit, MobileLayoutEditor, presetPreview, LayoutLookSection, ArrangeInspector…) — never touch those.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

## 1. Test the tag fix (the lead already changed the server)
`src/lib/server/sockets/sessions.ts` ≈:6476–6481 now runs `processSessionTags` only `if (params.tags !== undefined)` — before, a `sessions:update` without `tags` (the Author's note Scenario save, `takeSeat`) deleted every owner tag on the session. Do NOT edit sessions.ts. Add an int test (new file `src/lib/server/sockets/sessions.updateKeepsTags.int.test.ts`, modelled on `sessions.genreFieldsMerge.int.test.ts`'s setup): an owner's session with two tags; `sessions:update { session: { id, scenario: 'x' } }` → scenario saved AND both tags still there; then `sessions:update { session: { id }, tags: [] }` → tags cleared (explicit empty list still means none).

## 2. Close the style-value injection in `declaredWidgetBox`
`src/lib/client/sessionLayout/panelBacking.ts` ≈:51–58 reads `--sp-widget-margin/-background/-radius/-border` from a style's raw css/vars and writes them INLINE on the PanelTabs root (outside the skin scope), checking only `/[;{}<]|url\(/i`. The app's style filter in `src/lib/client/stores/widgetStyles.svelte.ts` (≈:717–818: `stripBreakout` → `filterUrls` → `filterImageSets`; see the comment ≈:521–524 on `image-set()` bare strings) is stricter. Export the value-level filter from widgetStyles (a small exported function; don't change its behaviour) and run each of the four values through it; DROP any value the filter changed (and still drop `;{}<`). Tests in `panelBacking.test.ts`: `image-set("https://host/x.png" 1x)` dropped; escaped `u\72 l(` dropped; `url(` dropped; a plain colour / `transparent` / `none` / `0` / `var(--x)` kept.

## 3. Zone switch name + degenerate case
`src/lib/client/sessionLayout/ZoneSwitch.svelte` ≈:38–42: give the `role="group"` an accessible name, `aria-label="Zone shown"` (lead's ★ wording; list it for the ledger). `sessionZones.svelte.ts` ≈:99: the switch is on only while at least TWO zones are available (a lone **Middle** button never draws). Update `sessionZones.test.ts` and `zoneSwitch.dom.test.svelte.ts` (accessible name present; one available zone → switch off).

## Files owned
`src/lib/server/sockets/sessions.updateKeepsTags.int.test.ts` (new), `src/lib/client/sessionLayout/{panelBacking.ts,panelBacking.test.ts,ZoneSwitch.svelte,sessionZones.svelte.ts,sessionZones.test.ts,zoneSwitch.dom.test.svelte.ts}`, `src/lib/client/stores/widgetStyles.svelte.ts` (the one export only).

## Done means
Those test files green in capped runs; capped `npx tsc --noEmit -p .` shows no error in your files. Final message = report: changed files, tests + results, anything not done.
