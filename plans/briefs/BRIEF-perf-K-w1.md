# BRIEF — perf-K worker 1 — the **same-as variant** (★P10, thumb-is-source)

Supervisor: lane `perf-K` (`plans/briefs/BRIEF-perf-K.md`). Report to `plans/REPORT-perf-K-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Today a whole-frame WebP within the thumb edge has no thumb row: every `?v=thumb` request runs `ensureVariant` →
`loadSource` (reads the whole source into memory) → `deriveThumb` returns the source. The owner ruled (★P10,
2026-11-13): **record it as a variant row pointing at the source bytes.** The challenger's objection [C6] was
accepted and is binding: **a pointer row must never own a path** — `removeVariant` unlinks `row.path`, cull
precondition 1 counts siblings, and backfill's stale re-cut calls `removeVariant`; any of these could unlink the
only bytes.

## Already done by the supervisor (do NOT touch `db/schema.ts` or `drizzle/`)

Migration `drizzle/0158_sweet_nightshade.sql` (generated) adds, on `variants`:
- `path` is now **nullable** (`VariantRow.path: string | null`);
- `same_as_variant_id integer` (no FK) — `sameAsVariantId` on the row;
- CHECK `variants_same_as_check`: `(path IS NULL) = (same_as_variant_id IS NOT NULL)` — a row owns a path or names
  a source, never both, never neither.

The name (NOMENCLATURE §24, recorded by the supervisor in §25): a **same-as variant** — a variant row whose bytes
ARE another variant's of the same file; `variant` stays `'thumb'` (the route looks thumbs up by that value), `path`
is NULL, `same_as_variant_id` names the source row. ⚠ Not the display pointer (`files.display_variant_id`). Use the
words "same-as variant" in comments; introduce no other new name, export, setting or event.

## Files owned (edit only these)

- `src/lib/server/media/variants.ts`
- `src/lib/server/media/cull.ts` (only for the same-as rule)
- `src/lib/server/media/backfill.ts` (only for the same-as rule)
- `src/lib/server/media/thumbnail.ts` (only if needed — probably not)
- `src/routes/media/[id]/+server.ts` only if a branch is truly needed (it should not be: see below)
- New test file(s) under `src/lib/server/media/` (e.g. `sameAsVariant.int.test.ts`), and edits to existing
  `src/lib/server/media/*.test.ts` that the change breaks.

**Files readable:** anything. Notably `media/index.ts` (`deleteFile` ~l.621, `createMedia`), `media/paths.ts`,
`sockets/media.ts` (frame change ~l.487/562 calls `cullVariant` on the thumb, then `ensureVariant`; admin list
~l.340 sums `v.bytes`), `media/thumbnailSkipDecode.int.test.ts` and `media/mediaRoute.conditional.int.test.ts`
(fixtures and patterns to copy).

## What to build

1. **`deriveThumb` records it.** Both short-circuits (the stored-size `thumbnailCut(...).serveSource` check and
   `makeThumbnail` returning null) write a same-as row when `source.row` exists and `cacheEnabled(db, file)`:
   `variant: THUMB`, `mime/bytes/hash/width/height` copied from the **source row**, `path: null`,
   `sameAsVariantId: source.row.id`, `isOriginal: false`, `cache: true`, `fidelity: REDUCED`,
   `.onConflictDoNothing()` (same race backstop as `storeReduced`). It still returns the source `ResolvedVariant`
   (so `backfill` and `sockets/media.ts:515` count it as "nothing generated", as today). With the cache off, write
   nothing (as `storeReduced` does).
2. **Reading a same-as row resolves to its source.** `readVariant`/`ensureVariant`: an existing same-as row → load
   the source row by id (`getVariantById`) and read **that** (the returned `ResolvedVariant` is the source's, row
   included — "a thumbnail request for an image too small to shrink resolves to the source"). If the source row
   is gone, the same-as row is stale: drop it (`removeVariant`, which unlinks nothing for it) and derive again.
   `locateVariant`: an existing same-as row → `{ kind: "stored", row: <source row>, absPath: resolveMediaPath(source.path) }`
   so the route streams the source file with its ETag/Range as for any stored row and reads no bytes up front; a
   missing source → fall through to `ensureVariant`. Never call `resolveMediaPath(null)`.
3. **`removeVariant` never unlinks through a same-as row** (`path` null → skip the unlink, drop the row). And when it
   removes a row that same-as rows name, it drops those same-as rows too (one delete `WHERE same_as_variant_id =
   row.id`), so nothing is left pointing at gone bytes. `deleteFile` (`media/index.ts`, not yours) iterates
   `variantsFor` and calls `removeVariant` on each — check it still deletes everything and unlinks every real file.
4. **`cullVariant`**: culling a same-as row is always allowed (it owns no bytes): remove it, `freedBytes: 0`, no
   precondition 1 or 2. Precondition 1 ("never the last surviving representation") counts **only rows with a
   path**. Precondition 2's candidates already exclude reduced rows; keep it that way.
   `cullableDerived`: exclude same-as rows (they free nothing; pricing them would lie).
5. **`backfill.ts`**: `stale()` excludes same-as rows (`isNull(schema.variants.sameAsVariantId)`); `pending()` already
   stops picking a file once any thumb row exists — that is the intended win (a small WebP stops being re-read
   every sweep).
6. Fix every TypeScript use of `row.path` that is now `string | null` inside your files.

## Tests (new int test file; copy fixture setup from `thumbnailSkipDecode.int.test.ts`)

- A whole-frame WebP under the thumb edge: the first `ensureVariant(..., THUMB)` writes **one** same-as row
  (`path` null, `same_as_variant_id` = the original's row id, `fidelity` reduced) and **no second file on disk**
  (count files under the file's media dir before/after).
- A second request: `locateVariant(..., THUMB)` returns `kind: "stored"` with the **source's** absPath and row
  hash, and reads no source bytes (spy on `fs.readFile` or assert `ensureVariant`/`loadSource` is not reached —
  pick one honest check).
- `cullVariant` on the same-as row: row gone, source bytes still on disk, `freedBytes` 0.
- `cullVariant` on the **original** when the same-as row exists and there is no other path-owning row: refused
  (precondition 1 does not count the same-as row); source bytes on disk.
- Backfill stale re-cut: a same-as row is never selected by `stale()`; run `backfillThumbnails()` and assert the
  source bytes are still on disk.
- `removeVariant` on a source row drops the same-as rows that name it.
- `deleteFile` removes every row and every real file.
- A row with both `path` and `same_as_variant_id` (or neither) is refused by the database (the CHECK).
- Cache off (`user_settings.derived_media_cache_enabled = false`): no same-as row written.

## Rules (quoted from CLAUDE.md and the lane brief — they bind you)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id." (Tests insert and read back ids.)
- "Migrations are **generated** (`db:generate`)." You do not run it; the supervisor already did. Do not edit
  `db/schema.ts` or anything in `drizzle/`.
- P2: "A module owns its data and every write to it" — the media module owns variant rows; everything stays in
  `media/`.
- P1: deterministic — no randomness, no timers.
- NOMENCLATURE R1/R3: say **same-as variant**, never bare "pointer" for it (the *display pointer* is a different
  thing).
- Do what was asked, at the size asked. Findings along the way go in your report under **Noticed, not done**,
  never fixed in passing. In particular do NOT edit `sockets/media.ts` (its admin `storedBytes` sum will count a
  same-as row's bytes — report it, the supervisor queues it).
- Do NOT extend this to the FITTED form (`deriveFitted` also returns the source) — note it only.

## Hygiene (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should not need `sdk:build` at all.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Use absolute paths; the repo is `/home/jody/github/serene-pub`.

## Done means

Green, in a capped scope: your new test file, `src/lib/server/media/*.test.ts` (all of `media/`),
`src/lib/server/media/mediaRoute.conditional.int.test.ts`, `src/lib/server/media/mediaRoute.spoken.int.test.ts`,
`src/lib/server/sockets/mediaCleanup.int.test.ts`, `src/lib/server/sockets/mediaFrame.int.test.ts`,
`src/lib/server/sockets/media.int.test.ts`. `npx tsc --noEmit -p .` shows no error in your files (filter its
output by path; other lanes' errors are not yours). `npx prettier --check` on each file you edited (say which were
already unclean at HEAD).

## Report (`plans/REPORT-perf-K-w1.md`)

Changed files; each rule above and how you met it; tests run with pass counts; anything you could not do;
**Noticed, not done**.
