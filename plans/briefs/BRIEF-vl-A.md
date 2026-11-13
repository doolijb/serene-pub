# BRIEF vl-A — Variable layouts: the admin pages and the preset form

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then the plan `plans/PLAN-variable-layouts-2026-11-10.md` in full (§ The workflows W1, W2, W3, W6 are yours), then `plans/REPORT-vl-D-2026-11-10.md` (§ Sockets is the server contract you build against; do not change server files). Every ★ is ruled. Delegate typing to at most 2 `lane-worker`s with briefs at `plans/briefs/BRIEF-vl-A-w<n>.md`; quote into each the rules below that its work depends on.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Build W1, W2, W3 and W6 exactly as the plan draws them, on the sockets in vl-D's report.

1. **W1 changelist** at `/admin/variable-layouts` from `pipelines:libraryVariables`: rows are variables on the shelves, columns **Variable** (label + key in mono, muted) · **Supplied by** · **Written as** (layout name; *chosen for this pub* when `reason` is `pub`; *(automatic)* / *As written* for those reasons; a muted *+ N preset(s)* when `presetsDiffering` > 0) · **Layouts** (count). Filter. No Add. **Step filter:** W1 reads `?step=<specSlug>:<nodeKey>` (the pipeline panel's **Change layouts** link, built by `vl-E`) and shows only the variables that step renders (the `keys` of `pipelines:templateVariableLayouts` `{ specSlug, nodeKey }`), with a line *Showing the variables ‹step› writes out* and **Show all**. Admin nav item **Variable layouts** (★1) replaces **Variable templates** (`shell/adminNav.ts:136`), same group and icon.
2. **W2 change view** at `/admin/variable-layouts/<encoded variable id>` from `pipelines:libraryVariable`: `AdminPageHeader` (name, description, *Supplied by …*), **Example value** (closed `<details>`, the `sample` as JSON in mono), then an `AdminInline` of rows: name, owner label, preview (mono, two lines, **Show all**; `previewError` shown in words), **In use** chip (a word, never colour alone) or **Use this** (`pipelines:librarySetPubLayout`), *Named by N context templates*, *Chosen by the ‹preset› preset* (linked to the preset's form), **Duplicate**, and on editable rows **Edit** / **Delete** (`pipelines:libraryDeleteTemplate`; its refusal shown in words where the row is, never a toast from the view). The muted header line *Chosen for this pub. **Back to the default** (‹default name›)* when `pubDiffersFromDefault`. **New layout** (one filled primary in the header) starts from the in-use row. A variable with no rows shows one *As written* row explaining the value is written as the pipeline gives it, with **New layout**.
3. **W3 form** at `/admin/variable-layouts/<variable>/new` and `/admin/variable-layouts/<variable>/<id>` (`AdminChangeForm`): **Name**; **Referenced as** (owner slug prefilled with the last one this pub used, slug following the name until edited, validated with `VARIABLE_LAYOUT_SLUG` from `@serene-pub/sdk`, shown as `owner/slug@major` in mono; after save, words: *Fixed once saved, so templates that name it keep working.*); engine select (Handlebars / Liquid); the code field (`TemplateEditor` in its variable mode, with *Variables available here* fed the variable's `scope` from the server, not the client bundle); a live **Preview** beside it (below when narrow) via `pipelines:previewTemplate` `kind: "variable"`, debounced; **Use it everywhere** switch, off by default for a new layout, its sentence counted from `pipelines:libraryUseEverywhereCounts` (*… 9 pipelines, 3 templates*; mention unchecked templates if any). Writes: `pipelines:libraryCreateTemplate` / `libraryUpdateTemplate` with `reference` and `useEverywhere`. Unsaved changes follow STYLE-GUIDE §6.14.
4. **Redirects**: `/admin/variable-templates` → W1; `/admin/variable-templates/:id` → that row's W3 form (look the row's variable up); `/admin/variable-templates/new` → W1. Routes in `admin/adminRoutes.ts:64-66, 121-123`.
5. **W6** on the preset change form (`admin/sections/session-presets/IdPage.svelte`): a **Variable layouts** fieldset from `pipelines:presetVariableLayouts`, purpose line *How this preset's sessions write out a variable, where it differs from the pub's choice.* Empty: *Uses the pub's layout for every variable.* Rows: variable · layout name · *(pub's: ‹name›)* · **Remove**. **Change a variable's layout** adds a row: variable picker (the variables this preset's pipelines render; shelves), then a layout list with previews (reuse W2's row preview). Writes `pipelines:setPresetVariableLayout`. An older row with no reference asks inline for owner slug (prefilled) and stamps it via `pipelines:stampVariableTemplateReference` before it can be picked. A declared preset (`editable: false`) shows the rows as words with the existing **Copy…**. `dangling` entries show as a warning-toned line naming the variable and reference. The preset changelist shows `danglingVariableLayouts` where it already shows a preset's notices.

## Files owned

- `src/lib/client/admin/sections/variable-templates/**` → move to `src/lib/client/admin/sections/variable-layouts/**` (new files; delete the old section's files once the redirects point at the new ones)
- `src/lib/client/admin/adminRoutes.ts`, `src/lib/client/shell/adminNav.ts` (this item only)
- `src/lib/client/components/admin/TemplateChangeForm.svelte` and `TemplateChangelist.svelte` (only their `kind="variable"` paths; leave context templates working as they are; extracting a new component is fine)
- `src/lib/client/admin/sections/session-presets/IdPage.svelte`, `Page.svelte` (dangling notice), `presetsAdmin.ts` (+ tests) for W6
- New components and their dom tests under `src/lib/client/components/admin/` or the section folder
- The client socket domain context for the `pipelines:` library family, if a new event needs a central listener or toast (find it; it is the only place that toasts)

## Files readable

Everything. Read before building: STYLE-GUIDE §6.11 (admin pages; W2 is a read-only change view with an inline), §6.12 (code fields), §6.14 (unsaved changes), §6.7 (empty states), §6.4 (list rows), §9 (accessibility), §10 (writing), §11 (checklist for a new screen); `docs/context-templates.md` § Variable layouts; `AI-TEMP/skeleton-llms-svelte.txt` by section only (grep the component, `sed -n` that section) for any Skeleton component you use.

## Rules your work depends on (quote into worker briefs)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler.
- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**.
- A refusal is shown in words where it applies, never only a toast. A read-only value is words, never a disabled control.
- Members never see this: every page is admin-only.
- UI copy: plain words; *variable layout*, never bare *layout* as a noun on its own in headings; *variable*, not *section*.
- **NOMENCLATURE §24**: list any new UI label or component name in your report for `vl-N`. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Heavy DOM tests: never pipe vitest into `head`; a failing assert on a happy-dom element can OOM; keep DOM tests small.

## Out of scope

Server files (any change you need goes in your report as a request; the lead routes it). The pipeline panel, the template editor's caret line and **Layouts in this template**, the run inspector (all `vl-E`). Docs (`vl-N`).

## Stop and ask when

CLAUDE.md § Decisions applies (anything a user sees beyond the plan's drawing: say it in the report as a ★ instead of building it); a socket in vl-D's report doesn't give you what a drawn element needs.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally: do not run `npm run sdk:build`, and do not start any dev server or `vite dev`.** Another session is running a grouped verification; the lead walks the screens later.

## Done means

- DOM tests for W1 (rows, reasons, filter), W2 (Use this, In use, Back to the default, delete refusal shown in place, empty variable), W3 (reference fixed after save, preview call, switch off by default and its counted sentence), W6 (add, remove, declared preset read-only, dangling line), redirects.
- `npx tsc --noEmit -p .` clean for your files. `npm run check` may OOM on this machine; if it does, say so.
- A `scope-reviewer` run on your diff, findings answered.

## Report

Return it as your final message (subagents can't write report files; the lead saves it to `plans/REPORT-vl-A-2026-11-10.md`): changed files, tests run with results, new UI labels and component names for `vl-N`, server requests, ★ proposals, **Noticed, not done**.
