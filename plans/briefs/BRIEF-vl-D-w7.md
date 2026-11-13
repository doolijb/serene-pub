# BRIEF vl-D-w7: explicit references for keys laid out upstream (`layout characters "core/json@1"`)

You are a `lane-worker` under supervisor `vl-D`. The repo is `/home/jody/github/serene-pub`. The SDK is at `/home/jody/github/serene-pub-sdk` and is read-only for you. Use absolute paths.

Before starting, read:
- `plans/PLAN-variable-layouts-2026-11-10.md` § "The rule this plan applies", § W5, and § Render items 6–8
- `plans/REPORT-vl-S-2026-11-10.md` (the signatures section)

The plan's own example is `{{{layout characters "core/json@1"}}}` (Liquid: `{{ characters | layout: "core/json@1" }}`). Today that call is refused, and this task makes it work.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What exists: read it in the code, it is all uncommitted work from this lane

### The explicit-reference pre-pass (worker w5)

**`config/world.ts`, inside the per-variable resolution loop**
- It scans the template sources pushed at **the node's own** template slots, for core engines only, using `variableLayoutCalls` from `@serene-pub/sdk/template-check`.
- For a call whose key is one of **this node's** variables-slot keys, it resolves the row by variable: `layoutByReference`, then `derefLayout`.
- It attaches the result as `ResolvedLayouts[key].references?: Record<reference, ReferencedLayout>`.

**`prompt/assemble.ts`**
- `prepareExplicitLayouts` runs after the lay-out loop.
- It rewrites each call to `layout "<key>" "<ref>"` (`rewriteLayoutCalls`).
- It renders each distinct `(key, reference)` through `renderVariable` with `reason: "template"`.
- The rendered texts go into the render context under `LAYOUT_RENDERS_CONTEXT_KEY` (`"\u0000layout-renders"`).
- The Handlebars helper and the Liquid filter `layout` look the text up there (`shared/utils/contextHandlebarsHelpers.ts`, `contextLiquid.ts`, `explicitLayoutText`).
- An unknown reference renders the in-use text and records `LayoutUse.missingReference`.

**`entities/contextTemplateFit.ts`**
- `contextTemplateChecking(db, doc, nodeKey, describe)` checks with `laidOutScope(scope, renders)`. Here `renders` is `rendersAt` over **the node's own** `variables` slots, plus `variableLayoutOffers` from `variableLayoutOffersOf`.
- `HOST_REFUSES` includes `layout-argument` and `unknown-layout`.

### The gap

The context builder's keys (`characters`, `personas`, `scenario`, `instructions`, … see `LAID_OUT_CONTEXT_KEYS` in `prompt/templateContext.ts`) are laid out **upstream**, in `buildTemplateContext`, through the builder node's own `variables` slot. They reach Assemble as already-laid-out strings across a port.

So, today:
- the world never attaches `references` for them, because they aren't Assemble's keys;
- Assemble never has their raw values;
- the check doesn't mark them laid out, so `layout characters "…"` is refused as `layout-argument`.

`config/leftoverPicks.ts` `moveLeftoversIntoTemplate` (w4) rewrites bare reads of picked keys into `layout` calls. For a builder key, that produces a template the check refuses.

## Goal

Make an explicit reference work for **every laid-out key a context template can read**, whichever step lays it out, with the same guarantees w5's pre-pass gives Assemble's own keys.

1. **World.** For each variables-slot key of **any** node in the spec, attach `references` for every reference that **any** context template pushed in the spec names for that key. Do this by variable, never by key: the key must render that variable at that node.
2. **Builder.** In `prompt/templateContext.ts` `buildTemplateContext`:
   - For each `(key, reference)` in its layouts' `references`, render the key's raw value through `renderVariable` with the referenced row and `reason: "template"`.
   - Do this in the same sequential lay-out loop, passing `run` the way the loop does.
   - Emit the texts in its output under `LAYOUT_RENDERS_CONTEXT_KEY` (or a clearly named field beside the context), together with the receipt lines.
   - Only when there is at least one reference, so an output with no calls is byte-for-byte as before.
   - The output crosses a port and is recorded in the run, so it must be plain JSON (strings): no `SafeString`.
3. **Assemble.**
   - Merge the upstream renders into its map before rendering. An entry Assemble renders itself wins for its own keys.
   - For a call the map lacks, render the in-use text (the key's laid-out value) and record `missingReference`, exactly as for Assemble's own keys.
   - Never throw for a builder key whose reference resolved upstream.
   - Record the builder's receipt lines in Assemble's `layouts`, so the run inspector lists one line per placed call with `reason: "template"`.
4. **Check (T1).** `contextTemplateChecking` marks as laid out every key a `variables` slot renders anywhere upstream of the node in the doc. At least: the nodes whose output feeds the node's context or template-context input. All variables-slot nodes in the doc is acceptable if upstream is hard to compute exactly; say which you chose.
   - Offers stay per variable, across the whole pub.
   - The plan example must fit at the respond step of a shipped pipeline.
   - A key nothing lays out stays `layout-argument`.
5. **Preview.**
   - `prompt/preview.ts` `previewContextTemplate`, and its caller `sockets/pipelines.ts` ~1368 (`pipelines:previewTemplate`), must preview a draft naming a valid reference through that layout, for a builder key too.
   - The caller should resolve referenced rows the way the world does: by variable, with `layoutByReference`. Put a small shared lookup where both can use it and name it.
6. **Leftover Move.** With 1–4 in place, `moveLeftoversIntoTemplate` on a builder key (`characters`) must produce a template that fits and renders byte-identically.
   - Extend `src/lib/server/sockets/pipelines.leftoverBytes.int.test.ts` with a `characters` leftover on a respond step.
   - If `leftoverPicks.ts` needs a change, make it and say so.

## Tests

- **End to end on a booted DB, for a shipped respond pipeline.** Build the world (`buildWorld` / the same path `variableResolution.int.test.ts` and `pipelines.leftoverBytes.int.test.ts` use), with a pub copy of the respond context template that writes `{{{layout characters "core/json@1"}}}` while the pub's layout for characters is the default *Titled JSON block*:
  - the rendered prompt contains the bare JSON, not the titled block;
  - the receipt lists `characters` with `reason: "template"`;
  - the template fits (select succeeds).
- The same with Liquid.
- `{{layout characters "…"}}` equals `{{{layout characters "…"}}}`.
- An unknown reference on a builder key renders the in-use text and records `missingReference`.
- A template with no calls renders byte-for-byte as before. `productionParity.int.test.ts` and `liquidParity.test.ts` stay green.
- The leftover Move on `characters`, byte-identical (item 6).
- Preview of a draft with a valid builder-key reference renders through it.

## Files owned (edit only these)

- `src/lib/server/pipelines/config/world.ts`
- `src/lib/server/pipelines/prompt/{assemble,templateContext,preview}.ts`, plus their tests
- `src/lib/server/pipelines/entities/variableLayouts.ts`
- `src/lib/server/pipelines/entities/contextTemplateFit.ts`, plus its tests
- `src/lib/shared/utils/{contextHandlebarsHelpers,contextLiquid}.ts`, only if needed
- `src/lib/server/sockets/pipelines.ts`, the `pipelines:previewTemplate` handler only
- `src/lib/server/pipelines/config/leftoverPicks.ts`, only if needed
- `src/lib/server/sockets/pipelines.leftoverBytes.int.test.ts`
- new test files beside these

## Files readable

Everything. Especially:
- the node type definitions for the context builder and Assemble in `../serene-pub-sdk/core-catalog/src` (ports, the `variables` slot);
- `prompt/renderers.ts`, which is not yours;
- `boot/store.ts`;
- the SDK's `templateScopeAt.ts` (`rendersAt`, `templateScopeReport`) and `variableLayouts.ts` (`laidOutScope`);
- `NOMENCLATURE.md` §15.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**Laid-out values arrive marked safe** (★6): `{{x}}` prints the same as `{{{x}}}` for a laid-out key. Only laid-out keys; nothing else changes escaping."
- "**P1 Deterministic, never hidden**": an unknown reference is never silent, and the receipt says why.
- "Accounted by variable, never by key" (NOMENCLATURE §15).
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "`defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`)."
- `shared/utils/context*.ts` run in the browser too, on plain-http LAN and phones: no `crypto.randomUUID`, no `navigator.clipboard`, no Node-only imports.
- "**NOMENCLATURE §24**: grep every new name first." List every new name. Don't edit `NOMENCLATURE.md`, `STYLE-GUIDE.md` or `docs/`.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."

## Out of scope

- The SDK (if a change is needed there, stop and describe it)
- `boot/store.ts` (the publish path is a known gap, queued for the lead)
- client code, docs
- `entities/variableTemplates.ts` and the boot passes

## Stop and ask when

- CLAUDE.md § Decisions applies.
- You need a file you don't own.
- Making builder keys work would change bytes for a template with no `layout` call.
- The SDK's `laidOutScope` can't express "laid out upstream" without an SDK change.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all, and **don't start any dev server or dev instance**. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

- The tests above pass.
- These existing tests stay green: `assembleExplicitLayouts.test.ts`, `assembleSafeValues.test.ts`, `templateContext.test.ts`, `liquidParity.test.ts`, `productionParity.int.test.ts`, `contextTemplateFit.int.test.ts`, `contextHandlebarsHelpers.test.ts`, `variableResolution.int.test.ts`, `variableAccounting.int.test.ts`, `pipelines.leftoverPicks.int.test.ts`, `pipelines.leftoverBytes.int.test.ts`, `pipelinesVariableLayouts.int.test.ts`.
- `npx tsc --noEmit -p .` shows no errors in your files.

## Report

Return it as your final message; don't write a report file. Include:
- changed files
- each test file run, with its result
- the design as built (where builder references resolve, what the builder emits, how the check marks upstream keys)
- every new name
- open questions
- **Noticed, not done**
