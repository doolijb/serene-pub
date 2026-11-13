# BRIEF vl-N-w1 — Variable layouts: NOMENCLATURE, STYLE-GUIDE, INTEGRATING §5

You are a `lane-worker` for lane **vl-N** (supervisor: vl-N). Repo `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Record the **variable layouts** build (PLAN `plans/PLAN-variable-layouts-2026-11-10.md`, built 2026-11-10 by lanes vl-S, vl-D, vl-A, vl-E, vl-F) in three canon files. **Do NOMENCLATURE first and in as few edit passes as possible** (another session edits it too; the window is cleared but short), then STYLE-GUIDE, then INTEGRATING. The text below is drafted by the supervisor from the lane reports and the code: type it in, adjusting only to fit each table's shape and voice. Don't invent names beyond what is written here. If something here contradicts what you see in the file (e.g. a row already exists), stop on that item and say so in your report.

## Files owned

- `/home/jody/github/serene-pub/NOMENCLATURE.md` — only the places named below.
- `/home/jody/github/serene-pub/STYLE-GUIDE.md` — §6.11, §6.12, §6.17 only.
- `/home/jody/github/serene-pub-sdk/INTEGRATING.md` — §5a only (two new rows).

## Files readable

Everything. Useful: `plans/REPORT-vl-{S,D,A,E}-2026-11-10.md`.

## Rules (quoted from CLAUDE.md, NOMENCLATURE §1/§24, the lane brief)

- **NOMENCLATURE.md is 14.5k tokens: read by section, never whole.** Read line ranges only (`sed -n`, `awk … substr($0,1,300)`; table rows are padded with very long runs of spaces, so cut them when reading). §15 is at ~line 937, §22's row at ~1299, §23 ~1435–1651, §25 ~1780 with the newest sections at the end before `## 26. Shell` (~3549).
- "**R1 — One word, one meaning.** Where a word is already load-bearing in one place, the _other_ use renames." "**R3 — Qualify, never abbreviate to the bare noun.**" "**R6** — ⏳ **Transitional** — real today, expires on a known event … 🚧 **Provisional** — designed but not built, so the words may still move on contact with implementation."
- "When you add or rename a term, record it in **§25 Change ledger** in the same change." "**§23 Retired words**: never reintroduce one." (*built-in layout* is a retired session-layout word: never use it for variable layouts.)
- It is a **session**, never a *chat*.
- Edit only the sections named. Don't reflow or re-pad existing table rows (new rows may be unpadded `| a | b |` — the newest §25 sections already are).
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no sdk:build.)
- Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`. Do not start any dev server.

## 1. NOMENCLATURE.md

### 1a. §15 Templates and assembly — the **variable template** row (append to its Means cell)

Append, after the `isForeignPackageRow` sentence:

> **UI and docs word: variable layout** (★1, 2026-11-10; PLAN-variable-layouts-2026-11-10): the Admin nav item, its pages and every doc say **Variable layouts**; code keeps its `variable template` identifiers (`pipeline_variable_templates`, `kind: 'variables'`, `VariableTemplate` names). Never bare _layout_ in the UI (that is a **session layout**, §9), except the template helper and filter `layout`, where no session layout can appear. A variable is written out by one layout for the whole pub (the **pub's layout**); a preset may state its own (**preset's variable layouts**); a context template may name one in place (`{{{layout characters "core/json@1"}}}`, Liquid `{{ characters | layout: "core/json@1" }}`). Resolution, in order: ⏳ **leftover pick** → preset's variable layouts → pub's layout → package default → **automatic layout** or the in-code floor; the run records which as `LayoutReason` (`leftover`, `preset`, `pub`, `default`; a named one `template`).

### 1b. §15 — four new rows, directly after the **variable template** row

| Term | Means |
|---|---|
| 🚧 **layout reference** | **Built 2026-11-10** (PLAN-variable-layouts-2026-11-10). `<owner>/<slug>@<major>` (`core/titled-json@1`, `acme.dice/prose@1`, `mypub/prose@1`): how a context template, a preset and the SDK name one **variable template** row. Column `pipeline_variable_templates.reference`, unique with `variable_id`, so unique **within its variable**: two variables may each have a `core/json@1`. Fixed once saved. Core's rows and a package's are stamped at boot: core's fixed slugs `titled-json` · `json` · `titled` · `as-written` · `sentence` · `numeric` · `lines` · `bracket-tag`; an **automatic layout** `<owner>/json@<variable major>`; a package's from its seed's `slug`, else its template id's name. A person's row gets one when next saved, or when **Move into the template** needs one. Grammar: `parseVariableLayoutReference` · `VARIABLE_LAYOUT_SLUG` (SDK). ⚠ Not a **template id** (`core:template/…@1`, the row's app-wide identity). ⚠ Its old meaning, a step's stored layout pick (`config/world.ts`), is retired (§23). |
| 🚧 **pub's layout** | **Built 2026-11-10.** The **variable template** row a variable is written out by across the whole pub when the session's preset states none: `pipeline_variable_templates.pub_default` (at most one per variable, a partial unique index). None chosen means the package default. UI (Admin › Variable layouts): **In use**, **Use this**, _Chosen for this pub._, **Back to the default**. ⚠ Not a genre default and not a preset change: it sits below every preset and above the package default. |
| 🚧 **preset's variable layouts** | **Built 2026-11-10** (★2 option B). The layouts a preset states for its sessions, one per variable, as `{ [variableId]: layout reference }`: `session_presets.variable_layouts` for a pub preset, SDK `PresetDecl.variableLayouts` / `PresetInput.variableLayouts` (`@experimental`, checked by `presetVariableLayoutFindings`) for a declared one. Empty by default; nothing inherited or guessed. A reference no row goes by is skipped (the pub's layout renders) and named on the presets list (`danglingVariableLayouts`; status _Variable layout missing_). UI: the preset form's **Variable layouts** fieldset. ⚠ Not a **layout preset** nor a genre's `layouts` (session layouts, §9), and not a preset's `settings`. |
| ⏳ **leftover pick** | **Built 2026-11-10.** A per-step layout pick that data upgrade 0151 kept because removing it would have changed a prompt. Honoured first at render; shown on its pipeline step with **Use the pub's** and **Move into the template**; written by nothing new (`config/leftoverPicks.ts`). Dropped at the 0.7 squash. |

Match the §15 table's column count (2: Term | Means).

### 1c. §22 Icons — the `macro` / `template variable` row (~line 1299)

Change `admin nav (Variable templates)` to `admin nav (Variable layouts)`. Nothing else in that row.

### 1d. §23 Retired words — three rows at the end of the table (after the `crawl-time` row, ~line 1650)

| Retired | Why |
|---|---|
| the per-step layout pick: the `variable-template-ref` control and its choices · `ConfigOption.variableTemplate` · `variableOptionGate` · the events `pipelines:cloneVariableTemplate` · `pipelines:updateVariableTemplate` · `pipelines:deleteVariableTemplate` · **layout reference** in its old sense (a step's stored pick, `config/world.ts`) | **Retired 2026-11-10** (owner ★2 option B; PLAN-variable-layouts-2026-11-10, lanes vl-D, vl-E). One picker per variable on every prompt-building step, whose right answer depended on the context template, not the step. Replaced by the **pub's layout**, the **preset's variable layouts** and a template's own `layout` call (§15); a pick the upgrade could not fold in without changing a prompt stays as a ⏳ **leftover pick**. A layout is now copied through its add form (`/new?from=`) and edited or deleted on its variable's page. **Layout reference** now means `<owner>/<slug>@<major>` (§15). ⏳ `variableTemplate?:` in `shared/sockets/types.ts` and `config/panel/read.ts` `variableTemplateRow` are dead and go together. Never reintroduce. |
| **Variable templates** (the Admin nav item, its page titles, `/admin/variable-templates`) | **Retired 2026-11-10** (owner ★1). Three names for one thing (_variable template_, _variable layout_, _layout_). Use **Variable layouts** (`/admin/variable-layouts`, a changelist of variables); the old addresses redirect, the list to the list and a row to its layout form. Code identifiers keep `variable template` (§15). |
| the "no host in view" `unknown-layout` warning (a well-formed layout reference checked with no layouts offered) | **Retired 2026-11-10** (lead, on vl-S's Q-2). With no offers, a well-formed reference now passes silently: the host always supplies the offers at save, at select and in the editor, and only the packager has none, where the warning fired on every reference. A reference unknown among the offers is still an error (`unknown-layout`). |

### 1e. §25 Change ledger — one new section, appended after the last `### history: one entry per date …` section and before `## 26. Shell`

Heading and table shape exactly as the `### advanced controls — 2026-11-10 …` section (`| Was | Is | Cost |`). Section §-references in the Is cell where a row has one.

```
### variable layouts — 2026-11-10 (owner GO; PLAN-variable-layouts-2026-11-10, lanes vl-S, vl-D, vl-A, vl-E, vl-F, vl-N)
```

Rows (Was | Is | Cost):

1. **Variable templates** (Admin nav, page titles, docs) | **Variable layouts** (★1); code identifiers unchanged (§15, §23) | `shell/adminNav.ts`, `admin/adminRoutes.ts`, `admin/sections/variable-layouts/*`, docs
2. _(new)_ | 🚧 **layout reference** · `pipeline_variable_templates.reference` · SDK `parseVariableLayoutReference` · `formatVariableLayoutReference` · `VariableLayoutReferenceParts` · `VARIABLE_LAYOUT_SLUG` · app aliases `parseLayoutReference` · `formatLayoutReference` (§15) | `0151_shallow_marvel_zombies`, `sdk/src/variableLayouts.ts`, `entities/objectVariableLayouts.ts`
3. _(new)_ | 🚧 shipped slugs `titled-json` · `json` · `titled` · `as-written` · `sentence` · `numeric` · `lines` · `bracket-tag`; automatic rows `<owner>/json@<variable major>`; boot stamping `coreLayoutReferenceFor` · `layoutSlugOf` · `variableMajorOf` · `stampReferenceIfFree` (§15) | `boot/seedVariableTemplates.ts`, `boot/registrySync.ts`, `entities/objectVariableLayouts.ts`
4. _(new)_ | 🚧 **pub's layout** · `pipeline_variable_templates.pub_default` · `pubLayoutOf` · `setPubLayout` (§15) | `0151_shallow_marvel_zombies`, `entities/variableTemplates.ts`
5. _(new)_ | 🚧 **preset's variable layouts** · `session_presets.variable_layouts` · SDK `PresetDecl.variableLayouts` · `PresetInput.variableLayouts` · `presetVariableLayoutFindings` · `presetVariableLayoutsOf` · `declaredVariableLayouts` · `danglingPresetLayouts` · `sessionPresets:list` row field `danglingVariableLayouts` (§15) | `0151_shallow_marvel_zombies`, `sdk/src/announce.ts`, `plugins/install.ts`, `config/named.ts`, `config/world.ts`, `sessions/presetEditor.ts`
6. the per-step layout pick (`variable-template-ref`, `ConfigOption.variableTemplate`, `variableOptionGate`) | retired (§23); ⏳ **leftover pick** where data upgrade 0151 kept one: `planVariableLayoutUpgrade` · `leftoverPicksFor` · `clearLeftoverPick` · `moveLeftoversIntoTemplate` · `nameLayoutAtBareReads` · `LeftoverPickRefusal` (§15) | `dataUpgrades/0151_shallow_marvel_zombies.ts`, `config/leftoverPicks.ts`, `config/panel/*`
7. _(new)_ | 🚧 `LayoutReason` = `leftover` · `preset` · `pub` · `default` · `template` on `ResolvedLayouts[key].reason` and `LayoutUse.reason`; `LayoutUse.missingReference`; the inspector's words _leftover pick_ · _the preset's_ · _the pub's_ · _the default_ · _named by the template_; W1/W2's view-only `automatic` · `as-written` | `config/world.ts`, `entities/variableLayouts.ts`, `inspector/receiptView.ts`
8. _(new)_ | 🚧 the template helper and filter **`layout`** (`VARIABLE_LAYOUT_HELPER`); finding kinds `layout-argument` · `unknown-layout`; `VarField.laidOutBy` (⚠ root keys only, not the variable's own scope) · `laidOutScope` · `TemplateCheckOptions.variableLayoutOffers` (⚠ not a preset's `variableLayouts`) · `VariableLayoutOffer` · `variableLayoutOffersFor` · `variableLayoutCalls` · `VariableLayoutCall` (§15) | `sdk/src/templateCheck.ts`, `sdk/src/variableLayouts.ts`, `shared/utils/contextHandlebarsHelpers.ts`, `shared/utils/contextLiquid.ts`, `entities/contextTemplateFit.ts` (`HOST_REFUSES`)
9. _(new)_ | 🚧 the explicit-layout pre-pass: `prepareExplicitLayouts` · `ExplicitLayoutPrepass` · `rewriteLayoutCalls` · `withExplicitLayouts` · `LAYOUT_RENDERS_CONTEXT_KEY` · `layoutRenderKey` · `explicitLayoutText` · `ReferencedLayout` · `referencedLayoutOf` · `ResolvedLayouts[key].references` · `draftReferenceLayouts` · `NAMED_LAYOUTS_FIELD` (`namedLayouts`) · `NamedLayouts` | `entities/variableLayouts.ts`, `prompt/assemble.ts`, `prompt/preview.ts`
10. a laid-out value in `{{ }}` was HTML-escaped (`&quot;`) | printed the same in `{{ }}` and `{{{ }}}` (★6): `laidOutForHandlebars` · `laidOutSafeFor` · `LAID_OUT_CONTEXT_KEYS` | `prompt/templateContext.ts`, `prompt/assemble.ts`
11. _(new)_ | 🚧 SDK `variableLayout(pluginId, variable, { slug, major, label, engine, source })` · `VariableLayoutInput` · `TemplateSeed.slug` · `variableIdParts` (`@internal`) (★7) | `sdk/src/variableLayouts.ts`, `sdk/src/template.ts`, `sdk/src/index.ts`
12. _(new)_ | 🚧 server: `layoutByReference` · `stampReference` · `contextTemplatesNaming` · `LayoutReferenceInput` · `declarationsAndVariableKeys` · `VariableKey` · `variableLayoutOffersOf` · `contextTemplateChecking` · `variableLayoutsList` · `variableLayoutView` · `presetsKeepingTheirOwn` · `useEverywhereCounts` · `templateVariableLayouts` · `UnknownVariableError` · `UnknownTemplateTargetError` · `presetVariableLayoutsView` · `setPresetVariableLayout` · `PresetVariableLayoutRefusal` | `entities/variableTemplates.ts`, `config/panel/*`, `entities/contextTemplateFit.ts`, `config/variableLayoutsView.ts`, `sessions/presetEditor.ts`
13. `pipelines:cloneVariableTemplate` · `:updateVariableTemplate` · `:deleteVariableTemplate` | retired (§23); 🚧 `pipelines:libraryVariables` · `:libraryVariable` · `:librarySetPubLayout` · `:libraryUseEverywhereCounts` · `:templateVariableLayouts` · `:leftoverPicks` · `:clearLeftoverPick` · `:moveLeftoversIntoTemplate` (refusal code `needs-owner-slug`) · `:stampVariableTemplateReference` · `:presetVariableLayouts` (`candidates`: the variables the preset's pipelines render) · `:setPresetVariableLayout`; `libraryCreateTemplate` gains `reference` · `useEverywhere`, `libraryUpdateTemplate` gains `reference`; library rows gain `reference` · `pubDefault`; W1 rows carry `key`; socket types `Sockets.Pipelines.VariableLayouts.*` · `LeftoverPicks` · `ClearLeftoverPick` · `MoveLeftoversIntoTemplate` · `PresetVariableLayouts` · `SetPresetVariableLayout` · `StampVariableTemplateReference` | `sockets/pipelinesVariableLayouts.ts`, `sockets/pipelines.ts`, `sockets/presetEditor.ts`, `shared/sockets/types.ts`, `client/sockets/typedSocket.ts`
14. _(new)_ | 🚧 UI, Admin › Variable layouts (W1–W3): purpose _How each variable is written out. One choice for the whole pub._; columns **Variable** · **Supplied by** · **Written as** · **Layouts**, filter **Shelf**; _‹name› · chosen for this pub_ · _‹name› (automatic)_ · _As written_ · _+ N preset(s)_; _Showing the variables ‹step› writes out._ · **Show all**; the variable's page: **New layout** · **Example value** · **Variable layouts** · **In use** · **Use this** · **Duplicate** · _Chosen for this pub._ · **Back to the default** · _Named by N context template(s)_ · _Chosen by the ‹name› preset(s)_; the form: **New variable layout** · **Referenced as** · **Owner slug** · **Name to reference it by** · **Use it everywhere** · _Fixed once saved, so templates that name it keep working._ | `admin/sections/variable-layouts/*`, `components/admin/VariableLayoutPreview.svelte`
15. _(new)_ | 🚧 UI, the pipeline step (W4) and the template editor (W5): _Each variable is written out by its variable layout, shared by every pipeline._ · **Change layouts** · _‹Variable› uses ‹layout› here (set before layouts moved)._ · **Use the pub's** · **Move into the template** · **Owner slug** · _Save or cancel your changes to the template first._; _Written as ‹name› (‹reason›)_ (reasons _this pub's choice_ · _the default_ · _automatic_ · _named by the template_) · **Write as ‹label› here** · **Layouts in this template** · _The pub's layout_ · _Mixed — leave as it is_ · **All bare** · **All titled** · **Apply**; inspector _named ‹ref›, which wasn't found; used ‹name›_ | `components/pipelines/StepVariableLayouts.svelte`, `components/templates/*`, `inspector/receiptView.ts`
16. _(new)_ | 🚧 UI, a preset's form (W6): fieldset **Variable layouts** (_How this preset's sessions write out a variable, where it differs from the pub's choice._) · _Uses the pub's layout for every variable._ · **Change a variable's layout** · **Remove** · **Put back** · **Give it a reference** · _Waiting for Save_ · _Removed — waiting for Save_ · _(pub's: ‹name›)_; presets list status _Variable layout missing_ | `admin/sections/session-presets/PresetVariableLayouts.svelte`, `IdPage.svelte`, `presetsAdmin.ts`
17. _(new)_ | 🚧 client: components `VariableLayoutPreview` · `VariableLayoutForm` · `NewLayoutPage` · `LayoutPage` · `LegacyIdRedirect` · `PresetVariableLayouts` · `StepVariableLayouts` · `TemplateLayoutsList`; modules ⏳ `variableLayoutsSockets` · `variableLayoutWords` · `leftoverPicks.svelte.ts` (`useLeftoverPicks`, `LeftoverStepState`) · ⏳ `templateVariableLayouts.svelte.ts` (`requestTemplateVariableLayouts`, `templateVariableLayoutsOf`) · `templateLayoutRewrite.ts` (`LaidOutOccurrence`, `laidOutOccurrences`, `occurrenceAt`, `writeOccurrence`, `rewriteChanges`, `bareOffer`, `titledOffer`); props `TemplateEditor.variableLayouts` · `ScopeTree.writtenAs` · `AssistOptions.layoutOffers` · `TemplateDiagnosticsOptions.variableLayoutOffers` · `LayoutLine.why` · `LayoutLine.missingReference` | `client/admin/sections/variable-layouts/*`, `client/components/pipelines/*`, `client/components/templates/*`, `shared/utils/templateAssist.ts`, `shared/utils/templateDiagnostics.ts`
18. `/admin/variable-templates` · `/admin/variable-templates/:id` | `/admin/variable-layouts` · `/admin/variable-layouts/<variable id, encoded>` · `/new` (`?from=<id>`) · `/<id>`; `?step=<spec slug>:<node key>` filters the list; the old addresses redirect | `admin/adminRoutes.ts`, `shared/adminLogbook.ts`

Before typing row 13's `candidates`/`key`/`needs-owner-slug` and row 15's **Owner slug**, check they are in the code (another lane, vl-F, is landing them now): `grep -n "needs-owner-slug\|candidates?: string\[\]" /home/jody/github/serene-pub/src/lib/shared/sockets/types.ts` and `grep -n "Owner name\|Owner slug" /home/jody/github/serene-pub/src/lib/client/components/pipelines/StepVariableLayouts.svelte`. Type them as written either way; report which were not yet in the code.

## 2. STYLE-GUIDE.md (short; match each section's voice)

Read §6.11 (~1496–1660), §6.12 (~1703–1740), §6.17 (~2058–2105) first.

- **§6.11, the shapes table, Changelist row, "Used by" cell:** replace `the three template kinds` with `Context templates, Completion templates, Variable layouts (a changelist of variables)`. **Add / change form row, "Used by" cell:** `Events and History records are read-only change views` → `Events and History records and a variable's layouts are read-only change views`.
- **§6.11, after the Events sentence** (the one ending "opening on the event's first genre."), add:

  > **Variable layouts** (2026-11-10) is a changelist of **variables**, not layout rows, with no Add (a variable arrives with code) and a **Shelf** filter; each row opens a read-only **change view** (`/admin/variable-layouts/<variable>`, the id encoded): the header (**New layout**, the one filled primary, opens the add form from the layout in use; _Chosen for this pub._ with **Back to the default** when the pub's choice isn't the default), a closed **Example value** fieldset, and the layouts as an `AdminInline` with no Add another, each row previewed in mono against the example. **Use this** is a one-shot act; the row in use shows an **In use** chip with a check (a word, never colour alone). **Duplicate** opens the add form at `?from=`; **Edit** and **Delete** appear only on the pub's own rows, and a refused Delete says why on its row, never in a toast.

- **§6.11, in the "Every switch, tick and approval on a change form waits for Save" list**, after the connection's model **Hide / Show** and **Use** clause, add: `a preset's **Variable layouts** rows (2026-11-10, _Waiting for Save_ / _Removed — waiting for Save_ with **Put back**; Save sends the preset first, then each layout write in order);` — keep the sentence grammatical.
- **§6.12, at the end of the "Variables available here" paragraph** (ending "The heading carries a `DocPeek`."), add:

  > A root that a **variable layout** writes out adds _Written as ‹name›_ to its meta line. With the caret on such a tag, the line under the field (12px muted, `aria-live="polite"`) reads _Written as ‹name› (‹reason›)_ — _this pub's choice_, _the default_, _automatic_ or _named by the template_ — followed by one `preset-tonal-surface` button per other layout, **Write as ‹label› here** (44px on a coarse pointer), which rewrites that one tag to name the layout. They are real buttons, not a shortcut and not the lint fix. **Layouts in this template**, a tonal disclosure (`aria-expanded`) above the field and hidden when read-only, lists each laid-out variable the template reads with a select (_The pub's layout_, each layout by name, _Mixed — leave as it is_ when occurrences differ), **All bare** and **All titled** shortcuts, and one filled **Apply** that makes every rewrite as one edit (one undo).

- **§6.17, a new bullet after the "Front rows" bullet:**

  > - **Variable layouts** (2026-11-10, admins only): under the context template picker, one 12px muted line, _Each variable is written out by its variable layout, shared by every pipeline._, ending in a **Change layouts** link that opens Admin › Variable layouts filtered to the variables this step writes out. No per-variable picker. A ⏳ **leftover pick** adds one muted line per pick, _‹Variable› uses ‹layout› here (set before layouts moved)._, with a tonal **Use the pub's**; when the step's template is the pub's own copy, one tonal **Move into the template** follows the step's lines. A refusal is one `role="alert"` line under them, never a toast; an **Owner slug** field appears inline only when a picked layout needs a reference, and pressing Move with unsaved template edits asks for Save or Cancel first.

## 3. ../serene-pub-sdk/INTEGRATING.md §5a — two rows

Read §5 only (~lines 1483–1600; rows are long, cut them when reading). Add two rows directly after the **Presets** row. Each row has exactly **four** cells; a cell must not contain ` | ` (space-pipe-space) because `sdk-tests/extendingCensus.test.ts` splits on it. Test references must be `` `file` › `exact test name` `` with no backtick inside the name.

```
| **Variable layouts**: a package's renderers for a variable, each named by a layout reference `<owner>/<slug>@<major>` | `variableLayout()`, `VariableLayoutInput`, `TemplateSeed.slug`, `parseVariableLayoutReference` @experimental | Core's shipped and automatic layouts, stamped `core/<slug>@<major>` at boot. A package's own, under `templates` with `kind: 'variables'`, referenced as `<plugin id>/<slug>@<major>`; the template check's `layout` helper and filter name one in a context template | `sdk-tests/variableLayouts.test.ts` › `builds the seed for a plugin variable, kebabing a camelCase name` · `sdk-tests/variableLayouts.test.ts` › `parses good references` · `serene-pub/src/lib/server/pipelines/boot/layoutReferences.int.test.ts` › `gives a declared layout <owner>/<the id's name>@<the id's major>, and an automatic one <owner>/json@<variable major>` |
| **A preset's variable layouts**: one layout per variable a preset states for its sessions | `PresetDecl.variableLayouts`, `PresetInput.variableLayouts`, `presetVariableLayoutFindings` @experimental | The app's `session_presets.variable_layouts`, written at install for a declared preset and from the preset form for a pub's; a reference no layout goes by is skipped and named on the presets list | `sdk-tests/presetVariableLayouts.test.ts` › `refuses a bad reference, naming the preset, key and value` · `sdk-tests/presetVariableLayouts.test.ts` › `accepts a reference to a layout nobody installed` · `serene-pub/src/lib/server/plugins/presetVariableLayouts.int.test.ts` › `lands in the column at install, a layout nobody installed accepted` |
```

Verify every named test exists verbatim (`grep -n "<name>" <file>`) before saving.

## Done means

- NOMENCLATURE: 1a–1e done, in as few edit passes as you can (aim for one Edit per location).
- STYLE-GUIDE: the four §6.11/§6.12/§6.17 changes.
- INTEGRATING: two rows. Then run the census test, targeted: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx vitest run extendingCensus.test.ts` (this is the sdk-tests package, not the SDK root; never `npm test`). Report the result.
- `npx prettier --check /home/jody/github/serene-pub/STYLE-GUIDE.md` (report only; do not reformat the whole file if it already failed before you — say so).

## Report (return as your final message)

Changed files with the line ranges you edited; any text you changed from this brief and why; the vl-F checks (which of `needs-owner-slug`, `candidates`, `key`, **Owner slug** were in the code); test results; anything you noticed and didn't do.
