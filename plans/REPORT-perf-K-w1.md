# REPORT perf-K w1 — same-as variant

Status question: none relayed; all work done.

## Changed files
- src/lib/server/media/variants.ts — `recordSameAs` (both deriveThumb short-circuits; cache-gated, onConflictDoNothing, copies source row's mime/bytes/hash/dims, path null, fidelity reduced, still returns the source); `sourceOfSameAs` (resolves to source row, drops a stale same-as row); `ensureVariant`/`locateVariant` resolve through it (locate returns the source row + source absPath, reads nothing); `readVariant` returns null for path-null; `removeVariant` skips unlink for path-null and, for path-owning rows, first deletes rows with `same_as_variant_id = row.id`.
- src/lib/server/media/cull.ts — same-as row: always cullable, freedBytes 0; precondition 1 and 2 use only path-owning siblings; `cullableDerived` excludes same-as rows.
- src/lib/server/media/backfill.ts — `stale()` excludes same-as rows.
- src/lib/server/media/media.int.test.ts — one `variant.path!` for the nullable type (line 563).
- src/lib/server/media/sameAsVariant.int.test.ts — new, 10 tests (all brief cases plus ensureVariant-resolves-to-source).
- Not touched: thumbnail.ts, route, schema, drizzle, sockets/media.ts.

## Rules
Only "same-as variant" wording used; no new names/exports/settings. No transactions used. No randomness. deleteFile checked: iterates a snapshot; removing the original drops the same-as row, then the later removeVariant on it is a harmless no-op; test confirms all rows and real files gone.

## Tests
- sameAsVariant.int.test.ts: 10/10.
- All of src/lib/server/media + sockets mediaCleanup/mediaFrame/media int tests: 19 files, 185 tests passed (before the one-line test type fix; media.int.test.ts + new file re-run after: 36 passed).
- `tsc --noEmit` filtered to server/media and routes/media: no errors (one existed in media.int.test.ts from nullable path; fixed).
- prettier: variants.ts, backfill.ts clean. cull.ts was already unclean at HEAD (verified via `git show HEAD:` through prettier); left as is. New test file formatted with --write.

## Assumptions
- A same-as row whose source row exists but has path null is treated as stale and dropped (cannot happen under the CHECK chain, defensive).
- A source file missing on disk: locateVariant returns stored as for any stored row; the route finds out on open (as today).

## Noticed, not done
- sockets/media.ts admin list sums `v.bytes`, and `storedBytesByFile` in cull.ts (SUM of variants.bytes, mine but not in brief scope) also counts a same-as row's bytes, overstating stored bytes; queue a fix to exclude same-as rows (path IS NULL).
- `cullableOriginals` is unaffected (same-as rows are reduced), but cull preview/other readers of `variants.path` outside media/ may need the nullable type (tsc showed none in my scope).
- deriveFitted still returns the source without a row (not extended, per brief).
- Frame change: sockets cull the thumb then ensureVariant; a same-as thumb is removed freely and re-recorded, fine.
