# BRIEF — worker `tm-1-w2` — stale story dates out of earlier-scenes and the stat trail; history out of `entries-named@1`; one guard

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (read only for you). Supervisor: lane `tm-1`.
Use absolute paths. Paths below are under `src/lib/server/` unless they start with `sdk:` (`../serene-pub-sdk/`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: you run **no** `sdk:build` at all (no SDK edit in this task). Never `git checkout / restore / stash` in either repo; never
`prettier --write`; never `pkill -f` a generic pattern; no migration; no `npm run build`; no full test run. Another worker
(`tm-1-w1`) is editing `pipelines/runtime/host.read.sessionCast.ts` (the cast's `storyTime` block) and
`pipelines/prompt/assemble.ts` at the same time; lane `gs-1` edits `sockets/pipelines.ts`, `pipelines/config/panel/scopes.ts`,
`sockets/sessions.pipelines.ts` and client session forms. Don't touch any of them. `bindings.outlets.ts` and
`tools/coreTools.ts` already carry other lanes' uncommitted edits: keep them. **Re-read every file right before you edit it.**

## Rules your work depends on (quoted)

- Owner D56 (2026-11-16): "We need the same behavior to match across querying anything that could carry timelines/time."
  Lane rule 2: "on a lorebook that keeps **no timeline**, every story-time value a run can read is `null` (a date, a clock, a
  delta, a calendar, a day mark), whatever is stored: a stale stored clock or date never reaches a run. On a lorebook that
  keeps a timeline, values are as today (`null` only where there is truly none)."
- Correction 3: "**No new async helper.** The fact already exists on every reading: `timelineOff` (`state/reading.ts`
  358–363 …) and `sessionTimelineOf` (`lorebooks/timeline.ts:129`) for settings. Build one **pure** mapper
  `(timelineOff, value) → value | null` fed from `reading.timelineOff`, costing no statement. The guard test scans `host.read.*`
  and `bindings.*` for time column names (`storyClock`, `openedStoryClock`, `year:` …) the way
  `pipelines/runtime/loreWriteDate.guard.test.ts` scans." The supervisor has written the mapper: `timelessNull(timelineOff,
  value)` in `state/storyTime.ts` (after `loreWriteDateOf`). Use it; don't edit it. `state/storyTime.ts` is a heavy module:
  import it dynamically (`await import(...)`) inside the function, as these files already do for heavy modules.
- Correction 4: "**The stat trail: null after sorting and filtering.** `state/statTrail.ts:259` sets `date`, :279 sorts on it,
  :286 filters `since.date` on it; there is a row-level `date` beside `anchor.date`: null both in what is delivered, after
  order and filter, so no point is reordered or dropped." Stop and ask if a filter or an order would change.
- Added item 7: "`core:query/entries-named@1` (`pipelines/runtime/bindings.outlets.ts` 289–350 → `entriesNamedIn` →
  `entriesAsRead`, `lorebooks/loreMatch.ts:318` [actually `pipelines/runtime/loreMatch.ts`]) does not go through
  `readLorebookEntries`: when `reading.timelineOff`, history entries are not returned there either, with the same receipt line
  the sibling reads give. Test. And one clause: the `search_entries` tool's description still says "and history"
  (`tools/coreTools.ts:102`): make it true for both cases in the existing manner of that description."
- Lane tl-4's filter, the model to follow: `pipelines/runtime/host.read.lorebookEntries.ts` ~837–851 (counts live history
  rows: `enabled !== false && archived !== true`) and its receipt `noteHistoryLeftOut(rows, n)` / `historyLeftOutReceipt(rows)`
  (lines 38–53), logged by `bindings.retrieval.ts:381` with `ctx.log("info", line)`. Reuse those two exports — **no new
  sentence**, and don't edit `host.read.lorebookEntries.ts`.
- CLAUDE.md Decisions: a new name, setting or user-visible copy is "Propose and wait … marked ★". The tool description clause
  is briefed (build it) but report its wording as ★. Statement counts must not rise.

## Work

1. **`scenes/earlierScenes.ts`** (`earlierScenesOf`, `openedStoryClock` ~102): with the timeline off, `openedStoryClock` is
   `null`. There is no reading here: fold the switch into the **existing** `rows` select as a scalar subquery, e.g.
   `timelineEnabled: sql<boolean | null>\`(select ${sessionTimelineSql()} from sessions where sessions.id = ${sessionId})\``
   (`sessionTimelineSql` in `lorebooks/timeline.ts` is written against a `"sessions"` row; bind the session id as a
   parameter, never an unqualified column), read it with `timelineOf(...)`, and map
   `openedStoryClock: timelessNull(!timelineOf(row), sceneClockOf(...))`. Zero extra statements. Update `EarlierScene`'s doc.
2. **`state/statTrail.ts`** (`statTrailFor`, ~244–289): when `reading.timelineOff`, every delivered point's `anchor.date` is
   `null`, mapped through `timelessNull` **after** the `.sort` and `.filter`, so order and the `sinceDate` filter are exactly
   as today. (The row-level `date` is not delivered; leave the sort/filter on it.) `moment` is already null then. Don't change
   `forkedAt` (fork cuts stay with the timeline off): report it under Noticed.
3. **Lore rows' dates** (`pipelines/runtime/host.helpers.ts` `toLoreEntry` 1103–1105, `year/month/day`, "History entries
   only"): verify what a run reads with the timeline off — only history declares these fields, and every history row is left
   out upstream (tl-4's filter). Also check whether any lore read delivers an entry's **Beginning** / *began* date (look at
   `toLoreEntry`, `lorebook-entries@1` listing rows, `entriesAsRead` / `toEntryRow` rows that reach a run). If a stored date
   reaches a run with the timeline off, null it through `timelessNull` at that read (stop and ask if the file is not one listed
   below); else change nothing and report the evidence.
4. **`entries-named@1`**: in `entriesNamedIn` (`pipelines/runtime/loreMatch.ts` ~279–370; `reading` is already read there),
   when `reading?.timelineOff`, leave history-type entries (`HISTORY_TYPE_ID`, `$lib/shared/entries/types`) out of what is
   matched and returned, counting the live ones left out of the listing (as tl-4 counts), and hand the count back through
   one optional callback in `opts` (like `onLeftOut`; name it plainly, e.g. `onHistoryLeftOut`). In the binding
   (`bindings.outlets.ts` ~289–380), log the sibling's receipt: `noteHistoryLeftOut(rows, n)` then
   `ctx?.log?.("info", historyLeftOutReceipt(rows))` (only when n > 0). Only when the pipeline's `entryTypes` include history
   can anything be left out. Timeline on: unchanged.
5. **`tools/coreTools.ts:102`** `search_entries` description: "world lore, character lore and history" → true for both cases,
   in that sentence's manner, e.g. "world lore, character lore and, when the lorebook keeps a timeline, history". If a test
   or hash pins tool descriptions, re-pin with "(was …)".
6. **The guard**: new `pipelines/runtime/storyTimeRead.guard.test.ts`, modelled on `loreWriteDate.guard.test.ts` (copy its
   comment stripper and its file#top-level-function keying, checked both ways). Files: every
   `pipelines/runtime/host.read.*.ts` and `pipelines/runtime/bindings.*.ts` (glob them, so a new file is scanned), plus
   `scenes/earlierScenes.ts`, `state/statTrail.ts`, `pipelines/runtime/host.helpers.ts`, `state/presencesOnReading.ts`.
   Pattern: the story-time column / field names a read hands on — at least `storyClock`, `StoryClock(Year|Month|Day|Hour|
   Minute)`, `openedStoryClock`, `closedStoryClock`, `story_clock_`, `sessionStart`, `sceneClockOf(`; calibrate (`year:` alone
   is too broad — say what you chose and why in the header). Rule: a hit passes when its enclosing top-level function also
   calls `timelessNull(`, or when it is in an allowlist entry `{ count, why }`. Expected allowlist entries include
   `host.read.summarize.ts` (stamps not read at all when the timeline is off, `sessionTimelineOf` gate, tl-2e-fix),
   `bindings.prompt.ts` (hands on `earlierScenes`' already-mapped clock), `advance-story-clock@1` (an outlet's input, refused
   with the timeline off), `toLoreEntry` (history-only fields, history left out upstream), presences (★ owner question T2,
   unchanged by design). `host.read.sessionCast.ts`'s `readSessionCast` will call `timelessNull(` (w1); if w1 has not landed
   when you run, say so; the supervisor reruns the guard at the end. Header: purpose, rule, limits (a value read through a
   variable or another helper is not seen).
7. **Tests** (three cases where they apply: `dated`, `undatable`, `timeless` with stale stored values):
   - earlier-scenes: timeless with a stored `opened_story_clock_*` → `openedStoryClock: null`; dated → the clock
     (`scenes/earlierScenes.int.test.ts`, `pipelines/runtime/earlierScenesQuery.int.test.ts`);
   - stat trail: timeless with dated history-anchored points → same points, same order, `anchor.date: null`; with `since.date`
     → the same points as today (`sockets/statTrail.int.test.ts`, `state/lorebookStats.int.test.ts`,
     `state/cardlessSeat.trail.int.test.ts`);
   - entries-named: timeless with a named history entry, `entryTypes` including history → not returned, receipt logged;
     timeline on → returned; switched on again → back (`pipelines/runtime/loreMatch.entriesNamed.int.test.ts`; also run
     `bindings.entryKnowledge.reads.int.test.ts`);
   - tools: `tools/coreTools.test.ts`, `tools/coreTools.knowledge.int.test.ts`; the guard; `loreWriteDate.guard.test.ts`.

## How to run tests — only this form, one at a time, wait first

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-1-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. At most ~12 files per run. Int tests that open a DB inside an `it` need a 60 s timeout. Then
(wait first) `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub > plans/tm-1-w2-tsc.log 2>&1`
and report the error count in your files. `npx prettier --check` your changed files (pre-existing drift is fine; report it).

## Files owned

`src/lib/server/scenes/earlierScenes.ts`, `src/lib/server/state/statTrail.ts`, `src/lib/server/pipelines/runtime/loreMatch.ts`
(`entriesNamedIn`), `src/lib/server/pipelines/runtime/bindings.outlets.ts` (the `entries-named@1` binding only),
`src/lib/server/pipelines/runtime/tools/coreTools.ts` (the description line only), `src/lib/server/pipelines/runtime/host.helpers.ts`
(`toLoreEntry` only, only if item 3 finds a leak), the new guard test, and the test files named above. Any other file: stop and
ask (in your report).

## Stop and ask when

A filter or an order would change; a shipped pipeline or widget needs a stale stored date with the timeline off; a statement
count would rise; you would need a new name beyond the one callback, a new sentence, or an SDK change; message stamps would have
to enter a contract that does not declare them (`session-history@1`, `summarize-source@2`): report instead.

## Report (your final message, under ~550 words)

Changed files; a table: read → part → before → after (timeline off with stale values), one row per read incl. any you found;
item 3's evidence; the guard's files, pattern and allowlist (key → why); the description wording (★); tests run (log paths,
pass/fail), tests changed old → new; tsc count; anything noticed but not done.
