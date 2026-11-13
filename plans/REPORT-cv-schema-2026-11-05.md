# REPORT cv-schema (2026-11-05)

Status question: none was relayed. The work is done: schema, migration 0146, int test and the §25 rows. Two test files outside the lane are red and are queued for you below.

## Names and signatures (all 🚧, citing plan §32 §1 / §33)

**Table `characterVersions` / `character_versions`**, placed after `castAmendments` in `src/lib/server/db/schema.ts`.
- Owner and release: `id`, `card_id` (→ characters, cascade) XOR `cast_member_id` (→ lorebook_bindings, cascade), `number`, `label`.
- Parent, place and date: `parent_version_id` (→ itself, SET NULL), `lorebook_id` (cascade), `branch_id` (→ lorebook_branches, cascade), `year`/`month`/`day`, `history_entry_id` (SET NULL), `at_hour`/`at_minute`, `personal_position`.
- Provenance: `source_session_id`, `source_message_id`, `written_by`, `note`, `lifted_from_amendment_id`, `valid_from_message_id` (→ messages, SET NULL).
- Ordering: **`write_order bigint NOT NULL`, no default**, and `retired_order bigint`.
- Profile: `name`, `nickname`, `aliases text[]`, `summary`, `description`, `personality`, `scenario`, `greetings jsonb {text, groupOnly?}[]`, `example_dialogues text[]`, `post_history_instructions`, **`creator_notes jsonb {text, lang?, variants}`**, `strokes jsonb`, `face_media_id` (→ files, SET NULL), `likeness jsonb`, `timbre jsonb`, `sprite_set`, `extensions jsonb`.
- The rest: `node_state`, `node_visibility`, `follows text[]`, `created_at`, `updated_at`.

**CHECKs:**
- `_one_owner_check`
- `_card_version_check`: a card version has a number and no follows, parent, book, line, date, life point, anchor, source or node fields.
- `_cast_version_check`: a cast version has no number, has a book, and has node state and visibility.
- `_follows_parent_check`
- `_anchor_source_check`
- `_undated_base_check`
- `_date_check`

**Indexes:**
- unique `(card_id, number)`
- unique partial base index on `cast_member_id` (no kept-row terms)
- `member_date`
- `book`
- partial indexes on `valid_from_message`, `history_entry`, `branch`, `parent`, `source(session, message)` and `face_media`

**Relations:** `characterVersionsRelations`, with parent and child versions under `relationName: "characterVersionParent"`. `versions: many(characterVersions)` is added on `characters` and `lorebookBindings`.

**Sibling columns:**
- `messages` and `session_messages`: `origin_session_id`, `origin_message_id` (plain ints).
- `sessions`: `branch_ancestry jsonb [{sessionId, mark}]`, with a GIN `jsonb_path_ops` partial index `sessions_branch_ancestry_idx`.
- `sessions`: `line_on_first_write boolean NOT NULL DEFAULT false`.
- `files`: `cast_member_id` (plain int) and `files_cast_member_idx`.
- `session_characters`: `seated_by_user_id` (→ users, SET NULL, no index).

Nothing is dropped. Nothing reads or writes the new columns yet.

## Choices I made (inside scope)
- **`write_order` is NOT NULL with no default.** The wave-1 writer must supply it on every insert. One way: pre-draw the id with `nextval(pg_get_serial_sequence('character_versions','id'))` and insert with both `id` and `write_order`. The "next write order" for a retire mark can come from the same sequence.
- **Notes column is `creator_notes`, not `notes`.** §32's field is `creatorNotes`. A `notes` column would sit beside the provenance column `note` and invite confusion (R1).
- **`aliases` is `text[]`,** like `example_dialogues` and `follows`. The existing tables use json for aliases.
- **CHECKs beyond the plan's list:** card versions carry no parent, book or node fields, and cast versions require a book and node state. A partial index on `face_media_id` serves the SET NULL on file delete.
- **Consequence for wave 1:** `parent_version_id` SET NULL plus `follows_parent_check` means hard-deleting a card is refused while any cast version still follows one of its versions. That matches "resolve `follows` first" (§32 §11), but V-core/V-writers must resolve follows before any card hard delete.

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/db/schema.ts`
- `/home/jody/github/serene-pub/drizzle/0146_character_versions.sql` (generated, not hand-edited)
- `/home/jody/github/serene-pub/drizzle/meta/0146_snapshot.json` (generated)
- `/home/jody/github/serene-pub/drizzle/meta/_journal.json` (generated): idx 146, `when` 1793927326214, which is greater than 0145's 1793900788883.
- `/home/jody/github/serene-pub/src/lib/server/db/characterVersions0146.int.test.ts` (new)
- `/home/jody/github/serene-pub/NOMENCLATURE.md` (§25: 8 rows appended after the s27-S3C rows)
- Worker brief: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-schema-w1.md`

I read the generated SQL whole. It holds only the expected statements: one CREATE TABLE, 8 ADD COLUMNs, 9 FKs, 9 + 1 + 1 indexes. There is no drift on unrelated tables.

## Tests (targeted only)
| File | Result |
|---|---|
| `characterVersions0146.int.test.ts` | 1/1 pass |
| `seatCast0145.int.test.ts` | pass |
| `localModelsKey0144.int.test.ts` | pass |
| `migrationJournal.test.ts` | pass |
| `migrationSet.test.ts` | pass |
| `migrationLedgerRepair.test.ts` | pass |
| `ledgerSplice.int.test.ts` | pass |
| `lorebookConstraints.int.test.ts` | pass |
| `ownNames0143.int.test.ts` | **1/1 fail, not caused by 0146** |
| `src/lib/server/lorebooks/tableRegistry.test.ts` | **fails, expected** (2/3 pass) |

What the new 0146 test covers:
- A 0145-shaped install keeps every row.
- The new table is empty and the new columns hold their defaults.
- 8 refusals: both owners, neither owner, a card version with follows, a card version with no number, a duplicate card number, a second base, follows with no parent, an anchor with no source.
- Accepted inserts: a card version, a cast base, and a parented cast version with follows.
- A second migrate leaves the ledger and row counts unchanged.

The two failures:
- **`ownNames0143.int.test.ts`** compares a `lorebook_bindings` row with `toEqual`. It now sees `overlay_of` and `timbre`, which 0145 added to that table; 0146 doesn't touch it, so this has been red since 0145.
- **`tableRegistry.test.ts`** fails at line 80, `expected [ 'character_versions' ] to deeply equal []`.

Other checks:
- tsc: no errors in `schema.ts` or the new test.
- prettier: `--check` passes on `schema.ts` and the new test. The worker noted prettier toggles an unrelated `provided: jsonb(...)` block near schema.ts:7176 between two layouts; that change is formatting only.
- `NOMENCLATURE.md` was not prettier-clean before my rows, so I didn't reformat it.
- No `/tmp/serene-pub-vitest-*` dirs were left by my runs or the worker's (listings compared), so none were deleted.

## §25 rows added
1. **character version**, with **card version**, **cast version** and **version label**.
2. **character profile**: always qualified; ⚠ not the export, docs or speech-dialect profiles; the Profile tab shows it.
3. **follows**, with ⏳ `followsCard`.
4. **write order**, **write-order mark** and **session cut**, plus `sessions.branch_ancestry`.
5. **retire mark**: "kept row" is recorded as not a word.
6. **origin message**, plus `sessions.line_on_first_write`.
7. **seated by**.
8. **life point**: prose only for personal position.

## Queued for other lanes or the lead (files I don't own)
1. **`src/lib/shared/widgets/messageV1.test.ts:34`**: tsc error TS2322. Its full-row `SelectSessionMessage` fixture now lacks `originSessionId` and `originMessageId`. Fix: add `originSessionId: null, originMessageId: null`. This is the only tsc fallout from the new columns. `arrangeCanvas.dom.test.svelte.ts(11)` is a separate tsc error that predates this lane.
2. **`src/lib/server/lorebooks/tableRegistry.ts`** (V-member, wave 2) must register `character_versions` in `LOREBOOK_TABLES`, because cast versions are the book's content and copy and delete with it. Until then `tableRegistry.test.ts` stays red. A temporary `NOT_THE_BOOKS` line in the test is the alternative, but it would be wrong on substance.
3. **`src/lib/server/db/ownNames0143.int.test.ts`** needs its `before`/`after` comparison to ignore `overlay_of` and `timbre`. This is 0145 fallout.

## Open ★
None new.

## Noticed, not done
- `files.cast_member_id` got no §25 row of its own; it is a column under the existing gallery and provenance words. Say if you want one.
- `follows` is not constrained to `CHARACTER_PROFILE_FIELDS` in SQL. Wave 1 validates it in code.
- I didn't run a scope-reviewer; the guide gives that to whoever accepts the lane.
## Scope review (lead, 2026-11-05 late) — no scope objection; three findings
1. MEDIUM `parent_version_id` SET NULL + `follows_parent_check` turns the plan's backstop into a refusal — a user delete (cards cascade, `characters.user_id`), the attic's `tx.delete(users)`, test teardowns would throw once `follows` is written → **lead: drop `follows_parent_check`**; the writer enforces "follows needs a parent"; a version left with `follows` and no parent (a cascade) reads those fields as empty and is logged; delete paths still resolve `follows` first where they can. 0146 is not applied on any lasting database (no dev server has booted since), so the lead **regenerates 0146** after lane cv-line finishes (its tests run the migrations).
2. LOW refusal tests use bare `.rejects.toThrow()` → name the constraint in each; add refusals for the lane's extra CHECK terms (cast version without a book / node state; card version with a book).
3. LOW the character profile row's ⚠ misses the image-generation and evidence profiles → added by the lead.
