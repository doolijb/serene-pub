# BRIEF ss-7-w2 — the Turn line lists background runs with Stop; Composer "Show the Send button"; held buttons grey

Lane `ss-7`, worker 2 of 2 (w1 builds the server side at the same time; you do not touch its files).
App repo `/home/jody/github/serene-pub`; SDK repo `/home/jody/github/serene-pub-sdk` (edit the SDK there). Read
CLAUDE.md first.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also before `sdk:build`: `pgrep -af "vite"` and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` — if a vite
dev/preview or a vitest run is up, don't build (wait, then re-check). Never `git checkout / restore / stash` in either
repo (most of the SDK is uncommitted). Never `kill -9`. Never `prettier --write`. No migration. Comments state the rule,
not the story. No other product's name in any file. It is a **session**, never a *chat*.

## Goal

1. The **Turn line** lists the session's **background** runs in progress (actions, routines, scene and session
   summaries): name, status words, an elapsed indication, **Stop** when the viewer may stop it; a run a reply caused
   says so; a run parked at review reads as waiting for review with no Stop; more than three collapse to a count that
   expands; a finished one stays a short moment, then goes. Nothing toasts.
2. The Composer gains one setting, 🚧 **Show the Send button** (on by default). Off hides Send / Stop where Enter sends;
   at the compact (phone) width the button always shows.
3. While a run that holds re-runs is in flight, **swipe, regenerate (retry), delete**, the header's **Back** and
   **Regenerate the last turn** are greyed with the one sentence the server refuses with. Edit, Forward, Send, Continue
   unchanged.

## Rulings (quote them; do not reinterpret)

- Owner 2026-11-15: "in our default layouts, we have the activity/turn indicator right above the composer. This needs
  to be updated to show all activity because a lot of background tasks/routines have NO indicator, along with a stop
  and reply button for any pipeline/event/routine running in that session. With that, we should also be able to hide
  the send/stop button in the composer (with a show toggle in it's settings)." "Reply" = the control that fires the
  next turn — **the existing Continue** (`onContinue → conv.request("fire-turn")`; `SessionHostViews.svelte` ~140–144
  "One Continue at a time"): same control, same label, **no second button**.
- Owner 2026-11-16: "no, the button would still be disabled. But have the user manually stop what ever is running
  first". R13 (2026-10-20) still holds for everything else: a routine never makes the session generating, never greys
  Send or Continue.
- Owner 2026-11-13: the reply's own status left the Turn line's left half ("a third copy was noise", NOMENCLATURE
  ~575). Do not bring it back.
- Walk #28, 2026-10-18: the Turn line hides its Stop when the Composer shows one (`TurnLine.svelte` ~61–65). Now that
  check reads the Composer's **Show the Send button**: Send hidden (or no Composer following the same Messages) → the
  Turn line always shows the reply's Stop.
- Owner 2026-10-29: line-bound runs (speaking one line) show only on their line — never on the Turn line.
- R-15 2026-09-15: "a person can always stop a reply, branch a session and rewrite a line" — Edit is never greyed here.
- Members never see model plumbing: names and status words only. Toasts must not cover actions; only a domain
  context toasts — this lane adds no toast.
- The step-time-limit switch will later show on the Turn line: leave a reserved, empty place (a prop or snippet), no
  copy, nothing built for it.

## The contract you build against

- **Shared app module** (exists; do not change its exports): `src/lib/shared/sessions/runsInProgress.ts` —
  `runHoldsReruns({ kind, since, lineBound, parked })`, `waitForRunSentence(name)` (→ *Wait for ‹name› to finish, or
  stop it first.*), `REPLY_RUN_NAME`.
- **The frame (w1 adds it server-side)**: `Sockets.Sessions.RunStatus.Response` (`src/lib/shared/sockets/types.ts`;
  w1 edits that file — you only read it) gains `name?: string`, `since?: number` (epoch ms; present exactly on a
  registered run's frames), `readsMessageId?: number`, `parked?: true`, `mayStop?: boolean`. `sessions:get`'s
  `routineRuns` is **replaced** by `runsInProgress?: RunStatus.Response[]` (every run in progress, `mayStop` for the
  asker, first page only). Until w1 lands the type, code against these names exactly.
- **New SDK names you add (all 🚧, `@experimental`)**:
  - `SessionDossierV1.runsInProgress?: RunInProgressV1[]` — the session's background runs in progress, as the Turn
    line lists them. `RunInProgressV1 = { id: string; kind: 'action' | 'routine' | 'summary'; name: string; status?:
    string; since?: number; readsReplyOf?: string; parked?: true; mayStop: boolean }` (`readsReplyOf` = the speaker
    whose reply caused the run, resolved by the host from `readsMessageId` against the rows it holds; `status` = words
    in the viewer's language). Absent reads as none. A reply run and a line-bound run are never in it.
  - `SessionDossierV1.rerunWaitsFor?: string` — the sentence swipe, regenerate, delete, Back and Regenerate the last
    turn grey with while a run holds them; absent when none does.
  - Widget request `'stop-run': { params: { id: string }; result: void }` — asked by `core` only, group `session`;
    stops the run in progress `id` names (an id from `runsInProgress`). The host answers: a registered run →
    `pipelines:cancelRun { runId }`; a summary → `activity:cancel { id }`. No toast; a refusal resolves quietly (the
    list only offers Stop where `mayStop`).
  - Composer setting `showSend` (boolean, default `true`), label **Show the Send button**, description *On a phone the
    button always shows.* (STYLE-GUIDE §10: help is one sentence.)
  - The host tells a Turn line whether the Composer beside it shows Send as 🚧 `dossier.composer.sendShown?: boolean`,
    read structurally in ONE place the way `composer/target.ts` reads `target` / `writingTo` (not an SDK type field).
  - New widget parts on the Turn line, each as `turn-line.<x>` (no `messages.*` twin — new parts get none): name them
    in your report and in STYLE-GUIDE §6.16's Turn line row; keep them few (e.g. `turn-line.runs`, `turn-line.run`,
    `turn-line.run-name`, `turn-line.run-status`, `turn-line.run-since`, `turn-line.run-stop`, `turn-line.runs-more`,
    `turn-line.notice`).

## What to build

### SDK repo
1. `sdk/src/sessionDossier.ts`: the two dossier fields and `RunInProgressV1` (export it where the dossier types are
   exported). `sdk/src/widgets.ts`: the `stop-run` request in `WidgetRequests`, `WIDGET_REQUEST_ASKERS` (`'core'`) and
   the group table (`'session'`); fix any SDK test that enumerates request kinds (e.g. `sdk-tests/widgetSections.test.ts`).
2. `core-catalog/src/shared/ui/conversation/`: pure helpers in a new `runsInProgress.ts` (exported through the
   conversation index): the Turn line's item words (`<name>` · status words · *waiting for review* when parked ·
   🚧 *reading ‹speaker›'s reply* when `readsReplyOf`) and the elapsed words from `since` and now (e.g. *12 s*, *3 min*).
   `rewindStrip.ts`: `rewindStripState` input gains `waitFor?: string | null`, which greys **Back only** (after
   `notOwner` and `generating`, before the host's reason); Forward is never greyed by it. `messageVerbState.ts`:
   `VerbContext.waitFor?: string` greys `swipe`, `retry` and `delete` with it (after the audience's own word, the same
   order as the other conditions); never `edit`, `branch`, `hide`, `extend`, `stop`. Tests in
   `sdk-tests/rewindStrip.test.ts` and `sdk-tests/conversationVerbState.test.ts`.
3. `core-catalog/components/shared/messages/TurnLine.svelte` (and `turn-line/TurnLineWidget.svelte`):
   - Read `dossier.runsInProgress`. List background runs in the left half. The existing background line (scene
     summaries off `dossier.scenes`, `runningRoutineNames`) is replaced by this list when `runsInProgress` is present;
     keep the old read only as the fallback when it is absent (an older host). Keep: a failed run and Review win the
     left half; the reply's own status is never repeated; line-bound runs never appear.
   - Each item: name, status words, elapsed (ticks at most once a second; nothing pulses or animates under
     `prefers-reduced-motion: reduce`, and the elapsed words then update at most once a minute), **Stop** (a real
     `button`, accessible name *Stop ‹name›*, tonal error per STYLE-GUIDE §6.1) only when `mayStop` and not `parked`,
     asking `conv.request("stop-run", { id })`.
   - More than three: the first three, then a count button (*2 more*) with `aria-expanded` that expands the rest in place
     (or the existing `sp-popover`, your call — say which). The list's new arrivals are announced with
     `aria-live="polite"` on one region (not per item).
   - A finished run (gone from the list) stays for a short moment (about 4 s) as *‹name› finished*, without Stop, then
     goes (component-local state; under reduced motion it simply disappears after the moment, no fade). ★ (lead's
     default): keep it simple and say what you did.
   - Reply's Stop: `composerStops` becomes "the Composer beside this line shows Send (`composer.sendShown !== false`)
     and the newest row is generating". **Continue**: today `nextUp: 'hidden'` hides `NextCharacterBlock` and with it
     Continue — keep that when Send shows; when `sendShown === false`, show `NextCharacterBlock` in `head` mode even if
     `nextUp` is `hidden`, so Continue stays reachable. Record in your report whether Continue showed under *Nothing*
     before (it did not, per the code — verify).
   - A reserved, empty notice place: a `notice?: Snippet` prop rendered in a `turn-line.notice` part only when given; no
     copy.
   - Container queries / phone width: the row wraps; nothing gets a `min-width` wider than the box; 44px targets on
     coarse pointers. Focus order: the list's Stops in reading order, then the right half.
4. `core-catalog/components/shared/composer/settings.ts` (`showSend` in `ComposerSettings`, `COMPOSER_DEFAULTS`,
   `readComposerSettings`), `core-catalog/src/registry/widgets.ts` (the `composer` entry's `showSend` declaration, after
   `showActions`), `ComposerWidget.svelte` (passes it), `messages/SessionComposer.svelte`: a `showSend` prop; Send and
   Stop are not drawn when `!showSend && submitOnEnter` (`submitOnEnter = tier !== "compact"`, ~282); at compact they
   always draw. Enter still sends where it does today.
5. Message verbs: where the conversation builds `VerbContext` for a row (find it: `MessageControls.svelte` /
   `SessionMessage.svelte` / `conversation.svelte.ts`), pass `waitFor: dossier.rerunWaitsFor`.
6. Tests: TurnLine dom tests in the SDK harness pattern (`sdk-tests/coreConversationComponent.test.ts` mounts core
   conversation components; follow it — a new file is fine): list, collapse >3 and expand, Stop asks `stop-run` with
   the id, no Stop when `mayStop` false or parked, parked reads waiting for review, *reading ‹speaker›'s reply*,
   Continue shown while Send hidden (also under `nextUp: hidden`), reply's Stop shown when `sendShown === false`,
   reduced motion, a compact box, roles (`button`, `aria-expanded`, the `aria-live` region). Composer: Send/Stop hidden
   with `showSend: false` at a wide tier, shown at compact. Heavy DOM tests run capped (see Commands); a failing assert
   on a happy-dom element has OOM-killed VS Code — keep assertions on strings/booleans, not elements.
7. `INTEGRATING.md` (`/home/jody/github/serene-pub-sdk/INTEGRATING.md`): the request-kinds row (count and `stop-run`),
   the `session:full` dossier row (the two new fields). Read the rows first; keep their style.

### App repo
8. `src/lib/client/sessions/store/records.ts` + `sessionStore.svelte.ts` (`mergeRunStatus`): keep the five new frame
   fields on `SessionRunRecord`. `src/lib/client/components/sessionPage/sessionPageData.svelte.ts` ~960–980: seed from
   `msg.runsInProgress` in place of `msg.routineRuns` (same reconcile rule: drop held runs the seed does not name).
9. `sessionPageData.svelte.ts` / `sessionPageProjections.ts` (~988): project `runsInProgress` for the dossier — from
   the store's runs: kinds `action` and `routine`, not line-bound, registered (`since` set) or a routine's own frame;
   status words via the page's existing status-text resolver; `readsReplyOf` from `readsMessageId` against the rows
   the page holds (the row's speaker label; omit when the row is not loaded) — plus running summaries for this
   session from the `sceneSummarizesCtx` / `sessionSummarizesCtx` contexts (`Layout.svelte` ~828–855; `getContext`),
   kind `summary`, `id` = the activity id, `mayStop` = the activity is the viewer's (or the viewer is an admin), name
   *Summarizing ‹scene›* / *Summarizing the session* (reuse the existing words). Keep `runningRoutineNames` filled as
   today (published; removing it is the owner's call). `rerunWaitsFor` = `waitForRunSentence(name)` of the first store
   run for which `runHoldsReruns` holds (the reply's name `REPLY_RUN_NAME`), else absent. `generatingOf` unchanged.
10. `src/routes/sessions/[id]/+page.svelte` ~311–330: pass `waitFor: data.rerunWaitsFor` to `rewindStripState`, and grey
    `regeneratePress` (Regenerate the last turn) with it too (find `regeneratePress`; it lives in the session page's
    modules).
11. `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts` `dossierFor` (~640–683): for a Turn line, set
    `composer.sendShown` = some Composer instance in the layout whose target (`targetPick`) is the same Messages copy has
    `showSend !== false` (`widgetSettingValues(composerId).showSend`); false when no Composer follows that copy. Add a
    case to `src/lib/client/sessionLayout/dossierFor.identity.dom.test.svelte.ts` or a new test beside it.
12. `src/lib/client/components/sessionPage/requests/`: `stopRun.ts` (`answerStopRun`) + its row in `index.ts`, and a
    `stopRun.test.ts` (core only — a plugin's widget is refused in words; a registered id emits `pipelines:cancelRun`;
    a summary id emits `activity:cancel`; an unknown id does nothing). `socket.off(event)` always with its handler if
    you listen at all; add no listener unless needed.
13. Docs: `docs/session-layout.md` (the Composer row ~47: the new setting; the Turn line row ~48 and the section
    "The Composer and the Turn line" ~126: background runs with Stop, Continue while Send is hidden, *waiting for
    review*, the finished moment; and what a layout with no Turn line shows: the greyed buttons still carry the
    sentence; a background run then has no Stop on the page — say it plainly). `docs/sessions.md` ~158 (the turn line
    paragraph, left half) — w1 edits other lines of that file: edit only that paragraph, with a small targeted Edit.
    `STYLE-GUIDE.md` §6.16 Turn line row: the new parts. `NOMENCLATURE.md`: amend the **Turn line** (§9 ~538), **turn
    line** (~575) and **Composer** (~533) rows; add rows for 🚧 `runsInProgress` / `RunInProgressV1`, `rerunWaitsFor`,
    `stop-run`, the frame fields `name` · `since` · `readsMessageId` · `parked` · `mayStop` and the sentence *Wait for
    ‹name› to finish, or stop it first.* (read §1, §23, §24 first; never a retired word); record every one in **§25
    Change ledger**.

## Files owned (edit only these)

SDK: `sdk/src/sessionDossier.ts`, `sdk/src/widgets.ts` (the request tables only), `sdk/src/index.ts` (exports only),
`core-catalog/src/shared/ui/conversation/{runsInProgress.ts (new),rewindStrip.ts,messageVerbState.ts,index.ts}`,
`core-catalog/components/shared/messages/{TurnLine.svelte,SessionComposer.svelte,MessageControls.svelte,SessionMessage.svelte,conversation.svelte.ts}`
(the last three only to pass `waitFor`), `core-catalog/components/shared/turn-line/*`, `core-catalog/components/shared/composer/*`,
`core-catalog/src/registry/widgets.ts` (the `composer` entry only), `sdk-tests/` (new and the named test files),
`INTEGRATING.md`.
App: `src/lib/client/sessions/store/{records.ts,sessionStore.svelte.ts}`, `src/lib/client/components/sessionPage/{sessionPageData.svelte.ts,sessionPageProjections.ts}`,
the module holding `regeneratePress`, `src/routes/sessions/[id]/+page.svelte` (the header rewind block only),
`src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts` (`dossierFor` only), `src/lib/client/components/sessionPage/requests/{stopRun.ts,stopRun.test.ts,index.ts}`,
`src/lib/client/styles/widgets.css` (the new turn-line parts' look), tests beside these, `docs/session-layout.md`,
`docs/sessions.md` (the one paragraph), `STYLE-GUIDE.md` (§6.16 row), `NOMENCLATURE.md`.

## Out of scope (never built)

Server code (w1's); a second Reply button; the Runs widget; routine groups; the time-limit switch itself; Auto-advance;
*Keep running while nobody is playing*; event pipelines on the list (not registered yet); removing `runningRoutineNames`
or `routineRuns` consumers outside the files above; changing `generatingOf`, Send's or Continue's rules.

## Stop and ask when (put it in your report and stop that part)

CLAUDE.md §Decisions applies; a name beyond those in this brief; a file outside **Files owned** needs a change (name it
and the change); the SDK harness cannot mount the Turn line; anything would make Send or Continue wait on a routine.

## Commands

- One test run or `sdk:build` at a time across the lane — always through the shared lock:
  `flock /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/ss-7-tests.lock <command>`.
- SDK tests (targeted; the runner is `tsx --test`, see `sdk-tests/package.json`): `cd /home/jody/github/serene-pub-sdk/sdk-tests && flock <lock> systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test <files> > /home/jody/github/serene-pub/plans/ss-7-w2-<name>.log 2>&1"`.
  Some files (e.g. `coreConversationComponent.test.ts`) exercise the built component bundle: read the file's header to
  see whether it needs `sdk:build` first.
- `sdk:build` (needed before app tests read your SDK changes): `cd /home/jody/github/serene-pub && flock <lock> npm run sdk:build > plans/ss-7-w2-sdkbuild.log 2>&1`
  after the checks above. Note the time you ran it in your report.
- App tests: `cd /home/jody/github/serene-pub && flock <lock> systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-7-w2-<name>.log 2>&1"`. Never pipe vitest into `head`.
- Type checks (locked too): `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and
  `NODE_OPTIONS=--max-old-space-size=10240 npm run check`. Report only errors in your files (w1 edits server files).
- Standing failures you must not fix: the files listed failing in `plans/lead-full10.log` (strip ANSI); the SDK's four
  known `sdk:test` failures.

## Done means

The SDK tests you added or touched pass; `sdk:build` succeeded; the app tests you added or touched pass
(`stopRun.test.ts`, the dossierFor test, any sessionStore / pendingReply / sessionPage test that reads `routineRuns`
or the run record); tsc and check show no error in your files; `npx prettier --check` on each edited file.

## Report (your final message)

Changed files in both repos; what you built per step and each choice (collapse shape, finished moment, elapsed ticking);
whether Continue showed under *Nothing* before; every new name and sentence; the new parts; when you ran `sdk:build`;
tests with pass/fail counts and log paths; anything under Stop-and-ask; **Noticed, not done**. Under 700 words.
