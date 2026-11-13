# REPORT vl-D — Variable layouts, the server half — 2026-11-10 (final)

Saved by the lead from the supervisor's hand-back (subagents can't write report files). Replaces the interim WAITING version.

**Status:** all of the brief built. Final targeted run 23 files / 398 tests, all pass. `npx tsc --noEmit -p .` clean (incl. `typedSocket.ts`, `templateContext.ts`). `scope-reviewer` run, findings answered (below). `svelte-check` OOM'd on this machine (left to the grouped `npm run check`).

## Migration

`drizzle/0151_shallow_marvel_zombies.sql` (generated): `pipeline_variable_templates.reference text NULL`, `.pub_default boolean NOT NULL DEFAULT false`, unique `(variable_id, reference)`, partial unique `(variable_id) WHERE pub_default`, `session_presets.variable_layouts json NOT NULL DEFAULT '{}'`.

## Changed files

**New:** `drizzle/0151_*` + snapshot + journal; `src/lib/server/db/dataUpgrades/0151_shallow_marvel_zombies.ts` + `.test.ts` + `.int.test.ts`; `src/lib/server/pipelines/config/leftoverPicks.ts` (W4); `config/variableLayoutsView.ts` (W1/W2/W3 counts/W5); `src/lib/server/sockets/pipelinesVariableLayouts.ts`; tests `config/variableResolution.int`, `boot/layoutReferences.int`, `entities/variableTemplates.writes.int`, `prompt/assembleExplicitLayouts`, `prompt/assembleSafeValues`, `prompt/builderExplicitLayouts.int`, `plugins/presetVariableLayouts.int`, `sockets/pipelinesVariableLayouts.int`, `sockets/pipelines.leftoverPicks.int`, `sockets/pipelines.leftoverBytes.int`, `sockets/presetEditor.variableLayouts.int`.

**Edited (variable-layout hunks only):** `db/schema.ts`, `db/dataUpgrades/index.ts`; `pipelines/entities/{variableTemplates,variableLayouts,objectVariableLayouts,contextTemplateFit}.ts`; `pipelines/boot/{seedVariableTemplates,registrySync}.ts`; `pipelines/config/{world,named,library}.ts`, `config/panel/{declarations,choices,provenance,write,types,index}.ts`; `pipelines/prompt/{assemble,templateContext,preview}.ts`; `pipelines/registrations/project.ts`; `shared/utils/{contextHandlebarsHelpers,contextLiquid}.ts`; `sockets/{pipelines,index,presetEditor,sessionAdmin}.ts`; `shared/sockets/{types,interest}.ts`; `sessions/presetEditor.ts`; `plugins/install.ts`. Tests updated: `variableTemplates.int`, `variableAccounting.int`, `contextTemplateFit.int`, `prompts.int`, `pluginVariables.int`, `contextHandlebarsHelpers`, `presetEditor.int`.

**Outside Files owned:** `src/lib/shared/utils/templateCheckOptions.test.ts` (excludes `layout` from the "every core helper listed" comparison, asserts it's registered; listing it needs a `templateAssist.ts` doc entry, vl-E's); `src/lib/client/sockets/typedSocket.ts` (three retired `pipelines:*VariableTemplate` entries loosely typed with ⏳, until vl-E removes the client branch).

## Tests

Data upgrade `0151_*.test.ts` (19, incl. a 600-snapshot property test before == after, second plan empty) and `.int.test.ts` (6, incl. second run changes nothing). Boot `layoutReferences.int` (stamped; second boot changes nothing; seed slug; template-id clash → one row). Entities: delete refused for pub's layout / preset / leftover / named by template. Resolution all five tiers + reason. Explicit references in Handlebars and Liquid, shipped respond step, non-literal refused, `{{x}}` == `{{{x}}}`, no-call template byte-identical. T1 refused at select and save, misfit on stored, valid fits, valid call at publish not refused. Sockets incl. Move into the template byte-identical. Parity suites pass.

Failing, not this lane's: `variableTemplates.parity.test.ts`, `seedVariableTemplates.int.test.ts` (28 vs 29: the speech `inflection-tag` row); `publishedValues.int`, `sessionGenres.int` (other session); `adminLogbook/events.test.ts` (three removed events; queued to the lead); `coreRow.int`, `sessionAdmin.presetActions.int` (untouched code).

## The data upgrade (`0151_shallow_marvel_zombies.ts`; same text in its header)

Anchored to 0151, runs once; raw SQL through `tx`; loader → pure planner → applier. **Invariant:** for every preset and step, each variable's layout is unchanged.

1. Snapshot: layout rows; static step universe `(spec, node, slot, key) → variable` from registry `variables` slots on active versions, node `renders` laid over; pick holders (genre- and preset-scope `registrations.values`, `pipeline_specs.instance_values`); presets; existing `pub_default`. Sessions excluded (above everything before and after).
2. Package default `D(V)` per `defaultVariableTemplateFor`, by seed key.
3. Contexts: per genre registration; per preset × registration key (preset row ▸ genre rows ▸ instance values); per active unregistered spec.
4. Order: preset pick → genre pick → instance pick → preset's variable layout → pub's layout → `D(V)`.
5. V untouched entirely if: a pick isn't a number naming one of its rows; a pick at an address no step reaches; one registration states the slot twice; the author's default preset has a value there; open `renders` touch V.
6. Pub: every genre/unregistered context's every step for V resolves to the same non-withdrawn X ≠ D(V) → X is the pub's layout.
7. Preset (admin-owned, no variable layout for V yet): every step resolves to X ≠ (pub ?? D), X a core shipped row → `variable_layouts[V]` = its reference.
8. Removal: only when every context reading the pick resolves identically without it; only admin-owned registration rows and instance values; fixed-order sweep to fixpoint.
9. Verify per V, then apply; any difference drops V's actions with a warning.

## Sockets (admin-only, `pipelines:` family, unscoped; refusals `<event>:error` `{ error }` in words)

**W1 `pipelines:libraryVariables`** `{}` → `{ variables: [{ variableId, label, description, shelfId, shelfLabel, supplier, inUse: { id, name, reference|null, reason: "pub"|"default"|"automatic" }|null, reason: "pub"|"default"|"automatic"|"as-written", presetsDiffering, layoutCount }] }` (shelves `variableShelfOf`/`VARIABLE_SHELVES`).

**W2 `pipelines:libraryVariable`** `{ variableId }` → `{ variable: { variableId, label, description, supplier, scope, sample, default: {id,name}|null, pubDiffersFromDefault, inUse, rows: [{ id, name, ownerLabel: "Serene Pub"|<plugin>|"This pub", reference|null, engine, isImmutable, editable, preview|null, previewError|null, inUse, namedByTemplates, chosenByPresets: [{id,name}] }] } }` (previews server-side against `sample`).

**W2 `pipelines:librarySetPubLayout`** `{ variableId, templateId: number|null }` (null = back to default) → `{ variable, warnings? }` (warning names presets keeping their own). Refuses non-admin, unknown variable, bad id, other variable's row, missing, withdrawn.

**W3 `pipelines:libraryUseEverywhereCounts`** `{ variableId }` → `{ variableId, pipelines, contextTemplates, uncheckedContextTemplates }`.

**W3 live preview:** existing `pipelines:previewTemplate` (`kind: "variable"`).

**W3 writes:** `pipelines:libraryCreateTemplate` gains `reference?: { ownerSlug, slug }`, `useEverywhere?: boolean`; `pipelines:libraryUpdateTemplate` gains `reference?` (refuses changing an existing one: "fixed once saved"); `pipelines:libraryDeleteTemplate` refuses in words while pub's layout / chosen by a preset / leftover / named by a template. Library `variableTemplates` rows gain `reference: string|null`, `pubDefault: boolean`.

**W5 `pipelines:templateVariableLayouts`** `{ nodeType }` (library) or `{ specSlug, nodeKey }` (step) → `{ keys: [{ key, variableId, variableLabel, inUse|null, offers: [{ reference, label }] }] }` (offers = rows with a reference).

**W4 `pipelines:leftoverPicks`** `{ slug, sessionId?, presetId? }` → `{ slug, steps: [{ nodeKey, slot, contextTemplate: {id,name}|null, canMoveIntoTemplate, picks: [{ nodeKey, slot, key, variableId, variableLabel, templateId, layoutName, scope: {kind:"genre",genreId}|{kind:"preset",presetId}|{kind:"instance"} }] }] }`.

**W4 `pipelines:clearLeftoverPick`** `{ slug, scope, nodeKey, slot, key, sessionId?, presetId? }` → fresh view.

**W4 `pipelines:moveLeftoversIntoTemplate`** `{ slug, nodeKey, slot, ownerSlug?, sessionId?, presetId? }` → view + `{ templateId, templateName, moved: [{key, reference, reads}], kept: [{key, why}], stamped: [{templateId, reference}] }`. One transaction; verified byte-identical. Refuses: shipped/plugin template or non-core engine; no step or picks; nothing to rewrite; reference needed and no `ownerSlug`; two scopes in view disagree; another preset not in view picks differently.

**W6 `pipelines:stampVariableTemplateReference`** `{ templateId, ownerSlug }` → `{ library, templateId, reference }`.

**W6 `pipelines:presetVariableLayouts`** `{ presetId }` → `{ presetId, editable, rows: [{ variableId, variableLabel, reference, templateId|null, layoutName|null, pubLayout: {templateId,name,chosen}|null }], dangling: [{variableId, reference}] }` (`editable` false for declared).

**W6 `pipelines:setPresetVariableLayout`** `{ presetId, variableId, reference: string|null }` → same view, re-sends `sessionPresets:list`. Refuses declared preset ("Copy it"), unknown variable, malformed reference, reference no row goes by, clearing an unstated variable.

**`sessionPresets:list`** rows gain `danglingVariableLayouts?: {variableId, reference}[]` (computed on read). Copying a preset carries `variable_layouts`.

**Removed (for vl-E):** events `pipelines:cloneVariableTemplate`, `:updateVariableTemplate`, `:deleteVariableTemplate` + types + interest; every `control: "variable-template-ref"` option, `ConfigOption.variableTemplate`, their choices, `variableOptionGate`. Client readers to remove: `PipelineConfigOptions.svelte` ~618–702, ~945–1001, ~1847–1900; `Layout.svelte` 288–290; `typedSocket.ts` loose ⏳ entries; the `variableTemplate` doc in `shared/sockets/types.ts` ~10268.

## Render path, as built

- Resolution (`config/world.ts`): leftover (`"leftover"`) → preset's variable layout (`"preset"`; dangling skipped) → pub's (`"pub"`) → package default (author's named layout for the step, else `defaultVariableTemplateFor`; `"default"`) → floor (`"default"`). Reason on `ResolvedLayouts[key].reason` and `LayoutUse.reason` into the run inspector's `layouts`.
- ★6: non-empty laid-out values reach core Handlebars as `SafeString`; Liquid and plugin engines unchanged; empty stays `""`. Fixed a leak: a template or prompt block whose whole body is one laid-out key returned the SafeString object; block helpers and the render call coerce with `String(…)` (tested).
- Pre-pass: the world resolves every `layout key "ref"` named by any context template in the spec, by variable, at every node that lays the key out (`ResolvedLayouts[key].references`). The laying-out node renders each in its sequential loop (Assemble for its keys; the context builder for `characters`, `personas`…, emitted as plain JSON `namedLayouts`). Assemble rewrites each call's first argument to a literal key (`layout "characters" "core/json@1"`), throwing if any listed call isn't rewritten; texts go under `LAYOUT_RENDERS_CONTEXT_KEY` (`"\u0000layout-renders"`) for the helper/filter. An unknown reference renders the in-use layout's text and records `LayoutUse.missingReference`.
- T1: `HOST_REFUSES` += `layout-argument`, `unknown-layout`; save, select and misfit scan check with `laidOutScope` (keys laid out at any node in the document) and per-variable `variableLayoutOffers`.
- `declarationsAndVariableKeys` gives the run each key's variable (bands included). Stored picks never culled for lack of a declaration; a pick naming another variable's row still culled with its notice.

## New names (for vl-N)

Prose/schema: 🚧 **layout reference** (`reference`), 🚧 **pub's layout** (`pub_default`), 🚧 **preset's variable layouts** (`session_presets.variable_layouts`), ⏳ **leftover pick**. `LayoutReason` = `leftover | preset | pub | default | template` (W1/W2 view-only words `automatic`, `as-written`). Shipped slugs `titled-json`, `json`, `titled`, `as-written`, `sentence`, `numeric`, `lines`, `bracket-tag`. Events above + `danglingVariableLayouts`.

Code: `entities/variableTemplates.ts` `pubLayoutOf`, `layoutByReference`, `presetVariableLayoutsOf`, `setPubLayout`, `stampReference`, `contextTemplatesNaming`, `LayoutReferenceInput` · `entities/objectVariableLayouts.ts` `coreLayoutReferenceFor`, `layoutSlugOf`, `variableMajorOf`, `formatLayoutReference`/`parseLayoutReference` (SDK aliases) · `boot/seedVariableTemplates.ts` `stampReferenceIfFree` · `config/panel` `declarationsAndVariableKeys`, `VariableKey` · `config/named.ts` `declaredVariableLayouts` · `config/world.ts` `danglingPresetLayouts` · `entities/variableLayouts.ts` `laidOutForHandlebars`, `ReferencedLayout`, `references`, `LayoutUse.missingReference`, `rewriteLayoutCalls`, `prepareExplicitLayouts`, `ExplicitLayoutPrepass`, `withExplicitLayouts`, `LAYOUT_RENDERS_CONTEXT_KEY`, `layoutRenderKey`, `explicitLayoutText`, `referencedLayoutOf`, `draftReferenceLayouts`, `NAMED_LAYOUTS_FIELD` (`namedLayouts`), `NamedLayouts` · `prompt/` `laidOutSafeFor`, `LAID_OUT_CONTEXT_KEYS` · `entities/contextTemplateFit.ts` `variableLayoutOffersOf`, `contextTemplateChecking` · `config/variableLayoutsView.ts` `variableLayoutsList`, `variableLayoutView`, `presetsKeepingTheirOwn`, `useEverywhereCounts`, `templateVariableLayouts`, `UnknownVariableError`, `UnknownTemplateTargetError` · `config/leftoverPicks.ts` `leftoverPicksFor`, `clearLeftoverPick`, `moveLeftoversIntoTemplate`, `nameLayoutAtBareReads`, `LeftoverPickRefusal` · `sessions/presetEditor.ts` `presetVariableLayoutsView`, `setPresetVariableLayout`, `PresetVariableLayoutRefusal` · `planVariableLayoutUpgrade` + snapshot types · socket types `Sockets.Pipelines.VariableLayouts.*`, `LeftoverPicks`, `ClearLeftoverPick`, `MoveLeftoversIntoTemplate`, `PresetVariableLayouts`, `SetPresetVariableLayout`, `StampVariableTemplateReference`.

## Open questions — lead's answers (2026-11-10)

1. W4 as its own event (`pipelines:leftoverPicks`), not the panel payload (`config/panel/read.ts` not owned): **accepted.** vl-E makes one extra request.
2. Publish doesn't refuse an unknown reference in a spec's inline template (`boot/store.ts` `templateLawFindings` has no laid-out scope): **left open, Noticed.** At run time the in-use layout renders and the inspector records `missingReference`; reported to the owner.
3. "Laid out at any node in the document" over-approximates upstream: **accepted.**
4. W2's named-by count vs the delete refusal can differ (delete stricter): **accepted.**
5. An owner slug with `_` is refused by the SDK grammar: **reported to the owner** (no stored reference has that shape).
6. Move into the template on a builder key needs exactly one context-template slot: **vl-E checks the UI reads well.**

## Queued

- **Lead:** `adminLogbook/events.ts` ~793–813 drop the three retired events, add rows for `librarySetPubLayout`, `setPresetVariableLayout`, `clearLeftoverPick`, `moveLeftoversIntoTemplate`, `stampVariableTemplateReference` (fixes `events.test.ts`); `sockets/plugins.ts` ~550 `plugins:install` needs the `presetVariableLayoutFindings` call `install.ts` makes; other `PromptBlockFormatter` callers may want the `String(…)` guard.
- **vl-E:** remove the client picker branch and `typedSocket.ts` ⏳ entries; `templateDiagnostics.ts` `quickFix` for `unknown-layout`; read `pipelines:leftoverPicks`; read `LayoutUse.reason` and `missingReference` in `receiptView.ts` `layoutsView`; interest consumer comment.
- **vl-N:** the names above; `assemble.ts` `usedVariables` lists `layout` as a variable name (cosmetic).

## Scope review

1. Report incomplete → this report. 2. W4 outside the panel payload → Q1. 3. Cull for re-pointed picks gone → fixed (`repointedLayoutPicks` restored in `config/named.ts` with its notice; original assertions restored, passing). 4. Logbook and client references to removed events → queued.

## Noticed, not done

- `config/panel/read.ts` ~452/~584 `variableTemplateRow` is dead.
- `syncPluginTemplates`/`syncPluginPresets` rewrite `updatedAt` every boot (pre-existing); second-boot tests compare all other columns.
- Stale speech-catalogue counts in `seedVariableTemplates.int.test.ts` (28 vs 29) and `variableTemplates.parity.test.ts` (`inflectionTag`).
- A layout's preview and sample supply only a multi-root variable's first root.
- core-catalog's preset seed type has no `variableLayouts`; `project.ts` reads through a cast; core presets write `{}`.
- `createTestDb` runs leave `/tmp/serene-pub-vitest-*` dirs; workers couldn't tell theirs apart, so none deleted.
