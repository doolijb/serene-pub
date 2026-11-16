# BRIEF — lane `perf-L` — thumbnail codecs on a worker thread

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `.claude/guides/review.md` §2. Plan:
`plans/PLAN-performance-2026-11-13.md` — Part 1, row W8-d, Part 3 rulings table (★E-4b ruled: build), §4.2b row
perf-L. Build on `plans/REPORT-perf-E-2026-11-13.md` (F4: `thumbnailCut`, the short-circuit, and its note on what
a worker needs) and on perf-K's report (the thumb-is-source variant, ★P10) — **start only after perf-K reports** (it edits `media/thumbnail.ts` for ★P10). `vite.config.ts` is **not**
touched (challenger [C10], accepted): SvelteKit overrides `build.rollupOptions.input`
(`node_modules/@sveltejs/kit/src/exports/vite/index.js:61-95`, error at `:1657`), so a server worker entry cannot
work. Every existing server worker uses an inline source with `eval: true` — follow `components/compile.ts:323`
(`WORKER_SOURCE` with `resolveFrom`/package URLs handed in), as `plugins/SesWorkerSandbox.ts:651`,
`plugins/QuickJsSandbox.ts:1155`, `rulesets/sandbox.ts:189`, `pipelines/scripts/host.ts:254` do.

## Goal

`makeThumbnail` (`media/thumbnail.ts:92`) decodes, resizes and encodes on the main thread (`convert/codecs.ts`,
WASM codecs). Move that codec work to a `worker_threads` worker: **pool of one**, started lazily on first use,
restarted if it dies, with a fall-back to in-thread work when the worker cannot start (logged once, named reason).
The frame maths (`thumbnailCut`, `clampFrame`) stays where it is; only decode/resize/encode cross. Byte-identical
output to the in-thread path (test it on the fixtures the existing thumbnail tests use).

## What it takes

- A worker module (name per §24, under `src/lib/server/media/`) as an **inline `WORKER_SOURCE` string** started with
  `new Worker(source, { eval: true, workerData })`, loading the codec package from a resolved URL the host passes in
  (`compile.ts:323` shows `resolveFrom`/`urls`). Same code in dev and in the build.
- Transfer: pass `ArrayBuffer`s with the transfer list, never copies. One in-flight job at a time (pool of one);
  queued jobs wait FIFO. A job carries an `AbortSignal`? No — thumbnails are not cancellable today; keep it that way.
- A second WASM compile happens in the worker at first use (perf-E's note); accept it and log the first-compile time
  at debug level.
- Tests: output bytes equal the in-thread path; worker death mid-job rejects that job with a named error and the next
  job succeeds; start failure falls back in-thread and says so once; a 2,000 px image no longer blocks a concurrent
  `setTimeout(0)` on the main thread for more than a few ms (measure before/after in the report).

## Rules you quote into every worker brief

- P1: same bytes in, same bytes out, on either path. P3: no setting; pool size is a constant with a one-line why.
- P2: the media module owns thumbnails; nothing else learns about the worker.
- Never `kill -9` the dev server; never run the build while a serene-pub `vite dev` is up (`pgrep -af "vite dev"`).
- Image assets never in tmp (memory `feedback_image_assets_never_in_tmp`): fixtures from the repo's test assets.
- NOMENCLATURE §18 Media, §24; append the worker's name to §25.

## Files owned

`src/lib/server/media/thumbnail.ts`, the new worker module and its tests, `src/lib/server/media/convert/codecs.ts`
only if an export is needed for the worker, `docs/media*.md` if it exists,
`NOMENCLATURE.md` §25 (append only).

## Out of scope

Pool > 1; moving other media work (sprites, charx, zips — `sockets/pluginPackages.ts` async `zipPackage` is queued
elsewhere); changing thumbnail size/quality; cancellation.

## Stop and ask when

CLAUDE.md §Decisions applies; the production build cannot start the worker from the bundle (report the Rollup shape
you tried); the WASM codecs cannot be instantiated in a worker (then stop, do not patch the codecs).

## Done means

The tests above; green: `media/*`, `mediaRoute*`, `thumbnailSkipDecode.int`; `npx tsc --noEmit -p .` clean on
touched files; `npx prettier --check` on each; `npm run build` green and `node build/index.js` (or the project's
start command, in a scratch data dir per memory `reference_isolated_dev_instance_recipe`) makes one thumbnail
through the worker.

## Report

`plans/REPORT-perf-L-2026-11-13.md`: changed files, how the worker is located in dev and in the build, main-thread
block before/after, tests with counts, open ★, **Noticed, not done**.

Every worker brief carries verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
