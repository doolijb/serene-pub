# BRIEF — build lane `dg-1c` — a model call's failure never shows its raw reason to a non-administrator on the reply and action surfaces (owner ruling DG1 of 2026-11-17; what `dg-1b` stopped on)

Repo `/home/jody/github/serene-pub` (app). **SDK and core-catalog read-only.** Supervisor: read
`.claude/guides/multi-agent.md`, then `plans/REPORT-dg-1b-2026-11-17.md` (the helper `haltExplanationFor`, the
sentences, **"Stopped on a member-fixable reason"**), `plans/briefs/BRIEF-dg-1b.md` (its cold review
corrections: why nothing is decided by text and why no stripped field is reused),
`plans/INVENTORY-failure-wording-2026-11-17.md` (rows: failed-reply row pre-placeholder, progress card,
fireAction toast, fireTurn refusal), the DG1 line in `plans/PLAN-programme-2026-11-15.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only; **never `--write`, never pipe prettier's output into a file**. No migration. Inside
`db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dg-1c-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`. Comments state the rule, never the history. Views never toast.

## Owner

2026-11-17: "Actually we shouldn't allow non admins to see the full diags anyway, could be considered semi
sensitive." "Regular users see the error and a basic generic user friendly description of the problem and a
suggestion to notify admin." Standing: members never see model plumbing; P1 (an automatic action shows its
cause): a refusal a member can act on stays readable.

## The problem left

On the reply's progress card and refusal (`src/lib/server/utils/runReply.ts` 691 / 702 / 735 / 775–790) and on
the fireAction answer, toast and progress card (`sockets/sessions.pipelines.ts` 737–753, 790–824, 905;
`WidgetInvokeResult.reason`), a non-administrator still reads the run's raw halt reason. When a **model call**
fails that reason is the adapter's thrown message: base URL, model file, provider text. The same road also
carries refusals only the member can act on ("rejected at review", a seat-name refusal, "Only the session's
owner can change its rules.", lore-write refusals), so `dg-1b` could not hide the reason wholesale, and text
matching is banned.

## The rule this lane builds (★ in the report)

Decide by **what kind of step halted**, which the receipt already records (`receipt.haltNodeKey`,
`receipt.nodes[].nodeKey / result`; the node's definition is known from the published spec the run executed):
**when the halting step is a model call** (the node kinds that dispatch to a connection: find the existing
classification: definition kind / contract kind such as oracle, or the host call that goes through
`connections/dispatch`; use what the code already has, add no list of node keys or slugs), a
non-administrator reads the surface's plain sentence plus `ADMINISTRATOR_SUGGESTION`, and no raw reason, node
key or step name. **Any other halting step keeps today's text** (member-fixable refusals stay readable; wiring
halts that name a step key remain: report them as what is still open). An administrator always reads what is
sent today. If the halting step cannot be resolved, treat it as a model call (plain words) only when the
receipt shows a thrown error (`result === 'err'`) with no node; otherwise today's text: say what you chose
and why.

## Build

1. One pure function beside `haltExplanationFor` in `pipelines/runtime/haltExplanation.ts`: from a receipt
   (and the spec's node definitions, already loaded where the receipt is finished: find how
   `haltExplanation` gets its inputs; add no database read on the reply path: statements per reply must not
   rise: say how you know), answers "did a model call halt this run". Unit-test it over real shipped specs
   (Story reply, the Lair turn, a summarize spec): halts at the respond / model step → yes; at a write, review
   gate, form or assemble step → no.
2. Use it at: the reply's ended frame and progress card payload (`utils/runReply.ts` 775–790), the reply
   refusal built from a receipt (691 / 702 / 735), the fireAction answer and toast and its progress card
   (`sessions.pipelines.ts` 737–753, 790–824, 905), the fireTurn / Narrator refusal
   (`sockets/sessions.turns.ts` 783–789). For a non-administrator on a model-call halt the payload carries the
   plain sentence, the suggestion, and **no `haltNodeKey` / step name** (the client caption "halted at
   {node}", `RunProgressCard.svelte` 244–256, `runOutcome.ts` 58–64, is drawn only from what is sent).
   Add `"reply"` to `HaltSurface` with the existing sentence "The reply could not be generated." (★ alt:
   "Generation failed — the service reported an error."). The stored message row and the notification are not
   touched (they already use the generic sentence on the call road; the pre-placeholder wrap at
   `runReply.ts:691` builds the stored row's text from the receipt: for a model-call halt store the plain
   sentence there too, since every member reads that row; an administrator reads the reason in Inspect run).
3. NOMENCLATURE §25 (the rule; `WidgetInvokeResult.reason` content for a model-call halt); `docs/sessions.md`
   only if it describes this text.

## Tests

Per surface: a run halted at its model step with a reason carrying a URL, a model file name and the node key
→ payload to a non-administrator owner and a guest has none of them, has the plain sentence and the
suggestion; an administrator's has the reason. The same surfaces with a halt at a review gate ("rejected at
review"), a seat-name refusal and "Only the session's owner can change its rules." → **unchanged for
everyone** (existing tests stay green untouched). Accounts off: the reason. Both prompt baselines and the
statement counts per reply unchanged. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`pipelines/runtime/haltExplanation.ts` (+ test), `utils/runReply.ts` (halt paths), `sockets/sessions.pipelines.ts`
(the fireAction answer / progress / toast emits), `sockets/sessions.turns.ts` (refusal emit),
`RunProgressCard.svelte`, `runOutcome.ts`, `shared/sockets/types.ts` (own fields), tests, NOMENCLATURE §25.
Not `connections/visibility.ts`, `generationStatus.ts`, `activityStore.ts`, `liveRow.ts`, the routine log,
save / delete refusals, any raise site.

## Stop and ask when

CLAUDE.md §Decisions applies; "is this step a model call" cannot be answered from the receipt and the spec
without a list of keys or text; a member-fixable refusal can be raised **inside** a model-call step (then
that surface stays as is and you report it); the reply path would need a new read.

## Report

Final message = the report (lead saves `plans/REPORT-dg-1c-<date>.md`), under about 500 words: how a model
call is recognised (file:line); surfaces before → after; what still reaches a non-administrator raw (wiring
halts) with examples; sentences ★; tests; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

1. **The discriminator, exactly.** A run is a **model-call failure** when its halting step's receipt row has
   `kind === 'oracle'` **and** `result === 'err'` (`../serene-pub-sdk/sdk/src/receipt.ts` 22–23: each
   `NodeReceipt` carries `kind` and `definitionId`; an adapter that throws becomes `err(message)`,
   `executor.ts` 2135–2144). A `result === 'halt'` keeps today's text for everyone: a review rejection lands on
   the model-call step itself (`executor.ts` 1747–1749, 1793–1798; `review.ts` 168–170; every core model call
   declares outside effects), so does a script-seam halt and an empty completion. Test with review switched on
   at the generate step: "rejected at review" still reaches the presser unchanged.
2. **Find the halting step yourself; do not trust `haltNodeKey` blindly.** For an `err` run `haltNodeKey` is
   the first row with `result === 'err'` (`executor.ts:2661`), which can be an **optional step that already
   recovered** (`recoveredAsEmpty`, `executor.ts` 2150–2155; e.g. `embed-text` with `enabled: 'on'` rethrows,
   `bindings.providers.ts` 557–558) while the real halt is a later refusal such as "You can only send messages
   with personas you own." (`host.ts:1487`). The halting step is **the non-ok receipt row that has no
   `recoveredAsEmpty`** (state the tie rule if several; the last such row in execution order is the one that
   ended the run: verify against the executor). Test: embedding failed and recovered, then the save refused →
   the refusal reaches the sender unchanged. List the SDK's `haltNodeKey` choice under Noticed (an SDK matter).
3. **No spec, registry or database read.** Read only the receipt's rows. For a non-administrator on a
   model-call failure also skip `haltStepOf(db, …)` (`utils/runReply.ts` 762–767, `sessions.pipelines.ts`
   801–806), since no step name is sent: that path gets one statement cheaper. Do not use the SDK's internal
   `isModelCall`. Name in the report that a plugin's own model-call step failing is treated the same way.
4. **The stored row at `utils/runReply.ts` 689–695.** For a model-call failure pass `new Error(reason)` (not a
   `ComposedError`) to the existing `persistGenerationErrorRow` road, so the existing split applies: the row's
   message is the existing generic sentence and the raw text sits in `connection.detail`, stripped for
   everyone but administrators (`utils/generationStatus.ts` 186–199; `liveRow.ts` 508–515 does the same on the
   call road). No new sentence, no new field. Every other halt keeps `ComposedError`. (This replaces "store
   the plain sentence there" above.)
5. **Files:** `shared/sockets/types.ts` is **not** needed (`error`, `haltNodeKey`, `haltStep` are already
   optional in `shared/sockets/progress.ts` 82, 105, 110) and is not owned. `NOMENCLATURE.md` §25 is shared
   with a live lane: re-read right before editing, add only your entry. A live lane (`gs-3b`) owns
   `sockets/sessions.update.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `sessions/seatName.ts`, the
   seat components and `EditSessionForm.svelte`: not yours.
