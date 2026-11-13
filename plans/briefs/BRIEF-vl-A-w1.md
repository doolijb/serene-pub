# BRIEF vl-A-w1 — Variable layouts: the changelist (W1), a variable's page (W2), routes, nav, redirects

You are a `lane-worker` under the `vl-A` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Build Admin › Writing › **Variable layouts**: the changelist (W1) and one variable's read-only change view (W2), the routes, the nav item and the redirects from the old **Variable templates** addresses. A second worker (w2) builds the layout form (W3) at the same time in `VariableLayoutForm.svelte`, `NewLayoutPage.svelte`, `LayoutPage.svelte` in the same folder; you only point routes at those two page files (they may not exist yet when you start).

Read first (by line range, never whole large files):
- `plans/PLAN-variable-layouts-2026-11-10.md` § The workflows → W1 and W2 (the drawings are the spec).
- `plans/REPORT-vl-D-2026-11-10.md` § Sockets (the server contract; do not change server files).
- Shared types: `src/lib/shared/sockets/types.ts` ~12080–12230 (`Sockets.Pipelines.VariableLayouts.*`).
- Already written for you by the supervisor (use them; do not fork them; you may add to `variableLayoutWords.ts` + its test if you need another pure helper):
  - `src/lib/client/admin/sections/variable-layouts/variableLayoutsSockets.ts` — ⏳ typed bridge for the new events (`requestVariableLayouts`, `useVariableLayoutsInterest`, `emitVariableLayouts`). The client `SocketEventMap` does not list the new events yet; always go through this module for them. Library events that ARE in the map (`pipelines:library`, `pipelines:libraryDeleteTemplate`, …) use `useTypedSocket()` / `requestWithInterest` / `useInterest` directly.
  - `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.ts` — `variableHref`, `layoutFormHref`, `writtenAsWords`, `presetsDifferingWords`, `parseStepParam`, `VARIABLE_LAYOUTS_HREF`.
- Components: `src/lib/client/components/admin/{AdminChangelist,AdminPageHeader,AdminInline,AdminFieldset,AdminField,AdminDeleteConfirm}.svelte`, `changelist.ts` (`deletionFor`), `breadcrumbs.ts`. Example read-only change view: `src/lib/client/admin/sections/pipelines/EventIdPage.svelte` (~278+). Example changelist: `src/lib/client/admin/sections/session-presets/Page.svelte`.
- Router: `src/lib/client/admin/adminRoutes.ts` (table + `ALIASES`), `adminRouter.svelte.ts` (`adminPage`, `adminGoto`, `adminRouter.setQuery`).
- `STYLE-GUIDE.md` §6.11 (1496–1702), §6.7 (1339–1377), §9 (2313–2334), §10 (2336–2352). Empty state is `EmptyState`, loading is `LoadingState` (find them under `src/lib/client/components/`).
- DOM test mocking pattern: `src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts` (mocks `loadSockets.client`, `interest.svelte`, `adminRouter.svelte`, `toaster`).

## Files owned (edit only these)

- New, in `src/lib/client/admin/sections/variable-layouts/`: `Page.svelte` (W1), `VariablePage.svelte` (W2), `LegacyIdRedirect.svelte`, their DOM tests (`*.dom.test.svelte.ts`), and additions to `variableLayoutWords.ts` / `.test.ts`.
- New: `src/lib/client/components/admin/VariableLayoutPreview.svelte` (the row preview; W6 will reuse it).
- `src/lib/client/admin/adminRoutes.ts` and `src/lib/client/admin/adminRoutes.test.ts`.
- `src/lib/client/shell/adminNav.ts` — the one **Variable templates** item only (~131–139).
- Delete, last, once the routes no longer import them: `src/lib/client/admin/sections/variable-templates/{Page,NewPage,IdPage}.svelte`.

Never edit `TemplateChangeForm.svelte` / `TemplateChangelist.svelte` (w2's), `typedSocket.ts`, `Layout.svelte`, any server file, NOMENCLATURE.md, STYLE-GUIDE.md or docs/.

## What to build

### W1 `Page.svelte` at `/admin/variable-layouts`

- `AdminChangelist` with `title="Variable layouts"`, `purpose="How each variable is written out. One choice for the whole pub."`, `noun={{ singular: "variable", plural: "variables" }}`, **no** `addHref`, no bulk actions. Rows from `requestVariableLayouts("pipelines:libraryVariables", {}, …)`; `loading` until the first answer; a `pipelines:libraryVariables:error` answer shown in words on the page (`InlineError`), never a toast.
- Rows keep the server's order (it sends them shelf by shelf); pass no `defaultSort`. Rows link to `variableHref(row.variableId)`.
- Columns: **Variable** (primary; `custom` cell: the label, then the `variableId` in mono, muted `text-surface-600-400 text-xs` (the drawing shows the template key, but `ListRow` carries no key; the supervisor reports that gap — use the id); `text` = label for the stacked row; sort by label) · **Supplied by** (`supplier`) · **Written as** (`custom`: `writtenAsWords(row)`, then, when `presetsDiffering > 0`, a muted `presetsDifferingWords(n)`; `text` = both joined) · **Layouts** (`numeric`, the `layoutCount`).
- Filters: one facet **Shelf** (`values: r => r.shelfId`, `optionLabel` from the rows' `shelfLabel`, `order` = shelf ids in the order the server sent them). `searchText` = label, variableId, supplier, written-as words.
- **Step filter:** read `adminPage.url.searchParams.get("step")` → `parseStepParam`. When present, request `requestVariableLayouts("pipelines:templateVariableLayouts", { specSlug, nodeKey }, …)` and show only rows whose `variableId` is among the answer's `keys[].variableId`. Above the list (in the changelist's `headerExtra` snippet) one muted line: *Showing the variables ‹step› writes out.* then a quiet button **Show all** that removes `step` from the query (`adminRouter.setQuery` with the remaining params). ‹step›: look the step up in `requestWithInterest("pipelines:library", {}, …)` → `pipelines.find(p => p.slug === specSlug)`; use the first `scriptSeams` entry with that `nodeKey`'s `stepLabel` if any, else the `nodeKey`; add ` in ‹pipeline label›` when the pipeline is found. Pass `keepQuery={["step"]}` (and `syncQuery`) so the changelist keeps `step` in the address. A `:error` on that request: say it in words in the same line and show all rows.

### W2 `VariablePage.svelte` at `/admin/variable-layouts/:variable`

`page.params.variable` is already decoded by the router. Data: `requestVariableLayouts("pipelines:libraryVariable", { variableId }, …)` (answer `{ variable }`); ignore answers whose `variable.variableId` is not this page's. Re-request it whenever a library write echoes (`pipelines:libraryCreateTemplate`, `…UpdateTemplate`, `…CloneTemplate`, `…DeleteTemplate` — via `useInterest`). A `pipelines:libraryVariable:error` → the page says it in words with a link back to **All variable layouts** (`VARIABLE_LAYOUTS_HREF`).

A read-only change view (§6.11: `AdminPageHeader` + fieldsets, **no save row**):
1. `AdminPageHeader` — `title` = `variable.label`; `purpose` = `variable.description`; beneath (children) a muted line *Supplied by ‹supplier›.*; when `pubDiffersFromDefault`, a muted line *Chosen for this pub.* followed by a quiet button **Back to the default** and, after it, *(‹default.name›)* — the button emits `librarySetPubLayout { variableId, templateId: null }`. `actions` snippet: one filled primary link **New layout** → `layoutFormHref(variableId, "new", variable.inUse?.id)`. Warnings from `librarySetPubLayout`'s answer (`warnings: string[]`) show as muted `role="status"` lines here, never a toast.
2. **Example value** — an `AdminFieldset` (`collapsible`, closed) whose body is `JSON.stringify(variable.sample, null, 2)` in a mono `<pre>` (`overflow-x-auto`, `whitespace-pre-wrap`).
3. An `AdminInline` titled **Variable layouts** (description: *Each variable layout of this variable, previewed against the example value.*) over `variable.rows`, read-and-link (not `editable`). Columns:
   - **Name** (primary) — `rowHref` → `layoutFormHref(variableId, row.id)` for every row (the form is read-only for a built-in one).
   - **Owner** — `ownerLabel`.
   - **Preview** (`custom`) — `<VariableLayoutPreview preview={row.preview} error={row.previewError} />`.
   - **Status** (`custom`) — the in-use row: a chip with a check icon and the word **In use** (`preset-tonal-primary`, a word, never colour alone, like the **Used** chip in `src/lib/client/components/templates/ScopeTree.svelte`); every other row: a tonal button **Use this** → `librarySetPubLayout { variableId, templateId: row.id }`. Under it, muted lines when they apply: *Named by N context template(s)* (`namedByTemplates`); *Chosen by the ‹preset› preset* — each preset its own link to `/admin/session-presets/<id>`, several joined as *Chosen by the A and B presets* / *the A, B and C presets*.
   - **Actions** (`custom`) — **Duplicate** (tonal link → `layoutFormHref(variableId, "new", row.id)`); on `row.editable` rows also **Edit** (tonal link → `layoutFormHref(variableId, row.id)`) and **Delete** (quiet error-text button).
   - A refusal for a row (`librarySetPubLayout:error` after its **Use this**, or `libraryDeleteTemplate:error` after its Delete) is one `role="alert"` line in that row (`text-error-600-400 text-xs`), in the server's words. The events carry no id, so remember which row's action is in flight. A refusal of **Back to the default** shows under the header line. **Never** `notify`/`toaster` from this view.
4. **Delete** asks on the confirmation page, not a dialog (§6.11): the page gives its place to `AdminDeleteConfirm` with `deletionFor([row], { noun: { singular: "variable layout", plural: "variable layouts" }, label: r => r.name, protect })` where `protect` says why it stays when the view already knows (`inUse` → *it is the one in use — choose another first*; `chosenByPresets.length` → *chosen by the ‹names› preset(s)*; `namedByTemplates` → *named by N context template(s)*) and the `trail` names the row. Confirm emits `pipelines:libraryDeleteTemplate { kind: "variable", id }` and returns to the view; a refusal lands on the row as above.
5. **No rows at all**: instead of the inline, one fieldset **Variable layouts** holding one row: **As written** — *Written exactly as the pipeline gives it: this variable has no variable layout yet.* — with a tonal **New layout** link (`layoutFormHref(variableId, "new")`).

### `VariableLayoutPreview.svelte` (`src/lib/client/components/admin/`)

Props `{ preview: string | null; error?: string | null }`. Mono 12px text (`font-mono text-xs whitespace-pre-wrap break-words`), clamped to two lines (`line-clamp-2`) with a quiet **Show all** / **Show less** button (`aria-expanded`, `aria-controls` → the text's id) shown only when the text has more than two lines or is longer than ~160 characters. Ids: no `crypto.randomUUID` — use `$props.id()`. `error` → *The preview could not be written: ‹error›* in `text-error-600-400 text-xs`. Both null → a muted *No preview.*

### Routes, redirects, nav (`adminRoutes.ts`, `adminNav.ts`)

- Remove the three `variables*` loaders and their routes. Add (literal segments before params, as the file's header says):
  - `/admin/variable-layouts` → `sections/variable-layouts/Page.svelte`
  - `/admin/variable-layouts/:variable` → `VariablePage.svelte`
  - `/admin/variable-layouts/:variable/new` → `NewLayoutPage.svelte` (w2's)
  - `/admin/variable-layouts/:variable/:id` → `LayoutPage.svelte` (w2's)
  - `/admin/variable-templates/:id` → `LegacyIdRedirect.svelte`
- `ALIASES`: `"/admin/variable-templates": "/admin/variable-layouts"`, `"/admin/variable-templates/new": "/admin/variable-layouts"`.
- `LegacyIdRedirect.svelte`: `LoadingState`; `requestWithInterest("pipelines:library", {}, …)`; find `variableTemplates` row with `id === Number(page.params.id)`; `adminGoto(layoutFormHref(row.poolId, row.id), { replaceState: true })`; not found → `adminGoto(VARIABLE_LAYOUTS_HREF, { replaceState: true })`.
- `adminNav.ts`: the item becomes `{ href: "/admin/variable-layouts", label: "Variable layouts", icon: "Braces" }`, same group and place; update its comment to say what it is (how each variable is written out).
- `adminRoutes.test.ts`: the aliases resolve; `/admin/variable-layouts/core%3Avar%2Fcharacters%401` matches the W2 route with `params.variable === "core:var/characters@1"`; `/…/new` matches the add route, `/…/7` the change route; `/admin/variable-templates/7` matches the redirect.
- Then delete the old `sections/variable-templates/` files. `grep -rn "variable-templates" src/lib/client` should show only the redirect route and alias. (`src/lib/shared/adminLogbook.ts` still links the old address; it is not yours — the redirect covers it; mention it in your report.)

## Rules your work depends on (quoted from the lane brief)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler. (Here: listen only through `useInterest` / `requestWithInterest` / the bridge module; never `socket.on`; no `notify` anywhere in these files.)
- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**.
- A refusal is shown in words where it applies, never only a toast. A read-only value is words, never a disabled control.
- Members never see this: every page is admin-only.
- UI copy: plain words; *variable layout*, never bare *layout* as a noun on its own in headings; *variable*, not *section*.
- **NOMENCLATURE §24**: list any new UI label or component name in your report. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Heavy DOM tests: never pipe vitest into `head`; a failing assert on a happy-dom element can OOM; keep DOM tests small.
- STYLE-GUIDE §6.11: *"Every section opens with `AdminPageHeader`: the breadcrumb trail, a 24px Display title, one sentence saying what the section decides, and at most one filled primary among its actions."* *"Read-only kinds (Sessions) are a changelist with no Add"*; *"Events and History records are read-only change views (`AdminPageHeader` + fieldsets, no save row)"*; *"Delete asks on a confirmation page, not a dialog (`AdminDeleteConfirm`)"*; *"Never hand-build a back link or a breadcrumb in a section."*
- STYLE-GUIDE §9: *"Every interactive element is a real `button`, `a` or input with an accessible name"*; *"Never an interactive inside an interactive."*; *"Nothing is hover-only."*
- STYLE-GUIDE §10: *"Sentence case everywhere"*; *"A button says what happens"*; *"No filler"*.
- Svelte 5 runes only. Colours are roles with stops (`text-surface-600-400`, `text-error-600-400`), never hex.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: do **not** run `npm run sdk:build`, `npm test`, `npm run check`, or start any dev server. Another session is running a grouped verification.

## Done means

- DOM tests (small, one component each, `timeout 300 npx vitest run <file>`; never piped into `head`):
  - W1 (`variableLayoutsPage.dom.test.svelte.ts`): rows render with each reason's words (pub / automatic / default / as-written) and *+ 1 preset*; the filter (search box narrows rows); `?step=` narrows to the answered variables and shows *Showing the variables …* with **Show all**; no Add button.
  - W2 (`variablePage.dom.test.svelte.ts`): **Use this** emits `pipelines:librarySetPubLayout` with the row id; the in-use row shows **In use** and no **Use this**; **Back to the default** shows only when `pubDiffersFromDefault` and emits `templateId: null`; a delete refusal (`pipelines:libraryDeleteTemplate:error`) shows in that row and nothing is toasted (mock `toaster`, assert not called); an empty variable shows the *As written* row with **New layout**.
  - Redirects: `adminRoutes.test.ts` as above.
- `npx tsc --noEmit -p . 2>&1 | grep -E "variable-layouts|VariableLayoutPreview|adminRoutes|adminNav"` prints nothing (w2's missing page files may show while w2 is still working; say so).
- `npx prettier --check` on every file you touched.

## Report (your final message)

Changed / new / deleted files; tests run with results; new UI labels and component names (for NOMENCLATURE); anything you could not build as briefed and why; **Noticed, not done**.
