# REPORT vl-N — Variable layouts: docs, NOMENCLATURE, STYLE-GUIDE — 2026-11-10

Saved by the lead from the supervisor's hand-back.

**Status:** all items done or answered. `docsContextTemplate.test.ts` 1/1; SDK `extendingCensus.test.ts` 166/166 (`npx tsx --test` in `sdk-tests`). `npm run docs:build` not run (it rewrites `src/lib/generated/docs` while a full vitest run was live); links and anchors in the edited docs checked by script: all added anchors resolve. Scope review: no objection; two low findings fixed.

## Changed files

- `NOMENCLATURE.md`: §15 variable template row (★1 UI word, resolution order, `layout` helper) + 4 rows (🚧 layout reference, 🚧 pub's layout, 🚧 preset's variable layouts, ⏳ leftover pick); §22 macro row nav label (Variable layouts); §23 three retired rows (per-step pick and its names; Variable templates nav label and routes; the no-host `unknown-layout` warning); §25 `### variable layouts — 2026-11-10`, 18 rows. One pass.
- `STYLE-GUIDE.md`: §6.11 (shapes table, Variable layouts paragraph, W6 in the waits-for-Save list), §6.12 (Written as, caret buttons, Layouts in this template), §6.17 (Change layouts, leftover lines).
- `../serene-pub-sdk/INTEGRATING.md` §5a: rows **Variable layouts** and **A preset's variable layouts**.
- `docs/context-templates.md`: Where they live; The editor; The variables (★6); § Variable layouts rewritten (same heading) with One choice for the whole pub / Writing your own / A preset may differ / A template may name one / three examples; Liquid table `layout` filter row; Templates are checked; Upgrading from 0.5 (All bare → Apply; Move into the template).
- `docs/pipelines.md` (named lines only): stored-pick list; band bullets; inspector reasons and missing reference; library bullets; § Presets Variable layouts + Small models example.
- `docs/getting-around.md:42`: Variable templates → Variable layouts.

## Answered, not done

- `docs/plugins.md` unchanged: it documents no template shipping. SDK guides not in this lane's files.

## Report-vs-code (documented the code)

1. W5 is wired in the library and `TemplateChangeForm` too (vl-F), so the docs say "wherever a context template is edited".
2. `variableLayoutsSockets.ts` deleted by vl-F; not in the ledger.
3. Resolution's "package default" is "the layout the pipeline's author named for the step, else the variable's default" (`config/world.ts:1240`).
4. vl-F's changes documented from code (Owner slug, W1 key, W6 candidates, `needs-owner-slug`).

## Noticed, not done

- Library *Used by* (`config/library.ts` `usageIndex`) counts only stored step values, so a layout used as the pub's / a preset's / by reference reads _Not used by any pipeline_ (docs say so). Code fix is the owner's call.
- SDK guide paragraph on `variableLayout()` not written (not this lane's files).
- `docs/getting-around.md:41` broken anchor `#starter-starter lorebooks` (pre-existing).
- Prettier fails on STYLE-GUIDE.md, context-templates.md, pipelines.md, getting-around.md at HEAD too; not reformatted.
