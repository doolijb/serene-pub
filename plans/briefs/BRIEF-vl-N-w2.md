# BRIEF vl-N-w2 — Variable layouts: user docs

You are a `lane-worker` for lane **vl-N** (supervisor: vl-N). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The **variable layouts** build (2026-11-10) replaced the per-step layout pickers with one choice per variable for the whole pub, an optional choice per preset, and a template's own way to name a layout. Rewrite the user docs to describe **what was built** (below, checked by the supervisor against the code), not the old pickers.

## Files owned

- `/home/jody/github/serene-pub/docs/context-templates.md`
- `/home/jody/github/serene-pub/docs/pipelines.md` — **only** the lines named in §2 below.
- `/home/jody/github/serene-pub/docs/getting-around.md` — line 42 only.

## Files readable

Everything. Background: `plans/PLAN-variable-layouts-2026-11-10.md` (W1–W6 and the three walkthroughs), `plans/REPORT-vl-{D,A,E}-2026-11-10.md` (labels as built). The UI code: `src/lib/client/admin/sections/variable-layouts/*.svelte`, `src/lib/client/admin/sections/session-presets/PresetVariableLayouts.svelte`, `src/lib/client/components/pipelines/StepVariableLayouts.svelte`, `src/lib/client/components/templates/{TemplateEditor,TemplateLayoutsList}.svelte`, `src/lib/client/components/pipelines/inspector/receiptView.ts` (`layoutsView`).

## Rules (quoted from CLAUDE.md and the lane brief)

- "Docs are user-facing: plain words, what a person sees and does, no internal identifiers except where the page already uses them (the context-templates page shows template syntax)." Match each page's voice: short declarative sentences, **bold** for UI labels, _italics_ for UI sentences quoted, no marketing.
- It is a **session**, never a *chat* (except chat-completions wire vocabulary).
- The UI and docs word is **variable layout** (plural **Variable layouts**, the Admin page). Never bare _layout_ where a session layout could be meant; inside the context-templates page, "layout" after "variable layout" has been said in the same paragraph is fine, as the page already does. Never write *built-in layout* (a retired session-layout word); *built-in default* is the run inspector's own words and may be quoted.
- "`docs/pipelines.md` was just edited by another session's lane: keep its history / scenes-first sections, **Summaries and the lorebook** and **For plugin authors** exactly as they are; edit only the lines item 4 names." (Item 4 = §2 below.)
- **Keep every heading's text that other pages link to.** `### Variable layouts: where the headings and fences come from`, `## Upgrading from 0.5`, `### Finding the variables a template can use`, `### The postHistory object` stay spelled exactly as now (anchors). New `###`/`####` subheadings are fine.
- Members never see model plumbing; pipelines and these pages are admin-only. Say "an administrator" where the page does.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need none.) Do not start any dev server.

## What was built (the facts to document)

**Resolution.** A bare `{{{characters}}}` is written out by, in order: a leftover pick on that step (upgrade only, see below) → the session's **preset's** layout for that variable → the **pub's** layout for that variable → the default (Serene Pub's shipped default, or the plugin's first layout) → the automatic **JSON** layout or plain text. A template that names one, `{{{layout characters "core/json@1"}}}` (Liquid `{{ characters | layout: "core/json@1" }}`), uses that one in that template only, whatever the preset or pub chose. No per-step choice remains.

**Admin › Writing › Variable layouts** (the page; old **Variable templates** address redirects here, a bookmarked layout to its form). Purpose line: _How each variable is written out. One choice for the whole pub._ A list of **variables** (not layouts): columns **Variable** (its name and template key), **Supplied by**, **Written as**, **Layouts** (count); a **Shelf** filter (Characters and personas, Lore, …) and a text filter. **Written as** reads _‹name› · chosen for this pub_, _‹name› (automatic)_, _As written_ (a variable with no layout, written exactly as the pipeline gives it), or the default's name, plus a muted _+ N preset(s)_ when presets differ. No Add: a variable arrives with code. Opened from a step's **Change layouts**, it shows _Showing the variables ‹step› writes out._ with **Show all**.

**A variable's page.** Header: its name and description, _Supplied by ‹supplier›._, **New layout** (starts from the layout in use). When the pub's choice isn't the default: _Chosen for this pub._ **Back to the default** _(‹default name›)_. **Example value** (closed). Then **Variable layouts**: one row per layout, previewed against the example (two lines, **Show all**); **In use** on the one in use, **Use this** on the others (makes it the pub's layout at once); _Named by N context template(s)_; _Chosen by the ‹name› preset_ (linked); **Duplicate** (opens the new-layout form prefilled, _‹name› (copy)_); **Edit** and **Delete** only on layouts made in this pub. Delete is refused, in words on the row, while the layout is the pub's choice, chosen by a preset, named by a context template, or held by a leftover pick. Choosing a layout while a preset keeps its own says so.

**The layout form** (**New variable layout** / a layout's page). **Name**; **Referenced as**: **Owner slug** (prefilled with the last one used) and **Name to reference it by** (follows the name until edited), shown together as e.g. `mypub/prose@1`, _Fixed once saved, so templates that name it keep working._; **Language** (Handlebars or Liquid, fixed once made); the source in the template editor with _Variables available here_ showing that variable's own fields (also for a plugin's variable) and a live **Preview** against the example value. **Use it everywhere** (new layouts only, off by default): its sentence counts what turning it on changes, _Every template that writes {{{characters}}} without naming a variable layout uses this one: N pipelines, M templates._ Left off, the layout is offered on the variable's page with **Use this**. An older layout of yours with no reference must be given one when next saved.

**References.** `<owner>/<slug>@<major>`. Serene Pub's: `core/titled-json@1` (Titled JSON block), `core/json@1` (JSON), and `core/titled@1`, `core/as-written@1`, `core/sentence@1`, … ; the automatic layout of an object variable is `<owner>/json@<major>`; a plugin's `acme.dice/prose@1`; yours `<your owner slug>/<slug>@1`. A reference is unique within its variable (two variables can each have `core/json@1`).

**A pipeline step** (Admin › Pipelines, the prompt-building step, admins only): the per-variable layout pickers are gone. Under the context template picker: _Each variable is written out by its variable layout, shared by every pipeline._ **Change layouts** (opens Variable layouts filtered to that step's variables).

**Leftover picks (upgrade).** At upgrade, Serene Pub folds the old per-step picks in without changing any prompt: where every step agreed, the pick became the pub's layout; where every step a preset runs agreed, it became that preset's layout; any other pick that would change a prompt if removed is kept and still honoured, shown on its step as _Characters uses JSON here (set before layouts moved)._ with **Use the pub's** (removes it). When the step's context template is the pub's own copy, **Move into the template** rewrites that template to name those layouts itself and clears the picks, with the prompt unchanged. If a picked layout has no reference yet, it asks for an **Owner slug** first. With unsaved edits to the template it asks: _Save or cancel your changes to the template first._ Leftover picks go away at 0.7.

**The template editor, opened from a pipeline step** (not in the library):
- The _Variables available here_ row of a laid-out variable adds _Written as ‹name›_.
- With the caret on `{{{characters}}}`, the line under the field reads _Written as Titled JSON block (this pub's choice)_ (or _(the default)_, _(automatic)_, _(named by the template)_), followed by one button per other layout: **Write as JSON here**, … A button rewrites that one tag to `{{{layout characters "core/json@1"}}}`. Real buttons: they work by touch and keyboard.
- **Layouts in this template** (above the field; not on a read-only template): one row per laid-out variable the template reads, each a select (_The pub's layout_, each layout by name, _Mixed — leave as it is_ when the template writes it more than one way), plus **All bare** and **All titled**; **Apply** rewrites every occurrence in one edit (one undo).
- Completion inside `layout characters "` lists that variable's references with their names.
- Lint: a reference that variable doesn't have is an error, with a fix such as **Use "core/json@1"** for a near miss; a `layout` call whose reference isn't a quoted literal, or whose first argument isn't a variable with layouts, is an error. Same checks as save and select: refused at save and select; a stored template that names a missing layout shows the notice it already shows for a misfit, and at run time the variable's in-use layout renders and the run inspector says so.
- A shipped template is read-only, so these offers appear on a copy.

**Double braces.** A value written out by a variable layout now prints the same in `{{characters}}` and `{{{characters}}}` (Handlebars); other text in double braces is still escaped, so triple braces stay the habit.

**A preset's Variable layouts** (Admin › Presets, a preset's page, a fieldset **Variable layouts**): _How this preset's sessions write out a variable, where it differs from the pub's choice._ Empty: _Uses the pub's layout for every variable._ **Change a variable's layout**: pick a variable (only the variables this preset's pipelines write out), then a layout, each previewed against the example. Each row shows _(pub's: ‹name›)_ and **Remove** (goes back to the pub's). Adds and removals show _Waiting for Save_ / _Removed — waiting for Save_ with **Put back**, and take effect on **Save**. A layout without a reference asks for one first (**Give it a reference**). A preset Serene Pub or a plugin ships shows its rows as words: _This preset ships with Serene Pub or a plugin, and updates replace it. Clone it to change its variable layouts._ A row whose layout no longer exists (its plugin removed): _‹variable› names ‹reference›, which no variable layout goes by now. The pub's layout is used._, and the presets list marks that preset _Variable layout missing_.

**Run inspector.** Under a prompt-building step's **Prompt**, **Variable layouts** lists each value placed, the layout (_Titled JSON block (Serene Pub's)_, _(from a plugin)_, _(made here)_, or _built-in default_ when no layout exists), its variable, and why: _the preset's_, _the pub's_, _the default_, _named by the template_ or _leftover pick_. A named layout that wasn't found reads _named core/prose@1, which wasn't found; used Titled JSON block_.

**Pipelines › Library, Variable layouts tab** (unchanged by this build): layouts grouped by variable and language, each editable / duplicable / deletable there, **New** per group. Its _Used by …_ now counts only pipelines still holding a leftover pick; which layout is in use, and which presets and templates name one, is on the variable's page in Admin › Variable layouts. Deleting there is refused the same way as on the variable's page.

## 1. docs/context-templates.md

Read the whole file (400 lines) first.

- **Intro bullets (~line 13):** keep; the link target is unchanged.
- **§ Where they live (~line 25):** replace the "**Admin › Variable templates** and **Admin › Completion templates** work the same way." sentence: Completion templates works the same way; variable layouts have their own page, **Admin › Variable layouts**, listed by variable (link to the section below); an old **Variable templates** bookmark opens it.
- **§ The editor:** add a bullet (or two) after **Lint** for **Variable layouts**: the caret line and its **Write as … here** buttons, **Layouts in this template**, completion of references, and their lint — when opened from a pipeline step. Keep it to the shape of the existing bullets.
- **§ The variables (~line 177):** the triple-braces sentence is now only partly true; fix it per **Double braces** above, briefly.
- **§ Variable layouts: where the headings and fences come from (~lines 198–215): rewrite** around what was built. Suggested order, each short:
  1. What a variable layout is (keep the structure-vs-presentation paragraph, minus "chosen per pipeline in Admin › Pipelines").
  2. **One choice for the whole pub** — the Admin › Variable layouts list and a variable's page; **Use this**, **Back to the default**; what the shipped ones are (keep the Titled/bare list; drop "If your template writes its own headings… select the bare layouts" — replaced by naming them in the template, below); the automatic **JSON** layout; _As written_ for a variable with none.
  3. **Writing your own** — **New layout** / **Duplicate**, the form, **Referenced as**, **Use it everywhere**, edit/delete rules.
  4. **A preset may differ** — one paragraph, link to [Pipelines → Presets](./pipelines.md#presets).
  5. **A template may name one** — the helper and filter with both syntaxes, references (format and examples), the order of what wins (template's own → preset's → pub's → default → automatic; leftover picks first, linked to the upgrade section), and what happens to a missing reference.
  6. Three short examples (a few lines each): a **Small models** preset writing Characters and Personas as a Prose layout you wrote (link to Pipelines → Presets for the steps); a plugin's `omens` value with only the automatic JSON layout — open it, **New layout**, write prose, turn on **Use it everywhere**, and later one copied template names `{{{layout omens "acme/json@1"}}}` with **Write as JSON here**; the 0.5 upgrader (link to § Upgrading from 0.5).
  7. Keep **When a pipeline means something else by a name**, corrected: that name is then written out by the plugin data's own variable layouts (its own row on Admin › Variable layouts), not core's; a leftover pick for core's version is removed with a notice on the configuration. Keep the run-inspector link.
  8. Keep **Reading a shipped layout** as is.
- **§ Writing a template in Liquid › The syntax, side by side:** add a row to the helpers→filters table: `{{{layout characters "core/json@1"}}}` | `{{ characters \| layout: "core/json@1" }}`.
- **§ What Liquid is not allowed to do:** add a few words that the `layout` *filter* is a different thing and allowed (the refused one is the `{% layout %}` tag).
- **§ Templates are checked when you save them:** one short paragraph: a `layout` call naming a layout its variable doesn't have is refused at save and select like an unknown name, and a stored one shows a notice.
- **§ Upgrading from 0.5 (~line 398):** replace "and pick the bare **JSON** / **As written** layouts for its pipelines, because a 0.5 template writes its own headings and fences" with: open **Layouts in this template** beside the field, press **All bare**, then **Apply** (a 0.5 template writes its own headings and fences, so the copy now names the bare layouts itself). Then a short paragraph on picks made before layouts moved: kept as they were where removing them would change a prompt, shown on the step with **Use the pub's** and, for the pub's own template copy, **Move into the template** (one click names them in the template, prompt unchanged).

## 2. docs/pipelines.md — only these lines

- **~line 243** (§ What always keeps a stored value): drop "layout" from "which prompt, context template, layout, model or sampling config". Nothing else in that paragraph.
- **~lines 274–275** (§ A source's band in the context template): the "**How a band looks is a setting.**" bullet becomes how a band looks is its **variable layout**: each band has its own row on **Admin › Variable layouts**, beside world lore and history, where an administrator chooses how it is written out (such as prose instead of JSON) for the whole pub; a preset may differ; the step's settings link there with **Change layouts**. In the next bullet replace only the last sentence's "and that name's layout setting then offers the plugin's layouts" with: that name is then written out by the plugin's variable layouts.
- **~line 387** (§ Inspecting a run, the **Prompt** bullet): the **Variable layouts** sentence per **Run inspector** above (keep the variable-id example; replace "when none was picked" with "when no layout exists for it"; add the why words and the missing-reference line).
- **~lines 414–417** (§ The pipeline library): describe the **Variable layouts** tab as above — keep the paragraph's shape; add one sentence that a layout's _Used by_ there names only steps still holding a leftover pick, and that which layout is in use is on the variable's page in **Admin › Variable layouts**.
- **§ Presets (~lines 106–118):** add a bullet after **Settings** for **Variable layouts** (per **A preset's Variable layouts** above, a few sentences), and after the bullets, before "The presets Serene Pub ships are read-only…", a short example paragraph: the **Small models** preset — **Change a variable's layout** → _Characters_ → a _Prose_ layout you wrote, the same for _Personas_, **Save**; sessions on that preset write those two as prose, every other preset keeps the pub's layout, no template was copied, and the Characters page in Admin › Variable layouts shows _Chosen by the Small models preset_.

Don't touch any other line of pipelines.md.

## 3. docs/getting-around.md

Line 42: `Variable templates` → `Variable layouts`.

## Done means

- The three files edited as above.
- `npx vitest run src/lib/shared/utils/docsContextTemplate.test.ts` from `/home/jody/github/serene-pub` passes (it compares the doc's fenced Default template with the shipped one; don't touch that fenced block).
- `grep -n -i "variable template\|pick the bare\|pick its layout\|layout setting" docs/context-templates.md docs/pipelines.md docs/getting-around.md` shows nothing stale.
- `npx prettier --check` on the three files (report only; if a file failed before your edit, say so rather than reformatting it).
- Every link you add to an anchor exists (heading slugs: lowercase, spaces → `-`, punctuation dropped).

## Report (return as your final message)

Changed files with the sections edited; anything in "What was built" you found the code contradicts (say what the code does); test results; noticed, not done.
