# Lane V report: server memory (plan item A1) · 2026-10-30

**Question.** Does the production server leak memory on each page load, or was the "+1.5 GB per page load"
seen in the life-sim walk (run 5) only Vite dev-mode SSR?

**Answer.** Neither.
- **Page loads do not leak in production.** RSS and the post-GC heap level off after a few loads. 150
  browser loads across three pages, with and without the Mundi plugin, added no app objects.
- **The out-of-memory crash is a real production bug, not a dev-mode artefact.** A Mundi press (a frame
  button such as "Drink something") can start a **microtask livelock** in the routine queue. The heap
  then grows by about 0.4 to 0.6 GB a second until V8 aborts. I reproduced it twice on the production
  build (`FATAL ERROR: Ineffective mark-compacts near heap limit`, at 6 GB). Page loads were only what
  the walker was doing at the time; the growth rate makes every load look like "+1.5 GB".
- **Do not write "it's Vite dev SSR" into the contributor notes.** A1 is a must-fix before RC1. The fix
  is small; the pointer and a verified patch direction are below.

## Setup
- `npm run build` at 05:01 (exit 0). Ran `node build/index.js` from the repo cwd with a scratch data dir
  (`SERENE_PUB_DATA_DIR=<scratch>/laneV/data`, `PORT=5399`, `HOST=127.0.0.1`, `AUTO_OPEN_CLIENT=0`).
  The log confirmed isolation: `Using PGlite database at: <scratch>/laneV/data/data/serene-pub.db`.
- Phase 1: no plugins, default heap limit. Phase 2: `SP_PLUGINS_ENABLED=1` and `--max-old-space-size=6144`
  (as in walk run 5), with `mundi-0.1.0.zip` installed through Admin › Plugins (the same sha `ca9b01e3…` as
  run 5), approved and enabled. Then a Mundi session (world modern, lifesim, the world's own people,
  persona "Rosa").
- Page loads came from one Playwright browser: `page.goto` and wait until the page's own content is visible
  (the session greeting, the home page's "Pick up where you left off", or the Mundi frame's map), then
  1.5 s. Each load opens a fresh socket.
- Heap snapshots via `--heapsnapshot-signal=SIGUSR2`. A snapshot forces a full GC, so its size is the
  live heap. Aggregates by constructor (count, shallow and retained size, from an own
  dominator-tree analyser) are in `laneV-agg-*.json`.

## RSS by load count

Phase 1, no plugins. RSS was read 5 s after the batch; "after GC" is the RSS right after the heap
snapshot's full GC.

| Point | RSS | after GC | live heap (snapshot) |
|---|---|---|---|
| booted, before first request | 100 MB | | |
| first `/` (DB open, migrations) | 834 MB | | |
| curl `/` ×5 / ×20 / ×50 (SSR only) | 589 / 590 / 592 MB | | |
| onboarding done, Guide session made | 746 MB | 932 MB* | 328.4 MB |
| browser `/sessions/1` ×1 | 983 MB | 950 MB | 336.3 MB |
| ×5 | 1095 MB | 952 MB | 337.1 MB |
| ×20 | 1117 MB | 956 MB | 338.8 MB |
| ×50 | 1117 MB | 957 MB | 339.4 MB |
| browser `/` ×1 / ×5 / ×20 | 980 / 1035 / 1106 MB | | |
| browser `/` ×50 | 1107 MB | 958 MB | 339.9 MB |

\* includes the snapshot's own working memory.

Phase 2, Mundi plugin enabled, Mundi session `/sessions/34` with its plugin frame:

| Point | RSS | after GC | live heap |
|---|---|---|---|
| plugin installed, session started | 711 MB | 974 MB* | 365.7 MB |
| ×1 | 1054 MB | 1012 MB | 373.8 MB |
| ×5 | 1151 MB | 1013 MB | 374.8 MB |
| ×20 | 1167 MB | 1031 MB | 383.6 MB |
| ×50 | 1170 MB | 1032 MB | 384.2 MB |

**Snapshot comparison (top constructors).** Between ×5 and ×50, both phases show the same pattern.
Nearly all of the growth is `(compiled code)`: V8 Maglev and TurboFan instruction streams for
functions such as `authMiddleware`, `buildSessionsListFor` and `lastVisibleMessages`, plus their
TrustedByteArray, FeedbackVector and ProtectedFixedArray. That came to +2.7 MB over 95 loads in
phase 1 and +2.4 MB in phase 2. App objects barely moved: `Object` grew by 375 and `Array` by 37, while
`Map`, `Listener`, `WebSocket`, `AbortSignal` and `Context` stayed flat or fell. Phase 2 also gained a
one-off +7 MB of strings (149 strings averaging about 47 KB) between ×5 and ×20, which did not grow
further (+5.5 KB from ×20 to ×50). This is JIT and cache warm-up that levels off, not a leak.

## The crash: routine-queue livelock (production, reproduced twice)

Both times it happened during Drink presses in Old Town. The heap watcher read
`Runtime.getHeapUsage` every second over the inspector:
`12:37:41 193 MB → :43 633 MB → :45 1310 MB → :46 1753 MB → :50 3090 MB → FATAL at 6 GB`.

The allocation-sampling profile (CDP `HeapProfiler.startSampling`, live objects only) at 2 GB:

| Live | Allocated at |
|---|---|
| 788 MB | `Promise.race` ← `chunks/run.js:328` (the drain loop) |
| 396 MB | the drain loop itself (`run.js:328`) |
| 305 MB | `then` ← `race` ← the drain loop |
| 151 MB | `Timeout` (node timers) ← the drain loop |
| 17 MB | `Promise` ← the drain loop |
| everything else | < 11 MB each |

**Source.** `src/lib/server/pipelines/routines/queue.ts:174-176` and
`src/lib/server/pipelines/routines/run.ts:90`:
```ts
while (this.deps.busy(sessionId)) { …; await this.deps.waitQuiet(sessionId) }
waitQuiet: (sessionId) => Promise.race([sessionEventsIdle(sessionId), beat(QUIET_POLL_MS)])
```
`busy()` (`sessionBusyForRoutines`) is true while an action or event run is registered, or while the
generation lock is held, **even when the session's event chain is empty**. In that state
`sessionEventsIdle()` (`pipelines/runtime/sessionEvents.ts:471`) returns an already-resolved promise.
The race then settles in a microtask, so the loop never yields to the event loop.
- The 200 ms `beat` can never fire.
- Whatever the busy run is waiting on (I/O, a timer, a socket) can never complete, so `busy()` stays true.
- Each pass allocates a race, its promises and a Timeout that is never cleared.

The result is a livelock plus unbounded allocation. It is intermittent: when the busy run can finish
through microtasks alone, the loop exits.

**Isolated repro (10 lines, plain node).** A `busy` flag cleared by a 50 ms `setTimeout`, and the same
loop with an `async () => {}` idle. The timer never fires, and a 256 MB heap is exhausted in 0.9 s.

**Patch direction, verified on a scratch copy of the built chunk (no source edited).** I changed only
`waitQuiet`:
```ts
waitQuiet: (id) => sessionEventsPending(id)
	? Promise.race([sessionEventsIdle(id), beat(QUIET_POLL_MS)])
	: beat(QUIET_POLL_MS)
```
I ran it on the same data and session, with counters added to that copy:
- About 30 completed presses ran from 11:25 onward, crossing 11:25→11:30 (where the second unpatched run died)
  and continuing to 14:40.
- The heap peaked at 449 MB and settled at about 200 MB.
- Over 10 presses, the "busy, but no event chain" case occurred **22 times**. Every one of those would
  have been a spin-or-die moment on the unpatched build.

The fixer should also clear the `beat` timer when the other side of the race wins. Add a regression
test in `queue.test.ts` or `routines.int.test.ts`: `busy()` stays true until one real macrotask has run,
`sessionEventsIdle` is already resolved, and the drain must finish without fake timers.

## Other observations (not memory)
- **Press cost.** After the patch, each Drink press took 12 to 17 s of wall time, with the main thread
  near 100% CPU and the time spent in PGlite query execution (pg-protocol parse, NODEFS file ops,
  drizzle `toQuery`). That is about 16 s of CPU per press. Earlier presses in the same session took
  about 4 s, so the cost may grow with session length. Ollama loaded no model, so no LLM was involved.
  This is a performance hand-off; I have not narrowed it down further.
- `runTurnMessages` (`pipelines/runtime/runTurnMessage.ts`) held 29 entries after about 30 runs. It is
  capped at 512, so it is not a leak.
- A production boot needs about 0.6 to 1.0 GB RSS, with 330 to 380 MB of live heap. Walk run 5's "4 GB
  default OOM'd at boot" was a dev server, which I did not re-test.
- With `--inspect`, a SIGTERM shutdown waits for any attached debugger client ("Waiting for the debugger
  to disconnect…"). Expected Node behaviour; noted for anyone repeating this recipe.

## What would settle it fully
1. Land the `waitQuiet` fix and its regression test, rebuild, and repeat the press loop (≥100 presses)
   on the production build with the heap watcher. Pass: the heap stays under 0.5 GB.
2. Optional, not needed for RC1: repeat the 50 page loads on a dev instance to see whether dev SSR adds
   any growth of its own. Production does not, and the walk's OOM is explained without it.

## Hand-offs
- **Pipelines/routines owner:** the fix above, in `src/lib/server/pipelines/routines/run.ts:90` (and the
  beat-timer cleanup). Test in `src/lib/server/pipelines/routines/queue.test.ts`. Must land before RC1;
  a pub that runs for weeks will hit this on any routine-bearing genre.
- **Plan owner:** rewrite A1 as "found: routine-queue livelock (production)". Drop the
  "write dev-SSR into contributor notes" branch.
- **Perf (later):** the Mundi press CPU cost noted above.

## Housekeeping
- No source files edited. One browser (Playwright MCP). The server was stopped with SIGTERM every time.
  The two OOM exits were the bug itself, on my scratch data only. PGlite recovered from them
  ("previous shutdown: unclean", then a clean start).
- Scratch data dir deleted. Evidence is kept in `/tmp/claude-1000/-home-jody-github-serene-pub/8c95e8c0-52da-4715-8425-abac99ebc0ad/scratchpad/laneV/`:
  `unpatched/laneV-sampling-{1200,2000,3000}.{json,txt}` (allocation profiles), `snaps/*.heapsnapshot`,
  `laneV-agg-*.json`, `laneV-server{,2,3,4,5}.log`, `laneV-watch.mjs` (CDP heap watcher), `laneV-heap.mjs`
  (snapshot analyser), and `app/` (the patched build copy).
- New terms introduced: none.
