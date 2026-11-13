# REPORT — lane `sense-eng2` — 2026-11-11

Written by the lead from the supervisor's final message.

## Built

The Story keeper's clock move or suggestion on a story with no clock now starts on the first story day, as every
other move does. One rule, no second copy.

- `src/lib/server/state/storyTime.ts`: `FIRST_STORY_DAY` exported; nothing else changed.
- `src/lib/server/state/clockProposal.ts`: `clockMoveProblem` starts from
  `clockOf(row) ?? <line's present> ?? FIRST_STORY_DAY`. The "no present to start from" sentence is gone; the other
  refusals (no session; a result that does not land) are unchanged.
- `src/lib/server/state/clockProposal.int.test.ts`: the "can no longer move" test uses a clock with no date at 23:00
  (refused with "no date … run past midnight", proposal stays pending). One test the brief did not list but which
  follows from the change, "backwards, out of bounds or an unknown unit … (§15 G16)", renamed "…a step the clock
  cannot take is a skipped line", keeps its point with the same surviving refusal and now also asserts an unset
  clock gives an ordinary clock line.
- `src/lib/server/sockets/sessions.timePasses.int.test.ts`: the press on a clockless story succeeds; clock
  `{1,1,1,2,0}`; one applied row, `from` `{1,1,1,0,0}`, `cause: "action"`; the head line is an ordinary move.
- `docs/lorebook-time.md` ~120: the keeper exception sentence and its follow-on removed.

## Tests

One capped run, four files: **61 of 61 passed** (`clockProposal.int`, `sessions.timePasses.int`,
`sessionStoryClock.int`, `clockMoves.int`). Changed tests were not run against the old code. `prettier --check`
warns on the four changed `.ts` files, each already failing at HEAD; nothing reformatted.

## Open ★

None. The one new name is the export of the existing constant.

## Provisional copy 🚧

`docs/lorebook-time.md` ~120: "…starts its clock on the story's first day (Year 1, month 1, day 1) when a move is
asked for: **Time passes…**, a reply's tick and the **state-keeper's move or suggestion in Story** start it there
and move it from there, as a pipeline's move **until** a time does, and the line reads as any other move."

## Noticed, not done

- `NO_STORY_CLOCK_YET` is still reachable, narrowly: `clockSkipReason` (`state/clockMoves.ts` ~97) returns it when a
  move is refused and the session still has no present, which now happens only when the calendar refuses a step
  from the first story day. Its sentence ("set one in the lorebook to track time") reads oddly there.
- Stale comments naming "no clock yet" as a reason a move can't be taken: `pipelines/runtime/bindings.state.ts`
  ~912, `pipelines/runtime/host.ts` ~10025, `state/write.ts` ~257, `db/schema.ts` ~10552.
- `docs/rulesets.md:127` (a date-due rule "needs a clock") and `docs/stats-and-states.md:145` (hourly routines wait,
  `WAITS_FOR_CLOCK`) still read as correct for things that are not moves; worth a check.

## After the scope review (lead, 2026-11-11)

The scope reviewer found the start rule still written out twice (`clockProposal.ts` repeated the order
`clock ?? line's present ?? first day`; only the constant was shared). Fixed by the lead: `storyTime.ts` now has one
exported reader, `storyMoveStartOf(db, sessionId, row)`, returning `{ start, present }`; `moveSessionStoryClock` and
`clockMoveProblem` both call it, and `FIRST_STORY_DAY` is private again. `tsc` clean; the four clock test files
pass, 61 of 61. Scope verdict for `sense-eng` and `sense-eng2`: no objection.
