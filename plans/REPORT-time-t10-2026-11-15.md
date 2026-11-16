# REPORT — build lane `time-t10` — moving the story clock back follows On revision (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t10.md` (its Corrections rule). Saved by the lead from the supervisor's final
message. Built and green; **not looked at in a running app.** No migration, SDK edit, build or commit. The
supervisor ran its own scope review (no objection on files or scope; three small fixes applied).

## Inventory

1. The clock moves through `sessions:setStoryClock` (`sockets/storyClock.ts:145–227`: set, step with a negative
   `by`, follow, which moves back when the session's own clock is ahead of its line's present); `sessions:update`
   (`sockets/sessions.ts:6841`, `sessionLinePatch`); **Time passes…** through the outlet (`host.ts:10613–10650`,
   `cause:'action'`), the only pipeline path that moves it back; the keeper, rounds, ticks and clock targets move
   forward only; retractions step it back inside an already confirmed revision. None did anything about earlier
   writes.
2. "This session wrote it": `lore_imprints` rows of kind `version` (the version's date) and `relationship` (dated
   through the tie's history entry); `character_versions.source_session_id`; the session's scenes (the history
   day they are filed under, else the day they opened).
3. Branch needed no change to `branch.ts`: the branch is made at the newest live message, then its clock is set;
   its line forks at that date on the first write (tested).
4. The Chronicle can only show "Not done", so the page handler asks.

## The rule as built

`clockMoveBackNotice` (new `sessions/clockMoveBack.ts`) is the one decider: a move counts when it goes back and
passes at least one of the session's dated writes on its line (the write reads at the start date and not at the
destination). The clock door and Session settings refuse such a move with the notice until it comes back
confirmed. Overwrite: today's write, nothing removed. Branch: `moveClockBackOnBranch` makes the branch, then
sets its clock; the reply carries `branchedTo` and the client goes there. In Session settings under Branch the
branch is made after every other write of the save. **Time passes…** with Back is skipped with its sentence on
the ledger line; any other pipeline move back gets the guard sentence (3 lines in `host.ts`).

## Changed files

New: `sessions/clockMoveBack.ts`, `sessionPage/clockMoveBackConfirm.ts`, tests
(`runtime/host.clockMoveBack.int`, `sockets/storyClock.moveBack.int`, `sockets/sessions.clockMoveBack.int`,
`sessionForms/editSessionClockMoveBack.dom`, unit and DOM tests of the confirm). Edited: `sessions/revision.ts`,
`sockets/storyClock.ts`, `runtime/host.ts`, `sockets/sessions.ts` (the clock part of the update handler),
`shared/sockets/types.ts`, `sessionPage/requests/storyClock.ts`, `requests/index.ts`, `EditSessionForm.svelte`,
`docs/sessions.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md` (the On revision row, both meanings of Overwrite;
§25).

## Tests

Targeted: 76 files, 475 pass (`plans/time-t10-targeted-2.log`). Wide regression (`sessions.*`, `storyClock*`,
`state`, `sessions`, `routines`): 273 files, 2194 pass, 4 fail (`sessions.forms.int` and three in
`genreFieldDefaults.int`: both long known, another programme's). `tsc` 0 errors; `npm run check` 0 errors.

## Names and sentences (all 🚧; NOMENCLATURE §25)

Wire: `ClockMoveBackNotice`, `moveTo`, `clockMoveBack`, `confirmClockMoveBack`; `branchedTo` reused. Copy: *Move
the story back?*; *This moves the story back before ‹n› thing(s) this session has written, the latest dated
‹date›. They stay in the lorebook and read again from their dates.*; *This branches the session here and moves
the branch's story back to ‹date›. What this session has written dated after that stays on the line it leaves.*;
**Move back** / **Branch and move back**; *The story clock was not moved.*; the **Time passes…** and guard
refusals; *This session has no messages yet, so there is nothing to branch from.*

## Open ★

- ★T10-1 the copy and wire names.
- ★T10-2 the question counts what this move passes; writes already ahead from an earlier move back do not ask
  again.
- ★T10-3 Branch in Session settings saves the other edits on the old session and the branch inherits them.

## Noticed, not done

The session page mounts the question with `mount()` because the route file was not the lane's; a free-form
calendar refuses a step back by days from day 1; after a Branch the clock door re-lists for every member, Session
settings only for the caller.

## Scope review and lead follow-up (2026-11-15)

Scope review: nothing built beyond the brief; every query is scoped to the session and its lorebook; both doors
refuse before any write; authorisation unchanged; `host.ts` checks inside the transaction on `tx`. Fixed by the
lead (`tsc` 0 errors):
1. **Under Branch, a Session settings save could apply its other edits, make a branch nobody was told about and
   never move the clock** when the date did not fit the calendar (the date was first checked after the branch
   existed). The date is now checked against the lorebook's calendar before anything is saved; and if the branch
   step still fails the refusal says *Your other changes were saved, but the story clock was not moved. …* 🚧
2. The session page's question answers "no" and closes when the person leaves the page it was asked on.
Left for the owner with ★T10-1: the notice reaches Session settings through a new `moveTo` field on the
`sessions:storyClock` read and one extra round trip per clock-changing save, where the brief said the refused
save would carry it.

## Grouped verification (lead, 2026-11-15, third) — `time-t5a` + fix, `time-t10`, `time-t6a`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full4.log`): 2498 files,
2473 pass, 23 fail; 26,190 tests pass, 28 fail. Of the 23: 19 are the known baseline; 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`); 1 is `sessionPage/remoteChronicle.dom`, which waits on the held
SDK rebuild (it asserts the reworded note); 1 is a teardown flake (`state/valueStamp.int`: `ENOTEMPTY` removing
its temp dir; the file is from 2026-11-11 and untouched). None is these lanes'. Still held behind the owner's
own server on port 4173: `npm run sdk:build` and `npm run build`.
