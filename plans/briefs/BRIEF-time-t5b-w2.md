# BRIEF — worker `time-t5b-w2` — the fold re-keys a session's per-turn records of entry versions

Supervisor: lane `time-t5b` (`plans/briefs/BRIEF-time-t5b.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You do not run `sdk:build` at all. Never `git checkout` / `restore` / `stash`. Never `kill -9`. Another session shares this
checkout: edit only the files below. No migration (stop if one seems needed).

## Background (facts from the code; verify line numbers, they drift)

- **Fold in parent** (`src/lib/server/lorebooks/foldInParent.ts`) copies the parent lorebook P into the session's own book O
  with `copyLorebookTables` (`lorebooks/tableRegistry.ts` ~1137–1155), then moves the session's own rows that named P's rows
  onto the copies (`moveSessionRows`, ~1109). Imprints (per-turn records, `lore_imprints`) are re-keyed there (~1180–1210):
  `entry` and `member` subjects through `maps.entries` / `maps.bindings`, `annex` P→O, `overlay` field paths.
- Lane `time-t5a` added the subject kind **`version`** (`IMPRINT_SUBJECTS`, `lorebooks/imprints.ts` ~57, `SUBJECTS.version`
  ~323): an imprint whose `subject_id` is an `entry_amendments` row (an **entry version**, `base` NULL) and whose
  `lorebook_id` is that row's book. The fold does not re-key them today, so after a fold such a record still names P's
  amendment row and P.
- `copyLorebookTables` copies `entry_amendments` with fresh ids (the `bookScoped(schema.entryAmendments, …)` spec,
  `tableRegistry.ts` ~786–810, one batch insert) and keeps **no** id map (`IdMaps` ~61–75 has none).

## Build

1. `tableRegistry.ts` — **only** this: add `amendments: IdMap` to `IdMaps` (JSDoc one line: source amendment id → copy id,
   filled by the dated-changes copy), initialise it in `copyLorebookTables` (~1144), and make the `entryAmendments` copy fill
   it: insert each copy and take its id back with `.returning({ id: schema.entryAmendments.id })`, keeping each copy paired
   with its source id. Follow the established pattern of the entries copy (~555–575: one insert per row, `returning`,
   `maps.entries.set(id, ins.id)`), so the pairing never depends on the order of a multi-row RETURNING. Nothing else in the
   file changes. If more than the map is needed, stop and report.
2. `foldInParent.ts` — in the imprints loop, a `version` subject goes through `maps.amendments`: `{ subjectId: to,
   lorebookId: c.ownId }` when the map has it (a held amendment, `base` NOT NULL, is never copied, so it has no entry in the
   map and is left as it is). Update the step's doc comment (the "Moved: … imprints (member and entry subjects …" sentence and
   the "Not mappable" sentence) so it states the rule: version subjects are moved to the copy of their amendment.
   Rule from the canon: **inside `db.transaction(async (tx) => …)` use only `tx`**; the outer `db` deadlocks PGlite silently.
3. Test, in `src/lib/server/lorebooks/foldInParent.int.test.ts` (read its fixtures first; add one `test` in a new
   `describe("foldInParent: a per-turn record of an entry version", …)`): a session's `version` imprint on an amendment of
   P's entry (make the amendment and the record the way the file or `lorebooks/imprints.version.int.test.ts` /
   `lorebooks/entryVersions.int.test.ts` do it) names, after the fold, the copied amendment in O (same entry copy, same
   fields, same date), with `lorebook_id` O; and P's own amendment and P are untouched. A second fold is refused as today
   (no need to retest). Give an int test that opens a DB inside a test a 60 s timeout.

## Files owned (edit only these)

`src/lib/server/lorebooks/tableRegistry.ts` (the amendments map only), `src/lib/server/lorebooks/foldInParent.ts`,
`src/lib/server/lorebooks/foldInParent.int.test.ts`.

## Rules

- Comments state the rule, not the story (no lane names, no "previously").
- It is a **session**, never a chat. No other product's name anywhere.

## Done means

Before running a test, check no other vitest is running: `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If one
is, wait and check again (another worker of this lane may be running one); strictly one vitest run at a time. Then, capped:

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/lorebooks/foldInParent.int.test.ts src/lib/server/lorebooks/tableRegistry src/lib/server/lorebooks/imprints.version.int.test.ts > plans/time-t5b-w2-1.log 2>&1"

(run from `/home/jody/github/serene-pub`; if `src/lib/server/lorebooks/tableRegistry` matches no test file, drop it, and
also run any existing test that calls `copyLorebookTables` you find with grep). Never pipe vitest into `head`. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/time-t5b-w2-tsc.log 2>&1` (0 errors in your files;
report others' errors without fixing them). `npx prettier --check` on your three files (report, don't reformat whole files).

## Report

Your final message: changed files, tests with results (log paths), anything you stopped on, **Noticed, not done** (for
example: other per-version rows the fold leaves on P, such as edit-history rows carrying `amendment_id` — report, don't fix).
