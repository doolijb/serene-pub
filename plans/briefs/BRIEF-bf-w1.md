# BRIEF bf-w1 — the SDK lorebook-file validator learns a book's rules; guide, docs and ledger

Lane **bf**, worker 1. Report: your final message to the supervisor (changed files, tests run with counts, Noticed-not-done).

## Goal
Owner ruling ★M3b-S5-1 (2026-11-05): **"In the book file, beside the story clock."** A Serene Pub lorebook file names the book's rules in `extensions.serenepub`, beside `storyTime`:
- `primaryRuleset` — the book's ruleset id (e.g. `core:ruleset/vis-itineris@1`, `mundi:ruleset/life`); the same name as the `lorebooks.primary_ruleset` column (R1).
- `rulesetVersion` — optional; the semver the book is pinned to (`lorebooks.ruleset_version`).
Both are 🚧. A Freeform book writes neither (old files stay valid both ways). The app's importer (worker w2) reads them; your job is the SDK validator, its test, the plugin-author guide, two user docs and the NOMENCLATURE ledger row.

## Files owned (edit only these)
1. `/home/jody/github/serene-pub-sdk/sdk/src/lorebookFile.ts`
2. `/home/jody/github/serene-pub-sdk/sdk-tests/lorebookFile.test.ts`
3. `/home/jody/github/serene-pub-sdk/guides/your-first-plugin.md` — section **"Ship lore with your plugin"** only
4. `/home/jody/github/serene-pub/docs/lorebooks.md` — section **"Creating, importing, duplicating and deleting"** only
5. `/home/jody/github/serene-pub/docs/plugins.md` — one sentence in the provided-lorebooks paragraph (line ~54) only
6. `/home/jody/github/serene-pub/NOMENCLATURE.md` — one new row appended at the END of the §25 Change ledger table only (the table that ends just before the `⚠ **What the layering build left in the interface copy**` paragraph, ~line 3221). Re-read that spot right before editing; another lane may have appended a row — append after the last row.

## Files readable
`/home/jody/github/serene-pub-sdk/sdk/src/extension.ts` (~771: the SDK's semver test `/^\d+\.\d+\.\d+/`), `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.ts` (`readLorebookImport` ~2509 runs `lorebookFileFindings` first and refuses the file with the first sentence).

## Work
### 1. `lorebookFile.ts`
In `lorebookFileFindings`, after the existing `serenepub` checks (it already resolves `serenepub` from `data.extensions.serenepub` or `data.data.character_book.extensions.serenepub`), add the rules check when `serenepub` is an object:
- `primaryRuleset` present (not `undefined`/`null`) and not a non-empty string, or longer than `L.maxNameChars` → a sentence, e.g. ``This lorebook's primaryRuleset must be a ruleset id, such as 'core:ruleset/freeform@1'.``
- `rulesetVersion` present (not `undefined`/`null`) and not a string matching `/^\d+\.\d+\.\d+/` → ``This lorebook's rulesetVersion '<v>' isn't a version like 1.2.0.`` (show the value only when it's a short string; otherwise omit it).
- `rulesetVersion` present without a `primaryRuleset` → ``This lorebook names a rulesetVersion but no primaryRuleset.``
Add to the file's top doc comment (additive lines) one short paragraph: the file-level fields it also checks are a book's **rules** — `extensions.serenepub.primaryRuleset` (+ optional `rulesetVersion`), the book's own ruleset beside `storyTime` (ruling ★M3b-S5-1, 2026-11-05). Say what it is not: not a session's ruleset and not a lock — a session started on the book adopts it, and a Freeform book brings none; an id this pub doesn't have is the importer's business (it imports the book on Freeform with a warning), not the validator's. No new export, no new type.

### 2. `sdk-tests/lorebookFile.test.ts`
Add one `test(...)` inside the existing `describe`: accepts a book with `extensions: { serenepub: { primaryRuleset: 'core:ruleset/vis-itineris@1' } }`, with `rulesetVersion: '1.2.0'` too, and with an id this pub may not have (`'acme:ruleset/none'` — shape only); refuses `primaryRuleset: 3`, `primaryRuleset: ''`, `rulesetVersion: 'one'`, `rulesetVersion: '1.2.0'` without `primaryRuleset`; and the same check under a card's `data.character_book.extensions.serenepub`. Assert with `assert.match` on the sentences.

### 3. Build and test the SDK
- Before building: `pgrep -af "vite dev"` (a serene-pub server → don't build; report 'blocked on your dev server') **and** `pgrep -af vitest` — if any vitest runs in `/home/jody/github/serene-pub` (another lane or your sibling worker), wait (poll every minute, up to ~20 min) and build only when none runs; say how long you waited.
- Build: `cd /home/jody/github/serene-pub && npm run sdk:build`.
- Then: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test lorebookFile.test.ts` — must pass.
- Do NOT run the full sdk-tests suite; the supervisor will.

### 4. Guide (`your-first-plugin.md`, "Ship lore with your plugin")
After the paragraph that starts "Nothing of yours runs to do this.", add one short paragraph:
> A book plays the rules its file names: `extensions.serenepub.primaryRuleset` (and, to pin a version, `rulesetVersion`), beside `storyTime`. Name your own ruleset there, such as `acme.world:ruleset/harbor`, and the book arrives on it. A pub that doesn't have that ruleset imports the book on Freeform and says so. Leave the field out for a Freeform book.
(Check the guide's existing id spelling for a plugin ruleset in `guides/rulesets.md` — use whatever example shape it uses; if it differs from `acme.world:ruleset/harbor`, use its shape with the `acme.world` slug.)

### 5. `docs/lorebooks.md` ("Creating, importing, duplicating and deleting")
After the bullet that begins "- Importing a book you already have is detected", add a bullet:
> - A lorebook file from Serene Pub names the book's rules. The imported book plays them when this pub has them; when it doesn't, the book comes in on Freeform and the import says which rules were missing. Overwriting a book gives it the file's rules; a file that names none leaves them as they were.
And in the paragraph that begins "**Export** is paused", change nothing else.

### 6. `docs/plugins.md`
In the paragraph beginning "A package can also ship **lorebooks**.", after its first sentence, insert:
> A provided book comes in on the rules its file names when this pub has them, and on Freeform when it doesn't.

### 7. `NOMENCLATURE.md` §25 row (append as the table's last row, one line, same `| … | … | … |` three-column shape as its neighbours)
`| _(nothing)_ — a lorebook file named no rules: every exported book on rules other than Freeform came back Freeform (★M3b-S5-1) | 🚧 the lorebook file's **rules** — `extensions.serenepub.primaryRuleset` and optional `rulesetVersion` (beside `storyTime`; the `lorebooks.primary_ruleset` / `ruleset_version` column names, R1), checked by SDK `lorebookFileFindings` (an id string; a semver), written by the exporter only for a book not on Freeform (`BOOK_DEFAULT_RULES`), read by the importer's `importedBookRules` (`sockets/lorebooks.ts`) with `lorebooks:create`'s check (`chosenBookRules`): rules this pub lacks → the book on Freeform and the warning _‹book› plays ‹id›, which this pub doesn't have — imported on Freeform._; a version it never kept (`keptRulesetDocument`) → no pin and _‹book› was made with version ‹v› of ‹id›, which this pub doesn't keep — it plays the installed version._ **Charter:** purpose, a book file carries the rules its world is told by; why, an export→import lost them; owns, the two file keys and their reading; not, a session's ruleset (a session adopts the book's at start; a Freeform book brings none, fix7) and not a lock. | owner ruling ★M3b-S5-1, 2026-11-05 ("In the book file, beside the story clock"); lane bf. No migration (the columns exist); the file stays format 2. |`

## Out of scope
Any app `src/` file; `providedBooks.ts`; any other guide or doc section; no new SDK export; no format-version bump.

## Stop and ask when
CLAUDE.md §Decisions applies, a name not given here is needed, or an instruction above conflicts with what you find (e.g. the guide section moved).

## Done means
`lorebookFile.test.ts` green after `sdk:build`; `npx prettier --check` on the two SDK `.ts` files shows no NEW issue compared with what the file had (don't fix pre-existing ones); the doc/ledger edits are additive hunks. Report: changed files, tests and counts, how long you waited for the build, Noticed-not-done.
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
