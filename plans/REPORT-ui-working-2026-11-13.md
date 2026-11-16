# REPORT — build lane `ui-working` — 2026-11-13

Brief: `plans/briefs/BRIEF-ui-working.md` (rewritten after its cold review). **The supervisor was cut off by a
service error just before its final typecheck and returned no report; the lead finished the lane from the tree.**
Worker briefs: `plans/briefs/BRIEF-ui-working-w1.md`, `-w2.md`.

## The rule as built (read from the code by the lead)

- **Routine runs.** `pipelines/routines/run.ts` `showRoutineRun`: a routine run sends one `sessions:runStatus`
  frame (kind `routine`, `routine: { name }`) once it has lasted past `QUEUE_STATUS_DELAY_MS`, and a clearing frame
  at its end and when it parks at a review gate; a run shorter than the delay sends nothing. The registry status is
  never set, so the session list's row status is unchanged. No new event, table or server list module.
- **The page.** The frames land in the session store's runs; `derive.ts` builds the names of routine runs showing
  now; the dossier carries them as the optional, additive `runningRoutineNames?: string[]`
  (`sdk/src/sessionDossier.ts`). In-flight runs are added to the first load.
- **Scene summaries** need nothing new: the turn line reads the dossier's scenes whose `summaryStatus` is
  `running`, for the session's owner.
- **The turn line** (`core-catalog/components/shared/messages/TurnLine.svelte`): when no reply is live or failed
  and nothing waits for review, the left half says *Summarizing ‹scene›* (or *Summarizing a scene*),
  *‹routine› is running*, or *N things are running in the background* with the items in the tooltip and a popover
  labelled *Running in the background*. No Stop. The right half is unchanged.
- Spoken-line runs are left out (line-bound by the 2026-10-29 ruling; the banners already say *… is speaking…*).

## Changed files

App: `server/pipelines/routines/run.ts`, `runs.ts`, `server/pipelines/runtime/runStatus.ts`,
`shared/sockets/types.ts`, `client/sessions/store/{derive.ts,records.ts,sessionStore.svelte.ts}` and their tests,
`client/components/sessionPage/{sessionPageData.svelte.ts,sessionPageProjections.ts}`,
`client/components/sidebars/SessionsSidebar.svelte`, new `server/pipelines/routines/run.frames.test.ts`;
`docs/sessions.md` (the turn line's sentence, added by the lead); NOMENCLATURE §25.
SDK: `core-catalog/components/shared/messages/TurnLine.svelte`, `sdk/src/sessionDossier.ts`, `INTEGRATING.md`, new
`sdk-tests/turnLineBackground.test.ts`. The SDK was rebuilt by the lane.

## Verification (lead)

SDK `turnLineBackground` 8/8. App: 43 files, 463 of 466 tests pass; the three failures are older and not this
lane's (`shared/conformance/wiring.test.ts`: the read-aloud step's ports and `clock-step.unless`;
`sockets/sessions.forms.int`). `tsc` clean. `npm run check`: 4 errors, all in files another session is editing
(`server/messages/store.ts`, `store.contentMirror.int.test.ts`, `plugins/storageHost.test.ts`); none in this lane's.
Not looked at in a running app. Scope review: pending.

## Scope review and the lead's fixes (2026-11-13)

Scope held: no new event, table or setting. Fixed, with tests where one could be written:

1. **A missed end frame left "X is running" up until the person left the session** (a run that died with the
   server, a dropped socket). The first load is now the truth for routine runs: a routine run the page still
   holds that the load does not name is dropped (`sessionPageData.svelte.ts`). A reconnect that makes no new first
   load is still a gap (noticed, not done).
2. **Two popovers shared one open state** in the turn line, so the background list being open made Review's
   popover open by itself when the line changed hands. The background list has its own state.
3. **A run with nothing to send on could be marked as shown** and then reach a page's first load with no end
   frame to clear it. With no channel, nothing is shown (`run.ts`; tested).
4. **★ for the owner:** `sessions:runStatus` gained an optional `routine: { name }` (additive); the sidebar's row
   status stays as it was by skipping frames that carry it. `routines/runs.ts` gained `RoutineRunFact.shownAs`.
5. The changed-files list above omits `src/lib/server/sockets/sessions.ts` (`buildSessionGetResponse` seeds
   `routineRuns`); no test asserts that `sessions:get` carries them (gap).
   A parked run that resumes does not show again.

## Same change: the duplicate "is thinking" pill removed (owner, 2026-11-13)

Owner: "char is typing" showed three times: in the message, as a badge below the message, and in the pipeline
status. The badge was the turn line's left pill, a copy of the row's own status. While a reply streams the turn
line's left half now says nothing (the row says it beside the name, the run's card above the composer says it with
its step); *Last run failed* and *Review N changes* stay; the background line stays quiet while a reply streams.
`TurnLine.svelte`, `sdk-tests/turnLineBackground.test.ts`, `sdk-tests/coreConversationComponent.test.ts`,
`docs/sessions.md`, NOMENCLATURE's turn line row. SDK rebuilt. Left: the `live` ember style in the app's
`widgets.css` is now unused.

## Same day: the "stopped" toast (owner: "says stopped twice")

A reply started by Continue, Pick who speaks or the narrator's turn and then stopped was answered as an error
(`sessions:fireTurn:error`, `error: "stopped"`), and both Layout's catch-all and the session page toasted it under
one toast id, so it read "stopped" as title and text. Now a stopped reply is not an error
(`sockets/sessions.ts`; test in `sessions/fireTurn.int.test.ts`), and `sessions:fireTurn:error` is in
`HANDLED_ERROR_EVENTS` so any other refusal shows its sentence once (`Layout.svelte`,
`layoutHandledErrors.test.ts`; edited with the performance session's agreement, which owns that file).

Verification: SDK `turnLineBackground` 8/8, `coreConversationComponent` 60/60; app 26 files, 428 of 433 pass; the
five failures are in `pipelines/runtime/runStatus.int.test.ts`, whose mock of `broadcastHelpers` lacks the
`emitToRecipients` export the performance session's lane added (theirs, relayed). `tsc` clean.
