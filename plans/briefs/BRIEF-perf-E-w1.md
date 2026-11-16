# BRIEF perf-E-w1 — vectorisation picks a batch per scan (lane perf-E step 1, review row F1)

Repository: /home/jody/github/serene-pub. Supervisor: lane perf-E.

## Goal

The embedding lane's background pickers today run one full-table scan (with an unindexable text-hash predicate) per
item: `limit(1)` in `pickSessionMessage`, `pickEntry`, `pickNarrativeNode`, `pickNarrativeRelationship`,
`pickCharacter` (`src/lib/server/embedding/vectorizationQueue.ts` ~1187–1600), called through `pickFromGroup`
(~1075) and `pickGlobalNextItem` (~1118) via `embeddingWork.fromGroup/global` (~317), from the lane loop
(`src/lib/server/indexing/lane.ts` ~863, `pickNext` ~736). Draining N rows costs N scans, so O(N²). Characters and
relationships compute a SQL text digest (`textDigest(...)`) per row on every scan. One `embed()` call per row.

Make each background scan fetch up to K candidates into a buffer the lane drains before scanning again, and embed
in batches — **same rows, same order, same writes**.

## Design (supervisor's decision — follow it; name any deviation in the report)

1. **K = 50**, a module constant (verified: `LaneLimits` has no batch size). Not a setting.
2. **One buffer per pick chain and model**, inside `vectorizationQueue.ts` (the work source). Chain key:
   `"global"` for `pickGlobalNextItem`, `group:<groupId>` for `pickFromGroup(group)`; buffer key includes the model
   id. The buffer holds, in scan order, entries `{ ref (which picker + row id + the scope args that picker was called
   with), text, sourceHash, batch }` captured from the scan.
3. **Refill** = run the chain's pickers in their existing order, each scanning with `.limit(K)` instead of
   `.limit(1)` (same WHERE, same ORDER BY — `pickSessionMessage` has one, the others have none and stay without);
   the first picker that returns ≥1 row fills the buffer. A chain where every picker returns nothing answers `null`
   (that is the "last empty scan", kept, once per drain). The scan selects `id`, `text`, `sourceHash` (and the label
   fields) — so a character's / relationship's digest is computed once per scan, never per item.
4. **Draining — revalidate the head, never trust the buffer blindly.** On each pick: take the buffer head and
   re-pick that one row with the picker's existing `onlyId` form, passing the same scope args (e.g.
   `pickEntry(typeIds, label, model, lorebookId, onlyId)`) — a primary-key read that returns a fresh item (fresh text
   and hash) or `null` when the row no longer needs a vector. `null` → drop the head and look at the next; an item →
   return it and **leave the head in the buffer**. It is dropped on the next pick when revalidation answers `null`
   (it was embedded). This reproduces today's semantics exactly: a failed or unprocessed item is handed straight back
   (the lane's backoff relies on that, `processOne` ~956), a row embedded meanwhile by a promotion is skipped, an
   edited row is embedded with its new text. No failure hook, no removal on process.
5. **Batch embed.** The entries of one refill are cut into chunks of up to 16. Each chunk carries a lazily started,
   memoised `batchEmbed(texts.map(truncateForEmbedding))` (`embedding/index.ts` ~599), started by the first
   `process()` of an item in that chunk, over the scan-time texts. An item returned by a pick uses its chunk's vector
   only when the revalidated `sourceHash` equals the scan-time `sourceHash` (same hash ⇒ same text) and the batch
   resolved with one array per text; otherwise (hash moved, batch rejected, wrong length) it calls
   `embed(truncateForEmbedding(text))` itself, exactly as today. Then the same freshness-guarded write as today
   (`writeEmbeddingIfFresh` / `writeEntryVectorIfFresh` with the item's captured hash). A per-item embed failure
   throws from `process()` as today, so the lane's per-item failure handling is unchanged.
6. **Clear buffers** in `stopVectorization()` (all) and `removeQueueGroup(groupId)` (that group's). Buffers of
   another model are never read (the key) — drop them on refill so the map stays small.
7. **Unchanged:** `embeddingWork.specific` (promotion), `ensureSessionMessageEmbedded`, `countUnembedded`, the
   SQL recipes, `writeEmbeddingIfFresh`, `writeEntryVectorIfFresh`, `lane.ts` (don't edit it unless you find you
   must; then stop and say why). No stored flag, no index, no migration (that is W7-a / ★P8, out of scope).

Known, accepted consequence (say it in the report): a row created *during* a drain that today would jump ahead of
the buffered rows (e.g. a new message ahead of buffered entries) waits until the buffer drains (≤ K items). Rows
that existed at scan time are processed in the same order.

## Files owned

- `src/lib/server/embedding/vectorizationQueue.ts`
- `src/lib/server/indexing/lane.ts` (only if unavoidable — ask first via your report)
- new test file(s) beside them, e.g. `src/lib/server/embedding/vectorizationQueue.batchScan.int.test.ts`

## Files readable

`src/lib/server/embedding/index.ts` (embed/batchEmbed), the existing `src/lib/server/embedding/*.test.ts` for the
PGlite + fetch-mock setup (`vectorizationQueue.peekBeforeLoad.int.test.ts` shows it), `indexing/lane.ts`.

## Out of scope

Stored needs-embedding flag, partial index, migration; `sockets/vectorization.ts` (another worker of this lane);
the progress-emitter functions in this file (`registerProgressEmitter` etc.) — leave them byte-identical.

## Done means

- New int test: N rows of one store (e.g. characters, N = 120, K = 50) drained through the work source / lane with
  **⌈N/K⌉ + 1 scans** of that store (count the scan queries with a spy at the db boundary — e.g. `vi.spyOn` on the
  test db's `select`/`execute` filtered to that picker's statement, or another non-production-visible way you
  choose and name); every row embedded exactly once, in the same order the one-row picker would have produced;
  embed requests batched (the fetch mock sees ⌈N/16⌉ embed calls when nothing moves).
- One case each: a row edited after the scan is embedded with its new text (hash moved → single embed); a row
  embedded by `specific` meanwhile is skipped (no second embed); a failing item is handed back first on the next
  pick.
- Existing tests green: `npx vitest run src/lib/server/embedding src/lib/server/indexing` (run the directories;
  report counts; if a pre-existing test asserted "pick twice without processing returns the same row", it still
  must — the head stays).
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
