# BRIEF — build lane `dg-1b` — a non-administrator never reads a run's raw halt reason: a plain sentence and a suggestion to tell an administrator (owner ruling DG1 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). **SDK and core-catalog not changed** (the SDK repo is read-only for
this lane). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-failure-wording-2026-11-17.md` (**the table is this lane's work list; re-verify every
file:line**), the DG1 line in `plans/PLAN-programme-2026-11-15.md`, `plans/briefs/BRIEF-dg-1.md` (its cold
review corrections: what `dg-1a` built), `src/lib/server/connections/visibility.ts` (`ComposedError`,
`withoutConnectionIdentity`, `redactConnections`), `src/lib/server/utils/generationStatus.ts`
(`persistGenerationErrorRow`: the model to follow), `src/lib/server/utils/activityStore.ts` (`activityError`),
`STYLE-GUIDE.md` copy rules, `NOMENCLATURE.md` §1, §24 and rows **administrator**, **member**, **halt**,
**receipt**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dg-1b-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`. Comments state the rule, never the history. Views never toast. Live lane, not yours:
`gs-3a2` (`sockets/sessions.update.ts`, `sockets/sessions.participants.ts`, `sessions/seats.ts`,
`sessions/guestSeats.ts`, `EditSessionForm.svelte` and its seat components). `shared/sockets/types.ts`,
`docs/sessions.md`, `NOMENCLATURE.md` are shared: re-read right before each edit.

## Owner

2026-11-17: "Actually we shouldn't allow non admins to see the full diags anyway, could be considered semi
sensitive." and "Regular users see the error and a basic generic user friendly description of the problem and
a suggestion to notify admin." Standing: members never see or touch model plumbing (connections, models,
sampling, loadouts); P1 (every automatic action shows its cause): an administrator still reads the full
reason; P3: with accounts off the one person is the administrator.

## The rule this lane builds (the reading safe under both readings of "see the error"; ★ in the report)

A halt reason is one of two things, decided **where it is raised, by type, never by matching text**:

- **Words for the people in the session**: a sentence core wrote for a person, naming no model, connection,
  loadout, adapter, spec, node or step key, URL or provider text. It is shown to everyone as written. Today's
  OWNER-ACTIONABLE set in the inventory §(a) is the starting list.
- **Detail**: everything else, including every thrown message the SDK copies into `haltReason`. An
  administrator reads it as today. A non-administrator reads **one plain sentence for that surface** and **one
  shared suggestion sentence**; the detail never leaves the server toward them.

With accounts off, or when the reader is an administrator, the suggestion is absent and the detail shows.

## Build

1. **The one place that decides** (extend `connections/visibility.ts` and `haltExplanation.ts`; add no second
   mechanism): a halt explanation carries the plain words and, separately, the detail, with the detail in the
   field the existing per-recipient strip already removes (`withoutConnectionIdentity` /
   `redactConnections`; `persistGenerationErrorRow` is the model). How a reason is known to be "words for
   people": `ComposedError` exists for "our own sentence", but several composed sentences name plumbing
   (inventory row 2). Decide the smallest truthful marking: e.g. a composed error states whether its sentence
   is for members; unmarked means detail. **Default is detail**: a new halt nobody classified can never leak.
   Report the marking you chose and the list of sentences marked for members, each quoted.
2. **Every LEAK row of the inventory table** goes through that place: the failed-reply row (composed path and
   the pre-placeholder halt, `liveRow.ts:513`, `runReply.ts` 376 / 691 / 748), the reply-failed notification
   (follows the row), the progress card payload (`runReply.ts` 775–790, `sessions.pipelines.ts` 790–824; the
   payload to a non-administrator carries neither the raw reason nor `haltNodeKey` / "halted at {step}"), the
   fireAction toast text (`sessions.pipelines.ts:905`), the `sessions:runEnded` frame to widgets (835–840:
   every member gets it: plain words only, for administrators too unless the frame is per recipient: say
   which), fireTurn / Narrator refusal (`sessions.turns.ts` 783–789, `runReply.ts` 728–735), Summarize
   (`sockets/summarize.ts` 315–322, `sockets/scenes.ts` 2282–2289: route through `activityError` or the same
   place), the routine log (`routines/log.ts` 56, 104, `sockets/routines.ts:80`), the prompt token-count error
   (`sessions.messages.ts` 2406–2412), save / delete refusals (`offerMessage.ts` 77–88, `deletion.ts`
   157–163). **Stored text:** where the raw reason is stored in a column every member's page reads
   (the message row's error, the routine log), store the plain words in the shown field and the detail in the
   stripped field, as `persistGenerationErrorRow` does; rows already stored are **not rewritten** (no
   migration, no boot pass): say what an old row shows to a non-administrator and, if it still leaks, strip
   it at read time through the same place.
3. **Sentences.** Reuse what exists before writing anything: "…An administrator can see the details."
   (`generationStatus.ts` 38–40, `activityStore.ts` 18–19), "Ask your administrator." (`readinessStrip.ts:60`).
   One shared exported suggestion sentence used by every surface (★ with one alternative; candidates: *Tell
   an administrator.* / *An administrator can see the details.*). One plain sentence per surface kind (reply,
   action, summary, routine, save), reusing the existing ones ("The reply could not be generated.",
   "Generation failed — the service reported an error.") where they fit. Every new or changed sentence is ★
   with one alternative. The NO SUGGESTION rows of the inventory gain the shared suggestion for
   non-administrators; the generic handler fallback (`sockets/runHandler.ts` ~103) too.
4. **Composed sentences that name plumbing to members** (`capabilityTarget.ts` 359, 387, 595–706,
   `dispatch.ts:1330`, `runTurn.ts:695`, …): they become detail (administrators read them unchanged); the
   member reads the plain sentence. Do not reword them.
5. **Client**: the progress card, the failed-reply row, toasts and the routine log draw what they are sent;
   remove any client-side composition that would re-expose a step key to a non-administrator ("halted at
   {haltStep}"); no view-level toast added.
6. **Docs and names:** `docs/sessions.md` / `docs/group-sessions.md` where they describe a failed reply;
   NOMENCLATURE §25 (the rule, the shared sentence, the marking) with the owner's two quotes.

## Tests

Per LEAK row: a halt whose reason carries a URL, a model file name and a node key → the serialised payload to
a non-administrator owner and to a guest contains none of the three and contains the plain sentence and the
suggestion; the payload to an administrator contains the reason; a stored row read back by a non-administrator
likewise; a pre-existing stored row with a raw reason read by a non-administrator (strip at read). A sentence
marked for members reaches everyone unchanged, with no suggestion appended twice. Accounts off: the one user
reads the detail and no suggestion. An unclassified new error type defaults to detail. Existing tests that
assert raw reasons reach a member change to the new rule and are listed. `tsc` 0; `npm run check` 0 errors in
lane files.

## Files owned

`connections/visibility.ts`, `pipelines/runtime/haltExplanation.ts`, `runtime/liveRow.ts`, `runtime/runReply.ts`
(halt paths only), `utils/generationStatus.ts`, `utils/activityStore.ts`, `sockets/sessions.pipelines.ts`
(the halt / runEnded / fireAction emits only), `sockets/sessions.turns.ts` (refusal emit), `sockets/summarize.ts`
and `sockets/scenes.ts` (their failure emits only), `pipelines/routines/log.ts`, `sockets/routines.ts`,
`sockets/sessions.messages.ts` (the token-count error only), `messages/offerMessage.ts`, `messages/deletion.ts`
(verify paths), `sockets/runHandler.ts` (the fallback sentence), the composed-error raise sites only to mark
them, the client components that draw these, `shared/sockets/types.ts` (own fields), tests, docs, NOMENCLATURE.

## Stop and ask when

CLAUDE.md §Decisions applies; a surface's plain sentence would hide something only the session's owner can
fix (list it, mark it for members only if it names no plumbing, else report); the marking needs an SDK or
core-catalog change; a widget frame contract (`sessions:runEnded`) would lose a field a shipped widget reads
(report the readers); stored rows would have to be rewritten.

## Report

Final message = the report (lead saves `plans/REPORT-dg-1b-<date>.md`), under about 700 words: the marking
and the one place; the table row by row (before → after for a non-administrator); the list of sentences marked
for members; every new or changed sentence as ★ with one alternative; what old stored rows show; tests
changed; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**The lane is cut. This brief builds only the surfaces decided per socket at the emit: no marking of raise
sites, no stored data, no new stripped field, no change to the message row, the notification, the routine
log, or save / delete refusals.** Those are lane `dg-1c`, briefed after this one (it needs a run-scope record
of the thrown error's class, a list of member-fixable refusals, and the owner's answer on old stored rows:
rulings page DG3).

Why: the SDK stores only a string (`executor.ts:2674` `receipt.haltReason = (e as Error)?.message`; core
bindings `halt(...)` return bare strings), so "by type" is lost before these surfaces read the reason;
`ConnectionIdentity.detail` is chartered "What the service itself said, verbatim"
(`shared/connections/identity.ts` 15–16, 25–33; `visibility.ts` 84–88) and takes no second meaning;
`pipeline_runs.halt_reason` is the run record Inspect run reads and stays the true reason.

1. **One exported helper in `pipelines/runtime/haltExplanation.ts`**: given a receipt-derived halt (reason,
   node key, step) and the reader (`connectionsVisibleTo(socket.user)` / `socket.user.isAdmin`: use the test
   `visibility.ts` already uses, so accounts off = administrator), it returns for an administrator exactly
   what is sent today, and for anyone else the surface's plain sentence plus the shared suggestion, with **no
   raw reason, no `haltNodeKey`, no step name**. Every surface below calls it at its emit. No text matching.
2. **Surfaces (re-verify lines):** the progress card's ended frame (`src/lib/server/utils/runReply.ts`
   775–790; `sockets/sessions.pipelines.ts` 790–824) and its client caption "halted at {node}"
   (`RunProgressCard.svelte` 244–256, `runOutcome.ts` 58–64: drawn only from what is sent); the fireAction
   answer and toast (`sessions.pipelines.ts` 737–753 `fail()`, `:905`; this is also the widget invoke answer
   `WidgetInvokeResult.reason`, SDK `widgets.ts` 3286–3291, relayed by `widgetWire.svelte.ts:679`,
   `pressAnswers.ts:16`); `sessions:runEnded` / `run:ended.reason` to widget frames (`sessions.pipelines.ts`
   835–840; SDK `widgets.ts:3462`; no core-catalog widget reads `reason`, `SessionRunsWidget.svelte:90` only
   refreshes): **plain words for every recipient** (the frame goes to all members); the fireTurn / Narrator
   refusal built from a receipt (`sockets/sessions.turns.ts` 783–789; `utils/runReply.ts` 728–735); Summarize
   failures (`sockets/summarize.ts` 315–322, `sockets/scenes.ts` 2282–2289: "{haltReason} (at '{haltNodeKey}')";
   the Activity card text they feed); the prompt token-count error (`sockets/sessions.messages.ts`
   2406–2412); the generic handler fallback (`sockets/runHandler.ts` ~103) gains the suggestion for a
   non-administrator.
3. **Refusals core raises at the surface itself as its own sentence are not receipt-derived and stay as
   written** when they name no plumbing: archived session, genre unavailable (`utils/runReply.ts` 376, 390,
   396). List each such sentence you leave, quoted. If one names plumbing, it gets the plain sentence for
   non-administrators (list it).
4. **Stop on a member-fixable receipt reason.** If a receipt-derived reason at one of these surfaces is
   something only the member can fix (a host `refuse()` such as "You can only send messages with personas you
   own.", `host.ts:1487`, reaching a toast through a receipt; "rejected at review"; a cap pause), do not hide
   it and do not match its text: report where it arrives and leave that surface's path for `dg-1c`.
5. **The two widget-contract fields** (`WidgetInvokeResult.reason`, `run:ended.reason`) change content, not
   shape: name both in the report and in NOMENCLATURE §25.
6. **Sentences** as in Build 3 above: one shared exported suggestion (★ with one alternative), one plain
   sentence per surface kind reusing existing ones; all ★.
7. Paths: `src/lib/server/utils/runReply.ts` (not `runtime/`). Files owned: `haltExplanation.ts`,
   `utils/runReply.ts` (the ended frame and receipt-built refusal), `sockets/sessions.pipelines.ts` (the three
   emits), `sockets/sessions.turns.ts` (the refusal emit), `sockets/summarize.ts`, `sockets/scenes.ts` (their
   failure emits), `sockets/sessions.messages.ts` (the token-count error only), `sockets/runHandler.ts` (the
   fallback sentence), `RunProgressCard.svelte`, `runOutcome.ts`, tests, `docs/sessions.md` where it
   describes a failed run, NOMENCLATURE §25. **Not** `connections/visibility.ts`, `generationStatus.ts`,
   `activityStore.ts`, `liveRow.ts`, `routines/log.ts`, `sockets/routines.ts`, `sessions/offerMessage.ts`,
   `messages/deletion.ts`, any raise site, the SDK, core-catalog.
8. Tests: per surface, a halt whose reason carries a URL, a model file name and a node key → the serialised
   payload to a non-administrator owner and a guest contains none of them and contains the plain sentence and
   the suggestion; an administrator's contains the reason; `run:ended` carries plain words to all; accounts
   off: the reason, no suggestion. Existing tests asserting a raw reason reaches a member change and are
   listed.
