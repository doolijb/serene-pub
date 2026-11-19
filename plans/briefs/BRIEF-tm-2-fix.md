# BRIEF — worker task `tm-2-fix` — five scope-review fixes to lane `tm-2` (story time declared)

Repo `/home/jody/github/serene-pub`. SDK not touched. Read first: `plans/REPORT-tm-2-2026-11-17.md`.
Re-verify every file:line.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration; no SDK
edit. Comments state the rule, not the story. No other lane is editing. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-2-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes

1. **The guard's reason for `placementsAt` is false** (`src/lib/server/pipelines/runtime/storyTimeRead.guard.test.ts`
   131–134 says it follows a stale stored clock with the timeline off). In fact `sessionStoryNowOf` →
   `storyNowOf` returns null when the switch is off (`state/storyTime.ts` 285–286), so `placementsAt` returns
   `[]` (`state/presencesOnReading.ts:132`): nobody is placed by a schedule, and no stale weekday or hour is
   used. Correct the allow-list reason to that. Add one test pinning it (timeline off, a stored session clock,
   a schedule placement that would match that clock → no placement).
2. **The settings fallback must not hide a missing `storyTime`** (`src/lib/server/sessions/settings.ts`
   326–328: the default sits before `...cast`, so any non-null read lacking `storyTime` silently gets
   `timeline: true`). Apply the default only when the read returned nothing (`raw == null`). And pin the
   agreement the two shapes promise: in `sessionSettings.timeline.int.test.ts` (find it), assert
   `settings.timeline === settings.cast.storyTime.timeline` for timeline on / off × the session's own notes /
   an attached lorebook.
3. **`cardMemberAt`'s `timelineOff` is required** (`src/lib/server/sockets/amendments.ts` ~560): `timelineOff:
   boolean`, not optional, so a future caller cannot default to "timeline on"; update its one production caller
   (`sprites/choices.ts` 231–238) and the tests.
4. **Pin the receipt in the older test.** `src/lib/server/pipelines/runtime/host.timelineOff.int.test.ts`
   321–331 sends `{year: 9…}` and `{year: 8}` with the timeline off; both now emit *date not changed: this
   lorebook keeps no timeline* but the test asserts no notes at all: add
   `expect(out.notes).toEqual([DATE_NOT_CHANGED_SENTENCE])` (or the exact existing shape) to those cases. If
   the test currently passes with an assertion that notes are empty, find out why (the receipt may not be
   emitted on that path) and report it rather than forcing it.
5. **Say the unbudgeted case truthfully.** With no usable budget `maxTokens` is null
   (`pipelines/runtime/bindings.outlets.ts` 241–245) and `earlierScenesShown` returns every scene that lost a
   line (`transcriptFit.ts:206`): with the timeline off that can be up to 200 compiled summaries; with a budget
   the block stays within its share. Correct the report's sentence ("the block never exceeds its budget") and
   the matching sentence in `docs/lorebook-time.md` / `docs/context-templates.md` if either repeats it; update
   the stale comment "and no history entry" at `bindings.outlets.ts:226`.

Append a "Scope review and fix task" section to `plans/REPORT-tm-2-2026-11-17.md` (also: drop the Noticed item
about `placementsAt`; note "schedules place nobody while the timeline is off").

## Tests

The guard test, the new placement test, `sessionSettings.timeline.int.test.ts`, `state/presencesTimelineOff.int.test.ts`,
`host.timelineOff.int.test.ts`, `host.timelineOff.dateParts.int.test.ts`, the sprites tests that call
`cardMemberAt`. `tsc` 0.

## Report (under 250 words)

Per fix: what changed (file:line); for fix 4 whether the receipt was really emitted on the old test's path;
tests and counts with log names; anything not done.
