# INVENTORY — where the verification loop's time goes (read-only analysis, 2026-11-15)

Source: Vitest's results cache for full run 8 (`node_modules/.vite/vitest/*/results.json`; 2,514 files; summed
test time 11,220 s vs the log's 11,162 s). Re-verify before building.

## Time

Wall 4,653 s. Work = tests 11,162 + import 2,336 + transform 88 + env 39 + setup 14 = 13,639 s; ÷ 3 workers =
4,546 s (98% of wall): throughput-bound. A second of work removed saves about 1/3 s of wall.

| Kind | Files | Test time | Median |
|---|---|---|---|
| `.int.test.ts` | 1,148 | 10,910 s (97%) | 3.5 s (p90 18, p99 78) |
| `.test.ts` | 1,035 | 174 s | 0.17 s |
| `.dom.test.*` | 327 | 135 s | 0.41 s |

Files over 10 s: 346 = 8,113 s. Over 30 s: 25 = 2,936 s. Slowest: `attic/upgrade.faithful.int` 514 s,
`attic/upgrade.int` 348 s, `sessions.dungeonCrawler*` (9 files, 1,049 s), `sessions.lair*` (10 files, 368 s),
`sessions.retake.int` 174 s. Directories: `sockets` 4,183 s (446 files), `sessions` 964 s, `attic` 943 s,
`pipelines/runtime` 885 s, `pipelines/boot` 447 s.

## Why int files are slow

| Database setup | Files | Median |
|---|---|---|
| `createTestDb`, no bootstrap | 490 | 2.84 s |
| + `bootstrapPipelines` | 219 | 8.38 s |
| `importOriginal` of the real db module, no bootstrap | 124 | 13.82 s |
| `importOriginal` + bootstrap | 29 | 18.09 s |
| neither | 68 | 1.88 s |

- `createTestDb` (`src/lib/server/utils/testDb.ts` ~24–109) runs 1,081 times; each replays all migrations
  (346 KB SQL), resyncs sequences, seeds, loads the SDK and catalogue, syncs the registry. No template database.
- With `importOriginal`, the real `db/index.ts` also opens an on-disk PGlite, migrates, syncs defaults and widget
  settings (`if (dev) await dbReady`, ~895), then the test swaps in its own handle: two databases per file.
- Defaults: forks, `isolate: true`. The linked SDK packages resolve outside `node_modules`, so Vitest transforms
  them (sdk 47.5k lines, core-catalog 79k, contracts 14k); `sockets/sessions.ts` pulls 348 files / 157k lines,
  `runtime/bindings.ts` 389 files / 178k lines.

## Changes, ranked (estimates at 3 workers)

Safe: (1) a `testDbModule()` for the 153 `importOriginal` mocks, ~1,640 s summed ≈ 9 min wall; (2) heavy suites
in an opt-in `slow` project, ≈ 14 min wall (a policy choice); (3) json reporter + `experimental.importDurations`
(evidence); (4) `experimental.fsModuleCache`, ≈ 0.5 min; (5) SDK dist external to Vitest's transform, ≈ 2–3 min
(unmeasured). Needs care: (6) a template database via `dumpDataDir` / `loadDataDir`, keyed on the migration
journal + SDK version, ≈ 6–8 min; (7) a bootstrapped template for the 332 bootstrap files, ≈ 5 min; (8) 4
workers once memory per worker drops; (9) `isolate: false` for the unit project; (10) tsc / svelte-check: 54% of
checked TypeScript is tests (2,504 files, 701k lines); no `incremental`; options: `incremental` +
`tsBuildInfoFile`, `svelte-check --incremental`, a `tsconfig.app.json` without tests for `npm run check` and a
separate pass for tests, trace with `--extendedDiagnostics`.
