# BRIEF cv-schema — wave 0: the tables and the one migration

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-cv-common.md` first. Lane id **cv-schema**. One worker (Sonnet). App `/home/jody/github/serene-pub`. No other lane runs.

## Items (plan §32 §1 + §33)
1. `src/lib/server/db/schema.ts`: table `characterVersions` / `character_versions` with every column in §32 §1 (owner XOR + CHECK, card `number`/`label`, `parent_version_id`, `lorebook_id`, `branch_id`, day-grain `year`/`month`/`day`, `history_entry_id`, `at_hour`/`at_minute`, `personal_position`, provenance `source_session_id`/`source_message_id`/`written_by`/`note`/`lifted_from_amendment_id`, `valid_from_message_id` SET NULL, `write_order bigint`, **`retired_order bigint`** (§33.2; no kept-row columns), the character-profile columns (§33.1 shape: greetings jsonb `{text, groupOnly?}[]`, notes jsonb `{text, lang?, variants}`, example dialogues text[], the rest as §32 §2), `node_state`/`node_visibility`, `follows text[]`), its CHECKs and indexes (§32 §1; base index without kept-row terms), relations. Same migration: `messages`/`session_messages` `origin_session_id`/`origin_message_id`; `sessions.branch_ancestry jsonb` (+ an index fit for "which sessions have ancestor X"); `sessions.line_on_first_write boolean`; `files.cast_member_id`; **`session_characters.seated_by_user_id`** (→ users, SET NULL; §33.4). Drops nothing. Doc comments carry 🚧 marks and cite §32/§33.
2. Generate the migration (common rules); confirm its index exceeds the applied max and the journal `when`; run the migration int tests (`src/lib/server/db/*.int.test.ts` that cover the chain) and add a migration int test (the table and columns exist; the CHECKs refuse a version with both owners / a card version with `follows`).
3. NOMENCLATURE §25 rows: character version, card version, cast version, version label, character profile (always qualified; ⚠ not the export/docs/image profiles; the card view's Profile tab is this), follows, write order, retire mark, session cut, origin message, seated by, life point (prose for `personal_position`).
4. Nothing reads or writes the new columns yet (wave 1). `tsc` clean.

## Files owned
`src/lib/server/db/schema.ts`, `drizzle/**` (the generated migration + meta), the new migration test, `NOMENCLATURE.md` §25.
