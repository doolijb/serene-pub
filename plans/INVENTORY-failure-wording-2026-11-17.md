# INVENTORY — what a non-administrator reads when a run fails (read-only audit, 2026-11-17)

For lane `dg-1b`. Owner (2026-11-17): "Regular users see the error and a basic generic user friendly description of the problem and a suggestion to notify admin." Diagnostics are administrators' only. Nothing was edited; no tests run. **Re-verify every file:line.**

**Worst:** a plain adapter failure reaches the reply row as the generic sentence, but `haltExplanation` puts the adapter's raw `Error.message` (base URL, model file) on the progress card, the fireAction toast and the `sessions:runEnded` frame. The SDK copies a node's thrown message into `haltReason` (`@serene-pub/sdk/src/executor.ts` 1847, 2655, 2674). `receiptWithoutQueryText` (`receipts.ts:307`) removes only SQL.

| Surface | Server source | Text today | Who gets it; stripped per recipient? | Plumbing? | Suggestion? | Verdict |
|---|---|---|---|---|---|---|
| Failed-reply row, service error (`core-catalog/…/SessionMessage.svelte` 1113–1150, `TurnLine.svelte:122`) | `src/lib/server/utils/generationStatus.ts` 38–40, 196 | "Generation failed — the service reported an error. An administrator can see the details." | All members; `error.connection{name,model,detail}` stripped per recipient (`broadcastHelpers.ts:98`, `sockets/index.ts` 211–238) | no | half | FINE |
| Failed-reply row, composed path (`ComposedError`) | `liveRow.ts:513`, `runReply.ts` 376, 691, 748 | Shown word for word: `capabilityTarget.ts:359` "No model is set for Reply… An admin chooses it with Use in Reply beside a model in Connections."; `capabilityTarget.ts` 595–706 "The model chosen for {loadout} in Admin › Models › Loadouts is switched off…"; `dispatch.ts:1330`; `runTurn.ts:695` "no published version of '{specId}'… check the server log"; `host.call.ts:216`; `bindings.prompt.ts:750` | All members, stored in the column, never stripped | yes: loadout, adapter, spec id, node keys | only CHAT_UNSET | LEAK |
| Failed-reply row, halt before the placeholder claimed the row | `runReply.ts:691` | `ComposedError(haltReason)`: a thrown adapter message word for word | All members | yes: provider text, URL, model file | no | LEAK |
| Reply-failed notification | `generationStatus.ts` 304–330; `shared/notifications/kinds.ts` 155–161 | "A reply failed in {session}" + "{error}" (row's message, ≤160 chars) | The presser | as the row | as the row | follows the row |
| Progress card above the composer (`RunProgressCard.svelte` 244–256) | `runReply.ts` 775–790, `sessions.pipelines.ts` 790–824, `haltExplanation.ts` 23–29 | Raw `haltReason`, or "The run stopped without saying why." / "The turn produced no reply."; caption "halted at {haltStep}" | The presser via `emitToUser`; `redactConnections` cannot touch a string; `haltNodeKey` in the payload | yes | no | LEAK |
| fireAction toast (`pressRouting.svelte.ts` 375–386) | `sessions.pipelines.ts:905` | same `haltExplanation` text | The presser | yes | no | LEAK |
| `sessions:runEnded` frame to widget frames | `sessions.pipelines.ts` 835–840 | `reason` = raw `haltReason` | Every member, guests included | yes | no | LEAK |
| fireTurn / Narrator refusal toast (`turnFlow.svelte.ts` 480–490) | `sessions.turns.ts` 783–789; `runReply.ts` 728–735 | "The reply could not be generated." or composed text / "no published version…" | The presser | sometimes | no | LEAK / NO SUGGESTION |
| Summarize: toast (`scenesFlow.svelte.ts:235`), Activity sidebar (`ActivitySidebar.svelte` 715, 852, 941), modals | `summarize.ts` 315–322, `scenes.ts` 2282–2289 | "{haltReason} (at '{haltNodeKey}')" | The job's owner; bypasses `activityError` | yes | no | LEAK |
| Activity cards, thrown errors | `activityStore.ts` 18–19, 46–75 | "The service reported an error. An administrator can see the details." | The owner; connection stripped | no | half | FINE |
| Routine log, "While you were away" (`core-catalog/…/routineLog.ts` 72–78) | `routines/log.ts` 56, 104; `sockets/routines.ts:80` | Raw `haltReason`, e.g. `run.ts:357` "Skipped: '{slug}' is not published on this pub", `evaluate.ts:176` "its script failed: {r.reason}" | Any session member | yes | no | LEAK |
| Readiness strip | `client/…/readinessStrip.ts` 51–62 | Member: "No model is set up to reply. Ask your administrator." | split on the client | no | yes | FINE |
| Prompt token-count error | `sessions.messages.ts` 2406–2412 | "The prompt could not be compiled: {outcome} at '{haltNodeKey}' — {haltReason}" | The typist; stored, never drawn (`composerFlow.svelte.ts:231`) | yes | no | LEAK (payload) |
| Save / delete refusal ("Not sent", `composerFlow.svelte.ts:134`) | `offerMessage.ts` 77–88, `deletion.ts` 157–163 | `haltReason` minus a leading "node: " | The sender | possible | no | LEAK (possible) |
| Tool refusal | `host.call.ts` 655–667 | "{name} is not switched on in this session." | the model (tool result) | no | n/a | OWNER-ACTIONABLE |
| Generic handler fallback | `sockets/runHandler.ts` ~103 | "An error occurred while processing your request." | The asker | no | no | NO SUGGESTION |

## (a) `haltReason` templates

- **LEAK:** SDK `executor.ts`: any thrown message incl. adapter text (1847, 2674); `unknown type {def}@{ver}` (1529); `no binding registered for {def}@{ver}` (1708); `formatted payload is N tokens… wire format '{f}'` (1858); `review is '{pos}' but no reviewer is available` (1774); `each '{id}' received N items but declares max M` (2452). Host: `host.call.ts` 121, 216, 855; `host.ts` HostScopeError. Missing published pipeline: `runTurn.ts:695`, `cardAction.ts:224`. Dispatch and model choice: every `DispatchError` (`dispatch.ts` 460–1400); `capabilityTarget.ts` 359, 387, 460, 595, 627, 664, 706; `capabilityGuard.ts:246`. Wiring halts: `bindings.prompt.ts` 331, 750, 777, 791; `bindings.state.ts` 398, 437, 462, 507, 972, 1035; `bindings.summarize.ts` 324, 764, 796, 923, 953; `bindings.ts` 924–1094; `bindings.outlets.ts` 216, 239, 327; `sceneBoundaries.ts:31`; `roundWorth.ts:47`. Routines: `run.ts:357`, `evaluate.ts:176`.
- **NO SUGGESTION:** `bindings.providers.ts` 240, 247, 445, 453, 740, 743; `bindings.summarize.ts` 1335, 1410; `bindings.ts:1969`; `illustrateScene.ts:309`; `describeImage.ts` 105, 113; `host.call.ts:75`; `token budget exceeded` / `node execution budget exceeded`; `runRegistry.ts:544` "the run was aborted"; `HALT_WITHOUT_REASON`; `evaluate.ts:160`.
- **OWNER-ACTIONABLE:** "rejected at review" (`executor.ts:1798`); `capPause.ts:342`; `run.ts:328`; `evaluate.ts` 183, 185, 266; `bindings.summarize.ts:1065`.
- **Pass-through:** `sessionEvents.ts` 1130, 1191; `runTurn.ts:657`.

## (b) Is "the reader is an administrator" knowable at each emit point?

Yes wherever there is a socket (`runReply` progress and refuse, fireAction, fireTurn, summarize, `routineLog`, `promptTokenCount`: `socket.user.isAdmin`). Notification: `raiseReplyFailed` has the `userId` (needs a lookup). Stored row: no single reader, but `broadcastToSessionUsers` builds an admin set per recipient (`broadcastHelpers.ts` 98–115) and `emitToUser` has `socket.user`: a field `withoutConnectionIdentity` removes would carry the detail. Client: `userCtx.user.isAdmin` (`RunProgressCard`, `readinessStrip` read it). Accounts off: the fallback user is the first admin.

## (c) Existing "ask / tell an administrator" sentences (none is a shared export)

`generationStatus.ts` 38–40; `activityStore.ts` 18–19 "The service reported an error. An administrator can see the details."; `readinessStrip.ts:60` "No model is set up to reply. Ask your administrator."; `capabilityTarget.ts:359`, `:387`; `SpeechSettingsBlock.svelte:97` "Ask an administrator to add a voice, or pick one here."; `AccessibleLoginForm.svelte:205` "Need help? Contact your administrator."

## (d) Files on the per-recipient redaction axis

Already: `connections/visibility.ts`, `generationStatus.ts`, `activityStore.ts` (`activityError`), `broadcastHelpers.ts`, `sockets/index.ts`, `runHandler.ts`, `dispatch.ts` / `capabilityTarget.ts` / `host.call.ts` (a `connection` field). Not: `haltExplanation.ts`, `runReply.ts`, `liveRow.ts`, `sessions.pipelines.ts`, `summarize.ts`, `scenes.ts`, `routines/log.ts`, `sessions.messages.ts` (`promptTokenCount`), `offerMessage.ts`, `deletion.ts`. Where a fix could hang: `redactConnections` / `withoutConnectionIdentity` (server) and `isAdmin` (client); moving the raw reason into the `connection.detail` field, as `persistGenerationErrorRow` does, is the existing mechanism.
