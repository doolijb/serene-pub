# Scripts — predictable placement, manageable catalogue

**Status:** BUILT 2026-10-11 (P1–P5), uncommitted. Verified: `npm run sdk:test` 2723/2724 (one pre-existing vocabulary failure from today's lorebook edits to NOMENCLATURE), app suite 16065 passed with 2 fixes applied after the run (band-intents note text; comment-ratchet rewording — one remaining ratchet hit is in `shared/widgets/settings.ts`, owner's in-progress work), `tsc` and `svelte-check` clean except `sessionLayout/simulator.test.ts` (owner's in-progress work), screenshots under `.playwright-mcp/scripts-0*.png`. SDK changes need a prerelease + pin bump before push. Research findings and rulings below are as of 2026-10-10.

Carries forward the rulings of 2026-10-10: scripts stay **admin-only** (R1); each step shows its script chains **scoped by what the step accepts** (R2); **simplest to maintain and understand wins over flexibility** (R3). Carries forward R-O2 (a lost `text/stop` seam halts the run). Drops the derived-seam table and the `scripts` slot-kind retirement: ten shipped definitions declare slots today (`contracts/src/{inlets,outlets,oracles,tasks}.ts`), their declarations are correct, and 0.6 users have chains stored at those addresses.

## Goals

1. **Placement is predictable.** An administrator can answer, without reading code: *where in this pipeline can a script run, in what order, what flows through each place, and what actually ran on the last reply?*
2. **The catalogue is manageable.** An instance owner can answer, from Admin › Scripts: *which scripts fit which genre, pipeline, step and place; where is this one attached (pipelines and connections); what happens if I delete or disable it?*

Nothing here changes what a script sees or returns. Scripters are untouched.

## What exists today (verified)

- **Two seam kinds, one control.** A port hook is a `scripts` slot on the definition (`port`, `phase`, `accepts`, `extras`, `description`); an interior point is a `scriptPoints` entry. Both render as the `scripts-chain` control in the step's Advanced box (`config/panel/declarations.ts:350`, `:806`) with a name, a blast-radius badge, move/remove, and a *Missing script* row for a dangling id.
- **Two executor read paths.** `applyChainsAt(phase)` reads `config[nodeKey][slotName]['']` (`executor.ts:1462–1510`); `ctx.scripts.apply(point)` reads `config[nodeKey].scripts[point]` (`:1801–1840`). Both call the same `applyScripts` with a `ScriptHookSite { slot, phase, port, accepts, extras, origin }`.
- **Receipts record applications** (`nr.scripts`, `ScriptApplicationRecord` with `via`, `result`, `reason`, `durationMs`), including a connection's stop guards joining at any `text/stop` seam (`scripts/chains.ts:472`).
- **Admin › Scripts** is a changelist: Name · Type · Scope (content kind) · Status · In chains; filters Type / Scope / Status / Origin / Use; export, import, bulk delete refused while `usedBy` is non-empty; the edit page has name, status, declared reads/rewrites, and a CodeMirror source.
- **Connections** carry their own stop-script list (`connection_scripts`, `ConnectionStopScripts.svelte`).

## What is missing (verified)

| gap | where it bites |
|---|---|
| A chain option is labelled by its slot name — *Scripts*, *Cast Scripts* — with no phase or port. Two steps' *Scripts* boxes look identical while one runs before the model and one after. | goal 1 |
| No view lists a pipeline's seams in execution order. The only way to see "where can a script go" is to open every step's Advanced fold. | goal 1 |
| The run inspector draws nothing from `nr.scripts`. The records already reach the client inside `receipt.nodes[]` (untyped, `receiptView.ts:52`), so nothing is missing server-side. What ran, where, and whether a guard stopped a reply is invisible. | goal 1 |
| A removed seam (definition renamed a port, dropped a point) has its address culled by `reconcileConfigs` with a report line; a stop guard stops applying without a halt. Today a `text/stop` verdict never halts anything: the applier truncates the text and marks the winning application (`chains.ts:575`); the outcome type has no halt field (`executor.ts:493`). | goal 1 |
| Admin › Scripts has no *fits* filters. Prompts has Genre / Pipeline / Step; scripts have only Type and Scope, neither of which answers "can this go on the Chat reply?". | goal 2 |
| `usedBy` names pipelines (and `connection: <name>`), not steps or seams, and the edit page has no *Where used* section to jump from. It is computed by `scriptUsageIndex` in `pipelines/entities/scripts.ts:208`, which **does** read `connection_scripts` and gates deletion. But it walks only `slot = "scripts"`: a chain at extract-cast's `castScripts` slot is never counted, so a script placed only there reads **Unused**, can be deleted, and leaves a *Missing script* row. Narrow bug; this plan fixes it by walking every declared chain address instead of one slot name. | goal 2 |
| Built-in scripts are read-only with no *Clone* on the row or page; the prompts changelist has that affordance. | goal 2 |

## Design

### D1. Seams stay declared; one address names them

A **seam** is a place a script chain may run: a port hook or an interior point. Declarations do not change. What changes is how a seam is *named*, everywhere it is shown or recorded: the **seam address**

- `in:<port>` — the slot's `phase: 'before'` on `<port>` (`create-message` → `in:text`)
- `out:<port>` — `phase: 'after'` (`user-message` → `out:text`, `extract-cast` castScripts → `out:cast`)
- `<pointKey>` — an interior point (`each-draft`, `select`)

`ScriptHookSite` gains `at: SeamAddress` computed from the declaration; `slot`/`phase`/`port` stay for one release as the receipt's existing fields. Storage addresses are **unchanged** (`config[nodeKey][slotName]['']`, `config[nodeKey].scripts[point]`): no fold, no data risk, every stored chain keeps working.

### D2. One executor read path

`applyChainsAt` and `ctx.scripts.apply` both become calls into one `applyAtSeam(node, seam, value)` that resolves the seam from the definition, reads the chain at its storage address, invokes the applier, and records applications. The duplicate site-building and receipt-appending code goes. The `kind === 'scripts'` slot branch stays.

Two behaviours differ today and are kept as they are, per origin, so the golden-receipt test can pin them: the port path absorbs an applier throw into an `(engine)` err record and passes the value through, while the interior path lets the throw reach the binding that called it; and the port path propagates the new value to bag keys that aliased the old one. Unifying those is a separate decision, not a side effect of D2.

**Halt signal (new, small).** `ScriptChainOutcome` gains `halt?: { reason: string }`. The applier sets it only for D4's lost-guard case; `applyAtSeam` turns it into the node's `halt(reason)`, which the run already reports as `outcome: 'halt'`, `haltReason`, `haltNodeKey`. No other path sets it: a stop verdict keeps truncating as today.

### D3. Placement made visible (goal 1)

- **Chain option label and description.** `Scripts · after text` / `Scripts · before text` / `Scripts · at each draft`, then the slot or point description as today, then one generated line: *What flows here: the message as retrieval and the prompt will see it (text).* Shapes carry no display name (`defineShape` takes only an id), so this line is the slot or point `description` that already exists, with the shape named by the humanised last segment of its id (`template-context` → *template context*). No SDK change for labels. Accepted kinds are already the picker's scope; show the kinds' names as chips under the label so an empty chain still tells you what could go there.
- **Order within a step.** Advanced lists a step's chains in execution order: `in:` seams, then points, then `out:` seams. Within one phase, port declaration order, which is also the executor's iteration order; `seamsOf` is the one place that order is computed.
- **Script map.** A read-only view in the admin pipeline workspace (`admin/sections/pipelines/SlugPage.svelte`), as a **Scripts tab** beside Configure: every seam in the pipeline in run order, grouped by step, each with its attached chain and, on `text/stop` seams, the connection stop guards the panel already resolves (`read.ts:357`, `connectionScripts` on the option). Each row jumps to the step with the existing `?step=` handle and `jumpToOption(stepKey, optionId)` scroll-and-flash. Computed from declarations + config, nothing stored. *Deviation from R-Q1's wording:* the Whole pipeline group is options-only (`groups.ts:302`, `SettingsGroup` has no free block) and the builder renders one step flat with no Advanced fold, so "under Whole pipeline" has no slot to mount into; a tab in the same admin venue is the nearest faithful home. **Decided 2026-10-10 (owner delegated the call): the Scripts tab.** It keeps R-Q1's substance — admin venue, configuration not run, one screen — and adds no new group machinery (R3).
- **Run inspector.** A `<details data-run-scripts>` block on the selected step, after *Where its values came from* and before the tabs (`RunInspector.svelte:548`), reading `selected.raw.scripts` via a new `NodeRow.scripts`: script name, seam address, `via` (pipeline / connection / binding), result (`ok` / `skip` + reason / `err`), `won` for the stop that cut the text, duration. Old receipts spell the kind `typeId`; read both. A D4 halt lands in `haltReason`, which the inspector header, the runs panel and the session's progress card explanation already render.

### D4. Drift is marked, never silent (R-O2)

- A chain whose seam no longer resolves is **not** culled. The panel shows the row with a *no longer here* state (reuse the orphaned treatment, STYLE-GUIDE §component patterns); the script map lists it under *Unplaced*; the catalogue counts it as used.
- At run time the executor skips it and receipts a **note**, except when the chain contains a `text/stop` script: then the run **halts** with *stop guard "<name>" has no place to run on step <label>*. A guard that silently stops applying is the worst outcome; halting is the readable one.
- `reconcileConfigs` keeps culling when the whole **node** is gone from the spec, as today. This is the **one exception** to its generic rule (`named.ts:36`: a removed option's value is culled with a notice). The exception is scoped by address, not by guesswork: node still in the spec **and** the address is a script chain (a `scripts`-kind slot's `''` path, or the `scripts` facet). Every other undeclared address is still culled.
- **Surfacing.** An admin should not learn of an unplaced chain by opening a fold or by a halted reply. The boot reconcile report already lists culls; it gains an *unplaced* list, shown as one line in **Admin › Diagnostics** and counted by the Admin › Scripts *Unplaced* filter. A notification is the right vehicle once the notifications plan (09-28) lands; until then Diagnostics.

### D5. Catalogue made manageable (goal 2)

Admin › Scripts, mirroring what Prompts already does through `config/library.ts`:

- **Fits filters.** Genre · Pipeline · Step · Seam. A script *fits* a seam when its kind is in the seam's `accepts`; a step when any of its seams fit; a pipeline when any step fits; a genre through its presets' pipelines. Built exactly as prompts' are: `libraryView` already walks each spec's declarations for `prompts-ref` and records pools (`library.ts:316`); add the same walk for `scripts-chain` decls carrying `accepts`, and client helpers beside `promptsAdmin.ts`'s `pipelinesFitting` / `genresFitting`. `AdminChangelist` already supports `numeric` sortable columns and ordered filters.
- **Use filter** becomes *In a pipeline* · *On a connection* · *Unplaced* (D4) · *Unused*. `usedBy` is extended from strings to `{ pipeline, step, seam, stepKey, optionId }` rows plus `{ connection }` rows; the column keeps printing pipeline names, the cell tooltip lists steps. `scriptUsageIndex` walks every declared chain address (fixes the `castScripts` gap).
- **Where used** on the edit page: the same rows with jump links to `/admin/pipelines/<slug>?tab=configure&step=<stepKey>` plus the option flash. Both mechanisms exist (`SlugPage.svelte:325`, `:658`); the step key is an opaque handle the server already hands out on the builder graph, so the usage rows carry it. Connection rows link to the connection's stop list. Delete refusal names the first row, as it does today.
- **Clone** on built-in rows and on the read-only edit page, creating an editable copy of the same kind, as prompts do.
- **Columns.** Add *Fits* (count of seams across installed pipelines; sorts by it) so an unused script that fits nowhere is obvious from the list.

### D6. Who gains, honestly

- **Administrators** gain the most: labels that say where, the script map, the inspector block, fits filters, where-used, clone, a scripts doc. Every item answers a question they cannot answer today without reading code.
- **Members** gain one sentence: the run inspector is **admin-only** (`receiptsAdminOnly`, `sockets/pipelines.ts:544`), so they never see the Scripts block. What they see is the progress card's explanation, built from `haltExplanation(receipt)`; a D4 halt names the guard there. The stale comment at `chains.ts:486` saying receipts reach non-admins should be corrected in P1.
- **Modders** gain `seamsOf`, the seam address in receipts, and their declared slots appearing in the map and catalogue with no extra work. Today **nothing** validates a `scripts` slot: `register()` checks interior points for non-empty `accepts` only (`checkScriptPointsAccept`, `descriptors.ts:2080`) and never checks a slot's `port` against `d.ports` or its `accepts` against known kinds; the conformance package has no script check at all. Add `checkScriptsSlots` at `register()`: port exists on the side the phase implies, every `accepts` id passes `isScriptKindId`. Kind *existence* is a conformance requirement, since kinds may register after definitions.
- **Scripters** gain nothing here beyond vocabulary. Their win is the dry-run (R-Q3, separate plan). Say so in the handover so nobody reads this plan as the scripting DX programme.

### D7. Not in this plan

- No new storage address, no boot fold, no migration.
- No session-layer scripts (R1).
- No new script kinds, no change to the sandbox or `ctx`.
- No dry-run / try-it on the edit page. Worth doing for scripters; separate plan (Q3).

## Nomenclature

Record in §25 at build time; nothing retires that a catalogue uses.

- **seam** — a place a script chain may run: a port hook or an interior point. *(replaces **hook site** as the spoken term; `ScriptHookSite` the type keeps its name this release, ⏳)*
- **seam address** — `in:<port>` · `out:<port>` · `<pointKey>`; the one spelling of a seam in labels, receipts and the catalogue.
- **script map** — the read-only run-order view of a pipeline's seams and chains.
- **unplaced** — a chain whose seam no longer resolves (D4). Never "orphaned", which is the config-address word.

## Changes by file

### SDK (`../serene-pub-sdk`) — needs prerelease + pin bump

- `sdk/src/scripts.ts` — `SeamAddress` type, `seamAddressOf(slotDecl | pointDecl)`, `parseSeamAddress`.
- `sdk/src/executor.ts` — `at` on `ScriptHookSite`; `halt?` on `ScriptChainOutcome`; `applyAtSeam` replacing the two inline bodies (D2) and keeping the three `scriptHooks.length` gates (`:1541`, `:1586`, `:2004`) as "has any seam"; unresolved-seam note / `text/stop` halt (D4).
- `sdk/src/descriptors.ts` — `seamsOf(definition)`: ordered `[ { at, accepts, extras, description, shape } ]` from slots + points (none exists today; `scriptPointsOf` is the only reader), the one reader the panel, the script map and the catalogue all use; `checkScriptsSlots` in `register()` (D6).
- `sdk-tests/` — `seams.test.ts` (order, addresses, extras pass through); contract hashes unchanged because declarations are unchanged — assert that.

### Core

- `pipelines/config/panel/declarations.ts` — both emitters use `seamsOf` over the row (`row.slots` persists `port`/`phase`/`accepts`/`extras`/`description` verbatim, `registrySync.ts:157`; the branch at `:350` simply drops them today); label/description/kind chips per D3; order per D3.
- `pipelines/config/panel/types.ts`, `read.ts` — `at`, `kindChips`, `flows` on the option; `unplaced` on a chain row.
- `pipelines/config/named.ts` `reconcileConfigs` — keep node-gone cull; stop culling a seam-gone address, mark instead (D4).
- `pipelines/scripts/chains.ts`, `host.ts` — read `site.at`; receipt rows carry `at`.
- `pipelines/config/library.ts` — `scriptPools` beside `promptPools` in `libraryView` (`:316`): per pipeline, the seams with their `accepts`.
- `pipelines/entities/scripts.ts` — `scriptUsageIndex` walks declared chain addresses (not `slot = "scripts"`), returns structured rows with `stepKey`/`optionId`; `scriptsView` adds `fits`. Clone already exists (`pipelines:cloneScript`); the page just needs the affordance.
- `sockets/pipelines.ts`, `sockets/connections.ts`, `sockets/plugins.ts` — the scripts list is re-sent only by its own handlers today. Add `scriptsAnswer` emits after a `scripts-chain` write, after `connections:attachScript` / `detachScript`, and after `plugins:setEnabled` / install / uninstall, inside the existing `pipelines:` interest family.
- `pipelines/scripts/chains.ts` `connectionStopsFor` — resolves the instance `text->text` default only and never passes the config's connection tier (`:685`). Verify end to end whether a config that names another connection applies the wrong guards; if so, fix in P1 by passing the config, since the map and the panel both show these guards.
- `admin/sections/diagnostics` — one line for unplaced chains from the reconcile report.
- `sdk/conformance` — scripts-slot kind-existence requirement (D6); nothing covers scripts there today.
- Client `pipelines/PipelineConfigOptions.svelte` — label, chips, flows line, unplaced row state.
- Client `admin/sections/pipelines/ScriptMap.svelte` (new), a tab in `SlugPage.svelte` (D3, R-Q1 as amended).
- Client `pipelines/inspector/receiptView.ts` (`NodeRow.scripts`), `RunInspector.svelte` (`data-run-scripts` block).
- Client `admin/sections/scripts/Page.svelte`, `IdPage.svelte` — Fits filters, Use filter values, Fits column, Where used, Clone.
- Docs: `docs/pipelines.md` (Advanced → *Scripts*: seams, order, the script map; *Inspecting a run* → scripts block), `docs/group-sessions.md` (the *Scripted* turn order sentence uses seam vocabulary), a new `docs/scripts.md` (what a script is, kinds and blast radius, where scripts go, Admin › Scripts filters, connections' stop guards) registered with one line in `GUIDE_ORDER`'s *For power users* group in `scripts/build-docs.js` (after `context-templates`), NOMENCLATURE §25, STYLE-GUIDE only if the *unplaced* state needs a new treatment (reuse orphaned first).

## Tests

- SDK: `seams.test.ts`; `executor` — both read paths produce identical receipts before/after D2 (golden, including the per-origin throw behaviour and alias propagation), unresolved seam note, lost-guard halt via `outcome.halt`, empty chain still reaches the applier on text seams; `register()` refuses a scripts slot naming an undeclared port or a malformed kind id.
- Core: `panel/scriptsChain.int.test.ts` — labels and order; `named.ts` — seam-gone script address marked not culled, node-gone still culled, a seam-gone **non-script** address still culled (the exception stays narrow); `entities/scripts` — a `castScripts` chain counts as use and blocks delete, fits per seam; list re-sent after a chain write, a connection attach and a plugin toggle; `chains.interiorAccepts.int.test.ts` unchanged.
- Client: run-inspector renders a receipt with one applied, one skipped, one stop; admin scripts filters narrow correctly.
- One grouped verification at the end: `npm run sdk:test`, `npm run sdk:build`, `npm test`, `npx tsc --noEmit -p .`; screenshots of Advanced, the script map, the run inspector block and Admin › Scripts.

## Phasing

1. **P1 SDK** — D1 + D2 + D4 executor half. No visible change; receipts gain `at`.
2. **P2 Panel** — D3 labels/chips/order + D4 unplaced row. First visible win for placement.
3. **P3 Inspector + script map** — D3 remaining.
4. **P4 Catalogue** — D5.
5. **P5 Docs** — `docs/scripts.md`, `docs/pipelines.md`, ledger.

P1→P2→P3 are sequential; P4 depends only on P1 (`seamsOf`) and can run alongside P2/P3. Each phase ends green on its own tests; the full suite runs once at the end.

## Research findings (2026-10-10, four read-only passes + real data)

- **Real data.** The owner's live 0.6 instance has **no** script rows, **no** chain values at any script slot (config or preset values), **no** connection stop guards and **no** receipts with script records. "No fold" holds trivially; every gain here is prospective.
- **Registry rows carry slot declarations verbatim** (`material.slots.scripts = { kind, accepts, port, phase, extras }` confirmed in the live registry), so `seamsOf` can run on the server from rows.
- **No halt from scripts today**; see D2 for the new `outcome.halt`.
- **No validation of scripts slots** at register or conformance; see D6.
- **Inspector is admin-only**; members see only the progress card explanation. D6 corrected.
- **Connection guards at config time** are already resolved by the panel from the instance default (`read.ts:207`), reusable by the map; possible config-tier mismatch flagged in *Changes by file*.
- **Whole pipeline group has no mount point**; the map becomes a workspace tab (D3; R-Q1 amended).
- **Step deep links exist** (`?step=<hmac>` + `jumpToOption`); usage rows must carry the step key.
- **Scripts list never re-sends** on chain writes, connection attach/detach or plugin toggles; emits added in *Changes by file*.
- **Retracted:** the earlier claim that connection-only scripts could be deleted. `scriptUsageIndex` reads `connection_scripts`; the real gap is the `castScripts` slot.

## Ruled 2026-10-10 (owner took all four recommendations)

- **R-Q1** The script map lives in the admin pipeline workspace as a **Scripts tab** beside Configure, admin venue only. It describes configuration, not a run, so it does not sit beside the run inspector. *(Amended 2026-10-10 from "under Whole pipeline → Scripts" after research showed that group has no mount point; owner delegated the call.)*
- **R-Q2** The chain picker inside a step's Advanced box **stays scoped** to the seam's accepted kinds (ruling 2). Fit across seams is explored in Admin › Scripts through the fits filters, never in the picker.
- **R-Q3** Dry-run on the script edit page is a **separate plan**, to be scoped after P1's `seamsOf` reader lands. Not P6 here.
- **R-Q4** An **unplaced** chain is **marked only**: the row shows *no longer here*, unrelated settings save normally, the executor skips transforms with a receipt note and **halts** the run for a lost `text/stop` guard (R-O2). Saves are never blocked and rows are never auto-removed.
