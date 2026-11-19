# BRIEF — worker `tm-1-w4` — two reads that still hand a run a stored date with the timeline off

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (read only for you). Supervisor: lane `tm-1`.
Use absolute paths. Paths below are under `src/lib/server/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: you run **no** `sdk:build` (no SDK edit). Never `git checkout / restore / stash` in either repo; never `prettier --write`;
never `pkill -f` a generic pattern; no migration; no `npm run build`; no full test run. Another worker (`tm-1-w3`) edits the
SDK at the same time and **waits for you before it builds**: when your last vitest/tsc run has finished, run
`touch /home/jody/github/serene-pub/plans/tm-1-w4.done` (also if you stop early). Lane `gs-1` edits `sockets/pipelines.ts`,
`pipelines/config/panel/scopes.ts`, `sockets/sessions.pipelines.ts` and client session forms: don't touch them. **Re-read
every file right before you edit it** (several carry other lanes' uncommitted edits: keep them).

## Rules your work depends on (quoted)

- Owner D56 (2026-11-16): "We need the same behavior to match across querying anything that could carry timelines/time."
  Lane rule 2: "on a lorebook that keeps **no timeline**, every story-time value a run can read is `null` (a date, a clock, a
  delta, a calendar, a day mark), whatever is stored: a stale stored clock or date never reaches a run. On a lorebook that
  keeps a timeline, values are as today."
- Correction 3: "**No new async helper.** … one **pure** mapper `(timelineOff, value) → value | null` fed from
  `reading.timelineOff`, costing no statement." It exists: `timelessNull(timelineOff, value)` in `state/storyTime.ts` (import it
  dynamically; it is a heavy module). Don't edit it.
- Correction 4: the stat trail's dates are nulled "after order and filter, so no point is reordered or dropped." (Done in
  `state/statTrail.ts` by w2 when `reading.timelineOff`; your job is to make the flag reach it on the host path.)
- Brief: "dates on lore entries other than history (Beginning / *began*): verify what a run reads with the timeline off, apply
  rule 2". Statement counts must not rise. Stop and ask if a filter, an order or a prompt baseline would change.

## Work

1. **Stat trail / lorebook state on the host path.** `lorebookInScope` (`pipelines/runtime/host.helpers.ts` ~573–655) calls
   `readingOf(db, lorebookId, { branch, moment, forkCut })`; `readingOf` (`state/reading.ts` ~241) reads the switch only when a
   moment is asked, so with the timeline off (the session's moment is null) `reading.timelineOff` is `undefined` and
   `statTrailFor`'s mapping never fires for a run. Fix: when `sessionReading` is there (the `isOwn` case; it is already read),
   pass `timelineEnabled: sessionReading.timelineOff !== true` to `readingOf` (its existing option). Zero statements (it may
   save one when a moment is asked). Leave the non-own (granted lorebook) case as it is and say so in a comment; the supervisor
   reports it. Check every consumer of the reading `lorebookInScope` returns (`host.ts` `lorebook_state` ~2519 and
   `stat_trail` ~2554, and the two callers at ~2387/~2400) and confirm nothing else changes behaviour.
2. **A lore row's Beginning.** `toEntryRow` (`utils/lorebookEntries.ts` ~324) fills a non-history row's `year/month/day` from
   its stored Beginning (when `takesBeginning(typeId)`), and `toLoreEntry` (`pipelines/runtime/host.helpers.ts` ~1103) hands
   them to every lore read a run makes (lanes, `lorebook-entries@1` listing, searches, tools). History rows are already left
   out with the timeline off (`pipelines/runtime/host.read.lorebookEntries.ts` ~833–851, `timelineOff` there). At that same
   place, when `timelineOff`, map each remaining row's `year`, `month`, `day` through `timelessNull` (one pass over the rows
   already read; no statement). Confirm first (grep) that nothing ranks, filters or orders on a non-history row's
   `year/month/day` (the supervisor found none in `pipelines/` or `core-catalog/src`); if something does, stop and report.
   Fix the "History entries only" comment at `toLoreEntry` to say what the fields really carry.
3. **The guard** (`pipelines/runtime/storyTimeRead.guard.test.ts`, by w2): add `host.read.lorebookEntries.ts#readLorebookEntries`
   to its "mapped sites" check (each listed function must call `timelessNull(`), and add `pipelines/runtime/host.helpers.ts`
   to its scanned files if that needs no allowlist entry beyond one for `toLoreEntry` (`why`: mapped at its one caller,
   `readLorebookEntries`). Keep its header accurate.
4. **Tests** (`dated`, `timeless` with stale stored values at least):
   - a run's `stat_trail` read through the host (`ctx.read("stat_trail", …)` / the `core:query/stat-trail@1` binding; find an
     existing host-read harness: grep `stat_trail` in `*.int.test.ts`) on a timeline-off session with dated history-anchored
     points → same points, same order, `anchor.date: null`; timeline on → the dates;
   - a world lore entry with a Beginning (*Began at*) on a timeline-off session → the run's lore read (`lorebook-entries@1`
     listing or `readLorebookEntries`) gives `year/month/day` null; timeline on → the Beginning's date. Good harness:
     `pipelines/runtime/promptAtReading.int.test.ts` or a `host.read.lorebookEntries` int test (grep).
   - Run also: the guard, `loreWriteDate.guard.test.ts`, `state/lorebookStats.int.test.ts`, `sockets/statTrail.int.test.ts`,
     and the existing tests of `host.read.lorebookEntries` (grep; e.g. `promptAtReading.int.test.ts`).
   - **Prompt baselines after your change**: `sockets/sessions.lairUnknownEntries.int.test.ts` and
     `pipelines/runtime/unknownEntries.reply.int.test.ts`, with `KN2_SHA_LOG=plans/tm-1-w4-shas.txt ` before `npx` inside the
     quotes. Compare with `plans/tl-4-shas-after.txt`: shas identical, statement counts equal or lower (report each).

## How to run tests — only this form, one at a time, wait first

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-1-w4-<n>.log 2>&1"
```

Never pipe vitest into `head`. At most ~12 files per run. Int tests that open a DB inside an `it` need a 60 s timeout. Then
(wait first) `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub > plans/tm-1-w4-tsc.log 2>&1`
and report the error count. `npx prettier --check` your changed files (pre-existing drift is fine; report it). Then
`touch /home/jody/github/serene-pub/plans/tm-1-w4.done`.

## Files owned

`src/lib/server/pipelines/runtime/host.helpers.ts` (`lorebookInScope` and the `toLoreEntry` comment only),
`src/lib/server/pipelines/runtime/host.read.lorebookEntries.ts` (the timeline-off block only),
`src/lib/server/pipelines/runtime/storyTimeRead.guard.test.ts`, the test files you extend and one new test file. Any other file:
stop and ask (in your report).

## Report (your final message, under ~450 words)

Changed files; read → part → before → after (timeline off, stale values) for both reads; consumers checked for item 1 and the
grep for item 2; tests run (log paths, pass/fail), tests changed old → new; baseline shas and statements vs `tl-4-shas-after.txt`
per world; tsc count; anything noticed but not done.
