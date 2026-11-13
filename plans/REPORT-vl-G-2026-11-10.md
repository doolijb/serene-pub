# REPORT vl-G — Variable layouts: steps addressed by the panel's opaque handle — 2026-11-10

Saved by the lead from the supervisor's hand-back. Fixes the bug found in the lead's walk: the step-addressed events used raw node keys while the panel names steps only by `stepKeyFor` handles (`panel/ids.ts`, 05 §0a).

**Status:** done and passing. Server 3 files / 45 pass; client 10 files / 65 pass (variable-layouts dir re-ran 27/27). `tsc` clean. Scope review: no objection. No new `/tmp/serene-pub-vitest-*` dirs.

## Payloads after

- `pipelines:templateVariableLayouts`: `{ nodeType }` or `{ specSlug, stepKey }` → `{ <echo>, keys, stepHeading? }` (`stepHeading` = the panel's `step.heading`, `decl.stepHeading ?? decl.typeLabel`). Unknown handle: *"That step is not part of the pipeline '‹slug›'. A newer version may have removed it, or the link was made on a different install."*
- `pipelines:leftoverPicks` steps/picks carry `stepKey` (no `nodeKey`; tests assert its absence); `slot` kept (a declared slot name, not topology).
- `pipelines:clearLeftoverPick` `{ slug, scope, stepKey, slot, key, … }`; `pipelines:moveLeftoversIntoTemplate` `{ slug, stepKey, slot, ownerSlug?, … }`.
- Server resolves by search: new `locateStep(db, secret, specVersionId, stepKey)` (`config/variableLayoutsView.ts`); node keys stay internal in `leftoverPicks.ts` (private `clearPickAt`, used with `tx` by the move). Secret from `pubSecret()`.

## Changed

`shared/sockets/types.ts` (named types only); `server/pipelines/config/{variableLayoutsView,leftoverPicks}.ts`; `server/sockets/pipelinesVariableLayouts.ts`; `server/sockets/pipelines.ts` (leftover view + clear/move handlers only); client `pipelines/{templateVariableLayouts.svelte.ts,leftoverPicks.svelte.ts,StepVariableLayouts.svelte,PipelineConfigOptions.svelte}`; `admin/sections/variable-layouts/{Page.svelte,variableLayoutWords.ts}` (`parseStepParam` → `{ specSlug, stepKey }`; page-local `stepParam`); tests; NOMENCLATURE §25 (`locateStep`; the four events name a step by `stepKey`, answer adds `stepHeading`).

## New tests

A: reads `core:spec/story-respond`'s panel as the browser does, takes a context-template option's `step.key`, gets a non-error answer with `characters` in `keys` and `stepHeading === option.step.heading`. B: `core:spec/story-illustrate-scene` (two template options): a pick on the second option's node pairs with that option's `step.key`, no `nodeKey` present.

## ★ (built)

- ★G-1 `stepHeading` on the response (W1's `?step=` sentence used to match `scriptSeams[].nodeKey`, itself a leak). Recommended keep.
- ★G-2 fallback when neither heading nor library has arrived reads "Showing the variables  writes out." (double space). Recommend *a step in ‹pipeline›* / *this step*.

## Noticed, not done

- `Library.LibraryPipeline.scriptSeams[]` and `UseRow` still carry raw `nodeKey` in admin payloads (library/scripts events, not this lane's).
- `pipelines.ts`, `types.ts` fail `prettier --check` (pre-existing / vl-F repair noise).
- A leftover step with no template option of its own shows under none when a pipeline has more than one template option (from vl-E).
- A pick cleared on an unpublished pipeline gets "step is not part of this pipeline" (stale view only).
