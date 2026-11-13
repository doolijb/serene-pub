# BRIEF vl-A-w2 — Variable layouts: write a layout (W3), and retire the variable branch of the template form

You are a `lane-worker` under the `vl-A` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Build the variable layout form (W3) at `/admin/variable-layouts/<variable>/new` and `/admin/variable-layouts/<variable>/<id>`, as an `AdminChangeForm`. Then remove the `kind="variable"` branch from `TemplateChangeForm.svelte` and `TemplateChangelist.svelte` (nothing will use it once the old section is gone), leaving context templates working exactly as they do. Another worker (w1) builds W1/W2, the routes (`/:variable/new` → your `NewLayoutPage.svelte`, `/:variable/:id` → your `LayoutPage.svelte`) and deletes the old `sections/variable-templates/` files.

Read first (by line range, never whole large files):
- `plans/PLAN-variable-layouts-2026-11-10.md` § The workflows → W3 (and W2 for where the form lands).
- `plans/REPORT-vl-D-2026-11-10.md` § Sockets — W3 lines (`libraryUseEverywhereCounts`, `previewTemplate` kind `variable`, `libraryCreateTemplate` / `libraryUpdateTemplate` with `reference` and `useEverywhere`, `libraryDeleteTemplate` refusals).
- Shared types `src/lib/shared/sockets/types.ts`: `Library.LibraryTemplate` (~11785), `LibraryTemplateWrite` (~11859), `PreviewTemplate` (~11626), `VariableLayouts` (~12087).
- Already written by the supervisor (use them; add pure helpers to `variableLayoutWords.ts` + its test if needed, never fork):
  - `src/lib/client/admin/sections/variable-layouts/variableLayoutsSockets.ts` — ⏳ typed bridge for the new events (`requestVariableLayouts`, `useVariableLayoutsInterest`, `emitVariableLayouts`). Events already in the client map (`pipelines:library`, `pipelines:libraryCreateTemplate`, `…UpdateTemplate`, `…DeleteTemplate`, `pipelines:previewTemplate`) use `useTypedSocket()` / `requestWithInterest` / `useInterest` directly.
  - `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.ts` — `variableHref`, `layoutFormHref`, `layoutSlugOf`, `referenceOf`, `ownerSlugProblem`, `slugProblem`, `lastOwnerSlug`, `variableKeyOf`, `useEverywhereSentence`, `VARIABLE_LAYOUTS_HREF`.
- The current form to learn from (and then trim): `src/lib/client/components/admin/TemplateChangeForm.svelte` (whole file, 555 lines) and `TemplateChangelist.svelte`.
- `src/lib/client/components/templates/TemplateEditor.svelte` Props (`value`, `scope`, `engine`, `readonly`, `rows`, `label`, `oninput`) and its DOM test `templateEditorField.dom.test.svelte.ts` (to see whether it mounts in happy-dom; if it is too heavy for your test, stub it with a tiny `.svelte` file beside your test via `vi.mock`).
- `src/lib/client/forms/unsavedEdits.svelte.ts` (`UnsavedEdits`: `adoptSaved`, `markSaved`, `forget`, `dirty`), `adminUnsavedEdits` in `src/lib/client/admin/adminRouter.svelte.ts`.
- Owner slug precedent: `src/lib/client/admin/sections/rulesets/NewPage.svelte` (~40–170, 250–260) and `session-genres/NewPage.svelte` (~100–205).
- Engine ids: `CORE_TEMPLATE_ENGINE`, `CORE_LIQUID_ENGINE` in `src/lib/shared/pipelines/templateEngines.ts`.
- `STYLE-GUIDE.md` §6.11 (1496–1702, `AdminChangeForm` paragraph especially), §6.12 (1703–1741), §6.14 (1757–1811), §9 (2313–2334), §10 (2336–2352).
- DOM test mocking pattern: `src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts`.

## Files owned (edit only these)

- New, in `src/lib/client/admin/sections/variable-layouts/`: `VariableLayoutForm.svelte`, `NewLayoutPage.svelte`, `LayoutPage.svelte`, `variableLayoutForm.dom.test.svelte.ts` (+ a stub `.svelte` for the editor if you need one), additions to `variableLayoutWords.ts` / `.test.ts`.
- `src/lib/client/components/admin/TemplateChangeForm.svelte` and `TemplateChangelist.svelte` — remove the `kind="variable"` paths only.

Never edit `adminRoutes.ts`, `adminNav.ts`, w1's files, `typedSocket.ts`, `Layout.svelte`, any server file, NOMENCLATURE.md, STYLE-GUIDE.md or docs/.

## What to build

### Pages

- `NewLayoutPage.svelte`: reads `adminPage.params.variable` (already decoded) and `adminPage.url.searchParams.get("from")`; renders `<VariableLayoutForm variableId={…} from={Number(from) || null} />`, wrapped in `{#key}` on both.
- `LayoutPage.svelte`: `params.variable` and `Number(params.id)`; renders `<VariableLayoutForm variableId={…} id={…} />` in `{#key id}`.

### `VariableLayoutForm.svelte` — props `{ variableId: string; id?: number; from?: number | null }`

Data, both asked on mount:
- `requestVariableLayouts("pipelines:libraryVariable", { variableId }, …)` → `variable` (label, `scope`, `sample`, `rows` with `inUse` / `namedByTemplates` / `chosenByPresets`, `inUse`). Ignore answers for another variable. A `:error` → the page says it in words with a link to `VARIABLE_LAYOUTS_HREF`.
- `requestWithInterest("pipelines:library", {}, …)` → `variableTemplates` rows (they carry `source`, `engine`, `name`, `reference`, `isImmutable`, `poolId`). The row being edited is `variableTemplates.find(r => r.id === id && r.poolId === variableId)`; the `from` row likewise (by id). A missing `id` row → *There is no variable layout ‹id› for ‹label›.* with a link to `variableHref(variableId)`.

`AdminChangeForm` with `mode` add/change, `noun="variable layout"`, `changelistHref={VARIABLE_LAYOUTS_HREF}`, `changelistLabel="Variable layouts"`, `trail={[{ label: variable.label, href: variableHref(variableId) }]}`, `title` = the name (or *New variable layout*), `addAnother` kept. A built-in row (`isImmutable`): `purpose` *A variable layout that ships with Serene Pub or a plugin: read-only. Duplicate it to make one you can change.*, every field as words, `canSave={false}`, no delete; header action **Duplicate** (tonal link → `layoutFormHref(variableId, "new", id)`). An editable row also gets **Duplicate** in the header.

Fieldsets and fields:
1. **Variable layout**
   - **Name** — text input (required on save: *A variable layout needs a name.* as a field error).
   - **Referenced as** — when the row already has a `reference`: words, the reference in mono, help *Fixed once saved, so templates that name it keep working.* Otherwise (new, or a person's older row with none): two inputs side by side, **Owner slug** and **Name to reference it by** (slug), and under them the result `referenceOf(variableId, owner, slug)` in mono. Owner prefilled with `lastOwnerSlug(library.variableTemplates)`. The slug follows `layoutSlugOf(name)` until the person edits the slug field (then it stays theirs). Validate on save with `ownerSlugProblem` / `slugProblem` as field errors (listed in `AdminChangeForm`'s `fieldErrors`). Sent as `reference: { ownerSlug, slug }`.
   - **Language** — new: a `Select` (`$lib/client/components/inputs/Select.svelte`) of **Handlebars** (`CORE_TEMPLATE_ENGINE`) and **Liquid** (`CORE_LIQUID_ENGINE`), default Handlebars, or the `from` row's engine when it is one of those two. Existing row: words (*Handlebars* / *Liquid* / the engine id for a plugin's engine) with help *Fixed once made: storing text under another language does not translate it.*
2. **Source** — `TemplateEditor` with `value`, `engine`, `readonly` (built-in), `rows={16}`, `label="Source"`, `scope={variable.scope as TemplateScope}` (the **server's** scope for this variable — do not look it up in the client bundle; no `getVariable`). Beside it, **Preview** (below it when narrow: a container query on the form's content, side by side from about 64rem, stacked under): live, debounced ~400 ms after `source` or `engine` changes (and once on load when there is a source), `socket.emit("pipelines:previewTemplate", { kind: "variable", source, engine, poolId: variableId })`, listening on `pipelines:previewTemplate` / `:error` via `useInterest`. Show `rendered` in a mono `<pre>` (`whitespace-pre-wrap`), `issues` as a warning-toned list, `error` with `InlineError`. Muted note under the heading: *Written against the variable's example value.* Clear the debounce timer on destroy.
3. **Use it everywhere** — new layouts only: a native `<input type="checkbox" role="switch">` labelled **Use it everywhere**, **off** by default, waiting for Save like every switch on a change form. Its help line is `useEverywhereSentence(variableKeyOf(variable.scope, variableId), counts)` with `counts` from `requestVariableLayouts("pipelines:libraryUseEverywhereCounts", { variableId }, …)`, followed by *Left off, it is offered on the variable's page with Use this.* On an existing row, no switch (W2's **Use this** does it).

Saving (`onSave(intent)`), no toasts:
- New: `socket.emit("pipelines:libraryCreateTemplate", { kind: "variable", poolId: variableId, name, source, engine, reference: { ownerSlug, slug }, useEverywhere })`. On the answer with `createdId` while this save is pending: `edits.forget()`, then `save` → `adminGoto(variableHref(variableId))`; `continue` → `adminGoto(layoutFormHref(variableId, createdId), { replaceState: true })`; `another` → `adminGoto(layoutFormHref(variableId, "new"))`.
- Existing: `socket.emit("pipelines:libraryUpdateTemplate", { kind: "variable", id, name, source, engine, ...(row has no reference ? { reference: { ownerSlug, slug } } : {}) })`; on the answer `edits.markSaved()` and land the same way (`continue` stays). Nothing dirty → just land.
- A `:error` answer while a save (or delete) is pending → `errors` on the form (the server's words), saving stops, edits stay. The form's own `:error` only; ignore ones that arrive while nothing is pending.
- Delete (editable rows): `deletion` via `deletionFor([row], { noun: { singular: "variable layout", plural: "variable layouts" }, label: r => r.name, protect })` with `protect` from what `variable.rows` says about this row (in use → *it is the one in use — choose another first*; `chosenByPresets` → *chosen by the ‹names› preset(s)*; `namedByTemplates` → *named by N context template(s)*); `onDelete` emits `pipelines:libraryDeleteTemplate { kind: "variable", id }`; on its answer `edits.forget()` and `adminGoto(variableHref(variableId), { replaceState: true })`; its refusal → form `errors`.
- Unsaved changes per STYLE-GUIDE §6.14: `UnsavedEdits(() => ({ name, ownerSlug, slug, engine, source, useEverywhere }))`; snapshot = the form as built (from the row, or the `from` row with name *‹name› copy*, or blank) via `adoptSaved` on each library push in change mode and `markSaved()` once seeded in add mode; `adminUnsavedEdits(() => edits.dirty)`; `dirty` passed to `AdminChangeForm`.

### Trim `TemplateChangeForm.svelte` / `TemplateChangelist.svelte`

Remove every `kind === "variable"` path: narrow `kind` to `"context"` (keep the prop so the context-templates section files, which pass `kind="context"`, compile unchanged), drop `getVariable` and the variable pool / label / message branches, and update the header comments (no longer "shared by context templates and variable templates"; variable layouts have their own form in `admin/sections/variable-layouts/`). Context templates must behave exactly as before. Do not restyle or refactor anything else in them.

## Rules your work depends on (quoted from the lane brief)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler. (Here: listen only through `useInterest` / `requestWithInterest` / the bridge module; never `socket.on`; no `notify` in your new files.)
- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**. (Element ids: `$props.id()`.)
- A refusal is shown in words where it applies, never only a toast. A read-only value is words, never a disabled control.
- Members never see this: every page is admin-only.
- UI copy: plain words; *variable layout*, never bare *layout* as a noun on its own in headings; *variable*, not *section*.
- **NOMENCLATURE §24**: list any new UI label or component name in your report. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Heavy DOM tests: never pipe vitest into `head`; a failing assert on a happy-dom element can OOM; keep DOM tests small.
- STYLE-GUIDE §6.11 (`AdminChangeForm`): *"`AdminField` rows (label, control, 12px help under it, the error above the help; no control means a readonly value, never a disabled input)"*; *"Save lands on the changelist, continue stays (an add lands on the new object's change form), another opens the add form"*; *"Dirty state is `UnsavedEdits` plus `adminUnsavedEdits`, so leaving asks first. Every switch, tick and approval on a change form waits for Save"*; *"An immutable object (a built-in config) is readonly on its change form, offers Duplicate (`/new?from=<id>`) in the header, and has no Delete"*.
- STYLE-GUIDE §6.14: *"Unsaved means different from what is saved, not 'touched'. Dirty is derived, never set by an effect or a typed-anything flag"*; *"The snapshot is the draft as the form built it (`adoptSaved`, `markSaved()` after a load), so a form that trims, splits or fills defaults on load is not dirty the moment it opens."*; *"Save resets it, and a push never lies."*; *"Delete or Create-then-leave calls `forget()` first."*
- STYLE-GUIDE §6.12: the code field is `TemplateEditor`; *"Variables available here"* is its tree, fed by `scope`.
- STYLE-GUIDE §9/§10: real buttons with names, sentence case, a button says what happens. Colours are roles with stops, never hex. Svelte 5 runes only.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: do **not** run `npm run sdk:build`, `npm test`, `npm run check`, or start any dev server. Another session is running a grouped verification.

## Done means

- `variableLayoutForm.dom.test.svelte.ts` (small; `timeout 300 npx vitest run <file>`, never piped into `head`):
  - change mode on a row with a reference: the reference shows as words with *Fixed once saved, so templates that name it keep working.* and there is no owner/slug input;
  - typing in the source (or loading a `from` row) leads to a `pipelines:previewTemplate` emit with `kind: "variable"` and `poolId` = the variable id (fake timers for the debounce);
  - add mode: the **Use it everywhere** switch is unchecked, and its help reads the counted sentence from a `libraryUseEverywhereCounts` answer (*… 9 pipelines, 3 templates.*);
  - add mode Save emits `pipelines:libraryCreateTemplate` with `reference: { ownerSlug, slug }` (owner prefilled from the library, slug following the name) and `useEverywhere: false`.
- Any existing test that covers `TemplateChangeForm` / `TemplateChangelist` still passes (`grep -rln "TemplateChange" src --include=*.test.ts`; run what you find).
- `npx tsc --noEmit -p . 2>&1 | grep -E "variable-layouts|TemplateChange"` prints nothing (w1's in-flight files may show; say so).
- `npx prettier --check` on every file you touched.

## Report (your final message)

Changed / new files; tests run with results; new UI labels and component names (for NOMENCLATURE); anything you could not build as briefed and why; **Noticed, not done**.
