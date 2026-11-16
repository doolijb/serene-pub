# REPORT — build lane `back-intros` — 2026-11-13

Brief: `plans/briefs/BRIEF-back-intros.md` (rewritten after its cold review). **Built by the lead by hand**: every
sub-agent launch (supervisor, workers, on three models) was refused by the API (403) before changing anything.
Worker briefs written but unused: `plans/briefs/BRIEF-back-intros-w1.md`, `-w2.md`.

## The rule as built

- In a genre whose Back steps by message (Story, read off the registered genre), Back has **no first-person-line
  floor**: one press takes the newest live line on the story lane whatever it is, with the rows after it. A
  greeting takes no turn, so the replay leaves it out; `buildTurnUnit` finds the newest live greeting among the
  rows and takes whichever is newer, it or the replay's newest line. Down to a session with no messages; then
  *There is nothing to go back to yet.* Forward restores each.
- **A greeting goes alone.** Its run is the session's create run; the unit holds no run (`greetingHead`), so
  nothing else the create run wrote is taken back (`takeRunWritesElsewhere` is given no runs). What is anchored to
  the greeting's row (the first scene) goes back by the per-row retraction and Forward restores it.
- A character's first reply before any person line is an ordinary line and is taken.
- A genre that takes a whole turn (the Lair, the Dungeon Crawler) keeps its floor and its unit exactly as before.
- **`step`** (`"message" | "turn"`): sent on the rewind state whether or not Back may be pressed (server
  `rewindStateOf`), kept by the client reader and `rewindStateWith` (`shared/sessions/rewind.ts`), carried to the
  dossier (`sessionPageProjections.ts`, `ConversationRewindV1.step`, optional and additive), the strip
  (`RewindStripState.step`), the header's key (`routes/sessions/[id]/+page.svelte`) and `SessionHeaderRewind`
  (`app.d.ts`). Words: *Back one message* · *Forward one message* · *N messages ahead* · *N messages ahead will be
  replaced if you write now.* where the step is `message`; *turn* otherwise; *Regenerate the last turn* everywhere.
  `ComposerWidget.svelte` needed no edit: it prints the strip's `replaceText`.

## Changed files

App: `server/sessions/rewind.ts`, `shared/sessions/rewind.ts`,
`client/components/sessionPage/sessionPageProjections.ts` (the rewind state only),
`routes/sessions/[id]/+page.svelte`, `app.d.ts`, `client/components/Header.svelte`, `FullscreenExit.svelte`; tests:
new `server/sessions/rewind.noFloor.int.test.ts` (10, on the real registered genres),
`client/components/headerBackTakes.dom.test.svelte.ts` (one case), `server/sessions/rewind.int.test.ts` (the
payload's new field); `docs/sessions.md`; NOMENCLATURE §25.
SDK: `sdk/src/sessionDossier.ts`, `core-catalog/src/shared/ui/conversation/rewindStrip.ts`,
`sdk-tests/rewindStrip.test.ts`. SDK rebuilt.

## Verification

SDK `rewindStrip` 8/8, `coreConversationComponent` 60/60, `turnLineBackground` 8/8. App: 13 files, 110 tests pass
(the Back suites, the header tests, the new file). `tsc` clean; `npm run check` 0 errors. Not looked at in a
running app. **Scope review: not run** (sub-agents unreachable); owed.

## Open ★ / noticed, not done

- No test proves, with real run rows, that a greeting's take leaves a create run's writes alone; the test asserts
  the unit holds no run. No test for a fork or an archived session on the new path (those refusals sit after the
  changed block and are unchanged).
- An empty session's page (composer, turn line) has not been looked at in a running app.
- The Dungeon Crawler's and the Lair's welcome lines are ordinary messages before the first person line and stay
  untakeable, as before.

## Scope review and the lead's fixes (2026-11-13)

Scope: no objection. Five findings; fixed with tests except where said.

1. **A greeting's unit dropped every run, and the guard keyed on the greeting, not on the run.** A row filed after
   a greeting lost its run's writes elsewhere; and a plugin genre stepping by message whose create run writes an
   ordinary first line would have had its create run taken back. Now `unitRuns` leaves out **create-role runs**
   (`isCreateRun`, the test `replyRunOf` makes) for every unit, and `greetingHead` is gone. Tested with a real
   create-run row.
2. **Tests the brief asked for.** Added: a greeting written by a real create run; the server sending
   `step: "message"` for Story, also when Back is refused, and `turn` for the Lair; the page's re-check; a row that
   takes no turn. **Still owed:** a line written into an emptied session with Scene 1 opening at it; a fork and an
   archived session on this path; the words on the full-screen strip.
3. `rewindStateOf`'s catch branch dropped `step`: it is read before the `try` and sent on every return.
4. The page's re-check (`rewindStateWith`) still applied the old floor, so in Story a character's first reply
   arriving by push left Back grey until the next re-read. Where the step is `message`, any newest story line lifts
   the refusal (a branch's copy is still the fork).
5. "Down to a session with no messages" was not guaranteed: a row that takes no turn with no line or greeting
   before it was never taken. Back now takes the newest live story row of any kind once no line and no greeting
   is left.

Verification after the fixes: 9 files, 88 tests pass; `tsc` clean.

Owed tests written and passing (2026-11-13): a line written into an emptied session discards what was ahead and is
the story's only row again; a branch's copied line refuses with the fork sentence; an archived session refuses.
Still not covered: the "message" wording inside the full-screen strip's menu (the same two derived labels as the
header's, which are tested).
