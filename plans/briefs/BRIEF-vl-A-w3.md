# BRIEF vl-A-w3 — A preset's **Variable layouts** fieldset (W6)

You are a `lane-worker` under the `vl-A` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

On Admin › Presets › a preset's change form, add a **Variable layouts** fieldset: how this preset's sessions write out a variable where it differs from the pub's choice. Editable on a pub preset (waiting for the form's Save, like every lever on a change form), words on a declared one. Show a preset's dangling entries on the presets changelist where it already shows a preset's notices.

Read first (by line range, never whole large files):
- `plans/PLAN-variable-layouts-2026-11-10.md` § The workflows → W6 and § Walkthrough: a preset for a small model.
- `plans/REPORT-vl-D-2026-11-10.md` § Sockets — the W6 lines (`pipelines:presetVariableLayouts`, `pipelines:setPresetVariableLayout`, `pipelines:stampVariableTemplateReference`, `sessionPresets:list` rows' `danglingVariableLayouts`).
- Shared types `src/lib/shared/sockets/types.ts` ~12000–12045 (`PresetVariableLayouts`, `SetPresetVariableLayout`, `StampVariableTemplateReference`), ~12087–12230 (`VariableLayouts`), ~4060–4110 (`PresetRow`, `danglingVariableLayouts`).
- Already written (use, do not fork; you may add a pure helper to `variableLayoutWords.ts` + its test):
  - `src/lib/client/admin/sections/variable-layouts/variableLayoutsSockets.ts` — ⏳ typed bridge: `requestVariableLayouts`, `useVariableLayoutsInterest`, `emitVariableLayouts`, `awaitVariableLayoutsReply` (the `awaitReply` for these events). The client `SocketEventMap` does not list them; always go through this module for them.
  - `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.ts` — `lastOwnerSlug`, `ownerSlugProblem`, `variableHref`, `presetsWords`, `joinNames`, …
  - `src/lib/client/components/admin/VariableLayoutPreview.svelte` — W2's row preview (`{ preview, error }`): reuse it in the layout list.
- `src/lib/client/admin/sections/session-presets/IdPage.svelte` — the change form (1844 lines; read 1–200, 440–700 for the draft, wiring and `save` / `onUpdated` / `land`, and 1470–1844 for the fieldsets' markup; the built-in branch's wording at ~1476–1480).
- `src/lib/client/admin/sections/session-presets/{Page.svelte,presetsAdmin.ts,presetsAdmin.test.ts}`.
- `src/lib/client/admin/sequentialSave.ts` (`saveInSequence`, `saveErrors`, `SaveStep`) and how `src/lib/client/admin/sections/session-genres/IdPage.svelte` ~395–560 builds its steps.
- `src/lib/client/forms/unsavedEdits.svelte.ts` (`UnsavedEdits`).
- `src/lib/client/components/inputs/Select.svelte` (`SelectOption.group` draws shelf headings).
- `STYLE-GUIDE.md` §6.11 (1496–1702; the `AdminChangeForm` paragraph: *Waiting for Save* chips, sequential save), §6.14 (1757–1811), §6.7 (1339–1377), §9, §10.
- DOM test mocking pattern: `src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts`; `awaitReply` declares through `declareInterest` from `interest.svelte` — mock it the same way so the test can answer a step.

## Files owned (edit only these)

- New: `src/lib/client/admin/sections/session-presets/PresetVariableLayouts.svelte` and `presetVariableLayouts.dom.test.svelte.ts`.
- `src/lib/client/admin/sections/session-presets/IdPage.svelte` — mount the fieldset and fold it into dirty and Save; nothing else.
- `src/lib/client/admin/sections/session-presets/Page.svelte`, `presetsAdmin.ts`, `presetsAdmin.test.ts` — the dangling notice.
- Additions to `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.ts` / `.test.ts` if you need a pure helper.

Never edit `typedSocket.ts`, `Layout.svelte`, any server file, other admin sections, NOMENCLATURE.md, STYLE-GUIDE.md or docs/.

## What to build

### `PresetVariableLayouts.svelte`

Props: `{ presetId: number; dirty?: boolean (bindable) }`. Exposes (Svelte 5 `export function` in the instance script, reached with `bind:this`) `saveSteps(): SaveStep[]` — one step per difference between the draft and what is saved.

Data:
- `requestVariableLayouts("pipelines:presetVariableLayouts", { presetId }, …)` → the view `{ presetId, editable, rows, dangling }`; ignore answers for another preset. Also listen (`useVariableLayoutsInterest`) to `pipelines:setPresetVariableLayout` (same view shape, broadcast after each write) and adopt it when it is this preset's.
- `requestVariableLayouts("pipelines:libraryVariables", {}, …)` → every variable with `label`, `shelfLabel`, `layoutCount`, `inUse` — for the picker and for labels.
- Saved = `{ [row.variableId]: row.reference }` from `rows`. Draft = a plain object reassigned on each change (no in-place mutation). `UnsavedEdits(() => draft)`; `adoptSaved` on every view push (so the echo of the form's own save is clean and another tab's change never wipes an edit); `dirty = edits.dirty`.

`AdminFieldset` **Variable layouts**, `id="variable-layouts"`, description *How this preset's sessions write out a variable, where it differs from the pub's choice.*

- Nothing saved and nothing drafted: one muted line *Uses the pub's layout for every variable.*
- One row per entry (a list, `bg-surface-50-950 rounded-base` rows like the Settings fieldset's): variable label · the layout name (`layoutName`, else the reference in mono) · muted *(pub's: ‹pubLayout.name›)* when `pubLayout` · **Remove** (quiet button, names the variable for screen readers).
  - A saved row whose draft differs (changed to another layout): the new layout's name, a *Waiting for Save* chip (tonal surface chip, as on the connection form) and **Put back** (restores the saved reference).
  - A saved row the draft removed: muted, *Removed — waiting for Save*, and **Put back**.
  - A row only in the draft (added): its name, *(pub's: …)* from `libraryVariables`' `inUse.name`, a *Waiting for Save* chip, and **Remove** (drops it from the draft).
- **Change a variable's layout** (tonal button) opens an inline panel under the rows (not a dialog):
  1. **Variable** — `Select` (`label="Variable"`) of `libraryVariables` rows with at least one layout (`layoutCount > 0`), `group: row.shelfLabel`, `label: row.label`. (The plan says *the variables this preset's pipelines render*; no socket answers that yet, so every variable is offered; the supervisor reports the gap.)
  2. Once picked: `requestVariableLayouts("pipelines:libraryVariable", { variableId }, …)` → its `rows`; a list of choices, each a real button or radio (accessible name = the layout's name) showing name, `ownerLabel`, `<VariableLayoutPreview preview={r.preview} error={r.previewError} />`, and a muted *the pub's* on the row whose `inUse` is true. Picking a row with a `reference` adds `{ [variableId]: reference }` to the draft (replacing any draft entry for that variable), remembers its name for display, and closes the panel.
  3. A row with `reference === null` (a person's older layout) cannot be picked yet: under it, inline, *Give it a reference to pick it.* with an **Owner slug** input prefilled with `lastOwnerSlug(…)` over `requestWithInterest("pipelines:library", {}, …)`'s `variableTemplates`, validated with `ownerSlugProblem`, and **Give it a reference** → `emitVariableLayouts(socket, "pipelines:stampVariableTemplateReference", { templateId, ownerSlug })` (a one-shot act with its own button; it writes the layout, not the preset). On its answer re-request `pipelines:libraryVariable` for that variable; its `:error` is said in words under that row (`role="alert"`, `text-error-600-400 text-xs`).
  4. **Cancel** closes the panel without changing the draft.
- `editable === false` (a preset declared in code): the rows as words (variable · layout · *(pub's: …)*), no Remove, no **Change a variable's layout**, and one muted italic line *This preset ships with Serene Pub or a plugin, and updates replace it. Clone it to change its variable layouts.* (The header's existing **Clone** is the way.)
- `dangling` entries: one warning-toned line each (`text-warning-700-300 text-xs`, an icon plus words, never colour alone): *‹variable label, else id› names ‹reference› (mono), which no variable layout goes by now. The pub's layout is used.*
- `saveSteps()`: for each variable whose draft reference differs from saved (added, changed or removed), a `SaveStep` with a label in words (*Variable layouts: ‹variable label›*) whose `run` is `awaitVariableLayoutsReply({ socket, event: "pipelines:setPresetVariableLayout", params: { presetId, variableId, reference: draftRef ?? null }, match: (r) => r.presetId === presetId })`.
- A refusal of `pipelines:presetVariableLayouts` (`:error`) → said in words in the fieldset.
- No `notify` / `toaster` anywhere in this component.

### `IdPage.svelte`

- Mount `<PresetVariableLayouts presetId={id} bind:dirty={layoutsDirty} bind:this={layouts} />` after the Settings fieldset block and before **Creation defaults** (outside the `{#if editor}` branch so it does not wait on the editor).
- Dirty everywhere: `adminUnsavedEdits(() => edits.dirty || layoutsDirty)` and the `dirty` passed to `AdminChangeForm` is `dirty || layoutsDirty`.
- Save: when neither is dirty, land as now. When the preset itself is dirty, send `sessionPresets:update` as now; in `onUpdated`, after `edits.markSaved()`, run the layout steps (below) before `land(intent)`. When only the layouts are dirty, set `saving`, run the steps, clear `saving`, then land.
- Running the steps: `const outcome = await saveInSequence(layouts.saveSteps())`; if anything was refused or skipped, `formErrors = saveErrors(outcome)` and do not land (the edits stay unsaved); else land. Keep the existing `notify.success` on the preset's own save as it is (do not add new toasts).
- Change nothing else in IdPage.

### Dangling notice on the changelist (`presetsAdmin.ts`, `Page.svelte`)

- `presetStatus` gains `"layouts"` after `"stale"` when `danglingVariableLayouts?.length` (add `danglingVariableLayouts` to the `Pick`); `PRESET_STATUS_ORDER` = `["stale", "layouts", "hidden", "available"]`; `presetStatusWord("layouts")` = *Variable layout missing*; `Page.svelte`'s `DOT` gives it `bg-warning-500`; its `searchText` adds each dangling entry's `variableId` and `reference`.
- `presetsAdmin.test.ts`: the new status sits after a stale binding and before hidden.

## Rules your work depends on (quoted from the lane brief and the guides)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler. (Listen only through the interest registry or the bridge module; never `socket.on`.)
- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**. (Element ids: `$props.id()`.)
- A refusal is shown in words where it applies, never only a toast. A read-only value is words, never a disabled control.
- Members never see this: every page is admin-only.
- UI copy: plain words; *variable layout*, never bare *layout* as a noun on its own in headings; *variable*, not *section*.
- **NOMENCLATURE §24**: list any new UI label or component name in your report. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Heavy DOM tests: never pipe vitest into `head`; a failing assert on a happy-dom element can OOM; keep DOM tests small. Test `PresetVariableLayouts.svelte` on its own; do not mount the 1844-line IdPage in a test.
- STYLE-GUIDE §6.11: *"Every switch, tick and approval on a change form waits for Save (owner ruling 2026-10-02)"*; *"Where the server takes one setting per write, Save sends the difference as single writes in order (`client/admin/sequentialSave.ts`, each an `awaitReply` on that verb's answer or its `:error`), waits for every answer, and only then says Saved; a refusal is named in the error summary … and stays an unsaved edit."*; *"listed under the table as Waiting for Save chips, each with an × that puts it back"*; *"One-shot acts with their own button (Duplicate, Unload, …) still act when pressed."*; *"A read-only value is shown as words, never as a disabled tick."*
- STYLE-GUIDE §6.14: *"Unsaved means different from what is saved, not 'touched'."*; *"Save resets it, and a push never lies. Each push of the saved row moves the snapshot (`adoptSaved`)"*; *"A Save form holds every edit … Adding, removing or switching something inside a form with a Save is a pending change ('Ready to add' on a row not yet saved), counted in dirty, sent on Save, dropped with the form."*
- STYLE-GUIDE §9/§10: real buttons with names, never an interactive inside an interactive, sentence case, a button says what happens. Colours are roles with stops, never hex. Svelte 5 runes only.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: do **not** run `npm run sdk:build`, `npm test`, `npm run check`, or start any dev server. Another session is running a grouped verification. Do not run `prettier --write` over whole existing files you only touch in part (IdPage, Page, presetsAdmin): it rewrites other people's lines. Format only what you wrote.

## Done means

- `presetVariableLayouts.dom.test.svelte.ts` (small; `timeout 300 npx vitest run <file>`, never piped into `head`):
  - **add**: open **Change a variable's layout**, pick a variable, answer `pipelines:libraryVariable`, pick a row → the row shows with *Waiting for Save*, `dirty` is true, and `saveSteps()[0].run()` emits `pipelines:setPresetVariableLayout` with that reference;
  - **remove**: a saved row's **Remove** → *Removed — waiting for Save*, and the step sends `reference: null`;
  - **declared preset** (`editable: false`): rows as words, no **Remove**, no **Change a variable's layout**;
  - **dangling**: a `dangling` entry shows its warning line naming the variable and the reference.
- `presetsAdmin.test.ts` passes with the new status.
- `npx tsc --noEmit -p . 2>&1 | grep -E "session-presets|variable-layouts"` prints nothing.
- `npx prettier --check` on your new files.

## Report (your final message)

Changed / new files; tests run with results; new UI labels and component names (for NOMENCLATURE); anything you could not build as briefed and why; **Noticed, not done**.
