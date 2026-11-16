# REPORT perf-I w3 — LLM lane width overrides, server half

Status question: answered in one line — server half is written; DB-backed tests are pending schema.

## Changed files
- NEW src/lib/server/connections/llmLaneWidths.ts (ensureLlmLaneWidthsLoaded, listLlmLaneHosts, setLlmLaneWidth)
- NEW src/lib/server/connections/llmLaneWidths.int.test.ts
- src/lib/server/connections/llmLanes.ts: resolveLlmLaneHost awaits a dynamic import of ensureLlmLaneWidthsLoaded before returning.
- src/lib/server/sockets/connections.ts: handlers connectionsLlmLanes (:1077) and connectionsSetLlmLaneWidth (:1095); register lines :2668-2669; one import block added near the other imports.
- src/lib/shared/sockets/types.ts: namespaces LlmLanes (:2515) and SetLlmLaneWidth (:2534) inside Connections, after SetCapability.

## Tests
- Tests pending schema. `llmLaneWidths` is not in schema.ts and there is no drizzle/0159 yet. Checked repeatedly over several minutes. The int test (6 `it`s: migration with a second migrate unchanged; set/clear/default; refusals; one host with two names plus ONNX/image skipped; stale override; managed KoboldCPP) has not been run.
- llmLanes.test.ts and llmQueue.lanes.test.ts: 22 passed.
- tsc: the only errors from my files are "llmLaneWidths does not exist on schema" (7, in my module and test). Nothing from sockets/connections.ts or types.ts.
- prettier: the new test file is formatted. llmLaneWidths.ts and llmLanes.ts pass. sockets/connections.ts and types.ts fail --check, but they already failed at HEAD, so I did not reformat them.

## Assumptions
- Admin-denied `connections:llmLanes` emits `connections:llmLanes:error` (CAPABILITY_DENIED) and returns empty hosts.
- Stale-override hosts report defaultWidth 1, managed/cloud false (no connection to derive from).
- The test mocks `$lib/server/db` with a createTestDb handle plus `dbReady: Promise.resolve()`.
- The test's migration half cuts at tag `0158_sweet_nightshade`.

## Noticed, not done
- Needs the supervisor's schema.ts table and migration 0159 before the int test can run. Re-run the capped command from the brief afterwards.
- Nothing calls ensureLlmLaneWidthsLoaded at boot except via resolveLlmLaneHost, so overrides load on the first LLM queue resolution.
