# BRIEF bf-w2 — the importer reads a book's rules from its file; the exporter writes them

Lane **bf**, worker 2. Report: your final message to the supervisor (changed files, tests run with counts, Noticed-not-done).

## Goal
Owner ruling ★M3b-S5-1 (2026-11-05): **"In the book file, beside the story clock."** A Serene Pub lorebook file names the book's rules in `extensions.serenepub`, beside `storyTime`: **`primaryRuleset`** (the ruleset id) and optional **`rulesetVersion`** (semver pin) — the same names as the `lorebooks.primary_ruleset` / `ruleset_version` columns (`schema.lorebooks.primaryRuleset` NOT NULL default `core:ruleset/freeform@1`; `rulesetVersion` NULL = no pin, follows the installed version). Today the importer ignores them and the exporter writes none, so every exported non-Freeform book comes back Freeform. Worker w1 is adding the SDK validator check (`lorebookFileFindings`) in parallel — you don't depend on it. Rulesets are stateless: the book names its rules; the ruleset holds nothing. A session started on the book adopts them (fix7: a Freeform book brings none) — **do not touch session code**.

## Files owned (edit only these)
1. `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.ts` — **only** the import helpers and the two import writers named below; additive hunks.
2. `/home/jody/github/serene-pub/src/lib/server/utils/lorebookExportBuilder.ts` — the `extensions.serenepub` block (~440–464) and one import line.
3. NEW `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.bookRulesFile.int.test.ts`.

## Files readable
`src/lib/server/sockets/lorebooks.import-export.int.test.ts` (its `dormantExport` helper, overwrite flow via `lorebookImportHandler` → conflict → `lorebookImportResolveHandler`), `src/lib/server/sockets/lorebooks.bookSettings.int.test.ts` (setup, `VIS = "core:ruleset/vis-itineris@1"` is registered in tests), `src/lib/server/plugins/providedBooks.ts` + `providedBooks.int.test.ts` (READ ONLY — lane pb owns them), `src/lib/server/rulesets/versions.ts` (`keptRulesetDocument`), `src/lib/shared/rulesets/rulesOffer.ts` (`BOOK_DEFAULT_RULES`).

## Work
### 1. The reader — `lorebooks.ts`
Add, right after `overwrittenStoryTime` (~3772–3779), an exported async helper (name fixed: **`importedBookRules`**):

```ts
/**
 * 🚧 The rules a lorebook file names, as lorebook columns (owner ruling
 * ★M3b-S5-1, 2026-11-05: "In the book file, beside the story clock"):
 * `extensions.serenepub.primaryRuleset` and its optional `rulesetVersion`,
 * checked as `lorebooks:create` checks a book's rules (`chosenBookRules`: a
 * ruleset this pub has). Rules this pub lacks bring the book in on Freeform
 * (`BOOK_DEFAULT_RULES`), said in words; a version it never kept
 * (`keptRulesetDocument`) is dropped, so the book follows the installed
 * version, and said. A file that names none returns no columns: a new book
 * takes the column's default (Freeform), an overwritten one keeps its rules.
 * ⚠ The book's rules, never a session's: a session adopts them at start, and
 * a Freeform book brings none (fix7). Exported for the provided-book update.
 */
export async function importedBookRules(
	dbOrTx: Db,
	serenepub: any,
	bookName: string
): Promise<{ columns: { primaryRuleset?: string; rulesetVersion?: string | null }; warnings: string[] }>
```
Behaviour:
- `serenepub?.primaryRuleset` is `undefined`/`null` (or `serenepub` not an object) → `{ columns: {}, warnings: [] }`.
- Otherwise call the existing `chosenBookRules(raw)` (~587) inside `try`; if it throws → `{ columns: { primaryRuleset: BOOK_DEFAULT_RULES, rulesetVersion: null }, warnings: [\`${bookName} plays ${String(raw)}, which this pub doesn't have — imported on Freeform.\`] }`.
- Known ruleset `id`: `const v = serenepub.rulesetVersion`; if `typeof v === "string" && v` → `await keptRulesetDocument(dbOrTx, id, v)`; kept → `{ primaryRuleset: id, rulesetVersion: v }`; not kept → `{ primaryRuleset: id, rulesetVersion: null }` + warning `` `${bookName} was made with version ${v} of ${id}, which this pub doesn't keep — it plays the installed version.` ``. No version → `{ primaryRuleset: id, rulesetVersion: null }`.
- Import `keptRulesetDocument` statically from `$lib/server/rulesets/versions` (add one import line near the other `$lib/server/rulesets/…` imports; `BOOK_DEFAULT_RULES` is already imported ~145). `Db` is already a type in this file (see `db as unknown as Db` uses).

### 2. The writers — `lorebooks.ts`
- `createLorebookFromParsedCard` (~3934): BEFORE `await db.transaction(...)` (outer handle, outside any transaction), `const rules = await importedBookRules(db as unknown as Db, card.extensions?.serenepub, card.name || "Imported Lorebook")`; spread `...rules.columns` into the `.values({...})` of the insert (after `...importedStoryTime(...)`); return `warnings: [...rules.warnings, ...calendarWarnings, ...warnings]`.
- `overwriteLorebookFromParsedCard` (~4048): the same, spread into its `.set({...})` after `...overwrittenStoryTime(...)`, same warnings order.
- `importLorebookDocument` (~4418) and the provided-book fresh import (`providedBooks.ts` `importFresh` → `importLorebookDocument`) then inherit it — no edit there. Confirm by reading, and say so.

### 3. The exporter — `lorebookExportBuilder.ts`
After the `storyTime` block (~447–462), before `return { name: lorebook.name, specBookWithGraph }`, add: when `lorebook.primaryRuleset && lorebook.primaryRuleset !== BOOK_DEFAULT_RULES`, set `extensions.serenepub.primaryRuleset` and, only when `lorebook.rulesetVersion` is a non-empty string, `rulesetVersion` — with the same spread shape the storyTime block uses (keep `ext.serenepub`'s other keys). Comment (2–3 lines): the book's rules (★M3b-S5-1, 2026-11-05: "In the book file, beside the story clock"); only when not Freeform, so a Freeform book exports the bytes it always did — import compares them to detect unchanged vs conflict. Import `BOOK_DEFAULT_RULES` from `$lib/shared/rulesets/rulesOffer` (a leaf module). The `findFirst` already returns every column.

### 4. Tests — new `lorebooks.bookRulesFile.int.test.ts`
Copy the setup pattern of `lorebooks.bookSettings.int.test.ts` (vi.mock of `$lib/server/db` with `createTestDb`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, temp dir `serene-pub-vitest-bf-book-rules-`, `releaseDataDir` in `afterAll`). If the import queues embeddings/annotations, mock them as `providedBooks.int.test.ts` does. Cases:
1. **Round trip:** a book on `VIS` (insert the row with `primaryRuleset: VIS`), export via `buildLorebookExportData(id, userId)` → the file's `extensions.serenepub.primaryRuleset === VIS` and no `rulesetVersion`; import it (`importLorebookDocument(otherUserId, JSON.stringify(file))`) → the new book's `primaryRuleset === VIS`, `rulesetVersion === null`, no rules warning.
2. **Freeform writes nothing:** a Freeform book's export has no `primaryRuleset` key in `extensions?.serenepub`.
3. **Unknown ruleset:** a file with `extensions.serenepub.primaryRuleset: "core:ruleset/nonesuch@1"` → book on `core:ruleset/freeform@1`, `warnings` contains `‹name› plays core:ruleset/nonesuch@1, which this pub doesn't have — imported on Freeform.` (exact string).
4. **No field:** a plain file → Freeform, no rules warning (as today).
5. **Unknown version:** `VIS` + `rulesetVersion: "9.9.9"` → book on `VIS`, `rulesetVersion` null, the version warning. **Kept version:** make `keptRulesetDocument` find one — either insert a `rulesets` row + `ruleset_versions` row for a test id if the NOT NULL columns make that simple, or `vi.mock("$lib/server/rulesets/versions", importOriginal …)` overriding only `keptRulesetDocument` to return `{}` for `(VIS, "1.2.0")` and defer to the original otherwise; assert the pin `"1.2.0"` lands. Choose the simpler; say which.
6. **Overwrite:** a Freeform book with a uuid; a file of the same uuid naming `VIS` → through `lorebookImportHandler` (conflict) then `lorebookImportResolveHandler` `{ action: "overwrite", existingId, heldImportId }` (mirror the import-export test's flow and socket shape) → the book's `primaryRuleset === VIS`. Then overwrite again with a file naming no rules → still `VIS` (absent leaves them).
7. **Provided book (optional, time-box ~20 min):** if `providedBooks.int.test.ts`'s fixture (plugin row + book file on disk + `syncProvidedBooks`) can be reproduced in YOUR file without editing pb's files, add one test: a provided book file naming `VIS` lands on `VIS`. If it's heavy, skip it and report "inherits through `importLorebookDocument` (code-read)".

Run: `cd /home/jody/github/serene-pub && npx vitest run src/lib/server/sockets/lorebooks.bookRulesFile.int.test.ts` (no `| head`). Also run `npx vitest run src/lib/server/sockets/lorebooks.import-export.int.test.ts` (it must stay green — the export bytes for Freeform books must not move). Then `npx tsc --noEmit -p .` and report only errors in your three files (others are other lanes'). Before each vitest run, `pgrep -af "npm run sdk:build\|tsc -b"` — if an SDK build is running, wait for it to finish.

## Out of scope
Session code, `lorebooks:create` / `lorebooks:update`, `providedBooks.ts` and its tests, the SDK, docs, NOMENCLATURE, any migration, the format version (stays 2), the 0.5-compat profile's separate handling (the field is written for both profiles, as `storyTime` is).

## Stop and ask when
CLAUDE.md §Decisions applies; a name not given here is needed; a line number above is wrong in a way that changes the design (e.g. `chosenBookRules` no longer exists).

## Done means
The new int file green (all cases you wrote), `lorebooks.import-export.int.test.ts` green, `tsc` clean on your three files. Report: changed files, tests with counts, which kept-version approach you took, whether the provided-book test was added, Noticed-not-done.
## Rules you work under (quoted by the lane supervisor; they bind you)

Verbatim, from the lane contract:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

From CLAUDE.md (Hard rules / Decisions) and the lane brief:
- Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted.
- Other lanes edit this tree at the same time (lane **pb** owns `src/lib/server/plugins/providedBooks.ts` — never edit it). Every file you own is already dirty at HEAD: **re-read the exact region immediately before each edit, make additive hunks only, never reformat a file** (no prettier --write, no whole-file rewrites).
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Targeted tests only. **Never pipe vitest into `head`** (SIGPIPE leaks PGlite temp dirs). An int test that opens a DB inside an `it` needs a **60 s** timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Name your test's temp dir `serene-pub-vitest-bf-…` so it is yours.
- Do what is asked at the size asked. Anything else you notice goes under **Noticed, not done** in your report, never fixed in passing. No new option, flag, setting, event, table or migration. A new name not given in this brief → stop and ask in your report.
- NOMENCLATURE R1 one word one meaning; R3 qualify, never the bare noun; R6 mark provisional vocabulary 🚧. The names for this lane are fixed below; do not invent others.
- It is a **session**, never a *chat*.
