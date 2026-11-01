# REPORT — readiness lane R (A1 fix: routine-queue spin) — 2026-10-30

Saved by the lead from the supervisor's hand-back. Diagnosis: `REPORT-readiness-laneV-2026-10-30.md`.

## Built
- `src/lib/server/pipelines/routines/run.ts`: new exported `waitQuietForRoutines(sessionId, ms = QUIET_POLL_MS)`,
  used as the queue's `waitQuiet`, with a dated comment. Nothing on the session's event chain → wait the 200 ms beat
  alone. Something on it → race chain-idle against the beat; if idle wins, clear the beat's timer and still end on a
  `setImmediate` so every wait yields to the event loop; if the beat wins, ignore the idle promise. `QUIET_POLL_MS`
  unchanged. `queue.ts` and `sessionEvents.ts` untouched (`sessionEventsIdle` adds no listener).
- NEW `run.test.ts` (real timers; `sessionEvents` and `receipts` mocked, no DB): a 50 ms busy flag with nothing
  pending → the drain finishes (1000-check cap fails instead of hanging; old wait hit 1001 checks, new wait 4);
  beat timer cleared when idle wins (`clearTimeout` spy); full beat when nothing pending; ends on the beat when the
  beat wins; yields even when idle already resolved.

## Verified
`run.test.ts`, `queue.test.ts`, `runtime.test.ts`, `routines.int.test.ts`: 4 files, 29/29 pass (27.5 s). Filtered tsc
clean. Prettier clean on new lines.

## Open
- Production re-check not done: rebuild, then ≥100 Mundi frame presses with the heap watcher (passes if heap stays
  under 0.5 GB) — lane V's recipe under `scratchpad/laneV/`.
- A dev server already running keeps the old wait until restart (`routineQueue` is cached on `globalThis`).
