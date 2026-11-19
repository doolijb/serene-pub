# BRIEF — worker `tm-1-w1` — the cast read's story time follows one rule; Assemble's redundant timeline cases go

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (read only for you). Supervisor: lane `tm-1`.
Use absolute paths. Paths below are under `src/lib/server/` unless they start with `sdk:` (`../serene-pub-sdk/`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: you run **no** `sdk:build` at all (no SDK edit in this task). Never `git checkout / restore / stash` in either repo; never
`prettier --write`; never `pkill -f` a generic pattern; no migration; no `npm run build`; no full test run. Another worker
(`tm-1-w2`) is editing other files at the same time (`scenes/earlierScenes.ts`, `state/statTrail.ts`, `loreMatch.ts`,
`bindings.outlets.ts`, `tools/coreTools.ts`, a new guard test); lane `gs-1` edits `sockets/pipelines.ts`,
`pipelines/config/panel/scopes.ts`, `sockets/sessions.pipelines.ts` and client session forms. Don't touch any of them.
**Re-read every file right before you edit it.**

## Rules your work depends on (quoted)

- Owner D56 (2026-11-16): "We need the same behavior to match across querying anything that could carry timelines/time."
  Lane rule 2 (lead's design from those words): "on a lorebook that keeps **no timeline**, every story-time value a run can
  read is `null` (a date, a clock, a delta, a calendar, a day mark), whatever is stored: a stale stored clock or date never
  reaches a run. On a lorebook that keeps a timeline, values are as today (`null` only where there is truly none)."
- Lane brief, build B: "the cast's `calendar` → null (lane `tl-2e` nulls it only in Assemble: move the rule to the read and
  delete Assemble's `keepsNoTimeline` special cases that become redundant, proving the prompt bytes are unchanged)".
- Cold-review correction 1: "the provisional `storyTime.timeline: false` key stays as it is until he rules" — do **not** change
  that key, do not make it always present, do not touch the SDK type.
- Correction 2: "`storyTime` is always an object … the no-book branch (`host.read.sessionCast.ts` 589–594, 663) is a fault the
  `ownBookFor` fallback heals, not a contract state. Not built in this lane" — leave the no-book branch exactly as it is.
- Correction 3: "No new async helper … one **pure** mapper `(timelineOff, value) → value | null` … costing no statement."
  The supervisor has written it: `timelessNull(timelineOff, value)` in `state/storyTime.ts` (just after `loreWriteDateOf`).
  Use it; don't edit it. `host.read.sessionCast.ts` already dynamic-imports `state/storyTime` in that block.
- Added item 6: "`storyTime.sessionStart` follows this lane's rule for a time value: always present on the object, a date or
  `null` (never an omitted key); `null` when the lorebook keeps no timeline (rule 2). Its SDK declaration waits."
- CLAUDE.md: "Code decides what code can … Same inputs, same result." Statement counts must not rise.

## Work

1. `pipelines/runtime/host.read.sessionCast.ts`, the `storyTime` block (~551–613): with `timelineOff` (already computed there
   from the book row's switch in the same select — keep it; no new statement):
   - `calendar: timelessNull(timelineOff, readStoryCalendar(…))`;
   - `sessionStart`: always a key on the object: `{ year, month, day }` or `null`, through `timelessNull(timelineOff, …)`
     (today it is omitted when there is none; make it `null`);
   - `now` is already null with the timeline off (`storyNowOf` returns null then); pass it through the mapper too so the
     block reads as one rule.
   - Update the block's doc comment and the 🚧 comment lines to say this (one sentence each, plain).
2. Consumers of `storyTime.calendar` / `storyTime.sessionStart` that could assume a value or an absent key: check (read only)
   `pipelines/runtime/bindings.prompt.ts` ~971–1044, `pipelines/entities/variableLayouts.ts`,
   `pipelines/entities/contextTemplateDefaults.ts` 143–144, `pipelines/routines/evaluate.ts` 186–190,
   `sdk:core-catalog/src/shared/weather.ts` ~78, `sdk:core-catalog/src/shared/ui/session-state/stateView.ts` 507/540/605,
   Dungeon Crawler `sdk:core-catalog/src/genres/dungeon-crawler/{story,rest}.ts` (`storyStartClock(null)` must give "").
   Report each: fine / breaks. If an SDK consumer breaks, **stop and report** (not your file).
3. `pipelines/prompt/assemble.ts`: `keepsNoTimeline` (~258–267) is used in `calendarOf`, `datedOf`, `currentDateOf`. Once the
   reads null their values (calendar here; `earlierScenes.openedStoryClock` by w2; history rows are already left out of every
   read when the timeline is off, lane tl-4, and `entries-named@1` by w2), each guard is redundant. Remove the three guards,
   `keepsNoTimeline` and the `timeline?` field of `StoryTimeReading`, and fix the comments that mention them (e.g.
   `currentDateOf`'s "and when the lorebook keeps no timeline …"). No other change in Assemble.
4. Tests (three cases each: `dated`, `undatable` (timeline on, no clock, no dated history), `timeless` (timeline off **with a
   stale stored session clock, a stored calendar, a stamped message and dated history**)):
   - The delivered cast `storyTime` per case: `now`, `calendar`, `sessionStart` (key present in all three; null on timeless
     and wherever there is none), and the `timeline: false` key only on timeless. Good harness: an existing cast int test
     (`pipelines/runtime/host.sessionCast.cardless.int.test.ts`, `sockets/sessions.storyUndated.int.test.ts`) or a new
     `pipelines/runtime/host.sessionCast.storyTime.int.test.ts`.
   - **The two `timeline` facts agree** in each case: `SessionSettingsV1.timeline` (`sessions/settings.ts`
     `resolveSessionSettings`; see `sessions/sessionSettings.timeline.int.test.ts`) is `false` exactly when the cast's
     `storyTime.timeline === false`, `true` exactly when the key is absent.
   - `pipelines/prompt/currentDate.storyTime.test.ts`: its `OFF` fixture (~117, `{ now: null, calendar, timeline: false }`)
     modelled the old read. Re-pin it to what the read now delivers (`calendar: null`, and no history allocations, since
     history is left out at the read) and keep the assertion "no date printed". List each test changed old → new.
   - `pipelines/runtime/promptAtReading.int.test.ts` (tl-2e's end-to-end timeline-off describe) must pass **unchanged**: that
     is the proof Assemble's removal changes no bytes.
   - **Prompt baselines**, before AND after your change: `sockets/sessions.lairUnknownEntries.int.test.ts` and
     `pipelines/runtime/unknownEntries.reply.int.test.ts`, with `KN2_SHA_LOG=plans/tm-1-w1-shas-before.txt ` (then
     `…-after.txt`) before `npx` inside the quotes. Reference: `plans/tl-4-shas-after.txt`. Shas must be identical and
     statement counts equal or lower; if not, **stop and report** the diff.
   - A first turn per shipped genre: `sockets/sessions.storyUndated.int.test.ts`, `sockets/sessions.dungeonCrawler.int.test.ts`
     (plus the two baseline files above for Story and the Lair).
   - Also run the existing tests of the files you edit (grep for them; e.g. `pipelines/prompt/assemble.test.ts`,
     `datedRows.test.ts`, `earlierScenesQuery.int.test.ts`; at most ~12 files per run).

## How to run tests — only this form, one at a time, wait first

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-1-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. Int tests that open a DB inside an `it` need a 60 s timeout. Then (wait first)
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub > plans/tm-1-w1-tsc.log 2>&1` and
report the error count in your files. `npx prettier --check` your changed files (pre-existing drift is fine; report it).

## Files owned

`src/lib/server/pipelines/runtime/host.read.sessionCast.ts` (the `storyTime` block only),
`src/lib/server/pipelines/prompt/assemble.ts` (the `keepsNoTimeline` cases only), the test files named above and one new test
file. Any other file: stop and ask (in your report).

## Stop and ask when

A baseline sha changes or a statement count rises; a shipped pipeline, script or widget needs the stale calendar or an absent
`sessionStart` key; you would need a new name, setting or a change to the SDK; the `timeline: false` key would have to change.

## Report (your final message, under ~500 words)

Changed files; the cast `storyTime` table, three cases, before → after (`now`, `calendar`, `sessionStart`, `timeline`); what
was removed from Assemble (lines); consumers checked (fine / breaks); tests run (log paths, pass/fail), tests changed old →
new; baseline shas and statements before/after per world; tsc count; anything noticed but not done.
