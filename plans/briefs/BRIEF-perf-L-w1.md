# BRIEF — perf-L worker 1 — thumbnail codecs on a worker thread

Supervisor: lane `perf-L` (`plans/briefs/BRIEF-perf-L.md`). Report to `plans/REPORT-perf-L-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

`makeThumbnail` (`src/lib/server/media/thumbnail.ts:92`) decodes, crops, resizes and encodes on the main thread through
`convert/codecs.ts` (jimp + WASM `@jsquash/webp`). A 2,000 px image blocks the event loop for the whole time. Move that
codec work to a `worker_threads` worker — the **thumbnail worker** — a pool of ONE, started lazily on first use,
restarted when it dies, falling back to in-thread work (through `codecs.ts`, exactly as today) when it cannot start,
logged once with a named reason. **Same bytes out on either path.**

`makeFitted` and everything else in `media/` stay as they are (out of scope).

## Files owned (the only files you may edit or create)

- `src/lib/server/media/thumbnailWorker.ts` — NEW: the worker module.
- `src/lib/server/media/thumbnail.ts` — `makeThumbnail` only (its body; signature, return shape and the `null` for
  `serveSource` stay exactly as they are — `deriveThumb` in `variants.ts` records a same-as variant on that `null`).
- `src/lib/server/media/thumbnailWorker.test.ts` — NEW (unit project).
- `src/lib/server/media/thumbnailWorker.budgets.test.ts` — NEW (timing; runs only under `npm run test:budgets`).
- `src/lib/server/media/thumbnailSkipDecode.int.test.ts` — ONE change only: its decode spy (lines 11–21 mock
  `./convert/codecs` `decodeImage`) no longer sees a worker decode. Re-point that spy at the new module's decode
  export (`decodeForThumbnail`, below) with the same wrapper shape. Change nothing else in that file.

## Files readable (do not edit)

`src/lib/server/media/convert/codecs.ts` (the in-thread codecs — the worker must do EXACTLY what these do),
`convert/imageSize.ts` (`assertDecodableSize`), `variants.ts` (`deriveThumb` ~l.481, `recordSameAs`),
`src/lib/server/components/compile.ts:238-360` (the inline `WORKER_SOURCE` + `eval: true` pattern to follow),
`src/lib/server/pipelines/scripts/host.ts:154-280` (lazy pool of one, `unref`, fall back once with a warning),
`thumbnail.test.ts`, `convert/imageSize.test.ts:359` (the ceiling test that must still pass),
`vitest.config.ts`, `vitest.budgets.config.ts`.

Never edit `vite.config.ts`, `codecs.ts`, `variants.ts`, `NOMENCLATURE.md` or anything under `utils/llmQueue.ts`,
`connections/`, `sockets/` (another lane is editing those right now).

## The design (decided by the supervisor — build this)

### The module `thumbnailWorker.ts`

Header comment: what it is (the thumbnail worker: the codec half of `makeThumbnail` off the main thread), why (a
2,000 px decode+encode blocks every socket and request for its whole length), what it owns (the one worker thread
and its FIFO; nothing else in the app learns it exists — P2), what it does not (frame maths stays in `thumbnail.ts`;
`codecs.ts` stays the one in-thread copy; no other media work). Say plainly that the worker compiles the webp WASM a
second time at first use (accepted, perf-E's note) and that `codecs.ts`'s "exactly one" rule is about the main thread.

Exports (these names exactly; nothing else public except the two `__…ForTests` hooks):

```ts
/** Decode to raw RGBA, off the main thread. The pixel ceiling is checked HERE, on the main
 *  thread, before anything is posted (assertDecodableSize) — same error, same sentence. */
export function decodeForThumbnail(buffer: Buffer | Uint8Array, mime: string): Promise<RasterImage>

/** Crop (when `cut` is set), resize (when `resizeTo` is set), encode webp at `quality`. */
export function encodeThumbnail(
	raster: RasterImage,
	opts: { cut: { x: number; y: number; w: number; h: number } | null; resizeTo: { width: number; height: number } | null; quality: number }
): Promise<Buffer>

/** A job the worker took and died during (crash, out of memory, exit). Only that job fails. */
export class ThumbnailWorkerStopped extends Error { /* name = "ThumbnailWorkerStopped" */ }

/** @internal Tests only. Terminates any live worker, forgets "cannot start" and "already warned",
 *  and sets the worker's program (`source`; omitted = the real one). */
export function __setThumbnailWorkerForTests(opts?: { source?: string }): void
/** @internal Tests only. How many workers this process has started. */
export function __thumbnailWorkerStartsForTests(): number
```

`RasterImage` is `codecs.ts`'s type (import the type only).

### The worker program — an inline string, never a module of the build

`const WORKER_SOURCE = String.raw\`…\`` — CommonJS text run with `new Worker(source, { eval: true, workerData: { urls } })`
exactly as `compile.ts:323` does. It loads every package by a **file URL the host resolved and passed in** with
`await import(url)` — never a bare specifier (cwd-dependent). It is the same code in dev, in vitest and in the build.

URLs the host resolves (once, lazily, at first start; `createRequire(import.meta.url)`, as `codecs.ts` does):
- the **ESM** entry (the `exports["."].import.default` of the package's `package.json`, found via
  `require.resolve("<pkg>/package.json")`) of `@jimp/core`, `@jimp/js-png`, `@jimp/js-jpeg`, `@jimp/js-gif`,
  `@jimp/plugin-resize`, `wasm-feature-detect`. ESM, not the CJS build: the main thread loads the ESM build, and the
  byte-identity promise is easiest to keep with the very same files.
- `@jsquash/webp/encode.js`, `@jsquash/webp/decode.js` (no exports map; `require.resolve` works), and the three wasm
  paths `@jsquash/webp/codec/enc/webp_enc_simd.wasm`, `…/enc/webp_enc.wasm`, `…/dec/webp_dec.wasm`.
A resolution failure is a **start failure** (below), with the reason naming what did not resolve.

Inside the worker, mirror `codecs.ts` call for call (read it closely; same options, same order, same `.default ??`
plugin interop, same `createJimp({ formats: [png, jpeg, gif], plugins: [resize.methods] })`):
- decode: webp → jsquash decoder (`init(await WebAssembly.compile(readFile(decWasm)))` once, then `dec.default(arrayBuffer)`);
  else `Jimp.fromBuffer(Buffer.from(bytes))`. Answer `{ data, width, height }` with `data`'s ArrayBuffer TRANSFERRED.
- crop: the same row-copy loop as `cropRaster`.
- resize: `Jimp.fromBitmap({ data: Buffer view, width, height })` then `.resize({ w, h })`, as `toJimp` + `resizeRaster`.
- encode: the encoder picks `webp_enc_simd.wasm` when `wasm-feature-detect`'s `simd()` says so, else `webp_enc.wasm`
  (exactly `codecs.ts`'s rule), `enc.default({ data: Uint8ClampedArray.from(...), width, height, colorSpace: "srgb" }, { quality })`.
  Answer the encoded ArrayBuffer TRANSFERRED.
- On startup the worker imports the JS modules (not the wasm) and posts `{ kind: "ready" }`; if an import fails it
  posts `{ kind: "unavailable", message }`. The first WASM compile of each codec is timed and the answer carries it
  (`compiledMs`); the host logs it with `console.debug("[media] thumbnail worker compiled the webp encoder in N ms")`
  (decoder likewise) — debug level, once each per worker.
- A codec error in a job (corrupt bytes) answers `{ kind: "failed", message }`; the host rejects that job with
  `new Error(message)` — the same sentence the in-thread decoder would have thrown. The worker stays up.

### The host side

- **Pool of one, FIFO.** One job in flight at a time; later jobs wait in order (a promise chain is enough). A
  one-line comment says why one: thumbnails are rare, bursty and each one already saturates a core; a second worker
  would only double the WASM memory. No setting, no env var, no constant to tune (P3).
- **Lazy start, `unref()`ed** (a worker must never keep the process or a test run alive), started on the first job.
  Wait for `ready` before posting.
- **Start failure** = `new Worker` throws, URL resolution throws, or the worker answers `unavailable` / errors /
  exits before `ready`. Then: mark the worker unusable for the process's life, `console.warn` ONCE
  `"[media] the thumbnail worker could not start (<reason>) — thumbnails are made on the main thread"`, and run this
  job and every later one in-thread through `codecs.ts` (`decodeImage`, `cropRaster`, `resizeRaster`, `encodeRaster`
  — the exact calls `makeThumbnail` makes today). Never throw for a start failure.
- **Death after `ready`** (error event, exit, out of memory) while a job is in flight: reject THAT job with
  `ThumbnailWorkerStopped` (message names the cause: `the thumbnail worker stopped: <message>` / `(exit <code>)`),
  forget the worker; the next job starts a fresh one. Death while idle: just forget it. Messages from a worker that
  is no longer the current one are ignored.
- **Transfers, never structured copies:** the input bytes are copied ONCE into a fresh ArrayBuffer
  (`Uint8Array.prototype.slice`) and that copy is transferred — the caller keeps its own Buffer (deriveThumb streams
  `source.bytes` after a `null` answer, and a small Node Buffer can be a slice of a shared pool that must never be
  detached). Rasters and the encoded output cross with the transfer list. A raster posted to `encodeThumbnail` is
  transferred (the caller is done with it).
- No timeout, no AbortSignal: thumbnails are not cancellable today; keep it that way.

### `makeThumbnail`, after

Same flow, same comments kept where still true:
```ts
const src = await decodeForThumbnail(buffer, mime)
const { cut, whole, serveSource } = thumbnailCut(src.width, src.height, mime, frame)   // stays here (frame maths)
if (serveSource) return null
… longest / scale / width / height exactly as today …
const bytes = await encodeThumbnail(src, { cut: whole ? null : cut, resizeTo: scale < 1 ? { width, height } : null, quality: THUMB_QUALITY })
```
Return `{ bytes, width, height, mime: "image/webp", ext: "webp" }` where width/height are the encoded raster's
(= `resizeTo` when set, else the cut's size — today's `raster.width/height`). Drop the now-unused codec imports
(`makeFitted` still uses `decodeImage`, `resizeRaster`, `encodeRaster` — keep what it needs).

## Rules (quoted from the lane brief and CLAUDE.md — check your work against each)

- **P1:** "same bytes in, same bytes out, on either path." Deterministic: no randomness, no time in outputs.
- **P3:** "no setting; pool size is a constant with a one-line why." → a comment-stated pool of one; no env var, no option.
- **P2:** "the media module owns thumbnails; nothing else learns about the worker." Only `thumbnail.ts` imports
  `thumbnailWorker.ts` (tests aside).
- **NOMENCLATURE §24:** "Pick a distinctive word… Qualify it if the bare noun could ever stand alone (R3). Say what it
  is not, if a near-neighbour exists." The concept is the **thumbnail worker** — never bare *worker* in comments or log
  lines (§25 already warns *worker* alone is ambiguous: the UI worker, the QuickJS sandbox worker). Introduce no names
  beyond the exports listed above; the supervisor records them in §25.
- "Image assets never in tmp": fixtures are `static/mascot.png` and images built in memory with `pngjs` /
  `encodeRaster` (as `thumbnail.test.ts` and `thumbnailSkipDecode.int.test.ts` do). Never write an image to /tmp.
- CLAUDE.md: "Never `kill -9` the dev server." Never run `npm run build` (the supervisor does it).
- Never `git checkout` / `restore` / `stash` anything.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` at all.)
- Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.
- Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`). `thumbnail.ts` and `thumbnailSkipDecode.int.test.ts` were prettier-clean at start; new files: format them.
- Decisions: implementation inside this brief is yours — name each choice in the report. Anything a user sees, a new
  name beyond the list above, a setting, or a file outside "Files owned": stop and write it in the report instead.
  Findings along the way go under **Noticed, not done**, never fixed in passing.

## Tests

`thumbnailWorker.test.ts` (unit project; give each test a 60 s timeout; call `__setThumbnailWorkerForTests()` in
`afterEach` so no worker or override leaks between tests):
1. **Byte identity.** For each fixture, `makeThumbnail` through the worker equals `makeThumbnail` forced in-thread
   (a start-failing `source`, e.g. `throw new Error("in-thread for this test")`), byte for byte, and width/height
   equal: `static/mascot.png` (portrait: crop + resize); the same with an explicit off-centre `frame`; a 2,000 × 2,000
   pngjs gradient (resize, no crop); a 32 × 32 PNG (no crop, no resize — encode only); a 600 × 600 WebP and a JPEG and
   a GIF made with `encodeRaster` (non-uniform pixels, so a wrong resampler would show); a 64 × 64 WebP → `null` on
   both paths. Also assert the worker path really ran (`__thumbnailWorkerStartsForTests()` > 0, no warn).
2. **Death mid-job.** `source` = a program that posts `{ kind: "ready" }` and `process.exit(7)`s on its first job:
   the job rejects with `ThumbnailWorkerStopped` (instanceof, and the message names exit 7), `console.warn` is NOT
   called (it is not a start failure); a second job also rejects `ThumbnailWorkerStopped` and the start count rose
   (the pool restarted rather than giving up); then `__setThumbnailWorkerForTests()` (real program) and the next
   job succeeds with bytes equal to the in-thread bytes.
3. **Start failure.** `source` that throws at top level: two `makeThumbnail` calls both succeed with in-thread bytes;
   `console.warn` called exactly once, its text names the reason (the thrown message) and "main thread".
4. **Corrupt bytes.** A PNG signature followed by garbage (but a readable header size, or use one that
   `assertDecodableSize` lets through): the worker path rejects with an `Error` whose message equals the in-thread
   path's, and the next job still succeeds (the worker stayed up: start count unchanged).
5. **Ceiling.** The `imageSize.test.ts:359` case (a PNG claiming 8,193 px) still rejects with the same sentence, and
   no worker was started for it (start count unchanged; run it first after a reset, so no worker exists yet).

`thumbnailWorker.budgets.test.ts` (timing, excluded from the sweep by `vitest.config.ts`; run with
`npx vitest run --config vitest.budgets.config.ts src/lib/server/media/thumbnailWorker.budgets.test.ts`):
- build a 2,000 × 2,000 noisy PNG in memory (pngjs; deterministic noise from a fixed-seed LCG, not Math.random);
- warm both paths once (first WASM compile excluded);
- measure the **largest gap** between consecutive `setTimeout(0)` ticks while one `makeThumbnail` runs, in-thread
  (start-failing source) and through the worker; `console.log` both numbers (ms) and the total job time of each;
- assert the worker path's largest gap ≤ 25 ms, and that the in-thread path's is larger than the worker's.
  If 25 ms is not met on this machine, do not loosen it silently: report the numbers and what still runs on the main
  thread.

Run, and report counts:
- `npx vitest run src/lib/server/media/thumbnailWorker.test.ts src/lib/server/media/thumbnail.test.ts src/lib/server/media/convert/`
- `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/server/media/thumbnailSkipDecode.int.test.ts src/lib/server/media/sameAsVariant.int.test.ts src/lib/server/media/media.int.test.ts`
- the budgets file as above
- `npx tsc --noEmit -p . 2>&1 | grep -E "media/(thumbnail|thumbnailWorker)"` → nothing
- `npx prettier --check` on each file you touched.

## Report (`plans/REPORT-perf-L-w1.md`)

Changed files; each implementation choice you made; tests with pass counts; the budgets numbers (largest gap and
total time, both paths); the first-compile debug times you saw; anything that did not work as briefed;
**Noticed, not done**.
