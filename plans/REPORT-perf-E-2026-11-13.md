# REPORT — lane `perf-E` — background jobs, media and pushes do per-batch work — 2026-11-13

Supervisor's report (relayed to disk by the lead; the harness refused the supervisor's own write). 8 of 10 steps
built (1, 3, 4a, 5, 6, 7, 8, 9); step 10 built in `seatedCast.ts` with its call site queued; steps 2 and 4b deferred
as ★. Grouped lane run: 73 files, 565 tests, all passing; no `/tmp/serene-pub-*` left behind. Nothing committed.
Worker briefs: `plans/briefs/BRIEF-perf-E-w1..w5.md`.

## Re-verification and what was built

| row | verified | built | what |
|---|---|---|---|
| F1 vectorisation | yes | step 1 | each scan fetches up to 50 ids (`SCAN_BATCH_SIZE`) into a buffer per chain and model; the head is re-read by id on every pick (nothing in the buffer is trusted: an edited row embeds with new text, an already-embedded row is skipped); refills cut into chunks of 16 with one lazy `batchEmbed` each, used only when the re-read hash matches; buffers cleared on stop/removeGroup; `lane.ts` untouched. 120 rows → 4 scans. |
| F2 annotation vocabulary | yes | **deferred ★E-2** | `loadVocabulary` also reads cards' `is_deleted`, versions, amendments and the holder book; some writers never enqueue annotation (`characters.ts:1128`, pipeline binding writes), and `annotations/queue.ts:107–124` records an earlier cache removed for exactly that staleness. |
| F3 media route | yes | step 3 | ETag from the stored hash compared before any read; 304 with no `open`/`readFile`; body streamed from the handle; `Range` via `parseByteRange` from `frameHost` (its responders are private and add CSP/CORS); 206/416/`Accept-Ranges`. One assertion in `mediaRoute.spoken.int.test.ts` updated (`bytes=0-` → 206). |
| F4 thumbnails | yes | 4a built, **4b deferred ★E-4b** | `thumbnailCut()` written once; `deriveThumb` short-circuits on stored width/height for WebP sources, no decode, no variant row (★P10). Worker thread needs a Vite server worker entry (shared `vite.config.ts`) — not this lane's. |
| F5 backup | partly | step 5 | the Blob copy is inherent to PGlite; the `Buffer.from` second copy and `writeFileSync` are gone: `pipeline(Readable.fromWeb(blob.stream()), createWriteStream(tmp))`, same rename. |
| F6 boundary watcher | yes | step 6 | running line count / token totals seeded by one query; `judgedSceneCheckOf` uses SQL `count(*)` + newest 20 ids. `replayStoryLane` untouched (round numbers count from the first turn). Peer-edited file: a worker's `prettier --write` reflow was reverted to keep the diff minimal. |
| F7 pushes | yes | step 7 | empty `user_<id>` room returns before gate/query/thunk; `isAdmin` from a connected socket, DB fallback; one chain per user; one progress emitter per admin user with hand-over on disconnect. |
| F8 exports | yes | step 8 | the three `characters:exportCard` success emits answer the asking socket (`replyToAsker`, modelled on `connections.ts`); `charx` uses async fflate `zip`, `assets/*` at level 0; `zipPackage` stays sync (caller in `pluginPackages.ts` not this lane's) but stores compressed extensions at level 0. Archive contents verified identical by test. |
| F9 card-source cache | yes | step 9 | `TtlCache(ttlMs, maxEntries = 500)`; expiry sweep and LRU eviction on `set`. |
| F10 `sessions:list` cards | yes | step 10, call site queued | `cardNameplatesNow(db, ids)` in `cast/seatedCast.ts`: `{id,name,nickname,avatarMediaId}` from the newest version, no `ensureCardVersion` write; test asserts equality with `cardsNow` incl. version-less and soft-deleted cards. |

## Changed files (inside Files owned)

`embedding/vectorizationQueue.ts` · `routes/media/[id]/+server.ts` · `media/{variants,thumbnail,index}.ts` ·
`media/mediaRoute.spoken.int.test.ts` (1 assertion) · `db/backup.ts` + `backup.int.test.ts` (1 assertion) ·
`scenes/boundaryWatcher.ts` · `sockets/utils/userPush.ts` · `sockets/vectorization.ts` · `sockets/characters.ts`
(3 emits, helper, imports) · `sprites/charx.ts` · `plugins/exportPackage.ts` (zip call) · `cardSources/cache.ts` ·
`cast/seatedCast.ts`. New tests: `vectorizationQueue.batchScan.int`, `mediaRoute.conditional.int`,
`thumbnailSkipDecode.int`, `boundaryWatcher.lengthTotals.int`, `userPush`, `vectorization.progressEmitter`,
`characters.exportAsker.int`, `zipStored`, `cardSources/cache`, `seatedCast.cardNameplatesNow.int`.
Not touched: `indexing/lane.ts`, `annotations/*`, `notifications/store.ts`, `frameHost.ts`, `sockets/sessions.ts`,
`sockets/index.ts`, `pluginPackages.ts`, SDK files.

## Done means

All brief checks pass: 120 rows / 4 scans; 304 with no read and Range → 206; no decode for a small whole-frame WebP;
no DB query for an offline user; one emit to the asker; the cap holds. `tsc` filtered: clean. Prettier: new files
clean; six shared/peer files left as unclean as at HEAD; six lane-owned files now fully formatted (diffs include
whitespace).

## Queued for the `sessions.ts` owner

1. `putCardsNow` (~634): when `opts.only` is a subset of `["id","name","nickname","avatarMediaId"]`, call
   `cardNameplatesNow` instead of `cardsNow` (only `buildSessionsListFor` ~456 takes this path).
2. Delete the two `console.log` calls in `buildSessionsListFor` (~363–368, ~379).

Queued for `sockets/pluginPackages.ts:117`: make `zipPackage` async (fflate `zip`) and `await` it there.

## Open ★

- **★E-2** annotation vocabulary cache: recommend leave uncached (the code's own comment rules). Alternative: a
  `(count, max(xmin))` fingerprint over exactly the rows `loadVocabulary` reads, compared per pick.
- **★E-4b** thumbnail codecs on a worker thread: needs one worker module plus a Rollup server input in
  `vite.config.ts` (shared), pool of one; a second WebP WASM compile at first use.
- ★P10 untouched.

## Accepted consequences (behaviour at the edges)

- A 304 is answered for a matching ETag even when the file has since left the disk (was: display fallback).
- `Range: bytes=0-` answers 206 with the whole body.
- A row created during a vectorisation drain waits until the buffer (≤ 50) empties.

## Noticed, not done

- Step-1 race: `nextOfChain` caps refills at 2 per call; in a rare race a call can return `null` and retire a group
  or end a run early; the next periodic scan or start recovers. A third pass over the second buffer would close it.
- Only `pickSessionMessage` has an ORDER BY; the other pickers keep heap order, as before.
- `ensureSessionMessageEmbedded` still embeds one row at a time.
- `replyToAsker` now exists in both `sockets/connections.ts` and `sockets/characters.ts`.
- The PNG `exportCard` emit has no test (changed exactly like the two tested ones).
- A failed backup write still leaves a `.partial` behind, as before.
- A WebP that is its own thumbnail still has its bytes read per `?v=thumb` request (needs ★P10's variant row).


---

## Lead's acceptance note (after scope review)

Four findings, all accepted. (1) Scan buffers outlive their groups (a group dropped by `pickNext` or by `replaces`
leaves a `group:<uuid>` buffer until `stopVectorization`), and the two-refill cap can return `null` with rows still
unembedded: fixed by a follow-up worker (`perf-E-w6`): stale group buffers pruned at pick time, a third drain pass
before returning null. (2) `cardFacesNow` / `CardFace` reused **face**, which NOMENCLATURE §8 defines as the picture a
cast member is drawn with: renamed by the lead to `cardNameplatesNow` / `CardNameplate` ("nameplate" was unused in
`src` and the canon); §25 row added; the queued `putCardsNow` call site is now applied by the lead with that name,
and the two `console.log`s removed. (3) `media/index.ts` gained two barrel export lines — outside Files owned,
recorded here. (4) `STORED_EXT` in `exportPackage.ts` stores fonts, archives and media at level 0 as well as images;
archive contents unchanged; recorded. Checks (b) and (c) in the review found no objection: no client relies on the
display fallback a 304 now pre-empts; the nameplate read equals `cardsNow` for every case including version-less and
soft-deleted cards, without the first-version write.
- **Follow-up `perf-E-w6` landed** (`plans/REPORT-perf-E-w6.md`): `pruneDroppedGroupBuffers()` at the start of
  `pickFromGroup` drops every `group:` buffer not in `embeddingLane.snapshotGroups()` (lane.ts untouched);
  `nextOfChain` drains a third time (drain, refill, drain, refill, drain) before returning `null`; test-only
  `_scanBufferKeys()`; two new tests. Embedding + indexing directories: 28 files, 208 tests green.
