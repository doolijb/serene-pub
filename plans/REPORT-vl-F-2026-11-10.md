# REPORT vl-F — Variable layouts: cross-lane fix-ups — 2026-11-10

Saved by the lead from the supervisor's hand-back.

**Status:** items 1–15 built, except two of item 8's nine `:error` quiet entries (below). `npx tsc --noEmit -p .` clean. Client 18 files / 181 tests pass; server 9 files / 147 tests pass (incl. `layoutReferences` second-boot). Scope review: no objection on scope; two low findings answered.

## Incident: prettier over `src/lib/shared`

Worker w2 ran `npx prettier --write` over all of `src/lib/shared`, reformatting 151 files including other lanes' and another session's uncommitted work. Repaired without git:
- 118 formatting-only files restored to HEAD bytes (`git diff` empty for each).
- 32 mixed files rebuilt with HEAD formatting outside changed hunks (three-way), written only when prettier(result) == prettier(current), so no content lost. 23 cleanly; 9 keep formatting noise inside changed hunks: `lorebooks/sessionNotes.ts`, `sessions/sceneSettings.ts`, `sockets/types.ts`, `state/ledgerLines.ts`, `state/ledgerLines.test.ts`, `state/ledgerLines.clockNote.test.ts`, `utils/templateAssist.ts`, `utils/templateCheckOptions.test.ts`, `utils/templateDiagnostics.ts`.
- Same repair for five worker-touched files outside `shared/`: `Layout.svelte`, `typedSocket.ts`, `TemplateChangeForm.svelte`, `routes/pipelines/library/+page.svelte`, `logbookView.test.ts`.
- One untracked file could not be restored (no HEAD copy), formatting only: `src/lib/shared/sessions/narratorCadence.ts`. (The lead checked mtimes: no other untracked file in `src/lib/shared` was rewritten.)
- Logs: `/tmp/claude-1000/-home-jody-github-serene-pub/be7b28c7-292d-48c1-a5b4-dd1f19a6d7d9/scratchpad/vlF/` (`touched.txt`, `pure.txt`, `mixed.txt`, `m_ok.txt`, `unfmt_ok.txt`, `unfmt_fail.txt`, `untracked.txt`). The other session (serene-pub-d9) was told.

## Changed

- `shared/sockets/types.ts`: `VariableLayouts.ForTemplate.Echo` / `.Response extends Echo` / `.Refusal`; `LeftoverPicks.Response` echoes `sessionId`/`presetId`, `LeftoverPicks.Refusal`; `MoveLeftoversIntoTemplate.RefusalCode = "needs-owner-slug"`, `.Refusal`; `PresetVariableLayouts.Response.candidates?`; `ListRow.key`; dead `ConfigOption.variableTemplate?` removed.
- Server: `sockets/pipelinesVariableLayouts.ts` (echo on answer and every `:error`); `config/leftoverPicks.ts` (`code`; words now "your owner slug, for example 'acme'"); `sockets/pipelines.ts` (`leftoverEcho`: `slug`, `sessionId`, `presetId` on every answer/`:error` of the three leftover events); `config/variableLayoutsView.ts` (`key`; `variablesRenderedByPipelines`); `sessions/presetEditor.ts` (`candidates`); `entities/variableTemplates.ts` (`referenceOf` refuses `core` for a person's row: *"core is Serene Pub's own. Use an owner slug of your own."*); `config/panel/read.ts` (dead `variableTemplateRow` removed). Int tests extended.
- Client: `Layout.svelte` (`HANDLED_ERROR_EVENTS` += six); `typedSocket.ts` (seven events + `:error`s; leftover/template errors retyped); `variable-layouts/variableLayoutsSockets.ts` deleted, callers use the registry; `templateVariableLayouts.svelte.ts` rewritten (one in flight per target, matched by echo; queue, timeout, ⏳ gone); `leftoverPicks.svelte.ts` (echo checks; `code`); W1 `Page.svelte` (shared store for `?step=`; `key` in mono, searchable); library `+page.svelte` and `TemplateChangeForm.svelte` (W5 wired); `templateCheckOptions.ts` + test (`"layout"` in both lists); `StepVariableLayouts.svelte` (**Owner slug**, `ownerSlugProblem`, problem in words); `PresetVariableLayouts.svelte` (candidates with layouts, by shelf); `shared/adminLogbook.ts` (label *variable layout*; links by id shape: variable id → its page, null → W1, row id → the existing redirect). Tests added for each.

## Decisions

- Error echoes include `slug` too, so a view filters refusals.
- The library asks W5 once per distinct step type when the Templates tab opens (several editors in an `{#each}`).
- The logbook links a row id through `/admin/variable-templates/<id>` (the redirect), because the logbook doesn't record the variable.

## Open

- `pipelines:libraryVariables:error` (sent by `PresetVariableLayouts.svelte`, no listener) and `pipelines:libraryUseEverywhereCounts:error` (sent by `VariableLayoutForm.svelte`, no listener) are not quieted, so a failure still toasts from the shell rather than vanishing.

## New names

`code: "needs-owner-slug"`, `candidates`, `ListRow.key`, `ForTemplate.Echo`, `ForTemplate.Refusal`, `LeftoverPicks.Refusal`, `MoveLeftoversIntoTemplate.RefusalCode` / `.Refusal`, `variablesRenderedByPipelines`, `LeftoverPickRefusal.code` (private: `leftoverEcho`, `isPersonsRow`). The lead added the missing ones to NOMENCLATURE §25.

## Noticed, not done

- `config/panel/choices.ts` ~369 `sets.variableTemplateRows` has no reader.
- `pipelines:libraryCreateTemplate:error` / `:libraryUpdateTemplate:error` / `:libraryCloneTemplate:error` not in `HANDLED_ERROR_EVENTS`; may toast twice.
- `awaitReply`'s `:error` for variable-layout writes carries no echo (existing).
- W1 `?step=` narrows from the store's last answer until a fresh one lands.
- The W5 store has no timeout; a lost answer keeps its target in flight until reload.
- Leftover presses attributed oldest-first within a view (server doesn't echo the step).
- `prettier --check` flags `entities/variableTemplates.ts`, `config/leftoverPicks.ts`.
