# BRIEF — build lane `perf-E` — background jobs, media and pushes do per-batch work, off the main thread

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1 and W8; `plans/REVIEW-performance-2026-11-13.md` rows F1–F10 (every row here is **S** or **V**: re-verify each
at its lines before changing anything, and say in the report what you found); CLAUDE.md Principles, Hard rules
(PGlite transaction rule, sockets rule, "Image assets never in tmp") and Standing rulings; `docs/<area>.md` for any
area whose behaviour a step touches (`docs/connections.md` for embeddings if present; grep `docs/` for "vectoriz",
"thumbnail", "backup"). Line numbers are from 2026-11-13; re-read before editing.

## Rulings that bind

- Owner 2026-11-13: change how often, never what. Every job still processes the same rows in the same order; every
  response carries the same bytes and headers except where a step names a header it adds (ETag-before-read, Range).
- ★P10 (a "thumb is source" media variant row) is **unruled**: do not add a variant kind. Step 4 below does only
  the parts that need none.
- P1: a cache here is keyed so a stale answer is impossible; name the key and the invalidation in the report, one
  test per cache that a write invalidates it.
- **Not your files:** `src/lib/server/pipelines/runtime/host.ts`, `bindings.ts` (peer session); anything under
  `src/lib/server/sockets/sessions.ts`, `entries.ts`, `lorebooks.ts`, `plugins/*Sandbox*` (other lanes, done or live).

## Build (each step = one worker brief; at most 2 workers at once)

1. **Vectorisation picks a batch per scan** (F1, `embedding/vectorizationQueue.ts:900–912`, `:1118–1212`;
   `indexing/lane.ts:863`). The pickers fetch K candidate ids per scan (K = the lane's batch size or 50) into a local
   buffer the lane drains before scanning again; the last empty scan stays (it is how "nothing left" is known) but
   runs once per drain, not once per item. Characters and relationships: compute the text digest once per scan into
   the buffer, not once per row per read. Use the batch embed call where the adapter has one (`batchEmbed`), with
   the same per-item result handling. No stored-flag or index (that is W7-a/★P8). Same rows, same order.
2. **Annotation vocabulary per lane run** (F2, `annotations/queue.ts:267`, `:309–311`; `annotations/index.ts:434–540`).
   Cache `loadVocabulary` per lorebook id for the duration of one lane run, invalidated when an entry or binding of
   that book is written (find the write sites; if the only clean hook is the existing `enqueueLorebookAnnotation`
   call, key the cache on the gazetteer hash it already computes and compare).
3. **Media route answers 304 before reading** (F3, `routes/media/[id]/+server.ts:186–245`; `media/variants.ts:223`).
   ETag from `row.hash` (plus whatever the current tag derives from besides bytes) before any disk read; a matching
   `If-None-Match` returns 304 with no read. Stream the body (no `Uint8Array` copy) and honour `Range` by reusing the
   responders in `plugins/frameHost.ts` (~489–530, `respond`/`diskBody`) — import, do not copy. Same headers as
   today otherwise.
4. **Thumbnails: no needless decode, and off the main thread** (F4, `media/thumbnail.ts:69–111`; `media/variants.ts:453–465`).
   (a) Before decoding, short-circuit on the stored `files.width/height` and mime when the row already says the
   source is a whole-frame WebP within `THUMB_MAX_EDGE` — serve the source without decoding (what happens today,
   minus the decode). Do **not** record a variant row (★P10). (b) Move `makeThumbnail`'s decode+encode into a
   `worker_thread` with a small pool of one, posting bytes in and out; same output bytes. If (b) needs more than a
   worker file beside `thumbnail.ts`, stop and ask.
5. **Backup streams** (F5, `db/backup.ts:239–246`): pipe `blob.stream()` to `fs.createWriteStream`; no `arrayBuffer`
   copy, no `writeFileSync`. Same file, same name, same completion semantics.
6. **Boundary watcher keeps running totals** (F6, `scenes/boundaryWatcher.ts:430–441`, `:511`, `:1360–1367`;
   `routines/moments.ts:240–270`): keep the line count and token total across the walk instead of reloading every
   line's content per walked line; `judgedSceneCheckOf` filters `id > base` in SQL with a count. Replay from the
   anchor onward only if `replayStoryLane`'s contract allows it; otherwise leave it and say so. **Caution:** the peer
   session has edited `scenes/*` recently — read the current file, and if `boundaryWatcher.ts` shows as modified in
   `git status`, skip this step entirely and report "deferred: file in use".
7. **Pushes** (F7, `sockets/utils/userPush.ts:49–75`; `sockets/vectorization.ts:608–611`; `notifications/store.ts:378`):
   return early when the `user_<id>` room is empty; take `isAdmin` from a connected socket's user when one exists,
   else today's query; one promise chain per user instead of one global chain; one progress emitter per user, not
   per socket (k tabs must still each receive one copy). Same events, same payloads.
8. **Exports** (F8, `sockets/characters.ts:2282–2344`; `sprites/charx.ts:119`; `plugins/exportPackage.ts:620`):
   answer the asking socket (the handler's reply / `answerAsker`) instead of every tab; store already-compressed
   image entries at `level: 0`; use the async `zip`. Same archive contents.
9. **Card-source cache** (F9, `cardSources/cache.ts:15–28`): a size cap (say the number) and expiry sweep on `set`.
10. **`sessions:list` narrow cards** (F10, `sockets/sessions.ts:456–468` is **not yours** — build the narrow
    `cardsNow` variant in `cast/seatedCast.ts:74–88` (name, nickname, avatar from the newest version, no
    `ensureCardVersion` loop) and queue the one-line call-site change in your report for the sessions.ts owner. Remove
    nothing else. The two `console.log`s (`:363`, `:379`) are queued the same way.

## Files owned

`src/lib/server/embedding/vectorizationQueue.ts`, `src/lib/server/indexing/lane.ts`, `src/lib/server/annotations/{queue,index}.ts`
(the vocabulary cache only), `src/routes/media/[id]/+server.ts`, `src/lib/server/media/{variants,thumbnail}.ts` (+ a worker
file beside), `src/lib/server/db/backup.ts` (the dump write only), `src/lib/server/scenes/boundaryWatcher.ts` (step 6 only,
if not in use), `src/lib/server/sockets/utils/userPush.ts`, `src/lib/server/sockets/vectorization.ts` (the emitter
registration only), `src/lib/server/notifications/store.ts` (`pushChanged` only), `src/lib/server/sockets/characters.ts`
(the three export emits only), `src/lib/server/sprites/charx.ts`, `src/lib/server/plugins/exportPackage.ts` (the zip call
only), `src/lib/server/cardSources/cache.ts`, `src/lib/server/cast/seatedCast.ts`; tests beside each.

## Out of scope

★P10 variant row. W7-a indexes. Any new setting, event or user-facing name. `sockets/sessions.ts`. SDK files.

## Stop and ask when

A step needs a new variant kind, event, setting, migration or name; a reader depends on the main-thread timing of
thumbnails; `replayStoryLane` cannot start from an anchor without changing an answer.

## Done means

For each step, the existing tests of the touched files (list them) plus one targeted test: (1) N items drained with
⌈N/K⌉+1 scans (count scans with a spy); (2) vocabulary loaded once per run and reloaded after an entry write; (3) a
304 with no `readFile` call, and a `Range` request answered 206; (4a) no decode for a small whole-frame WebP; (4b)
identical bytes from the worker and the inline path; (7) no DB query for an offline user; (8) one emit, to the asker;
(9) the cap holds. `npx prettier --check` on changed files; `npx tsc --noEmit -p .` filtered to owned files clean. No
full `npm test`.

## Report path

`plans/REPORT-perf-E-2026-11-13.md`: per step verified/not, built/deferred, changed files, tests with results,
"Queued for the sessions.ts owner", open ★, **Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Image assets never in `/tmp`.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- At most 2 workers at once. Workers get these rules inline.
