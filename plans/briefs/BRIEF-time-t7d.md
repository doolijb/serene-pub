# BRIEF — build lane `time-t7d` — dates reach a layout as structured values: `date` and `dateDelta` on every dated row

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t7c-2026-11-15.md` (what this lane replaces), `plans/PLAN-entry-time-and-lines-2026-11-14.md`
§11 and "Later the same evening", `../serene-pub-sdk/INTEGRATING.md` §1n, §1p and the variables / layouts parts,
`docs/context-templates.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md` §1, §23, §24 and the variables / layouts
group, memory rulings "no magic in core for pipeline data" and "Decay is a rank multiplier, never context".

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form; `npx prettier --check <file>` only, **never `prettier --write`**. Never commit.
Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own
tests made, by name. Before any `sdk:build`, check `pgrep -af "vite"` (dev and preview; the Svelte language
server's esbuild is not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is up, don't
build; report 'blocked on your dev server'.

## Owner rulings, 2026-11-15 (quote them in worker briefs)

- "dates returned via SDK should be something like: type date: {year: {number:int, name:string?}, month:
  {number:int, name:string?}, {day: {number:inst, name:string?}, time: {hour:int, minute:int} So if an scene for
  example might have something like {...., date, dateDelta}, we don't have to rename it for every fucking
  different row type. The variable layouts should be per parent object/array"
- "Use the time delta in the same year month day time format … Context/variable layouts are what determine
  how/where it's printed." · "Lets not bother adding the delta value to the returned results for now, just
  scenes/history entries" · "lets try to match the internal variable names as close as possible and make sure we
  standardize."
- "The context template and variable layouts decide how to represent the data, nothing should be handed down
  flat. A custom node could flatten data, but it should be highly discouraged in the documentation, and if that
  new shape is trying to use an existing variable layout, it should be flagged as a missmatch, and refused at the
  configuration layer if an object is will cause an exception on execution during template rendering."
- "Lets also make sure the SDK can pass down the lorebooks calendar structure in case someone wants to render
  that in as additional context."
- "Break existing custom layouts, we are in pre-release, we don't care."
- Standing: Decay never puts text in a prompt in core; no magic in core for pipeline data (core supplies values
  and helpers; a layout prints); `compareDates` is the ordering; no `@2` bumps before 0.7.

## The design (v2, after cold review 2026-11-15)

1. **One date value** (SDK type 🚧 `StoryDateValue`; in a variable's scope it is an exported shared `object`
   field constant, **not** a new member of the `VarType` union):
   `{ year: { number, name? }, month: { number, name? } | null, day: { number, name? } | null,
   time: { hour, minute } | null }`. Names come from the lorebook's calendar only: `year.name` the era-spelled
   year, `month.name` the month's name, `day.name` the weekday, each absent where the calendar names nothing
   (free-form: no names). The value carries everything needed to print it: a layout has no calendar in scope
   (`variableLayouts.ts` ~1316–1321) and gets none. One host builder from a `StoryDate` / `StoryClock` + calendar.
2. **One delta value** 🚧 `StoryDateDelta`: `{ sign: -1 | 0 | 1, year, month, day, time }`, parts **plain
   non-negative integers or null** (no names: a month name labels a position, not a length), `time` =
   `{ hour, minute } | null`. Row date minus the session's current date:
   - only the parts both dates carry are compared; a finer part is `null`, never `0`;
   - a calendar with month lengths: exact, borrowed down the parts;
   - where a part would have to borrow and the calendar cannot say how much (free-form, the default,
     `sdk/src/storyTime.ts` ~162): take one from the coarser part and set that part's finer parts to `null`
     (known: at least that much). ★ for the owner with the alternative (a flag meaning "under / over");
   - `dateDelta` is `null` when: the session has no current date; the Timeline is off; the present was borrowed
     from the newest History day (`now.from === "history"`, `assemble.ts` ~363); the row has no date.
   No words in core: `relativeDateWords` and the `bound` wording leave the prompt path (inventory other callers;
   say in the report that this replaces `time-t7c`'s free-form bounds).
3. **Rows carry `date` and `dateDelta`, under those two names:**
   - `core:var/history@1` **becomes a list of rows** `{ date, dateDelta, <text> }` (the text field's name matches
     the internal one; inventory), newest first as today; **`undefined`, never `[]`, when empty** (a heading must
     not print over an empty list, `assemble.ts` ~211–217). History rows have `time: null`. The date-keyed record
     and the `relativeDate` root are removed.
   - `core:var/earlier-scenes@1` rows gain both. A scene's date is its **opened clock** (day and time;
     `scenes` ~`schema.ts` 4912–4923; precedent `liveScenes.ts` ~1918); `date: null` with no clock. Widen
     `earlierScenesOf` (`scenes/earlierScenes.ts` ~66–77), the query's output and both binding filters
     (`bindings.ts` ~6266–6309) to carry it.
   - `core:var/current-date@1` (`sdk/src/variables.ts` ~821–853, a flat shape today) adopts the same date value
     (owner: "make sure we standardize", "nothing should be handed down flat"); its shipped layout prints exactly
     what it prints today. **Do this last, and stop and report instead if anything but a layout reads its flat
     shape.**
   No other variable gains them.
4. **Layouts are per parent**: a layout renders its variable's one value and reads each row's own fields. Remove
   `time-t7c`'s sibling plumbing (`renderVariable`'s `siblings`, the linter and preview passing in
   `contextConfigCards.ts`, `preview.ts`, `variableLayoutsView.ts`; `scopeRootFor`'s rule only if nothing else
   needs it): inventory every caller first.
5. **Two helpers, named apart from the fields** (in Handlebars `{{date}}` inside a row would call a helper named
   `date`, and Liquid already has a `date` filter): 🚧 `formatDate` and 🚧 `formatDateDelta`, registered in both
   engines (`shared/utils/contextHandlebarsHelpers.ts`, `contextLiquid.ts`). `{{formatDate date}}` prints, from
   the value alone, **what the shipped current-date layout prints for the same parts today**: the calendar's
   spelling when names are present, else `Y-MM-DD`, `Year N` for a year alone (so the row's date and the present
   stay in one format; measurement 6 found that is why the bare date reads well). `{{formatDateDelta dateDelta}}`
   prints the signed parts compactly in the same order (lead's 🚧 `-0y 2m 3d`, null parts omitted; give the
   owner this and two alternatives as a ★; no "ago" words). Both print nothing for `null` or a wrong type.
   Shipped layouts: History prints the date then the delta in parentheses when present. ⚠ Today's History
   heading comes from `orderKeyOf` (`assemble.ts` ~310–317), not from a formatter: state in the report whether
   any History heading's text changes and show before / after. Earlier scenes prints `name` as today and the
   delta in parentheses, **not** `date` (an automatic scene name already carries its date, `liveScenes.ts`
   ~1920–1925); `date` is there for a custom layout.
6. **A saved custom layout written for the old History shape** is not migrated. It renders non-strict, so it
   prints wrong rather than throws; rule 7's warnings flag it. Docs carry an upgrade note. No migration, no boot
   pass (stop if one seems needed).
7. **Mismatch at configuration** (owner: flagged as a mismatch; refused only "if an object is will cause an
   exception on execution during template rendering"). Facts: both engines run non-strict (`renderers.ts` ~178,
   `contextLiquid.ts` ~248), so today only a syntax error throws and save refuses only that
   (`templateValidation.ts` ~88–108). Build:
   - **warnings** in the existing layout check: an unknown field; an object or date value printed bare (would
     print `[object Object]`); `each` over a non-list; `@key` printed inside an `each` over a declared list (the
     old History layout's mark); `formatDate` / `formatDateDelta` given a field that is not a date / delta;
   - **refusal** stays for what throws (syntax); add no refusal for a template that renders;
   - **a render-time scope guard** (`sdk/src/template.ts` `checkValue` ~624): a value that does not fit its
     variable's declared scope (a node handed down a flat string for a list) is not rendered through the layout;
     the variable falls back to its floor and the run's receipt says which variable and why. This is how a
     flattening custom node is caught: a node cannot redeclare a registered variable's scope
     (`sdk/src/templateFit.ts` ~283–293) and another variable's layout is already refused (`unknown-layout`,
     `templateCheck.ts` ~445–470), so no configuration check can see it. The SDK guide says flattening in a node
     is strongly discouraged and why.
8. **The calendar reaches a template.** It already travels untyped as `storyTime.calendar` on the cast read
   (`host.ts` ~6290–6300 → `bindings.ts` ~5832–5840): type that field in contracts and add one variable
   (name per §24) a template can print it through, with a shipped layout that lists its parts. Additive,
   `@experimental`; no new query; no shipped template prints it.

## Build order

A. Inventory (supervisor, read-only, file:line): every producer and consumer of `core:var/history@1` and
`core:var/earlier-scenes@1` values (host, `assemble.ts` `relativeDatesOf` / `orderedEntries`,
`variableLayouts.ts`, shipped layouts and their seeds, previews, the template field linter, tests, docs, SDK
samples and guides, plugins in `plugins/` that read either); every reader of `core:var/current-date@1`'s value; every stored place a layout template lives; what a
scene's date is; the calendar's nameable parts; where helpers are registered; what throws at render today.
B. SDK: the types, the scope type, the two variables' scopes and samples, the calendar read and variable,
`validate()` cases, guides (`time.md`: the recipes still pass `guideRecipes.int.test.ts`), `INTEGRATING.md`.
C. Host: the value builders, the two producers, helpers, removal of the sibling plumbing, the mismatch check.
D. Shipped layouts, docs (`context-templates.md`, `lorebook-time.md`, upgrade note), `NOMENCLATURE.md` (new
names, `relativeDate` retired in §23, §25).

## Files owned

Named by the inventory within: SDK `sdk/src/variables.ts`, the story-time types, `validate.ts`, the two
variables' producers' contracts, guides, tests; app `shared/lorebooks/storySpan.ts`, `storyDate.ts` (additive),
`pipelines/prompt/*`, `pipelines/entities/variableLayouts.ts`, `pipelines/config/variableLayoutsView.ts`,
`shared/utils/contextConfigCards.ts`, the earlier-scenes and history producers in `runtime/bindings.ts` /
`host.ts`, shipped layout seeds, their tests, the docs, `NOMENCLATURE.md`.

## Out of scope

Deltas on lore entries or any other variable; relative words in core; renaming "variable layout" (with the
owner); the timeline stance typing (its own lane); replacement summaries; any UI beyond the existing layout
editor's warnings; a migration (stop if one seems needed).

## Stop and ask when

CLAUDE.md §Decisions applies; a plugin or shipped genre outside Story reads the History record's old shape and
cannot follow in this lane; removing the sibling plumbing breaks a variable other than History; anything but a layout reads the current
date's flat shape; the mismatch
refusal would block saving a layout that renders correctly today; stored data needs rewriting.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t7d-sdk.log 2>&1"`:
  only the four known failures (re-pin hashes with "(was …)").
- App tests (that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run at a time): the
  date value for year-only, year-month, full and with a time, with and without calendar names; the delta for
  past, future, zero, across a year, month forward and day backward (with month lengths: exact; free-form: the
  coarser part less one and finer parts null), mixed precision, no current date, Timeline off, a present
  borrowed from History; an empty History is `undefined`;
  History and Earlier-scenes rows carry both fields; the shipped layouts print the same date text as before plus
  the delta; an old-shape custom layout does not throw and is flagged; each warning case; a flat value handed to a list
  variable falls back to the floor with the receipt line; the current-date layout prints byte-identically;
  `{{formatDate date}}` in both engines; the calendar read; previews; `guideRecipes.int.test.ts`,
  `declaredReads.test.ts`, `registryHashes.test.ts`, `contextConfigCards*.test.ts`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story. No other product's name.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t7d-<date>.md`): inventory with
file:line; every new and removed name; the delta's printed form and the alternatives; what a saved old-shape
layout does; changed files in both repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not
done**. Under about 900 words.
