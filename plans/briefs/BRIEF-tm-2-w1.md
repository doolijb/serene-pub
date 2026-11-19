# BRIEF — worker `tm-2-w1` — the cast's story time declared in the SDK (item A), then the crawl's calendar arithmetic (item G)

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (edit the SDK **there**). Supervisor: lane
`tm-2`. Use absolute paths. `sdk:` = `/home/jody/github/serene-pub-sdk/`; app paths under `src/lib/server/` unless shown.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in `../serene-pub-sdk` (most of it is uncommitted); never `prettier --write`;
never `pkill -f` a generic pattern; **no migration**; no `npm run build`; no full app test run; inside `db.transaction` use only
`tx`. **Re-read every file right before you edit it** (other lanes are live: `gs-2a` in `sockets/sessions*.ts`,
`sockets/pipelines.ts`, `annexInspect.ts`; `gs-3a` in `sockets/sessions.update.ts`, `sessions/seats.ts`; worker `tm-2-w2` in
`state/presencesOnReading.ts`, `sockets/amendments.ts`, `sprites/choices.ts`, `scenes/earlierScenes.ts`,
`pipelines/runtime/host.ts`, `host.helpers.ts`, `state/statTrail.ts`, the guard test, `docs/lorebook-time.md`,
`docs/lorebook-cast.md`: none of those are yours).

**The SDK build** (only from the app root, `npm run sdk:build > plans/tm-2-w1-build-<n>.log 2>&1`): first `pgrep -af "vite"`
shows no dev / preview server (the Svelte language server's esbuild does not count); then
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`; then `touch plans/tm-2-sdkbuild.lock`, build,
`rm plans/tm-2-sdkbuild.lock` (always, also on failure). Worker 2 waits on that lock before its tests.

**Tests**, one run at a time, always after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, only as
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-2-w1-<n>.log 2>&1"`.
Never pipe vitest into `head`. SDK suite: `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/tm-2-w1-sdk-<n>.log 2>&1"`.
`tsc`: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/tm-2-w1-tsc.log 2>&1` (0 errors).

## Rules your work depends on (quoted)

- Owner 2026-11-16, T1: "No switch: time is always delivered, null when the lorebook keeps no timeline". D56: "Declare an
  optional timeline field on the cast query's story time" + "We need the same behavior to match across querying anything
  that could carry timelines/time." 2026-11-05: "All sessions have a lorebook … No exceptions so SDK data storage API is
  predictable."
- Lane rule 2 (the one rule, for every doc comment): "on a lorebook that keeps **no timeline**, every story-time value a run
  can read is `null` (a date, a clock, a delta, a calendar, a day mark), whatever is stored. On a lorebook that keeps a
  timeline, values are as today (`null` only where there is truly none)."
- Lane item A (as corrected): declare `SessionCastV1.storyTime` "always an object (drop `?` and `| null`) … with
  `timeline: boolean` (always present: true when the lorebook keeps a timeline; this replaces the provisional app-side
  `timeline: false`-only key), `now: … | null`, `calendar: … | null`, `sessionStart: { year, month, day } | null`. No param on
  any query (T1). Doc comments state the one rule … `INTEGRATING.md` gains the short section 'Story time in what a run reads'
  (the rule + the table of shapes from `REPORT-tm-1`)." Correction 5: "the cast read already falls back to the own book
  (`attachedOrOwnBookOf`, `host.read.sessionCast.ts:565`; null only when the session row is gone, `ownBook.ts` 285–294): no
  path reaches a no-book state … the object is simply always present. Derive `timeline` from `timelineOf(storyBookRow)`, not
  from `!timelineOff`. Readers to update that the brief did not name: `sessions/settings.ts` 319–328 (a `raw ?? {}` cast to
  `SessionCastV1` that would hide a missing `storyTime`), `sdk-tests/turnOrder.test.ts:371` (a typed fixture with no
  `storyTime`), `pipelines/runtime/host.sessionCast.storyTime.int.test.ts` 97 / 107 (pins that `timeline` is absent: re-pin,
  old → new). Assemble no longer reads `timeline`."
- Lane item G: "a parity test comparing the script's `calendarDay` with the SDK's `storyDayIndex` across 1896–2104 on the real
  calendar (incl. 1900, 2000, 2100), a negative year, and a custom calendar with `skipEvery` / `keepEvery`; fix what differs.
  `addMinutes` (91–100) uses fixed month lengths: make it read month lengths from the calendar the same way, so the rest line
  and the journal's 'time' text print the right day across a leap day and a custom calendar's months (it writes no date:
  labels only). Tests." The Dungeon Crawler's pinned "Day 1, 08:00 → Day 1, 16:00." must stay unchanged.
- CLAUDE.md: "after any SDK change run `npm run sdk:build` before app tests"; "Removing or renaming a published SDK name is
  the owner's call" (this is a type tightening plus new fields on an `@experimental` shape: allowed by the ruling); owner: no
  `@2` bumps before 0.7. Registry hashes or the catalogue digest (`sdk:sdk-tests/coreCatalog.test.ts`) that move are re-pinned
  with "(was …)" in a comment.
- CLAUDE.md Decisions: a new name / flag / output key that outlives the change is ★ (propose, list it, don't invent freely).
  An internal helper inside a script prelude is implementation: name it in the report. **Do not edit `NOMENCLATURE.md`**: the
  supervisor writes its rows and §25; list in your report every name you declared or changed.
- Hard rule: `socket.off(event)` never without its handler; no `crypto.randomUUID` / `navigator.clipboard` in browser code.

## Work — item A first

1. **SDK type** (`sdk:sdk/src/participants.ts` ~513–525): `storyTime: { timeline: boolean; now: (StoryTime & { from: …;
   label?: string }) | null; calendar: StoryCalendar | null; sessionStart: { year: number; month: number; day: number } | null }`
   (no `?`, no `| null` on the object). Keep the 🚧/`@experimental` marks as they are on the object; rewrite the doc comment:
   drop "Absent without a book"; state the one rule in one sentence; one line each for `timeline` (the Timeline switch of the
   lorebook that governs the session: its attached lorebook's, else its own notes'; agrees with `SessionSettingsV1.timeline`)
   and `sessionStart` (the day of the session's first live stamped message; `null` when none). Check `sdk:sdk/src` for any
   other declaration/validator/fixture of this shape (grep `storyTime`) and the core-catalog readers
   (`sdk:core-catalog/src/genres/dungeon-crawler/*.ts`, `stateView.ts`, `weather.ts`, any template) for an "absent key" or
   `timeline` assumption; adapt only what the new shape breaks.
2. **The read** (`pipelines/runtime/host.read.sessionCast.ts` ~550–610): `storyTime` is always the object. If `storyBook` is
   null (the session row is gone), do what the read already does for a missing session (find it; throw its existing fault),
   never return a missing object. `timeline = timelineOf(storyBookRow)`; the nulling uses `!timeline` (today it is
   `!storyNow && !timelineOf(...)`: check whether `storyNow` can be non-null on a timeline-off book via `ownBookDaysCounted`;
   if it can, say so in the report: the new rule nulls it). Always emit `timeline`. Rewrite the comments (the 🚧 "not in
   `SessionCastV1`" lines go). No new statement.
3. **Readers**: `sessions/settings.ts` 319–328 (the `raw ?? {}` default must not hide a missing `storyTime`: give the
   fallback object a full `storyTime` only if the type demands it, or narrow so a missing one is a type error: choose, name the
   choice); `sdk:sdk-tests/turnOrder.test.ts:371` (fixture gains `storyTime`); every test fixture in the app typed or shaped as
   the cast's `storyTime` (grep `storyTime:` and `timeline: false` in `src/lib/server/**/*.test.ts`, e.g.
   `pipelines/prompt/currentDate.storyTime.test.ts` ~117, `datedRows.test.ts`, `dungeonCrawlerScripts.test.ts`) only where the
   new shape requires it. Re-pin `host.sessionCast.storyTime.int.test.ts` (`"timeline" in r.storyTime` false → `timeline` is
   `true` / `false`; add the `timeless` case's `timeline: false` and stale values → null if not already there). List every
   test changed, old → new.
4. **`sdk:INTEGRATING.md`**: a short section "Story time in what a run reads" near the existing `SessionSettingsV1.timeline`
   bullet (~1645): the rule in one sentence; that `storyTime` is always an object with `timeline` always present; no query
   has a param that switches time; the table of shapes (three columns dated / undatable / timeless) taken from
   `plans/REPORT-tm-1-2026-11-16.md` "The rule as built" with `timeline` now `true` / `true` / `false` and `sessionStart`
   declared. Plus `cast-presences@1` row: dated `from`/`until` stored; timeless `null` (worker 2 builds that). Keep it short.
5. Build the SDK (procedure above), then app tests:
   `src/lib/server/pipelines/runtime/host.sessionCast.storyTime.int.test.ts src/lib/server/pipelines/prompt/currentDate.storyTime.test.ts src/lib/server/pipelines/prompt/datedRows.test.ts src/lib/server/sessions/sessionSettings.timeline.int.test.ts src/lib/server/pipelines/runtime/promptAtReading.int.test.ts src/lib/server/state/sessionStoryClock.int.test.ts src/lib/server/pipelines/scripts/dungeonCrawlerScripts.test.ts`
   (add any test file you changed; skip a path that does not exist and say so), then the baselines and first turns as one run
   with `KN2_SHA_LOG=plans/tm-2-w1-shas.txt ` before `npx` inside the quotes:
   `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts src/lib/server/sockets/sessions.storyUndated.int.test.ts src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts`.
   Compare with `plans/tm-1-shas-final.txt`: **shas must be identical; statements equal**; if not, stop and report the diff.

## Work — item G after A is green

6. `sdk:core-catalog/src/genres/dungeon-crawler/storyScripts.ts` (a JS prelude in a template string: mind the escaping, e.g.
   `\\d`). Parity test in the SDK tests (the DC test file that already tests `clockLabel`, e.g.
   `sdk:sdk-tests/dungeonCrawlerStory.test.ts`): run the prelude's `calendarDay` (as the existing tests reach prelude
   functions) against `storyDayIndex` (`sdk:sdk/src/storyTime.ts`) for every 1 Jan, 28 Feb, 29 Feb (when it exists), 1 Mar and
   31 Dec in 1896–2104 on `real-calendar` (`STORY_CALENDAR_PRESETS`), a negative year span (e.g. -10..10), and a custom
   calendar with `skipEvery` / `keepEvery` and its own month lengths. Compare differences of ordinals (day counts between two
   dates), not absolute values, if the two have different epochs. Fix the script where they differ.
7. `addMinutes` (~91–100): read month lengths from the calendar the cast read delivers (the leap day in its month when that
   year has it) the same way `calendarDay` does; keep `MONTH_DAYS` only as the no-calendar fallback (comment why: free-form
   book). Thread the calendar to every `addMinutes` caller (`rest.ts`, `journal.ts`, `story.ts`, wherever) the way
   `clockCalendar` / `clockStart` are handed today; prefer an existing value; a new script output key is ★ (name it plainly).
   Tests: a rest crossing 2028-02-28 → 02-29 → 03-01 on the real calendar; a custom calendar's long month end; the pinned
   "Day 1, 08:00 → Day 1, 16:00." unchanged.
8. Build the SDK again (procedure above); app `src/lib/server/pipelines/scripts/dungeonCrawlerScripts.test.ts
   src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts`; then the **full capped `npm run sdk:test`** after your last SDK
   edit. Four failures are known: "no file spells more than its allowance", "the strings ruled to stay are exactly as many as
   ruled…", "every export is tagged", "every canon term outside the vocabulary is linked where it first appears"
   (guides/your-first-plugin.md). Any other failure: fix if yours, else report by name. `tsc` 0.

## Done means

All the test runs above green (apart from the four known SDK failures), shas identical, `tsc` 0,
`npx prettier --check` clean on every file you touched (report pre-existing differences, never fix them with `--write`).

## Report (your final message, under 500 words)

Changed files (absolute paths); the declared shape (verbatim TS); each test changed old → new; logs and pass counts; shas and
statements per world vs `plans/tm-1-shas-final.txt`; the parity test's findings and what you fixed; catalogue digest re-pin
(was → now); SDK test count and every failure by name; names declared or added (★); the `storyNow` / timeline-off finding;
**Noticed, not done**.
