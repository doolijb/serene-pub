# BRIEF vl-H-w1 — Leftover lines name step and level; W1 step fallback words (2026-11-11)

You are a `lane-worker` under lane supervisor vl-H. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (read these, by range)

- `src/lib/server/pipelines/config/leftoverPicks.ts` lines 1–420 (`planOf`, `stepTemplate`, `leftoverPicksFor`).
- `src/lib/server/pipelines/config/variableLayoutsView.ts` ~845–929 (`templateVariableLayouts`: how vl-G computes `stepHeading` = the panel's `step.heading` = `decl.stepHeading ?? decl.typeLabel` from `declarationsAndVariableKeys(...).decls.find(d => d.nodeKey === nodeKey)`).
- `src/lib/server/pipelines/config/panel/declarations.ts` ~1110–1125 (how `stepHeading` is set: `expose.label` else the definition's name).
- `src/lib/shared/sockets/types.ts` ~11936 `namespace LeftoverPicks`.
- `src/lib/client/components/pipelines/StepVariableLayouts.svelte` (whole, 148 lines) and `PipelineConfigOptions.svelte` ~190–205 (`leftoverStepsFor`: a step shows under its own template option; a step with no template option of its own shows under the pipeline's only one — the context builder's picks show under the respond step's template). **Do not edit `PipelineConfigOptions.svelte`.**
- `src/lib/client/admin/sections/variable-layouts/Page.svelte` ~95–200 (`stepWords`) and `variableLayoutWords.ts`.

## Goal

### A. Leftover lines name the step (★E-3, owner-ruled 2026-11-11)

Server (`leftoverPicks.ts`): on each `LeftoverStep`, add `stepHeading?: string`, **sent only when the step's lines show under another step's context template** — i.e. in `stepTemplate` the template decl used is not on the step's own node (the fallback to the pipeline's one template decl). The value is the panel's `step.heading` for the step's own node: `decl.stepHeading ?? decl.typeLabel` from the `decls` `planOf` already has (`decls.find(d => d.nodeKey === nodeKey)`). If the node has no decl at all, compute the same rule from the node row: its `expose.label` (i18nText), else its registry definition's `i18n.name`, else `humanizeTypeId(definitionId)` — check first whether the shipped context builder in `core:spec/story-respond` has a decl; only write the fallback if it is needed, as a small private helper. Never send a node key.

Client line, when `step.stepHeading` is present: *‹Variable› uses ‹layout› (set on ‹step heading› before layouts moved).* Otherwise unchanged: *‹Variable› uses ‹layout› here (set before layouts moved).*

### B. Leftover lines name the level when a variable has picks at more than one (★E-4, owner-ruled)

Server: on each `LeftoverPick` whose `scope.kind === "preset"`, add `presetName?: string` (the preset's `name`; `presetName` is already the word for a preset's name elsewhere in `types.ts`). Keep `scope` itself unchanged (the client sends `scope` back on clear; the test at `pipelines.leftoverPicks.int.test.ts` ~370 asserts its exact shape). Genre- and instance-scope picks carry no new field (the test ~318 asserts a genre pick with `toEqual`).

Client: among all picks shown together in one `StepVariableLayouts` (across all its `steps`), when one `variableId` has picks at more than one **scope kind**, each of that variable's lines names its level, as a possessive before the layout name; a variable with picks at one level names none:

- genre: *the genre's* · preset: *the ‹presetName› preset's* (no name → *the preset's*) · instance: *the pipeline's*
- *‹Variable› uses the genre's ‹layout› here (set before layouts moved).*
- *‹Variable› uses the Quick start preset's ‹layout› (set on ‹step heading› before layouts moved).*

Put the sentence in a pure exported function in `variableLayoutWords.ts` (e.g. `leftoverLineWords(pick, { stepHeading, levelNamed })` plus a helper that finds the variables needing a level) and call it from the component. No double spaces in any form.

### C. W1 filter line fallbacks (★G-2, owner-ruled)

`Page.svelte` `stepWords`: move to a pure exported `stepWords(heading?: string, pipelineLabel?: string): string` in `variableLayoutWords.ts`:
- heading and label → *‹heading› in ‹label›* (as today); heading only → *‹heading›* (as today);
- no heading, label → *a step in ‹label›*; neither → *this step*.
So the line reads *Showing the variables a step in ‹pipeline label› writes out.* / *Showing the variables this step writes out.*, and the error path *The variables this step writes out could not be found: …* uses the same words. Page.svelte calls it with `stepAnswer?.stepHeading` and the pipeline's label. No double spaces.

## Files owned (edit only these)

- `src/lib/server/pipelines/config/leftoverPicks.ts`
- `src/lib/server/sockets/pipelines.ts` — only if the leftover view's answer needs it (it probably passes `leftoverPicksFor` through unchanged; don't touch otherwise)
- `src/lib/shared/sockets/types.ts` — `LeftoverPicks.Pick` and `LeftoverPicks.Step` only (add the two fields with one-line docs)
- `src/lib/client/components/pipelines/StepVariableLayouts.svelte`
- `src/lib/client/admin/sections/variable-layouts/Page.svelte`, `variableLayoutWords.ts`
- Tests: `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts`, `src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts`, `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.test.ts`, `src/lib/client/admin/sections/variable-layouts/variableLayoutsPage.dom.test.svelte.ts`

## Files readable

Anything. Do **not** edit `library.ts`, `variableLayoutsView.ts`, `pipelinesVariableLayouts.int.test.ts`, `docs/`, `NOMENCLATURE.md` (another worker / the supervisor own them).

## Rules (quoted by the supervisor)

- **No node key in a panel payload** (`panel/ids.ts`, 05 §0a): steps are named by `stepKey` and headings.
- Sockets: one domain context per event family is the only listener and toaster; views never call `toaster`; `socket.off(event)` needs the handler.
- **Never run `npx prettier --write` on a directory or glob**: only on a file you changed, by name, or not at all. Use `npx prettier --check <file>`.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Pass `db` explicitly in tests. Int tests opening a DB inside an `it` need 60 s. Never pipe vitest into `head`.
- NOMENCLATURE §1 R1: one word, one meaning. `stepHeading` and `presetName` keep the meanings they already have; introduce no other new field names. The supervisor records both in §25.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` is not reactive on mutation (use `SvelteSet`/plain derived values).
- It is a **session**, never a *chat*.

## Out of scope

Everything else, including how `PipelineConfigOptions.svelte` pairs steps with options, the move/clear behaviour, and any other copy.

## Stop and ask when

You'd need a file not listed, a new name beyond the two fields, or the shipped data makes the "sent only when under another step" rule disagree with the client's pairing (say how).

## Done means

Tests (add them):
- int (`pipelines.leftoverPicks.int.test.ts`): a genre pick on a key the context builder lays out (not the `prompt` step) comes back on a step with `stepHeading` equal to that step's panel heading and no `nodeKey` anywhere; a pick on the `prompt` step (own template) has no `stepHeading`; a preset-scope pick carries `presetName`; a genre pick carries none. Clean up what each test writes so the existing tests' expectations hold (they use `toEqual([])`).
- dom (`stepVariableLayouts.dom.test.ts`): a line from another step names it; one variable at two levels names both (genre + preset with name); a variable at one level names none.
- words tests for `leftoverLineWords` and `stepWords` (all four `stepWords` cases); page dom test still passes (update if the fallback now shows).

Run, each by file (never piped into `head`):
`npx vitest run src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts src/lib/client/admin/sections/variable-layouts/`
and `npx tsc --noEmit -p .` (report any error in your files; errors elsewhere just list).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Additionally: do not run `npm run sdk:build` at all, and do not start any dev server or `vite dev`.

## Report

Return as your final message: changed files (with what changed), tests run with pass/fail counts, any name you introduced, decisions you made, **Noticed, not done**.
