# REPORT — lane `sense-eng` — 2026-11-11

Written by the lead from the supervisor's final message (the harness refused the supervisor's own write of this file).

## Built

1. **Turn pool honours the bench (A1).** `src/lib/server/pipelines/runtime/bindings.ts`, the `core:task/turn-pool@1`
   binding and one import: characters filter on `inPlay(cc)`; player seats on
   `inPlay(cp) && (cp.persona ? true : isCardlessPlayerSeat(cp))`. Envoys, the node's declaration, params and options
   unchanged. Tests: `runtime/turnStrategies.test.ts` (two new tests replace "`all` admits one switched off").
2. **Session delete never writes to a book its owner does not own (G2.2).** `src/lib/server/state/durable.ts`, delete
   branch: records nothing when the session's owner and the attached book's owner differ. A22's table otherwise kept
   (Full and Review write the book; Off or no attached book records nothing). Tests: `state/durable.int.test.ts`,
   new describe "the delete safeguard on a book someone else owns".
3. **A move by an amount starts the clock (B11, first half).** `src/lib/server/state/storyTime.ts`: every move starts
   from `present ?? FIRST_STORY_DAY`; the `clockless` parameter and the unreachable throw are gone. Tests:
   `state/sessionStoryClock.int.test.ts`, `state/clockMoves.int.test.ts`. `state/clockMoves.ts` unchanged.

Docs, one sentence or paragraph each: `docs/group-sessions.md`, `docs/stats-and-states.md`, `docs/lorebook-time.md`,
`docs/sessions.md`.

## Tests

One capped run over nine files: **136 passed, 2 failed**. Owned files all pass. The two failures are in files the
lane did not own and follow from item 3 (handed to lane `sense-eng2`):

- `src/lib/server/state/clockProposal.int.test.ts` ~316 — accepting the proposal now starts the clock.
- `src/lib/server/sockets/sessions.timePasses.int.test.ts` ~128 — the press now starts the clock.

Item 3's tests were shown to fail on the old code by reverting and re-running; item 1's and 2's by reasoning from
the diff. `prettier --check` warns on all 11 changed files, each of which already failed at HEAD; nothing reformatted.

## Review inferences

- A1 `all` admits a benched character: **confirmed**. Player filter has no bench test: **confirmed**.
- A1 "a benched player can be shown as ‹name›'s turn": **refuted for the stored turn order** — the host checks the
  pool's candidates against `liveCastRefs` (`host.ts` ~660–724, used ~8848), which uses `seatInPlay`. Within one run
  the raw candidate list did carry the benched player into the orderers; it no longer does.
- G2.2 delete path has no ownership check: **confirmed**. B11 first half: **confirmed**.
- Envoys: pool unchanged. `seatedEnvoys` / `inTurnEnvoys` carry no `is_active`, but no path writes a switched-off
  live envoy today (`unseatEnvoy` sets it with `removedAt`; `setSeatBench` refuses envoys).

## Open ★

1. `characters: "all"` on the turn pool now means the same as `active`; the SDK description still says "'All' admits
   ones switched off" (`../serene-pub-sdk/contracts/src/tasks.ts` ~2966–2985). Recommend: description "Same as
   Active: a benched character never takes a turn" now (handed to `sense-sdk`); drop `all` at 0.7 — removing the
   published name is the owner's call.
2. The Story keeper's clock move or suggestion still refuses on a clockless story: `clockMoveProblem`
   (`state/clockProposal.ts` ~101–105) has its own copy of the start rule. Handed to `sense-eng2`.
3. Plan §5.3 said the delete fix was "the ownership check and honouring Review"; the brief kept A22's table (Review
   writes the book on delete), and that is what was built. The plan line is corrected to match.

## Provisional copy 🚧

- `group-sessions.md`: "**Characters** (active ones, all, or none; a benched character is out of the turns whichever is picked)"
- `stats-and-states.md`: "…and records nothing under **Off**, nor on a lorebook someone else owns."
- `sessions.md`: "On a story with no clock yet it starts the clock on the story's first day (Year 1, month 1, day 1) and moves it from there."
- `lorebook-time.md` ~120: the paragraph on a story with no clock yet (starts on the first day when a move is asked
  for; the state-keeper's move in Story still needs a clock — to be removed by `sense-eng2`).

No new name, setting, flag, event, table or migration.

## Noticed, not done

- `seatedEnvoys` and the cast read do not carry `is_active`; `liveCastRefs` and `noSpeakerRefusal` cannot see an envoy switch-off if one is ever built.
- If the calendar refuses a step from the first story day, `clockSkipReason` still answers `NO_STORY_CLOCK_YET`; accurate, since the rolled-back move left no clock.
- `durable.ts` header keeps "No lorebook: the session's own notes" and "a session with no world recorded nothing" (handed to `sense-doc`, comments only).
- `sessions.participantRemoval.int.test.ts` ~452: a comment says `all` "admits one switched off"; its assertion is still true.
- Docs outside the four owned ones (`genre-story.md`, `genre-dungeon-crawler.md`) may still say a move needs a clock (handed to `sense-doc`).
