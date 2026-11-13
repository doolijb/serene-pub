# REPORT vl-E — Variable layouts: panel, template editor, run inspector — 2026-11-10

Saved by the lead from the supervisor's hand-back (subagents can't write report files).

**Status:** brief built and passing. 14 files / 226 tests pass; last re-run 4 panel files / 37 pass. `npx tsc --noEmit -p .` clean with the loose `typedSocket.ts` entries gone. `svelte-check` crashed natively for the worker (left to grouped `npm run check`). `scope-reviewer` run, findings answered. Two gaps: W5 is wired only in the pipeline panel (library editors not this lane's files); two socket gaps worked around client-side, marked ⏳.

## Changed files (`src/lib/`)

- `client/components/pipelines/PipelineConfigOptions.svelte`: per-step picker branch, clone/edit/delete, `layoutDrafts`, `cloningLayoutFor`, `onLayoutCloned`, four `*VariableTemplate` listeners removed; stale comments fixed; paragraph under the template editor now *Message blocks, placement and loops. `{{{x}}}` reads a variable.* (★E-2); W4 row (admin only); leftover picks requested on mount, after fresh views and after a move; layout data passed to `TemplateEditor`.
- `client/components/Layout.svelte` ~287–293: three retired quiet `:error` entries → four new.
- `client/sockets/typedSocket.ts`: six loose ⏳ keys → four typed events + `:error`s (`pipelines:templateVariableLayouts`, `:leftoverPicks`, `:clearLeftoverPick`, `:moveLeftoversIntoTemplate`).
- `shared/sockets/types.ts`: the doc above `variableTemplate?:` says ⏳ unused (goes with the server's dead `variableTemplateRow`).
- New: `client/components/pipelines/StepVariableLayouts.svelte` (W4), `leftoverPicks.svelte.ts`, `templateVariableLayouts.svelte.ts` (⏳ one-in-flight FIFO store), tests `templateVariableLayouts.test.ts`, `stepVariableLayouts.dom.test.ts`.
- `client/components/templates/TemplateEditor.svelte`: `variableLayouts` prop; `laidOutScope` + offers everywhere it checks/completes/hovers/draws; caret line *Written as ‹name› (‹reason›)* + **Write as ‹label› here**; **Layouts in this template** (hidden when read-only).
- `client/components/templates/ScopeTree.svelte`: `writtenAs` prop.
- New: `templates/TemplateLayoutsList.svelte` (selects, **All bare** / **All titled**, **Apply** as one transaction), `templates/templateLayoutRewrite.ts` (mirrors server `nameLayoutAtBareReads`), tests `templateLayoutRewrite.test.ts`, `templateEditorLayouts.dom.test.svelte.ts`.
- `shared/utils/templateAssist.ts`: doc entries for the `layout` helper and filter; `AssistOptions.layoutOffers`; reference completion.
- `shared/utils/templateDiagnostics.ts`: `variableLayoutOffers`; `unknown-layout` quick fix replaces the whole span.
- `shared/utils/templateCheckOptions.test.ts`: `layout` back in the comparison.
- Tests: new `shared/utils/templateDiagnostics.test.ts`; additions to `templateCompletions.test.ts`, `codeField/templateAssistBridge.test.ts`.
- `inspector/receiptView.ts` + test + `RunInspector.svelte`: `LayoutLine.why`, `missingReference`; list keyed by index.

## W1 filter parameter

`/admin/variable-layouts?step=<encodeURIComponent(specSlug + ":" + nodeKey)>`; split on the **last** `:`.

## New labels and names (for vl-N)

From the plan: *Each variable is written out by its variable layout, shared by every pipeline.* · **Change layouts** · *‹Variable› uses ‹layout› here (set before layouts moved).* · **Use the pub's** · **Move into the template** · *Written as ‹name›* · **Write as ‹label› here** · **Layouts in this template** · **All bare** · **All titled** · *The pub's layout* · inspector reasons *the preset's* / *the pub's* / *the default* / *named by the template* / *leftover pick* · *named ‹ref›, which wasn't found; used ‹name›* · doc lines for `layout`.
Added by this lane (★E-1/★E-2): caret reasons *(the default)*, *(automatic)* · **Apply** · *Mixed — leave as it is* · accessible name *Layout for ‹variable›* · *Save or cancel your changes to the template first.* · **Owner name** (placeholder `acme`) · the panel paragraph.
Code: `LaidOutOccurrence`, `laidOutOccurrences`, `occurrenceAt`, `writeOccurrence`, `rewriteChanges`, `bareOffer`, `titledOffer`, `TemplateEditor.variableLayouts`, `ScopeTree.writtenAs`, `AssistOptions.layoutOffers`, `TemplateDiagnosticsOptions.variableLayoutOffers`, `useLeftoverPicks`, `LeftoverStepState`, `requestTemplateVariableLayouts`, `templateVariableLayoutsOf`, `LayoutLine.why`, `LayoutLine.missingReference`.

## Server/SDK requests

1. `pipelines:templateVariableLayouts` should echo its target (`{ specSlug, nodeKey }` / `{ nodeType }`) in the response and `:error`. Today: one in flight, 15 s drop, ⏳; and vl-A's page sends the same event with its own listener, so two open views can cross.
2. `pipelines:moveLeftoversIntoTemplate:error` should carry a code for "needs an owner slug" (client matches the words today, ⏳).
3. Optional: `leftoverPicks` answers/errors echo `sessionId`/`presetId`.

## ★ (built unless noted)

- ★E-1 copy beyond the drawing: unsaved-template guard on Move; caret reasons *(the default)*/*(automatic)*; *Mixed — leave as it is*; **Owner name**.
- ★E-2 the panel paragraph.
- ★E-3 (not built) a builder key's pick shows under the respond step's template as "…here…"; recommend *(set on ‹step heading› before layouts moved)* for picks from another step.
- ★E-4 (not built) one key with picks at two scopes shows two identical lines; recommend naming the scope (*the genre's* / *the ‹preset› preset's*) only when a key has more than one.

## Queued

1. Wire W5 in the library editors: `src/routes/pipelines/library/+page.svelte:1005` and `components/admin/TemplateChangeForm.svelte` ~473–497 (context path): `requestTemplateVariableLayouts({ nodeType })` + `variableLayouts={templateVariableLayoutsOf({ nodeType })?.keys}`.
2. Add `layout` to `CONTEXT_HANDLEBARS_HELPERS` (`shared/utils/templateCheckOptions.ts`) and the filter to `CONTEXT_LIQUID_FILTERS`; then drop `+ VARIABLE_LAYOUT_HELPER` in the comparison test.
3. `pipelines:templateVariableLayouts` typed twice: global `SocketEventMap` (`typedSocket.ts:2907`) and vl-A's local `variableLayoutsSockets.ts:44`; vl-A drops its copy.
4. vl-A's `:error` events need quiet-list entries in `Layout.svelte` if their pages show refusals in words.
5. Remove `variableTemplate?:` from `types.ts` with `read.ts`'s dead `variableTemplateRow`.

## Noticed, not done

- Editor layout data fetched once per panel mount and after a move; changes elsewhere show after a remount.
- A `leftoverPicks:error` while a press is pending is attributed to that press; with none pending it's dropped.
- Leftovers on a pipeline with no context template option have no line (W4 hangs under the template picker).
- A stray `variable-template-ref` option with `choices` would fall into the generic select branch (server no longer sends one).
- Reference completion replaces only from the opening quote to the caret.
- `PipelineConfigOptions.svelte`'s older `showRefusal` still toasts for other pipeline events (pre-existing).
- 4 `/tmp/serene-pub-vitest-*` dirs newer than the lane; none deleted (not this lane's: it opens no DB).
