# REPORT vl-S — Variable layouts, SDK half — 2026-11-10

Saved by the lead from the supervisor's hand-back (subagents can't write report files). The supervisor's full text was relayed in the lead's session; this file keeps what later lanes need.

**Status:** items 1–5 built; SDK typecheck clean; targeted tests pass (274: 273 pass, 1 known `surface` untagged failure not from this lane). `npm run sdk:test`: 8 failures, none in this lane's files (5 from before this build; 3 from the other session's live core-catalog edits: C40 ×2, DC genre hash). Ready for `sdk:build` (lead coordinates).

## Changed files (`../serene-pub-sdk/`)

`sdk/src/variableLayouts.ts` (new) · `sdk/src/templateCheck.ts` · `sdk/src/template.ts` (types only, additive; ★S-2) · `sdk/src/templateIds.ts` · `sdk/src/announce.ts` · `sdk/src/index.ts` · `sdk-tests/templateCheckLayout.test.ts` (new) · `sdk-tests/variableLayouts.test.ts` (new) · `sdk-tests/presetVariableLayouts.test.ts` (new) · `sdk-tests/templateIds.test.ts` (one describe appended).

## Signatures for vl-D and vl-E

```ts
// @serene-pub/sdk
laidOutScope(scope: TemplateScope, renders: Readonly<Record<string, string>>): TemplateScope
  // renders = rendersAt(doc, nodeKey, variablesSlot) on a step; the definition's variables-slot `renders` in the library
variableLayoutOffersFor(scope, key, offers: TemplateCheckOptions['variableLayoutOffers']): readonly VariableLayoutOffer[]
parseVariableLayoutReference(value: unknown): { owner; slug; major } | null
formatVariableLayoutReference({ owner, slug, major }): string
presetVariableLayoutFindings(preset): string[]
VARIABLE_LAYOUT_HELPER // 'layout'
VARIABLE_LAYOUT_SLUG   // /^[a-z0-9]+(?:-[a-z0-9]+)*$/
variableLayout(pluginId, variable, { slug, major, label, engine, source }): TemplateSeed
  // id <pluginId>:template/<variable name kebabed as objectLayoutTemplateId>-<slug>@<major>

// @serene-pub/sdk/template-check
checkTemplateSourceReport(engine, src, laidOutScope(scope, renders), { ...CONTEXT_TEMPLATE_CHECK, variableLayoutOffers: { [variableId]: [{ reference, label }] } })
variableLayoutCalls(engine, src, options?): { key: string; reference: string }[]  // every call with a simple key + literal reference, source order, duplicates kept; [] on syntax error
```

Check rules: key must be a simple root key whose decl carries `laidOutBy`; second argument a quoted literal. Handlebars mustache or subexpression; block form is a finding. Liquid: `layout` first filter on a bare variable, one quoted argument. On `unknown-layout`, `name`/`path` are the reference and the span is inside the quotes. Finding kinds: `layout-argument`, `unknown-layout`.

## New names (for vl-N)

`parseVariableLayoutReference` · `formatVariableLayoutReference` · `VariableLayoutReferenceParts` · `VARIABLE_LAYOUT_SLUG` · `VARIABLE_LAYOUT_HELPER` · `VariableLayoutOffer` · `VarField.laidOutBy` (root keys only; ⚠ not the variable's own scope) · `TemplateCheckOptions.variableLayoutOffers` (⚠ not a preset's `variableLayouts`) · `laidOutScope` · `variableLayoutOffersFor` · `variableLayout` / `VariableLayoutInput` · `variableIdParts` (`@internal`) · `TemplateSeed.slug` · `PresetDecl.variableLayouts` / `PresetInput.variableLayouts` (⚠ not a genre's `layouts`, not `settings`) · `presetVariableLayoutFindings` · finding kinds `layout-argument`, `unknown-layout` · `variableLayoutCalls` / `VariableLayoutCall`. Prose terms: **variable layout**, **layout reference**.

## Lead decisions on the lane's questions (2026-11-10)

- **★S-1 accepted:** `variableLayout()` does not check `source` at define time. The checker carries both engines and lives at `/template-check`; the barrel stays dependency-free; the packager (`variableSeedFindings`) and install already check source against scope. ★7's purpose (a typo in the variable is a compile error) holds.
- **★S-2 accepted:** `template.ts` type additions.
- **★S-3 accepted:** owner as positional first argument, as `definePluginVariable` etc.
- **Q-1 done by the lead:** `declarations.ts` `presetFindings` now pushes `presetVariableLayoutFindings(p)`. vl-D also calls it at install.
- **Q-2 decided by the lead:** with no offers, a well-formed reference passes silently (no warning). The host always supplies offers at save, select and in the editor; only the packager has none, where a warning would fire on every reference. Changed in `templateCheck.ts` + its test.
- **Queued item 2 done by the lead:** `templateFit.ts` `clause()` has sentences for `layout-argument` and `unknown-layout`.
- Lead re-ran: SDK `tsc --noEmit` clean; `templateCheckLayout`, `presetVariableLayouts`, `templateCheck`, `templateFit`, `presets`, `announce`: 126/126 pass.

## Queued for other lanes

- **vl-D:** add `layout-argument` and `unknown-layout` to app `contextTemplateFit.ts` `HOST_REFUSES`; register helper and filter under `VARIABLE_LAYOUT_HELPER` (`CONTEXT_LIQUID_REFUSED_TAGS` refuses the `layout` *tag*, not the filter); call `presetVariableLayoutFindings` at install; note the template-id clash below when stamping references.
- **vl-E:** `templateDiagnostics.ts` `quickFix` for `unknown-layout`: replace the whole `[start, end)` span with `suggestion` (the current `.`-segment logic breaks `acme.dice/prose@1`).
- **vl-N:** `INTEGRATING.md` §5 seam census rows for a plugin's variable layouts and a preset's variable layouts; NOMENCLATURE rows for the names above; consider an SDK guide paragraph on `variableLayout()`.

## Noticed, not done

- A plugin shipping `variableLayout(pid, objectVar, { slug: 'json', major: <variable major> })` gets the same template id as the app's automatic layout (`objectLayoutTemplateId`); harmless today (automatic only when the manifest ships none).
- `variableIdParts` accepts camelCase names; `descriptors.ts:3424` checks variable ids lowercase-only.
- The "did you mean" list for unknown helpers excludes `layout`.
- `templateScopeReport` (`templateScopeAt.ts`) knows `rendersAt` and could set `laidOutBy` itself.
- Run-time import cycle `variableLayouts.ts` ↔ `templateIds.ts`, safe while both uses stay inside functions.
