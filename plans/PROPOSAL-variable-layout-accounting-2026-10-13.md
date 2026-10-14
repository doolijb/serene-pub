# Variable layouts: account for the variable, not the key

Status: **BUILT 2026-10-13 (P1–P5), uncommitted; see §8.** ★1–★5 ruled (§7). No new word: the spec-level override reuses `renders`. §23 words `raw`, `bands.<key>` and `engines` stay retired. Needs an SDK prerelease + pin bump before push (sdk, cli changed).

The question asked: a custom node or pipeline changes what `characterLore` *is* — a modified shape, or a different data set under the same name. How should variable layouts (the `pipeline_variable_templates` rows) account for that?

## 1. What exists (facts, 2026-10-13)

**Rows are keyed by the variable.** `pipeline_variable_templates.variable_id` (`schema.ts:5327-5365`; header 5290-5325: "keyed by the variable, not by the spec"). Unique on `(variable_id, engine, name)`. A row is selectable only for its own variable (`entities/variableTemplates.ts:100-125` `assertSelectable`), and the picker groups rows by `variableId` (`config/panel/choices.ts:243-264`, `:569-572`).

**Selection is stored by node and key.** A `kind:"variables"` slot expands to one option per `renders` entry (`config/panel/declarations.ts:419-447`): `path = key`, `variableId` from `renders[key]` or the reaching band's variable (`openRenders` → SDK `rendersAt`, `bands.ts:303-335`). The stored value is `pipeline_config_values(configId, nodeKey, slot, path=key) → rowId`. Default: `defaultVariableTemplateFor(db, variableId)` (`boot/seedVariableTemplates.ts:149-192`), cached per variable, stored under the key.

**Rendering forgets the variable.** `applyPipelineLayer` (`config/world.ts:595`, `:868-875`, `:1041-1076`) hands the node `ResolvedLayouts = Record<key, { engine, source? }>` — the variable id does not survive resolution. `renderVariable(layouts, key, value)` (`entities/variableLayouts.ts:979-1032`) then looks everything up **by key string**: the absence rule (`definitionByKey.get(key)`), the floor (`shippedByKey.get(key)`), the chosen row (`layouts[key]`), and the render scope `{ [key]: value }`. Assemble merges candidates into a band by `candidate.source === key` (`assemble.ts:731-732`, `:762-766`), and decides "render through the layout or plain JSON" by `CORE_BANDS` membership or a selected source (`bandValue`, `:1135-1150`).

**The SDK checks bands, not static `renders`.** `checkBandDeclarations` (`sdk/src/bands.ts:109-195`) refuses a band whose variable is unregistered or whose scope lacks the key, a key in Assemble's own names, a key that a *core* variable's scope already has, and a second declarer with a different variable ("A band key is a top-level template name and means one thing"). `rendersAt`/`bandsReaching` repeat the collision check per document. **Nothing validates `SlotDecl.renders`** (`descriptors.ts:261-276`): not that the variable is registered, not that the key is in its scope, not uniqueness across nodes. `templateSeedProblems` (`templateIds.ts:214-232`) does not check a `variables` seed's `variableId` namespace, so a plugin can seed a row against a core variable, and nothing lints a `variables` seed's body against the variable's scope.

**The one-key-one-variable rule is a test, not a mechanism.** `variableTemplates.parity.test.ts:429-474` asserts it over `allDefinitions()` at test time — core and contracts, never an installed plugin.

**Automatic layouts name the scope root.** `objectLayoutSource` writes `{{{json <scopeRoot>}}}` (`objectVariableLayouts.ts:83-90`); the render scope is `{ [slotKey]: value }`. Bands require root == key (`bands.ts:144-150`); static `renders` do not.

**Where plugin authors are told any of this: nowhere.** `docs/component-authoring.md` covers widgets only; `Descriptor.bands`, `definePluginVariable`, `ExtensionDecl.variables`, `renders` and `rendersBands` appear only in the SDK source and NOMENCLATURE §15.

## 2. What goes wrong today, case by case

| # | Case | What happens |
|---|------|--------------|
| A | A plugin node declares `renders: { characterLore: 'acme:var/x@1' }` | Picker is right (rows of `acme:var/x@1`). Render is wrong: core's absence rule and core's floor for `characterLore` run against the plugin's shape, because both are keyed by the string. If the variable's scope root is not `characterLore`, the automatic layout renders nothing (root/key mismatch). |
| B | A plugin query emits candidates with `source: "characterLore"` | Merged into core's band by string match (`allocationsFrom`), rendered through whatever row the Assemble step selected for core's variable. The explicit shipped layout renders the declared `{title, castMember?, content}` keys and silently drops the rest. |
| C | A pipeline step (script, composite) *extends* the core value — adds `rank`, `source` — before Assemble | Same as B: the extra keys vanish in the explicit layout; `{{{json characterLore 0}}}` would pass them through but the admin has no way to know the shape changed. The run report says nothing. |
| D | A plugin declares its own band `characterLore` under its own variable (a *different data set*) | Refused at registration: a core variable's scope already has the key (`otherVariableRendering`), even when the plugin's pipeline never meets core's character-lore query. |
| E | A plugin seeds a layout row for `core:var/character-lore@1` (a prose layout for everyone) | Accepted by the SDK unchecked; the host writes it with `ownerPluginId`. Fine in practice, but ruled nowhere, and its body is never linted against the scope. |

The common cause: **the variable id is the unit of accounting at storage time and the key string is the unit at render time.** Rows, pickers and defaults are per variable; the floor, the absence rule, the band merge and the receipt are per key.

## 3. The shape: the variable id travels to the render

One rule, stated once: **a key is a local name; a variable id is what the value is.** Every decision that today reads a key string reads the resolved variable instead.

**3.1 Resolution carries the variable.** `ResolvedLayouts[key]` becomes `{ variableId, engine, source? }`. `applyPipelineLayer` already knows `d.variableId` for each option; it stops throwing it away. The shipped-default floor pushes `{ variableId, engine }` even when no row resolved, so the node always learns what each key *is*. (No schema change.)

**3.2 The floor and the absence rule belong to the variable.** `variableLayouts.ts` re-keys `SHIPPED_VARIABLE_TEMPLATES` lookups by `variableId` (`shippedByVariable`); `renderVariable(layouts, key, value)` reads `layouts[key].variableId` and takes the floor and absence rule from *that* variable's definition. A non-core variable's floor is its automatic layout (minified JSON of each object root; a primitive as written), never core's `characterLore` floor. The parity test keeps passing for core because core keys still resolve to core variables.

**3.3 The render scope is the variable's scope root.** `renderVariable` renders with `{ [scopeRoot]: value }` where the root comes from `getVariable(variableId).scope`; for every core variable root == key, so nothing changes for core. The SDK gains the same root == key requirement for static `renders` that bands already have (3.5), so this is belt and braces, not a divergence.

**3.4 Assemble merges bands by variable, not by string.** A candidate carries the band key its declarer put on it; Assemble resolves the declarer's variable for that key (`bandsReaching` already computes `{key → variableId}` per document) and renders the band through the row selected *for that variable*. A plugin source emitting `source: "characterLore"` without declaring the band is what it is today: a receipt note, never a template name (ruling Q3, 2026-09-27, unchanged).

**3.5 The SDK validates static `renders` the way it validates bands.** At `register()`: the variable is registered; its scope contains the key; the key is not one of Assemble's own names. At `defineExtension`/packager: a plugin's `renders` may name any registered variable (core or its own); a `variables` *seed* may target a core variable (case E, ★4) but its body is linted against that variable's scope (`checkTemplateSourceReport`, which exists and is unused for this).

**3.6 Collision is per template scope, not global.** Replace the global "one key, one variable across every node" assertion with the rule `bandsReaching`/`templateScopeAt` already enforce per document: *within one template's scope, a name means one variable.* Two nodes in different pipelines, or a plugin band that never meets core's, may use the same key for different variables. The registration-time `otherVariableRendering` refusal (core-root collision) is dropped; the per-document `BandCollisionError` stays and is what law T1 reports. ★1

**3.7 A spec may rebind a key (case C, by design rather than by accident).** 🚧 *rebinding*: a preset says what a step's key means in *this* pipeline: `p.variables('assemble', { characterLore: 'acme:var/character-lore-ranked@1' })` on `PresetBuilder` (`builder.ts:956-1007` has no `variables()` today). It is part of the spec's contract hash (as `bands`/`portSchemas` are since 2026-09-27). Effects: the picker offers that variable's rows; the default is that variable's default row; law T1's scope entry for the key is still `{type:'string'}` (the laid-out text); the run report names the variable. It is explicit and lives in the spec, which is where the step that changed the value lives — the "no magic in core" ruling (2026-09-30) in its own words: appended in-pipeline or logically inserted in the template. ★2

Not proposed: letting a config or a member pick a *variable*. Admins pick rows; what a key means is the author's decision, made in the spec (or in the canvas editor's draft of it, which is a spec). Members never touch model or prompt plumbing (ruled 2026-10-12).

**3.8 The receipt says what was rendered.** The run inspector's Prompt tab lists, per key: the variable id, the row (shipped / plugin-owned / user's own, by name), and whether it was the floor. Today a layout that renders the wrong shape is silent until someone reads the prompt. (Run artifacts are the vehicle, per the run-artifacts ruling.)

## 4. What this does not change

- Rows stay keyed by `variable_id`; no migration. Shipped core rows stay immutable and byte-parity.
- Context templates still place `{{{characterLore}}}` by key. The key is the template's word; the variable is what fills it.
- Members see no layout options (unchanged, 2026-10-12).
- The automatic JSON row per object variable, and "primitives get none for now" (⏳), unchanged.
- The Liquid engine, template fit (T1/T2), annex (`annex.<owner>.<key>`): untouched.

## 5. Phases

| Phase | Work | Proof |
|-------|------|-------|
| **P1 thread the variable** | `ResolvedLayouts` carries `variableId`; `renderVariable` floors and absence-checks by variable; scope root from the declaration. | Parity suite unchanged and green; new unit: a plugin variable under a core key gets its own floor, not core's. |
| **P2 SDK checks** | Validate static `renders` at `register()`; lint `variables` seeds against scope at package time; per-document collision replaces the global test. | `sdk-tests`: unregistered variable refused; key ∉ scope refused; two pipelines may share a key; `sdk:test` hash pins updated deliberately. |
| **P3 Assemble by variable** | Band merge and `bandValue` decide by resolved variable; drop `CORE_BANDS`-membership as the "render through layout" test. | Twenty Questions' `secretEntry` and core bands render as today (int parity); a plugin band named `characterLore` in its own pipeline renders through its own rows. |
| **P4 rebinding** | `PresetBuilder.variables()`, hashed; declarations expansion reads it; picker and defaults follow. | Int test: a spec rebinding `characterLore` offers only the rebound variable's rows and renders through them. |
| **P5 receipt + docs** | Per-key layout line in the run inspector; `docs/component-authoring.md` gains "Declaring a variable, a band and a layout"; `docs/pipelines.md` names rebinding; NOMENCLATURE §15/§25. | Docs test; screenshots of the inspector line. |

P1 and P2 are the fix for cases A and D and carry no product decision beyond ★1. P3 fixes B. P4 is the product feature for C and needs ★2.

## 6. Rulings asked (answered in §7)

- **★1 Scope of the one-key-one-variable rule.** Per template scope (proposed; what `bandsReaching` already enforces), or keep it global across the instance? Global keeps "the characterLore layout" meaning one thing in every picker, at the cost of forbidding case D outright.
- **★2 Rebinding at the spec.** May a spec rebind a core step's key to a plugin variable (`p.variables(node, { key: variableId })`)? Alternative: no rebinding; a pipeline that changes a value's shape must route it through a node that declares its own band under its own key, and the template places that key. Cheaper, but makes case C a template edit plus a new key for every extension.
- **★3 Floor for a rebound or plugin variable with no row.** Automatic JSON (proposed, matches the 2026-09-27 object-variable ruling) — or refuse at publish, since a layout is "a requirement for objects"?
- **★4 Plugin rows for core variables.** Allow (proposed: it is how a "prose cast" plugin ships), with `ownerPluginId`, immutable, never the default — or refuse at the packager like `core:` variable declarations are refused?
- **★5 The word.** 🚧 *rebind* / *rebinding* for "a spec says what a step's key means here" — or reuse *renders* (`p.renders(...)`) so the preset and the slot use one word (R1)? `renders` is already the slot field, which argues for reuse.

## 7. Rulings (owner, 2026-10-13)

| ★ | Ruling |
|---|--------|
| ★1 | **Per template scope.** Within one template's scope a name means one variable; different pipelines, or a plugin band that never meets core's, may reuse a key for different variables. The global parity-test assertion and `otherVariableRendering` go; the per-document `BandCollisionError` stays and is what law T1 reports. |
| ★2 | **Yes, rebinding at the spec, explicit and hashed.** Members and configs still cannot change what a key means. |
| ★3 | **Automatic JSON** is the floor for a rebound or plugin variable with no row (primitives as written). |
| ★4 | **Allow** plugin rows for core variables: plugin-owned, immutable, never the default, body linted against the core scope at package time. |
| ★5 | **Reuse `renders`.** `p.renders('assemble', { characterLore: 'acme:var/character-lore-ranked@1' })`; the preset and the slot use one word (R1). §3.7's 🚧 *rebinding* is withdrawn as a term; "a spec's `renders`" is the phrase. |

Phases P1–P5 in §5 stand as written, with §3.7 and P4 renamed to `PresetBuilder.renders()`.

## 8. Built (2026-10-13)

| Phase | What landed |
|-------|-------------|
| P1 | `ResolvedLayouts[key]` carries `variableId` (+ `name`, `origin`); `applyPipelineLayer` attaches the declared variable to every key, projects `{ variableId, engine }` when no row resolved, and drops a row written for another variable. `renderVariable` takes the absence rule, floor and scope root from the variable (`variableOfKey`, `shippedByVariable`); a non-core variable renders nothing for a nullish value. `sampleContext` lets the layouts' variable own a shared key. `defaultVariableTemplateFor` skips a package's row for a variable it does not own (`isForeignPackageRow`, ★4). |
| P2 (SDK) | `checkBandDeclarations` drops the global core-root and cross-definition refusals (★1); per-document `bandsReaching`/`rendersAt` collisions stay. `register()` runs `checkRendersDeclarations` (variable registered, key in scope, not an Assemble name). `variableSeedFindings` lints `variables` seeds against their variable's scope; the packager reports them (`E_TEMPLATE_SCOPE`; a variable it cannot see is a warning). |
| P3 | Assemble: `meansCoreBand` decides core shape vs declared-band shape for the three core keys; a re-pointed key reads no core roles and renders through its own variable's row or floor. `declaredBandKeys` by variable. |
| P4 | `NodeOpts.renders` → `BuiltNode`/`DocNode.renders` (only when stated, so hashes are unchanged), checked in the builder and under law T1; `effectiveRenders` folded into `rendersAt`. App: `pipeline_nodes.renders` (migration 0114), stored and reloaded; the panel opens a slot's renders when the node re-points a key; reconcile culls a pick for the old variable with a `culled` notice (`repointedLayoutPicks`). **Deviation:** placed on the node (beside `expose`), not `PresetBuilder` as §3.7 sketched — a preset is a config, and ★2 says a config never changes what a key means. |
| P5 | Assemble records `layouts: LayoutUse[]` for its placed keys; the run inspector's Prompt tab lists **Variable layouts (N)** (`layoutsView`). Docs: `context-templates.md`, `pipelines.md`, SDK `guides/extending.md`. NOMENCLATURE §15 + §25. |

**Review fixes (2026-10-13, two independent reviews):** `variablesOf` now carries a package's own variables named only by id in a definition's static `renders` or a pipeline node's `renders` (without it the host refused the definition); the seed lint no longer refuses parse findings (a Liquid layout using the instance's `jsonValue` read as a syntax error at packaging) and resolves the package's own variables from its manifest list first, with warnings under `W_VARIABLE_LAYOUT_UNCHECKED`; a no-op node `renders` entry is not stored; `refDefaults` uses a preset-named layout row only when it lays out the key's variable (otherwise cull → back-fill looped on every boot, two notices each); core's recalled-lines shape and core's history date roles apply only under core's variable; the canvas diff fingerprints a node's `renders`.

Not done: the context builders' own keys (`characters`, `instructions`, …) are not on the receipt's layout list — only Assemble's (`worldLore`, `characterLore`, `history`, `currentDate`, declared bands). Ranking still budgets by band key, which is correct under the per-document rule.
