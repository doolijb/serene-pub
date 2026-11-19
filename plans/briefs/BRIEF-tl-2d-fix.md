# BRIEF — worker task `tl-2d-fix` — two defects left by lane `tl-2d` (found by lane `tl-2c`)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-tl-2d-2026-11-16.md` §5 and §8,
`plans/REPORT-tl-2c-2026-11-16.md` "Noticed, not done", `docs/lorebook-time.md` (clock moves on a story with no
date). Re-verify everything below in the code before editing.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration; no SDK
edit (if the fix needs one, stop and report). Lane `tl-2e` is editing the prompt's date read
(`pipelines/**/assemble.ts`) and may add an export to `state/storyTime.ts`: re-read `storyTime.ts` right before
each edit, small targeted edits only. Inside `db.transaction` only `tx`. Comments state the rule, not the story.
Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2d-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Owner (2026-11-16)

"There shouldn't be a scenario where it defaults to 1-1-1." Built by `tl-2d`: a clock move on a story with no
date is refused with *This story has no date yet, so its clock can't move. Set the story clock in the
lorebook's Book settings first.* (`UNDATED_MOVE_SENTENCE`).

## Fix 1 — "Time passes…" on a story with no date says it worked and moves nothing

`src/lib/server/sockets/sessions.timePasses.int.test.ts` "a story with no clock: the press starts it on the
first day" fails since `FIRST_STORY_DAY` was removed: the press replies `success: true` while the clock stays
null. Find the handler and the path the press takes (the clock-move function it calls and how its refusal /
skip result is turned into the reply). Required behaviour: the press on a story with no date **is refused in
words**: the reply carries the existing sentence the way this handler already reports its other refusals (find
one, e.g. the timeline-off refusal, and follow it exactly: same reply shape, same place the person sees it; no
toast from a view), nothing is written (no message, no receipt claiming a move, no clock). If a pipeline step
with `onRefusal: 'skip'` is what swallows it, the person's own press must still get the refusal, while a
pipeline's own skipped move keeps its ledger line as `tl-2d` built. Re-pin the test: new title "a story with no
date: the press is refused in words", asserting the reply, the sentence, and that nothing changed. Check the
sibling presses that move the clock (**After a rest**, any other socket that calls the same function) for the
same false success and fix them the same way; list each.

## Fix 2 — a history write with a month or day and no year gets the unclear sentence

`src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts` "a month or a day without a year is
refused…" fails since the history type's `year` lost its default: `typedFieldsOf` now refuses first with
"*'year' is required…*" instead of the sentence that test pins (a history date needs a year…). Restore the
clearer sentence for this case by ordering the checks (the date check before the typed-fields check for a
history entry), without changing any other refusal; the test passes unchanged. If that order cannot be had
without changing another pinned refusal, stop and report both sentences.

## Tests

The two files above, plus `state/clockMoves*.test.ts`, `state/clockProposal*.test.ts`,
`state/sessionStoryClock.int.test.ts`, `sockets/sessions.timePasses.int.test.ts`,
`pipelines/runtime/host.historyWrites.int.test.ts`, `host.undatedWriteBackstop.int.test.ts`,
`state/loreWriteDate.guard.test.ts` (find exact names with `ls`). `tsc` 0.

## Report (under 300 words)

Per fix: cause (file:line), what changed, the reply the person now gets; siblings checked; tests and counts
with log names; anything not done; **Noticed, not done**.
