# BRIEF — build lane `ss-7` — the Turn line shows every run with Stop; re-run actions wait for a quiet session (programme 2.7 + 0.9)

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-session-settings-cleanup-2026-11-15.md` §S8 and §S10, `plans/PLAN-programme-2026-11-15.md` rows 0.9
and 2.7, `docs/session-layout.md` (Turn line, Composer, While you were away, Runs), `docs/sessions.md`
(routines, Stop), `STYLE-GUIDE.md` (the sections for rows, buttons, status words, a11y, copy),
`../serene-pub-sdk/INTEGRATING.md` §1e, §1i (routines, the queue), the widget contract parts, `NOMENCLATURE.md`
§1, §23, §24 and the rows **Turn line**, **Composer**, **Runs**, **routine**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash`; `npx prettier --check <file>` only, never `--write`. Never commit. Never `kill -9`. Never
`npm test` / `npm run build` at the SDK root. Delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Before any `sdk:build`, check `pgrep -af "vite"` and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
if one is up, don't build. Sockets: one domain context per event family is the only listener and the only place
that toasts; an event in `SCOPED_EVENTS` carries its scope key (`sessionId`) or `emitToUser` sends nothing;
`socket.off(event)` always with its handler. Browser code runs on plain-http LAN addresses and phones. Another
lane is splitting `src/lib/server/pipelines/runtime/bindings.ts` into `bindings.*.ts` files: do not edit
`bindings.ts` or its siblings; if this lane needs a binding changed, stop and report.

## Owner rulings, 2026-11-15 / 16 (quote them in worker briefs)

- "in our default layouts, we have the activity/turn indicator right above the composer. This needs to be
  updated to show all activity because a lot of background tasks/routines have NO indicator, along with a stop
  and reply button for any pipeline/event/routine running in that session. With that, we should also be able to
  hide the send/stop button in the composer (with a show toggle in it's settings)." ("reply" = the control that
  fires the next turn: ruled.)
- On a routine still writing after a swipe: "Shouldn't need to automatically stop/backtrack the routines etc if
  the activity is properly surfaced in the activity/turn bar"; "no, the button would still be disabled. But have
  the user manually stop what ever is running first".
- The step-time-limit switch being on must show "in the session activity/turn order widget" (that switch is a
  later lane; leave a place for it, build nothing for it).
- Standing: members never see model plumbing (names and status words only); P1 (every automatic action shows
  its cause and how to stop it); toasts must not cover actions; a session, never a chat.

## What to build

### A. Inventory (supervisor, read-only; file:line in the report)

What the page is told about runs in progress today (socket events, the turn-order and session-runs widgets in
`../serene-pub-sdk/core-catalog/src/shared/ui/`, the Turn line's component and data source, "who is typing",
speech status); every kind of run that can be in flight in a session (a reply, an action, an event's pipeline,
a routine firing, a detached summarizer, speech, image generation) and where each is tracked server-side
(`pipelines/routines/queue.ts`, the generation lock, `pipeline_runs`, `llmQueue`); the cancellation path per
kind (the cancellation architecture is built: find its entry points) and who may cancel today; the server's
busy door (`sockets/sessions.ts` ~3163–3239) and every action it guards; how many runs can be in flight at
once; the widget settings contract (how the Turn line's **Who is due next** and the Composer's settings are
declared, stored and rendered); the regression test `src/lib/server/sockets/sessions.editedLineRerun.int.test.ts`
(its race case is `it.fails`).

### B. The session's runs in progress — extend what exists (v2, after cold review 2026-11-16)

The push and the client store already exist: `sessions:runStatus` sends every registered run's start, status and
end, with kind and routine name (`pipelines/runtime/runStatus.ts` ~94–130, ~373; `routines/run.ts` ~154); the
client keeps them in `sessionStore.runsOf` (`src/lib/client/sessions/store/derive.ts` ~35). **Do not add a second
channel** (P2). Extend that frame with what the Turn line needs (`name` as shown, `since`, `readsMessageId` when
a reply caused the run, `parked` for a run waiting at review, `mayStop` for this viewer) and seed it from the run
registry in the session's initial payload. Names and status words only; never a model, connection, loadout or
prompt name.

Not in the registry today (inventory, then follow this):
- **Event pipelines started without a parent run** have no registry entry (`pipelines/runtime/sessionEvents.ts`
  ~994–1008; that code records that registering them once "shut the session's verbs while it ran"). Listing and
  stopping them needs registering them there: **stop and report the design before doing it** (that file is not
  owned by default).
- **Scene and session summaries** are tracked in `activityStore` and stopped through `activity:cancel`
  (`sockets/scenes.ts` ~1914–1937, `sockets/summarize.ts` ~109–119, `sockets/activity.ts` ~64–69). Show them on
  the Turn line from that store; do not move them.

### C. Stop — the existing door

`pipelines:cancelRun` (`sockets/pipelines.ts` ~5930–5985) is the one door; `activity:cancel` for summaries.
Today's rule stays: **any member may stop a waiting reply** ("a waiting reply is the room's to stop",
`pipelines.ts` ~5953; `docs/sessions.md` ~152). New (★, lead's default): **whoever a run blocks may stop it** —
any member of the session may stop a routine, action or event run that counts for D; administrators may stop
anything. Stopping takes back nothing that already landed.

### D. Re-run and remove actions wait for a quiet session

**Rulings on both sides (quote both in worker briefs):** R13, 2026-10-20: "a routine never makes the session
busy: a person's work goes ahead of it, never behind it" (`runRegistry.ts` ~33–37). Owner, 2026-11-16: "the
button would still be disabled. But have the user manually stop what ever is running first". The later words
rule for the actions below, and only for them.

- **The runs that count**: the session's registered reply, action, routine and (once registered) event runs
  that are executing or waiting for a model. **Not counted**: a run parked at review ("a run parked at review
  keep[s] the session pressable", `sockets/sessions.ts` ~3178; `docs/pipelines.md` ~338); line-bound speech
  (`speech/onMessageSettled.ts` ~259–267; owner 2026-10-29: line-bound runs show on their line); summaries in
  `activityStore` unless the inventory shows they write from the reply being re-run (then report).
- While a counted run is in flight, **swipe, regenerate, retake, Back and delete are refused** by the server
  (extend the busy door) with one sentence (🚧 *Wait for ‹name› to finish, or stop it first.*), and their buttons
  are disabled with that sentence as title / accessible description. Forward is not in the list.
- **Edit is NOT refused in this lane.** R-15, 2026-09-15: "a person can always stop a reply, branch a session
  and rewrite a line" (`MESSAGE_VERB_FLOORS = ['stop','branch','edit']`, `sdk/src/descriptors.ts` ~419–427,
  ~1118–1123). Whether an edit should wait for runs reading the edited line is with the owner.
- Sending a new line and Continue keep today's rules. A run waiting behind another session's model call
  (`utils/llmQueue.ts` ~69, routine priority) still counts; it is stoppable by whoever it blocks (C).
- `sessions.editedLineRerun.int.test.ts`: the race case becomes a plain `it` asserting the swipe is refused
  while the routine runs and re-runs cleanly after the routine is stopped or finishes.
- Docs that say background work never holds a person up (`docs/sessions.md` ~158, `docs/pipelines.md` ~338) are
  rewritten in the same change to say exactly what waits.

### E. The Turn line (`core-catalog/components/shared/messages/TurnLine.svelte`)

Rulings to keep: owner 2026-11-13, the reply's own status left the Turn line's left half ("a third copy was
noise", NOMENCLATURE ~575); walk #28, 2026-10-18, the Turn line hides its Stop when the Composer shows one
(`TurnLine.svelte` ~61–65); owner 2026-10-29, line-bound runs show only on their line.

- Lists the **background** runs in progress (actions, routines, event runs, summaries): name, status words, an
  elapsed indication that does not animate under reduced motion, **Stop** when `mayStop`; a run caused by a
  reply says so (🚧 *reading ‹speaker›'s reply*); a parked run reads as waiting for review and has no Stop here;
  more than three collapse to a count that expands. The reply's own status is not repeated; its Stop stays where
  it is, and the "hide when the Composer shows one" check now reads the Composer's **Show the Send button**
  setting (Send hidden → the Turn line always shows the reply's Stop).
- **"Reply" is the existing Continue** (`onContinue → conv.request("fire-turn")`, ~296;
  `SessionHostViews.svelte` ~140–144 "One Continue at a time"): same control, same label, no second button.
  Report whether it shows when **Who is due next** is *Nothing*, and make it show while Send is hidden.
- A finished background run stays for a short moment with what it did (lead's default, ★), then goes; nothing
  toasts.
- A reserved, empty place for a pub-wide notice (later lane): a prop or slot, no copy.
- STYLE-GUIDE: container queries, the row pattern, focus order, `aria-live="polite"` for arrivals, keyboard
  reach; phone width.
- A layout with no Turn line (a converted layout whose **Who is due next** was *Nothing*,
  `docs/session-layout.md` ~418): the disabled buttons' sentence must still be reachable there; report what a
  person sees and whether Stop is reachable another way.

### F. The Composer (`SessionComposer.svelte`)

One new setting, 🚧 **Show the Send button** (on by default), declared and stored like the Composer's other
settings. Off hides Send / Stop at the widths where Enter sends. **At the compact (phone) width Enter writes a
new line and only the button sends (`submitOnEnter = tier !== "compact"`, ~278–282): there the button stays
whatever the setting says**, and the setting's help says so (🚧 *On a phone the button always shows.*).

### G. Docs and names

`docs/session-layout.md` (Turn line, Composer), `docs/sessions.md` (what stops what; that re-run actions wait),
`docs/pipelines.md` if it describes Stop; `NOMENCLATURE.md` (new names and sentences, §25); `INTEGRATING.md` if
a widget or SDK shape gains a field.

## Files owned

Named by the inventory within: the Turn line and Composer widgets and their settings (SDK
`core-catalog/src/shared/ui/…`, app `src/lib/client/…`), the session event family's client context, one new
server module for runs in progress, the cancellation door, the busy door in `sockets/sessions.ts` (the guard
only), `pipelines/routines/queue.ts` (read access / a change hook only), message action buttons' disabled state,
tests, the docs, `NOMENCLATURE.md`.

## Out of scope

Cancelling or taking back anything automatically; routine groups and their sequential / async setting; the
time-limit switch itself; *Keep running while nobody is playing*; Auto-advance; the Runs widget; changing what a
routine writes; `bindings*.ts`.

## Stop and ask when

CLAUDE.md §Decisions applies; a kind of run cannot be stopped through an existing cancellation path; knowing
what is running needs a new table or migration; event pipelines need registering (report the design first); the refusal in D would block sending a line or Continue in a
case that works today; a layout shipped without a Turn line would leave no way to stop a run (report which).

## Done means

- `npm run sdk:build` from the app root (after the checks), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/ss-7-sdk.log 2>&1"`:
  only the four known failures.
- App tests (that capped form with `npx vitest run --maxWorkers=3 <paths>`, one run at a time): the runs list
  for each kind (reply, action, event pipeline, routine); it reaches a second member and a guest with the right
  `mayStop`; Stop per kind and its permissions (a member stops a routine that blocks them); each action in D
  refused while a counted run is in flight and allowed after; not refused for a parked run or line-bound speech;
  Edit, Forward, send and Continue unchanged; `sessions.editedLineRerun.int.test.ts` green with no
  `it.fails`; dom tests for the Turn line (list, collapse, Stop, Reply, reduced motion, phone width, a11y roles)
  and the Composer setting; the scoped-event payload carries `sessionId`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=10240 npm run check` 0 errors.
- Comments state the rule, not the story. No other product's name.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-ss-7-<date>.md`): the inventory with
file:line; every kind of run and how it is stopped; every new name and sentence; changed files in both repos;
when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under about 900 words.
