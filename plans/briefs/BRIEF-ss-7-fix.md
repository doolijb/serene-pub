# BRIEF — fix lane `ss-7-fix` — six scope-review findings on the Turn line lane

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/briefs/BRIEF-ss-7.md` (sections B–F) and `plans/REPORT-ss-7-2026-11-16.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `kill -9`. Never `npm test`
/ `npm run build` at the SDK root. Delete only your own `/tmp/serene-pub-vitest-*` dirs by name. Before any
`sdk:build`, check `pgrep -af "vite"` and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is
up, don't build. No migration. Sockets: one listener per event family, in its domain context; scoped payloads
carry `sessionId`.

## Fixes (each with a test)

1. **The live region announces the elapsed time every second** (`core-catalog/components/shared/messages/TurnLine.svelte`
   ~332–341, tick ~199). The polite region holds arrivals and *‹name› finished* only; the elapsed text is outside
   it or `aria-hidden="true"`. Dom test: a tick changes no text inside the live region.
2. **At phone width, Send off still changes the Turn line** (two Stops). The Composer keeps Send at the compact
   width (`SessionComposer.svelte` ~1174); the host's `sendShown` (`composerShowsSendFor`,
   `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts` ~647–655, ~700) ignores width. One fact, decided
   once: "Send is shown" is true at the compact width whatever the setting; the Turn line and the Composer read
   that same fact. Test: Turn line at compact width with the setting off shows no second Stop and Continue
   follows **Who is due next** as before.
3. **Two rules for who may stop a run** (P2). `auth/actingPerson.ts` ~10–13: "It is no second rights table".
   Widen `personMay`'s `reply-run` case (~146–158) into the one rule for stopping any run (kinds, starter,
   owner, administrator), and have `mayStopRun` (`pipelines/runtime/runsInProgress.ts` ~154) and
   `pipelinesCancelRun` (`sockets/pipelines.ts` ~5958–5972) delegate to it. No dead case left. NOMENCLATURE §25.
4. **The owner may stop another person's spoken line** (`runsInProgress.ts` ~166): beyond the brief. A
   line-bound run is its starter's and an administrator's to stop, as before the lane. Fix the docs the lane
   changed for this (`docs/sessions.md` ~77, ~152; `docs/pipelines.md` ~338) and the ledger line.
5. **The server can refuse for a run the page was never told about.** Two parts:
   (a) every run that holds the re-run actions is announced to the page when it starts holding and when it stops,
   whether or not it has status words (a holding run with no status shows its name and *working*, 🚧); a run
   whose status is cleared mid-run stays listed until it ends (`sessionPageProjections.ts` ~692; the relay's
   `status: null`); (b) swipe, regenerate and delete first wait for the turn's own background runs to settle
   exactly as retake and Back do (`settle=true`; `sockets/sessions.ts` ~9398, ~9576, ~10008, ~10166 vs ~11477,
   ~11589), so a press a beat after a turn is not refused for a child run that is about to end. Tests: a
   status-less holding run greys the buttons and is listed; a swipe right after a turn succeeds.
6. **Shape and stale text.** Declare `sendShown?: boolean` (`@experimental`) on `SessionDossierV1.composer`
   (`sdk/src/sessionDossier.ts` ~555–571), read it without a cast (`composer/target.ts`), add it to
   `INTEGRATING.md`; rewrite the comment at `pipelines/runtime/runRegistry.ts` ~35–38 to say what now waits for a
   routine (the five re-run actions) and what never does; add *Regenerate the last turn* to
   `docs/pipelines.md` ~338; ledger the helper `composerShowsSendFor` if it stays.

## Done means

- `npm run sdk:build` (after the checks), then `npm run sdk:test` in the capped form
  (`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/ss-7-fix-sdk.log 2>&1"`):
  only the four known failures (regenerate `guides/widgets.md` with `npx tsx scripts/gen-widget-parts.ts` if
  parts changed).
- App tests in that capped form with `npx vitest run --maxWorkers=3 <paths>`, one run at a time:
  `sockets/sessions.runsInProgress.int.test.ts`, `sessions.editedLineRerun.int.test.ts`,
  `pipelines.cancelRunAction.int.test.ts`, `routines/run.frames.test.ts`, the client projection / store /
  request tests the lane added, every `auth/actingPerson*.test.ts`, the Turn line and Composer dom tests.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors;
  `NODE_OPTIONS=--max-old-space-size=10240 npm run check` 0 errors.

## Report

Final message = the report (lead appends it to `plans/REPORT-ss-7-2026-11-16.md`): each fix with file:line,
tests with results, anything not done. Under about 500 words.
