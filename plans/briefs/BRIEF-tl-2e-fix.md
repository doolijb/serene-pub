# BRIEF — worker task `tl-2e-fix` — four scope-review fixes to lane `tl-2e` (no story date in a prompt without a timeline)

Repo `/home/jody/github/serene-pub` (app). SDK `/home/jody/github/serene-pub-sdk`: **do not edit it**. Read
first: `plans/REPORT-tl-2e-2026-11-16.md`, `plans/REPORT-tl-2a-2026-11-16.md` (`SessionSettingsV1.timeline`:
"tells a run whether its session keeps a timeline"; how it is filled in `src/lib/server/sessions/settings.ts`).
Re-verify every file:line below before editing. No other lane is editing.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration. Inside
`db.transaction` only `tx`. Comments state the rule, not the story. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2e-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes

1. **No new key on a published query result.** `src/lib/server/pipelines/runtime/host.read.sessionCast.ts`
   ~592 adds `timeline: false` to `storyTime` in the output of `core:query/session-cast@1`, a `@public` query
   whose SDK shape (`SessionCastV1.storyTime`, `{ now, calendar }`) is closed. Remove the key. `assemble.ts`'s
   `keepsNoTimeline` must instead read what a run already has: **`SessionSettingsV1.timeline`** (find how
   Assemble receives the session's settings, or the nearest value already in its inputs that carries it). If
   Assemble truly has no access to it without a new input or a new read, **stop and report** what it would
   take (do not keep the key, do not add an SDK field).
2. **No extra statement.** With the key gone, the `sessionTimelineOf` call in the cast read goes too: the cast
   read costs exactly what it did before lane `tl-2e` for every session (dated, undatable, timeless). If fix 1
   needs a value from the lorebook row, take it from the row the block already reads (`bookCalendarOf(db,
   storyBook)` ~591 → one inline select of the calendar and the timeline switch, `readStoryCalendar` +
   `timelineOf`), never a second statement. Prove it: the statement counts in the prompt-baseline run return to
   the values in `plans/tl-2c-shas.txt` (or state the exact remaining difference and its cause).
3. **The summary preamble's scene date.** `sceneHeaderOf` (`src/lib/server/scenes/liveScenes.ts` ~1916–1917)
   builds `scene.date` from `openedStoryClock`, and both shipped transcript templates print it: on a lorebook
   that keeps no timeline, `date` is absent (same test the lane uses for "timeless": the scene's lorebook's
   timeline switch; reuse the existing helper, no new derivation). Under the same test, skip the per-message
   stamp read in `host.read.summarize.ts` ~345 (`row.clock`, `dayChanged`) so a transcript carries no day
   marks. A lorebook that keeps a timeline: byte-identical output. Tests for both (timeless with stale stamps →
   no date, no day marks; timeline on → unchanged).
4. **Docs:** `docs/lorebook-time.md`, the sentence the lane added says the prompt carries "no dates on …
   scenes": make it true: a scene name that was written automatically while the timeline was on keeps the day
   in its stored name ("The place and day stay as stored", `liveScenes.ts` ~651–656). One clause, no more.

Also correct `plans/REPORT-tl-2e-2026-11-16.md`: append a short "Fix task" section (what changed, statement
counts before / after), and strike the claim that only undated sessions paid the extra statement (undatable
sessions paid too).

## Tests

The lane's files (`currentDate.storyTime.test.ts`, `promptAtReading.int.test.ts`,
`sessions.storyUndated.int.test.ts`, `datedRows.test.ts`), the summarize / transcript tests you touch, any test
pinning `session-cast`'s output, and both prompt baselines (shas unchanged; statement counts as fix 2 says).
`tsc` 0.

## Report (under 300 words)

Per fix: what changed (file:line); where Assemble now learns the timeline; statement counts per world before /
after; tests with log names; anything not done; **Noticed, not done**.

## Lead's ruling after the first worker stopped (2026-11-16) — this replaces fix 1 and narrows fix 2

Assemble has no access to `SessionSettingsV1.timeline` (`core:task/assemble@2` has no `session` in-port; story
time reaches it only as `cast.storyTime` through `bindings.prompt.ts:532`). Adding an in-port is an SDK contract
change for the owner (recorded as D56). So, for now:

1. **Keep the key `storyTime.timeline: false` as built** (host-side, on the cast read's output), do **not**
   edit the SDK. Mark it 🚧 provisional: one row in `NOMENCLATURE.md` §25 (append to the `tl-2e` entry if one
   exists, else a new dated line: "*new (app, 🚧 provisional, not in the SDK's `SessionCastV1` type; D56)*
   `storyTime.timeline: false` on the cast read: the session's lorebook keeps no timeline"), and a one-line
   comment at the site stating the rule (what the key means and that it is absent when the lorebook keeps a
   timeline).
2. **It must cost no statement.** Replace the `sessionTimelineOf` call and `bookCalendarOf(db, storyBook)`
   (~591) with **one** inline select of the calendar column and the timeline switch (`bookTimelineSql()`) from
   `lorebooks` where id = `storyBook`, then `readStoryCalendar` + `timelineOf` (both exported). Check the case
   where `storyBook` is null. Every session (dated, undatable, timeless) then costs exactly what it did before
   lane `tl-2e`: the baseline run's statement counts return to `plans/tl-2c-shas.txt`'s, shas unchanged; report
   the numbers per world.

Fixes 3 and 4 and the report correction stand as written above.
