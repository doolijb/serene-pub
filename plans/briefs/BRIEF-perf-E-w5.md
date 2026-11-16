# BRIEF perf-E-w5 — backup streams; card-source cache cap; narrow cards for sessions:list (lane perf-E steps 5, 9, 10, review rows F5, F9, F10)

Repository: /home/jody/github/serene-pub. Supervisor: lane perf-E.

## Step 5 — backup streams (verified 2026-11-13)

`src/lib/server/db/backup.ts` `backupDatabase` (~239–246): `const bytes = Buffer.from(await blob.arrayBuffer())` then
`fs.writeFileSync(tmp, bytes)` then `fs.renameSync(tmp, file)`. Replace **the dump write only** with
`await pipeline(Readable.fromWeb(blob.stream()), fs.createWriteStream(tmp))` (`node:stream/promises`, `node:stream`),
then the same `renameSync`. Same temp name, same final name, same order (dump → rename → `archiveMetaFile` → user
files), same return shape: `bytes` becomes `blob.size` (the same number). On a write error, leave behaviour as today
(the error propagates; don't add cleanup that wasn't there — mention in the report if you think it should).

## Step 9 — card-source cache gets a cap and an expiry sweep on set

`src/lib/server/cardSources/cache.ts` `TtlCache` (~15–28) evicts only when the same key is read again. Add:
- a size cap: constructor `(ttlMs, maxEntries = 500)` — **500** is the lane's number for both `searchCache` and
  `cardDetailCache` (keep their constructor calls as they are so they take the default, or pass 500 explicitly; your
  choice, say it);
- on `set`: first drop every expired entry (one pass over the map), then insert (delete-then-set so a re-set key moves
  to the newest position), then while `size > maxEntries` delete the oldest (Map iteration order = insertion order).
`get`, `getOrFetch`, the pending/stampede logic and `stableSearchKey` unchanged. Not a setting; no new export beyond
the constructor parameter.

## Step 10 — narrow `cardsNow` for `sessions:list`

`sockets/sessions.ts` is NOT yours (do not edit it). Its `buildSessionsListFor` calls `putCardsNow(…, { only: ["id",
"name", "avatarMediaId"], avatar: true })`, which calls `cardsNow` (`src/lib/server/cast/seatedCast.ts` ~74–100): two
full-row reads (`CARD_LIBRARY_COLUMNS` and whole `character_versions` rows) plus an `ensureCardVersion` write for any card
with no version — to keep three fields.

Add beside `cardsNow` a narrow variant (you name it, e.g. `cardFacesNow`; internal server function, not a user-facing
name) that, for a list of card ids, returns `Map<cardId, { id, name, nickname, avatarMediaId }>` with **exactly the
values `cardsNow(...).get(id)` would give for those fields**:
- one read of the newest version per card (`selectDistinctOn([cv.cardId])… orderBy(asc(cv.cardId), desc(cv.number))`)
  selecting only the version columns those three fields derive from — trace `cardAsOfVersion` → `profileOf` →
  `cardColumnsOfProfile` in `src/lib/server/characters/cardIO.ts` (~520–580) to find which columns and any normalising
  (e.g. empty-name handling); reuse those functions on the narrow row if they accept it, rather than re-spelling the
  mapping;
- for a card with **no** version: no `ensureCardVersion` (no write on a list read) — read the `characters` row's own
  `name`, `nickname`, `avatarMediaId` instead, which is what the v1 `ensureCardVersion` would create holds (verify that by
  reading `ensureCardVersion` in `src/lib/server/characters/versions.ts`; if v1 would differ from the row, stop and report
  instead of building it);
- unknown ids absent; soft-deleted cards read like any other (as `cardsNow` does).
Remove nothing; `cardsNow` stays as is. The supervisor queues the one-line call-site change in sessions.ts for its owner.

## Files owned

- `src/lib/server/db/backup.ts` (the dump write only)
- `src/lib/server/cardSources/cache.ts`
- `src/lib/server/cast/seatedCast.ts` (the new function only)
- new tests beside them (e.g. `src/lib/server/cardSources/cache.test.ts`, `src/lib/server/cast/seatedCast.cardFacesNow.int.test.ts`)

## Files readable

`db/backup.int.test.ts`, `cardSources/*.test.ts`, `cast/seatedCast.cardsNow.int.test.ts` (fixtures for cards with and
without versions), `characters/cardIO.ts`, `characters/versions.ts`, `sockets/sessions.ts` ~440–470 and ~620–680.

## Out of scope

`sockets/sessions.ts`, any other cache, any behaviour change.

## Done means

- (5) existing `npx vitest run src/lib/server/db/backup.int.test.ts` green; the backup file's bytes equal the dump's (the
  existing test or one added assertion).
- (9) new unit test: inserting maxEntries + k keys keeps exactly maxEntries, the oldest k gone; an expired entry is swept
  by a later `set` of a different key; a re-set key survives eviction as newest.
- (10) new int test: for cards with versions (including a renamed newer version and a face change), a card with no
  version, and a soft-deleted card, the narrow function equals `cardsNow` on `id/name/nickname/avatarMediaId`, and makes no
  insert into `character_versions` for the version-less card (count rows before/after).
- Existing: `npx vitest run src/lib/server/cast/seatedCast.cardsNow.int.test.ts src/lib/server/cardSources` green.
- `npx prettier --check` on changed files — if `backup.ts` or `seatedCast.ts` was not prettier-clean before you started,
  don't reformat the whole file; report it. Filtered `tsc` clean.

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
