# BRIEF — worker `tm-1-w3` — the crawl's day count follows the calendar; SDK doc comments state the timeline rule

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (edit the SDK **there**). Supervisor: lane
`tm-1`. Use absolute paths. `sdk:` = `/home/jody/github/serene-pub-sdk/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in `../serene-pub-sdk` (most of it is uncommitted); never `prettier --write`;
never `pkill -f` a generic pattern; no migration; no `npm run build`; no full app test run. **Before your `sdk:build`**:
(1) wait for the app worker `tm-1-w4` to finish: `until [ -f /home/jody/github/serene-pub/plans/tm-1-w4.done ]; do sleep 15; done`;
(2) `pgrep -af "vite"` shows no dev / preview server (the Svelte language server's esbuild does not count); (3) no vitest:
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Build only from the app root: `npm run sdk:build`. Edit the
SDK files while you wait; only the build waits. **Re-read every file right before you edit it.**

## Rules your work depends on (quoted)

- Lane item 8: "**The crawl's day count across a leap day.** `clockDays` (`storyScripts.ts` 116–121) counts years as
  `(y-1)*365` with fixed month lengths, so 29 February and 1 March print the same Day N and every later day is one low. Count
  day ordinals through the calendar the cast read delivers (`storyTime.calendar`; the SDK's `storyDayIndex` does this),
  falling back to today's arithmetic only when there is no calendar. Tests: a crawl spanning 2028-02-29 on the real calendar;
  a lorebook with its own calendar across a month end; the pinned "Day 1, 08:00 → Day 1, 16:00." unchanged. … Note the tension
  with item B's "the cast's `calendar` → null when the timeline is off": the Dungeon Crawler requires a timeline, so its
  calendar is never null; say so in a comment at the fallback."
- Lane item 6: "`storyTime.sessionStart` … always present on the object, a date or `null` … The Dungeon Crawler scripts
  (`core-catalog/src/genres/dungeon-crawler/storyScripts.ts`, `story.ts` 171 / 225 / 292, `rest.ts`, `journal.ts:144`) must keep
  printing "Day 1" with `null` (they already count from the current clock then): verify, and re-run their SDK tests if you
  touch them." (The app now always sends `sessionStart`, `null` when nothing is stamped or the timeline is off.)
- Cold-review correction 1: "Part A's SDK declaration and 'no param' wait for the owner … In part A do only the doc-comment
  corrections (`varCurrentDate`, `variables.ts` ~940–946); the provisional `storyTime.timeline: false` key stays as it is."
  So: **no type change, no new published name, no declaration of `timeline` or `sessionStart`**, no `INTEGRATING.md` edit.
- Lane rule 2 (what the doc comments must say, one sentence each): "on a lorebook that keeps **no timeline**, every
  story-time value a run can read is `null` (a date, a clock, a delta, a calendar, a day mark), whatever is stored."
- CLAUDE.md: "after any SDK change run `npm run sdk:build` before app tests"; "Removing or renaming a published SDK name is the
  owner's call"; "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`". Owner: no `@2` bumps before 0.7.
- CLAUDE.md Decisions: a new name / flag that outlives the change is ★ (propose, don't decide). An internal helper inside the
  script prelude is implementation: name it, say so in the report.

## Work

1. **Day count** (`sdk:core-catalog/src/genres/dungeon-crawler/storyScripts.ts`, a JS prelude in a template string: mind the
   escaping, e.g. `\\d`). Scripts can't import the SDK; port `storyDayIndex`'s arithmetic (`sdk:sdk/src/storyTime.ts` ~522,
   with `leapDaysThrough` / `storyDaysInMonth` and the leap rule `{ every, month, skipEvery?, keepEvery? }`) into the prelude as
   one small internal helper, and make `clockDays` / `clockLabel` count through the calendar when one is given, falling back to
   today's `(y-1)*365` + `MONTH_DAYS` arithmetic only without one (comment at the fallback: the crawl requires a timeline, so the
   cast read's calendar is null only for a free-form book, never because the timeline is off). Thread the calendar from the cast
   read (`own(own(v.cast).storyTime).calendar`) to every `clockLabel` caller (`story.ts` ~171/225/292, `rest.ts` ~123/160–161,
   `journal.ts:144` via whatever `story.ts` hands it, as `clockStart` is handed today). Prefer passing it inside an existing
   value; if a new script output key is unavoidable, name it plainly and list it as ★ in the report. Also check `addMinutes`
   (~89–100, same `MONTH_DAYS`): if it skips a leap day or ignores a book's month lengths, **report it under Noticed, don't fix**.
2. **Verify `sessionStart: null`**: `storyStartClock(null)` gives "" and the label counts from the current clock ("Day 1").
   Add one test case with `sessionStart: null` beside the existing `sessionStart` fixtures.
3. **Doc comments only** (JSDoc / `//`, never a `description:` / `i18n` value): `varCurrentDate` (`sdk:sdk/src/variables.ts`
   ~932–946: the 🚧 paragraph still says a dated history entry kept from before the switch can give a date with `timeline`
   `false`; now: with `false` it is always absent); `SessionCastV1.storyTime` (`sdk:sdk/src/participants.ts` ~513–524: `now` and
   `calendar` are `null` when the lorebook keeps no timeline; say nothing of the undeclared keys); `core:query/earlier-scenes@1`'s
   `openedStoryClock` (`sdk:contracts/src/queries.ts` ~1485: also `null` when the lorebook keeps no timeline); `stat-trail@1`'s
   anchor `date` (`queries.ts` ~3649–3650: `null` when the lorebook keeps no timeline). Nothing else.
4. **Build and test**: `npm run sdk:build` (precautions above) > `plans/tm-1-w3-build.log`; then `npm run sdk:test`, capped:
   `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/tm-1-w3-sdk-<n>.log 2>&1"`
   (wait for no vitest first). Four failures are known and not yours; name every failure and say which are yours. A moved
   catalogue digest (`sdk:sdk-tests/coreCatalog.test.ts`, last pinned `2e13348a869afb4c` by lane tl-4) or registry hash: re-pin
   with "(was …)". Tests for item 1 go in `sdk:sdk-tests/dungeonCrawlerStory.test.ts` (or the DC test file that already pins
   "Day 1, 08:00 → Day 1, 16:00."): a crawl spanning 2028-02-29 on the real calendar (`STORY_CALENDAR_PRESETS` `real-calendar`:
   Feb 28 → Day N, Feb 29 → Day N+1, Mar 1 → Day N+2); a book with its own calendar across a month end; the pinned line unchanged.
   Then the app's: `systemd-run … bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/scripts/dungeonCrawlerScripts.test.ts src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts src/lib/server/sockets/sessions.dungeonCrawlerRounds.int.test.ts > plans/tm-1-w3-1.log 2>&1"`
   (same wait first; never pipe vitest into `head`).

## Files owned

`sdk:core-catalog/src/genres/dungeon-crawler/{storyScripts,story,rest,journal}.ts`, the four doc comments named in item 3,
`sdk:sdk-tests/dungeonCrawlerStory.test.ts` (or the DC test file that pins the Day line), `sdk:sdk-tests/coreCatalog.test.ts` (a
re-pin only), `src/lib/server/pipelines/scripts/dungeonCrawlerScripts.test.ts` (only if a pin there must move). Any other file:
stop and ask (in your report).

## Stop and ask when

A published name would have to change or a type be declared; the "Day 1, 08:00 → Day 1, 16:00." pin would move; a test beyond
the catalogue digest needs re-pinning; the build or tests can't run (say why).

## Report (your final message, under ~450 words)

Changed files; how the count works now (the helper, where the calendar comes from, the fallback); the three test cases and their
results; the `sessionStart: null` check; the doc comments (old → new, one line each); build log; sdk:test count and every failure
named (yours / known); app test results; re-pins (was → now); anything noticed but not done (`addMinutes`).
