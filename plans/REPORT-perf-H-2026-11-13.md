# REPORT — lane `perf-H` — the mid-stream frame is a delta, and widgets receive a row patch — 2026-11-13

(Supervisor's report, saved to disk by the lead; the harness refused the supervisor's write. Lead's acceptance note at the end.)

## What changed

- **Streaming frames are now deltas.** While a reply streams, each frame goes out as `sessionMessageDelta` carrying exactly `{ sessionId, id, content, reasoning }`.
- **Widgets in a worker get one row.** A `ComponentMount` widget now receives just the streaming row as `{ t: 'message' }`. Iframes still get full lists.
- **The settled row is unchanged.** Finish, error and cancel still go out as the full `sessionMessage` row through the live roster.
- **Nothing else is new:** no setting, table, migration, timer or cache.
- **Worker briefs:** `plans/briefs/BRIEF-perf-H-w1.md` (server), `-w2.md` (widget wire and SDK), `-w3.md` (client store and inbox), `-w4.md` (lane-privacy test).

**The first-frame rule (lead-approved 2026-11-13):** `laneScopedRecipients` (`channels/lanePush.ts:46`) decides who may see a personal-lane row by reading the full row's `channel`; a delta has no channel. So the frame that fills the run's recipients memo goes out as the full `sessionMessage`, and every later frame is a delta that reuses that memo. If the memo is reset after a failed lookup, the next frame is a full row again. N frames = 1 full row + N−1 deltas; a personal lane's deltas reach only that lane's readers (tested).

## Changed files

**Code**
- `src/lib/server/pipelines/runtime/liveRow.ts`: `announce(row, fresh, frame?)` chooses delta or full row inside the `announcing` chain, after the previous broadcast has filled (or failed to fill) the memo; `persist` passes `reasoning: now.reasoning ?? null`; comments updated.
- `src/lib/shared/sockets/interest.ts`: `sessionMessageDelta` in `SCOPED_EVENTS` (scope `payload.sessionId`) and `GATED_EVENTS`, consumer named.
- `src/lib/shared/sockets/types.ts`: additive `Sockets.SessionMessageDelta.Response`.
- `src/lib/client/sockets/typedSocket.ts`: one additive `SocketEventMap` entry (outside the brief; lead approved).
- `src/lib/client/sessions/store/sessionStore.svelte.ts`: new `applyMessageDelta` — patches through `patchCells` with a new source object per delta; returns null when the session isn't open, the id isn't held, the row is another session's, isn't a cell row, or isn't generating; `reasoning: null` leaves `metadata` alone, a string merges `metadata.reasoning` (mirrors the server's `jsonb_set`).
- `src/lib/client/components/sessionPage/sessionPageInbox.svelte.ts`: delta in `SESSION_SCOPED_EVENTS`.
- `src/lib/client/components/sessionPage/sessionPageData.svelte.ts`: `handleSessionMessageDelta` beside `handleSessionMessage`; calls `applyMessageDelta` then `witnessMessage(row, previous)` so widgets still hear `message:delta`.
- `src/lib/client/components/frames/widgetWire.svelte.ts`: `WidgetWireOptions.peerTakesOneMessage` — the changed row goes alone as `{ t: "message" }` only when exactly one input row changed, it is generating, and ids/order/channels are unchanged; nothing posted if its lane isn't one the widget holds; every other push posts the full list; option off = byte-identical to before.
- `src/lib/client/components/host/ComponentMount.svelte`: `peerTakesOneMessage: true`.
- `../serene-pub-sdk/sdk/src/componentWire.ts`: `case 'message'` replaces the held row by id in `data.messages` and in every `channel` list holding it; copies arrays; notifies only on an actual replace; ignores unknown id / malformed.
- `../serene-pub-sdk/sdk/src/surfaces.ts`: doc comment on the existing `{ t: 'message' }` member only.

**Docs**: `docs/sessions.md` new paragraph under **Send a message** (updates carry only text and reasoning so far; the whole message at start and at finish/stop/fail; a personal-lane reply streams only to that person and the owner). `NOMENCLATURE.md` §25 bullet for `sessionMessageDelta`, `WidgetWireOptions.peerTakesOneMessage`, `applyMessageDelta`; why not *row patch* (`RowPatch` is taken); R1 note on *frame*.

**Existing tests extended**: `shared/sockets/gatedEvents.test.ts` (delta in `MIGRATED_EVENTS`; scope, null without `sessionId`, `isScopedEvent`, gated); `server/sockets/index.interestGate.test.ts` (a delta reaches `#42` not `#9`; no `sessionId` → no scoped declaration).

**New tests**: `pipelines/runtime/liveRow.delta.int.test.ts` (6), `pipelines/runtime/liveRow.deltaLane.int.test.ts` (real `broadcastToSessionUsers` + `laneScopedRecipients` + gate: on ann's lane bo receives nothing; `main` control reaches bo), `client/sessions/store/sessionStore.delta.dom.test.svelte.ts` (5), `client/components/frames/widgetWire.oneMessage.dom.test.svelte.ts` (6), SDK `sdk-tests/componentWireMessage.test.ts` (4).

## Tests run

- App, capped scope: 53 files, 421 tests passed (`liveRow.{delta,deltaLane,perframe,recipients,reasoning}.int`, `runStatus.int`, `gatedEvents`, `scopedReplies`, `index.interestGate`, all of `client/sessions/store/`, `spMessageBody.dom`, all of `components/host/`, all of `components/frames/`). After the scope-review fix: `frames/` + `host/` 36 files, 229 passed. Worker 1: 12 server files, 175 passed. Worker 3: all of `components/sessionPage/` — one failure, `narrateDraft.dom.test.ts` C2 (pre-existing baseline, greps `SessionPage.svelte`, untouched).
- SDK `sdk-tests` (`componentWireMessage`, `componentWireT`, `surfaces`, `conversationRowFacts`): 40/40; `tsc --noEmit` in `sdk-tests` clean.
- `npx tsc --noEmit -p .` filtered to touched files: clean. `prettier --check`: every new file, `interest.ts`, `sessionPageInbox.svelte.ts` pass; the other edited files were unclean at HEAD and were not reformatted.
- No new `/tmp/serene-pub-vitest-*` left. **`sdk:build`: not run by the lane** (lead runs it — see acceptance note).

## Payload per frame

Script: scratchpad `perf-H-measure.mjs`. Row with every column, 3 swipes, 400 chars reasoning in fold and swipe slot.

| Reply size | Before: full row | After: delta | Ratio |
|---|---|---|---|
| 2 KB | 9,791 B | 2,503 B | 3.9× |
| 20 KB | 83,519 B | 20,935 B | 4.0× |

A streaming push to a `ComponentMount` widget used to carry the whole projected log per frame; now one projected row.

## Scope review: 2 findings, both accepted and fixed

1. Medium: the single-row path also fired for the settle, edits and no-move pushes → now requires the changed row to be generating; every other push posts the full list (the settle is always a recovery point). Test updated + new case.
2. Low: "frame" bolded as a term in §25 collides under R1 with a plugin's frame → un-bolded with an R1 note; `surfaces.ts` says "an iframe (`PluginFrame`)"; `widgetWire` comments say "streamed update".

## Decisions

First frame full, then deltas (lead-approved). `reasoning: string | null`, null = unchanged (mirrors server). Client drops a delta for a settled row (P1). Widget single-row path: exactly one changed row, generating, ids/order/channels unchanged. SDK test is a new file (`componentWireT` is about `t()`).

## Open ★

None.

## `sessionMessage` readers that stay on the full row

`composerFlow.svelte.ts:320`, `LorebooksWorkspace.svelte:2565` (ignore generating rows); `routes/document-view/sessions/[id]/+page.svelte:434` (never painted streamed text); status rows (`persistGenerationStatus`) still full rows.

## Noticed, not done

- SDK CLI test harness (`../serene-pub-sdk/cli/src/testing.ts:854`) never posts `{ t: 'message' }`, so plugin authors' harness tests don't exercise the streaming path.
- `emitRedacted` still walks every payload once per frame (cheap now).
- `index.interestGate.test.ts` uses its own gated set; the real `GATED_EVENTS` entry is guarded only by `gatedEvents.test.ts`.
- `narrateDraft.dom.test.ts` C2 — baseline.

## Lead's acceptance note

Accepted 2026-11-13. The first-frame rule is a correct consequence of lane scoping being decided off the row and stays; ★P1's payload is unchanged. `sdk:build` is run by the lead after telling the peer session (see the plan status). The payload table replaces the "O(reply) → O(delta)" estimate in W1's payoff line.
