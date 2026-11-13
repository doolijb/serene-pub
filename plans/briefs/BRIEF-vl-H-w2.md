# BRIEF vl-H-w2 — Library *Used by* counts every use; speech-row count tests (2026-11-11)

You are a `lane-worker` under lane supervisor vl-H. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (read these, by range)

- `src/lib/server/pipelines/config/library.ts` 1–40, 280–480 (`LibraryTemplate.usedBy`, `usageIndex`), 560–697 (`libraryView`, the `variableTemplates` rows).
- `src/lib/server/pipelines/config/variableLayoutsView.ts` 120–290 (`liveRows`, `presetChoices`, `layoutInUse`), 330–520 (`renderingSteps`, `keysByNodeType`, `scanContextTemplates`), 520–640 (`variableLayoutView`: how W2 computes `namedByTemplates` and `chosenByPresets` per row).
- `src/routes/pipelines/library/+page.svelte` ~215–240 (`deleteTemplate` confirm), ~979 and ~1226–1238 (the `usage` snippet: *Used by a, b* / *Not used by any pipeline*).
- `docs/pipelines.md` line ~421 (the Variable layouts tab bullet).
- `src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts` (setup, and the namedBy test ~486).
- `src/lib/server/pipelines/boot/seedVariableTemplates.ts` 55–82 (what the seeder ships: `SHIPPED_VARIABLE_TEMPLATES`, `coreObjectLayouts()` minus speech seed keys, `SHIPPED_SPEECH_VARIABLE_LAYOUTS` from `@serene-pub/core-catalog`).

## Goal

### A. Library *Used by* counts all uses of a variable layout (owner-ruled 2026-11-11)

Today a variable-layout row's `usedBy` in `libraryView` lists only pipelines whose steps hold a ⏳ leftover pick (`usageIndex` over registration/instance values). It must also list:

1. *This pub's layout* — when the row is the pub's layout for its variable (`pubDefault`). Only the pub's own choice, not the package default.
2. *Preset ‹name›* — one entry per preset whose variable layouts choose the row (by reference: `preset.variable_layouts[row.variableId] === row.reference`).
3. *Named by ‹template name›* — one entry per context template that names the row's reference in a `layout` call for a key that renders the row's variable (W2's `namedBy` rule).

**Reuse, never a second rule.** In `variableLayoutsView.ts`, extract the per-row computation W2 already does into one exported function (suggested name `layoutRowUses(db, rows)` returning, per row id, `{ pub: boolean; presets: {id,name}[]; namedBy: {id,name}[] }`; add `name` to `ScannedTemplate`). `variableLayoutView` then derives `chosenByPresets` and `namedByTemplates` (= `namedBy.length`) from it, with **unchanged** output (existing tests must still pass). `libraryView` calls the same function with its own variable rows (the library's list, which already excludes a disabled plugin's rows) and builds `usedBy` as: *This pub's layout* first, then *Preset ‹name›* entries sorted by name, then *Named by ‹name›* entries sorted by name, then the leftover pipelines (sorted, as today). Keep `usedBy: string[]` — the existing list's shape; no new field, no client type change. The page's existing `usage` snippet then shows *Used by This pub's layout, Preset Quick start, Named by Mixed reader, Reply · Chat* with no page change needed; confirm that is so, and change `+page.svelte` only if something reads wrong (that part only; tell the supervisor first if you think it needs to).

Mind the import direction: if importing `variableLayoutsView.ts` from `library.ts` creates a cycle, use a dynamic `await import(...)` as `library.ts` already does elsewhere.

### B. Docs sentence

In `docs/pipelines.md`, replace only the one bullet that starts *On the **Variable layouts** tab, a layout's _Used by_ names only steps…* with:

> - On the **Variable layouts** tab, a layout's _Used by_ names everything that uses it: _This pub's layout_ when the pub writes its variable out with it, _Preset ‹name›_ for each preset that chooses it, _Named by ‹template›_ for each context template that names it, and the pipelines whose steps still hold a pick from before layouts moved. Which layout is in use is on the variable's page in **Admin › Variable layouts**. Deleting a layout here is refused the same way as there.

Touch nothing else in that file (other sessions own other sections).

### C. Count tests (no product change)

- `src/lib/server/pipelines/boot/seedVariableTemplates.int.test.ts` "still ships exactly one row per shipped layout": expected count must include `SHIPPED_SPEECH_VARIABLE_LAYOUTS` the way the seeder does (automatic rows whose seed key a speech row takes are not separate rows). Derive it from the same lists: e.g. `new Set([...SHIPPED_VARIABLE_TEMPLATES.map(seedKeyFor), ...coreObjectLayouts().map(t => t.seedKey), ...SHIPPED_SPEECH_VARIABLE_LAYOUTS.map(t => t.seedKey)]).size`, and fix the comment.
- `src/lib/server/pipelines/entities/variableTemplates.parity.test.ts` ~466 "covers every key any node declares": the expected key set must include the speech layouts' keys (`SHIPPED_SPEECH_VARIABLE_LAYOUTS[].key`, e.g. `inflectionTag`), derived from the list, not hand-added. Check nothing further down the same test then misreads the speech rows.

## Files owned (edit only these)

- `src/lib/server/pipelines/config/library.ts`, `src/lib/server/pipelines/config/variableLayoutsView.ts`
- `src/routes/pipelines/library/+page.svelte` — the *Used by* rendering only, and only if needed
- `docs/pipelines.md` — the one bullet above only
- Tests: `src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts`, `src/lib/server/pipelines/boot/seedVariableTemplates.int.test.ts`, `src/lib/server/pipelines/entities/variableTemplates.parity.test.ts`

## Files readable

Anything. Do **not** edit `leftoverPicks.ts`, `StepVariableLayouts.svelte`, `variable-layouts/*`, `shared/sockets/types.ts`, `pipelines.leftoverPicks.int.test.ts`, `NOMENCLATURE.md` (another worker / the supervisor own them).

## Rules (quoted by the supervisor)

- **No node key in a panel payload** (`panel/ids.ts`, 05 §0a): steps are named by `stepKey` and headings.
- **Never run `npx prettier --write` on a directory or glob**: only on a file you changed, by name, or not at all. Use `npx prettier --check <file>`.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Pass `db` explicitly in tests. Int tests opening a DB inside an `it` need 60 s. Never pipe vitest into `head`.
- `docs/pipelines.md` has another session's sections (history / scenes-first, **Summaries and the lorebook**, **For plugin authors**): touch only the one library sentence.
- NOMENCLATURE §1 R1/R3: one word, one meaning; qualify. The UI words are fixed above; introduce no other new name besides the one extracted function. Report its name; the supervisor records it in §25.
- P2: read the presets and templates through what `variableLayoutsView.ts` already reads; no new writer of anything.

## Out of scope

Everything else: the delete refusal's rules, other tabs' *Used by*, the *Not used by any pipeline* wording, the W1/W2 pages.

## Stop and ask when

You'd need a file not listed, a new field or name beyond the one function, or the reuse changes W2's existing output.

## Done means

Tests (add to `pipelinesVariableLayouts.int.test.ts`, its own `describe`): for one row, `libraryView` / the `pipelines:library` answer's variable-layout row `usedBy` contains *This pub's layout* (after `librarySetPubLayout`), *Preset ‹name›* (a preset whose `variable_layouts` names the row's reference), and *Named by ‹template name›* (a context template that names the reference), in that order; restore what you set so later tests hold. The two count tests pass. Existing W2 tests unchanged and passing.

Run, each by file (never piped into `head`):
`npx vitest run src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts src/lib/server/pipelines/boot/seedVariableTemplates.int.test.ts src/lib/server/pipelines/entities/variableTemplates.parity.test.ts`
plus any existing library test that reads `usedBy` for variable rows (grep `usedBy` in `src/lib/server/**/*.test.ts`), and `npx tsc --noEmit -p .` (report errors in your files; errors elsewhere just list).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Additionally: do not run `npm run sdk:build` at all, and do not start any dev server or `vite dev`.

## Report

Return as your final message: changed files (with what changed), tests run with pass/fail counts, any name you introduced, decisions you made, **Noticed, not done**.
