# BRIEF — build lane `time-t7b` — a living entry says how long ago; a docs recipe for recency

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1 (Decay), §7 "Measured 2026-11-15" (3 and 3b),
`plans/briefs/BRIEF-time-t7a.md` (its LAST section only: what the cold reviews found about recall; the lane it
describes is **not** being built), `plans/REPORT-time-t2-2026-11-14.md`, `../serene-pub-sdk/INTEGRATING.md` (the
steps on prompt rendering and on what a pipeline reads about a lore entry), `docs/pipelines.md`,
`docs/lorebook-time.md` (Beginning and decay), the SDK's guides folder (how recipes are written there),
`NOMENCLATURE.md` §1, §24, §23 and the **Decay** row.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

1. **In the prompt, a living entry that is read in says how long ago it was last true**, as a plain time delta
   in story time: *(3 years ago)*, *(2 days ago)*. A **Fact** (Decay 0: every entry that exists today) says
   nothing, so no existing prompt changes.
2. **Recall is not changed.** No ranking fade is built in core. Instead the docs carry **a recipe**: how a
   pipeline author can use an entry's Decay rate and recency in their own ranking through the SDK.
3. The entry row's stopgap *Stored now; recall does not use it yet.* is replaced by what is true.

## Owner rulings (quote them in worker briefs)

- 2026-11-13: a living entry's age in the prompt: "A time delta is better I think"; the rate is "a value between
  0 and 1, core by default will use a reasonable multiplier against that. Modders can query and calculate against
  that number how ever they want, or ignore it out-right."
- 2026-11-15, asked whether to build the ranking fade (which only bites when a budget or cap binds, and never
  did on his data) or only the prompt's time delta: **"Time Delta, keep a recipe for using recency in the SDK in
  the docs"**.
- 2026-09-30: "No magic in core … appended in-pipeline or logically inserted in the template" (how anything
  reaches a prompt).
- 2026-11-11: fidelity outranks prompt-prefix reuse; "Prompts: comprehension and fidelity first".
- Standing: P1 (same inputs, same result: story time only, never the wall clock); P5 (derived from the SDK);
  "Removing or renaming a published SDK name is the owner's call" (adding an `@experimental` one for this is
  within the go; list every name).

## What was measured (do not re-measure)

Lore reaches the model as a JSON object keyed by entry name (`src/lib/server/pipelines/prompt/assemble.ts`
~226–243). In that shape, with the stale fact's **value starting** *(3 years ago)*, two local models treated it
as old in most replies (still acting on it: 6 and 5 of 20, against 16 and 13 with no date); putting it in the
key did about the same; a bare date (*as of Year 7*) did worse. **Use the value, not the key** (the key is how
other text refers to the entry). Story time only: a delta in rounds was never asked for and would change the
text every round.

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. How a lore entry becomes prompt text today, end to end: the host's read of the entry
   (`pipelines/runtime/host.ts`, `utils/lorebookEntries.ts` `toEntryRow`, which carries `decayRate`), the shape
   a pipeline receives, and which code builds the JSON (`prompt/assemble.ts`): app code, an SDK-declared node, or
   a template in `core-catalog`. **Where can a per-entry delta be added so that it is "appended in-pipeline or
   logically inserted in the template", never silently by the host?** Name the smallest honest place: for
   example a field the host hands each lore row (🚧 `since`: the story duration in words, or the two dates) that
   core's own render step prepends to the value when present.
2. The two dates a delta needs: the reading's moment (the session's story clock) and "when this entry was last
   true": the date of the newest version of the entry the reading sees (its newest dated version in force, else
   its Beginning). An entry with neither (perpetual, no dated version) has no delta. How a story duration is
   computed through the lorebook's calendar (`storyDayIndex`, `../serene-pub-sdk/sdk/src/storyTime.ts` ~440) and
   an existing words helper (`clockSpanWords`, `src/lib/shared/lorebooks/storyDate.ts` ~67).
3. What a pipeline author can already read about an entry in ranking (`decayRate`? the last-referenced signal
   `lastRefRecency` / `signalLastRefRecency`, `../serene-pub-sdk/contracts/src/tasks.ts` ~544–558; custom
   scoring hooks, scripts at seams): enough to write the recipe truthfully. If the rate is not reachable from a
   pipeline today, say what the smallest additive exposure is.
4. The tests that pin rendered prompts (`promptDiff`, goldens, budgets).

### B. The delta

- One pure function with a table of tests: two story dates and a calendar → words, coarsest unit that is at
  least 1 (*3 years ago*, *5 months ago*, *2 days ago*); nothing under one day; nothing for a negative gap (a
  clock moved back); nothing when either date is missing.
- Shown only for an entry whose Decay is above 0, only with the lorebook's Timeline on and a story clock set.
- It reaches the prompt the way inventory item 1 finds honest. The rendered value reads
  `"(3 years ago) ‹the entry's text›"`. Show three rendered examples in the report (a living entry with a delta,
  a living entry with none, a Fact).
- The run's receipt / prompt preview shows it as rendered: nothing hidden.
- Prefix reuse: a delta changes only when its coarsest unit changes; say in the docs that a living entry's text
  can change as story time passes.

### C. The recipe (docs, in the SDK's guides and linked from `docs/pipelines.md`)

A short, working recipe titled for what it does (*Make living entries fade in recall*): what Decay is (a number
0–1 on an entry, 0 = Fact; core shows a time delta for living entries and does **not** rank by it); what a
pipeline can read; one concrete way to use it (for example scale the **Recently referenced** signal for living
entries, with a floor), with the caveats the reviews found stated plainly: the signal exists only for entries
with keywords and looks at the last 100 messages; a score change matters only when a budget or a per-type cap is
reached; a pipeline that wants none of it sets the weight to 0. The code in it must be checked by a test (the
SDK's guides have a vocabulary test and may have a snippets test: follow whatever the guides folder requires).
No other product's name.

### D. The row, docs, names

`src/lib/client/lorebooks/time/BeginningDecayRow.svelte`: the Decay help becomes *A living entry tells the
model how long ago it was last true; recall is unchanged.* 🚧 (one sentence). `docs/lorebook-time.md` (Beginning
and decay: the delta, one example, what Decay does not do, the link to the recipe). `NOMENCLATURE.md`: the
**Decay** row (charter: it owns the rate and the delta in the prompt; it does not rank; a pipeline may, see the
recipe), §25 for every new name.

## Files owned

App: the lore read where the delta's dates are gathered (smallest edit in `pipelines/runtime/host.ts` or the
entry reader), `src/lib/server/pipelines/prompt/` (if the render is app-side), a new pure helper under
`src/lib/shared/lorebooks/`, `BeginningDecayRow.svelte`, tests, the two docs, `NOMENCLATURE.md`. SDK: only what
inventory item 1 shows is needed (a field's declaration and core-catalog's render step, each `@experimental`),
the guide page for the recipe, the SDK tests they require.

## Out of scope

Any change to ranking, weights, budgets or `rank-semantic`; a rounds delta; a hint like "may have changed"; a
setting; defaults per entry type (`time-t5b`); cast members.

## Stop and ask when

CLAUDE.md §Decisions applies; the delta cannot reach the prompt without the host rewriting text behind the
pipeline's back; a Fact's rendered text would change; more than one new published name is needed for the delta
(then report the alternatives); a prompt golden that is not about living entries moves.

## Done means

- SDK (if edited): `npm run sdk:build` from the app root (after checking no serene-pub dev server and no vitest
  run are up), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t7b-sdk.log 2>&1"`:
  only the four known failures (`deriveDontSpell` ×2, `surface` untagged exports, `vocabulary` in
  `your-first-plugin.md`); if your guide page trips the vocabulary test, fix the page.
- App tests (targeted, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7b-<name>.log 2>&1"`,
  one at a time, checking for a running vitest first): the delta's table; a rendered prompt for a living entry, a
  Fact (byte-identical to before this lane), Timeline off, no clock, a clock moved back; all of
  `src/lib/server/pipelines/prompt` and the prompt goldens.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t7b-<date>.md`): the inventory with
file:line; how the delta reaches the prompt and why that is the honest place; three rendered examples; the
recipe's text; changed files in both repos; when you ran `sdk:build`; tests with results; every name and
sentence; open ★; **Noticed, not done**. Under about 800 words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

1. **Where the delta goes: data on the allocation, words in the shipped layouts. Never prepended by the host or
   the assembler.** The 2026-09-30 ruling's rule of application is "add a visible node/step in the spec or a
   template variable … Never make the host or assembler silently merge", and the owner's 2026-11-13 words are
   "Modders can … ignore it out-right". So the suggestion in Build A.1 (a field "that core's own render step
   prepends to the value") is **withdrawn**: `objectByRole` (`prompt/assemble.ts` ~226–243) is app code that runs
   before any template.
   - Carry the delta as data beside the entry, the way history's date parts already ride on the allocation's
     `meta` (`assemble.ts` ~93–99).
   - Render it in the **shipped** variable layouts for world lore and for character lore
     (`pipelines/entities/variableLayouts.ts` ~335–344, ~703 `recordEntries("worldLore")`), through a helper or a
     value beside the record. A layout an admin has changed keeps what it says: it shows no delta until its
     author adds it, and the docs say how. **Do not change the shape of the record's value** (saved layouts of
     0.6 users read it).
   - Character lore reaches the prompt by another path (the `anchor` role:
     `../serene-pub-sdk/core-catalog/src/registry/entries.ts` ~166, `assemble.ts` ~1296 `anchoredEntriesOf`):
     cover it, or say plainly in the report that living character lore gets no delta yet and why.
   - Budget: a candidate's tokens are counted once before selection (`ranking/select.ts` ~113, `assemble.ts`
     ~145). Count the delta's words in the candidate, or show that the layout's own accounting covers them.
   - **Stop and ask** (replacing the brief's narrower one) if the delta can reach the prompt only by the host or
     the assembler rewriting an entry's text, or only by changing the record's value shape.
2. **The delta's arithmetic must work without a calendar.** A book starts free-form (`docs/lorebook-time.md`
   ~159: months can pass 12, nothing rolls over) and a Beginning may be a year alone. `storyDayIndex` needs a
   calendar and a full date, so it is used only when the book declares one. The rule: compare the two dates part
   by part down to the finest part **both** carry; with a declared calendar, borrow across parts as the calendar
   says; free-form, report the coarsest part that differs (*3 years ago*; same year, months differ: *5 months
   ago*) and never borrow. Table rows: free-form; year only against a full date; year and month; a declared
   calendar with odd month lengths; a leap day; equal dates; a clock moved back.
3. **"Last true" is defined.** It is the date of the newest version in force on the reading that **sets the
   entry's content** (or one of its type's declared fields); a version that only renames, re-keys, pins, moves or
   switches the entry off or on does not count; with no such version, the entry's Beginning; with neither, no
   delta. A **History** entry takes no Beginning (`utils/lorebookEntries.ts` ~343–346): a living History entry
   uses **its own date** (lead's decision, ★ in the report: its heading already shows that date, and the
   measurement found a delta read better than a bare date). No query per entry: say how the dates are gathered
   for the whole reading in one pass (`state/entriesOnReading.ts`).
4. **The recipe is an Admin › Scripts rescore script, tested in the app.** The SDK publishes no `decayRate`
   today; the per-entry hook is a `candidates/rescore` script (`sdk/src/scripts.ts` ~352–361,
   `contracts/src/tasks.ts` ~810–817) that can read `c.signals.lastRefRecency` and the entry row, `decayRate`
   included, on the candidate's payload (`ranking/keywordQuery.ts` ~852, ~1188): verify both. Write the recipe
   as that script body, in the SDK's `guides/time.md` (linked from `docs/pipelines.md` and `docs/scripts.md`),
   saying plainly it is a script pasted in Admin › Scripts, not plugin TypeScript; back it with **one app
   integration test that runs the recipe's exact text through the rescore seam** and shows a living entry's
   score falling and a Fact's unchanged (the guides' snippet test only type-checks `ts` fences, so it does not
   count as the check). If the payload does not carry the rate, **stop and report** the smallest additive
   exposure; do not add a published name for it in this lane.
5. `NOMENCLATURE.md`: the **Decay** row's stated purpose changes ("recalled less as the story moves on" becomes
   what is built: the prompt says how long ago; recall is a pipeline's choice); record it in §25.

## WITHDRAWN IN PART (2026-11-15, owner): the delta is not tied to Decay

Owner: "decay is an arbitrary multiplier against recal rank, never a fucking value we include in the context, at
least not in core." Everything above that gates the time delta on a Decay rate, or calls it what "a living entry
says", is withdrawn. The recipe and the pure helpers this lane built stand. The delta is rebuilt as lane
`time-t7c` (`BRIEF-time-t7c.md`).
