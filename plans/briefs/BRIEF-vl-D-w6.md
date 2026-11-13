# BRIEF vl-D-w6 — Variable layouts: swap in the SDK's reference grammar, plugin seed slugs, "named by a template"

You are a `lane-worker` under supervisor `vl-D`. Repo: `/home/jody/github/serene-pub` (SDK at `/home/jody/github/serene-pub-sdk`, read only for you). Use absolute paths. Read `plans/PLAN-variable-layouts-2026-11-10.md` § Data items 1–2, § SDK items 10–12, and `plans/REPORT-vl-S-2026-11-10.md` (signatures) first. A sibling worker `w5` works at the same time on `prompt/*`, `entities/variableLayouts.ts`, `entities/contextTemplateFit.ts`, `shared/utils/context*`: stay out of those.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What exists

- **The SDK dist is rebuilt** with `parseVariableLayoutReference(value) → { owner, slug, major } | null`, `formatVariableLayoutReference({ owner, slug, major })`, `VARIABLE_LAYOUT_SLUG`, `TemplateSeed.slug` (optional, `kind: 'variables'` only), `variableLayout(pluginId, variable, { slug, major, label, engine, source })` (id `<pluginId>:template/<variable name kebabed as objectLayoutTemplateId>-<slug>@<major>`), and `variableLayoutCalls(engine, src) → { key, reference }[]` from `@serene-pub/sdk/template-check`.
- Earlier in this lane, before the dist existed, provisional local copies were written in `src/lib/server/pipelines/entities/objectVariableLayouts.ts` (`formatLayoutReference`, `parseLayoutReference`, `layoutSlugOf`, `variableMajorOf`, `coreLayoutReferenceFor`, `LayoutReferenceParts`), re-exported from `entities/variableTemplates.ts`, each marked `// ⏳ replaced by the SDK's once vl-S's dist is built`. The provisional owner grammar was `core` or `[a-z0-9]+(?:[-_.][a-z0-9]+)*`.
- `boot/registrySync.ts` `stampPluginLayoutReference` stamps plugin rows' references from the id's name segment, with `// ⏳ TemplateSeed.slug once vl-S's dist is built`, and an `it.todo` in `boot/layoutReferences.int.test.ts`.
- `entities/variableTemplates.ts` `deleteVariableTemplate` refuses while the row is the pub's layout, chosen by a preset, or held by a leftover pick; "named by a context template" is a `// ⏳` with an `it.todo` in `entities/variableTemplates.writes.int.test.ts`.
- `src/lib/server/pipelines/config/variableLayoutsView.ts` (w3, not yours) already counts templates naming a row with `variableLayoutCalls`; reuse its approach or factor a shared function if the counting belongs in the entity (you may export one from `variableTemplates.ts`, and say so; don't edit the view).

## Goal

1. **Swap in the SDK grammar.** Replace the provisional `formatLayoutReference`/`parseLayoutReference` bodies with the SDK's `formatVariableLayoutReference`/`parseVariableLayoutReference` (and `VARIABLE_LAYOUT_SLUG` for slug validation), keeping the app's exported names working for their callers, or move callers to the SDK names directly if that's cleaner (grep every caller: `variableTemplates.ts`, `seedVariableTemplates.ts`, `registrySync.ts`, `db/dataUpgrades/0151_shallow_marvel_zombies.ts`, `config/leftoverPicks.ts`, `sessions/presetEditor.ts`, `config/variableLayoutsView.ts`, tests; edit only the files you own, list any caller you don't own that should move). `layoutSlugOf` (name → kebab slug, with the two-entry override `Titled JSON block` → `titled-json`, `Titled block` → `titled`) stays app-side. Remove the ⏳ markers you resolve. **Check the grammar difference**: if the SDK's owner grammar rejects anything the provisional one accepted (or vice versa) and a reference was already written in that shape by the boot pass or data upgrade, stop and describe it. The data upgrade (`0151_…`) may import the SDK (stable package, not app code that drifts).
2. **`TemplateSeed.slug`.** In `stampPluginLayoutReference`, read the seed's `slug` before the id's name segment. **The template-id clash** (from the SDK report): `variableLayout(pid, objectVar, { slug: 'json', major: N })` produces the same template id as the app's automatic layout (`objectLayoutTemplateId`); make sure stamping handles that row as one row (no double stamp, no collision warning loop), and that a plugin row and an automatic row of one variable that would both get `<owner>/json@N` resolve deterministically (the existing collision rule: first by id keeps it, the other stays NULL with one warning). Turn the `it.todo` into a test: a plugin seed with `slug` gets `<owner>/<slug>@<major>`; **a second boot changes nothing**.
3. **"Named by a context template."** `deleteVariableTemplate` also refuses, in words, while any context template names the row's reference for a key that renders the row's variable (`variableLayoutCalls` over every context template's source, engine-aware; a plugin engine the checker can't read is skipped). Name the templates in the message (at most three, then "and N more"). Turn the `it.todo` into a test.

## Files owned (edit only these)

- `src/lib/server/pipelines/entities/objectVariableLayouts.ts`, `src/lib/server/pipelines/entities/variableTemplates.ts` + their tests (`variableTemplates.writes.int.test.ts`, `objectVariableLayouts*.test.ts`; not `variableTemplates.int.test.ts` unless a test there breaks from your change)
- `src/lib/server/pipelines/boot/seedVariableTemplates.ts`, `src/lib/server/pipelines/boot/registrySync.ts` (`stampPluginLayoutReference` / `writeTemplateSeed` only) + `boot/layoutReferences.int.test.ts`
- `src/lib/server/db/dataUpgrades/0151_shallow_marvel_zombies.ts` (imports only) + its tests

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**0.6 is in users' hands**: a change to stored data ships with a forward migration or boot pass and **a test that a second boot changes nothing**."
- A data upgrade "runs against the schema as it existed at its anchor migration … must not import app modules whose queries drift with the schema. Raw SQL through `tx` ages far better." (`dataUpgrades/index.ts`)
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "`defaults.ts` imports stay leaf; pass `db` explicitly."
- "**P2**: the layouts module owns its rows and every write to them."
- "**NOMENCLATURE §24**: grep every new name first." List every new name. Don't edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.
- Removing or renaming a published SDK name is the owner's call (you only consume the SDK).
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."

## Out of scope

Prompt/render files, `contextTemplateFit.ts` (w5); sockets; the views; client; SDK; docs.

## Stop and ask when

CLAUDE.md § Decisions applies; a grammar difference would change a reference already written; you need a file you don't own.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all; **don't start any dev server or dev instance**. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

Targeted tests pass: `boot/layoutReferences.int.test.ts`, `entities/variableTemplates.writes.int.test.ts`, `entities/variableTemplates.int.test.ts`, `0151_shallow_marvel_zombies.test.ts` + `.int.test.ts`, `objectVariableLayouts*` tests, `registrySync.int.test.ts`, `pluginTemplates.int.test.ts`, plus every test of a caller whose import you moved. `npx tsc --noEmit -p .` no errors in your files.

## Report

Return it as your final message (don't write a report file): changed files; each test file run with its result; any grammar difference found; callers you couldn't move; every new name; open questions; **Noticed, not done**.
