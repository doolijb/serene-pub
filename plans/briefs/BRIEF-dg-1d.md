# BRIEF — build lane `dg-1d` — halts outside a model call: a non-administrator reads words written for people, never step wording (owner ruling DG1 of 2026-11-17; what `dg-1c` left open)

Repo `/home/jody/github/serene-pub` (app). **SDK and core-catalog read-only.** Supervisor: read
`.claude/guides/multi-agent.md`, then `plans/REPORT-dg-1c-2026-11-17.md` (incl. "Scope review fix": what is
still raw and why), `plans/REPORT-dg-1b-2026-11-17.md` ("Stopped on a member-fixable reason"),
`plans/INVENTORY-failure-wording-2026-11-17.md` §(a) (**the list of `haltReason` templates: this lane's work
list; re-verify every file:line**), the cold-review sections of `plans/briefs/BRIEF-dg-1b.md` and
`BRIEF-dg-1c.md` (why nothing is decided by text; why the SDK flattens a thrown error to a string; what the
receipt's rows carry), `src/lib/server/pipelines/runtime/haltExplanation.ts` (`haltedAtModelCall`,
`receiptHaltFor`, `haltExplanationFor`, `plainReplyFailure`), and the rulings DG1, DG3 in
`plans/PLAN-programme-2026-11-15.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. Never run
prettier with `--write` or pipe its output into a file. **No migration.** Inside `db.transaction` only `tx`.
Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dg-1d-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK edit or build, no full run,
no `npm run build` (an isolated instance of the built app may be running for a UI walk: do not stop it, do
not rebuild). Comments state the rule, never the history. Views never toast.

## Owner (2026-11-17)

"Actually we shouldn't allow non admins to see the full diags anyway, could be considered semi sensitive."
"Regular users see the error and a basic generic user friendly description of the problem and a suggestion to
notify admin." "For the future, never publish raw errors directly to the message body". Standing: members
never see model plumbing; P1: an automatic action shows its cause; a refusal a member can act on stays
readable.

## What is left

On the reply and action surfaces (the progress card and its "halted at ‹step›" caption, the refusal, the
fireAction answer and toast, the routine log, save / delete refusals), a halt that is **not** a model-call
failure still reaches a non-administrator as written. Some of those are sentences a member must read
("Rejected at review.", "You can only send messages with personas you own.", "Only the session's owner can
change its rules.", a seat-name refusal, a cap pause, a routine skipped by its condition). Others are core's
own wiring words naming a step, a spec, a node type or a loadout (`bindings.prompt.ts` "assemble has no
template…", `runTurn.ts:695` "no published version of '{specId}'…", `host.call.ts:121`, `:216`,
`capabilityTarget.ts` 359–706 naming loadouts, `dispatch.ts` naming adapters, SDK executor messages "no
binding registered for…"). The two kinds travel the same road as a bare string.

## The rule this lane builds (★ in the report)

**A sentence is for the people in the session only when the code that raises it says so; everything else is
detail.** Decided at the raise site by type, never by matching text:

- Core already has two classes: `ComposedError` ("our own sentence", `connections/visibility.ts:198`) and
  `HostScopeError` (`pipelines/runtime/host.types.ts:395`, thrown by host `refuse()`). Step 0 decides whether
  one of them can carry the mark (e.g. host `refuse()` sentences are for people; a wiring `HostScopeError` is
  not) or whether the smallest truthful shape is one new marker (a subclass or a field) set at the raise
  sites that are for people. No new taxonomy of failure kinds.
- The mark must survive to the surfaces. The SDK copies only the message into `haltReason`. The carrier
  proposed by the `dg-1b` review: the host's one catch that sees every read / call / commit throw as an
  object together with its node (`host.ts` ~7612 `plain`; `scope.live?.failedWith`, `host.call.ts:398`,
  `liveRow.ts` 186–193, 489) records, in the run's scope, "the halt at this node was a sentence for people".
  A surface holding a receipt asks that record (through the run's scope / the same place
  `receiptHaltFor` is called). Structural marks that already exist are used as they are: a review rejection
  (`result === 'halt'` with the executor's review reason: verify how it is distinguishable without text; if
  only by text, treat every `halt` result raised by a **gate** as for people and say so), routine
  `meta.routine.skipped | paused` (`pipelines/routines/log.ts` 93–97).
- **Default is detail**: an unmarked halt shows a non-administrator the surface's plain sentence plus
  `ADMINISTRATOR_SUGGESTION`, with no reason, node key or step name; an administrator reads what is sent
  today. With accounts off the one person is the administrator.

## Step 0 — the table, before any code (in the report)

Every template in the inventory §(a) and every `refuse(` / `throw new ComposedError(` / `throw new
HostScopeError(` / `halt(` raise site in `src/lib/server/pipelines/runtime/`, `connections/`, `routines/`,
`sessions/offerMessage.ts`, `messages/deletion.ts`: the sentence (quoted), who can act on it (the sender / the
session's owner / only an administrator / nobody: a bug), does it name plumbing, and the verdict **for people**
or **detail**. A sentence a member can act on that names plumbing is listed for the lead (it stays detail
until reworded; do not reword). Bring this table back **before** changing code if more than about 15 sites
would be marked for people or if any verdict is unclear: stop and report the table.

## Build (after Step 0)

1. The mark and the run-scope record (one small addition where `failedWith` already lives); `receiptHaltFor`
   takes it into account: model-call failure → plain (as today); marked for people → as written, for everyone;
   anything else → plain for a non-administrator.
2. The surfaces `dg-1c` listed keep calling `receiptHaltFor`; add the ones it did not reach: the routine log
   as read by a member (`sockets/routines.ts` ~80: shape `reason` per viewer; skipped / paused lines pass
   unchanged), save / delete refusals (`sessions/offerMessage.ts` 77–88, `messages/deletion.ts` 157–163), the
   catch road with no receipt (`utils/runReply.ts` ~744: "no published version…").
3. The stored row keeps `dg-2`'s rule (no raw reason in the body). A sentence marked for people **may** be
   stored as the row's text (it is written for people): say what you did for "Rejected at review.".
4. NOMENCLATURE §25 (the mark, the rule); no doc describes this text today: add one paragraph to
   `docs/sessions.md` only if a member-visible sentence is documented there.

## Tests

Per surface × (owner non-administrator, guest, administrator): a wiring halt naming a step and a spec → plain
+ suggestion for the first two, the reason for the third; each sentence marked for people → unchanged for all
three (existing tests untouched: `sessions.actions.int`, `offerMessage.int` 351 / 421, the modelCallWording
tests, routine-log tests); an unmarked new error class → detail. Both prompt baselines unchanged; statements
per reply not higher (`plans/REPORT-perf-4-2026-11-17.md` names the tests). `tsc` 0; `npm run check` 0 errors
in lane files.

## Files owned

`pipelines/runtime/haltExplanation.ts`, `runtime/host.ts` (the one catch and the scope record only),
`runtime/host.types.ts` / `connections/visibility.ts` (the mark), `runtime/liveRow.ts` (the record),
`utils/runReply.ts` and `sockets/sessions.pipelines.ts` (their `receiptHaltFor` calls), `sockets/routines.ts`,
`pipelines/routines/log.ts` (read shaping only), `sessions/offerMessage.ts`, `messages/deletion.ts`, the raise
sites **only to mark them**, tests, NOMENCLATURE §25.

## Stop and ask when

CLAUDE.md §Decisions applies; the mark cannot survive to a surface without an SDK change; a member-fixable
sentence names plumbing (list it, do not reword); Step 0's table is large or unclear (report it first); a
shipped widget reads a reason this lane would change (`WidgetInvokeResult.reason`: name the readers).

## Report

Final message = the report (lead saves `plans/REPORT-dg-1d-<date>.md`), under about 700 words: the Step 0
table (or its summary plus where the full table is written: `plans/INVENTORY-halt-sentences-2026-11-17.md`,
which you may create); the mark and the record; surfaces before → after; the sentences marked for people
(quoted); member-fixable sentences that name plumbing; tests; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**Cut in three. `dg-1d-0` (read-only inventory, running first), then `dg-1d-1` (the marker, the stamp, the
reply and action surfaces), then `dg-1d-2` (the routine log, save / delete refusals). Nothing above is built
until the inventory is back and the lead has ruled on the "for people" list.**

1. **A halt takes four roads; the brief named one.** Thrown (the `plain` catch, `host.ts` 7610–7648);
   **commit-returned `{ halt }`** (20 sites, incl. `SeatNameRefusal` host.ts:4607, "Only the session's owner
   can change its rules." 6040, library-write refusals 1312 / 1360, `StateRefusal` 4809 / 6054: the
   `host.commit` wrapper sees the return at ~7642); **binding `halt()`** (~57 calls, e.g.
   `bindings.summarize.ts:1065`); **executor and script-seam halts** (no core object: stay detail).
   "Default is detail" applies to `err` outcomes and thrown errors; a `halt` outcome keeps today's text until
   its site is marked or ruled detail.
2. **The record lives on the receipt.** Surfaces hold only a receipt (fireAction returns
   `{ kind: "ran", runId, specId, receipt }`, `fireAction.ts` 1328–1330; save / delete get a dispatched
   receipt; the routine log reads stored rows days later). `runSpec` (`runTurn.ts` ~809, ~1065) is the one
   chokepoint: it stamps the mark onto the receipt's `meta` before `saveReceipt` (~1291, ~1317; `ReceiptMeta`
   has an index signature, SDK `receipt.ts` 167–170: no SDK edit). Runs stored before read as detail.
   `runTurn.ts` (`runSpec` only) joins Files owned; the meta key is named in NOMENCLATURE.
3. **Review rejection is structural already:** `receipt.reviews` has `{ action: 'reject' }` at the halting
   node (`executor.ts` 1791–1798; `reviewGate.ts` 569–577 reads it). Use that, never "every gate halt".
4. **The marker carries the sentence for people separately from the message.** Member sentences are raised
   as `${node.key}: ${sentence}` (26 wrappers) and today's `refusalOf` strips the key with a regex
   (`offerMessage.ts:84`, `deletion.ts:166`): that is text matching. A marked halt sends a non-administrator
   the people sentence and no node key or step.
5. **One new marker is needed**: `ComposedError` cannot carry it (superclass of `DispatchError`,
   `ConnectionChoiceRefused`, whose sentences name loadouts and adapters); `HostScopeError` cannot either
   (`refuse()` raises both "this run has no user" and "You can only send messages with personas you own.").
6. **Tests that change** (fixtures gain a `reviews` reject entry and the mark):
   `sockets/sessions.actions.modelCallWording.int.test.ts` 66–70, 109–114;
   `utils/runReply.modelCallWording.int.test.ts` 46–50, 115–119. `offerMessage.int.test.ts:421` needs
   host.ts:1492 marked.
7. Routine lines: skipped / paused do not all pass unchanged: `routines/run.ts:357` "Skipped: '{slug}' is
   not published on this pub" names plumbing.

## `dg-1d-1` — what to build (2026-11-17, after the inventory) — rules over everything above

Work list: `plans/INVENTORY-halt-sentences-2026-11-17.md`, **column "Ruling"** (the lead's): **P** rows are
marked for people; **D** and **W** rows stay detail (W rows need rewording by the owner first: do not reword,
do not mark); everything not in Part A is detail. Re-verify every line.

1. **One marker.** A small value a raise site attaches to say "this halt is a sentence for the people in the
   session", carrying **the sentence itself, without any `${node.key}: ` prefix** (name by NOMENCLATURE §24;
   🚧). It must work on all four roads: a thrown error (a field or subclass the `plain` catch at `host.ts`
   ~7610–7648 can see), a commit-returned `{ halt }` (the `host.commit` wrapper sees the return at ~7642: let
   the return carry the mark), a binding `halt()` (only row 33: let that one call carry it), and the two
   structural ones that need no raise-site change: a review rejection (`receipt.reviews` has
   `{ action: 'reject' }` at the halting node; on a **compacted** receipt, where `reviews` is dropped, fall
   back exactly as `answerStanding` does today, `reviewGate.ts` 563–579, through that same function: do not
   write a second text test) and routine lines (`meta.routine`).
2. **The stamp.** `runSpec` (`pipelines/runtime/runTurn.ts` ~809, ~1065) stamps onto the receipt's `meta`,
   before `saveReceipt` (~1291, ~1317), the people sentence of the halt that ended the run (one key; name it
   in NOMENCLATURE). No SDK edit (`ReceiptMeta` has an index signature). A receipt stored before this lane
   has no stamp and reads as detail.
3. **`receiptHaltFor`** (`pipelines/runtime/haltExplanation.ts`): model-call failure → plain (as built);
   **stamped, or a review rejection → the people sentence, for every reader, with no node key or step**;
   otherwise → **plain for a non-administrator** (the surface's sentence plus `ADMINISTRATOR_SUGGESTION`),
   the reason for an administrator. This is the change: an unmarked non-model halt is no longer shown raw to
   a non-administrator. The surfaces that already call it (reply refusal, progress card, fireAction answer,
   toast; `utils/runReply.ts`, `sockets/sessions.pipelines.ts`) follow; add the catch road with no receipt
   (`utils/runReply.ts` ~744, "no published version…": plain for a non-administrator).
4. **Mark the P rows** at their raise sites: prefer the site that raises the people sentence over the
   pass-through of a whole class (a class pass-through also marks wiring sentences: `SeatNameRefusal`'s
   `seatName.ts:85` wrap, `StoryClockRefusal`'s "There is no session ${id}.", `LibraryWriteRefusal`'s input
   checks, the picture refusals' "name a character or a cast member, not both."): where the class is raised
   in many places, give the class a way to say which of its messages are for people (a constructor flag set
   at the people sites) and mark at the pass-through only when the instance says so. `personLineOf`'s
   `refuse` (host.ts:1463) gets a for-people variant used by rows 1–3 only. Sites where the sentence exists
   only inside a template string (493, 5777, 5848, 5995, loreWrites:151): split the string so the sentence is
   its own value; the stored / shown text for an administrator stays byte-identical.
5. **The stored row** (`dg-2`'s rule: no raw reason in the body): a stamped people sentence **is** stored as
   the row's text (it is written for people); so is "Rejected at review." in its existing wording (find the
   constant; `replyRoad.int` 1229–1234 expects `plainReplyFailure()` since today's triage: change it back to
   the review sentence and say so).
6. **Not this lane (`dg-1d-2`):** the routine log's read shaping, save / delete refusals
   (`sessions/offerMessage.ts`, `messages/deletion.ts`): do not change them; but the tests that require a
   sender to read rows 1 and 2 through `offerMessage` (`offerMessage.int.test.ts` 351, 421) must stay green
   untouched (they read `refusalOf`, which this lane leaves alone).
7. **Tests.** Per P row: one test that the stamp carries the sentence without a prefix (group by helper; a
   table-driven test over the raise sites is fine). Surfaces × (non-administrator owner, guest,
   administrator): a wiring halt naming a step and a spec → plain + suggestion / plain + suggestion / the
   reason; each of rows 1, 8, 16, 18 → the people sentence for all three, no node key. The two
   modelCallWording int tests' fixtures gain the stamp / a `reviews` reject entry (list the lines changed). A
   compacted receipt with a review rejection → still the review sentence. An old receipt with no stamp →
   detail. Both prompt baselines identical; statements per reply not higher (the stamp adds no read).
   `tsc` 0; `npm run check` 0 errors in lane files.
8. **Files owned:** `pipelines/runtime/haltExplanation.ts`, `runtime/host.ts` (the `plain` catch, the commit
   wrapper, the P raise sites), `runtime/host.types.ts`, `runtime/host.loreWrites.ts` (rows 12, 13),
   `runtime/bindings.summarize.ts:1064`, `runtime/runTurn.ts` (`runSpec` stamp only), `utils/runReply.ts`,
   `sockets/sessions.pipelines.ts` (their `receiptHaltFor` calls), the refusal classes' files only to add the
   flag (`sessions/seatName.ts`, `sessions/seats.ts` bench refusals, `state/storyTime.ts`,
   `characters/portrait.ts`, `sprites/attach.ts`, `library/writes.ts`, the ruleset convert refusals), tests,
   NOMENCLATURE §25. No SDK or core-catalog edit; no `npm run build` (a built-app walk may be running).
9. **Report** (under ~650 words): the marker and the stamp (file:line); the P rows marked, grouped, with any
   you could not mark and why; what a non-administrator now reads for an unmarked halt on each surface; tests
   changed; the W rows restated for the owner; **Noticed, not done**.
