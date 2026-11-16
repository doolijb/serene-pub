# BRIEF — build lane `perf-C` — lorebook saves cost one entry, not one book

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1 and W5; `plans/REVIEW-performance-2026-11-13.md` rows D1–D5; `docs/lorebooks.md` (the sections on entries,
bindings/cast tags and ordering); CLAUDE.md Principles, Hard rules (PGlite transaction rule, sockets rule, SvelteSet/
SvelteMap rule) and Standing rulings; NOMENCLATURE §1, §24 (you add no names; stop if you must). Line numbers are
from 2026-11-13; re-read before editing. Rows marked **S** in the review are sweep findings: re-verify each at its
lines before changing anything, and say in the report what you found.

## Rulings that bind

- Owner 2026-11-13: change how often, never what. Every entry list, binding row, order and event a reader receives
  is the same as today; only redundant work and redundant sends go.
- ★P6 (removing `embedding` from the `entries:list` wire row) is **unruled**: the vector stays on the wire in this
  lane. What you may do is stop *re-sending* the list when a targeted event already carries the change.
- Sockets: one domain context per event family is the only listener; scoped events carry their scope key.

## Build

1. **Bindings sync scans the saved entry, not the book** (D2). `sockets/lorebooks.ts:1188–1252`
   `syncLorebookBindings` selects the content of every entry with a `char:` tag and regexes all of it, under
   `pg_advisory_xact_lock`, from `sockets/entries.ts:421` on every create/update. Make `afterWrite` pass the written
   entry (old and new content, or its id) and have the sync scan only that; query the held/issued set only when that
   entry carries a tag not yet issued. The full-book path stays for the callers that need it (book import, repair):
   keep it as the fallback when no entry is passed. The result rows and the lock discipline are unchanged.
2. **No full relist after a single-entry create/update** (D1, the send half). `afterWrite` ends in `relistEntries`
   (`entries.ts:501–515`), re-sending the whole type list to the owner and every reader. The targeted
   `entries:update` / create event already reaches the client (`client/lorebooks/LorebooksWorkspace.svelte:2078–2103`).
   Drop the trailing relist for create and update only, after confirming on the client that the targeted event
   carries everything the list row shows (compare `toEntryRow` fields with what the update handler patches; if a
   field is missing, add it to the targeted event's payload rather than keep the relist). Other `relistEntries`
   callers (scenes, amendments, narrative graph, reorder) are untouched unless step 4 says so.
3. **Client keeps entries keyed** (D3, **S** — verify). `LorebooksWorkspace.svelte:2016–2020` and `:2078–2103`
   rebuild whole type arrays per edit; six whole-book deriveds rerun. If verified, hold rows in a `SvelteMap` per
   type (never `$state(new Map())`), patch one row on a targeted event, and batch `handleVectorized` patches per
   animation frame. Rendering order and content unchanged.
4. **`lorebooks:list` counts instead of loading rows** (D4, **S** — verify that no client reads
   `worldLoreEntries` / `characterLoreEntries` / `historyEntries` id arrays: grep `src/lib/client` and the SDK
   `core-catalog`). If nothing reads them, replace the per-book entry load (`lorebooks.ts:395–401`, `:474–509`) with
   one grouped count and select explicit list columns. If something reads them, leave the shape and only narrow the
   select to `{id, typeId, archived}` — which it may already be; report.
5. **Reorder in two statements** (D5): `entries.ts:1748–1758` issues 2N single-row updates; use `UPDATE … FROM
   (VALUES …)` in one transaction (`tx` only inside it). Keep the relist here (the whole order changed).

## Files owned

`src/lib/server/sockets/entries.ts` (`afterWrite`, `relistEntries`, `reorderEntries` and their helpers) ·
`src/lib/server/sockets/lorebooks.ts` (`syncLorebookBindings`, the `lorebooks:list` builder) ·
`src/lib/client/lorebooks/LorebooksWorkspace.svelte` · `src/lib/client/lorebooks/bookPatches.ts` · tests beside them.

## Files readable

Everything. `src/lib/server/utils/lorebookEntries.ts` is read-only for you (★P6).

## Out of scope

★P6. Any new event or event field beyond what step 2 needs to make the targeted event complete. Vectorisation
(`embedding/**`). `sockets/scenes.ts`, `amendments.ts`, `narrativeGraph.ts`.

## Stop and ask when

A reader of the dropped relist turns out to depend on it for something the targeted event cannot carry; a new
name; a migration; a shared-file edit outside the named handlers.

## Done means

`npx vitest run` on the existing tests for `sockets/entries*`, `sockets/lorebooks*`, `utils/lorebookEntries*` and
the client `lorebooks` tests (list them in the report), green; plus: one test that a single-entry update emits no
`entries:list`, and one that `syncLorebookBindings` on a single entry issues the same binding rows as the full scan
did for that entry. `npx prettier --check` on changed files. Report wire bytes sent on one entry save before/after
(count payload bytes in the test with a fake emitter).

## Report path

`plans/REPORT-perf-C-2026-11-13.md`: changed files, verified/not-verified for each S row, tests with results,
before/after bytes, open ★, **Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Inside `db.transaction(async (tx) => …)` use only `tx`. `$state(new Map())` is not reactive: use `SvelteMap`.
- At most 2 workers at once. Workers get these rules inline.
