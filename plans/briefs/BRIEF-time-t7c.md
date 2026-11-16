# BRIEF — build lane `time-t7c` — the time delta in the prompt: a date-driven value the shipped layouts render

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t7b-2026-11-15.md` (**all of it: its inventory, with file:line, is this lane's starting
point; do not redo it, verify it**), `plans/briefs/BRIEF-time-t7b.md` (only "Corrections after the cold review"
items 1 and 2, and the final WITHDRAWN note), `plans/PLAN-entry-time-and-lines-2026-11-14.md` §7 "Measured
2026-11-15" (3, 3b), `docs/context-templates.md`, `docs/lorebook-time.md`, `../serene-pub-sdk/INTEGRATING.md`
(prompt variables and layouts, by section), `NOMENCLATURE.md` §1, §24, §23, the **Decay** row and the variable
layout rows.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview; the Svelte language server's esbuild is
not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If a server or a run is up, don't build;
report 'blocked on your dev server'.

## Goal

A dated thing in the prompt can say **how far it is from the story's now**, in words: *(2 days ago)*,
*(3 years ago)*, *(in 2 days)*. It is a value computed from dates and handed to the variable layouts; the
**shipped History layout** shows it beside the date. Decay has nothing to do with it.

## Owner rulings (quote them in worker briefs)

- 2026-11-15: "decay is an arbitrary multiplier against recal rank, never a fucking value we include in the
  context, at least not in core." **Nothing in this lane reads `decayRate`.**
- 2026-11-15: "The time detla isn't complicated. All we have to do is update our context templates/variable
  layouts. Arguable showing the time delta (2 days ago, or 2 days in the future (if the character is a time
  traveler)) is more important than the precice date" — and, asked whether to offer both in the same context,
  the lead proposed both (*date (2 days ago)*); the owner then ruled only the Decay point. **Both together is the
  lane's working shape, marked ★.**
- 2026-11-13: "A time delta is better I think".
- 2026-09-30: "No magic in core … appended in-pipeline or logically inserted in the template": never the host or
  the assembler joining text into an entry.
- Standing: P1 (story time only, never the wall clock); P5; a layout an admin has edited is left alone; "0.6 is
  in users' hands" (do not change the shape of a record value saved layouts read); new published names are the
  owner's: **two are proposed below and NOT yet ruled.**

## Names proposed, awaiting the owner (build to them; the report lists them for ruling; easy to rename)

- 🚧 **`storyAgo`** (the earlier proposal `lastTrueAgo` is dropped: with Decay out of it, the value is not
  "last true"): "how far a dated thing is from the story's now, in words, without brackets: `2 days ago`,
  `in 2 days`; absent when the gap is under a day or a date is missing". Check §23/§25 for collisions and
  propose a better word if this one fails R1–R3.
- 🚧 a template helper that joins text, **`concat`** (Handlebars; Liquid already has `append` / `prepend`), so
  the layout itself writes the brackets and the space.

## Build

1. **The helpers** (`src/lib/shared/lorebooks/lastTrue.ts`, built by `time-t7b`): add the future direction
   (*in 2 days*, *in 3 years*); a clock moved back before an entry's date is simply a future date. Keep: free-
   form never borrows; nothing under a day; nothing when a date is missing. Rename the file / functions if
   "last true" no longer describes them (internal names: your call, say it).
2. **The value**: for each **History** entry on the reading, the gap between its own date and the reading's
   moment (`reading.moment`; null with the Timeline off or no clock: then no value anywhere and the prompt is
   byte-identical to today's). Gathered in one pass for the whole reading (the calendar: `bookCalendarOf`, one
   query per book per run). It travels beside the entry as data (the allocation's `meta`, as history's date parts
   do) and is exposed to the layout as a sibling value: **the record's value shape does not change.** Verify and
   fix what `time-t7b` found about a second scope root (`VariableSample`, `scopeRootFor`'s single-root fallback,
   plugin bands rendered through world lore).
3. **Also available, not shown:** the same value for any other lore entry that carries a date (its Beginning),
   exposed to the world-lore and character-lore layouts the same way, **but the shipped lore layouts do not
   render it** (owner has not asked). If exposing it there costs more than the History path (the `anchor` role
   path for character lore), build History only and report.
4. **The shipped History layout** renders *‹date› (‹storyAgo›)*: propose in the report, with three rendered
   examples, where exactly (after the date in the key, or at the start of the text), and say which one the
   2026-11-15 measurement supports (value-start and key did about the same). The code-default floor layout
   follows the shipped one. Shipped rows refresh on boot while unedited
   (`boot/seedVariableTemplates.ts`); an edited layout keeps its text; the docs say how to add the delta.
5. **Budget**: the added words are counted (in the candidate's tokens or by the layout's own accounting): show
   which.
6. **Docs and names**: `docs/context-templates.md` (the value, the helper, one example), `docs/lorebook-time.md`
   (what the model is told about dates), `NOMENCLATURE.md` (§25 for every name; the **Decay** row: purpose =
   a multiplier against recall rank that pipelines may use, see the recipe; **it never puts anything in the
   prompt**). The entry row's Decay help (`src/lib/client/lorebooks/time/BeginningDecayRow.svelte`), now *Stored
   now; recall does not use it yet.*, becomes 🚧 *A pipeline can use this to rank the entry lower in recall; core
   does not.* (propose, ★). The SDK guide `guides/time.md`: one sentence that the delta is independent of Decay.
   No other product's name.

## Files owned

App: `src/lib/shared/lorebooks/lastTrue.ts` (+ test, or its renamed file), the smallest edits in
`pipelines/runtime/host.ts` (the lore read), `pipelines/prompt/assemble.ts` (`allocate` meta, `bandValue`),
`pipelines/entities/variableLayouts.ts` (the shipped History layout, the helper registration, `scopeRootFor`),
`boot/seedVariableTemplates.ts` only if a refresh needs it, `BeginningDecayRow.svelte` (one sentence), tests,
the docs, `NOMENCLATURE.md`. SDK: the variable's scope declaration for the new value on `core:var/history@1`
(and world lore / character lore only under item 3), `guides/time.md`, the SDK tests they require.

## Out of scope

Anything reading Decay; ranking; a rounds delta; a setting; changing the History date's own format; cast
members; the shipped world-lore and character-lore layouts' text.

## Stop and ask when

CLAUDE.md §Decisions applies; the value can reach the layout only by the host or assembler rewriting text, or by
changing a record's value shape; a third published name is needed; a prompt golden moves for a session with the
Timeline off or no clock; an edited (admin) layout would be overwritten.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t7c-sdk.log 2>&1"`:
  only the four known failures (re-pin hashes that move on purpose, with a dated comment).
- App tests (targeted, each in that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run
  at a time): the helper's table incl. future; a rendered prompt with a past History day, a future one, today
  (no delta), Timeline off and no clock (byte-identical to before), an edited layout untouched, the second boot
  changes nothing; the prompt pins listed in `REPORT-time-t7b` (update only those that show History with a
  clock set, and list each).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t7c-<date>.md`): how the value reaches
the layout; three rendered examples; every name and sentence for ruling; which prompt pins moved; changed files
in both repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under about 800
words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

1. **Compute the value in Assemble; no host edit, no new `meta` key, no extra query.** For History, Assemble
   already holds every input: each History allocation's `meta` is `{year, month, day}` (`orderMeta`,
   `prompt/assemble.ts` ~412–423, applied ~148–153); the story's now and the calendar are in
   `templateContext.storyTime` (`assemble.ts` ~805–810, built `host.ts` ~6290–6299). Gate: no delta when
   `StoryNow.from === "history"` (no clock set; `state/storyTime.ts` ~76–89) or when there is no story time at
   all. Compute beside `currentDateOf` (`assemble.ts` ~333–395) so the delta is measured from the same now the
   prompt prints. The layout gets it as a **sibling root** beside the record: `renderVariable` and the
   `layout(key, value)` closure must pass it (`entities/variableLayouts.ts` ~1190–1196, ~1264); multi-root
   samples already work (`sdk/src/variables.ts` ~845–864). `pipelines/runtime/host.ts` is **removed** from Files
   owned. (The path is `src/lib/server/pipelines/boot/seedVariableTemplates.ts`.)
2. **Item 3 ("also available, not shown") is removed**: nothing is exposed that nothing renders. This lane is
   **History only**. Whether dated lore entries should show a delta too is a question for the owner (★ in the
   report, with what it would cost: the world-lore `scopeRootFor` fallback for plugin bands and the
   `CHARACTER_LORE_ENTRY` field).
3. **No template helper.** `concat` is dropped: in Liquid it is already the built-in array filter, and the docs
   promise helpers and filters share names and arguments (`docs/context-templates.md` ~411). The shipped History
   layout writes the brackets as literal text around a lookup of the sibling value (Handlebars
   `{{#if (lookup ../‹name› @key)}}…`, and the Liquid equivalent): History keys are made by core
   (`orderKeyOf`, `assemble.ts` ~288–296) and the delta words are `"<n> <unit>"`, so neither needs JSON
   escaping; verify that claim with a test over the calendar's unit names (a custom calendar's month or era
   names never enter the delta). If a join helper turns out to be unavoidable, **stop and ask**.
4. **Free-form: say nothing rather than something wrong.** "Free-form never borrows" would print *1 year ago*
   for the last day of Year 7 to the first day of Year 8. In a free-form book, when a finer part both dates
   carry runs backwards (so the true span cannot be known without borrowing), the helper returns null. Add those
   rows; mark ★ in the report with how often a default book would then show no delta.
5. **One published name, with no direction in it.** `storyAgo` is dropped (the value can be *in 2 days*). Lead's
   proposal 🚧 **`relativeDate`**: "a History day's distance from the story's now, in words: `2 days ago`,
   `in 2 days`; absent under a day". Check §23/§25 (and that it does not read as the bare noun R3 forbids;
   `distance` is avoided because place distances are planned); propose a better word if it fails.
6. Budget: layout words are not counted, as headings are not; say so in the docs, no accounting change.
