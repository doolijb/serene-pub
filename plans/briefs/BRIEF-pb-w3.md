# BRIEF pb-w3 — a provided book's upgrade carries its rules; the import's warnings reach the report

Supervisor: lane **pb** (`plans/briefs/BRIEF-pb.md`, re-scoped by the lead 2026-11-05). You are a `lane-worker` (Sonnet). Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Context
Lane bf landed (2026-11-05): a lorebook file names its rules at `extensions.serenepub.primaryRuleset` (+ optional `extensions.serenepub.rulesetVersion`), and `src/lib/server/sockets/lorebooks.ts` exports `importedBookRules(dbOrTx, serenepub, bookName)` → `{ columns: { primaryRuleset?, rulesetVersion? }, warnings: string[] }` (~3795). `columns` is `{}` when the file names no rules. A fresh provided import already gets the rules (it goes through `importLorebookDocument`). Two gaps in `src/lib/server/plugins/providedBooks.ts`:
1. `upgrade()` (the in-place merge, its `db.transaction` ~1201–1265) never reads the rules, so a changed shipped book never moves an installed book's rules.
2. `importFresh()` drops `importLorebookDocument`'s `warnings` (e.g. _‹book› plays ‹id›, which this pub doesn't have — imported on Freeform._), so they never reach the admin or the log.

## What to build (decided by the supervisor)
### A. Rules on upgrade, the person wins
- `ProvidedBookMark` (`src/lib/server/plugins/providedMarks.ts`) gains optional `rules?: { primaryRuleset: string | null; rulesetVersion: string | null }` = the book's two columns as the last import/upgrade left them. `markedBook()` carries it through when it is an object with those two keys (string-or-null each). Doc comment in the file's voice.
- `importFresh()`: after `importLorebookDocument`, record `rules` from the returned `book`'s `primaryRuleset` / `rulesetVersion` (re-read the row if the returned object lacks them) into the mark it already writes.
- `upgrade()`, under `full` only (the Review/Off branch stays as is: it writes nothing), inside the existing transaction, using only `tx`: call `importedBookRules(tx as unknown as Db, card.extensions?.serenepub, book.name)`.
  - `columns` empty (the file names no rules) → nothing changes (matches bf's ★bf-1 "a file with no field keeps the book's rules").
  - `now` = `{ primaryRuleset: book.primaryRuleset ?? null, rulesetVersion: book.rulesetVersion ?? null }` (read from the `book` row `upgrade` was handed; re-read in `tx` if needed). `target` = `{ primaryRuleset: columns.primaryRuleset ?? now.primaryRuleset, rulesetVersion: columns.rulesetVersion ?? null }`.
  - **baseline recorded** (`mark.rules`): `now` ≠ `mark.rules` → a person changed the book's rules → keep theirs (`report.keptEdited++`), leave `rules` as it was. Else `target` equals `now` → nothing. Else write `target` in the SAME `tx.update(schema.lorebooks).set({...})` that writes `extraJson` (spread the two columns beside `extraJson`), and count it into `written`.
  - **no baseline** (a book imported before this change): `now` is the default — `primaryRuleset` null or `BOOK_DEFAULT_RULES` (`$lib/shared/rulesets/rulesOffer`) and `rulesetVersion` null — → treat as untouched (no provided file could name rules before bf, so a default was never a person's choice) and apply `target`. Otherwise keep the person's (`keptEdited++`).
  - Record `rules` in the mark = the columns as they stand after this step (applied → `target`; kept → leave `mark.rules` unchanged, or absent if it was absent; equal → `now`).
  - The `warnings` from `importedBookRules` go into the report (B).
- Header comment of `providedBooks.ts` (`## Key and verbs`): one additive line that the book's rules are carried the same way.

### B. Warnings reach the report and the log
- `ProvidedSyncReport` gains `warnings: string[]` (add to `emptyReport`).
- `importFresh()` returns (or pushes) `importLorebookDocument`'s `warnings`; `upgrade()` pushes `importedBookRules`'s. For each, `syncOne`'s caller path logs one line with `console.info`: `[plugins] '<pluginId>' provided book <slug>: <warning>` and pushes the warning sentence to `report.warnings`. Nothing on the plugin page (that is copy the owner has not seen — not built).

## Tests — append ONE `describe` at the end of `src/lib/server/plugins/providedBooks.int.test.ts`
Reuse its helpers. Find how bf's test makes a provided book on Vis Itineris through `syncProvidedBooks` (`src/lib/server/sockets/lorebooks.bookRulesFile.int.test.ts`, read only) and use the same registered ruleset id(s) — you need two that this pub registers in tests (e.g. Vis Itineris and Freeform, or another core one; check). Every test `60_000`; `loreWriteMode` `"full"` as the existing Full test sets it.
1. Fresh import of a file naming ruleset R → the book's `primaryRuleset` is R and the mark's `rules` records it.
2. Same-version changed file naming R2 (book untouched) → the book moves to R2, mark `rules` updated, a second sync writes nothing (book row deep-equal).
3. A person set the book's rules to R3 (update the row in the DB) → a changed file naming R2 keeps R3, `keptEdited` ≥ 1.
4. Old book (delete `rules` from the mark after import; set the book's rules to the default first) → a changed file naming R applies R. And with a non-default value and no `rules` mark → kept.
5. A file naming a ruleset this pub doesn't have → fresh import: the book is on Freeform and `report.warnings` holds bf's sentence exactly, and `console.info` logged it (spy, restore).
6. Review: a changed file naming R2 leaves the rules alone.
Keep every existing test as it is.

## Files owned (edit only these)
- `src/lib/server/plugins/providedBooks.ts`
- `src/lib/server/plugins/providedMarks.ts` (additive)
- `src/lib/server/plugins/providedBooks.int.test.ts` (append only)
All are dirty at HEAD; lane pb's earlier workers just edited them. Re-read the exact region immediately before each edit, additive hunks, never reformat, never `prettier --write`.

## Files readable (never edit)
`src/lib/server/sockets/lorebooks.ts` (bf's), `src/lib/server/sockets/lorebooks.bookRulesFile.int.test.ts`, `src/lib/shared/rulesets/rulesOffer.ts`, `src/lib/server/db/schema.ts`.

## Out of scope — never built
No SDK edit; no migration; the plugin page (`providedBooksOf`) text; docs; NOMENCLATURE; the cast/stats code lane pb-w2 just built (don't restructure it); providedPrimers.ts. Findings go under **Noticed, not done**.

## Rules you work under (quoted)
- CLAUDE.md P1: "Deterministic, never hidden … every automatic action shows its cause" (the warnings and the log).
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." · "Say each assumption when you make it."
- Standing ruling: "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." (Test 2's second sync.)
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- NOMENCLATURE R1/R3: the book's **rules** (its ruleset), never "the book's type"; the file's hash is "the file's sha256", never "content hash".
- Tests: targeted files only. "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Done means
Run each on its own, never piped into `head`:
- `npx vitest run src/lib/server/plugins/providedBooks.int.test.ts` — all green except the known pre-existing failure ("M2e: … delete is refused …", ~line 161, `pluginName` — another programme's; leave it).
- `npx vitest run src/lib/server/plugins/providedBooksPubWide.int.test.ts`
- `npx vitest run src/lib/server/plugins/providedPrimers.int.test.ts`
- `npx tsc --noEmit -p . 2>&1 | grep -E "plugins/provided"` shows nothing.
Remove any `/tmp/serene-pub-vitest-*` dir your runs left, by exact name.

## Report
Hand back (the harness may refuse a report file; then your hand-back message is the report): changed files with hunk line ranges, assumptions, the ruleset ids the tests use, tests with counts, Noticed-not-done.
