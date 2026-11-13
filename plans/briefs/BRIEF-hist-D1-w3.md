# BRIEF — hist-D1-w3: the Dungeon Crawler's turns and rests move the session story clock (SDK)

Supervisor: hist-D1. Repo: `/home/jody/github/serene-pub-sdk` (always absolute paths). Plan: `/home/jody/github/serene-pub/plans/PLAN-history-one-per-date-2026-11-10.md` § "Clocks" (everything you need is quoted below).

## Goal

The Dungeon Crawler stops keeping its own clock (`core:slot/crawl-time@1`, a world value written by story turns and rests) and uses the **session story clock** instead:

- story turns and rests move it through `core:outlet/advance-story-clock@1 { by: <minutes>, unit: 'minutes', cause: 'action', onRefusal: 'skip' }`;
- the Planner brief's time (`clockBase`, "Day N, HH:MM"), the journal's time line and the rest's lines read the **session's story now**.

Already done by other workers (don't redo): create starts the clock at 08:00 (`create.ts`, outlet `clock`); the `crawl-time` host-state `time` declaration is gone; deaths write no lore (`deaths` junction in `story.ts`, `deceased` in the ledger, `progress.fallen`). Read the current `story.ts` before editing: it changed today.

## Owner rulings this applies (2026-11-10)

- ★C1: "DC uses the **session story clock** through `advance-story-clock@1`, not its own `crawl-time`": story turns (`story.ts` ~746-750) and rests (`rest.ts` ~119-121) → `advance-story-clock@1 { by, unit: 'minutes', cause: 'action' }`; the Planner brief's `clockBase` (`story.ts` ~163, 217, 277) and the journal line (`journal.ts` ~144) read the session's story now.
- Keep the `crawl-time` slot registered (done); nothing writes it any more.
- DC's book stays free-form (no calendar): in a free-form book a time of day carries into the day (day 31 + a night = day 32 of the same month; months never roll).

## What the graph can reach (supervisor's finding)

The respond spec's head already reads `cast` (`C.sessionCast.v1`, `respond.ts`). The host puts the session's story time on that read: `$.cast.main.storyTime = { now: { year, month?, day?, hour?, minute?, from, label? } | null, calendar }` (core `host.ts`, the session-cast case; `now` is `sessionStoryNowOf`: the session's clock, else its line's present). Absent or `now: null` when there is no clock yet.

The rest specs (`dungeonCrawlerRestSpec`, `dungeonCrawlerAfterRestSpec`, `rest.ts`) read no cast today: add `.query('cast', ($) => C.sessionCast.v1({ scope: $.input.sessionScope }))` to both heads (the routine inlet has `sessionScope` too; check) and hand `cast: $.cast.main` to the rest script.

## Supervisor decisions you implement

- `onRefusal: 'skip'` on every clock move (a move the story can't take moves nothing, the ledger says why, the turn finishes — every core time step skips). `cause: 'action'` (a swipe takes the move back with the row; the redo moves it again, once).
- When the cast carries no story now, the brief and journal fall back to `DUNGEON_CRAWLER_EPOCH` ('1-01-01 08:00'), never to an old `crawl-time` value (an unmigrated older session gets its clock from lane hist-D2's data pass).
- The time stays said the crawl's way, "Day N, HH:MM" (`clockLabel`).

## Files owned (edit only these)

- `core-catalog/src/genres/dungeon-crawler/storyScripts.ts`
- `core-catalog/src/genres/dungeon-crawler/story.ts` — the clock parts (and the one doc fix below); leave the `deaths` junction and the fallen code as they are.
- `core-catalog/src/genres/dungeon-crawler/rest.ts`
- `core-catalog/src/genres/dungeon-crawler/journal.ts` (only if it needs to change; it reads `b.clockBase` and `clockNext`)
- `sdk-tests/dungeonCrawlerStory.test.ts`, `sdk-tests/dungeonCrawlerWalk100.test.ts`, `sdk-tests/dungeonCrawlerWalk3.test.ts`, `sdk-tests/dungeonCrawler.test.ts` — the clock / `crawl-time` / rest assertions only.

## What to build

### storyScripts.ts
- A helper in the preamble JS beside `addMinutes` / `clockLabel`: `storyNowClock(now)` → the clock line the crawl's helpers read, `"<year>-<MM>-<DD>[ HH:MM]"` from `{ year, month?, day?, hour?, minute? }`: month and day default to 1; the time part only when `hour` is a number (minute default 0); `""` when `now` has no numeric `year`. Comment it (the session story now, as the cast read carries it, 2026-11-10). Update the preamble's header doc list.
- `clockLabel`'s comment: "Day N" counts from the story's first day; the clock is the session's story clock (2026-11-10).

### story.ts
- `DUNGEON_CRAWLER_BOOKS_SCRIPT`: input `cast` (add `cast: $.cast.main` to the books step's input in `storyBranch`); `var clockBase = storyNowClock(own(own(v.cast).storyTime).now) || ${JSON.stringify(DUNGEON_CRAWLER_EPOCH)};` (no `crawl-time` read). In the redo `told` object add `clock: num(last.clock, 0) > 0 ? num(last.clock, 0) : null`. Doc: "Handed `{ session, state, story, messageId, places, people, log, cast }` … the two listings of the session's lorebook" (it says "three" today — fix to two) and `clockBase` "the session's story now, as the cast read carries it".
- `DUNGEON_CRAWLER_LEDGER_SCRIPT`:
  - The clock block: keep computing `clockNext = addMinutes(b.clockBase, plan.clock.minutes)` (the journal's time line reads it), but **no** `changes.push({ owner: "world", slot: SL.clock, … })`. Keep a variable with the minutes moved, e.g. `var clockMinutes = clockNext ? Math.round(plan.clock.minutes) : 0;`.
  - Return `clock: clockMinutes > 0 ? clockMinutes : null`; `progress.lastTelling` gets `clock: clockMinutes > 0 ? clockMinutes : null`; the redo return gets `clock: told0.clock || null` (a swipe took the move back with the row; the redo files it again — once).
  - Ledger doc: add `clock` to the returned members and say what it is.
- `Ledger` interface: add `readonly clock: unknown`.
- `storyBranch`: a junction after `advanced` (the `time` junction) — or a second `.when` in it if the `after` junction at the end of the file shows `when` arms all run when truthy — placing:
  `C.advanceStoryClock.v1({ by: <the ledger's clock>, unit: 'minutes', cause: 'action', onRefusal: 'skip', params: slot.params() })`, reading the minutes with `jsonPart(k, w, '<name>', ($) => $.channel.story.ledger.main, 'clock', "The round's minutes")`. Expose label e.g. `'Move the story clock'`, status `STORY_STATUS.books`. Report the node keys.
- Header doc step 7/8: the clock is the session's story clock, moved by `advance-story-clock@1`.

### rest.ts
- Both heads: the `cast` query; the rest script gets `cast: $.cast.main`.
- `DUNGEON_CRAWLER_REST_SCRIPT`: `var was = storyNowClock(own(own(v.cast).storyTime).now) || EPOCH;` `var now = minutes > 0 ? addMinutes(was, minutes) || was : was;` — **no** `SL.clock` change. Return `clock: now !== was ? Math.round(minutes) : null` (add to the `Rested` interface and the early-return object, `clock: null`). The `line` / `journal` texts stay as they are (they already say the times).
- `restBody`: a `.when('clock', { path: (v: Rested) => v.clock, truthy: true }, …)` arm in the `rested` junction placing the same `advanceStoryClock` (`cause: 'action'`, `onRefusal: 'skip'`), with `jsonPart` for the minutes. Expose label e.g. `'Move the story clock by the night'`.
- The `set-state` task's label `'Heal, and move the clock'` → `'Heal the party'` (it no longer moves the clock). Report both labels as provisional copy.
- Header doc: "the crawl's clock moves on … (`core:slot/crawl-time@1`)" → the session's story clock moves on by the rest's length (`advance-story-clock@1`).

### journal.ts
- Probably nothing (it reads `b.clockBase` and `clockNext`). If a comment says the clock is `crawl-time`, fix it.

## Tests (update and add)

In `sdk-tests/dungeonCrawlerStory.test.ts` (fixtures and runners exist; the rest tests are near line 780-816, the ledger clock test near 623, the books `clockBase` near 385):
- books: with `cast: { storyTime: { now: { year: 1, month: 1, day: 3, hour: 16, minute: 30 } } }` → `clockBase === '1-01-03 16:30'` and the brief says `Time: Day 3, 16:30.`; with no cast → `'1-01-01 08:00'`; an old `world['crawl-time']` value is **not** read.
- ledger: a plan with `clock.minutes: 90` → no `core:slot/crawl-time@1` change in `changes`, `clock === 90`, `lastTelling.clock === 90`, and the journal's time line `Day 1, 08:00 → Day 1, 09:30.` (or whatever the base gives); a redo returns `clock` equal to `lastTelling.clock` once.
- rest: no `crawl-time` change; `clock` is the rest's minutes; the line/journal times come from the cast's story now (e.g. `now` = day 31 20:00 + 8 h → "Day 32, 04:00").
- doc: the respond spec has a node `definitionId === 'core:outlet/advance-story-clock'` whose config carries `unit: 'minutes'`, `cause: 'action'`, `onRefusal: 'skip'` and whose `by` is wired from the ledger; both rest specs have one too, and their heads read `cast`.
- Update the existing node-key / params lists in the tests that enumerate the respond and rest docs.
- The test "R1-6 / R3-5 / R3-3: the Dice and Planner copies spell the crawl's clock; …" may assert the crawl clock's words: keep its intent ("Day N, HH:MM"), update only what the clock's source change breaks.
- Walk100 / Walk3 fixtures put `'crawl-time'` in the world state: leave them unless an assertion now reads it wrong.

## Run (capped scope, from source; never pipe into `head`)

```
cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test dungeonCrawlerStory.test.ts dungeonCrawler.test.ts dungeonCrawlerWalk100.test.ts dungeonCrawlerWalk3.test.ts dungeonCrawlerMultiplayer.test.ts dungeonCrawlerRuleset.test.ts; echo test-exit=$?'
cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk-tests
```
All of these passed after the previous workers (2026-11-10). `deriveDontSpell.test.ts` already fails on counts other lanes moved; your new `jsonPart` calls add to its "data path in a model answer" count — don't edit that file; report how many `jsonPart`/`textPart` calls you added.

## Code style

- The scripts are ES5-style JavaScript inside TS template literals: `var`, `function`, no arrow functions, no `let`/`const`; inside the literal a newline escape is `\\n` and a backslash is doubled. Follow the surrounding code.
- Tabs, single quotes in these files. `npx prettier --check <file>` to look, never `--write`; don't reformat lines you didn't change.
- No `as any` where the surrounding code doesn't already need it (`rest.ts`'s `restBody` already types `$: any` — follow it there).

## Rules (CLAUDE.md, NOMENCLATURE)

- It is a **session**, never a *chat*. No new names beyond `storyNowClock`, the ledger/rest member `clock`, and the node keys you create. Any other new name → stop and report.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Never edit outside the files owned; if you need a change elsewhere, stop and report it.

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new, or a migration is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Never run `npm run sdk:build`** in this lane at all (the lead builds). Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.**
- Never hand a DOM node to an assertion.
- Scratch files start with `hist-D1-`.

## Done means

`npx tsc --noEmit -p sdk-tests` exits 0 and the test run above passes.

## Report

Your final message is your report: changed files, the node keys created, the exact copy (labels), the number of `jsonPart`/`textPart` calls added, tests run with results, open ★, **Noticed, not done**.
