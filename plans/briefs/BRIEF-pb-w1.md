# BRIEF pb-w1 — a provided book re-imports when its shipped file changes within the same version

Supervisor: lane **pb** (`plans/briefs/BRIEF-pb.md`). You are a `lane-worker` (Sonnet). Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should need no `sdk:build`: this lane has no SDK edit.)

## Goal (owner ruling 2026-11-05, plan §24.10)
"Provided books re-import when the shipped book's content hash changes, not only on a version change." Today `syncOne` in `src/lib/server/plugins/providedBooks.ts` returns at once when the stored mark's version equals the package version, so a reinstall at the same version never brings a changed book in.

## What to build (decided by the supervisor — do not redesign)
1. **The hash already exists; use it.** The mark (`lorebooks.extra_json.provided`, JSON — no migration) already stores `sha256` = sha256 of the shipped file's raw text, computed in `syncOne` (`createHash("sha256").update(raw)`), and `upgrade()` already compares `mark.sha256 === sha256`. Do NOT add a new field or a second hash, and do NOT switch to `hashCanonicalJson` (that would make every existing book look changed once).
2. In `syncOne`: replace `if (found && found.mark.version === row.version) return` with: at the same version, read the file; if it can't be read (`raw === null`) return silently as today (no new failure state at the same version); compute the sha256; if it equals `found.mark.sha256` return (nothing written — as today); otherwise fall through to the **same** `upgrade(...)` call a newer version takes (same write-mode rule: `full` diffs with the existing row-hash rule — an entry a person edited is kept; `review`/`off` only records `held`). Keep the "older package version → return" line as it is. Keep `withoutUndeclaredTypes` and the refused-entries return as they are.
3. **The report line.** `ProvidedSyncReport` gains `reimported: string[]` (slugs re-imported because their content changed at the same version; add it to `emptyReport`). When a same-version change was actually applied by `upgrade` (it pushed to `report.upgraded`, not `report.held`), push the slug to `report.reimported` and log one line with `console.info`:
   `[plugins] '<pluginId>' provided book <book name>: its content changed (same version) — re-imported.`
   The sentence after the colon is the owner-facing copy: exactly _‹book›: its content changed (same version) — re-imported._ where ‹book› is `found.book.name`. Nothing else in the log or report changes.
4. Update the file's header comment block (`## Key and verbs`): the key is (plugin, slug, version, the file's sha256); "same version → nothing" becomes "same version and same file → nothing; same version and a changed file → the same diff a newer version takes". Additive wording, keep the rest.
5. **Disabled books:** the M2e ruling (owner 2026-11-04, ★34) is _"upgrades still land while disabled"_. `upgrade()` already keeps `disabled` in the mark (`...mark`). Do not change that. Your test asserts: the book stays disabled, no second book row is made, and the change lands (per ★34).

## Tests — add one `describe` block at the END of `src/lib/server/plugins/providedBooks.int.test.ts`
Reuse that file's helpers (`seedPlugin`, `putFile`, `grant`, `bump`, `provided`, `entriesOf`, `entry`, `bookFile`, `V1`, `V2`). Rewriting the file at the **same** version: `await putFile(pluginId, "0.1.0", V2(...))` (no `bump`). Every `test(...)` takes a `60_000` timeout (the DB is opened in the file's `beforeAll`; keep that). Tests:
- **same version + changed content → re-imported** (book's lore write mode is Full — check how the existing "a version bump under Full" test at ~line 475 sets it up and do the same): a new upstream entry appears (Troll); an untouched entry whose content changed updates (Dragon → "v2 dragon"); an entry the person edited keeps the person's text (edit Elf's row content directly in the DB first, as the existing Full test does); `report.reimported` equals `["world"]`; `report.upgraded` contains "world"; the mark's `version` is still "0.1.0" and its `sha256` changed; `console.info` was called with the exact sentence (spy with `vi.spyOn(console, "info")`, restore after).
- **same version + same content → no writes**: sync twice with nothing changed; between the two, snapshot the book row (`extraJson`, `updatedAt` if the column exists), every entry row, and the plugin row's `provided`; after the second sync all are deep-equal, and the report's `imported`, `upgraded`, `held`, `reimported` are empty. Also do this right after a re-import (a second sync after the re-import writes nothing) — this is the "second boot changes nothing" check.
- **newer version unchanged behaviour**: a `bump` to "0.2.0" with V2 → `upgraded` = ["world"], `reimported` = [] (the existing Full test already covers the diff; just assert the reason list stays empty).
- **disabled book**: import, disable it with `setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)` (exported from `./providedBooks`; check its signature), rewrite the file at the same version, sync → still exactly one provided book row for the plugin, its mark still `disabled: true`, and the changed untouched entry landed.
- **Review/Off at the same version** (one test): with the book's write mode on Review, a changed file at the same version writes no entry and records `held` once; a second sync writes nothing more (book row deep-equal).

## Files owned (edit only these)
- `src/lib/server/plugins/providedBooks.ts`
- `src/lib/server/plugins/providedBooks.int.test.ts` (append only)
Both are dirty at HEAD and other programmes edit this tree: re-read the exact region immediately before each edit, make additive hunks, never reformat the file, never run prettier `--write` on it.

## Files readable
Anything. Especially `src/lib/server/plugins/providedMarks.ts` (the mark type; do not edit), `src/lib/server/plugins/providedPrimers.ts` (primers already compare content hash first — the same pattern; do not edit).

## Out of scope — never built
No SDK edit; no migration or schema change; no new mark field; no change to who reads provided books, to the disabled rule, to `providedBooksOf` (the plugin page's why-text) or to `providedPrimers.ts`; no docs or NOMENCLATURE edits (the supervisor does those). Findings go under **Noticed, not done**.

## Rules you work under (quoted)
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for." · "Say each assumption when you make it."
- CLAUDE.md P1: "Deterministic, never hidden. … every automatic action shows its cause" (hence the log line with the reason).
- CLAUDE.md standing ruling: "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." (No new stored shape here — the second-sync test is that test.)
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Hard rule: "Migrations are generated … Never seed a row at a hardcoded id." (Use the ids the inserts return.)
- NOMENCLATURE R1 "one word, one meaning" / R3 "qualify, never the bare noun": §5 already uses **content hash** for a declaration's fingerprint — in code comments call this one "the file's sha256", not "content hash".
- Tests: run only the targeted files. "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Done means
Run, each on its own, without piping into `head`:
- `npx vitest run src/lib/server/plugins/providedBooks.int.test.ts`
- `npx vitest run src/lib/server/plugins/providedBooksPubWide.int.test.ts`
- `npx vitest run src/lib/server/plugins/providedPrimers.int.test.ts`
All green. Then `npx tsc --noEmit -p . 2>&1 | grep -E "plugins/providedBooks"` shows nothing. Afterwards remove any `/tmp/serene-pub-vitest-*` dir your runs left, by exact name only (list before and after to know which are yours).

## Report
Write to `plans/REPORT-pb-w1-2026-11-05.md`: changed files with the hunks' line ranges, each assumption made, tests run with pass/fail counts, Noticed-not-done.
