# BRIEF pb — a provided lorebook re-imports when its shipped content changes (owner ruling 2026-11-05, plan §24.10)

You are a `lane-supervisor` (fresh, Opus). Read `.claude/guides/multi-agent.md` first, then this brief, then plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §24 and §19–§20 (provided books, disabled-not-deleted), then `src/lib/server/plugins/providedBooks.ts` header whole (the import key is (plugin, slug, version); same version → nothing; a newer version → a diff under the book's write mode). Lane id **pb**. One worker (Sonnet). Work from `/home/jody/github/serene-pub`. Other programmes edit this tree: re-read a shared file before every edit; additive hunks; never reformat a file dirty at HEAD.

## Ruling
"Re-import when the book's content hash changes" (owner, 2026-11-05). Today a reinstall at the same package version never re-imports a changed book (seen on the M3b walk: the ages the port added tonight never reached an older pub's Porto Alto; a fresh pub got them).

## Items
1. The import key gains the **shipped book's content hash** (`hashCanonicalJson` of the book file as shipped — the helper `providedBooks.ts` already imports): same version + same hash → nothing (as today); same version + a different hash → the **same diff path a newer version takes** (under the book's write mode; entries a person touched keep their edits — the existing row-hash rule); a newer version → as today. Store the hash where the version is kept today (the provided mark / `importedKeyColumns`) — **no migration** if the mark is JSON (check; if a column is needed, stop and name it in the report: a schema change is the owner's ★).
2. The install/boot report line says why a book re-imported (_‹book›: its content changed (same version) — re-imported._).
3. A second boot with nothing changed writes nothing (test).
4. **Tests** (int, 60 s timeouts, beside `plugins/providedBooks.int.test.ts`): same version + changed content → re-imported (a new entry appears; a changed untouched entry updates; a person-edited entry keeps the person's text); same version + same content → no writes; newer version unchanged behaviour; a disabled book stays disabled and is not re-imported.
5. Docs: `docs/plugins.md` one sentence where provided books are described; NOMENCLATURE §25 one row.

## Files owned
`src/lib/server/plugins/providedBooks.ts`, `src/lib/server/plugins/providedMarks.ts` (additive), `src/lib/server/plugins/providedBooks*.test.ts`, `docs/plugins.md`, `NOMENCLATURE.md` (§25 row).
## Out of scope
No SDK edit; no change to who reads provided books; no migration (★ if needed); no change to the disabled-not-deleted rule.
## Rules (quote into the worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; `tx` only inside `db.transaction`; targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
## Done means
The tests above green plus `providedBooks.int`, `providedBooksPubWide.int`, `providedPrimers.int` still green; `tsc` clean on lane files. Report `plans/REPORT-pb-2026-11-05.md`: changed files, where the hash lives, tests, §25 row, open ★, Noticed, not done.
