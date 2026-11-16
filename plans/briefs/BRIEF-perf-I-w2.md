# BRIEF — perf-I worker 2 — a streamed reply holds its LLM lane; callers pass the connection

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Two things, both on the enqueue side of the LLM queue.

**A. ★P2-b (owner ruling 2026-11-13): a streamed reply holds its host's LLM lane for the whole stream.** Confirmed fact [C7]: `pipelines/runtime/dispatch.ts:1450` has `execute: () => adapter.generateText()`; every streaming adapter returns a lazy `completionResult` closure and only sends the request inside it (`OpenAIChatAdapter.ts:449-455`, `KoboldCppAdapter.ts:413`, `OllamaAdapter.ts:438`); dispatch calls that closure at `:1525` **after** the queue has settled the run and freed the lane. So streamed session replies were never serialised. Fix: the queued item's `execute` reads the stream to its end, as `utils/runQueuedLLMCall.ts:68-105` already does. The lane is then released when the stream ends, is aborted or fails. Status `generating` now spans the stream. Cancel (`onCancel` → `adapter.abort()`, and `request.signal` → `llmQueue.cancel(id)`) must still stop a stream mid-way.

**B. Pass the connection to the queue.** Each queued item carries `lane: LlmLaneHost`, the host its LLM lane is keyed by, from `await resolveLlmLaneHost(connection)`. Worker w1 is writing that module **right now** at `src/lib/server/connections/llmLanes.ts` with exactly this API (do not create or edit that file, nor `utils/llmQueue.ts`):

```ts
export interface LlmLaneHost { laneKey: string; managed: boolean; cloud: boolean }
export async function resolveLlmLaneHost(connection: { id?: number | null; name?: string | null; type?: string | null; baseUrl?: string | null }): Promise<LlmLaneHost>
// and on LLMQueueItemInput (utils/llmQueue.ts):  lane?: LlmLaneHost
```

## Files owned (edit only these)

- `src/lib/server/pipelines/runtime/dispatch.ts` — **only** the `generate` block (around `:1415-1475`, the enqueue) and the block it now encloses: the reply-facts computation + `request.onReplyFacts` (`:1478-1520`) and the stream-reading block (`:1525-1550`). No other edits in that file. It is a peer-released file.
- `src/lib/server/utils/runQueuedLLMCall.ts`
- `src/lib/server/utils/summarizer/index.ts`, `src/lib/server/utils/graphBuilder.ts`, `src/lib/server/pipelines/runtime/dispatchStep.ts` — **argument additions only** at their `runQueuedLLMCall({ … })` call (`:123`, `:472`, `:236`): add `connection: { id, type, baseUrl }` from the connection each already holds (`opts.connection` / `connection`). Nothing more.
- `src/lib/server/pipelines/runtime/dispatch.int.test.ts` (add tests; its `FakeAdapter` already has `preflight`, streaming modes, `aborted`).

## What to build

1. `RunQueuedLLMCallParams` gains `connection?: { id?: number | null; type?: string | null; baseUrl?: string | null }`. Inside, before `llmQueue.enqueue`, `const lane = connection ? await resolveLlmLaneHost({ ...connection, name: connectionName }) : undefined`; re-check `signal?.aborted` after that await (return `{ text: "", isAborted: true }`), then pass `lane` on the item. A caller that passes no connection keeps today's fallback lane (keyed by `connectionName`) — say so in the doc comment.
2. `dispatch.ts`: `connection` is in scope (`:1144`). In `generate`, pass `lane: await resolveLlmLaneHost(connection)` on the item (resolve it before the enqueue, re-check `request.signal?.aborted` after the await).
3. `dispatch.ts`, the restructure. Today: `generate()` returns the adapter's `TextGenResult`; then the facts are computed (they read `adapter.reasoningOpening` *after* `generateText()` returned) and `request.onReplyFacts` is called; then the stream is drained with chunks forwarded to `request.onChunk` / `request.onReasoning`. Make one local async function (e.g. `drain`) that does exactly that sequence — `generateText()`, compute `facts` and call `request.onReplyFacts?.(facts)`, then drain a streamed `completionResult` forwarding chunks (or, non-streaming, the existing branch that forwards `reasoning` then `text`) — and returns `{ result, text, reasoning, facts }`. The queued item's `execute` is `drain`; the unqueued path (`!request.queue`) calls `drain()` directly. The two cancellation returns in `generate` (`signal` already aborted; `isQueueCancellation(err)`) must still yield an aborted call: return `result = { completionResult: "", isAborted: true }` with empty text/reasoning, and compute + announce `facts` the same way the old code did for that case (it computed them and called `onReplyFacts` after `generate()` returned, whatever happened) so nothing downstream reads an undefined `facts`. Everything after the stream block (`replyView`, the returned object reading `result.isAborted`, `result.toolCall`, `result.media`, `usageOf(result, adapter)`, `adapter.stopHit`, …) must keep reading the same values. Keep every existing comment that still holds, moved with its code; fix any that now lies (e.g. one that says the stream runs after the queue settles).
4. Keep `preflight` / `onCancel` / `onStatusChange` exactly as they are.

## Tests (Done means)

Add to `dispatch.int.test.ts` (fake adapter; use the existing harness and connection fixture — give the fixture connection a local baseUrl, so its LLM lane is width 1):
- a streamed call on a width-1 lane blocks a second queued call on the same connection until the first stream ends (hold the first stream open with a promise you release by hand; assert the second's `generateText` has not been called, then release and assert it runs);
- an abort (`request.signal` aborted mid-stream) frees the lane: the second call then runs;
- `onStatusChange` sees `generating` before the first chunk and the item settles only after the last chunk.
Then run, capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/server/pipelines/runtime/dispatch.int.test.ts src/lib/server/pipelines/runtime/dispatch.cardless.int.test.ts src/lib/server/pipelines/runtime/dispatch.cardsNow.int.test.ts src/lib/server/pipelines/runtime/samplingSlotDispatch.int.test.ts` and any summarizer / graphBuilder / dispatchStep tests that exist (`ls src/lib/server/utils/summarizer/ src/lib/server/utils/graphBuilder* src/lib/server/pipelines/runtime/dispatchStep*`). If `llmLanes.ts` does not exist yet when you get to tests, finish the code, run `ls src/lib/server/connections/llmLanes.ts` again a little later; if still missing, report "tests pending w1" rather than creating it. `npx tsc --noEmit -p . 2>&1 | grep -E "dispatch\.ts|runQueuedLLMCall|summarizer/index|graphBuilder\.ts|dispatchStep"` (expect nothing) and `npx prettier --check` on each touched file.

## Rules (quoted for you by the supervisor)

- **P1 (CLAUDE.md):** "Same inputs, same result." The lane key is a pure function of the connection's base URL and type — you only pass the connection; never choose a lane by time or load.
- **P3:** no setting. **P5:** nothing user-facing is declared.
- **Managed connections:** the queue's width 1 for managed hosts is the only guard against two generations on one GPU — holding the lane for the whole stream is what makes it true for replies. Do not loosen it.
- NOMENCLATURE §1 R1/R3: say **LLM lane** in comments, never bare "lane" for the queue's lane (bare "lane" means the indexing lanes; the session sense is "channel lane"). Introduce no new exported name.
- Changing adapters, preflight, idle timeouts or the managed supervisor is out of scope. Do not touch `runtime/host.ts`, `runtime/bindings.ts`, `routines/run.ts`, `liveRow.ts`.
- `socket.off(event)` with no handler removes every listener — n/a here, but never.

## Stop and ask (in your report) when

A call site cannot reach its connection without a wider refactor (keep it on the fallback lane, say so); the facts/stream restructure would need edits outside the named blocks.

## Hazards (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no sdk:build.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."

## Report

Write `plans/REPORT-perf-I-w2.md`: changed files with the line ranges edited in `dispatch.ts`, tests with counts, tsc/prettier results, anything you noticed but did not do.
