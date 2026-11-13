# REPORT vl-H — Variable layouts: owner follow-ups — 2026-11-11

Saved by the lead from the supervisor's hand-back.

**Status:** items 1–4 built. Client, words and parity tests pass (6 files / 377 tests, incl. the fixed `inflectionTag` parity test). **Three int suites written but not yet run:** every int suite fails in `beforeAll` at `bootstrapPipelines` ("core binds a handler to `core:outlet/set-seat-bench@1`, which no type in this build declares"): the SDK contracts dist is stale behind the other session's benched-seats source. Rerun after its `sdk:build`: `sockets/pipelines.leftoverPicks.int.test.ts`, `sockets/pipelinesVariableLayouts.int.test.ts`, `pipelines/boot/seedVariableTemplates.int.test.ts`. `tsc` clean in lane files (2 errors in `runtime/bindings.ts:8452-8453`, same cause). Scope review: no objection; three low findings answered.

## Changed

- `server/pipelines/config/leftoverPicks.ts`: `LeftoverStep.stepHeading?` (the panel's `step.heading`, sent only when the step's lines sit under another step's template), `LeftoverPick.presetName?` (preset-scope picks). No node key.
- `shared/sockets/types.ts`: those two fields only.
- `client/components/pipelines/StepVariableLayouts.svelte`: lines from `leftoverLineWords`; levels named for variables with picks at more than one scope kind, across the steps one component shows.
- `admin/sections/variable-layouts/variableLayoutWords.ts`: `stepWords(heading?, pipelineLabel?)`, `variablesAtSeveralLevels(picks)`, `leftoverLineWords(pick, { stepHeading?, levelNamed? })`; `Page.svelte` uses `stepWords` on both paths.
- `server/pipelines/config/variableLayoutsView.ts`: `ScannedTemplate.name`, exported `layoutRowUses(db, rows)` / `LayoutRowUses` (`{ pub, presets, namedBy }`); W2's `chosenByPresets` / `namedByTemplates` built from it (unused `presetChoices` call removed).
- `server/pipelines/config/library.ts`: a variable-layout row's `usedBy` lists *This pub's layout* (pub choice only), *Preset ‹name›* (sorted), *Named by ‹template›* (sorted), then leftover pipelines.
- `docs/pipelines.md:421` (one library bullet). NOMENCLATURE §25: one row (~3578).
- Tests: `pipelines.leftoverPicks.int` (stepHeading equals panel heading, no node key; `presetName`), `stepVariableLayouts.dom` (another step named; two levels named; one level none), `variableLayoutWords.test` (four `stepWords` cases; `leftoverLineWords`), `pipelinesVariableLayouts.int` (*Used by* order), `seedVariableTemplates.int` (count from distinct seed keys across `SHIPPED_VARIABLE_TEMPLATES`, `coreObjectLayouts()`, `SHIPPED_SPEECH_VARIABLE_LAYOUTS`), `variableTemplates.parity` (speech keys from the list).

## Decisions

- Level wording puts the possessive before the layout: *Characters uses the genre's JSON here (set before layouts moved).* / *… uses the Quick start preset's JSON (set on ‹heading› before layouts moved).*; unnamed preset → *the preset's*.
- *This pub's layout* counts only `pubDefault`, not the package default.

## Queued for the lead

`docs/context-templates.md:448` and `STYLE-GUIDE.md:2101` still describe only *‹Variable› uses ‹layout› here (set before layouts moved).*

## Noticed, not done

- Library *Used by* follows W2's narrow named-by rule; the delete refusal uses the broader `contextTemplatesNaming` (`entities/variableTemplates.ts:677`), so the library can say nothing uses a row the server still refuses to delete (not a regression).
- `library/+page.svelte` `deleteTemplate` says "The server will refuse until those point somewhere else" for any non-empty `usedBy`; may overstate.
- A leftover step whose node has no panel decl gets no `stepHeading` (reads *here*); shipped Story respond is covered.
- Picks from two genres on one variable are one level, so neither names a level.
- Server "under another step" pairing matches the client only while every `context-template-ref` decl reaches the admin's option list.
- Int runs that died in `beforeAll` may have left `/tmp/serene-pub-vitest-*` dirs; none deleted.

## Lead follow-up (2026-11-11)

After the other session's `sdk:build`, the three int suites ran: 2 new tests failed on test bugs, fixed by the lead:
- `pipelines.leftoverPicks.int.test.ts`: the new test sat between a test that stores *Old pick* and the "Use the pub's" test that clears it (the file's tests chain), so it saw two steps; moved after "Use the pub's". Its no-node-key check matched the heading *Build template context* followed by a quote; now checks for the key as a whole JSON value.
- `pipelinesVariableLayouts.int.test.ts`: looked up `core/json@1` without the variable (references are unique per variable); now filters by `CHARACTERS`. `ask` now also finds handlers in `./pipelines` (`pipelinesLibrary`).
Result: 3 files / 47 pass; `tsc` clean. Docs and STYLE-GUIDE lines for the new leftover forms added by the lead.

## Known issues fixed (lead, 2026-11-11)

- **Used by vs delete:** `deleteVariableTemplate` now reads `layoutRowUses` (the rule W2 and the library show) for its preset and named-by refusals; the broader `contextTemplatesNaming` is removed. A dangling reference still degrades at render (`missingReference` in the receipt). The library's delete confirm ("The server will refuse…") is now accurate for layouts.
- **Double toasts:** `pipelines:library{Create,Clone,Update}Template:error` added to Layout's `HANDLED_ERROR_EVENTS` (every sender says them itself); test in `layoutHandledErrors.test.ts`.
- **Dead code:** `panel/choices.ts` `variableTemplateRows` and its query removed (no reader).
- **replyRoad.int:** passes today (16 failures in the full run were not reproduced in isolation).
- **narratorCadence.ts:** now used by another session's work; passes `prettier --check`; nothing to do.
- Not changed: `scriptSeams`/`UseRow` node keys (scripts admin payloads, outside 05 §0a's panel rule and this area).
- Tests: 14 files / 478 pass (layout suites, writes, presets, W1–W6 DOM, handled-errors); `tsc` clean.
