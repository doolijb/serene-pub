# REPORT playtest3-A4 — the form-answer gate stops only the AI's answer, never the event (2026-11-04)

Status question: none relayed. The lane is built, the targeted tests are green apart from the one known R-b failure, and the scope review found no blocking objection.

## Built
- **The event dispatches in every genre.** `dispatchAddressedForms` (`runTurn.ts` ~1585-1660) no longer returns early. Every registration on `core:event/form-addressed@1` runs through `dispatchSessionEvent` as before (R24), including a plugin's or routine's listener. `optedIn` now decides only one thing: whether the progress card shows the *Answer a form* frame (`announceChildRun`). With the opt-in off, the answer spec halts before it runs, so a frame naming it would stand on the card. The old early return never announced either.
- **The gate is at the answer spec's own door, the `runSpec` pre-run check.** In `runSpecOnce`, right after `applyNodeRebinds` (~709-740), a run halts when all three hold:
  - it is a child run (`request.lineage`);
  - its document holds a `core:outlet/answer-form` node, which `validate()` places only under the form-addressed inlet (`sdk/src/validate.ts:500-520`);
  - its session's genre does not opt in.

  It then returns `refusalReceipt(...)`: a halted run under its own spec, reason `MODEL_ANSWERS_OFF_REASON`, before its first node and before any model call.
- **Decision: the door matches on the answer outlet, not on the spec slug.** Matching `core:spec/*-answer-form` would infer from the id's namespace, which D-6 forbids at runTurn.ts ~709. As a result, a plugin genre's own answer pipeline (one built with `factories/answerForm.ts`) also halts in a genre without the opt-in. That follows the ruling ("the opt-in gates the AI's answer") more closely than the brief's literal "core's answer registration". If you want only core's answer specs gated, say so and I'll narrow it.
- **New helper.** `sessionModelAnswersForms(db, sessionId)` is not exported. It reads the session's genre the way the press door does (`sessionGenreOf`), then calls `genreModelAnswersForms`. R1 holds: `genreModelAnswersForms` (runTurn.ts ~1559) is still the only reader of `shape.forms.modelAnswers`.
- **No new published field, dispatch option, setting or event.** The "stop and ask" condition never applied.
- **`INTEGRATING.md` (~402-410).** I corrected the sentence: the event always dispatches, the genre opts into the AI's answer and never the event, and without the opt-in a run whose document commits an answer halts at `runSpec`'s door on a `refusalReceipt` with the reason. The event's other registrations run as before.

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/runTurn.ts`: the door in `runSpecOnce`, the `sessionModelAnswersForms` helper, and `dispatchAddressedForms`. The file's other uncommitted hunks belong to other lanes (`frameCauseOfRun`, `via`, `fromPressDoor`, the `appletCause` import).
- `/home/jody/github/serene-pub-sdk/INTEGRATING.md`: the one sentence (~402-410).
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.forms.int.test.ts`, in the describe "P1 · the AI's form answer is off until the genre opts in":
  - The first test is retitled; its assertions are unchanged.
  - New local helper `publishAndRegisterListener`: it publishes `core:spec/test-<tag>-listen`, which has a form-addressed inlet and a createMessage narration outlet, and registers it on the session (`upsertRow(rowOfDecl(register(...), {kind:"session"}, "owner"))`).
  - New off test: a second registration still runs and writes its line. Only the answer halts, with the reason. Both rows are children of the ask, and there are 0 model calls.
  - New on test: ask, answer spec, the fired answer and the listener are all `ok`; there is 1 model call; the block reads answered by Tom with *maybe*.
- `formsModelAnswers.test.ts` is unchanged: `genreModelAnswersForms` did not change.

## Tests run
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/sessions.forms.int.test.ts src/lib/server/pipelines/runtime/formsModelAnswers.test.ts src/lib/server/sockets/sessions.enabledWhen.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-A4-1.log 2>&1'
```
- Totals: 3 files (2 pass, 1 fail); 56 tests (55 pass, 1 fail).
- `sessions.forms.int.test.ts`: 45 of 46 pass, including both new cases. `formsModelAnswers.test.ts` and `sessions.enabledWhen.int.test.ts` pass.
- **The one failure is the known parked-action R-b case.** Test: "a pressed action that parks at its own write answers parked at once, and its outcome arrives as pushes once the owner decides (R-b)" (~1107). Error: `AssertionError: expected { sessionId: 13, …(3) } to deeply equal { sessionId: 13, …(2) }` with `+ "askedRunId": "parked-press-run"`. The extra field comes from another lane's `sessions.ts:2552` (`askedRunId` on the press ack), not from this lane's code.
- `prettier --check` fails on both `.ts` files, but only on lines that other lanes and earlier work left unformatted. I hand-wrapped this lane's own runTurn.ts lines to prettier's output.
- Scope review (`scope-reviewer`): no blocking objection, three low findings. I accepted #1 and recorded it under Built and Canon rows below. I accepted #2 and queued it under Noticed. I accepted and fixed #3: `INTEGRATING.md` is rewrapped to 100 columns or fewer, with no change of wording.

## Stopped, needs owner
- Nothing is blocked. One choice to confirm: the door matches on the answer outlet (see Built). Recommendation: keep it, so every AI form answer is gated by genre. The trade-off is that a plugin genre's answer pipeline also needs `forms.modelAnswers`.

## Canon rows needed (lead)
- **NOMENCLATURE:3428** (the 11-04 lane-A §25 row, *Forms*): replace "off → a halted receipt under the routed answer spec" with:
  > off → `form-addressed` still dispatches in every genre and its other registrations run; a child run whose document commits an AI's answer (`core:outlet/answer-form`) halts at `runSpecOnce`'s door before its first node (no model call), on a halted `refusalReceipt` under its own spec, reason `MODEL_ANSWERS_OFF_REASON`.
- **The form row (~483):** the same correction wherever it says nothing is dispatched.
- There are no new published names. `sessionModelAnswersForms` is module-internal.

## Queued for the lead / other lanes
- `docs/pipelines.md:313` (the forms paragraph) says "If the AI does, Serene Pub runs an **answer** pipeline…" and never mentions the genre opt-in. Suggested extra sentence: "Only in a genre that opts in: elsewhere the AI does not answer, the form is the owner's, and the answer pipeline's run in the runs list says why." The docs file is not this lane's.

## Noticed, not done
- **The same session-level check now exists twice.** `sessionModelAnswersForms` (runTurn.ts) and the lead's `modelAnswersFormsHere` (`fireAction.ts:1286-1290`) have the same body. Both go through `genreModelAnswersForms`, so R1 holds. Proposal: export the runTurn helper and have `modelAnswersFormsHere` call it. `fireAction.ts` is the lead's file.
- **Two genre fallbacks.** `dispatchAddressedForms` falls back to `core:genre/chat` when a session has no genre id. `sessionGenreOf` falls back to `STANDARD_GENRE_ID` (`core:genre/story`). They can differ only when a session row has a null genre.
- **Halted answers now count against the cycle cap.** The off case now dispatches, so the halted answer run counts one descendant against the per-root cap (`admitDescendant`). Before, it did not.
- **The wrong spec can be named.** `answerSpec` in `dispatchAddressedForms` is the *first* registration on the event. If another registration sorts first, the old code wrote its refusal under the listener; that code is gone. The card frame can still name the listener's spec. This predates the lane.
- **The SDK now declares the field.** `sdk/src/descriptors.ts:992-996` declares `forms?: { modelAnswers?: boolean }`, so `genreModelAnswersForms`'s comment ("read as unknown until the SDK declares the field") is stale. The SDK change is the lead's.

**Lead (2026-11-04):** accepted gating on the answer outlet (any genre's answer pipeline; never a spec id's namespace, D-6). Applied: `sessionModelAnswersForms` exported and the press door's `modelAnswersFormsHere` calls it (one reader); the stale "until the SDK declares" comment reworded; the §25 lane-A row and `docs/pipelines.md:313` corrected (the event always dispatches; core's answer halts without opt-in).

**Scope review (lead, 2026-11-04): no objection** — root runs never gated (`request.lineage` required), non-answer children never gated (the `core:outlet/answer-form` node), the outlet matched without a namespace (D-6), one reader of the shape field, one `INTEGRATING.md` sentence, the tests as reported. Noted: the progress-card frame is gated on the opt-in (inside the owned function); the door compares the bare outlet id while the SDK exports it with `@1` (`host.ts:9817` does the same) — one spelling later.
