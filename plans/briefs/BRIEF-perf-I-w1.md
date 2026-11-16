# BRIEF — perf-I worker 1 — LLM lanes per host: the key module and the queue

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The LLM queue (`src/lib/server/utils/llmQueue.ts`) has one global lane today (`getConcurrencyKey` returns `"global"`, line 160). Make it **one LLM lane per host**, where a host is the URL origin `(scheme, host, port)` of the connection's resolved base URL, with a **width** (calls in flight at once): **1** for every local or managed host, **4** for a known cloud host. Fix the re-entry set leak [C8]. Owner ruling 2026-11-13: "Per connection, per host. Need to safely tie it into the server management admin."

## Files owned (edit only these)

- NEW `src/lib/server/connections/llmLanes.ts` — the pure key/width module (+ the one async resolver below).
- NEW `src/lib/server/connections/llmLanes.test.ts`
- `src/lib/server/utils/llmQueue.ts`
- `src/lib/server/utils/llmQueue.test.ts` (existing; extend) and you may add `src/lib/server/utils/llmQueue.lanes.test.ts`

Another worker (w2) is editing `pipelines/runtime/dispatch.ts`, `utils/runQueuedLLMCall.ts`, `summarizer/index.ts`, `graphBuilder.ts`, `dispatchStep.ts` at the same time and will import from your module **exactly the exports named below** — keep those names and signatures. Do not touch those files.

## Files readable

`src/lib/shared/utils/connectionDefaults.ts` (`CONNECTION_DEFAULTS`, `OPENAI_COMPATIBLE_PRESETS` — entries carry `category: "cloud" | "local" | "custom"`), `src/lib/shared/connections/credentials.ts` (`looksLikeCloud`, private), `src/lib/shared/constants/ConnectionTypes.ts` (`CONNECTION_TYPE.isManagedKoboldCpp`, `isManagedAudioCpp`), `src/lib/server/pipelines/runtime/dispatchImage.ts:414` (`resolveBaseUrl` — the same managed-address rule you mirror), `src/lib/server/koboldcpp/managedPreflight.ts:122`, `src/lib/server/utils/taskQueue.ts` (reads `llmQueue.snapshot()`).

## The contract w2 builds against — `src/lib/server/connections/llmLanes.ts`

```ts
/** The width of a known cloud host's LLM lane: calls in flight at once. A constant, never a setting. */
export const CLOUD_LLM_LANE_WIDTH = 4

/** The host an LLM lane is keyed by. */
export interface LlmLaneHost {
	/** The LLM lane key: the URL origin (`new URL(base).origin`, e.g. `http://localhost:5001`,
	 *  `https://openrouter.ai`) of the resolved base URL. A base URL that is empty or does not parse
	 *  falls back to `connection:<id>` (or `connection:<name>` when there is no id) — that
	 *  connection's own lane, width 1. */
	laneKey: string
	/** A managed connection type (Serene Pub runs the process): `isManagedKoboldCpp || isManagedAudioCpp`. */
	managed: boolean
	/** The origin's hostname is a known cloud host (see below). Never true when `managed`. */
	cloud: boolean
}

/** PURE. Same input, same answer. `baseUrl` here is the already-resolved address. */
export function llmLaneHostOf(connection: { id?: number | null; name?: string | null; type?: string | null; baseUrl?: string | null }): LlmLaneHost

/** Async: resolves a managed KoboldCPP connection's real address first (its row's baseUrl is display only):
 *  `koboldCppSettings.koboldCppManagerBaseUrl ?? connection.baseUrl` — the same rule as dispatchImage.ts:414.
 *  Every other type (managed audio.cpp included — its row is kept in sync at boot by foldAudioCppManagedBaseUrl)
 *  uses the row's baseUrl. Then `llmLaneHostOf`. Load the db lazily (`(await import("$lib/server/db")).db`),
 *  so importing this module in a unit test opens no database; `await dbReady` style is already handled by the db
 *  module — never add a top-level await. A settings read that throws falls back to the row's baseUrl. */
export async function resolveLlmLaneHost(connection: { id?: number | null; name?: string | null; type?: string | null; baseUrl?: string | null }): Promise<LlmLaneHost>

/** The derived default width: managed → 1, cloud → CLOUD_LLM_LANE_WIDTH, everything else → 1.
 *  ⚠ The managed branch is THE HOOK for the Servers direction: a managed server's own width field
 *  (not built — build nothing for it) would be read here. Say so in the doc comment. */
export function defaultLlmLaneWidth(host: LlmLaneHost | undefined): number

/** The width the queue uses: an override for this laneKey if one is set, else the default; clamped 1–16.
 *  Overrides come from `setLlmLaneWidthOverrides` (a later step of this lane stores admin overrides in a table
 *  and feeds them through it; tests feed them directly). */
export function llmLaneWidthOf(host: LlmLaneHost | undefined, laneKey: string): number
export function setLlmLaneWidthOverrides(overrides: ReadonlyMap<string, number>): void
```

**Known cloud hosts — derive, never write a second list (R1):** the hostnames of `OPENAI_COMPATIBLE_PRESETS` entries with `category === "cloud"`, plus the hostnames of `CONNECTION_DEFAULTS` entries whose `baseUrl` is `https:` (Anthropic, AI Horde, NovelAI, BFL, ElevenLabs today). Compare by **hostname** (lowercased), so `https://openrouter.ai/api/v1` on a connection matches the preset whatever its path. Build the set once at module load. Localhost / loopback / RFC1918 / `.local` / single-label names are never cloud: the derived set holds only public hosts, so this holds structurally — **pin it with tests** (`http://localhost:11434`, `http://192.168.1.5:5001`, `http://gpu-box.local:8080` → width 1) rather than writing a second copy of `credentials.ts`'s private predicate. Note in your report if you find a list entry that would break this.

## Queue changes — `src/lib/server/utils/llmQueue.ts`

1. `LLMQueueItemInput` gains `lane?: LlmLaneHost` (type-only import from `$lib/server/connections/llmLanes`). Doc comment: "The host this call's LLM lane is keyed by (`resolveLlmLaneHost`). Absent: the lane of `connectionName` alone (`connection:<name>`), width 1."
2. `getConcurrencyKey(item)` returns `item.lane?.laneKey ?? \`connection:${item.connectionName}\``. Replace the stale comment at `:157-159` ("nothing else in this module or its callers needs to change") and the "single global lane" block at `:143-155` with the truth: one LLM lane per host; width from `llmLaneWidthOf`; `MAX_QUEUE_DEPTH` (same number, 20) is **per lane**.
3. `Lane` becomes `{ queue: Run[]; running: Set<Run>; host?: LlmLaneHost }` (store the host from the item when the lane is created / an item is queued). `pump(laneKey)` starts queued runs while `lane.running.size < llmLaneWidthOf(lane.host, laneKey)`. Every place that used `lane.running === run` / `= null` (the pump `.finally`, the force-detach timer at `:419-434`) uses the set. Add a public `widthsChanged()` method that pumps every lane (called after overrides change, so a raised width starts waiting items at once).
4. **[C8] re-entry, confirmed fact:** today `pump` builds a run's held-lane set from the async context *pump* runs in (`:344`), and pump is called from the previous run's `.finally` (`:347-349`) and the force-detach timer (`:432`), so an unrelated next item inherits the previous run's set. Fix: `Run` gains `heldLanes: ReadonlySet<string>` captured from `activeLanes.getStore()` **in `enqueue`**; `pump` starts each run under `activeLanes.run(new Set([...run.heldLanes, laneKey]), …)`, never its own context. Inline (`runInline`) **only** when `run.heldLanes`/the caller's store already has this lane. A nested enqueue onto a lane the chain does NOT hold queues normally.
5. **Nested enqueues in production — check first and say what you found.** The cited origin was the assistant tool-calling turn; Assistant Chat is deprecated. Grep every `llmQueue.enqueue(` and `runQueuedLLMCall(` caller (`summarizer/index.ts`, `graphBuilder.ts`, `pipelines/runtime/dispatchStep.ts`, `pipelines/runtime/dispatch.ts`) and whether any can be reached from inside an `execute`/`preflight`. The supervisor's own read is "none". If none: no cycle check, no lane ordering; keep the same-lane inline guard; pin the behaviour with tests (below). If you do find one, STOP and report it with file:line — do not build an ordering scheme.
6. Width > 1 must keep working: `snapshot()` (add `laneKey: string` to `LLMQueueSnapshotItem` — server-side only; `taskQueue.ts` maps fields explicitly and must keep not forwarding it; check that), the status listeners, `cancel` of a queued or running item (`CancelledError`, `ForceDetachedError`, `onCancel`) — cancelling one of several running items in a lane cancels only it and starts the next waiting one when it settles.
7. The `priority` doc comment (`:29-36`) says "The lane itself is unchanged: one call at a time" — correct it (priority orders the waiting calls within one LLM lane).

## Tests (Done means)

`llmQueue` tests (fake `lane` objects via `llmLaneHostOf`, `execute` closures you resolve by hand — no timers longer than needed):
- two connections on two hosts run concurrently; two connections on one host serialise;
- a managed host is width 1; a cloud host runs 4 and queues the 5th;
- an override via `setLlmLaneWidthOverrides` + `widthsChanged()` raises a waiting lane's width at once (reset overrides in `afterEach`);
- depth cap is per lane (lane X full does not refuse lane Y);
- [C8]: an item queued from the `.finally` of a run that held lane X, on lane Y, does NOT run inline on X's set (e.g. a run on X finishes, the next item on X — enqueued from outside any run — must queue behind a still-running X item when width is 1 rather than run inline);
- a nested enqueue from inside a running item on the SAME lane runs inline (existing test keeps passing); a nested enqueue on a DIFFERENT lane queues;
- starvation: an interactive-priority item on lane X is not blocked by routine items filling lane Y;
- cancel of one of several running items in a width-4 lane cancels only it;
- snapshot lists each running item with its `laneKey`;
- `llmLanes.test.ts`: origins (`http://localhost:5001/v1/` → `http://localhost:5001`), cloud match by hostname with a path, managed KoboldCPP → managed/width 1 even with a cloud-looking baseUrl, empty baseUrl → `connection:<id>`, the three private-address cases → width 1, override clamp 1–16.

Run: `npx vitest run src/lib/server/utils/llmQueue.test.ts src/lib/server/utils/llmQueue.lanes.test.ts src/lib/server/connections/llmLanes.test.ts` (unit tests — no PGlite). Then `npx tsc --noEmit -p . 2>&1 | grep -E "llmQueue|llmLanes"` (expect nothing; other lanes' errors are not yours) and `npx prettier --check` on each file you touched.

## Rules (quoted for you by the supervisor)

- **P1 (CLAUDE.md):** "Code decides what code can … Same inputs, same result." The lane key is a pure function of the connection's base URL and type. Same connection, same lane, every time. No time-based or load-based choice.
- **P3:** no setting. **P5:** nothing user-facing is declared here. The width is a constant, not a setting.
- **Managed connections:** the supervisor (`managed/supervisor.ts`) serialises `start()`; the queue's width 1 for managed hosts is the only guard against two generations on one GPU — do not loosen it.
- **NOMENCLATURE §1:** "R1 — One word, one meaning." "R3 — Qualify, never abbreviate to the bare noun." **§11:** "**lane** — An independent background processing queue … **Indexing only** when bare — the session sense is always the qualified **channel lane** … Still loose: `llmQueue`'s own `Lane`". So in new names and comments say **LLM lane** (never bare "lane" in a new exported name), and introduce no third word for it. The new names are exactly: `LlmLaneHost`, `laneKey`, `llmLaneHostOf`, `resolveLlmLaneHost`, `defaultLlmLaneWidth`, `llmLaneWidthOf`, `setLlmLaneWidthOverrides`, `CLOUD_LLM_LANE_WIDTH`, `widthsChanged`, `heldLanes`. Add no other exported name without asking. Do not edit NOMENCLATURE.md (the supervisor records them).
- No `crypto.randomUUID` (the queue uses `uuidv4` already). Never add a top-level `await` to `src/lib/server/db/index.ts`; never import the db at module top in `llmLanes.ts`.
- Out of scope: model residency, loading order, per-user caps, pre-emption, adapters, preflight, idle timeouts, the managed supervisor. Do not touch `runtime/host.ts`, `runtime/bindings.ts`, `routines/run.ts`.

## Stop and ask (in your report) when

A nested enqueue exists in production; a name beyond the list above seems needed; anything outside the owned files.

## Hazards (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no sdk:build.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."

## Report

Write `plans/REPORT-perf-I-w1.md`: changed files, the nested-enqueue audit result with the call sites checked, tests with counts, tsc/prettier results, anything you noticed but did not do.
