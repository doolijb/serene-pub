# BRIEF — ui-working worker 1 — routine runs say they are running (app side)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You do not run `sdk:build` at all in this brief: the supervisor runs the one build.)

Repo: `/home/jody/github/serene-pub` (app). Use absolute paths. Never `git checkout` / `restore` / `stash`. Never `kill -9`. No migration. Never `prettier --write` on a directory.

## Goal

The owner (2026-11-13): *"when tasks/routines are running in the background, there's no indicator, the status still says 'waiting for a message or pick who speaks next'"*. The turn line (SDK, another worker) will say *‹routine name› is running*. Your half: the server sends **one `sessions:runStatus` frame when a routine run has lasted past a short delay, and one frame clearing it at its end or when it parks**; the session read carries the runs showing now; the page keeps the name and hands the turn line the names. **No new event, no table, no column, no new module.**

## What exists (read these, by line range)

- `src/lib/server/pipelines/routines/run.ts` ~317–366: `runRegistry.start(...)` (~318) is a routine run's one start; `.finally` → `runRegistry.finish(runId)` (~363) its one end; `onParked: () => parked()` (~345) fires when the run parks at a review gate (it may fire more than once; the run stays registered until the person decides). `name` (~280, `labelOf`) is the routine's display name as Routines shows it. Refusals, skips and cap pauses return before the start: they send nothing.
- `src/lib/server/pipelines/routines/runs.ts`: `RoutineRunFact` / `noteRoutineRun` / `routineRunOf` — the routine runs in flight (a leaf module, no imports; keep it so).
- `src/lib/server/pipelines/runtime/runStatus.ts`: `RunStatusFrame` (~93–117), `QUEUE_STATUS_DELAY_MS` (~84–90, 400 ms) and how `queue()` uses it (~431–443: a `setTimeout(…, QUEUE_STATUS_DELAY_MS)` with `.unref?.()`, cleared when the wait ends). The relay's own frames (`show` ~359, `clearShown` ~384) go out for a routine run too whenever one of its nodes sets a status; they carry `kind: "routine"` and **no name**. Leave the relay as it is.
- `src/lib/server/pipelines/runtime/runRegistry.ts`: `active()` (~400), `statusesBySession()` (~328, what `sessions:list` row status reads: it reads `handle.status`, which only the relay sets).
- `src/lib/shared/sockets/types.ts` ~4761–4787 `Sockets.Sessions.RunStatus.Response`; `Sockets.Sessions.Get.Response` ends ~5010–5035 (`userDraft`, `rulesetConverted`, `sessionId`).
- `src/lib/server/sockets/sessions.ts` `buildSessionGetResponse` (~5885, returns ~6012). **This file holds another lane's uncommitted edits (Summaries setting, ~3708–3730 and ~6900–6935): touch only the lines you add in `buildSessionGetResponse`.**
- `src/lib/client/sessions/store/sessionStore.svelte.ts` `mergeRunStatus` (~266–282) and `records.ts` `SessionRunRecord` (~27–37).
- `src/lib/client/sessions/store/derive.ts` (`generatingOf`, a pure helper reading runs).
- `src/lib/client/components/sessionPage/sessionPageData.svelte.ts`: the first load `sessionStore.load(msg.session, msg.pagination)` (~949); `liveRunKey` (~433–444) and its getter `liveRunIds` (~1302).
- `src/lib/client/components/sessionPage/sessionPageProjections.ts` ~951–953 (`liveRunIds: src.data.liveRunIds` in the conversation dossier).
- `src/lib/client/components/sidebars/SessionsSidebar.svelte` `handleRunStatus` (~289–294): the session list's row status, keyed by session, last frame wins.

## Build

1. **The frame field.** Add an optional `routine?: { name: string }` to `RunStatusFrame` (runStatus.ts) and to `Sockets.Sessions.RunStatus.Response` (types.ts), each with a 🚧 doc comment: *the routine's name, as Routines shows it; on the two frames a routine run's start and end send (`routines/run.ts`), never on the status relay's frames.* Add to `QUEUE_STATUS_DELAY_MS`'s doc one sentence that it is also how long a routine run must last before it shows as running (`routines/run.ts`). Change nothing else in runStatus.ts.
2. **The fact.** In `runs.ts` add to `RoutineRunFact` one optional field `shownAs?: { name: string }` with a 🚧 doc: *set while the run shows as running: it has lasted past `QUEUE_STATUS_DELAY_MS` and has not parked (`routines/run.ts`).* No other change there.
3. **run.ts — the frames.** Export:
   - `routineRunStatus(name: string): StatusText` → `{ i18n: { en: \`${name} is running\` } }` (the frames' `status`; nothing displays it, the name rides in `routine`).
   - `showRoutineRun(opts: { io?: SessionIo; sessionId: number; runId: string; name: string; fact: RoutineRunFact }): { clear(): void }` — starts one `setTimeout(…, QUEUE_STATUS_DELAY_MS)` (`.unref?.()`, as the relay does). When it fires: `fact.shownAs = { name }` and, when `io` is given, `broadcastToSessionUsers(io, sessionId, "sessions:runStatus", { sessionId, runId, status: routineRunStatus(name), kind: "routine", routine: { name } } satisfies RunStatusFrame)` (catch and ignore a failed send, as the relay does). `clear()` is idempotent: clears the timer; when `fact.shownAs` is set, deletes it and (with `io`) sends `{ sessionId, runId, status: null, kind: "routine", routine: { name } }`. **Never call `runRegistry.setStatus`** (the session list's row status reads the registry status and must not change).
   - `routineRunFramesOf(sessionId: number): RunStatusFrame[]` — for the first load: `runRegistry.active()` filtered to `kind === "routine"` and this session, joined with `routineRunOf(runId)`, keeping only facts with `shownAs`; each as the start frame above.
   - In `runRoutineFiring`: keep the fact object you pass to `noteRoutineRun` in a const; right after it, `const shown = showRoutineRun({ io: f.io, sessionId: f.sessionId, runId, name, fact })`; `onParked: () => { shown.clear(); parked() }`; in `.finally` call `shown.clear()` before `runRegistry.finish(runId)`. A failed run (the rejection branch) ends through the same `.finally`.
   - Import style: `broadcastToSessionUsers` may be a dynamic import inside the timer/clear (run.ts already imports dynamically); the existing `src/lib/server/pipelines/routines/run.test.ts` must still pass unchanged. Use `StatusText` / `RunStatusFrame` as types only.
   - Update the file's head comment in one or two sentences: a routine run shows as running once it has lasted past the delay, and stops showing at its end or when it parks.
4. **The first load.** In `types.ts` `Get.Response` add `routineRuns?: Array<Sockets.Sessions.RunStatus.Response>` (🚧 doc: *the session's routine runs showing as running now (`routineRunFramesOf`), each as its start frame; on the first page only; absent when none*). In `buildSessionGetResponse`, on the first page only (`page.beforeId == null`), add `routineRuns` when `routineRunFramesOf(sessionId)` (dynamic import of `$lib/server/pipelines/routines/run`) is non-empty.
5. **The store.** `SessionRunRecord` gains `routine?: { name: string }` (🚧 doc). `mergeRunStatus` sets `routine` from the frame, and when the frame has none (a relay frame) **keeps the held record's `routine`**; the end frame still deletes. In `sessionPageData.svelte.ts`, right after `sessionStore.load(msg.session, msg.pagination)` on the first load: `for (const frame of msg.routineRuns ?? []) sessionStore.mergeRunStatus(frame)`.
6. **The names for the turn line.** In `derive.ts` add a pure `runningRoutineNamesOf(runs: readonly SessionRunRecord[]): string[]` — the `routine.name` of each record with `kind === "routine"` and a `routine`, in the store's order (doc: names only, never a run id). In `sessionPageData.svelte.ts` derive a joined key of those names (as `liveRunKey` does, so readers re-run only when the names change; join with `"\u0000"` since names may hold commas) and add a getter `runningRoutineNames: string[]`. In `sessionPageProjections.ts` add `runningRoutineNames: src.data.runningRoutineNames` beside `liveRunIds`, with a 🚧 comment. (The SDK field `runningRoutineNames?: string[]` on the dossier is added by the other worker; do not run `tsc` — the supervisor builds the SDK and typechecks.) If `src.data`'s type is declared somewhere explicitly, add the getter there too.
7. **The session list.** In `SessionsSidebar.svelte` `handleRunStatus`, also return early when `msg.routine` is set, with a one-line comment: a routine run's start and end frames are the turn line's, never the row status (its end frame must not clear a reply's status). Relay frames (no `routine`) flow as before.

## Rules you must follow (quoted)

- CLAUDE.md Standing rulings › Sockets: *"one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing."* — every frame carries `sessionId`. No new listener.
- *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."*
- Members never see a connection, a model or a run id. The names list carries names only.
- Comments state the rule, not the story: `src/lib/shared/conformance/commentHistory.test.ts` fails on phrases such as "no longer", "used to", "deliberately not", "previously", a migration number cited as history. Write what the code does, in the present tense.
- It is a **session**, never a *chat*.
- Spoken-line (line-bound) runs are out of scope: touch nothing about them.
- NOMENCLATURE R3: qualify, never a bare noun. Use only the names given here (`routine`, `shownAs`, `routineRunStatus`, `showRoutineRun`, `routineRunFramesOf`, `routineRuns`, `runningRoutineNamesOf`, `runningRoutineNames`). Need another name: stop and ask in your report.

## Files owned (edit only these)

- `src/lib/server/pipelines/routines/run.ts`, `src/lib/server/pipelines/routines/runs.ts`
- `src/lib/server/pipelines/runtime/runStatus.ts` (the interface field and the one doc sentence only)
- `src/lib/shared/sockets/types.ts` (the two fields only)
- `src/lib/server/sockets/sessions.ts` (inside `buildSessionGetResponse` only)
- `src/lib/client/sessions/store/sessionStore.svelte.ts`, `records.ts`, `derive.ts`
- `src/lib/client/components/sessionPage/sessionPageData.svelte.ts`, `sessionPageProjections.ts`
- `src/lib/client/components/sidebars/SessionsSidebar.svelte` (`handleRunStatus` only)
- New test: `src/lib/server/pipelines/routines/run.frames.test.ts`; additions to `src/lib/client/sessions/store/sessionStore.svelte.test.ts` and `src/lib/client/sessions/store/derive.test.ts`

## Files readable

Anything. Not editable: anything else (docs, NOMENCLATURE, the SDK repo are the supervisor's or the other worker's).

## Out of scope

A Stop for background work; progress; when routines run; the relay's behaviour; `generatingOf` / `sessionBusy`; spoken-line runs; scene summaries (the turn line reads them from scenes it already has); docs and NOMENCLATURE.

## Stop and ask when

A reader of `sessions:runStatus` cannot keep what it shows without changing the event's shape beyond the optional `routine` field; you need a name not listed; the delay cannot be `QUEUE_STATUS_DELAY_MS` with the same timer pattern; anything outside the files owned.

## Done means

`src/lib/server/pipelines/routines/run.frames.test.ts` (unit; `vi.mock` the dynamic imports `runRoutineFiring` reaches — `$lib/server/sessions/archive`, `$lib/server/pipelines/registrations/resolve`, `$lib/server/pipelines/routines/interaction`, `$lib/server/pipelines/boot/bootstrap`, `$lib/server/pipelines/runtime/runTurn` (a controllable `runSpec` that can resolve, reject or call `onParked`), `$lib/server/pipelines/runtime/sessionEvents`, `$lib/server/pipelines/runtime/receipts`, `$lib/server/sockets/utils/broadcastHelpers` capturing frames; a fake `db` whose `select` throws is fine for `labelOf`/`ownerName` when the registration has a `label`; fake timers allowed here). It proves:
- a routine run longer than the delay sends one start frame (`kind: "routine"`, `routine.name`, `status` = `routineRunStatus(name)`) and, at its end, one `status: null` frame with `routine.name`;
- a run that ends before the delay sends no frame at all;
- a run that parks sends the clearing frame at `onParked`, and its later end sends nothing more;
- a failed run (runSpec rejects) clears;
- while the frame shows, `runRegistry.statusesBySession()` has no entry for the session (the row status is unchanged);
- `routineRunFramesOf(sessionId)`: empty before the delay, the start frame after it, empty after park or end, empty for another session.

Plus: `sessionStore.svelte.test.ts` — a relay frame (no `routine`) after the start frame keeps `routine`; the end frame drops the record; frames from the first load merge like pushes. `derive.test.ts` — `runningRoutineNamesOf` keeps only named routine records, in order, and never a reply/action/line-bound record.

Run them, and the existing `src/lib/server/pipelines/routines/run.test.ts`, **only** inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/ui-working-w1-vitest.log 2>&1"` — targeted files only, never two runs at once, never piped into `head`. Then read the log. Also `npx prettier --check <each changed file>`.

Do **not** run `tsc`, `npm run check`, `npm test` or `sdk:build`.

## Report

Return as your final message: changed files; each decision you made; tests run with results (counts); anything you could not do; **Noticed, not done**.
