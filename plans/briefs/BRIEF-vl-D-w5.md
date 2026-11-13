# BRIEF vl-D-w5 — Variable layouts: explicit references (render pre-pass, `layout` helper/filter, T1)

You are a `lane-worker` under supervisor `vl-D`. Repo: `/home/jody/github/serene-pub` (SDK at `/home/jody/github/serene-pub-sdk`, read only for you). Use absolute paths. Read `plans/PLAN-variable-layouts-2026-11-10.md` § "The rule this plan applies", § W5, § Render path items 5–8, and `plans/REPORT-vl-S-2026-11-10.md` (the SDK signatures and check rules) before starting. A sibling worker `w6` works at the same time on `entities/variableTemplates.ts`, `entities/objectVariableLayouts.ts`, `boot/*`, `db/dataUpgrades/*`: stay out of those.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What exists

- **The SDK dist is rebuilt** with `variableLayoutCalls(engine, src) → { key, reference }[]` (`@serene-pub/sdk/template-check`: every `layout` call with a simple key and a literal reference, source order, duplicates kept, `[]` on syntax error), `laidOutScope(scope, renders)`, `variableLayoutOffersFor`, `VARIABLE_LAYOUT_HELPER` (`'layout'`), `checkTemplateSourceReport(..., { variableLayoutOffers: { [variableId]: [{ reference, label }] } })`, finding kinds `layout-argument`, `unknown-layout`; `templateFit.ts` already has sentences for both kinds. **With no offers supplied, a well-formed reference passes silently**, so every host check must pass `variableLayoutOffers` (built per variable across the whole pub: every non-withdrawn row with a reference; it doesn't depend on the step).
- Run resolution (`config/world.ts`): per key, `leftover → preset → pub → default → floor`, each `ResolvedLayouts[key]` entry carrying `reason: LayoutReason` (`"leftover" | "preset" | "pub" | "default" | "template"`); `layoutUseOf` records `{ key, variableId, layout, origin, reason }` on the node output's `layouts` (the run inspector reads it).
- ★6 is built: for core's Handlebars engine, non-empty laid-out values reach the template as `Handlebars.SafeString` (`laidOutForHandlebars` in `entities/variableLayouts.ts`, `laidOutSafeFor` in `prompt/assemble.ts`, `LAID_OUT_CONTEXT_KEYS` in `prompt/templateContext.ts`, `sampleContext(layouts, engine?)` in `prompt/preview.ts`).
- `entities/variableTemplates.ts` (import only): `layoutByReference(db, variableId, reference)`, `listVariableTemplates`, `resolveVariableTemplate`. `config/panel/declarations.ts` `declarationsAndVariableKeys` → `variableKeys` (`{ nodeKey, slot, path, variableId, band?, engines }`).

## Goal

### 1. The render pre-pass (Render item 6) and the `layout` helper/filter
Decided by the supervisor (an implementation choice inside scope): **the pre-pass rewrites each call's first argument from the key to the key's name as a string literal, and the helper/filter look the pre-rendered text up by `(key, reference)` in a per-render map carried in the render context under one reserved key.**
- Where values are laid out and a context template is rendered (`prompt/assemble.ts` ~751-790 `render()`; and the same laying-out in `prompt/templateContext.ts` and `prompt/preview.ts` if they render a context template; check each): run `variableLayoutCalls(engine, template)` for core's Handlebars and Liquid engines only. For each distinct `{ key, reference }`: the key's variable (`variableOfKey(input.variables, key)`); `layoutByReference` for that variable → `resolveVariableTemplate` → render through `renderVariable` with a layouts entry `{ variableId, engine, source, name, origin, reason: "template" }`, **inside the same sequential laying-out loop** (keeps plugin engines and cancellation working; pass `run` as the loop does). Assemble is handed no db today: find how assemble gets services, and if the resolution has to happen upstream (e.g. `config/world.ts` resolving referenced rows ahead, or the host passing a resolver), say which you chose. If assemble can't reach the rows without touching a file you don't own, stop and say so.
- **Unknown reference at run time** (T1, Render item 8): the variable's in-use layout renders (the key's ordinary laid-out value), and the receipt says so: record a `LayoutUse` for that call with the in-use row and its reason plus a field naming the missing reference (name it, e.g. `missingReference`; list it for `vl-N`). Never throw, never print the raw call.
- Rewrite: Handlebars `layout <key> "<ref>"` / `'<ref>'` (mustache, triple-stash or subexpression) → `layout "<key>" "<ref>"`; Liquid `<key> | layout: "<ref>"` → `"<key>" | layout: "<ref>"`. Use a tight regex for exactly the forms the SDK accepts, and **verify**: every call `variableLayoutCalls` returned must have been rewritten at least once, else throw a `VariableLayoutError` naming the call (deterministic, never silent). A call inside a comment may be rewritten harmlessly.
- Register the helper (Handlebars, `src/lib/shared/utils/contextHandlebarsHelpers.ts`) and filter (Liquid, `src/lib/shared/utils/contextLiquid.ts`) under `VARIABLE_LAYOUT_HELPER`: given the key's name and the reference, return the map's text (Handlebars as a `SafeString`, so `{{layout …}}` and `{{{layout …}}}` print the same, per ★6). Called with no map entry (a preview path without the pre-pass, a hand-written call the pre-pass didn't see) → throw a plain-words error naming the key and reference. `CONTEXT_LIQUID_REFUSED_TAGS` refuses a `layout` *tag*; the filter is a separate namespace, so make sure the filter isn't caught by it. The reserved context key: pick a name nobody can type as a template variable (grep it; list it).
- Tests: an explicit reference renders through its layout in **Handlebars and Liquid** (and differs from the in-use layout's output); `{{layout k "r"}}` equals `{{{layout k "r"}}}`; a non-literal reference is refused by the check (and at render throws/never renders raw); an unknown reference at run time renders the in-use layout and records `missingReference`; the receipt's `layouts` lists the call with `reason: "template"`; a template with no `layout` call renders byte-for-byte as before; a plugin engine is untouched. Then write the test the sockets worker couldn't: `config/leftoverPicks.ts` `moveLeftoversIntoTemplate` keeps the step's rendered context **byte-identical** (add it to `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts` or a new test file beside it; say which).

### 2. T1 covers references (Render item 8)
- `src/lib/server/pipelines/entities/contextTemplateFit.ts`: add `layout-argument` and `unknown-layout` to `HOST_REFUSES`. Make every host check that uses it pass a **laid-out scope** (`laidOutScope(scope, renders)` with `renders = rendersAt(doc, nodeKey, <variables slot>)` for the step, or the definition's variables-slot `renders` in the library) and `variableLayoutOffers`. `contextTemplateFitAt` (save/select/misfit) gets a per-address checking that wraps `checkTemplateSourceReport`. **Find every other user of `CONTEXT_TEMPLATE_CHECKING`** (e.g. `boot/store.ts` ~652 at publish, `templateLawFindings`): if one can't supply a laid-out scope, adding the kinds to `HOST_REFUSES` would refuse a valid `layout` call there. Handle it inside files you own if you can (e.g. a laid-out-aware `check` in the checking object); if it needs `boot/store.ts` or the SDK, stop and describe the change.
- Unknown reference **refused at save and select** of a context template (words naming the reference, with the near-miss the SDK suggests); a stored template with one gets the existing **misfit** notice naming it (`scanContextTemplateFits` / `writeMisfitNotices`); a template with a valid reference fits.
- Tests: save refused for an unknown reference; select refused; misfit notice written for a stored one; valid reference fits; the publish path (whatever you found) doesn't refuse a valid `layout` call.

## Files owned (edit only these)

- `src/lib/server/pipelines/prompt/{assemble,templateContext,preview}.ts` + tests
- `src/lib/server/pipelines/entities/variableLayouts.ts` (`LayoutUse`/`ResolvedLayouts` fields, helpers for the pre-pass) + tests
- `src/lib/shared/utils/{contextHandlebarsHelpers,contextLiquid}.ts` + tests
- `src/lib/server/pipelines/entities/contextTemplateFit.ts` + tests
- `src/lib/shared/utils/templateCheckOptions.ts` only if the offers/scope plumbing belongs there (say so)
- `src/lib/server/pipelines/config/world.ts` only if the referenced rows must be resolved there (say so)
- the new byte-identical test (see above)

## Files readable

Everything. Especially `prompt/renderers.ts` (a fresh Handlebars/Liquid per render; **not yours**), `entities/contextTemplates.ts`, `config/panel/write.ts` (select), `sockets/pipelines.ts` (library save), `boot/store.ts`, the SDK's `sdk/src/templateCheck.ts` / `templateFit.ts` / `templateScopeAt.ts` (`rendersAt`), `NOMENCLATURE.md` §6 (misfit) and §15 (template scope, template fit, law T1).

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**Laid-out values arrive marked safe** (★6): `{{x}}` prints the same as `{{{x}}}` for a laid-out key. Only laid-out keys; nothing else changes escaping."
- "**P1 Deterministic, never hidden.** Code decides what code can … every automatic action shows its cause": an unknown reference is never silent; the receipt says why.
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "`defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`)."
- "**NOMENCLATURE §24**: grep every new name across `src`, the SDK and the schema first." List every new name. Don't edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.
- "Accounted by variable, never by key": a reference is looked up within the variable the key renders.
- Browser code runs on plain-http LAN addresses and phones: `contextHandlebarsHelpers.ts`/`contextLiquid.ts` are shared (client too); no `crypto.randomUUID`, no `navigator.clipboard`, no Node-only imports there.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."

## Out of scope

`entities/variableTemplates.ts`, `objectVariableLayouts.ts`, boot passes, data upgrade (w6); sockets; client code; the SDK; docs; `prompt/renderers.ts` and `boot/store.ts` (stop and describe if needed).

## Stop and ask when

CLAUDE.md § Decisions applies; a name has a near-neighbour you can't resolve; you need a file you don't own; a valid `layout` call would be refused anywhere.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all; **don't start any dev server or dev instance**. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

The tests above pass; the existing tests of every file you touched pass (`prompt/assemble*.test.ts`, `assembleSafeValues.test.ts`, `templateContext.test.ts`, `liquidParity.test.ts`, `productionParity.int.test.ts`, `contextTemplateFit*` tests, `contextHandlebarsHelpers`/`contextLiquid` tests, `variableResolution.int.test.ts`, `variableAccounting.int.test.ts`); `npx tsc --noEmit -p .` shows no errors in your files.

## Report

Return it as your final message (don't write a report file): changed files; each test file run with its result; the pre-pass design as built (where rows are resolved, the reserved key's name, the rewrite forms); every new name; open questions; **Noticed, not done**.
