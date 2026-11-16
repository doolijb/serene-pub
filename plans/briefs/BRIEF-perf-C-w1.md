# BRIEF — perf-C-w1 — lorebook saves: bindings scan one entry, no full relist after a single write, grouped counts, batched reorder

You are a `lane-worker`. Lane `perf-C`; the lead is acting supervisor. Repository root `/home/jody/github/serene-pub`.
Read `plans/briefs/BRIEF-perf-C.md` in full first (its rulings bind you); this brief is your share of it: steps 1, 2,
4 and 5. Another lane-worker (`perf-C-w2`) owns the client files; you never edit them. Other uncommitted files in the
tree belong to other lanes and a peer session: never touch them; never `git stash` or `git checkout`.

## Files you may edit

`src/lib/server/sockets/entries.ts` — only `afterWrite`, `relistEntries`, `reorderEntries` and helpers you add beside
them; `src/lib/server/sockets/lorebooks.ts` — only `syncLorebookBindings` and the `lorebooks:list` builder
(~395–510); new or changed tests beside those files (`src/lib/server/sockets/entries.*.int.test.ts`,
`lorebooks.*.int.test.ts`).

## Do

1. **`syncLorebookBindings` scans one entry.** Today (`lorebooks.ts:1188–1252`) it selects the content of every
   entry with `char:` in it and regexes all of it under `pg_advisory_xact_lock`. Add an optional argument, e.g.
   `{ lorebookId, entry?: { content: string | null } }`: when `entry` is given, the tag scan runs over that
   content alone (the issued-tag read and the lock stay); when absent, today's full scan. `afterWrite`
   (`entries.ts:~413`) passes the written row's content (create and update); every other caller is unchanged.
   Result rows identical: a tag that is new in this entry is minted exactly as before.
2. **No full relist after a single-entry create/update.** `afterWrite` ends in `relistEntries` (`entries.ts:~501`),
   which rebuilds and sends the whole type list to the owner and every reader. The targeted event the create/update
   handlers already emit reaches the client (`LorebooksWorkspace.svelte` `handleEntryUpdated` ~2078 patches one row
   from `msg.entry`). First compare the fields of a list row (`toEntryRow` in `src/lib/server/utils/lorebookEntries.ts`
   — read only, do not edit; ★P6 keeps `embedding` on the wire) with the `entry` the create/update responses carry; if
   a list-row field is missing from the targeted payload, add it to that payload (in `entries.ts`) rather than keep
   the relist. Then make `afterWrite` take an option so create and update skip the trailing `relistEntries`; delete,
   reorder, iterate and every other cascade keep it. `relistBindings` stays (a write can mint a cast row).
3. **`lorebooks:list` counts.** Verify review row D4 first: grep `src/lib/client` and
   `/home/jody/github/serene-pub-sdk/core-catalog` for `worldLoreEntries`, `characterLoreEntries`, `historyEntries`.
   If no reader exists, replace the per-book entry load (`lorebooks.ts:~395–401`, `~474–509`) with one grouped
   `count(*) … WHERE NOT archived GROUP BY lorebook_id, type_id` and keep whatever count fields the client does read.
   If a reader exists, leave the payload shape and only make sure the select is `{id, typeId, archived}`. Report
   which.
4. **Reorder in two statements.** `entries.ts:~1748–1758` issues one UPDATE per entry; replace with `UPDATE … FROM
   (VALUES …)` inside one `db.transaction(async (tx) => …)` using only `tx`. The relist after it stays.

## Done means

Run (never piped into `head`, 60 s timeouts): `npx vitest run src/lib/server/sockets/entries.workspaceVerbs.int.test.ts
src/lib/server/sockets/entries.keyList.int.test.ts src/lib/server/sockets/entries.sessionWrite.int.test.ts
src/lib/server/sockets/lorebooks.bindingCrossTenantRefs.int.test.ts src/lib/server/sockets/lorebooks.bookFixes.int.test.ts`
plus any test whose name contains `binding` or `reorder` under `src/lib/server/sockets/` (list them). Add two tests:
(a) an `entries:update` of one entry emits no `entries:list` (fake emitter) and the targeted payload carries every
list-row field; (b) `syncLorebookBindings` with `entry` given mints the same binding rows for that entry's new tags
as the full scan did. `npx prettier --check` on changed files; `npx tsc --noEmit -p .` filtered to your files clean.

## Report

Write `plans/REPORT-perf-C-w1.md`: changed files, what you verified for D4, tests with results, payload bytes on one
entry save before/after (measure in test (a) with the fake emitter), open questions, Noticed-not-done.

## Rules (verbatim)

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should need no sdk:build.)
- Never pipe vitest into `head`. Inside `db.transaction(async (tx) => …)` use only `tx`.
- No new user-facing name, event, setting or migration; if a step seems to need one, stop and write the question in your report.
