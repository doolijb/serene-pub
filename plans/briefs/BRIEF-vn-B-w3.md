# BRIEF — vn-B-w3: the Dialogue box reaches the app, shipped slug pins take effect, the Visual novel seed

Lane vn-B (supervisor), plan `plans/PLAN-visual-novel-layout-2026-11-11.md` rev 2 (§1.2, §1.6). App repo `/home/jody/github/serene-pub`. The SDK is already built: core declares the `dialogue-box` widget (`scopes: ['session:full']`, `reads: ['layout','messages','actions','settings','viewer','locale']`, component slug `dialogue-box`, built to `node_modules/@serene-pub/core-catalog/dist/components/dialogue-box.js` and `.source.json`) and Story's third layout `visual-novel` ("Visual novel"), whose preset pins `widgetStyles['scene-portraits'] = { slug: 'scene-portraits:open-stage' }`. The app's `CORE_STYLE_PRESETS` now ships that `open-stage` style (seeded at boot by `syncWidgetStyles(withCorePresets(CORE_WIDGETS))`, `src/lib/server/db/index.ts:771`). **Do not edit anything in `../serene-pub-sdk`. Do not run `npm run sdk:build`.** Another worker is editing docs (`NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/*.md`) at the same time; touch only your files.

## Goal

### A. The loader line
`src/lib/server/components/core.ts`: add **one** line to `SOURCES`, beside `"turn-line"`:
`"dialogue-box": () => import("@serene-pub/core-catalog/components/dialogue-box.source.json?raw"),`
Nothing else in the file (its header comment's list of view-only widgets is stale — note it, don't fix it). `src/lib/server/sockets/components.int.test.ts:121-135` pins `CORE_SOURCE_SLUGS` to `CORE_COMPONENTS` and checks `cloneable` against `CORE_VIEW_ONLY_COMPONENTS`; it fails today without the line and passes with it. If you add an assertion, make it that `dialogue-box` is listed and `cloneable: false` (it is in `CORE_VIEW_ONLY_COMPONENTS`).

### B. The app's widget id lists (`src/lib/client/components/sessionPage/coreWidgets.test.ts`)
- `:29`: the sorted id list gains `"dialogue-box"`; extend the dated comment above it by one clause (sixteen with the Dialogue box, PLAN-visual-novel-layout 2026-11-11) in the comment's own style. Check the count words in the comment are right.
- `:111-114` ("the side widgets read no log — but the album and the conversation widgets"): `dialogue-box` reads `messages` too; add it to the exception with a comment: it draws one line of the log, as the Composer and Turn line draw theirs.
- Add a case: the `dialogue-box` ModePanel from `coreDefaultWidgets(true)` holds `grants` containing `"session:full"`.

### C. The widget, mounted through `Panel`, really receives the session dossier
New test `src/lib/client/components/surfaces/dialogueBoxPanel.dom.test.svelte.ts`, modelled on `panel.dom.test.svelte.ts` (read it: it stubs `$lib/client/components/host/uiWorkers`, mounts `PanelFixture.svelte` with `supplies.dossier`, and reads what the panel posts on the mount's port). Build the instance from the **real declaration** — `coreDefaultWidgets(true).find((p) => p.id === "dialogue-box")` projected into a `PanelInstance` the way the app does (find how: `SurfaceManager` / `toInstance` in `src/lib/client/surfaces/`, or `normalizeLayout` as the panel test does, keeping `grants`, `reads`, `src`, `surface` from the ModePanel) — not a hand-written grants list. Assert the posted `scoped` message for section `session_full` carries the dossier supplied (`{ dossier: 1 }` or a richer stub), and that the module requested is `/core-ui/dialogue-box`. Also run `src/routes/core-ui/[slug]/modules.test.ts` (data-driven: every declared component is served).

### D. Shipped style pins take effect — fix in the copy (`src/lib/server/db/layoutPresets.ts`)
**Problem:** `setWidgetStylePins` (`src/lib/client/stores/widgetStyles.svelte.ts:997`) keeps only pins with a numeric `id` and a string `slug`, and `copyLayoutIntoSession` (`layoutPresets.ts:763`, `incomingPins` :779) copies a shipped layout's pins verbatim, so the slug-only pin `{ slug: 'scene-portraits:open-stage' }` never applies.
**Decision (supervisor's): fix it in the copy, not the store.** Every live session gets its layout row through `copyLayoutIntoSession` (first open: `sockets/sessions.ts:4225`; Start from: :4672), so resolving there stores a normal `{ id, slug }` pin and every reader (the store, the editor's "pinned" state, a Duplicate, the pin writer that writes the whole map back) sees an ordinary pin. A store-side fix would carry an id-less pin through writers that write the map back.
- In `copyLayoutIntoSession`, after `incomingPins` is read and **before** either branch uses it, resolve each pin that has a string `slug` and **no numeric `id`**: look up `schema.widgetStyles` where `slug = pin.slug` **and** `source = 'system'` **and** `widgetSlug = widgetOfInstance(instanceId)` (already imported, :92; `slug` is unique in the table, `schema.ts` ~:8054). Found → the pin becomes `{ id: row.id, slug: row.slug }`. Not found → the pin is dropped (ignored, as an unknown pin is today). A pin that already has a numeric `id` passes through **exactly as it is** (a person's own pins unchanged). Use only `tx` inside the transaction (CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently"). One query for all slug-only pins (`inArray`), not one per pin. A small private helper with a one-line doc comment; extend the function's doc comment (:739-762) by one bullet saying a shipped slug-only pin is resolved to its seeded system row here.
- Tests in `src/lib/server/db/layoutPresets.int.test.ts` (read how it seeds presets, sessions and the `rowById` / `sessionFor` helpers; give each `it` that opens the DB a 60 s timeout): a preset pinning `{ "scene-portraits": { slug: "scene-portraits:open-stage" } }` with a seeded system row for that slug (insert it in the test if the test DB doesn't seed styles; no hardcoded id — read the id back) → the session's `layoutSettings.widgetStyles["scene-portraits"]` equals `{ id: <that row's id>, slug: "scene-portraits:open-stage" }`; an unknown slug → no pin for that widget, the other pins kept; a `{ id, slug }` pin → copied verbatim (an existing case may already cover this; then just point at it); the slug-only pin with a **user** row of a similar slug, or a system row of another widget, is not matched. Both branches (`onlyIfAbsent` insert, and the Start-from replace) get the resolved pin.

### E. The Visual novel layout seeds at boot (`src/lib/server/db/layoutPresets.boot.int.test.ts`, the added case only)
Add a test after the existing two (keep their order; read the file's ORDER-SENSITIVE note): after `bootSeed()`, the row with `seedKey = coreLayoutSeedKey("core:genre/story", "visual-novel")` (`$lib/shared/sessionLayout/presets`) and no author exists once, named "Visual novel", its `layout` equal to `getGenre("core:genre/story")?.layouts?.find((l) => l.slug === "visual-novel")?.preset`; a second `bootSeed()` writes nothing to it (same id, `toEqual` the first row). 60 s timeout.

## Files owned (edit only these)
- `src/lib/server/components/core.ts` (one line), `src/lib/server/sockets/components.int.test.ts`
- `src/lib/client/components/sessionPage/coreWidgets.test.ts`
- `src/lib/client/components/surfaces/dialogueBoxPanel.dom.test.svelte.ts` (new)
- `src/lib/server/db/layoutPresets.ts` (the pin resolution only), `src/lib/server/db/layoutPresets.int.test.ts`
- `src/lib/server/db/layoutPresets.boot.int.test.ts` (the added case)

## Files readable
Anything. `src/lib/shared/widgets/resolve.ts` (how a pin resolves: id+slug, id, slug, default), `src/lib/server/db/widgetStyles.ts` (the system rows' natural key), `src/lib/client/surfaces/panelManager.svelte.ts`, `PanelFixture.svelte`, `panel.dom.test.svelte.ts`, `coreWidgets.ts`.

## Rules you work under (quoted)
- CLAUDE.md Hard rules: "Never seed a row at a hardcoded id." "Inside `db.transaction(async (tx) => …)` use only `tx`." "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- CLAUDE.md "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass" — this change only affects new copies; it writes no migration and rewrites no stored layout. If you find a stored layout would need rewriting, stop.
- Lane brief: "the slug-pin fix would change how a person's own pinned styles resolve" → stop. A pin with a numeric id is never touched.
- Int tests that open a DB inside an `it` need a 60 s timeout.
- Never `git commit`, `git stash`, `git checkout`, `git restore`, `git clean`.

## Out of scope (write down, never build)
The store (`widgetStyles.svelte.ts`); any migration; anything in the SDK; docs and canon.

## Stop and ask when
A rule above can't be met; a new name, setting or migration seems needed; a file outside the list must change. Report the evidence and continue with the rest.

## Done means
These pass in the capped scope: `src/lib/server/sockets/components.int.test.ts`, `src/lib/client/components/sessionPage/coreWidgets.test.ts`, `src/lib/client/components/surfaces/dialogueBoxPanel.dom.test.svelte.ts`, `src/lib/client/components/surfaces/panel.dom.test.svelte.ts`, `src/routes/core-ui/[slug]/modules.test.ts`, `src/lib/server/db/layoutPresets.int.test.ts`, `src/lib/server/db/layoutPresets.boot.int.test.ts`, `src/lib/server/db/widgetStyles.int.test.ts`, `src/lib/shared/widgets/corePresets.test.ts`. Run the int tests one or two files at a time.
Also `npx prettier --check` on each file you changed (report, don't reformat others' lines). Do not run `tsc` or `npm run check` (the supervisor does).

Capped scope (exact): `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'` from `/home/jody/github/serene-pub`. Never pipe vitest into `head`.

## Report
Your final message is your report: changed files; tests run with results; every existing test you changed and why; decisions you made; anything you stopped on, with evidence; Noticed, not done.

## Verbatim lane rules
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never run `sdk:build` in this lane.)
- Never run `prettier --write` on a directory. Scratch files start with `vn-B-w3-`.
