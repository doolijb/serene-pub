# PLAN — Variable layouts: one choice per section, named by reference — 2026-11-10

Status: **BUILT 2026-11-11** (lanes vl-S, vl-D, vl-A, vl-E, vl-F, vl-N, vl-G; reports `plans/REPORT-vl-*-2026-11-10.md`; migration `0151_shallow_marvel_zombies`). Grouped verification: tsc clean, svelte-check 0 errors, sdk:test at baseline (5), build OK, full vitest failures all outside this build. Walked on an isolated instance: W1–W3, W6 (declared preset), W4 row + filter, W5 caret line; the walk found the step-handle bug fixed by vl-G. Owner rulings 2026-11-11 (all as recommended): ★A keep the shelf filter, no headings; ★E-3/★E-4 a leftover line names the step when the pick is from another step and the level (*the genre's* / *the ‹preset› preset's*) when a variable has picks at more than one; library *Used by* counts the pub's choice, presets' choices and templates' references; the two speech-row count tests updated; ★G-2 fallback *a step in ‹pipeline›*, then *this step*. "Build them now": lane vl-H. Was: **BUILDING** (go 2026-11-10: "Start"). Challenged once (plan-challenger, 2026-11-10): objections 1–4 accepted (§ Challenge answers). ★2 ruled 2026-11-10 (option B). ★1, ★3–★8 ruled 2026-11-10: "Accept all (Recommended)". No ★ open.

## Owner's words (2026-11-10, this session)

- "is there a better way we can surface variable templates, or should we ditch them all-together to rely purely on context templates"
- On the recommendation (the template names the layout where it places the section): "I like that idea, though the variable templates should probably be named by it's source and slug. i.e. core json 1 or something"
- "Then replan it. The ui workflow has to be intuitive"
- On ★2 (a preset losing its own layout choice): "not sure about 2". Offered A (pub only), B (one choice per variable on the preset) and C (per-step picks on presets under Advanced). Ruled: "B, any changes or explicit decisions a preset declares." Read as: a preset's layout choice exists only where the preset states it, both for presets an admin edits and for presets declared in code (`PresetDecl`).

Binding older rulings:
- **Accounted by variable, never by key** (2026-10-13, NOMENCLATURE §15): a layout belongs to the variable it renders.
- **A foreign package's layout is offered, never the default** (★4, 2026-10-13, `isForeignPackageRow`).
- **Automatic layout for every object variable** (2026-09-27, NOMENCLATURE §15).
- **0.6 is in users' hands**: a change to stored data ships with a boot pass and a second-boot test (standing).
- **P1, P3, P5** (2026-11-04). **Members never see model plumbing** (standing). Pipelines are admin-only.

## What is wrong today

1. **One picker per section, on every prompt-building step.** `declarations.ts:415-445` makes a `variable-template-ref` row for each key a `variables` slot renders. Assemble renders about 14 keys, and 15 steps in core-catalog declare a `variables` slot (respond, ask, look, narrate, room answer, castellan, answer form, Guide). Nearly every picker offers the same two rows: **Titled JSON block** / **JSON** (`variableLayouts.ts:533-860`).
2. **The right pick depends on the context template, not the step.** The docs have to tell people "If your template writes its own headings and fences, select the bare JSON / As written layouts" (`docs/context-templates.md` § Variable layouts), and the 0.5 upgrade note says the same. Two settings in two screens that must agree.
3. **No help for a plugin's variable.** The layout editor looks the variable's scope up in the client bundle (`TemplateChangeForm.svelte:146-159`), which holds only core's, so a plugin variable gets no completion and no preview.
4. **Three names for one thing:** *variable template* (Admin nav, table), *variable layout* (docs), *layout* (code, the automatic row).
5. **Double braces escape a laid-out value.** `{{characters}}` turns the fence's quotes into `&quot;` (the docs warn; a plugin author misses it).

## The rule this plan applies

**A variable is written out by one layout, chosen once for the whole pub. A preset may decide differently for its sessions, explicitly, per variable. A context template that wants a different one names it in place, by reference.**

- Bare `{{{characters}}}` uses, in order:
  1. the **preset's variable layout**, when the session's preset declares one for that variable;
  2. the **pub's layout** for that variable;
  3. the package's default (core's shipped default, or the owning plugin's first row);
  4. the automatic layout or the in-code floor.
- `{{{layout characters "core/json@1"}}}` (Liquid: `{{ characters | layout: "core/json@1" }}`) uses that layout in this template only, whatever the preset or pub chose.
- A preset's choice is one per variable and covers every pipeline the preset runs. No per-step choice remains. Members see nothing new.

## The workflows

Every everyday change is made without writing code. Writing code is only for a template that wants an exception.

### W1. "Change how a section reads" (the common case)

**Admin › Writing › Variable layouts.** A changelist whose rows are **variables**, not layout rows, on the same shelves as *Variables available here*. The UI says *variable*, the word that list already uses, rather than introducing *section* (NOMENCLATURE §15 spends that on **prompt block**).

```
Variable layouts
How each variable is written out. One choice for the whole pub.
[Filter variables]
Characters and personas
  Characters      characters   Serene Pub   Titled JSON block           2 layouts
  Personas        personas     Serene Pub   Prose  · chosen for this pub 3 layouts
Lore
  World lore      worldLore    Serene Pub   Titled JSON block           2 layouts
Other
  Riddle          secretEntry  Twenty Q.    JSON (automatic)            1 layout
```

A variable with no layout row at all (a plugin's plain-text variable) is listed too, written as *As written*. No Add here: a variable arrives with code.

### W2. The variable's page: see them, pick one

A read-only **change view** (STYLE-GUIDE §6.11's Events/History shape: `AdminPageHeader` + fieldsets, no save row), with the layouts as an **`AdminInline`**. The address is `/admin/variable-layouts/<variable>`, with the variable id encoded (it holds `:` and `/`). The old `/admin/variable-templates` and `/admin/variable-templates/:id` addresses redirect: the list to W1, a row to its W3 form.

The header gives the variable's name, its description and who supplies it. Below that, **Example value** (closed; the variable's declared `sample`). Then the inline, one row per layout, each previewed against that sample:

```
Characters                                                   [ New layout ]
A card for every character in the cast.  Supplied by Serene Pub.
> Example value

Layouts
  Titled JSON block   Serene Pub   In use   Assistant Characters (AI-controlled): ```json [{"name":"Mira",…   [Duplicate]
  JSON                Serene Pub            [{"name":"Mira","description":…                                  [Use this] [Duplicate]
  Prose               This pub              Mira is a cartographer who…                                      [Use this] [Edit] [Delete]
```

The preview is mono, two lines, with **Show all** to open it in full.

- **Use this** makes that row the pub's layout. The row in use shows **In use** (a chip, a word, never colour alone) instead of the button.
- When the pub's choice isn't the package default, one muted line under the header says so and undoes it: *Chosen for this pub. **Back to the default** (Titled JSON block).* (P1: cause and undo shown.)
- A row a template names explicitly says *Named by 2 context templates*.
- A row a preset chose says *Chosen by the Small models preset* (each preset by name, linked to its form). The pub's choice and the preset's are both visible, so nothing is hidden (P1). W1's **Written as** column adds a muted *+ 1 preset* when any preset differs.
- **Edit** and **Delete** appear only on the pub's own rows. Delete is refused in words while something uses the row: the pub's choice, a template's reference, or a leftover pick (§ Data).
- **New layout** starts from the one in use.

### W3. Write a layout

`/admin/variable-layouts/<variable>/new` and `/<id>`: an `AdminChangeForm`.

- **Name.** Free text.
- **Referenced as**: `mypub/prose@1` in mono. The slug follows the name until edited. Owner slug is asked the way Genres and Rulesets ask it, prefilled with the last one used. Once saved it shows as words: *Fixed once saved, so templates that name it keep working.*
- **Layout**: the code field, with *Variables available here* showing **the variable's own scope, served by the server** (fixes problem 3 for plugin variables), and a **Preview** beside it (below when narrow), live against the sample.
- **Use it everywhere**: a switch, off for a new layout ★5. Its sentence says what turning it on changes, counted: *Every template that writes {{{characters}}} without naming a layout uses this one: 9 pipelines, 3 templates.* Left off, the new row lands on W2 with its **Use this** button.

### W4. The pipeline step

The per-variable pickers go. Under the context template picker, one row: *Each variable is written out by its variable layout, shared by every pipeline.* **Change layouts** opens W1 filtered to the variables this step renders.

A **leftover pick** from before (§ Data item 4) shows as one read-only line per variable, *Characters uses JSON here (set before layouts moved).* Two actions:
- **Use the pub's** removes it.
- **Move into the template** appears only when the step's context template is the pub's own copy. It rewrites that template to name the picked layouts explicitly (W5's template-wide action) and removes the step's leftovers. This is the one-click path for a 0.5 upgrader's pasted template.

### W5. A template that wants an exception (the code path)

In the context template editor, which already has completion, hover, lint and *Variables available here*:

- **Tree row:** a laid-out variable's row adds *Written as Titled JSON block* to its meta line.
- **The caret line.** With the caret on `{{{characters}}}`, the line under the field (today an aria-live description, `TemplateEditor.svelte:367-388`) reads *Written as Titled JSON block (this pub's choice)*, followed by one button per other layout: **Write as JSON here** · **Write as Prose here**. A button rewrites that occurrence to `{{{layout characters "core/json@1"}}}`. These are real buttons, so they work by touch and keyboard with no shortcut to learn. This is new plumbing, budgeted in VL-editor; it is not the lint-fix mechanism (`templateAssistBridge.ts:110-140`), which stays for errors only.
- **Template-wide:** a **Layouts in this template** button beside the field opens a short list, one row per laid-out variable the template reads, each a select (*The pub's layout* · each layout by name) plus two shortcuts: **All bare** and **All titled**. Applying it rewrites every occurrence in one go. This replaces the old advice to "pick the bare layouts for its pipelines".
- **Completion** inside `layout characters "` lists that variable's references with their names.
- **Lint:** an unknown reference is an error with a near-miss fix. A reference that isn't a string literal is an error. Both are the same checks as save and select.

A shipped template is read-only, so these offers appear on a copy. That's the trade-off for an exception, and W1 needs no copy.

### W6. A preset that writes things differently

**Admin › Presets**, a preset's change form, gains a **Variable layouts** fieldset. Its purpose line: *How this preset's sessions write out a variable, where it differs from the pub's choice.*

```
Variable layouts
How this preset's sessions write out a variable, where it differs from the pub's choice.
  Characters   Prose         (pub's: Titled JSON block)   [Remove]
  Personas     Prose         (pub's: Titled JSON block)   [Remove]
[ Change a variable's layout ]
```

- Empty by default: *Uses the pub's layout for every variable.* Nothing is inherited or guessed; a row exists only because someone chose it.
- **Change a variable's layout** adds a row: pick the variable (the variables this preset's pipelines render, on the usual shelves), then a layout from a list that previews each one against the sample, as on W2.
- Each row says what the pub would use, so the difference is plain. **Remove** goes back to the pub's.
- A layout picked here needs a reference. A person's older row that has none asks for one inline (owner slug prefilled) before it can be picked.
- A preset declared in code (shipped or a plugin's) shows the same rows read-only, as words (STYLE-GUIDE §6.11), with **Copy…** where presets already offer it.

### Walkthrough: a preset for a small model

The admin has a **Small models** preset whose loadout uses a 3B model that handles prose better than JSON cards.

1. On the preset's form, **Change a variable's layout** → *Characters* → *Prose*, previewed. Same for *Personas*.
2. Sessions on Small models now write those two variables as Prose; every other preset still uses the pub's layout. No template was copied.
3. On the Characters page (W2), the Prose row says *Chosen by the Small models preset*.

### Walkthrough: the owner's scenario

A plugin's node declares `acme:var/omens@1` as a band. The template writes `{{omens}}`.

1. The plugin shipped no layout; omens is an object, so it has its automatic **JSON** row, and the template prints minified JSON. Double braces don't escape it (★6).
2. The admin opens **Variable layouts**, finds *Omens · Acme · JSON (automatic)*, and opens it. It shows the example value and the one card.
3. **New layout.** The editor completes against omens' declared fields and previews against its sample. They name it *Prose*, which shows as `mypub/prose@1`. They turn **Use it everywhere** on, which reads *… 2 pipelines, 1 template*, and save.
4. Every template that writes `{{omens}}` now gets Prose. No template was copied.
5. Later, one copied template wants the raw JSON. In the editor, with the caret on `{{omens}}`, the line under the field offers **Write as JSON here**, which writes `{{{layout omens "acme/json@1"}}}`.

### Walkthrough: a 0.5 upgrader

They pasted their old template into a copy and, as today's docs say, picked the bare layouts on their respond step.

1. The upgrade sees those picks aren't shared by every step that renders those variables, so it keeps them as leftovers (§ Data item 4). Their prompts and everyone else's stay byte for byte the same.
2. On the respond step they see *Characters uses JSON here (set before layouts moved)*, and so on, with **Move into the template**.
3. One click rewrites their copy to name the bare layouts and clears the leftovers. Output is unchanged; the choice now lives with the template it belongs to.

## What gets built

### Data (app)

1. Two columns on `pipeline_variable_templates`, generated migration (index above the applied max):
   - `reference` text, nullable, unique with `variable_id`: `<owner>/<slug>@<major>`.
   - `pub_default` boolean, default false, partial unique on `variable_id` where true.
2. **Boot pass, idempotent:** stamp `reference` on core's shipped rows (fixed slugs: `titled-json`, `json`, `titled`, `as-written`, `sentence`, `numeric`, `lines`), on automatic rows (`<owner>/json@<variable major>`, owner from their template id), and on plugin rows (the seed's `slug`, else its id's name segment). A person's existing rows stay NULL until edited in W3; the pub's choice needs no reference.
3. **A preset's variable layouts**, stored with the preset's changes: `{ [variableId]: layout reference }`. Stored by reference, the same shape a declared preset uses, so a pub preset and a shipped one read alike. A reference that no longer resolves (its plugin removed) is skipped: the pub's layout renders, and the preset shows a notice naming it, on the path presets already use for a missing requirement.
4. **Data upgrade, idempotent**, of stored per-step picks. They live only at preset and genre scope (`WRITE_MATRIX.variables` is `['preset', 'genre']`, `../serene-pub-sdk/sdk/src/config.ts:450-454`).
   - **The invariant: no prompt changes, anywhere.** For every preset and every step it runs, the layout each variable renders through after the upgrade is the one it rendered through before. Before, a step's layout was its preset pick, else its genre pick, else the package default.
   - **Pub level:** if every genre-level step that renders a variable resolves to the same non-default row, that row becomes the pub's layout, and those genre picks are removed.
   - **Preset level:** for each preset, if every step it runs resolves to the same row for a variable, and that row differs from what the pub level now gives, it becomes the preset's variable layout. The preset's picks for that variable are removed either way.
   - **Anything else** → the picks that would otherwise change output are **kept and honoured** ⏳ as **leftover picks**, shown in W4 with **Use the pub's** and **Move into the template** ★3, written by nothing new, dropped at the 0.7 squash.
   - VL-data writes the exact algorithm against the invariant and names it in its report.
   - Tests: a second boot changes nothing; a pub with one pick on one step renders every other step byte for byte as before; a preset whose steps all picked Prose ends with a preset variable layout and no leftovers.

### Render path (app)

5. **Resolution by variable**, replacing the per-step deref (`world.ts:812-835`, `derefLayout`): leftover pick (⏳) → the session's preset's variable layout → pub's layout → package default → automatic/floor. The run inspector already lists which layout each value used; it adds why (*the preset's*, *the pub's*, *the default*, *named by the template*). The absence rule stays in `renderVariable` (`variableLayouts.ts:1081`).
6. **Explicit references are rendered before the template runs.** The template is parsed (the template check already parses both core engines), every `layout <key> "<ref>"` call is collected, each is rendered through `renderVariable` in the same loop that lays out values today (`assemble.ts:751-773`, which keeps plugin engines and cancellation working), and the helper returns the result. A reference must be a literal, so no computed refs. A helper or filter receives the already-laid-out value, not the key's name, so the pre-pass must address each call by its key and reference. How (rewriting the call, or a key-named argument) is VL-data's to decide and name in its report.
7. **Laid-out values arrive marked safe**, so `{{x}}` and `{{{x}}}` print the same ★6.
8. **Law T1 covers references:** an unknown reference is refused at save and select; on a stored template, the existing **misfit** notice names it, and the run renders the variable's in-use layout and the run inspector says so.

### SDK

9. `templateCheck`: the `layout` helper (Handlebars) and filter (Liquid). First argument a laid-out key in scope; second a string literal from a host-supplied `layoutsByVariable`; completion and hover from the same list.
10. `TemplateSeed` gains optional `slug` for `kind: 'variables'` (additive, `@experimental`).
11. ★7 a typed `variableLayout(variable, { slug, major, label, engine, source })` that builds the `TemplateSeed`. Recommendation: in. It's small and makes a typo in the variable a compile error.
12. `PresetDecl` gains 🚧 `variableLayouts?: Record<VariableId, string>` (variable id → layout reference; additive, `@experimental`), validated at install like the preset's other keys: an unknown variable or a malformed reference is refused; a reference to a layout not installed is accepted and handled as in Data item 3. Not `layouts`: a genre's `layouts` are session layouts.

### Client

13. W1 changelist and W2 change view with its `AdminInline` (replacing `admin/sections/variable-templates/Page.svelte`'s `TemplateChangelist kind="variable"`), W3 form (from `TemplateChangeForm`, its variable branch), the server-served scope and sample, the old-route redirects (`adminRoutes.ts:121-123`, `adminNav.ts:136`) and the encoded variable id.
14. W4: `PipelineConfigOptions.svelte:1847-1900` loses the picker branch for the link row and the leftover lines with their two actions.
15. W6: the **Variable layouts** fieldset on the preset change form (Admin › Presets), editable for pub presets, words for declared ones.
16. W5: `ScopeTree.svelte` meta line; the caret line's buttons and the **Layouts in this template** list (new plumbing in `TemplateEditor.svelte`); completion and lint through `templateAssistBridge.ts`.

### Names (NOMENCLATURE, same change)

- UI and docs say **variable layout** everywhere; the Admin nav item becomes **Variable layouts** ★1. Code keeps `variable template` identifiers (renaming the table buys nothing). §15's row says so. Never bare *layout* in the UI.
- 🚧 **layout reference**: `<owner>/<slug>@<major>`, unique within its variable. ⚠ Not a **template id** (the row's app-wide identity). The old meaning, a step's stored pick (`world.ts:814`), retires with the pickers → §23.
- 🚧 **pub's layout** (`pub_default`; UI *In use*, *Chosen for this pub*). ⚠ Not a genre default and not a preset change.
- 🚧 **preset's variable layouts** (`PresetDecl.variableLayouts`; UI fieldset **Variable layouts** on a preset): one layout per variable a preset declares for its sessions. ⚠ Not a **layout preset** or a genre's `layouts` (session layouts, §9), and not a preset's `settings`.
- ⏳ **leftover pick**: a per-step pick the upgrade kept (§ Data item 4). Dropped at the 0.7 squash.
- Helper and filter `layout`. Inside a template no session layout can appear, so the bare word is unambiguous there.
- §25 rows for each.

### Docs

`docs/context-templates.md`: § Where they live; § Variable layouts rewritten around W1–W5; § Upgrading from 0.5 replaces "pick the bare layouts for its pipelines" with **Layouts in this template › All bare** on the pasted copy, and names **Move into the template** for picks made before. `docs/pipelines.md` (any mention of the pickers; § Presets gains what a preset's variable layouts do, with the small-model example). `STYLE-GUIDE.md`: §6.11 (the changelist list, and Variable layouts' change view with its inline), §6.12 (the tree's *Written as* line, the caret line's buttons), §6.17 (the link row and leftover lines).

## What this drops from the earlier proposals, and why

- **A virtual `core/json@1` for every variable, owned by core, with no row.** "Built-in layout" is a retired session-layout word (NOMENCLATURE.md:1552), and the automatic rows already do the job. Keeping them is the smaller change.
- **The per-step Advanced override.** The pub's layout covers what it was for, and leftover picks are handled once by the data upgrade.
- **Removing layouts altogether.** Every section's presentation would move into the template, so any presentation change means copying the shipped template and losing its updates.

## Lanes

Briefs at `plans/briefs/BRIEF-vl-<letter>.md`, reports at `plans/REPORT-vl-<letter>-2026-11-10.md`. At most two supervisors live at once.

| Lane | Owns | After |
| --- | --- | --- |
| `vl-S` SDK | `templateCheck` helper/filter and literal-reference rule, `TemplateSeed.slug`, `PresetDecl.variableLayouts` + validation, `variableLayout()` (★7) | — |
| `vl-D` server | schema, migration, boot pass, preset storage, data upgrade, resolution, render pre-pass, engine helper/filter, safe values, T1, run-inspector reason, and every socket W1–W6 need | runs beside `vl-S`; its SDK-dependent parts wait for `vl-S`'s `sdk:build` |
| `vl-A` admin | W1, W2, W3, W6, route redirects | `vl-D` |
| `vl-E` editor | W4, W5 | `vl-D`, `vl-S` |
| `vl-N` docs | docs, STYLE-GUIDE, NOMENCLATURE | `vl-A`, `vl-E`, and the other session's docs lanes |

**Coordination with the other live session (serene-pub-d9: advanced controls, history per date):** it generated migrations 0149–0150. `vl-D` runs `db:generate` only after the lead confirms `schema.ts` holds no ungenerated change of theirs. `sdk:build` only after the lead tells d9. NOMENCLATURE and STYLE-GUIDE wait for their docs lanes.

One grouped verification at the end: `npm run check`, `npm test` (capped scope), `npm run sdk:test`, a second-boot test, and a walk of W1→W3, W6 and the three walkthroughs on a dev instance.

## ★ Open for the owner

- **★1** UI name **Variable layouts** (nav, pages, docs); code identifiers unchanged.
- ~~**★2**~~ **Ruled 2026-11-10: B.** The pub's layout replaces per-step pickers, and a preset may declare one layout per variable for its sessions (W6, `PresetDecl.variableLayouts`).
- **★3** The upgrade promotes picks to the pub's layout or a preset's variable layouts only where no output changes; every other pick that matters stays as a leftover, honoured and shown with **Use the pub's** and **Move into the template**, until the 0.7 squash. The alternative, copying a context template per preset automatically, writes rows nobody asked for.
- **★4** Reference format `<owner>/<slug>@<major>`: major required, slug fixed on first save. A person's existing rows get one only when next edited, or when **Move into the template** needs one (it asks for the owner slug then).
- **★5** **Use it everywhere** starts off for a new layout, and its sentence counts the pipelines and templates it would change.
- **★6** Laid-out values print unescaped in `{{ }}` too. This changes output only for a template that used double braces, which today prints `&quot;`.
- **★7** The typed `variableLayout()` SDK helper: in, or `TemplateSeed.slug` alone.
- **★8** Plain data (port output, prompt fields, annex keys) never gets a layout; a plugin that wants one declares a variable.

## Challenge answers (plan-challenger, 2026-11-10)

1. **HIGH: the upgrade would promote one pick pub-wide.** Unpicked steps render the package default (`world.ts:819-833`, `seedVariableTemplates.ts:231-247`), so promoting a lone pick changed every other step; and there are no session picks (`config.ts:454`). **Accepted:** every step votes, unpicked ones for the default; only unanimity promotes; tests added (§ Data item 4).
2. **MEDIUM: the documented 0.5 path got harder; ★5 defaulted on.** **Accepted:** **Layouts in this template** (All bare / All titled) and **Move into the template**; § Upgrading names them; ★5 now off, with counts.
3. **MEDIUM: Ctrl+. at the caret doesn't exist, and a shortcut isn't intuitive or touch-friendly** (`templateAssistBridge.ts:110-140`, `cmBase.ts:181-188`). **Accepted:** buttons in the caret line; plumbing budgeted in VL-editor.
4. **MEDIUM-LOW: the card grid fits none of §6.11's four shapes; no redirect; ids need encoding.** **Accepted:** W2 is a change view with an `AdminInline`; redirects and encoding listed in VL-admin.

Also checked, not raised by the challenger: the UI noun *section* had no §25 row and clashed with **prompt block**, so the UI now says *variable*. The bare `layout` helper stays under ★1's argument.

B came after the challenge round; W6 and Data items 3–4 haven't been challenged.

## Noticed, not done

- `PLAN-advanced-controls-2026-11-10` leaves admin views untouched, so nothing here overlaps it.
