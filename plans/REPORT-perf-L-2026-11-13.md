# REPORT — lane `perf-L` — thumbnail codecs on a worker thread (★E-4b) — 2026-11-13

(Supervisor's report, saved to disk by the lead; the harness refused the supervisor's write. One worker: `plans/briefs/BRIEF-perf-L-w1.md` → `plans/REPORT-perf-L-w1.md`. Lead's acceptance note at the end.)

## Changed files
- **`src/lib/server/media/thumbnailWorker.ts`** (new) — the **thumbnail worker**: an inline CommonJS `WORKER_SOURCE` started with `eval: true` (the `components/compile.ts:323` pattern; [C10] respected, `vite.config.ts` untouched). Pool of one, started lazily, jobs in order, thread `unref`ed, restarts after a death; if it cannot start, thumbnails are made in-thread through `convert/codecs.ts` with one warning naming the reason. Exports `decodeForThumbnail`, `encodeThumbnail`, `ThumbnailWorkerStopped`, two `@internal` test hooks.
- **`src/lib/server/media/thumbnail.ts`** — only `makeThumbnail`'s body and imports: decode through `decodeForThumbnail`, then crop + resize + encode through `encodeThumbnail`; `thumbnailCut` stays on the main thread; signature, result shape and the `null` for `serveSource` unchanged (perf-K's same-as variant works; `sameAsVariant.int` passes); `makeFitted` untouched.
- **`thumbnailWorker.test.ts`** (new, 10 tests), **`thumbnailWorker.budgets.test.ts`** (new, runs under `test:budgets`).
- **`thumbnailSkipDecode.int.test.ts`** — outside Files owned, lines 11–23: the decode spy wraps `thumbnailWorker.decodeForThumbnail` instead of `codecs.decodeImage` (a worker decode never reaches `codecs.decodeImage`; the old spy would pass "not called" no matter what). Scope reviewer judged it justified.
- **`NOMENCLATURE.md`** — one bullet: thumbnail worker, `decodeForThumbnail`, `encodeThumbnail`, `ThumbnailWorkerStopped`, both error strings, the guard string `the thumbnail worker answered out of turn`; what it is not (not a UI worker, not the QuickJS/script threads, not a pool anyone sizes).
- Not touched: `codecs.ts`, `variants.ts`, `vite.config.ts`. No docs (nothing a user sees changed).

## How the worker is found
No worker file: a `String.raw` constant via `new Worker(source, { eval: true, workerData: { urls } })`. The main thread resolves packages at first start from `createRequire(import.meta.url)`: ESM entries of `@jimp/core`, `@jimp/js-png`, `@jimp/js-jpeg`, `@jimp/js-gif`, `@jimp/plugin-resize`, `wasm-feature-detect`; `@jsquash/webp/{encode,decode}.js` and the three wasm paths. The thread imports by file URL. In the build, resolution starts from `build/server/chunks/` and walks up to `node_modules` (codec packages stay external). A package that does not resolve is a start failure, named in the warning.

## Production check
`npm run build` green (no serene-pub `vite dev` running). Started `node build/index.js` with a scratch `SERENE_PUB_DATA_DIR`, port 5293; a socket.io client uploaded a 2,000 × 1,600 PNG via `users:current:updateAvatar`; `GET /media/<uuid>?v=thumb` → `200 image/webp`, 87,974 bytes, `RIFF…WEBP`; log `[media] thumbnail worker compiled the webp encoder in 5 ms` (only the worker thread writes it); no start warning; SIGTERM clean. Scripts: scratchpad `perf-L-thumb.mjs`, `perf-L-prod.log`.

## Main-thread block (2,000 × 2,000 noisy PNG, warmed; largest gap between `setTimeout(0)` ticks)
| Run | In-thread: gap / job | Worker: gap / job |
|---|---|---|
| worker's run | 223.4 ms / 223 ms | 1.4 ms / 238 ms |
| run 1 | 240.3 ms / 240 ms | 1.8 ms / 239 ms |
| run 2 | 232.2 ms / 232 ms | 1.7 ms / 263 ms |
Asserted: worker gap ≤ 25 ms and smaller than in-thread. Still on the main thread: `assertDecodableSize`, one copy of the input bytes, frame maths, wrapping transferred buffers.

## Tests
`thumbnailWorker.test`, `thumbnail.test`, `convert/`: 4 files / 70 passed. All of `media/` + `sockets/mediaFrame.int` + `sockets/media.int` capped: 19 files / 183 passed. Budgets file passed 3×. `tsc` filtered to `media/`: clean. `prettier --check` on the five lane files: clean. `npm run build`: green. Unit coverage: same bytes worker vs in-thread for mascot PNG (crop+resize, off-centre frame), 2,000² PNG, 32² PNG, 600² WebP/JPEG/GIF, 64² WebP → `null` on both; worker death mid-job rejects with `ThumbnailWorkerStopped` naming exit 7, next job restarts, then same bytes; cannot start → both jobs in-thread, exactly one warning; corrupt bytes same sentence, thread stays up; pixel ceiling refused on the main thread, no thread started.

## Implementation choices
Two jobs per thumbnail (decode; crop+resize+encode), no state between them; crop runs in the worker (it copies pixels); the input bytes are copied once and the copy transferred (`deriveThumb` streams `source.bytes` after a `null`; small Buffers are pool slices that must never be detached) — decoded pixels and encoded output cross without copies; pool size is a comment, not a constant (nothing would read it; no setting, P3); ceiling check on the main thread; a start failure lasts the process life, warned once; a death after ready restarts on the next job; webp WASM compiled a second time in the thread at first use (accepted).

## Scope review
No objection; two findings folded (production evidence section; the guard string ledgered).

## Open ★
None.

## Noticed, not done
`WORKER_SOURCE` duplicates `codecs.ts`'s codec calls (same-bytes tests catch drift for the fixtures). No watchdog for a hung codec call (cancellation ruled out). `makeFitted` still on the main thread. `thumbnail.test.ts` not prettier-clean (predates). Decoder first-compile never timed (only PNGs fed). perf-K's report was not yet on disk when this lane started (read `REPORT-perf-K-w1.md`). The build regenerated gitignored `src/lib/generated/docs/*`. Scratch data dir `scratchpad/perf-L-data` left (lead deletes).

## Lead's acceptance note
Accepted 2026-11-13. The `thumbnailSkipDecode.int.test.ts` spy move is the honest test and stays. The main-thread stall perf-E named (hundreds of ms per large thumbnail, hitting everyone mid-stream) is measured gone: ~230 ms → under 2 ms.
