# BRIEF — `time-t7d-w3`: shipped layouts for dated rows, the two helpers, the render-time scope guard, sibling roots removed (app)

Supervisor: lane `time-t7d`. App repo `/home/jody/github/serene-pub`. Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build`: the supervisor does.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo (`git show HEAD:<path>`
to READ an old version is fine). No migration, no boot pass. Comments state the rule, not the story. No other
product's name in any file. Another worker (`w5`) edits `pipelines/prompt/assemble.ts`, `runtime/bindings.ts`
and `scenes/earlierScenes.ts` at the same time — do not touch those or their tests (`assemble*.test.ts`,
`relativeDate.test.ts`, `currentDate.storyTime.test.ts`, `earlierScenes*.test.ts`, `earlierScenesQuery*`).
A peer session shares this checkout.

## Owner rulings, 2026-11-15 (his words)

- "So if an scene for example might have something like {...., date, dateDelta}, we don't have to rename it for
  every fucking different row type. The variable layouts should be per parent object/array"
- "Context/variable layouts are what determine how/where it's printed."
- "The context template and variable layouts decide how to represent the data, nothing should be handed down
  flat. A custom node could flatten data, but it should be highly discouraged in the documentation, and if that
  new shape is trying to use an existing variable layout, it should be flagged as a missmatch, and refused at the
  configuration layer if an object is will cause an exception on execution during template rendering."
- "Break existing custom layouts, we are in pre-release, we don't care."
- Standing (CLAUDE.md P1): every automatic action shows its cause; no magic in core for pipeline data (core
  supplies values and helpers; a layout prints). ★6 (2026-11-10): a layout is the author's markup.

## What is already built (rebuilt SDK dist, 21:25)

- SDK (`@serene-pub/sdk`): types `StoryDateValue` `{ year: {number, name?}, month: {…}|null, day: {…}|null,
  time: {hour, minute}|null }`, `StoryDateDelta` `{ sign: -1|0|1, year, month|null, day|null, time|null }`;
  constants `FORMAT_DATE_HELPER = 'formatDate'`, `FORMAT_DATE_DELTA_HELPER = 'formatDateDelta'` (beside
  `VARIABLE_LAYOUT_HELPER`); `STORY_DATE_FIELD`, `STORY_DATE_DELTA_FIELD`.
  `core:var/history@1` scope is now ONE root: `history: list of { date?, dateDelta?, content }` (the
  `relativeDate` root is gone). `core:var/earlier-scenes@1` rows: `{ name, summary, date?, dateDelta? }`.
  `core:var/current-date@1`: `currentDate` is a `StoryDateValue` (no flat `year`/`label` fields any more).
  New `core:var/story-calendar@1` (`varStoryCalendar`), key `storyCalendar`: `{ months: [{name, days}],
  weekdays?: string[], firstWeekday?, yearLabel?, leap?: {every, month}, eras?: [{name, start?, backwards?}] }`.
  Assemble's contract renders `storyCalendar` too (w5 produces the value).
- App: `src/lib/shared/lorebooks/storyDateText.ts` exports `storyDateText(value: unknown): string` (what
  `formatDate` prints) and `storyDateDeltaText(delta: unknown): string` (what `formatDateDelta` prints); both
  return `""` for null or a wrong shape. `storyDate.ts` exports `storyDateValueOf(time, calendar)`.

## Goal

### 1. Two helpers, both engines

- `src/lib/shared/utils/contextHandlebarsHelpers.ts`: register `FORMAT_DATE_HELPER` → `storyDateText(v)` and
  `FORMAT_DATE_DELTA_HELPER` → `storyDateDeltaText(v)`, guarded `if (!handlebars.helpers.x)` like the rest, with a
  doc comment each. Return **plain strings** (not SafeString) so they work as subexpression arguments
  (`(formatDate date)` into `jsonValue`); layouts print them with the triple stash.
- `src/lib/shared/utils/contextLiquid.ts`: the same two as **filters** (`{{ date | formatDate }}`), following the
  file's existing filter registration (read it; `pad` / `jsonValue` are there).
- `src/lib/shared/utils/templateCheckOptions.ts` (or wherever core hands its helper and filter names to the SDK
  checker — grep `pad` / `strokeList` there): add both names, so neither the editor nor a save reports them as an
  unknown helper / filter. Grep for any other list of core helper names (e.g. completions in
  `contextConfigCards.ts`) and add them there too, with a one-line description if the list carries one.

### 2. Shipped layouts and their floors — `src/lib/server/pipelines/entities/variableLayouts.ts`

Every content source must equal its in-code floor byte for byte for every value of the declared shape
(`variableTemplates.parity.test.ts`). Names keep: History *JSON* / *Titled JSON block*, Earlier scenes *JSON* /
*Titled JSON block*, Current date *Numeric* / *Sentence*.

- **History** (`core:var/history@1`), replacing `historyEntries` / `historyJson` / `RELATIVE_DATE_ROOT`:
  ```
  {
    {{~#each history~}}
      "{{{formatDate date}}}{{#if dateDelta}} ({{{formatDateDelta dateDelta}}}){{/if}}":{{{jsonValue content indent=0}}}{{#unless @last}},{{/unless}}
    {{~/each~}}
  }
  ```
  Floor: `""` when the value is not a non-empty array (the absence rule: a heading must not print over an empty
  list); else `{` + rows joined by `,` + `}`, each row `"${storyDateText(r.date)}${r.dateDelta ? ` (${storyDateDeltaText(r.dateDelta)})` : ""}":${JSON.stringify(r.content) ?? ""}`.
  The date text sits inside literal quotes unescaped, exactly as the source writes it: say in the comment that a
  calendar name holding `"` or `\` prints as written (the floor and the layout agree), and that two rows on one
  date are two keys (a list keeps both; the `(2)` suffix belonged to the keyed record).
- **Earlier scenes** (`core:var/earlier-scenes@1`): `name` and `summary` as today, plus the delta as its own
  member between them when present:
  ```
  [
    {{~#each earlierScenes~}}
      {"name":{{{jsonValue name indent=0}}}{{#if dateDelta}},"dateDelta":"{{{formatDateDelta dateDelta}}}"{{/if}},"summary":{{{jsonValue summary indent=0}~}}
      }{{#unless @last}},{{/unless}}
    {{~/each~}}
  ]
  ```
  Floor: `JSON.stringify(v.map(s => ({ name: s.name, ...(s.dateDelta ? { dateDelta: storyDateDeltaText(s.dateDelta) } : {}), summary: s.summary })))`,
  `""` for a non-array or empty list. `date` is not printed (an automatic scene name already carries its date);
  it is there for a custom layout — say so in the comment.
- **Current date** (`core:var/current-date@1`): must print **byte-identically** to today for the same date:
  ```
  {{#if currentDate.year.name~}}
    {{{formatDate currentDate}}}
  {{~else~}}
    {{{currentDate.year.number}}}
    {{~#if currentDate.month}}-{{{pad currentDate.month.number 2}}}{{/if}}
    {{~#if currentDate.day}}-{{{pad currentDate.day.number 2}}}{{/if}}
    {{~#if currentDate.time}} {{{pad currentDate.time.hour 2}}}:{{{pad currentDate.time.minute 2}}}{{/if}}
  {{~/if}}
  ```
  (the year alone prints the bare number here, as today; `formatDate`'s `Year N` is for rows). Floor
  `asCurrentDate` rewritten to the same rule. Keep the *Sentence* wrapper.
- **Story calendar** (`core:var/story-calendar@1`, key `storyCalendar`, new): one content row named **Parts**,
  explicit, no wrapper, its own floor. One line per part present, joined by `\n`, nothing after the last:
  `Months: Thaw (30 days), Bloom (31 days)` · `Weekdays: Moonday, Tirsday` (only with weekdays) ·
  `Leap day: every 4 years, in month 2` (only with `leap`) · `Eras: BR, counting down; AR from year 1` (only with
  eras; each era `name`, then ` from year <start>` when `start` is set, then `, counting down` when `backwards`;
  eras joined by `; `). Write the Handlebars source and the floor so they agree for the SDK sample and for a
  calendar with only months.

### 3. The render-time scope guard — `renderVariable` in the same file

Signature becomes `renderVariable(layouts, key, value, run?, report?: (line: string) => void)` — the `siblings`
parameter is removed (w5 passes `report` from Assemble and puts the line on the run's receipt notes).
**First thing** after resolving `variableId`, before the absence rule: when the variable is registered
(`getVariable`) and its root's declaration (`scopeRootFor(variableId, key)` → `decl.scope[root]`) is a typed
`VarField` (not `'any'`, not a `string[]`), and `value != null`, and the value's kind does not fit the root's
`type` (`list` ↔ `Array.isArray`; `record` / `object` ↔ a non-array non-null object; `string` / `number` /
`boolean` ↔ `typeof`), then: call `report?.(line)` and return the generic floor (`asMinifiedJson` for an
object, `asWritten` otherwise) — never the layout and never the variable's shape-specific `codeDefault`.
Check the ROOT KIND ONLY: a full `checkValue` would refuse rows that carry extra fields, which open rows do.
The line (🚧 copy): `layout: '<key>' (<variableId>) was handed <a string|a number|a list|an object|…> where its variable declares <a list|…>, so it was written out as it came, without a layout. The step that produced it should hand down the declared shape.`
Remove `siblings` from `ShippedVariableTemplate.codeDefault`, `VariableDefinition.content.render`, the floor
call and the layout render's `variables` (back to `{ [scopeRootFor(variableId, key)]: value }`), and
`prepareExplicitLayouts`' `siblingsOf` input. Keep `scopeRootFor`'s behaviour; fix its comment (no siblings).
`src/lib/server/pipelines/prompt/templateContext.ts` (~343–350) calls `renderVariable` for the builder's keys:
pass a `report` that lands on that step's receipt if the builder already has a notes/receipt channel (read the
file); if it has none, pass nothing and say so in your report.

### 4. Sibling roots removed elsewhere

`src/lib/server/pipelines/prompt/preview.ts` (~150–181), `src/lib/server/pipelines/config/variableLayoutsView.ts`
(~668–698), `src/lib/shared/utils/contextConfigCards.ts` (~386–391): undo the sibling-root handling `time-t7c`
added (read `git show HEAD:<path>` to see each before it; restore only those lines' behaviour: every scope root
a key of its own in the preview loop and in `KNOWN_TOP_LEVEL_FIELDS`, as before). Inventory every remaining
reference to `siblings` / `siblingsOf` / `RELATIVE_DATE_ROOT` in `src/` (outside assemble.ts, which w5 owns)
and remove them.

### 5. The layout check at save sees the typed scope

`src/lib/server/sockets/pipelines.ts` `validateTemplateDraft` (~1641–1649): for `kind === 'variable'` pass the
variable's typed `decl.scope` instead of `Object.keys(decl.scope)`, so a save warns on an unknown field the
same way the editor already does (the editor passes `variable.scope`). Warnings only, never a refusal. Add a
test that every SHIPPED layout row checks with zero warnings and no error against its variable's typed scope
(both engines where a Liquid twin exists), and that a layout written for the old keyed History
(`{{#each history}}{{{jsonValue @key indent=0}}}:{{{jsonValue this indent=0}}}{{/each}}`) still saves (no error).

### 6. Liquid twins and tests

- `src/lib/server/pipelines/prompt/liquidParity.fixtures.ts`: the Liquid twins of the changed shipped sources
  (History, Earlier scenes, Current date, Story calendar) using the two filters; `liquidParity.test.ts` must hold.
- `entities/variableTemplates.parity.test.ts`, `entities/variableTemplates.int.test.ts` (it asserts the shipped
  History source contains `relativeDate`: it now contains `formatDate`; the boot refresh test — a second boot
  changes nothing, an admin's copy keeps its text — must still pass), `contextConfigCards*.test.ts`,
  `config/variableLayouts*.test.ts`, the preview tests, any test calling `renderVariable` / `codeDefault` /
  `prepareExplicitLayouts` with siblings, `templateVariableShelves.test.ts` (place `storyCalendar` on the shelf
  its neighbours `currentDate` use, if the shelves list keys), client `templateVariableLayouts.test.ts` /
  `stepVariableLayouts.dom.test.ts` if they read the History shape.
- New tests: the current-date layout prints byte-identically to the old floor for: year only, year-month, full,
  with a time, and under a calendar with names (compare against `formatStoryTime(date, calendar)` for the named
  case and the old numeric rule for the rest); History and Earlier scenes print the same date text as before plus
  the delta (`412-03-03 (-0y 0m 2d)`), and a row with `dateDelta: null` prints the bare date; `{{formatDate date}}`
  and `{{ date | formatDate }}` render the same in both engines; the scope guard: a flat string handed to
  `history` renders as written (not through the layout) and `report` gets the line, a correctly shaped value
  reports nothing, an `'any'`-scoped plugin variable is never guarded; an old-shape History layout renders
  without throwing (it prints wrong, by design).

## Files owned (only these)

`src/lib/shared/utils/contextHandlebarsHelpers.ts`, `src/lib/shared/utils/contextLiquid.ts`,
`src/lib/shared/utils/templateCheckOptions.ts`, `src/lib/shared/utils/contextConfigCards.ts`,
`src/lib/server/pipelines/entities/variableLayouts.ts`, `src/lib/server/pipelines/prompt/templateContext.ts`,
`src/lib/server/pipelines/prompt/preview.ts`, `src/lib/server/pipelines/prompt/liquidParity.fixtures.ts`,
`src/lib/server/pipelines/config/variableLayoutsView.ts`, `src/lib/server/sockets/pipelines.ts` (only
`validateTemplateDraft`), `src/lib/shared/utils/templateVariableShelves.ts` if it needs the new key, and the
tests named in §6 (plus new test files you add beside them).

## Out of scope

`assemble.ts`, `bindings.ts`, `earlierScenes.ts` and their tests (w5). The SDK. Docs and NOMENCLATURE (a later
worker). New SDK checker warnings (a later worker). Any other variable's layout. Any migration or boot pass. Any
new exported name beyond what the brief states (internal helpers are yours to name).

## Stop and ask when

Removing the sibling handling would change a variable other than History; the typed scope at save would turn
any warning into a refusal or flag a shipped row you cannot fix inside the brief; the current-date layout cannot
be made byte-identical; a shipped row would need a stored-data rewrite.

## Done means

From the app root, strictly one run at a time (check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`
first; if one is running, do other work and check again — never start a second; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7d-w3.log 2>&1"`
over every test file you touched or that imports a file you touched in `entities/variableLayouts*`,
`entities/variableTemplates*`, `prompt/liquidParity*`, `prompt/preview*`, `config/variableLayouts*`,
`shared/utils/contextConfigCards*`, `shared/utils/templateValidation*`, `shared/utils/handlebarsLint*`,
`sockets/pipelinesVariableLayouts*`. Tests that render a whole prompt through `assemble.ts` will fail until w5
lands: list them, don't fix them. Report: changed files, names added/removed, tests run with counts, failures you
attribute to w5's pending work (with the reason), and anything not done.
