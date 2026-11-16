# REPORT perf-I w4 — Requests at once card (client half)

Status question: none relayed.

## Changed files
- `src/lib/client/sockets/typedSocket.ts` — four event-map entries after `connections:setCapability:error` (not in HANDLED_ERROR_EVENTS).
- `src/lib/shared/sockets/interest.ts` — `connections:llmLanes`, `connections:setLlmLaneWidth` gated (alphabetical in the connections group); consumers comment extended. No :error gated; not scoped.
- `src/lib/client/contexts/connections.svelte.ts` — new "Requests at once" block before "Held interests"; four interests in `declareAll`; `llmLanes` getter (null until the first reply), `askLlmLanes`, `setLlmLaneWidth` in the returned object. "Saved" toast only for an address this tab wrote (pending Set); any of the two :error events clears the marks, no toast.
- `src/lib/client/contexts/connections.dom.test.svelte.ts` — one new test.
- `src/lib/client/admin/sections/connections/Page.svelte` — `useConnections()`, `askLlmLanes()` on mount, card below the changelist.
- `connectionsAdmin.ts` / `.test.ts` — `llmLaneWidthParse`, `llmLaneUsedBy`, `LLM_LANE_WIDTH_MAX`, `LLM_LANE_WIDTH_REFUSAL` (+ tests).
- `docs/connections.md` — the paragraph, verbatim.

## Tests
- connectionsAdmin.test.ts: 13 passed.
- Capped run: connections.dom (incl. new test) and gatedEvents pass (38 passed); **comesWithApp.dom.test.svelte.ts FAILS (3 tests)**: it mounts `Page` with a context map that has no `connectionsCtx`, so `useConnections()` throws. That file is not mine. Fix needed there: add a `["connectionsCtx", {...}]` entry (hold, llmLanes, askLlmLanes, setLlmLaneWidth) to its `context()` map. I verified with a throwaway copy that adding a stub entry makes all 6 pass; the copy is deleted.
- tsc grep: clean (w3's types present). svelte-check grep: no errors in Page.svelte / contexts/connections.
- Prettier: Page.svelte was clean at HEAD, now formatted (clean). typedSocket.ts, connections.svelte.ts, connectionsAdmin.ts(+test), docs/connections.md were already failing at HEAD; not reformatted.

## Assumptions
- Context list is `null` while loading (card shows only the purpose sentence), `[]` shows the invitation.
- An ack carrying `error` does not toast "Saved" and clears the mark; nothing toasts it here (assumes the server also emits `:error`).
- The input saves on `change` (blur/Enter); an unchanged value sends nothing.

## Noticed, not done
- The comesWithApp test needs the context stub (above).
- Page.svelte and the shared files carry other lanes' uncommitted changes; I touched only my regions.
