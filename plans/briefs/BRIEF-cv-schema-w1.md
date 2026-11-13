# BRIEF cv-schema-w1 — the `character_versions` table, its sibling columns, the one generated migration, and its int test

Worker (Sonnet) for lane **cv-schema** (supervisor: Opus). App `/home/jody/github/serene-pub`. No other lane runs. No dev server is running (check `pgrep -af "vite dev"` anyway before generating; if one runs from this repo, stop and report).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

(You will not need `sdk:build` at all; nothing here touches the SDK.)

## Goal
Add the schema for **character versions** (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §32 §1, as changed by §33 — §33 wins) and generate ONE migration (`0146_…`). Nothing reads or writes the new columns yet; that is wave 1. Add one migration int test.

## Files owned (edit only these)
- `src/lib/server/db/schema.ts`
- `drizzle/0146_*.sql`, `drizzle/meta/0146_snapshot.json`, `drizzle/meta/_journal.json` — **generated only**
- NEW `src/lib/server/db/characterVersions0146.int.test.ts`

Readable: anything. Do **not** edit `NOMENCLATURE.md` (the supervisor writes the §25 rows), `tableRegistry.ts`/`tableRegistry.test.ts`, or any other file.

## Rules you must follow (quoted from CLAUDE.md and the lane contract)
- "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*. Never seed a row at a hardcoded id. `0000`–`0093` are 0.5.3's and byte-identical forever."
- Generate against a scratch data dir, never the owner's: `SERENE_PUB_DATA_DIR=<scratch>/gen-data npx drizzle-kit generate --config ./src/lib/server/db/drizzle.config.ts --name character_versions` (use `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-schema-gen-data` as `<scratch>/gen-data`). Run from the app root.
- "never hand-edit a generated file except a data-free CHECK the generator can't express (say so)". Every CHECK below is expressible with drizzle's `check()`; do not hand-edit.
- The index must be **0146** and the journal entry's `when` must be **greater than 1793900788883** (0145's). Confirm both in your report. If `when` is not greater, stop and report; do not edit it.
- Read the generated SQL whole. It must contain **only** the changes below (one CREATE TABLE, its FKs/indexes/CHECKs, the ADD COLUMNs, the new indexes). Any other statement (snapshot drift on unrelated tables) → stop and report it verbatim; do not delete it yourself.
- "Never add a top-level `await` to `src/lib/server/db/index.ts`." (you have no reason to touch it.)
- `schema.ts` imports stay **relative** (drizzle-kit's CJS loader cannot resolve `$lib`); see the comment at schema.ts:1-5. Type-only imports from `../../shared/...` or `@serene-pub/sdk` are fine (both already used).
- Every session has a lorebook — never write "no book" / "no lorebook" in a comment.
- It is a **session**, never a *chat*.
- Doc comments carry the 🚧 mark (provisional vocabulary, NOMENCLATURE R6) and cite "plan §32 §1" / "§33.n". Keep comments short and factual; do not invent behaviour beyond what this brief states.
- Targeted tests only. "never pipe vitest into `head`" (SIGPIPE leaks PGlite temp dirs). An int test that opens a DB inside an `it` needs a **60 s timeout** (`it(..., 60_000)`).
- Run vitest as `npx vitest run <file> …` from the app root.

## 1. The table `characterVersions` / `character_versions`
Place it directly after `castAmendments` (schema.ts ~9106–9200). Model the code style on `castAmendments` and `spriteSets` (schema.ts:2056-2091). Use `jsonb` for every JSON column. A lead doc comment: 🚧 a **character version** — one complete 🚧 character profile at a point; it belongs to a card (a **card version**, an authored release: `number` + `label`) or to a cast member (a **cast version**: its evolution along a book line); a reading picks one row (`versionInForce`, wave 1). Cite plan §32 §1 / §33.

Columns (camelCase TS key → snake_case column):

| key | column | type / FK |
|---|---|---|
| `id` | `id` | `integer().primaryKey().generatedByDefaultAsIdentity()` |
| `cardId` | `card_id` | integer → `characters.id`, `onDelete: "cascade"` |
| `castMemberId` | `cast_member_id` | integer → `lorebookBindings.id`, `onDelete: "cascade"` |
| `number` | `number` | integer (card versions only; unique per card; the current card version is the highest) |
| `label` | `label` | text (the **version label**, e.g. "1.1"; takes over `characters.character_version`) |
| `parentVersionId` | `parent_version_id` | integer → `characterVersions.id` (self; `(): AnyPgColumn => characterVersions.id`), `onDelete: "set null"`. A cast version's parent card version; null = card-less |
| `lorebookId` | `lorebook_id` | integer → `lorebooks.id`, `onDelete: "cascade"` (copied from the member) |
| `branchId` | `branch_id` | integer → `lorebookBranches.id`, `onDelete: "cascade"`; null = main |
| `year` / `month` / `day` | same | integer (day grain; null year = undated) |
| `historyEntryId` | `history_entry_id` | integer → `lorebookEntries.id`, `onDelete: "set null"` |
| `atHour` / `atMinute` | `at_hour` / `at_minute` | integer (session clock at the write; only the coalescing key reads them) |
| `personalPosition` | `personal_position` | integer (the life point; null = applies to every appearance) |
| `sourceSessionId` | `source_session_id` | integer, plain (no FK) |
| `sourceMessageId` | `source_message_id` | integer, plain |
| `writtenBy` | `written_by` | text (`user:<id>` · `run:<id>` · `script:<id>` · `plugin:<id>` · `lift`) |
| `note` | `note` | text |
| `liftedFromAmendmentId` | `lifted_from_amendment_id` | integer, plain |
| `validFromMessageId` | `valid_from_message_id` | integer → `messages.id`, `onDelete: "set null"` (the turn tie Back uses) |
| `writeOrder` | `write_order` | `bigint("write_order", { mode: "number" }).notNull()` — **no default**; the wave-1 writer sets it (from the id on insert; a copy inherits its source's) |
| `retiredOrder` | `retired_order` | `bigint("retired_order", { mode: "number" })`, nullable (§33.2 the **retire mark**; null = not retired) |
| — profile — | | |
| `name` | `name` | text (nullable: a followed field holds no own value) |
| `nickname` | `nickname` | text |
| `aliases` | `aliases` | `text("aliases").array().notNull().default(sql\`'{}'::text[]\`)` |
| `summary` | `summary` | text |
| `description` / `personality` / `scenario` | same | text |
| `greetings` | `greetings` | `jsonb().notNull().default([]).$type<{ text: string; groupOnly?: boolean }[]>()` (merged opener + alternates + group-only; empty greetings kept) |
| `exampleDialogues` | `example_dialogues` | `text("example_dialogues").array().notNull().default(sql\`'{}'::text[]\`)` |
| `postHistoryInstructions` | `post_history_instructions` | text |
| `creatorNotes` | `creator_notes` | `jsonb().$type<{ text: string; lang?: string; variants: Record<string, string> } \| null>()` (named `creator_notes`, not `notes`, so it never reads as the provenance `note`) |
| `strokes` | `strokes` | `jsonb().notNull().default([]).$type<Stroke[]>()` (`Stroke` is already imported from `@serene-pub/sdk`) |
| `faceMediaId` | `face_media_id` | integer → `files.id`, `onDelete: "set null"` |
| `likeness` | `likeness` | `jsonb().$type<CharacterLikenessInput \| null>()` — add `import type { CharacterLikenessInput } from "../../shared/characters/likeness"` next to the timbre import |
| `timbre` | `timbre` | `jsonb().$type<CharacterTimbreInput \| null>()` |
| `spriteSet` | `sprite_set` | text (a sprite set's name; null = the default set) |
| `extensions` | `extensions` | `jsonb().notNull().default({}).$type<Record<string, unknown>>()` |
| `nodeState` | `node_state` | `text().$type<NodeState>()` nullable (cast versions only) |
| `nodeVisibility` | `node_visibility` | `text().$type<NodeVisibility>()` nullable (cast versions only) |
| `follows` | `follows` | `text("follows").array().notNull().default(sql\`'{}'::text[]\`)` — the profile fields this version reads from its parent card version |
| `createdAt` | `created_at` | `timestamp().notNull().defaultNow()` |
| `updatedAt` | `updated_at` | `timestamp().notNull().defaultNow().$onUpdate(() => new Date())` |

Check that `NodeState` / `NodeVisibility` are the types `lorebookBindings.nodeState` uses (schema.ts ~1576) and reuse them.

### CHECKs (drizzle `check()`, names exactly as given)
1. `character_versions_one_owner_check`: `(card_id IS NULL) <> (cast_member_id IS NULL)` (precedent `sprite_sets_one_owner_check`).
2. `character_versions_card_version_check` — a card version has a number, follows nothing, and no parent, book, line, date, life point, anchor, source or node fields:
   `card_id IS NULL OR (number IS NOT NULL AND cardinality(follows) = 0 AND parent_version_id IS NULL AND lorebook_id IS NULL AND branch_id IS NULL AND year IS NULL AND history_entry_id IS NULL AND at_hour IS NULL AND personal_position IS NULL AND source_session_id IS NULL AND source_message_id IS NULL AND valid_from_message_id IS NULL AND node_state IS NULL AND node_visibility IS NULL)`
3. `character_versions_cast_version_check` — a cast version has no number, has its book, and carries node state and visibility:
   `cast_member_id IS NULL OR (number IS NULL AND lorebook_id IS NOT NULL AND node_state IS NOT NULL AND node_visibility IS NOT NULL)`
4. `character_versions_follows_parent_check`: `parent_version_id IS NOT NULL OR cardinality(follows) = 0` (no parent → follows nothing).
5. `character_versions_anchor_source_check`: `valid_from_message_id IS NULL OR source_session_id IS NOT NULL`.
6. `character_versions_undated_base_check` — an undated authored cast version can only be on main with no life point (that makes it the base):
   `cast_member_id IS NULL OR year IS NOT NULL OR source_session_id IS NOT NULL OR (branch_id IS NULL AND personal_position IS NULL)`
7. `character_versions_date_check`: `(month IS NOT NULL OR day IS NULL) AND (year IS NOT NULL OR month IS NULL)` (precedent `cast_amendments_date_check`).

Write them with `${t.col}` interpolation as the existing checks do.

### Indexes
- `uniqueIndex("character_versions_card_number_idx").on(t.cardId, t.number)`
- `uniqueIndex("character_versions_base_idx").on(t.castMemberId).where(sql\`card_id IS NULL AND branch_id IS NULL AND year IS NULL AND personal_position IS NULL AND source_session_id IS NULL\`)` (with `${t.…}` interpolation) — at most one base per member. No kept-row terms (kept rows are cut, §33.2).
- `index("character_versions_member_date_idx").on(t.castMemberId, t.branchId, t.year, t.month, t.day)`
- `index("character_versions_book_idx").on(t.lorebookId)`
- partial (`.where(… IS NOT NULL)`) indexes: `character_versions_valid_from_message_idx` (valid_from_message_id), `character_versions_history_entry_idx` (history_entry_id), `character_versions_branch_idx` (branch_id), `character_versions_parent_idx` (parent_version_id), `character_versions_source_idx` (source_session_id, source_message_id, partial on source_session_id IS NOT NULL), `character_versions_face_media_idx` (face_media_id).

### Relations
`characterVersionsRelations`: `card` → characters, `castMember` → lorebookBindings, `parentVersion` → characterVersions (with `relationName: "characterVersionParent"`) and `childVersions: many(characterVersions, { relationName: "characterVersionParent" })`, `lorebook`, `branch` → lorebookBranches, `historyEntry` → lorebookEntries, `validFromMessage` → messages, `faceMedia` → files. Add `versions: many(characterVersions)` to `charactersRelations` and to the `lorebookBindings` relations block (find it with `grep -n "lorebookBindingsRelations" schema.ts`). If drizzle complains about ambiguity for any of these, add a `relationName` and say so.

## 2. Sibling columns in the same migration
- `messages` and `sessionMessages`: `originSessionId: integer("origin_session_id")`, `originMessageId: integer("origin_message_id")`, plain ints, nullable. Comment: 🚧 the session and message where a branch's copied line was first played (the root play); null on a line played here. §32 §1.
- `sessions`, next to `branchOfSessionId`:
  - `branchAncestry: jsonb("branch_ancestry").$type<{ sessionId: number; mark: number }[] | null>()` — 🚧 nearest ancestor first; `mark` is the write-order mark taken at the fork; null = not a branch, or a branch made before S4. §32 §5b, §33.2.
  - `lineOnFirstWrite: boolean("line_on_first_write").notNull().default(false)` — 🚧 the branch still rides its parent's line and forks its own at its first book write. §32 §5a.
  - index: `index("sessions_branch_ancestry_idx").using("gin", table.branchAncestry.op("jsonb_path_ops")).where(sql\`${table.branchAncestry} IS NOT NULL\`)` — "which sessions have ancestor X" (`branch_ancestry @> '[{"sessionId": X}]'`). §33.2.
- `files`: `castMemberId: integer("cast_member_id")`, plain int, no FK (the provenance columns are plain by ruling — see the comment above `userId` in `files`), placed after `lorebookId`; comment: 🚧 a cast member's gallery file. Index `index("files_cast_member_idx").on(t.castMemberId)` beside `files_character_idx`.
- `sessionCharacters`: `seatedByUserId: integer("seated_by_user_id").references(() => users.id, { onDelete: "set null" })`, after `castMemberId`. Comment: 🚧 who seated this character seat — acting rights (sending as, firing turns, hand edits) follow the seater (owner 2026-11-05: "The person who seated it"); written only by `sessions/seats.ts`; filled for existing seats by the boot pass from the held card's owner (wave 1). §33.4. No index.

Drop nothing. Change no existing column.

## 3. Generate
After `npx tsc --noEmit -p .` is clean on schema.ts (run it; report only errors in your files), generate as in the rules above. Then confirm: file `drizzle/0146_character_versions.sql` exists; journal idx 146; `when` > 1793900788883; the SQL holds only the expected statements. Run `npx prettier --check src/lib/server/db/schema.ts` (and `--write` it if needed; never on the generated files).

## 4. The migration int test — `src/lib/server/db/characterVersions0146.int.test.ts`
Model it on `src/lib/server/db/seatCast0145.int.test.ts` (read it whole first; reuse `migrationsFolderThrough`, `rawRows`, PGlite, the `disposers` pattern, the 60 s timeout). One `describe("0146: character versions schema")`:
- Migrate a fresh PGlite through `0145_seat_cast_members`, insert a 0.6-shaped install (the seeded user, two characters, a lorebook, a cast member binding of one card, a session with a seat, a message, a session_message, a file), then migrate the real folder.
- Assert: every pre-existing row survives; `character_versions` exists and is empty; the new columns exist with their defaults (`sessions.line_on_first_write` false, `branch_ancestry` null, `origin_*` null, `files.cast_member_id` null, `session_characters.seated_by_user_id` null).
- Assert the CHECKs: a card version (card_id, number 1, write_order 1) inserts; a row with **both** `card_id` and `cast_member_id` is refused; a row with neither is refused; a card version with `follows = '{name}'` is refused; a card version without a number is refused; a duplicate (card_id, number) is refused; a cast version (cast_member_id, lorebook_id, node_state 'active', node_visibility 'normal', write_order 2) inserts; a second undated authored base for the same member is refused; a cast version with `follows` but no parent is refused; a cast version with a parent card version and `follows = '{name,description}'` inserts; an anchored cast version (`valid_from_message_id` set) without `source_session_id` is refused.
- Assert a second `migrate` on the real folder changes nothing (row counts equal).
- Use `expect(...).rejects.toThrow()` for refusals; never parse the error text.
- Do not seed any row at a hardcoded id: read ids back with `RETURNING id` or a SELECT.

## 5. Tests to run (targeted only), and report results for each
`npx vitest run src/lib/server/db/characterVersions0146.int.test.ts src/lib/server/db/seatCast0145.int.test.ts src/lib/server/db/ownNames0143.int.test.ts src/lib/server/db/localModelsKey0144.int.test.ts src/lib/server/db/migrationJournal.test.ts src/lib/server/db/migrationSet.test.ts src/lib/server/db/migrationLedgerRepair.test.ts src/lib/server/db/ledgerSplice.int.test.ts src/lib/server/db/lorebookConstraints.int.test.ts`

Then, separately: `npx vitest run src/lib/server/lorebooks/tableRegistry.test.ts` — it is **expected to fail** on `character_versions` (a new table pointing at a book that is neither registered nor named). Do not fix it (not your file); paste the failing assertion in your report.

Afterwards list `ls -d /tmp/serene-pub-vitest-*` and delete only dirs your runs made, by name (compare against a listing you take before your first run).

## Stop and ask (report, don't decide)
Any new name beyond those in this brief; any generated statement you didn't expect; a `when` not above 0145's; a CHECK the generator mangles; anything outside the owned files.

## Done means
tsc clean on schema.ts; migration 0146 generated and inspected; the 9 targeted test files green; tableRegistry's expected failure recorded.

## Report
Your final message: changed files; the generated SQL file name, idx and `when`; any surprise in the generated SQL; each test file with pass/fail counts; the tableRegistry failure text; the `/tmp` dirs you deleted; Noticed, not done.
