# BRIEF vl-N — Variable layouts: docs, NOMENCLATURE, STYLE-GUIDE

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then the plan `plans/PLAN-variable-layouts-2026-11-10.md`, then the lane reports `plans/REPORT-vl-{S,D,A,E}-2026-11-10.md` (and `REPORT-vl-F-2026-11-10.md` if it exists when you start; `vl-F` is running beside you and changes only: the owner field in the editor reads **Owner slug**; W1 shows the variable's key; W6's picker offers only the preset's variables; the logbook links to Variable layouts). Document **what was built**, from the reports and the code, not what the plan first drew. Delegate typing to at most 2 `lane-worker`s with briefs at `plans/briefs/BRIEF-vl-N-w<n>.md` (suggested: w1 NOMENCLATURE + STYLE-GUIDE, w2 docs); quote into each the rules below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

1. **`NOMENCLATURE.md`** (read §1, §15, §23, §24, §25 first; never load it whole):
   - §15: the **variable template** row says the UI and docs word is **variable layout** (★1, 2026-11-10), code identifiers unchanged, never bare *layout* in the UI; add rows for 🚧 **layout reference** (`<owner>/<slug>@<major>`, unique within its variable; ⚠ not a **template id**), 🚧 **pub's layout** (`pub_default`; ⚠ not a genre default, not a preset change), 🚧 **preset's variable layouts** (`PresetDecl.variableLayouts`, `session_presets.variable_layouts`; ⚠ not a layout preset or a genre's `layouts`, not `settings`), ⏳ **leftover pick** (dropped at the 0.7 squash). Extend **automatic layout** only if the code changed its meaning (check vl-D's report).
   - §23: retire the per-step layout pick (the `variable-template-ref` control, `ConfigOption.variableTemplate`, `variableOptionGate`, the events `pipelines:cloneVariableTemplate` · `:updateVariableTemplate` · `:deleteVariableTemplate`, the old meaning of *layout reference* in `config/world.ts` as a step's stored pick), the **Variable templates** nav label, and the "no host in view" `unknown-layout` warning (decided 2026-11-10). Say what replaced each.
   - §25: one ledger row per new name from the five reports (the SDK names, server code names, sockets, the `danglingVariableLayouts` field, the reasons `leftover | preset | pub | default | template`, the shipped slugs, the UI labels, the client component and module names, the error code and `candidates` / `key` from vl-F). Group them sensibly; follow the ledger's existing row shape and the R6 markers. Every row cites the plan and 2026-11-10.
2. **`STYLE-GUIDE.md`**: §6.11 (the changelist list: **Variable layouts** replaces "the three template kinds" entry where it applies; the variable's page as a read-only change view with an `AdminInline`; W6's draft edits that wait for Save), §6.12 (the tree's *Written as* line; the caret line's **Write as … here** buttons; **Layouts in this template**), §6.17 (the **Change layouts** row and the leftover-pick lines with their two actions). Short; match each section's voice.
3. **`docs/context-templates.md`**: § Where they live (Admin › Variable layouts; the old address redirects), § Variable layouts rewritten around what was built (W1–W6: one choice per variable for the whole pub; a preset may differ; a template may name one with `layout`; references; the walkthroughs as short examples, including the small-model preset and the 0.5 upgrader), § The editor (caret line, Layouts in this template, completion and lint of references), § Upgrading from 0.5 (replace "pick the bare layouts for its pipelines" with **Layouts in this template › All bare**, and name **Move into the template**), and the Liquid side-by-side table if it lists helpers/filters.
4. **`docs/pipelines.md`**: line 243 (picks list: no per-step layout pick any more), lines 274–275 (a band's layout is chosen on Admin › Variable layouts, not in the step's settings), line 387 (the inspector's Variable layouts list now says why: *the preset's* / *the pub's* / *the default* / *named by the template* / *leftover pick*, and a missing reference), lines 414–417 (the library's Variable layouts tab: describe it as it now behaves; check the code), § Presets (a preset's **Variable layouts**, with the small-model example).
5. **`docs/plugins.md`**: if it documents shipping templates, add a short paragraph on shipping a variable layout (`variableLayout(pluginId, variable, { slug, major, label, engine, source })`, its reference `<plugin>/<slug>@<major>`) and a preset's `variableLayouts`.
6. **`../serene-pub-sdk/INTEGRATING.md` §5** (seam census; read only §5): rows for a plugin's variable layouts (`variableLayout()`, `TemplateSeed.slug`) and a preset's variable layouts (`PresetDecl.variableLayouts`), in the table's shape. This is the canonical copy; the app-root one is a pointer.
7. Correct anything else in `docs/` that a grep for *variable template*, *layout* (in the variable sense) or the old picker shows to be false now. List what you changed.

## Files owned

`NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/context-templates.md`, `docs/pipelines.md`, `docs/plugins.md`, any other `docs/*.md` item 7 finds (list them), `../serene-pub-sdk/INTEGRATING.md` (§5 only).

## Files readable

Everything.

## Rules your work depends on (quote into worker briefs)

- **NOMENCLATURE.md is 14.5k tokens: read by section, never whole.** R1 one word one meaning; R3 qualify the noun; R6 mark 🚧 / ⏳. Record every added or renamed term in §25 in the same change. Never reintroduce a §23 word (*built-in layout* is retired for session layouts: never use it for variable layouts).
- Docs are user-facing: plain words, what a person sees and does, no internal identifiers except where the page already uses them (the context-templates page shows template syntax).
- It is a **session**, never a *chat* (except chat-completions wire vocabulary).
- `docs/pipelines.md` was just edited by another session's lane: keep its history / scenes-first sections, **Summaries and the lorebook** and **For plugin authors** exactly as they are; edit only the lines item 4 names.
- Another session (serene-pub-d9) has a docs lane that edits `NOMENCLATURE.md`; the lead has cleared this window with it. Edit NOMENCLATURE in as few passes as you can, and finish it before the other files.

## Out of scope

Code. The owner's open ★s (★A W1 shelf headings, ★E-3, ★E-4): document what was built.

## Stop and ask when

A report and the code disagree about behaviour (say which in the report, document the code); a term you need collides with an existing one.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root.
- Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.
- Do not start any dev server.

## Done means

- Every item above done or answered in the report.
- If the repo has a docs check (a test that greps docs for vocabulary or links: find it, e.g. under `src/lib/**/docs*.test.ts` or the SDK's guide tests), run it and report the result.
- A `scope-reviewer` run on your diff, findings answered.

## Report

Return it as your final message (the lead saves it to `plans/REPORT-vl-N-2026-11-10.md`): changed files with one line each, NOMENCLATURE rows added (term list), anything left undocumented and why, report-vs-code disagreements, **Noticed, not done**.
