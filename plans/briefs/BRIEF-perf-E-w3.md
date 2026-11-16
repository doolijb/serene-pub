# BRIEF perf-E-w3 — media route answers 304 before reading, streams with Range; thumbnails skip a needless decode (lane perf-E steps 3 and 4a, review rows F3, F4)

Repository: /home/jody/github/serene-pub. Supervisor: lane perf-E.

## Step 3 — `/media/[id]` (verified by the supervisor 2026-11-13)

Today `src/routes/media/[id]/+server.ts` (GET, ~154–245) resolves the variant through `ensureVariant` /
`resolveDisplay`, which always **reads the whole file** (`readVariant` → `fs.readFile`, `src/lib/server/media/variants.ts`
~221), then compares `If-None-Match` against `"${resolved.hash}"`, then copies the buffer (`new Uint8Array(resolved.bytes)`),
and honours no `Range`.

Change:
1. **ETag before any disk read.** The ETag is (and stays) `"${hash}"` of the RESOLVED variant row — nothing else feeds it
   today. When the variant the request resolves to already has a stored row, its hash comes from the row, so the 304
   check runs **before** any open/read. A matching `If-None-Match` returns 304 with exactly today's headers (`ETag`,
   `Cache-Control`, `X-Content-Type-Options`, and `Vary: Accept` when negotiated) and touches no file.
2. **Resolution without reading.** Add to `variants.ts` a helper that resolves like `ensureVariant` but returns the stored
   row (plus its absolute path from `resolveMediaPath(row.path)`) **without** reading bytes when a row exists, and falls
   back to `ensureVariant` (derive, bytes in memory) when no row exists. Keep `ensureVariant`'s behaviour and signature
   untouched for its other callers. Rewrite the route's `requested` branch and `resolveDisplay` on top of it so that the
   chosen variant (pointer → DISPLAY → ORIGINAL; Accept fallback to smallest FULL-fidelity alternate) is the **same row
   as today** — note today a row whose file is missing from disk counts as "not resolved" (readVariant returns null) and
   falls through to the next candidate; preserve that by checking the file at the moment you open it (step 3) and, if the
   open fails, continuing resolution exactly as today would have. You decide the helper's name (internal, not exported
   beyond `$lib/server/media` unless needed; it is not a user-facing name) and say it in the report.
   - Accepted consequence (state it in the report): when a client's `If-None-Match` matches a stored row whose file has
     gone from disk, it now gets 304 (its cached bytes are exactly that hash) where today it got the display fallback.
3. **Stream the body.** For a stored row: `fs.promises.open(abs)` first (a failed open → continue resolution as above),
   then `Readable.toWeb(handle.createReadStream({ start, end }))` as the body — open-before-respond so a file culled
   between the decision and the stream can't break a started response. For a variant derived in this request (bytes in
   memory): pass the Buffer (or a `subarray` for a range) without `new Uint8Array(...)` copying.
4. **Range.** Import `parseByteRange` from `$lib/server/plugins/frameHost` (exported; do NOT edit frameHost.ts — it is
   not this lane's file, and its `respond`/`diskBody` are private and add CSP/CORS headers this route must not send). A
   satisfiable `Range: bytes=…` → 206 with `Content-Range: bytes a-b/size` and `Content-Length` of the slice; an
   unsatisfiable one → 416 with `Content-Range: bytes */size`; none → 200 as today. Add `Accept-Ranges: bytes` to 200/206
   answers (that header is part of the Range support the lane brief allows). Every other header byte-identical to today
   (`Content-Type`, `Content-Length`, `Content-Disposition` with the same filename rule, `ETag`, `Cache-Control`,
   `X-Content-Type-Options`, `Vary`). The by-id 302 branch is unchanged.

## Step 4a — thumbnails: no decode when the row already says the source is its own thumbnail

`deriveThumb` (`variants.ts` ~453) calls `makeThumbnail` (`src/lib/server/media/thumbnail.ts` ~69), which decodes the
source and then returns `null` ("serve the source") when the frame is the whole image, the longest edge is
`<= THUMB_MAX_EDGE` and the mime is `image/webp`. Short-circuit that before decoding: when `source.mime === "image/webp"`
and the stored `files.width` / `files.height` are both known, compute the same test as `makeThumbnail` (frame =
`file.frame ?? defaultFrame(w, h)`, `clampFrame(frame, w, h)`, whole and `max(cut.w, cut.h) <= THUMB_MAX_EDGE`) and,
when it holds, return `source` without calling `makeThumbnail`. Factor that test into one small pure function in
`thumbnail.ts` used by both `makeThumbnail` (after decode, with decoded sizes — unchanged result) and `deriveThumb`
(with stored sizes) so the rule is spelled once. **Do not record any variant row** (a "thumb is source" variant kind is
★P10, unruled). Width/height unknown → decode as today.

(Step 4b — moving the codec work to a `worker_thread` — is NOT yours; the supervisor has deferred it.)

## Files owned

- `src/routes/media/[id]/+server.ts`
- `src/lib/server/media/variants.ts`
- `src/lib/server/media/thumbnail.ts`
- `src/lib/server/media/index.ts` only if the new helper must be re-exported there (one export line)
- new tests beside them (e.g. `src/lib/server/media/mediaRoute.conditional.int.test.ts`, additions to `thumbnail.test.ts`)

## Files readable

`src/lib/server/media/*` and their tests (`media.int.test.ts`, `mediaRoute.spoken.int.test.ts` show how the route is
driven in a test), `src/lib/server/plugins/frameHost.ts` ~455–530, `src/lib/shared/media/frame.ts`.

## Out of scope

frameHost.ts, any variant kind, the by-id redirect, cull/backfill, step 4b.

## Done means

- New test: a request with a matching `If-None-Match` answers 304 with **no `readFile` and no `open`** (spy on
  `fs.promises.readFile`/`open` or the `node:fs/promises` module the code uses); a `Range: bytes=0-9` request answers 206
  with the right `Content-Range`, `Content-Length: 10` and the first 10 bytes; a full GET answers 200 with the same bytes
  and headers as before (compare against the stored file).
- New test (4a): `deriveThumb`/`ensureVariant(…, THUMB)` for a small square whole-frame WebP with stored width/height does
  not decode (spy on `decodeImage` or `makeThumbnail`) and returns the source; a non-WebP or oversize source still decodes.
- Existing: `npx vitest run src/lib/server/media` green (report counts).
- `npx prettier --check` on changed files; filtered `tsc` clean for them.

## Rules you work under (quoted from the lane brief, CLAUDE.md and the multi-agent guide)

- **Owner 2026-11-13: change how often, never what.** Every job still processes the same rows in the same order; every response carries the same bytes and headers except where your step names a header it adds. If you find yourself changing an answer rather than how often it is computed, stop and say so in your report.
- **P1:** a cache is keyed so a stale answer is impossible, not merely unlikely. Name the key and its invalidation in your report.
- **Decisions (CLAUDE.md):** decide implementation inside the asked scope (structure, helpers, tests) and name each choice in your report. Do NOT add any user-facing name, setting, flag, event, table, migration or SDK change. Findings outside your step go under "Noticed, not done", never fixed in passing.
- Edit ONLY the files listed under "Files owned". Other uncommitted files in the tree belong to other lanes and a peer session: never touch them. Never `git checkout` / `git restore` / `git stash` in either repo.
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- `socket.off(event)` with no handler removes every listener app-wide; always pass the handler.
- It is a **session**, never a *chat*, in any new comment or string.
- `npx prettier --write <file>` only on your own files, by path; never on a directory.
- Typecheck: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must print nothing for your files.
- Tests: `cd /home/jody/github/serene-pub && npx vitest run <file> [<file>…]` — targeted files only. No full `npm test`.

Verbatim (multi-agent guide / lane brief):
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Image assets never in `/tmp`.
- Inside `db.transaction(async (tx) => …)` use only `tx`.

## Report (your final message)

Changed files; each design choice you made; tests run with exact pass/fail counts; `prettier --check` and filtered `tsc` results; anything you could not do and why; Noticed, not done.
