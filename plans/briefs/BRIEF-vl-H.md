# BRIEF vl-H — Variable layouts: owner follow-ups (2026-11-11)

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then `plans/PLAN-variable-layouts-2026-11-10.md` (header: "Owner rulings 2026-11-11"), then `plans/REPORT-vl-{D,E,F,G}-2026-11-10.md`. Four small items, all ruled by the owner. Use at most 2 `lane-worker`s, briefs at `plans/briefs/BRIEF-vl-H-w<n>.md`; quote the rules below into each.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

1. **Leftover lines name step and level (★E-3, ★E-4).** In the pipeline panel's leftover-pick lines (`StepVariableLayouts.svelte`, fed by `pipelines:leftoverPicks`):
   - A pick whose step isn't the step its line sits under (e.g. the context builder's pick shown under the respond step's template) reads *‹Variable› uses ‹layout› (set on ‹step heading› before layouts moved).* instead of *…here…*. The server sends the step heading it already knows how to make (the panel's `step.heading`: `decl.stepHeading ?? decl.typeLabel`; vl-G added the same for `templateVariableLayouts`); never a node key.
   - When one variable has picks at more than one level in the same view, each of its lines names the level: *the genre's* / *the ‹preset name› preset's* (instance-scope picks: *the pipeline's*). A variable with one pick names no level. The server sends a preset's name with a preset-scope pick.
2. **Library *Used by* counts all uses.** `src/lib/server/pipelines/config/library.ts` `usageIndex` (and whatever the library's variable-layout rows read for *Used by*) counts a layout row's use as the pub's layout, as a preset's variable layout (by reference), and as a reference named by a context template, as well as leftover per-step picks. Reuse what the W2 view already computes (`config/variableLayoutsView.ts`: `namedByTemplates`, `chosenByPresets`, `inUse`) rather than a second rule. The words: follow the existing *Used by* list's shape; add an entry kind for each new use in plain words (*This pub's layout* · *Preset ‹name›* · *Named by ‹template name›*). Update the docs sentence vl-N wrote in `docs/pipelines.md` (library bullets) that says the count is limited.
3. **Count tests.** `src/lib/server/pipelines/boot/seedVariableTemplates.int.test.ts` (29 vs 28) and `src/lib/server/pipelines/entities/variableTemplates.parity.test.ts` (`inflectionTag`) include the speech catalogue's `inflection-tag` layout row (core-catalog `seed/speechTemplates.ts`). Fix the expectations so they derive from the shipped lists rather than a hand count where the test can; no product change.
4. **★G-2 copy.** `admin/sections/variable-layouts/Page.svelte` / `variableLayoutWords.ts` `stepWords`: when the step heading hasn't arrived, the filter line reads *Showing the variables a step in ‹pipeline label› writes out.*; when the pipeline label hasn't arrived either, *Showing the variables this step writes out.* Same fallbacks on the error path's sentence. No double spaces.

## Files owned

`src/lib/server/pipelines/config/{leftoverPicks,library,variableLayoutsView}.ts`, `src/lib/server/sockets/pipelines.ts` (the leftover view and the library's usage only), `src/lib/shared/sockets/types.ts` (the `LeftoverPicks` and library usage types only), `src/lib/client/components/pipelines/StepVariableLayouts.svelte`, the library page's *Used by* rendering (`src/routes/pipelines/library/+page.svelte`, that part only), `src/lib/client/admin/sections/variable-layouts/{Page.svelte,variableLayoutWords.ts}`, the two count tests, `docs/pipelines.md` (the one library sentence only), and the tests of all of these. `NOMENCLATURE.md` §25: one row for any new field name.

## Rules (quote into worker briefs)

- **No node key in a panel payload** (`panel/ids.ts`, 05 §0a): steps are named by `stepKey` and headings.
- Sockets: one domain context per event family is the only listener and toaster; views never call `toaster`; `socket.off(event)` needs the handler.
- **Never run `npx prettier --write` on a directory or glob**: only on a file you changed, by name, or not at all. Use `npx prettier --check <file>`.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Pass `db` explicitly in tests. Int tests opening a DB inside an `it` need 60 s. Never pipe vitest into `head`.
- **NOMENCLATURE §24**: grep any new name first; record it in §25.
- `docs/pipelines.md` has another session's sections (history / scenes-first, **Summaries and the lorebook**, **For plugin authors**): touch only the one library sentence.

## Out of scope

Everything else, including W1 shelf headings (★A ruled: keep the filter only).

## Stop and ask when

CLAUDE.md § Decisions applies; an item needs a file not listed.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally: do not run `npm run sdk:build`, and do not start any dev server or `vite dev`.**

## Done means

- Tests: a leftover line from another step names it; two levels name both, one level names none; *Used by* lists the pub's layout, a preset's choice and a template reference for a row; the two count tests pass; both fallback sentences.
- Rerun: `src/lib/server/sockets/{pipelines.leftoverPicks,pipelinesVariableLayouts}.int.test.ts`, `src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts`, `src/lib/client/admin/sections/variable-layouts/`, and the library tests you touch.
- `npx tsc --noEmit -p .` clean. A `scope-reviewer` run on your diff, findings answered.

## Report

Return it as your final message (the lead saves it to `plans/REPORT-vl-H-2026-11-11.md`): changed files, tests run with results, new names, **Noticed, not done**.
