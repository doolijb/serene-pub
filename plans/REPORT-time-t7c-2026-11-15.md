# REPORT — lane `time-t7c` (2026-11-15): BUILT. A History day says how far it is from the story's now

Saved by the lead from the supervisor's report, with the lead's fixes at the end.

## How the value reaches the layout

- Assemble computes it (`relativeDatesOf`, beside `currentDateOf`, `pipelines/prompt/assemble.ts`) from the same
  `templateContext.storyTime.now` and calendar the prompt already prints. No host edit, no new `meta` key, no
  query. Nothing when there is no story time, `now` is null (Timeline off), `now.from === "history"` (no clock
  set), or `history` is re-pointed or not ordered.
- Keys match `history` exactly (new `orderedEntries`, which `objectByRole` uses too). It travels as a sibling
  root `{ relativeDate }` through `renderVariable`'s new `siblings` argument, the floor
  `codeDefault(value, siblings)` and the explicit-layout pre-pass (`siblingsOf`). The `history` record's shape is
  unchanged. Nothing reads `decayRate`.
- The shipped History layout writes the words:
  `{{#if (lookup ../relativeDate @key)}}"{{{@key}}} ({{{lookup ../relativeDate @key}}})"{{else}}{{{jsonValue @key indent=0}}}{{/if}}`.
  No helper added. A test checks the words never carry a calendar's names.
- `scopeRootFor` returns the first root when the key is not in the variable's scope.
- SDK: `core:var/history@1` declares 🚧 `relativeDate` (optional string record; the sample covers both roots).

## Rendered (shipped row, clock at 412-03-05)

`{"412-03-03 (2 days ago)":"…"}` · `{"412-03-07 (in 2 days)":"…"}` · `{"412-03-05":"…"}` ·
`"Year 409 (3 years ago)"`.

## Changed files

App: `src/lib/shared/lorebooks/storySpan.ts` + test (replacing `lastTrue.ts`), `pipelines/prompt/assemble.ts`,
`pipelines/entities/variableLayouts.ts`, new `pipelines/prompt/relativeDate.test.ts`,
`entities/variableTemplates.parity.test.ts`, `entities/variableTemplates.int.test.ts`,
`client/lorebooks/time/BeginningDecayRow.svelte`, `docs/context-templates.md`, `docs/lorebook-time.md`,
`NOMENCLATURE.md`. SDK: `sdk/src/variables.ts` (varHistory), `guides/time.md`. Not touched: `host.ts`,
`seedVariableTemplates.ts` (the shipped row refreshes once; a second boot changes nothing; an admin's copy keeps
its text: tested).

## Verification (lane's)

`sdk:build` 2026-11-15 13:08. `storySpan.test` 64/64; 22 files 757/757; 6 int files 67/67; re-run 455/455.
`tsc` 0; `npm run check` 0 errors. `sdk:test` 4737/4742 (the known four; no hash moved). No prompt pin moved.

## Open ★

- ★T7C-1 placement: in the key (the only spot reachable without a join helper; measurement 3b: key and value
  start did about the same).
- ★T7C-2 the name `relativeDate`.
- ★T7C-3 Decay help: *A pipeline can use this to rank the entry lower in recall; core does not.*
- ★T7C-4 the docs text.
- ★T7C-5 free-form books: see the lead's fix below (a bound, not nothing).
- ★T7C-6 dated lore entries showing a distance too: not built.
- ★T7B-5 stands: a History day uses its own date.

## Noticed, not done

- `config/variableLayoutsView.ts` ~687: the row preview passes no siblings, so the History layout page previews
  without the distance.
- `prompt/preview.ts` ~150 iterates every scope key (a top-level `relativeDate` would preview laid out as
  history); `contextConfigCards.ts` ~388 `KNOWN_TOP_LEVEL_FIELDS` accepts `relativeDate` as a template name.
- varHistory's description says "from the chat". INTEGRATING.md has no line about sibling roots.
- Process slip: a worker ran `prettier --write` on four files and rebuilt them from HEAD plus its own edits; the
  two source files were checked by line count, the two `variableTemplates` tests only by the worker's word.

## Lead fixes (2026-11-15)

- **Free-form books give a bound instead of nothing.** The lane's rule left roughly half the History days older
  than a month with no distance in a default book. Where a finer part runs backwards across a boundary, the true
  span lies between n − 1 and n, so the words are *under 1 year ago* (n = 1) or *over 2 years ago* (n = 3);
  future: *in under 1 month*. `StorySpan.bound`; tests and both docs updated. 🚧 copy.
- Removed the unused `lastTrueDate` and its tests (it belonged to the withdrawn Decay-tied delta).
- `BulkTimeDialog.svelte`: the Decay help matches the entry row's.
- After the fixes: `storySpan`, `relativeDate`, `variableTemplates.parity`: 434 pass.

## Scope review and second lead fixes (2026-11-15)

Scope review: in scope; no sign a worker's `prettier --write` lost anyone's work; three findings, all fixed.

- **The lead's own bound was wrong** when years differ, the month runs forward and the day backwards (Year 7
  month 3 day 20 to Year 8 month 5 day 5 printed *under 1 year ago*). A backward day makes the year count
  uncertain only when the months are equal; fixed, two rows added.
- **The second root leaked into template vocabulary and previews.** History is the only variable with two
  roots. Now the first root is the value and the rest are siblings everywhere: the context-template linter and
  completions no longer accept `{{relativeDate}}` (`shared/utils/contextConfigCards.ts`); the context preview
  renders History with its sibling and no key of its own (`pipelines/prompt/preview.ts`); the layout row preview
  shows the distance (`pipelines/config/variableLayoutsView.ts`). The vocabulary test follows.
- `BulkTimeDialog.svelte`'s Decay help is ruled together with ★T7C-3.

After the fixes: `storySpan`, `pipelines/prompt`, `config/variableLayouts*`, `contextConfigCards*`,
`variableTemplates.parity`: 49 files, 1,015 pass, 2 skipped; `tsc` 0 errors.

## Grouped verification and a format measurement (2026-11-15, late)

Full vitest `plans/lead-full6.log`: 2,507 files, 21 failed, all standing baseline (none new). `npm run build`
green after one docs fix (a 🚧 in a linked heading broke its id). `npm run check` 0 errors.

Measurement 6 (`plans/measurements/m6-delta-format.py`, one three-year-old event in the History shape with the
present printed as `10-04-12`, 20 replies per variant; "still" = acts as if it just happened / mentions time
passing):

| Variant | 12B | 24B |
|---|---|---|
| `7-04-12` | 2 / 5 | 1 / 15 |
| `7-04-12 (3 years ago)` | 1 / 8 | 4 / 16 |
| `7-04-12 (-3-00-00)` | 5 / 4 | 2 / 13 |
| `7-04-12 (-3y 0m 0d)` | 6 / 2 | 4 / 14 |

No format clearly wins at this size, and the bare date already does well here because the present is printed
in the same format beside it (unlike measurement 3, where the undated fact had no date at all). The delta's
format for History is therefore a matter of preference, not of measured fidelity.
