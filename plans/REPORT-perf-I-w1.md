# REPORT perf-I w1 — LLM lanes per host

Status question: n/a, all work done.

## Changed files
- NEW src/lib/server/connections/llmLanes.ts (exports exactly as briefed)
- NEW src/lib/server/connections/llmLanes.test.ts
- src/lib/server/utils/llmQueue.ts (lane key, Set-based running, width via llmLaneWidthOf, widthsChanged, heldLanes [C8], snapshot laneKey, comments/priority doc corrected)
- NEW src/lib/server/utils/llmQueue.lanes.test.ts (new queue tests live here; llmQueue.test.ts unchanged, still passes)

## Nested-enqueue audit: none in production
Callers: utils/graphBuilder.ts:472, utils/summarizer/index.ts:123, pipelines/runtime/dispatchStep.ts:236 (all via runQueuedLLMCall), pipelines/runtime/dispatch.ts:1429 (direct enqueue). Every queued execute is `adapter.generateText()` (runQueuedLLMCall.ts:68; dispatch.ts `execute: () => adapter.generateText()`), preflight is `adapter.preflight`. Neither calls back into the queue. No cycle check or ordering built; same-lane inline guard kept as a safety net (comment says so).

## Tests
27 passed / 3 files (llmQueue.test.ts, llmQueue.lanes.test.ts 9, llmLanes.test.ts). Covers: two hosts concurrent / one serialises, managed w1, cloud 4 + queued 5th, override + widthsChanged, per-lane depth cap, [C8] outside-run item queues (not inline), nested same-lane inline vs different-lane queues, interactive vs routine across lanes, cancel one of 5 running in width-4 lane, snapshot laneKey; origins, hostname match with path, managed with cloud URL, empty URL -> connection:<id>, private-address cases, clamp 1-16.
tsc: nothing for llmQueue|llmLanes. Prettier: new files formatted; llmQueue.ts fails `prettier --check` but the HEAD version already did (pre-existing; I did not reformat it, to keep the diff small).

## Notes
- No cloud-list entry breaks the private-host rule: all cloud presets and https CONNECTION_DEFAULTS are public hostnames. Note: presets' baseUrl is under `connectionDefaults.baseUrl`.
- taskQueue.ts maps snapshot fields explicitly (taskQueue.ts:48) so `laneKey` is not forwarded; I did not edit it.
- A queued item whose lane is absent keys by `connection:<name>`, so existing callers (until w2 passes `lane`) get per-connection-name lanes, width 1.
- A lane's width is read from the host stored on the lane (set at enqueue); items on one key share it.

## Noticed, not done
- embedding/vectorizationQueue.ts:1466-1467 comment still says llmQueue has a single global lane.
- NOMENCLATURE §25 ledger needs the new names (supervisor's job).
