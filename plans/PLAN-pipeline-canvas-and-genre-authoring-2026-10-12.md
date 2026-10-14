# PLAN — The pipeline canvas, custom steps, in-app genres and the bundle (2026-10-12)

**Status: P1–P5 BUILT+VERIFIED 2026-10-12 (uncommitted; needs SDK prerelease + pin bump — `settings.ts`, `builder.ts`, `scripts.ts`, `contracts/tasks.ts` changed); §9 RULED 2026-10-12.** Phases P2–P5 are decided here and can be built as written once the
rulings in §9 are answered; P1 needs none of them. Surveyed 2026-10-12 against the working tree
(HEAD `2e544d1a` plus ~840 uncommitted files) by four readers: spec storage and sockets, the admin
pipeline workspace, the SDK document and registry, and genres / presets / the plugin package.

## 0. What is being asked

Ruled by the owner in the 2026-10-12 design thread (the Design artifact "Pipeline Canvas Designs",
thirteen stress boards over design **5e**):

1. **A canvas and an editor for pipelines, in the app.** Design 5e: a navigator strip of the whole
   spec on the left, the spec drawn at reading size in the middle with the selected clause opened
   in place, and a drawer along the bottom with tabs that holds **everything** about the selected
   item. Cards show the **key only**; the drawer owns type ids, ports, settings and the last run.
   No data lines on the canvas. Clauses are always drawn with their chains.
2. **Custom logic in-app** in three tiers: a step made of steps (no code), a script step
   (QuickJS, the engine the app already runs seam scripts in), and a plugin node for anything with
   reach (storage, network, writes) — that one stays in the SDK.
3. **A whole genre authored in-app** (session fields, create and reply pipelines, prompts, presets
   and configurations, layout, frames as widgets, styles) and **bundled** as a content-only plugin
   package the existing installer accepts, with a scaffold export when code is needed.
4. **An order of operations** for someone starting from scratch, as a checklist on the genre page.

Not asked, not built: model-call budgets (sampling + spec settings already cover it, owner
2026-10-12); a Lattice-style free-form node graph (the ranked-graph board was dropped).

## 1. Facts that shape the build

**Storage.** Rows are the system of record; the document is a projection (`boot/store.ts:1-20`).
`saveDocument(db, doc, {publish, sourcePluginId, batch})` validates and writes a version whole;
`(spec, semver, hash)` is the key, so an edited document is a **new row** and re-saving an identical
one writes nothing (`store.ts:77-142`). `publish:false` writes `status:'draft'` — **nothing calls it
that way today**. `publishVersion` retires the old published row and moves `activeVersionId`
(`store.ts:415-443`). `loadDocument(db, versionId)` reads a version back (`store.ts:912`).
`reconcileConfigs` runs only at boot (`boot/seed.ts:407`); a publish path must call it itself
(`config/named.ts:836-1087`: cull with notices, inert sweep, back-fill).

**What the client sees.** `pipelines:detail` carries versions and a topology `graph` of the active
version only — no node config, edges without `toPort` (`shared/sockets/types.ts:9011-9148`). No
socket sends a `SpecDocument`. Option ids and step keys are HMACs; nodes pair with steps through
`graph.nodes[].stepKey`. Receipts: `pipelines:run {runId}` → `receipt.nodes[]` with `nodeKey`,
`result ok|halt|err|skip`, `elapsedMs`, `tokens`, `iteration`, `dry` (`sdk/src/receipt.ts:18-127`;
client rows `inspector/receiptView.ts:287`).

**The SDK document.** `SpecDocument` is plain JSON: `nodes[]` (`key, kind, definitionId,
definitionVersion, config, clauseId?, clauseChain?, position, expose?`), `edges[]`, `clauses[]`
(`id, kind gather|each|loop|junction, mode, over?, max?, repeatWhile?, on?, branches?, chains,
clauseId?, clauseChain?, position`), `presets[]`, `includes[]`, `input` (the inlet lock)
(`sdk/src/document.ts:26-99`, `builder.ts:278-322`). Keys are dotted: `gather.history.read`; a
nested clause is `via.narrate.talk`. `compile(builtSpec)` is the JSON → document path for an editor
(no builder needed); `validate(doc)` → `Finding{law, severity, nodeKey?, message, fix}`
(`validate.ts:59-93`). `canonicalHash` covers the whole document. `allDefinitions()` and
`snapshotRegistry()` enumerate node definitions with ports (shape ids) and slots
(`descriptors.ts:2407`, `registry.ts:216`). Fragments exist (`fragment` + `.include`) and inline
their nodes under a key prefix — but `include` does **not** rewrite the fragment's internal
`DataRef`s (`builder.ts:1313-1335`), so a composite with internal wiring is broken until that is
fixed. No script-step definition and no generic data-in/data-out script kind exist
(`scripts.ts:243-421`).

**The workspace.** `admin/sections/pipelines/SlugPage.svelte` is an `AdminChangeForm` with tabs
`configure | scripts | changes | runs | versions | preset` on `PanelTabStrip` (L348-356, 789-807,
1065-1338). Configure holds a List / Map navigator beside the step inspector, which mounts
`PipelineConfigOptions` for the selected step with the page's draft (`pending`, `pendingClears`,
`draftSet`, `draftClear`) and the save row. The Map is `workspace/PipelineMap.svelte`: xyflow + ELK
over `graph`, with `flow/context.ts` holding `KIND_STRIPE` (inlet surface · query success · task
primary · oracle warning · outlet error) and `CLAUSE_ACCENT`. The page measures its own width
(`workspaceWidth`, L95-105) and never reads the viewport. Pipelines are admin-only (10-09).

**Genres and presets.** A genre has no table: it is the published create spec's version row
(`genre`, `input_genre`, `input_event` columns). Event → spec binding lives on **presets**
(`session_presets.bindings`), not on the genre. A preset binding is valid only if the spec's inlet
lock names the preset's genre, so copying a genre means copying its specs with `input.genre`
rewritten. Admin › Session genres (`admin/sections/session-genres/`) edits availability, the default
preset and an inline presets table; the event surface is read-only. `SessionShape.fields` is the
session form (`sessions.genre_fields`).

**The package.** `dist/plugin/manifest.json` (schemaVersion 1, slug, name, semver, pipelines[],
genres[], presets[], configs[], prompts[], components[], layouts[], widgets[], surfaces?, requires[])
+ `dist/plugin/pipelines/<id>.json` + `dist/plugin/components/<slug>.js` + `<root>/ui/**`. **No
`bundle.js` is needed**: a package that declares no callables installs its declarations with no
warning (`plugins/install.ts:136-155`). A widget must name a component module, but a ~600-byte
hand-written ES module placing an `<sp-frame>` is enough (`plugins/fixtures/unified-plugin/dist/
plugin/components/tally.js`). Installer: `installPluginPackage(db, dir)` behind
`plugins:installLocal` (folder on disk, admin, `SP_PLUGINS_ENABLED`). Refusals: a genre needs a
shape, exactly one create document and at least one preset; ids under the slug; slash-name and envoy
collisions pub-wide. Downloads go over the socket as `{blob, filename}` (`utils/downloadBlob.ts`).

**Sandboxes.** Seam scripts run in QuickJS-in-WASM, fresh instance per evaluation, 48 MB, 250 ms
interrupt with an 8× wall backstop, JSON in / JSON out, a seed, nothing else reachable
(`scripts/engine.ts`, `scripts/run.ts`). Plugins run in a shared QuickJS sandbox or one SES worker
each, with a `ctx` granted by hook kind (`plugins/SandboxManager.ts`).

## 2. Vocabulary (NOMENCLATURE §24; ledger entries land with P1)

| Word | Means | Why not the obvious one |
| --- | --- | --- |
| **pipeline canvas** (tab label **Canvas**) | The workspace tab that draws a spec as 5e. Always qualified: **map canvas** is the Places renderer. | — |
| **minimap** | The navigator strip: every node and clause as dots on one line, the selection banded. | *map* is a retired clause kind and the Places control; *spine* is the Focus strip; *overview* is the admin index. |
| **line** | The spec at reading size: cards in run order, a clause opened as parallel lines. | *stage* retired; *lane* banned for gather branches. |
| **drawer** (phone: **sheet**) | The bottom panel with tabs for the selected item. | — |
| **selected** step / clause | What the drawer shows. | *focus* is the view width. |
| **In ports** · **Out ports** | Drawer tabs. | *carry* is a loop's accumulating output; *receives* fine but paired with *carries* it collides. |
| **overlay** `none · receipt · diff` | What the canvas colours cards by: nothing, the last run, the published version. | *mode* is a genre's state mode; *lens* is lorebooks'. |
| **composite step** 🚧 | A fragment saved to the pipeline library, drawn as one card, inlined at publish. | owner to confirm the word (§9 Q1). |
| **script step** 🚧 | `core:task/run-script@1`: a task whose body is a script of kind `core:script:data/transform@1`. | — |

Kind colours stay `KIND_STRIPE` (`flow/context.ts`) so List, Map and Canvas agree; the 5e boards'
palette is not adopted (§9 Q4).

## 3. P1 — The canvas tab, read-only, with overlays

**Server**
- `pipelines:document {slug, versionId?}` → `{document: SpecDocument, version:{id, semver, status,
  canonicalHash, isActive}}`; admin only; `versionId` absent = the active version; error event
  `pipelines:document:error`. `loadDocument` does the work. Gated (`GATED_EVENTS`); the one consumer
  is on the interest registry. Int test beside `pipelines.scoping.int.test.ts`.

**Client** (`components/pipelines/workspace/canvas/`)
- `lineModel.ts` — pure. `lineOf(doc)` → rows: `node | clause{branches[{name, rows}]}`, nested,
  in position order, from `nodes[].clauseId/clauseChain/position` and `clauses[]`. `portsOf(doc,
  key)` → in ports (edges into the key, plus slot refs from config), out ports (edges out, grouped by
  port, with their consumers). `diffOf(a, b)` → added / removed / changed keys. Unit-tested on a
  compiled core spec (adventure respond) and a hand fixture with a nested junction.
- `Minimap.svelte` — SVG, vertical beside the line, horizontal scrubber when the workspace is under
  720px. Dots per node, a square per clause, branch rows with dots, selection band, overlay colours.
- `Line.svelte` — cards (key only, kind stripe, selected ring), clauses as containers; an opened
  clause draws its branches as parallel lines with the chain label and the cards stacked; `each`
  wraps long chains into columns of five; a closed clause is one row with its dots. Overlay dots
  on cards: ran · halted · dry · not reached (receipt) and added · removed · changed (diff).
- `CanvasDrawer.svelte` — `PanelTabStrip` tabs: **Node** / **Clause** (type id, kind, meaning,
  the clause's rule and predicates) · **In ports** · **Out ports** · **Settings** (mounts
  `PipelineConfigOptions` for the selected step with the page's draft — the config relationship,
  §0 ruling: canvas edits addresses, settings edit values, one save row) · **Last run** (that
  node's receipt rows across iterations). Collapsed state is the tab strip alone.
- `CanvasPanel.svelte` — owns the document request, selection, open clauses, overlay; measures
  width; passes the page's draft props through. Receipt overlay reads the newest of the page's
  `pipelineRuns` and requests `pipelines:run`. Diff overlay requests the previous retired version
  and diffs documents.
- `SlugPage.svelte` — a seventh tab `canvas` (icon `Icons.Route`), rendering `CanvasPanel`.
- DOM test for `CanvasPanel` with a fixture document; the lineModel tests; one int test.
- Docs: `docs/pipelines.md` gains *The canvas* under *Finding a preset's configuration*;
  NOMENCLATURE §25 ledger rows for §2; STYLE-GUIDE §6.11 one line on the canvas tab.

**Done when** the Adventure and Lair replies render with every clause expressible, the drawer
shows In/Out ports and the step's settings with the save row still working, the receipt overlay
colours a real dry run, and the three widths (Focus, Half, Dock 400px) each hold the whole feature.

**Built 2026-10-12.** `pipelines:document` + int test (4); `canvas/lineModel.ts` + 10 unit tests on
the compiled Adventure and Lair replies; `Minimap`, `LineView`, `CanvasDrawer`, `CanvasPanel` + 5
DOM tests (line, open-in-place, drawer tabs incl. the mounted step editor, receipt overlay, diff
overlay); the `canvas` tab in `SlugPage.svelte`; svelte-check clean for every touched file (the two
remaining errors are `sprites/fill.test.ts`, pre-existing). Screenshots on an isolated instance at
1440 and 640: `scratchpad/shots/*.png`. Not verified live: the receipt overlay against a real run
(a fresh instance has no model), covered by the DOM test only.

## 4. P2 — The editor (contract; built in three lanes on disjoint files)

**Rulings applied (owner, 2026-10-12, §9):** publish proposes a patch bump and allows the same
semver (the store's rule: a new row by hash, the old one retired); in-app content lives under an
**owner slug the admin picks when creating** (plugin slug grammar, never `core`); a saved group of
steps is a **composite step**; kind colours stay `KIND_STRIPE`; event → spec is edited **on the
genre page, writing the default preset's bindings**; export and install both stay behind
`SP_PLUGINS_ENABLED`.

### 4.1 Storage (lane A)

`pipeline_drafts` — migration `0108` via `db:generate` against a scratch dir, journal index checked:
`id`, `spec_id` → `pipeline_specs` (cascade), `user_id` → `users` (cascade),
`based_on_version_id` (int, the version the draft started from, nullable),
`document` (json: a `SpecDocument`, compiled, possibly invalid), `findings` (json: the last
`validate()` result), `created_at`, `updated_at`; unique `(spec_id, user_id)`. A draft is per
admin per spec; it may be invalid, which is why it is not a `pipeline_spec_versions` row.

### 4.2 Events (lane A; all admin-only, each with a `<event>:error` twin; all gated)

| Event | Params | Response |
| --- | --- | --- |
| `pipelines:draft:get` | `{slug}` | `{slug, draft: Draft \| null, shipped: boolean}` — `shipped` = the spec is core's or a plugin's (`slug` starts `core:` or `sourcePluginId` set): editing it must fork first |
| `pipelines:draft:put` | `{slug, document}` | `{slug, draft: Draft}` — the server rebuilds edges: `compile({...document as BuiltSpec, nodes without resolvedRefs})`, runs `validate()`, stores both |
| `pipelines:draft:discard` | `{slug}` | `{slug, discarded: true}` |
| `pipelines:draft:preview` | `{slug, semver}` | `{slug, findings, semverTaken: boolean, affected: [{configId, configName, culled: string[], backfilled: string[]}]}` — what publish would do, nothing written. `culled` = config value addresses whose `nodeKey` no longer exists or whose slot the node no longer declares; `backfilled` = declared addresses with no value |
| `pipelines:draft:publish` | `{slug, semver}` | `{slug, version: {id, semver, canonicalHash}, reconcile: {culled, backfilled}}` — `saveDocument(doc with version=semver, {publish:true})`, then `reconcileConfigs(db, specId, versionId, slug)`, then the draft row is deleted, then `pipelines:detail` is re-emitted to the user. Refusals (validate errors, slash collisions, template fit) come back as `:error` with the sentence |
| `pipelines:catalogue` | `{}` | `{definitions: RegistryEntry[]}` from `snapshotRegistry(allDefinitions())`; later `composites` (P3) |
| `pipelines:fork` | `{slug, ownerSlug, name, label}` | `{slug: newSlug}` — copies the active document to `${ownerSlug}:spec/${name}`, drops `contributes.actions` (slash names are pub-wide), keeps the inlet lock, `saveDocument(publish:true, name: label)`, `derived_from_spec_version_id` set. `ownerSlug` must match `/^[a-z0-9]+([.-][a-z0-9]+)*$/` and not be `core` |

`Draft = {document: SpecDocument, findings: Finding[], basedOnVersionId: number \| null, basedOnSemver: string \| null, updatedAt: string}`.

### 4.3 Pure edits (lane B; `canvas/edits.ts`, unit-tested on the compiled core specs)

Every function takes a `SpecDocument`, returns a new one, never touches `edges` or `resolvedRefs`
(the server recompiles), and renumbers `position` in run order.

- `insertNode(doc, {after: string \| null, container?: {clauseId, chain} \| null, key, definitionId, definitionVersion, kind, config?})`
- `removeNode(doc, key)` → `{doc, severed: {key, port}[]}` (refs that pointed at it are dropped from configs)
- `moveNode(doc, key, 'up' \| 'down')` within its container
- `renameKey(doc, from, to)` (nodes and clauses; nested keys, `DataRef.node`, `SlotRef.ofNode`, clause `over/on/repeatWhile`)
- `setInput(doc, {genre?, event?, events?})`
- `addClause(doc, {after, container?, id, kind, mode?, max?, chains, branches?})`, `removeClause(doc, id)` (members go with it), `addBranch(doc, clauseId, name, predicate?)`, `renameBranch`, `removeBranch`
- `wire(doc, key, path, source: {node, port} \| null)`, `setLiteral(doc, key, path, value)`, `setSlotRef(doc, key, path, slotRef \| null)`
- `upstreamOf(doc, key)` → keys that run before `key` and are visible from its container (the wire picker's candidates)
- `nextKey(doc, base)` → a free key

### 4.4 The editing UI (lane C, mine; `CanvasPanel`, `CanvasDrawer`, `LineView`, `Minimap`)

- Bar: **Edit** when no draft (shipped → the fork dialog: owner slug, name, label → `pipelines:fork` → the workspace opens on the new slug). With a draft: _Draft · from 1.20.0 · N notices_, **Validate**, **Discard…**, **Publish…** (dialog: semver pre-filled with a patch bump, the preview's affected configurations, culled addresses named; refused sentences shown in place).
- Drawer actions for a node: **Add after…** (the drawer becomes the catalogue: search, kind chips, tiles with type ids), **Remove**, **Move up / down**, **Rename…**; for a clause: **Add branch**, **Rename / Remove branch**, **Add node in branch…**.
- **In ports** editable in a draft: each row a picker over `upstreamOf × that definition's out ports`, _literal…_ (a text field; JSON for objects), or _slot_; **Notices** tab listing findings with the fix, click → select.
- Every edit → `pipelines:draft:put`; the response's document replaces the local one (edges rebuilt, findings fresh). The diff overlay with a draft compares draft against active locally.

**Built 2026-10-12.** Lane A: `pipeline_drafts` (migration 0108), `sockets/pipelineDrafts.ts` with
the seven events (`draft:get/put/discard/preview/publish`, `catalogue`, `fork`) and 13 int tests;
`draft:put` also refuses a node whose definition is not registered, which `validate()` does not
(found by lane A). Lane B: `canvas/edits.ts` (the §4.3 functions; `severed` is `{key, path}`; every
function renumbers and sorts the arrays into run order, because `compile()` draws the implicit
spine edges by array order) with 21 tests. Lane C: `draft.svelte.ts` (the session), the bar
(Edit / Copy and edit… / Validate / Discard… / Publish…), the three dialogs, the drawer's actions
row, catalogue, In ports pickers and Notices; 5 more DOM tests. Grouped run: 313 tests in the
pipelines area pass; svelte-check clean. Live walk on the isolated instance: copy Adventure →
`acme.lab:spec/reply` → draft → add after rank → wire → publish 1.0.1 with reconcile. Docs,
ledger (pipeline draft · copy · owner slug) updated.

## 5. P3 — Custom steps

- **Composite step.** SDK: fix `include` to rewrite internal `DataRef`s and clause refs under the
  prefix (a bug today). App: *Save selection as step* writes a fragment document to the pipeline
  library (`pipeline_fragments`, new table, migration generated); the catalogue lists it under
  **This pub**; inserting it inlines the nodes under the chosen key and records `includes[]`. A
  library change notices every spec that includes it.
- **Script step.** SDK: `defineScriptKind('core:script:data/transform@1', {ports: json→json,
  semantics:'transform', blastRadius})` and `describeTaskDefinition('core:task/run-script@1')` with
  in port `input: json`, out port `main: json`, a `scripts` slot accepting that kind, and a
  `budgetMs` param slot. App: the task's binding runs the chain through `scripts/run.ts` with the
  slot's budget (default 250 ms; an `each` body runs it per item). Drawer: a **Script** tab with
  `ScriptField`, kind, blast radius, and **Test** against the last receipt's input for that node.
- The rule Validate enforces: a task may be custom in-app; a query, oracle or outlet is a plugin.

**Built 2026-10-12.** SDK (lane D): `include` rewrites a fragment's internal refs (use case 20b);
`dataTransform` = `core:script:data/transform@1`; `C.runScript` = `core:task/run-script@1` (in
`input: json`, out `main: json`, one `scripts` slot on `out:main` accepting data/transform,
`timeoutMs: 2000`); SDK suite 2975 green; `sdk:build` run with no instance up. App: the
`run-script` binding is identity (`bindings.ts`, beside concat-candidates); the seam applier is
generic over a kind's ports so no host code runs the script. Composites (lane E): table
`pipeline_composites` (not `pipeline_fragments` as §5 first said), migration 0109,
`pipelines:composite:save · delete`, the catalogue's `composites[]`, 6 int tests. Client:
`extractComposite` / `insertComposite` in `edits.ts` (4 tests), _Save as step…_ in the drawer, the
catalogue's **composite** chip, 1 DOM test. Not built: the per-step `budgetMs` slot (the seam default
applies) and the drawer's _Test against the last run_ button; both are small follow-ups.

**`budgetMs` built 2026-10-13.** `run-script@1` declares `params.budgetMs` (integer 1–1000, default
250, UI _Script time limit (ms)_); hash moved (`registryHashes.test.ts`). The HOST reads it:
`scriptBudgetsByNode` (`scripts/runSeams.ts`) resolves it per step through the scope chain,
clamped to the declared bounds, and `makeScriptApplier`'s `budgetMsByNode` gives that step's links
its limit over the seam default (`runTurn.ts`). `declaredReads.ts` exempts the field on a
definition with a `scripts` slot (`SCRIPT_BUDGET_PARAM`), as it exempts the `scripts` slot itself.
Int test: a 5 ms limit stops a looping script, recorded `err` "timeout after 5ms", the next link
runs. The drawer's _Test against the last run_ is still not built.

## 6. P4 — A genre in-app (contract; two lanes on disjoint files)

**Facts that shaped it (survey 2026-10-12):** a genre is its create spec's version row (`genre`
json, `input_genre`); its stats, sheets, omitWidgets and layouts live only in the SDK's in-process
registry (`getGenre`), which plugins fill through `registerPluginGenres` and whose `syncPluginGenres`
withdraws every `held` id not installed; event → spec lives on presets, and `sessionPresets:update`
drops `bindings` silently on an immutable preset (every core preset is immutable); `validateBindings`
requires a bound spec's inlet lock to name the genre; `pipelines:fork` keeps the lock, so a forked
core create spec lists the genre twice; a genre's default layout must be a `core` or `plugin` origin
row, so an in-app genre needs a new origin; no editor exists for a `SettingsSchema` definition;
no reusable checklist component exists (the Overview's _Needs you_ and the wizard's service road
are the two inline patterns).

### 6.1 Server (lane H)

- **`sessionGenres:create {ownerSlug, name, label, description?, family?, from: genreId, scope: 'all' | 'create'}`**
  → `{genreId}`. Refusals as sentences: owner slug grammar / `core` / equal to an installed plugin's
  slug; name grammar; a genre with that id already listed. Copies from `from` (any listed genre):
  the active create document always; with `scope: 'all'` every active published spec whose
  `input_genre` is `from` (reply, turn order, answer form, action specs). Per document: new id
  `${owner}:spec/${name}-${what}` where `what` is the source slug's tail after the source genre's
  own name (`core:spec/adventure-respond` → `acme.lab:spec/quest-respond`); `input.genre`,
  `taxonomy.genre`, every `contributes.actions[].genre` → the new genre id; on the create document
  the `genre` block's name / description / family from the params, `shape`, `events`, `envoys`,
  `playerLabel`, `settings` copied; `presets[].owner` → the owner. Save as a **batch** (create
  document first), then `assertInstallSlashNamesFree`, then `reconcileConfigs` for each. Then one
  preset row: name = label, `genreId`, `bindings` = the source's default (else first enabled)
  preset's bindings remapped old slug → new slug (dropping events whose spec was not copied),
  `includedActions` remapped, `isDefault: true`, `enabled: true`, `isImmutable: false`. Then the
  source genre's default layout row copied under the new genre with origin **`pub`** (migration
  0110: the `session_layout_presets` origin CHECK gains `pub`; `isGenreDefaultCandidate` and
  `genreDefaultLayoutRow` accept it; `syncLayoutPresets` and `syncPluginLayouts` leave it alone).
  Then the registry: `registerPubGenre(newId, from, {name, description, family})` registers
  `{...getGenre(from), id, name, description, family}` so stats, sheets and omitWidgets follow —
  through a path `syncPluginGenres` does not withdraw — and a boot hook `registerPubGenres(db)`
  (called where `syncPluginGenres` is) re-registers every active create version whose owner is
  neither `core` nor an installed plugin, reading the source from `derived_from_spec_version_id`.
- **`sessionGenres:update`** gains `{name?, description?, family?, fields?: SettingsSchema}` for a
  genre whose owner is neither core nor a plugin: load the active create document, set the
  `genre` block, `saveDocument(publish: true)` (a new row by hash), `reconcileConfigs`; refuse for a
  shipped genre with a sentence. `fields` are checked by the SDK's `settingsSchemaFindings` through
  `validate()`.
- **`sessionGenres:detail`** gains `origin: 'core' | 'plugin' | 'pub'`, `editable: boolean`,
  `fields: SettingsSchema` (from `shape.fields`, `{}` when none), `hasState: boolean`
  (`getGenre(id)?.slots?.length`), `layout: {slug, name} | null` (`genreDefaultLayoutRow`),
  `pluginsEnabled: boolean` (the install flag, so the page can offer Export).
- Int tests: create from Adventure (`scope: 'all'`) → specs under the new ids with rewritten
  locks and `taxonomy.genre`, the create document's `genre` block carries the new name, the
  default preset binds the copied reply, `reconcileConfigs` left a default configuration per spec,
  `getGenre(newId)` exists, the layout row exists with origin `pub`, `listSessionGenres` lists the
  genre once; update fields → the create spec has a new active version and the detail returns the
  fields; refusals.

### 6.2 Admin UI (lane I)

- `session-genres/Page.svelte`: `addHref="/admin/session-genres/new"`, `addLabel="Add genre"`,
  the header comment and purpose text updated.
- NEW `session-genres/NewPage.svelte` (copy `session-presets/NewPage.svelte`'s shape): owner slug
  (the fork dialog's wording and `OWNER_SLUG`), name, label, description, family, **Start from** (a
  select of listed genres, default Chat) and **Copy** (_everything_ · _the create pipeline only_);
  submit → `sessionGenres:create` → `adminGoto('/admin/session-genres/<id>', {replaceState})`.
- `session-genres/IdPage.svelte`:
  - a **Readiness** card at the top (pure `genreReadiness.ts`, tested): name · session fields ·
    create pipeline · reply pipeline (the default preset binds message-respond) · default preset ·
    state (`hasState`) · layout (`layout`) · other events (every required slot bound) · export.
    Gold dot until set, green when done, the next unticked item carries the one action.
  - **About** card editable when `editable`: name, description, family → `sessionGenres:update`.
  - **Session fields** card: NEW `SettingsSchemaEditor.svelte` (fields: key, label, type among
    string · text · number · integer · boolean · enum · string[], default, enum options, required;
    add / remove / move) with a live `SchemaForm` preview; saves `fields` through the page's
    `saveInSequence` as `sessionGenres:update {fields}`. Read-only JSON stays for shipped genres.
  - **Events** card: for an editable genre with a default preset, each bindable slot gets a
    candidate `Select` (from `slots[].candidates`) and the save writes
    `sessionPresets:update {id: defaultPresetId, bindings}`; shipped genres keep the read-only
    surface. Lift the preset page's slot rows into `components/admin/PresetBindingsRows.svelte`
    if that is cleaner than duplicating.
  - Header action **Export as plugin…** when `pluginsEnabled && editable`: asks version (default
    `1.0.0`) and emits `plugins:exportPackage {genreId, version}` → `downloadBlob`.
- DOM tests for NewPage (emits the right params) and IdPage readiness rendering.

**Built 2026-10-12 (lanes H + I).** Server: `pipelines/entities/pubGenres.ts` (`createPubGenre`
copies the source genre's create/respond/… specs under the owner slug, its default preset and its
default layout as a `pub`-origin row — migration 0110 widens the layout origin CHECK;
`updatePubGenre` for name/description/family/fields; `genreOrigin` core|plugin|pub;
`registerPubGenres` re-registers every in-app genre at boot, sources first), 13 int tests;
`sessionGenres:create {ownerSlug, name, label, description?, family?, from, scope}` and a wider
`sessionGenres:update {name?, description?, family?, fields?}` in `sockets/sessionAdmin.ts`; detail
gains `genre.{origin, editable, fields, hasState, layout, pluginsEnabled}`. Client:
`session-genres/NewPage.svelte` (`/admin/session-genres/new`), `IdPage.svelte` with the Readiness
card (`genreReadiness.ts`, 7 tests), About, Session fields (`SettingsSchemaEditor.svelte` — enum
options read and write core's `members[{key,label}]`, never `of`), Events through the lifted
`components/admin/PresetBindingsRows.svelte` writing the default preset's bindings, and **Export as
plugin…**; 6 DOM tests. Departures: the preset page does not yet use `PresetBindingsRows`; the
`copy` scope copies the whole family only (`scope:'create'` copies the create spec alone, as
planned). Verified live on a scratch instance: Quest from Adventure (readiness 8 of 9), a field
added and saved, the page reloaded with it.

## 7. P5 — The bundle

- `plugins:exportPackage {genreId, slug, version}` builds the folder in memory and answers
  `{blob (zip), filename}`: `manifest.json` (genres with shape and events; pipelines; presets with
  bindings; configs with values; prompts; layouts; widgets with frame-shell components; `requires`
  for core ids used), `pipelines/*.json` from `loadDocument`, `components/*.js` frame shells,
  `ui/**` from authored frames. `downloadBlob` learns `.zip`.
- `plugins:installPackage {zip}` is the missing upload half of `installLocal`: unzip to a temp dir
  under the data dir, `installPluginPackage`, same refusals. Round-trip int test: export a copied
  genre, install it on a scratch db, compare announcements.
- **Export as scaffold**: the same package plus `src/` from `scaffoldPlugin` templates with the
  declarations filled in, for the code tiers.

**Server built 2026-10-12 (lane G).** `plugins/exportPackage.ts` (`exportGenrePackage` → files +
manifest + warnings, `zipPackage` with fflate) and `sockets/pluginPackages.ts`
(`plugins:exportPackage {genreId, version?, name?}` → `{blob, filename, warnings}`;
`plugins:installPackage {filename, bytes}` → the `installLocal` report; both admin-only and behind
the install flag with `installLocal`'s wording; the upload is unzipped under
`<data>/plugin-uploads/<uuid>` with path, entry-count and size guards and removed after).
`installLocal`'s gate and tail became `requirePackageInstall` / `installPackageFromDir` in
`sockets/plugins.ts`; 12 int tests incl. the round trip (install the unified fixture → export →
uninstall → install the zip → the same announcement). Departures: core `:event/` ids are not put
in `requires` (the installer checks those against package-declared events only); the round trip
uses one pub; the scaffold export is not built. The admin UI: **Install a package…** on
Admin › Plugins (a file input, base64, one status line; `installPackage.dom.test.svelte.ts`), and
**Export as plugin…** on the genre page (lane I).

**Verified live 2026-10-12 and one guard added.** The export of an in-app genre carries its `pub`
layout row (the filter first took plugin rows only). Installing the export on the **same** pub
took over the in-app owner's spec rows (same slugs, now `source_plugin_id` set) and the uninstall
then deleted them with the plugin, leaving an orphan `pub` layout row that made the next create
fail on the unique index. `installPluginPackage` now refuses a package whose id is the owner name
of any spec row with no source plugin — *"'acme.lab' is the owner name of a pipeline made on this
pub ('acme.lab:spec/quest-create'). A package cannot install over in-app work: export it under
another owner name, or remove those pipelines first."* — before anything is written (int test in
`exportPackage.int.test.ts`; `createPubGenre` already refuses the mirror case). docs/genres.md
*Bundling it* says so. Still not built: the scaffold export; `requires` for core `:event/` ids.

**Both built 2026-10-13.** `requires` now carries every `core:event/…` an exported pipeline locks
on or a preset binds; `missingRequirements` checks a core event against this build's registry
(`eventById`) and both install doors refuse with `missingRequirementsMessage` (_'‹id›' is an event
this version of Serene Pub does not have; the package needs a newer Serene Pub._). The CLI's own
packager still puts no core event in `requires`. **Export with source**: `plugins:exportPackage
{scaffold: true}` → `<slug>-<version>-source.zip`, the package plus `plugins/exportScaffold.ts`'s
authoring half: `package.json` · `tsconfig*.json` · `.gitignore` · `vitest.config.ts` from
`scaffoldPlugin`, `src/pipelines/*.json` (the compiled documents — `ExtensionDecl.pipelines` takes
a `SpecDocument`, so no builder code is generated), `src/declarations.json`, one `src/index.ts`
re-binding presets/configs to spec values (`use()` for another package's) and re-declaring the
package's own node definitions from their stored declarations with a handler that throws until
written, `test/package.test.ts`, a README with _What is left for you to write_ (node handlers,
built components standing in for source, a preset's default swaps). Int test: the fixture's
source export, unzipped, `serene-pub build` in its own process → the same genres, pipelines,
presets, configs, prompts, events, node definition ids and components as the direct export, and
the same document hashes; the in-app preset row case likewise. UI: _Include the source_ in the
export dialog (dom test).

## 8. Verification

One grouped run per phase: `npm test` (the new unit, dom and int tests), `npm run check`,
screenshots through the Playwright MCP at Focus, Half and Dock on Adventure and Lair, saved to the
session scratchpad. SDK edits (P3, P5) get `npm run sdk:test` then `sdk:build` with no owner dev
server on :5173.

## 9. Rulings (answered by the owner 2026-10-12)

1. The word for a saved, reusable group of steps: **composite step**. ✅
2. Version bump on publish: `store.ts` (2026-09-10) lets an edited document republish under the
   same semver as a new row; `plans/02-SPEC-STORAGE.md:144-160` calls that an error. P2 proposes:
   the dialog defaults to a patch bump and allows the same semver, following the store. ✅
3. Where an in-app spec's slug lives: **a slug the admin picks at creation**. ✅
4. Kind colours: **keep `KIND_STRIPE`**. ✅
5. Event → spec editing: **on the genre page, writing the default preset's bindings**. ✅
6. Export and install: **both stay behind `SP_PLUGINS_ENABLED`**. ✅
