# BRIEF ss-7-w3 — scope-review fixes for lane ss-7

Lane `ss-7`, worker 3 (the only worker live). App `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`.
Read CLAUDE.md first. Workers w1 (server) and w2 (SDK widgets + page) finished; their briefs are
`plans/briefs/BRIEF-ss-7-w1.md` and `-w2.md` (read for context). A scope review found the five items below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build`; the supervisor runs it after you.)

Never `git checkout / restore / stash` in either repo. Never `kill -9`. Never `prettier --write`. Comments state the
rule, not the story (no lane ids, no "before this…"). No other product's name. A session, never a chat.

## Fixes

1. **One rule for who may stop a run.** Today `src/lib/server/sockets/pipelines.ts` (`pipelinesCancelRun`, the
   not-the-starter branch) and `src/lib/server/pipelines/runtime/runsInProgress.ts` (`MEMBER_STOPPABLE`, `mayStopFor`
   ~147–158) decide it twice and disagree on a line-bound run. The rule (as `docs/sessions.md` now says): the run's
   starter; an administrator, anything; any member of the session (`checkSessionAccess(...).hasAccess`) a non-line-bound
   `reply`, `action` or `routine`; the session's owner (`isOwner`) everything else (a line-bound run, a `maintenance`
   run). Write ONE exported sync helper in `runtime/runsInProgress.ts`, e.g. `mayStopRun(handle, viewer: { userId;
   isAdmin; hasAccess; isOwner })`, and use it from both the door and the first-page frames (`mayStopFor` becomes a
   call to it, or goes). Frame-level `mayStop` (pushed frames, "every member may stop it") stays as it is. Keep "Not
   your run." as the door's refusal. Do not edit `src/lib/server/auth/actingPerson.ts` (its `reply-run` case is now
   unused: leave it, mention it in your report).
2. **`stop-run` with an unknown id does nothing.** `src/lib/client/components/sessionPage/requests/stopRun.ts`: give
   `StopRunDeps` an `isSummary(id)` (true when the id is one of the summaries the page projects into
   `runsInProgress` — read the projection's summary list in `sessionPageData.svelte.ts` / `sessionPageProjections.ts`;
   expose what you need through the page deps already handed to `WIDGET_REQUEST_ANSWERS`, without new socket
   listeners). A held registered run with `mayStop` → `cancelRun`; a summary → `cancelActivity`; anything else →
   nothing. Wire it in `requests/index.ts`; restore the unknown-id case in `stopRun.test.ts`.
3. **Comment fixes.** `core-catalog/components/shared/messages/TurnLine.svelte`: the comment claiming the runs region
   is "Empty (and not drawn) with nothing to say" is wrong (the `aria-live` region is always drawn; say what is true).
   `/home/jody/github/serene-pub-sdk/sdk/src/sessionDossier.ts` ~418–426: `RunInProgressV1` was inserted between
   `ConversationRewindV1`'s doc comment and its interface — move `RunInProgressV1` (with its own doc) so the rewind
   type gets its doc comment (with its `@ruling`) back, directly above it. `runtime/runsInProgress.ts` line ~2: drop the
   lane id from the header comment.
4. **NOMENCLATURE §25 entry for the server half.** In `/home/jody/github/serene-pub/NOMENCLATURE.md`, beside the
   existing ss-7 ledger line (~4313, labelled worker 2), add one ss-7 server entry, in the ledger's own style, listing:
   🚧 `RunHandle.name` · `readsMessageId` · `parked`; `setParked`, `runOfSignal` (`runRegistry.ts`); the new module
   `runtime/runsInProgress.ts` and its exports (`runFrameFacts`, `runShownName`, `heldBy`, `quietRefusal`,
   `runsInProgressFor`, `announceRun`, `noteRunIo`, `forgetRunIo`, and the helper from fix 1); `heldRerunRefusal`
   (`sockets/sessions.ts`); the shared `src/lib/shared/sessions/runsInProgress.ts` (`runHoldsReruns`,
   `waitForRunSentence`, `REPLY_RUN_NAME`, `RUN_KINDS_HOLDING_RERUNS`); **removed**: `routineRunFramesOf` (replaced by
   `runsInProgressFor`) and the `sessions:get` field `routineRuns` (replaced by `runsInProgress`); **changed** (★, lead's
   default, awaiting the owner): who may stop a run — "whoever a run blocks may stop it" (rule of fix 1). Also correct
   the w2 line's claim that the `sessions:get` `runsInProgress` and `SessionDossierV1.runsInProgress` are "the same
   list, one meaning": say plainly that the first-page list holds every run in progress as frames (replies and
   line-bound runs included) while the dossier field holds only the background runs the Turn line lists (plus
   summaries), and mark that double use 🚧 pending a rename (the supervisor raises it). Read NOMENCLATURE §1 and §24
   before writing.

## Files owned (edit only these)

`src/lib/server/sockets/pipelines.ts` (`pipelinesCancelRun` only) · `src/lib/server/pipelines/runtime/runsInProgress.ts` ·
`src/lib/server/sockets/sessions.runsInProgress.int.test.ts` and `src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`
(add a case: the owner stops a member's line-bound run; the door and the first-page `mayStop` agree) ·
`src/lib/client/components/sessionPage/requests/{stopRun.ts,stopRun.test.ts,index.ts}` ·
`src/lib/client/components/sessionPage/{sessionPageData.svelte.ts,sessionPageProjections.ts}` (only to expose the
summary ids) · `core-catalog/components/shared/messages/TurnLine.svelte` (the one comment) ·
`sdk/src/sessionDossier.ts` (moving the type and doc comments only) · `NOMENCLATURE.md` (§25 only).

## Commands

Tests, capped and serialized: `cd /home/jody/github/serene-pub && flock /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/ss-7-tests.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-7-w3-<name>.log 2>&1"`, then read the log (strip ANSI). Never pipe vitest into `head`.
Type check (locked the same way): `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`.

## Done means

`sessions.runsInProgress.int.test.ts`, `pipelines.cancelRunAction.int.test.ts`, `requests/stopRun.test.ts`,
`requests/askers.test.ts`, `requests/index.test.ts` (if it exists) and `runsInProgress.projection.test.ts` pass; tsc 0
errors in your files; `npx prettier --check` on the files you created.

## Stop and ask when

CLAUDE.md §Decisions applies; a new name beyond the helper of fix 1; any file outside **Files owned**.

## Report (your final message)

Changed files; what you did per fix; tests with pass/fail counts and log paths; **Noticed, not done**. Under 350 words.
