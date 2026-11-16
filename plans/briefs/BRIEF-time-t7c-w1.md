# BRIEF — worker `time-t7c-w1`: a History day's distance from the story's now, in the prompt

Repo: `/home/jody/github/serene-pub` (run everything from here, absolute paths). Supervisor: lane `time-t7c`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need `sdk:build`: the supervisor already built the SDK with the change below. Do not edit the SDK.)

Also: never `git checkout` / `restore` in either repo; never `kill -9`; another session shares this checkout, so edit only the files listed under Files owned; no other product's name in any file; it is a *session*, never a *chat*; never write "no lorebook".

## Goal

A History day in the prompt says how far it is from the story's now: `"412-03-03 (2 days ago)"`, `"412-03-07 (in 2 days)"`. Computed in Assemble from data it already holds, handed to the History variable layout as a **sibling root** `relativeDate` (a record keyed exactly like `history`), and written by the shipped History layout as literal text around a lookup. **History only.** With no story clock set (or the Timeline off, or no book), every prompt is **byte-identical** to before.

## Rulings to honour (quoted)

- Owner 2026-11-15: "decay is an arbitrary multiplier against recal rank, never a fucking value we include in the context, at least not in core." **Nothing you write reads `decayRate`.**
- Owner 2026-11-15: "The time detla isn't complicated. All we have to do is update our context templates/variable layouts. Arguable showing the time delta (2 days ago, or 2 days in the future (if the character is a time traveler)) is more important than the precice date".
- Owner 2026-09-30: "No magic in core … appended in-pipeline or logically inserted in the template": the host or Assemble never joins the words into an entry's text or key. The words are joined **by the layout**.
- "0.6 is in users' hands": **the `history` record's value shape does not change** (saved layouts read it). The delta travels as a separate root.
- P1: story time only, never the wall clock. Same inputs, same result.
- A layout an admin has made (a duplicate, no `seedKey`) is left alone; it shows no delta until its author adds it.
- No new template helper (`concat` is dropped). If you find a join helper unavoidable, **stop and report**; do not add one.
- Comments state the rule, not the story.

## Already done by the supervisor (do not redo)

SDK `core:var/history@1` (`../serene-pub-sdk/sdk/src/variables.ts` ~477) now declares two scope roots, value first: `history` (unchanged) and 🚧 `relativeDate: { type: 'record', of: { type: 'string' }, optional: true }`; its `sample` is `{ history: {...}, relativeDate: { 'Year 412, Month 1': '2 months ago' } }`. The SDK dist is built.

## Files owned (edit only these)

- `src/lib/shared/lorebooks/lastTrue.ts` and `lastTrue.test.ts` → **renamed** to `src/lib/shared/lorebooks/storySpan.ts` and `storySpan.test.ts` (write the new files, then `rm` the two old ones by exact path; they are untracked, no git command). Nothing else imports them (verify with grep).
- `src/lib/server/pipelines/prompt/assemble.ts`
- `src/lib/server/pipelines/entities/variableLayouts.ts`
- New test `src/lib/server/pipelines/prompt/relativeDate.test.ts`
- `src/lib/server/pipelines/entities/variableTemplates.parity.test.ts` (add cases)
- The seed test that covers `seedVariableTemplates` (find it: probably `variableTemplates.int.test.ts`) — add assertions only.
- Prompt pin tests listed under "Tests", **only** where a pin shows History with a story clock set.

Readable: anything. **Not** owned (report needed changes, never edit): `runtime/host.ts`, `prompt/preview.ts`, `config/variableLayoutsView.ts`, `shared/utils/contextConfigCards.ts`, `shared/utils/templateVariableShelves.ts`, any `.svelte`, docs, NOMENCLATURE, the SDK.

## Build

### 1. `storySpan.ts` (from `lastTrue.ts`)

Keep `storySpanBetween`, `storySpanWords`, `lastTrueDate` and `StorySpan` as they are, except:

- **Free-form says nothing rather than something wrong.** With no calendar, when a finer part that both dates carry runs backwards (later's part < earlier's part) while a coarser part differs, return `null` (the true span cannot be known without borrowing). Year 7 month 11 → Year 8 month 2: null (was *1 year*). Year 7 m3 d20 → Year 7 m5 d10: null. Year 7 m11 → Year 9 m2: null. Year 7 m3 → Year 9 m5: *2 years* (finer part forward: the floor is right). Same year and month, days differ: days, as before. A declared calendar borrows exactly as now.
- Add **`relativeDateWords(date, now, calendar): string | null`**: date before now → `"<n> <unit> ago"` (`2 days ago`, `1 year ago`); date after now → `"in <n> <unit>"` (`in 2 days`); a clock moved back before the date is simply a future date. Null under a day, when either has no year, when compared parts are equal, or when the span is unknown (the free-form rule). Implement as `storySpanWords(date, now)` else `storySpanWords(now, date)`; words come from `clockSpanWords` (already `"<n> <unit>"`, singular at 1).
- Header comment: the span rule (both directions, free-form null rule), the relative-date rule. `lastTrueDate` keeps its own doc; note in one line that nothing calls it.

Tests (`storySpan.test.ts`): keep the existing rows; change the free-form rows that now return null (list them in your report); add rows: future in each unit; clock moved back; free-form backwards rows above; a declared calendar across a month and a leap day in the future direction; equal dates; year-only against a full date (same year → null). Plus: **the words never carry a calendar's names** — over a calendar whose month names and year label contain `"`, `\`, `}` and an era, every output of `relativeDateWords` across a grid of dates matches `/^(in )?\d+ (years?|months?|days?)( ago)?$/`.

### 2. `assemble.ts`

- Extract from `objectByRole`'s ordered branch (~231–236) an internal `orderedEntries(allocations, order): Array<[string, Allocation]>` — same sort (`sortByOrder`), same blank-after-trim skip, same `distinctKey`/`orderKeyOf` keys. `objectByRole` uses it; its output must stay byte-identical.
- New `relativeDatesOf(allocations, roles, storyTime): Record<string, string> | undefined`, placed beside `currentDateOf` (~329) so it reads the same now the prompt prints. Undefined when: `roles` has no `order` or has a `title`; no story time; `storyTime.now` absent or null (Timeline off, no book); **`now.from === "history"`** (no clock set: `state/storyTime.ts` ~76–89 — `"clock"` and `"session"` count). Otherwise, for each `[key, a]` of `orderedEntries`, `relativeDateWords({ year, month, day } from a.meta, { year: now.year, month: now.month ?? null, day: now.day ?? null }, storyTime.calendar ?? null)`; set `out[key]` when non-null. Undefined when `out` is empty. The calendar and now are already on `templateContext.storyTime` (built in host ~6290): **no host edit, no new `meta` key, no query.**
- In `render` (~765–812): compute `historyRoles` (move the existing expression above the band loop, reuse it for `currentDate`) and `relativeDate` before the loop. The `layout` closure becomes `(key, value, siblings?)`: it records `siblings` in a `siblingsByKey` Map next to `rawByKey`, and calls `renderVariable(input.variables, key, value, input, siblings)`. `bandValue`'s `opts` gains `siblings?: Record<string, unknown>`, passed to `layout` on the record paths; the loop passes `{ relativeDate }` for key `"history"` only, and only when defined.
- `prepareExplicitLayouts` (~953) gets `siblingsOf: (key) => siblingsByKey.get(key)` so a template naming another History layout gets the sibling too.

### 3. `variableLayouts.ts`

- `renderVariable(layouts, key, value, run?, siblings?)`: render with `variables: { ...siblings, [scopeRootFor(variableId, key)]: value }` (the root wins); the floor is `shipped.codeDefault(value, siblings)`. The absence rules read `value` only, unchanged.
- `VariableDefinition.content.render` and `ShippedVariableTemplate.codeDefault` take an optional second argument `siblings?: Record<string, unknown>`; the wrapped `codeDefault` (~962) passes it to `content.render`.
- The history definition (~786): its content `source` becomes a history-only builder (world lore and docs excerpts keep `recordEntries` unchanged):

  ```
  {
    {{~#each history~}}
      {{#if (lookup ../relativeDate @key)}}"{{{@key}}} ({{{lookup ../relativeDate @key}}})"{{else}}{{{jsonValue @key indent=0}}}{{/if}}:{{{jsonValue this indent=0}}}{{#unless @last}},{{/unless}}
    {{~/each~}}
  }
  ```

  The key is written unescaped inside literal quotes only when a delta exists. That is safe because History keys with a delta are made by core (`orderKeyOf` ~290: digits, `-`, `Year`/part names, ` (n)`) and the words are `"<n> <unit>"` — **prove it in a test** (see Tests). Its `render` becomes a function that, given `siblings.relativeDate` as a record, returns `JSON.stringify` of the record with each key `K` that has words `W` renamed to `` `${K} (${W})` ``, order kept; else exactly `asMinifiedJson(value)`. The parity test must show source and floor identical.
- `scopeRootFor` (~1190): when the key is not in the scope, return the **first** root (the value root; same rule as `rootOf` in `config/variableLayoutsView.ts` ~168), not only when there is exactly one. Comment the rule.
- `prepareExplicitLayouts` input gains optional `siblingsOf?: (key: string) => Record<string, unknown> | undefined`, passed to its `renderVariable` call (~1521).
- The sibling's name: one exported constant (e.g. `RELATIVE_DATE_ROOT = "relativeDate"`) used by assemble and the floor; report the name you chose.
- The shipped rows refresh on boot while unedited (`boot/seedVariableTemplates.ts` ~108–150, keyed on `seedKey`; immutable rows): no seed change should be needed. Verify.

## Tests

Run each in this capped form from the app root, **strictly one vitest run at a time** (first check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` is empty; wait if not), never piped into `head`:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7c-w1-<n>.log 2>&1"` then read the log's tail.

An int test that opens a DB inside an `it` needs a 60 s timeout under load.

Write:

1. `storySpan.test.ts` (above).
2. `prompt/relativeDate.test.ts` — through `render`/`allocate` (model: `prompt/currentDate.storyTime.test.ts`), both with **no layouts** (the floor) and with the **shipped History row** selected (`variables: { history: { variableId: "core:var/history@1", engine: CORE_TEMPLATE_ENGINE, source: <shipped wrapped row's source> } }`), template `{{{history}}}`:
   - a past day with a clock set: `"412-03-03 (2 days ago)"`; a past year-only day: `"Year 409 (3 years ago)"`; a future day: `(in 2 days)`; a day on the clock's own date: no delta; two entries on one date (`(2)` key) each with the delta;
   - `from: "history"` (no clock), `now: null` (Timeline off), and no `storyTime` at all: output **equal to a literal of today's output** (byte-identical);
   - a free-form book where the span is unknown: no delta;
   - an admin's layout (the pre-change `recordEntries("history")` text as its own source) with a clock set: no delta, today's bytes;
   - the Liquid equivalent below, rendered through core's Liquid engine against the same values, equals the Handlebars output (past, future, none). If the text below is wrong, fix it in the test and report the corrected text verbatim (the docs quote it):

     ```
     { {%- for pair in history %}{% assign ago = relativeDate[pair[0]] %}{% if ago %}"{{ pair[0] }} ({{ ago }})"{% else %}{{ pair[0] | jsonValue: indent: 0 }}{% endif %}:{{ pair[1] | jsonValue: indent: 0 }}{% unless forloop.last %},{% endunless %}{% endfor -%} }
     ```
     (The shipped Liquid world-lore fixture, `prompt/liquidParity.fixtures.ts` ~282, shows the brace and `-` conventions; check that an empty history renders as the Handlebars one does.)
3. `variableTemplates.parity.test.ts`: the history rows (wrapped and content) with a `relativeDate` sibling: source and `codeDefault` identical.
4. The seed test: an existing install whose shipped History row holds the old source is refreshed once; **a second boot refreshes nothing**; a user's duplicate (no `seedKey`) keeps its old source.
5. Run and keep green: `src/lib/server/pipelines/prompt/assemble.test.ts`, `prompt/currentDate.storyTime.test.ts`, `prompt/characterLore*.test.ts`, `prompt/liquidParity.test.ts`, `prompt/assembleExplicitLayouts.test.ts`, `prompt/assembleSafeValues.test.ts`, `entities/variableTemplates*.test.ts`, `entities/variableAccounting.test.ts`, `entities/objectVariableLayouts.test.ts`, `measure/promptDiff.int.test.ts`, `parity/productionParity.int.test.ts`, `parity/harness*.int.test.ts`, `runtime/promptAtReading.int.test.ts`, `src/lib/shared/utils/contextConfigCards*.test.ts`, `src/lib/shared/utils/templateVariableShelves.test.ts`, and any test of `prompt/preview.ts` and `config/variableLayoutsView.ts` (find them with grep) — all under `src/lib/server/pipelines/` unless shown. Group them into as few runs as is safe (two or three runs).
   - **Update a pin only if it shows History with a story clock set** (from `clock` or `session`), and list each one with the before/after line.
   - **Stop and report** (do not "fix") if a pin moves for a session with no clock, the Timeline off or no book, or if a test outside your files fails because of the second scope root (e.g. the template preview or a lint now listing `relativeDate` as a top-level name): say which test, what it shows, and the smallest change in the non-owned file.
6. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors (not inside systemd-run is fine; not concurrently with a vitest run). Do **not** run `npm run check`; the supervisor does.
7. `npx prettier --check` on every file you changed.

## Done means / report

Write your report as your final message (the supervisor reads it): changed files; the constant's name; the rows of the helper table you changed and why; three rendered History examples exactly as the shipped layout prints them (past, future, today), wrapped; the Liquid text as verified; every pin you updated (file, line, before/after) and every test run with pass/fail counts and log path; anything you stopped on; **Noticed, not done**. Under about 600 words.
