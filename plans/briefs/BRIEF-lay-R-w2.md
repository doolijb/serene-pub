# BRIEF lay-R-w2 — the Runs widget, app data path (sonnet worker)

Supervisor: lay-R (Opus). App: `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TS, Vitest 4, Drizzle + PGlite, Socket.IO 4). SDK sibling: `/home/jody/github/serene-pub-sdk` (another worker is adding the SDK half at the same time; the supervisor rebuilds the SDK dist — **you never run `sdk:build`**). Another programme (`cv-*`) edits server files concurrently: **re-read each file right before you edit it, minimal hunks, never rewrite whole files.** `sockets/pipelines.ts` and `shared/sockets/types.ts` are SHARED files — touch only the hunks named here. Line numbers drift; re-find by grep.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

## Goal
Owner 2026-11-06: "Create a widget for pipeline history etc and debugging. Only renders for admins." Core widget **Runs** (`session-runs`). You build the app's half: the server columns, the page's answerers for two new widget requests, the page wiring, and keeping the widget out of a non-admin's tray.

## Rules (quoted from CLAUDE.md / the canon — they apply to everything you write)
- "Inside `db.transaction(async (tx) => …)` use only `tx`." · "Never add a top-level `await` to `src/lib/server/db/index.ts`." · "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`." · It is a **session**, never a *chat*.
- **Receipts are an administrator's (R55):** `pipelines:runs` / `pipelines:run` already refuse non-admins server-side (`receiptsAdminOnly`). The app answerers must ALSO refuse a non-admin **before any socket emit** (so no `:error` reply and no toast ever happens): `throw new Error("runs are for admins")` as `requests/inspectRun.ts` does.
- **Sockets:** "one domain context per event family is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." A refused/failed widget request is the asking widget's own error (R77) — reject the promise, never toast.
- **Never select the `receipt` column in a list** (2026-10-30 PGlite memory fix, comment in `pipelinesRuns`): add only plain columns.
- **No schema migration.** No new socket event. No new setting.
- Never "trigger" in UI text (retired) — you write no UI text here anyway.

## Contract (SDK types the other worker adds to `@serene-pub/sdk`; code against exactly this)
```ts
WidgetRequests['session-runs']      = { params: { limit?: number }; result: SessionRunsV1 }
WidgetRequests['session-run-steps'] = { params: { runId: string }; result: SessionRunStepsV1 }
interface SessionRunV1 { runId: string; pipeline: string; outcome: 'ok'|'halt'|'err'|'cancelled';
  triggerFamily: string|null; registrationKey: string|null; triggerSource: string;
  userId: number|null; username: string|null; startedAt: number /*epoch ms*/; endedAt: number;
  elapsedMs: number; tokens: number; haltNodeKey: string|null; haltReason: string|null;
  isPreview: boolean; parentRunId: string|null; depth: number; promptMessageId: number|null }
interface SessionRunsV1 { runs: SessionRunV1[] }
interface SessionRunStepV1 { seq: number; key: string; kind: string; result: string; reason: string|null; elapsedMs: number; tokens: number|null }
interface SessionRunStepsV1 { steps: SessionRunStepV1[] }
WIDGET_REQUEST_ASKERS: both 'core'
```
Until the supervisor rebuilds the SDK dist these types/askers are missing from `@serene-pub/sdk` — write the code anyway; tsc errors that are only "has no exported member SessionRunsV1 / not assignable to keyof WidgetRequests" are expected until then — list them, don't work around them.

## Work

### A. Server — `src/lib/server/sockets/pipelines.ts` (`pipelinesRuns`, grep `event: "pipelines:runs"`) + `src/lib/shared/sockets/types.ts` (`namespace Runs`, inside `Pipelines`; grep `namespace Runs {`)
- Add to the `.select({...})`: `triggerFamily`, `registrationKey`, `triggerSource`, `endedAt`, `parentRunId`, `depth` (schema columns on `schema.pipelineRuns`). Map into each row: `triggerFamily: r.triggerFamily ?? null`, `registrationKey: r.registrationKey ?? null`, `triggerSource: r.triggerSource`, `endedAt: new Date(r.endedAt).toISOString()`, `parentRunId: r.parentRunId ?? null`, `depth: r.depth ?? 0`.
- Echo the asked session: the response gets `...(params.sessionId != null ? { sessionId: params.sessionId } : {})` at the top level (both the admin answer and the refusal's empty list).
- Types: in `Runs.Response` add `sessionId?: number` (doc: "The session asked for, echoed so a reader of one session's runs can tell its reply from another's.") and the six row fields with one-line docs (`triggerFamily: string | null` — which family of registration started it, event · action · routine; `registrationKey: string | null`; `triggerSource: string` — the receipt's trigger source; `endedAt: string`; `parentRunId: string | null`; `depth: number`).
- New int test `src/lib/server/sockets/pipelines.runsColumns.int.test.ts` modelled on `pipelines.scoping.int.test.ts` (its `vi.mock("$lib/server/db", …createTestDb…)`, `recordingEmit`, `bootstrapPipelines`, `createTestUser`, mkdtemp under `os.tmpdir()` with prefix `serene-pub-vitest-lay-R-runs-` and removed in `afterAll` by that exact path). Insert one `pipeline_runs` row for a session (fill the notNull columns; read the schema around `pipelineRuns` in `src/lib/server/db/schema.ts` ~:6766) with `triggerFamily: 'routine'`, `registrationKey: 'every-n-turns→story-sweep'`, `triggerSource: 'schedule'`, a `parentRunId`, `depth: 1`; call `pipelinesRuns.handler` as an admin with `{ sessionId }` → the row carries the six fields and the response echoes `sessionId`; and does not carry `receipt`. Every `it`/`test` that touches the DB gets a 60 s timeout (`, 60_000`).

### B. Answerers — new `src/lib/client/components/sessionPage/requests/sessionRuns.ts` (+ `sessionRuns.test.ts`)
Model on `requests/routineLog.ts` + `requests/inspectRun.ts`. Export:
- The limits 25 (default) and 100 (most) are module-private consts here (not exported — the kit `@serene-pub/core-catalog/session-runs` owns the exported `SESSION_RUNS_FIRST` / `SESSION_RUNS_MOST`; don't import the kit in this file, it isn't built yet).
- `type SessionRunsRead = (ask: Sockets.Pipelines.Runs.Params & { sessionId: number; limit: number }) => Promise<Sockets.Pipelines.Runs.Response>`
- `type RunReceiptRead = (runId: string) => Promise<Sockets.Pipelines.Run.Response>`
- `sessionRunOf(row: Sockets.Pipelines.Runs.Response["runs"][number], promptMessageId: number | null): SessionRunV1` — pure mapping (ISO → epoch ms; `tokensSpent` → `tokens`; `specSlug` → `pipeline`; unknown outcome strings → keep as given cast; `username ?? null`). Exported because the Sessions sidebar's Runs tab (next worker) maps the same rows.
- `sessionRunStepsOf(receipt: unknown): SessionRunStepV1[]` — through `nodeRows` from `$lib/client/components/pipelines/inspector/receiptView` (`key: row.label`, `kind`, `result`, `reason: row.reason ?? null`, `elapsedMs`, `tokens`). Exported for the same reason.
- `answerSessionRuns(params, deps: { isAdmin: boolean; sessionId: number | null; contextDebugging: boolean; findMessage(id: number): { id: number; debugMeta?: unknown } | undefined; read: SessionRunsRead }): Promise<SessionRunsV1>`:
  1. `!deps.isAdmin` → throw `"runs are for admins"` (before anything else — no read).
  2. `limit` absent → 25; present but not a whole number ≥ 1 → throw `"session-runs' limit is a whole number of runs, at least 1"`; above 100 → clamp to 100.
  3. no session → throw `"this page has no session open"`.
  4. `res = await read({ sessionId, limit })`; `res.error` → throw it (the response type may not have `error`; check and handle `(res as {error?:string}).error`).
  5. Each row: `promptMessageId` = the first artifact with `kind === "message"` whose `entityId` is a line `findMessage` finds WITH a truthy `debugMeta`, and only when `deps.contextDebugging` — else null. (The Prompt door is `prompt-details`, which needs admin + context debugging + the line loaded with its recorded prompt; the widget shows the button only when this is set.)
- `answerSessionRunSteps(params, deps: { isAdmin: boolean; read: RunReceiptRead }): Promise<SessionRunStepsV1>`: not admin → throw first; `runId` not a non-empty string → throw `"session-run-steps names a runId"`; `res = await read(runId)`; `res.error` or no `res.run` → throw the error (or `"no such run"`); return `{ steps: sessionRunStepsOf(res.run.receipt) }`. No new server code.
- Tests: non-admin refused AND the read never called (both answerers); limit default / clamp / bad; no session; mapping of one row (every field, ISO→ms); promptMessageId set only with context debugging on AND the line loaded with debugMeta; steps mapped from a small receipt `{ nodes: [{ seq: 2, nodeKey: 'b', … }, { seq: 1, nodeKey: 'a', iteration: 0, … }] }` sorted, label with `[0]`; `WIDGET_REQUEST_ASKERS["session-runs"]` and `["session-run-steps"]` are `"core"` (this one passes only after the SDK rebuild — fine).

### C. Wiring
- `requests/index.ts`: import the answerers; add to `WidgetRequestDeps` (grep `readRoutineLog: RoutineLogRead`) `readSessionRuns: SessionRunsRead` and `readRunReceipt: RunReceiptRead` with 🚧 one-line docs; add to the exhaustive `WIDGET_REQUEST_ANSWERS` table beside `"routine-log"`:
  `"session-runs": (p, _from, d) => answerSessionRuns(p, { isAdmin: d.isAdmin(), sessionId: d.sessionId(), contextDebugging: d.contextDebugging(), findMessage: d.findMessage, read: d.readSessionRuns })`
  `"session-run-steps": (p, _from, d) => answerSessionRunSteps(p, { isAdmin: d.isAdmin(), read: d.readRunReceipt })`
  Check `requests/index.test.ts` for a list it pins and update it.
- `pageAsks.ts`: two readers next to `readRoutineLog` (grep), same promise shape (`declareInterest`, `done` guard, `release()`, 15 s timeout rejecting `"the server did not answer"`):
  - `readSessionRuns(ask)`: `// BARE: pipelines:runs is not a scoped event; the echoed session id is the filter.` — interest on `"pipelines:runs"`, settle when `res?.sessionId === ask.sessionId`; emit `socket.emit("pipelines:runs", ask)`.
  - `readRunReceipt(runId)`: interest on `"pipelines:run"` settling when `res?.run?.runId === runId`, AND on `"pipelines:run:error"` rejecting with `res.error` (both released on settle); emit `socket.emit("pipelines:run", { runId })`.
  Return both from the asks object.
- `src/routes/sessions/[id]/+page.svelte` `widgetRequestDeps` (grep `readRoutineLog: asks.readRoutineLog`): add `readSessionRuns: asks.readSessionRuns, readRunReceipt: asks.readRunReceipt,`.
- `src/lib/server/components/core.ts` `SOURCES` (grep `"routine-log": () =>`): add `// 🚧 Runs (lay-R, owner 2026-11-06).` + `"session-runs": () => import("@serene-pub/core-catalog/components/session-runs.source.json?raw"),`.

### D. Tray — admin-only, app side (NO new SDK declaration field)
- `sessionPage/coreWidgets.ts`: export `ADMIN_ONLY_WIDGET_IDS: ReadonlySet<string> = new Set(["session-runs"])` with a doc (core widgets only an administrator is offered: the tray and the phone editor's Add never list them for anyone else; the widget itself also draws nothing for a non-admin, and the server refuses its reads — R55). Change `coreDefaultWidgets()` to `coreDefaultWidgets(isAdmin: boolean)` (required) that drops those ids when `!isAdmin`.
- `sessionPage/sessionLayoutData.svelte.ts`: add `isAdmin(): boolean` to `SessionLayoutDataDeps` (doc it); replace the once-computed `CORE_DEFAULT_PANELS` use in `initSurfaceManagerIfReady` by `coreDefaultWidgets(d.isAdmin())` (keep the comment's sense). Grep the file for any other `CORE_DEFAULT_PANELS` use and keep it consistent. In `+page.svelte` `createSessionLayoutData({ ...base, surfaceManager, data })` → add `isAdmin: () => !!userCtx.user?.isAdmin`. Verify (read `SessionLayoutRender.svelte` ~:233 and the editor membership) that a stored layout naming a widget with no offered panel draws NOTHING for that slot (no placeholder) — report what you found.
- Grep every other caller of `coreDefaultWidgets(` and `createSessionLayoutData(` (tests, harnesses: `sessionLayoutDataHarness.test.svelte`, `sessionLayoutData.dom.test.svelte.ts`) and pass the new argument.
- `coreWidgets.test.ts`: the sorted id list gains `"session-runs"` for an admin (`coreDefaultWidgets(true)`); add a test that `coreDefaultWidgets(false)` omits exactly `ADMIN_ONLY_WIDGET_IDS` and every id in it is a core widget id; update other calls to pass `true`. If a sessionLayoutData test can cheaply assert the non-admin tray lacks `session-runs`, add it; otherwise say so.

## Files owned (only these)
`src/lib/server/sockets/pipelines.ts` (the pipelinesRuns hunks), `src/lib/shared/sockets/types.ts` (the Runs hunks), new `src/lib/server/sockets/pipelines.runsColumns.int.test.ts`, new `requests/sessionRuns.ts` + `.test.ts`, `requests/index.ts` (+ `index.test.ts` if it pins a list), `pageAsks.ts`, `src/routes/sessions/[id]/+page.svelte` (the two dep hunks only), `src/lib/server/components/core.ts`, `sessionPage/coreWidgets.ts` + `coreWidgets.test.ts`, `sessionPage/sessionLayoutData.svelte.ts`, and the test harness files that call the changed signatures. Paths under `src/lib/client/components/sessionPage/` unless absolute.

## Out of scope
Any SDK file, CSS, docs, NOMENCLATURE, STYLE-GUIDE, the Sessions sidebar (a later worker), filters, cancel, live progress, lineage, settings.

## Stop and ask (in your report) when
A new name beyond those listed seems needed; a migration or new socket event seems needed; a shared-file hunk would collide with someone else's in-flight edit; a test outside your files breaks.

## How to run tests — ALWAYS inside the memory cap, one group at a time, logging to a file; never bare; NEVER pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-R-w2-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-R-w2-t.log'
```
then grep the log (`Test Files|Tests |FAIL|test-exit`). Groups: (1) `requests/sessionRuns.test.ts requests/index.test.ts requests/routineLog.test.ts requests/inspectRun.test.ts`; (2) `coreWidgets.test.ts` + the sessionLayoutData tests you touched; (3) `src/lib/server/sockets/pipelines.runsColumns.int.test.ts src/lib/server/sockets/pipelines.scoping.int.test.ts`. Never hand a DOM node to an assertion. Typecheck in its own cap (MemoryMax=12G, `--max-old-space-size=8192`): `npx tsc --noEmit -p . > <scratch>/lay-R-w2-tsc.log 2>&1` then grep the log for YOUR files only.

## Done means
Groups 1–3 green except assertions that need the rebuilt SDK dist (name them), tsc clean in your files except the expected missing-SDK-member errors (list them). Report: exported names + signatures, changed files, test results with counts, what a stored non-admin layout naming `session-runs` draws, anything noticed but not done.
