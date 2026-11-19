# BRIEF — build lane `tm-1` — one behaviour for story time in everything a run can read (owner ruling D56)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-time-in-query-results-2026-11-16.md` (the map of this lane: **re-verify every file:line**),
row D56 in `plans/DISCUSS-LATER.md`, `plans/REPORT-tl-2e-2026-11-16.md`, `-tl-2c-…`, `-tl-2a-…`, `-tl-4-…`
(if it exists), `docs/lorebook-time.md`, `../serene-pub-sdk/INTEGRATING.md` (story time), `NOMENCLATURE.md` §1,
§24 and rows **timeline**, **story now**, **story clock**, **calendar**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root; `sdk:build` only from the app root after checking no dev / preview server (`pgrep -af "vite"`;
the Svelte language server's esbuild does not count) and no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-1-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. **No migration.** Inside
`db.transaction` only `tx`. No full run, no `npm run build`.

## Owner (2026-11-16, rulings page, D56)

"Declare an optional timeline field on the cast query's story time" and "Consider that no one has shipped a
plugin, and we can still freely edit our core catelogue. Consider if the query param should always be on by
default and deliver it's values or null when available. We need the same behavior to match across querying
anything that could carry timelines/time." Standing: "This is what we are enforcing type safety on timelines
lorebooks"; comprehension and fidelity first; P1 (same inputs, same result); no `@2` bumps before 0.7.

## The rule to build (lead's design from those words; names are ★)

1. **Time is always delivered, never switched on:** no query gains a param for time. Every result that can
   carry story time carries its time fields always, typed `… | null` (most already are).
2. **One meaning of null:** on a lorebook that keeps **no timeline**, every story-time value a run can read is
   `null` (a date, a clock, a delta, a calendar, a day mark), whatever is stored: a stale stored clock or date
   never reaches a run. On a lorebook that keeps a timeline, values are as today (`null` only where there is
   truly none).
3. **One fact says which case it is, in one place per run-visible shape:** `timeline: boolean`, always present
   (never an optional key that appears only when false), on the two shapes that already carry it:
   `SessionSettingsV1.timeline` (declared) and the cast query's `storyTime` (declare it in the SDK:
   `SessionCastV1.storyTime: { timeline: boolean; now: … | null; calendar: … | null }`; `storyTime` itself is
   always an object when the session has a lorebook, and `null` only with no lorebook: today it is omitted
   there: make it `null` as the type says). Both are filled from the same read (`sessionTimelineOf` /
   `timelineOf`): one fact, two places, never able to disagree (a test). No third place: rows do not each
   carry a `timeline` flag.
4. **One function decides, at the host's edge.** A single helper beside `loreWriteDateOf` (state/, name by
   §24) answers "does this run read story time" for a session; every binding / read that returns a time field
   passes its time part through it (or through one small `nullTime(...)` mapper) instead of each deciding. A
   guard test in the manner of `pipelines/runtime/loreWriteDate.guard.test.ts` lists the reads and fails when a
   new time-carrying read skips it.

## Build

A. **SDK:** declare the cast `storyTime` shape as in rule 3; correct doc comments on every time field to state
   rule 2 in one sentence (`varCurrentDate`, `variables.ts` ~940–946, is stale); `INTEGRATING.md` gains one
   short section "Story time in what a run reads" with the rule and the table of shapes. No removal or rename
   of a published name; no new params. `sdk:build`, `npm run sdk:test` (capped; four known failures); registry
   hashes re-pinned with "(was …)" if any row changes.
B. **App, the leaks the inventory lists** (each: before → after in the report), with the timeline off:
   - `earlier-scenes`' `openedStoryClock` → null;
   - the cast's `calendar` → null (lane `tl-2e` nulls it only in Assemble: move the rule to the read and delete
     Assemble's `keepsNoTimeline` special cases that become redundant, proving the prompt bytes are unchanged);
     replace the provisional `storyTime.timeline: false` key with the declared always-present boolean;
   - scene `openedAt` / `closedAt` and message `storyClock*` **as a run reads them** (`session-history`,
     `summarize-source`, scene reads) → null. What a **person** sees on the client is not a run's read: the
     conversation widget's day marks from stored stamps (`sceneMarks.ts` ~113, ~293): list what it shows with
     the timeline off and fix only if it prints a story date there (then at the widget's data source, same
     rule), else report;
   - the stat trail's `anchor.date` → null;
   - dates on lore entries other than history (Beginning / *began*): verify what a run reads with the timeline
     off, apply rule 2;
   - the day inside a stored automatic scene name stays (it is stored text; `tl-2e` documented it).
C. **Presences: report, do not change.** With the timeline off, presence rows are read at the head, so a cast
   member with an `until` counts as gone: that is behaviour, not display. State exactly what happens today and
   the options (ignore dated presences while the timeline is off / keep) as ★ for the owner.
D. **Core consumers** of these fields (core-catalog scripts and templates, the prompt assembler, routines'
   skip reasons, widgets): adapt any that assumed "absent key" or a stale value; Dungeon Crawler's day label
   (lane `tl-4` changed it) must keep printing "Day 1".
E. Docs: `docs/lorebook-time.md` (one paragraph: with the timeline off, nothing a pipeline reads carries a
   story date), `docs/context-templates.md` if a variable's note changes, `NOMENCLATURE.md` (the helper's row
   with its charter; the `timeline` fact's row; §25 including the removal of the provisional key).

## Tests

Per shape, three cases (`dated`, `undatable`, `timeless` with stale stored values): the delivered time part;
the two `timeline` booleans agree; the guard test; both prompt baselines byte-identical for the shipped worlds
(statement counts unchanged or lower: report per world); a first turn per shipped genre. `tsc` 0;
`npm run check` 0 errors in lane files.

## Files owned

The SDK cast shape and doc comments; `pipelines/runtime/host.read.*.ts` time parts,
`pipelines/runtime/bindings.*.ts` where a time field is mapped, `pipelines/prompt/assemble.ts` (the redundant
special cases), `state/storyTime.ts` (the helper, additive), `state/reading.ts` only if a read's time part is
decided there, the stat trail read, their tests, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped pipeline or widget needs a stale stored date to work with the timeline
off; nulling a field changes a prompt baseline; a published name would have to be removed or renamed; message
stamps would have to enter a contract that does not declare them (`session-history@1`,
`summarize-source@2`): report instead.

## Report

Final message = the report (lead saves `plans/REPORT-tm-1-<date>.md`): the rule as built and the helper; the
table of shapes (three cases, before → after); what was removed from Assemble; presences (★); names (★);
statement counts; **Noticed, not done**. Under about 650 words.

## Cold review corrections (2026-11-16) — these rule over the text above

**Launch only after lane `tl-4` has landed** (it owns `host.read.lorebookEntries.ts` and edits
`docs/lorebook-time.md`).

1. **Part A's SDK declaration and "no param" wait for the owner** (the rulings page, T1 / D62: no switch at
   all, or a real on-by-default param on each time-carrying query; and whether `timeline` is always present or
   optional: his words were "Declare an optional timeline field"). **Build part B now**: the host's nulling is
   the same under either answer. In part A do only the doc-comment corrections (`varCurrentDate`, `variables.ts`
   ~940–946); the provisional `storyTime.timeline: false` key stays as it is until he rules.
2. **`storyTime` is always an object** (owner 2026-11-05: "All sessions have a lorebook … No exceptions so SDK
   data storage API is predictable."): when the declaration is built it drops both `?` and `| null`
   (`sdk/src/participants.ts` 521–524); the no-book branch (`host.read.sessionCast.ts` 589–594, 663) is a fault
   the `ownBookFor` fallback heals, not a contract state. Not built in this lane (item 1): record it for the
   declaration lane.
3. **No new async helper.** The fact already exists on every reading: `timelineOff`
   (`state/reading.ts` 358–363; used by `tl-2e`, `tl-4`, `ownBookDaysCounted`) and `sessionTimelineOf`
   (`lorebooks/timeline.ts:129`) for settings. Build one **pure** mapper `(timelineOff, value) → value | null`
   fed from `reading.timelineOff`, costing no statement. The guard test scans `host.read.*` and `bindings.*`
   for time column names (`storyClock`, `openedStoryClock`, `year:` …) the way
   `pipelines/runtime/loreWriteDate.guard.test.ts` scans.
4. **The stat trail: null after sorting and filtering.** `state/statTrail.ts:259` sets `date`, :279 sorts on
   it, :286 filters `since.date` on it; there is a row-level `date` beside `anchor.date`: null both in what is
   delivered, after order and filter, so no point is reordered or dropped. Add to Stop and ask: a filter or an
   order would change.
5. **Files, exactly:** worker 1: `pipelines/runtime/host.read.sessionCast.ts` (the calendar at the read),
   `pipelines/prompt/assemble.ts` (the special cases that become redundant), prompt baselines. Worker 2:
   `scenes/earlierScenes.ts:102` (`openedStoryClock`), `state/statTrail.ts`, lore rows' dates
   (`pipelines/runtime/host.helpers.ts` 1103–1105), the mapper and the guard. Report only, no change: the
   widget's day marks (`messages/store.ts`, `liveSceneProjection.ts`, `sceneMarks.ts`) and presences.
   `host.read.lorebookEntries.ts`: only if `tl-4`'s report shows a time part left there.

## Added after lane `tl-4` landed (2026-11-16) — read `plans/REPORT-tl-4-2026-11-16.md` first

`tl-4` is in: one history filter in `readLorebookEntries` on `reading.timelineOff`; the cast read now also
delivers 🚧 `storyTime.sessionStart` (the session's first live stamped message's date; omitted when there is
none), used by the Dungeon Crawler's day label. Four more items for this lane (worker 2, except the first):

6. **`storyTime.sessionStart` follows this lane's rule for a time value:** always present on the object, a
   date or `null` (never an omitted key); `null` when the lorebook keeps no timeline (rule 2). Its SDK
   declaration waits with `timeline`'s (correction 1): app-side only, provisional, recorded in NOMENCLATURE
   §25 beside the `timeline` key. The Dungeon Crawler scripts (`core-catalog/src/genres/dungeon-crawler/
   storyScripts.ts`, `story.ts` 171 / 225 / 292, `rest.ts`, `journal.ts:144`) must keep printing "Day 1" with
   `null` (they already count from the current clock then): verify, and re-run their SDK tests if you touch
   them (`sdk:build` from the app root under the usual checks, `npm run sdk:test` capped: four known failures).
7. **One read missed by `tl-4`'s history filter:** `core:query/entries-named@1` (`pipelines/runtime/
   bindings.outlets.ts` 289–350 → `entriesNamedIn` → `entriesAsRead`, `lorebooks/loreMatch.ts:318`) does not go
   through `readLorebookEntries`: when `reading.timelineOff`, history entries are not returned there either,
   with the same receipt line the sibling reads give. Test. And one clause: the `search_entries` tool's
   description still says "and history" (`tools/coreTools.ts:102`): make it true for both cases in the
   existing manner of that description.
8. **The crawl's day count across a leap day.** `clockDays` (`storyScripts.ts` 116–121) counts years as
   `(y-1)*365` with fixed month lengths, so 29 February and 1 March print the same Day N and every later day is
   one low. Count day ordinals through the calendar the cast read delivers (`storyTime.calendar`; the SDK's
   `storyDayIndex` does this), falling back to today's arithmetic only when there is no calendar. Tests: a
   crawl spanning 2028-02-29 on the real calendar; a lorebook with its own calendar across a month end; the
   pinned "Day 1, 08:00 → Day 1, 16:00." unchanged. This is an SDK edit (core-catalog): build and test as in 6.
   Note the tension with item B's "the cast's `calendar` → null when the timeline is off": the Dungeon Crawler
   requires a timeline, so its calendar is never null; say so in a comment at the fallback.
