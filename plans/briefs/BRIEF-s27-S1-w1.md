# BRIEF s27-S1-w1 — the seat-cast schema and its one generated migration

Lane **s27-S1** (supervisor: lane-supervisor). App `/home/jody/github/serene-pub`. Report: your final message (the supervisor reads it).

## Goal
Add the S1 seat-cast columns to `src/lib/server/db/schema.ts`, generate **one** migration with drizzle-kit (expected index **0145**, name `seat_cast_members`), and pin it with one int test. Behaviour unchanged: nothing reads or writes the new columns yet.

## The schema, exactly (additive hunks; the file is dirty at HEAD from other lanes — never reformat it, touch only these tables)
Use the file's existing style (tabs, `AnyPgColumn` for self-references, doc comments on each new column, each marked 🚧 or ⏳ as said).

1. **`lorebookBindings`** (~line 1543):
   - `overlayOf: integer("overlay_of").references((): AnyPgColumn => lorebookBindings.id, { onDelete: "set null" })` — 🚧 doc: *the attached book's member this own-book row holds a session's writes about (plan §27 A); null on every other row. ⚠ Not `lorebooks.overlay_of` (the own BOOK's attached book): the same relation one level down, member to member.* Add `index("lorebook_bindings_overlay_of_idx").on(t.overlayOf)` (partial `.where(sql\`… IS NOT NULL\`)` is fine, match the file's pattern for FK-target indexes).
   - `timbre: json("timbre").$type<…>()` nullable — 🚧 doc: *the member's own timbre, the same shape as a card's `characters.extensions.serenepub.timbre` (`CharacterTimbreInput`, `$lib/shared/characters/timbre`), read over its card's; null = the card's reads through. Members carry voice, own over card (owner 2026-11-05). Readers come in S2.* Type it with `CharacterTimbreInput | null` via a relative `import type` (the file imports shared types relatively, e.g. `../../shared/lorebooks/retold`); if that import would create a cycle, use `Record<string, unknown> | null` and say so.
2. **`spriteSets`** (~line 2031): a set belongs to a card **or** to a cast member.
   - `characterId` loses `.notNull()` (keeps the FK, cascade).
   - `castMemberId: integer("cast_member_id").references(() => lorebookBindings.id, { onDelete: "cascade" })` — 🚧 doc: *a cast member's own set (members carry sprites, own over card, owner 2026-11-05); exactly one of `character_id` / `cast_member_id` is set.*
   - `check("sprite_sets_one_owner_check", sql\`(${t.characterId} IS NULL) <> (${t.castMemberId} IS NULL)\`)`.
   - `uniqueIndex("sprite_sets_cast_member_name_idx").on(t.castMemberId, t.name)` and `uniqueIndex("sprite_sets_cast_member_one_default_idx").on(t.castMemberId).where(sql\`${t.isDefault}\`)`. Update the table's doc comment by one sentence (who may own a set).
   - Add a `castMember: one(lorebookBindings, …)` relation to `spriteSetsRelations` only if it compiles cleanly; otherwise skip it and say so.
3. **`messages`** (~3086) and **`sessionMessages`** (~2764): `castMemberId: integer("cast_member_id").references(() => lorebookBindings.id, { onDelete: "set null" })` — 🚧 doc: *the speaker's cast member (★27-7, owner 2026-11-05: a column, not a metadata stamp) — the member behind `character_id` / `persona_id`; null until S2's writers fill it and S4's boot pass backfills.* Index each: `messages_cast_member_idx` / `session_messages_cast_member_idx` on `castMemberId` (partial `IS NOT NULL` allowed).
4. **`sessionPersonas`** (~3688): `castMemberId` the same FK (SET NULL), 🚧 doc *the player seat's cast member — its card's member in the session's book; null for a card-less player seat*; `index("session_personas_cast_member_idx").on(t.sessionId, t.castMemberId)`.
5. **`sessionCharacters`** (~3798):
   - `id: integer("id").primaryKey().generatedByDefaultAsIdentity()` as the FIRST column — 🚧 doc: *the character seat's own id (plan §27 A).* Keep the existing `session_characters_pk` unique index on (session, character) untouched.
   - `castMemberId` the same FK (SET NULL), 🚧 doc *the seated cast member — written beside `character_id` by the one seat writer (`sessions/seats.ts`); null for an envoy and for a departed card-less row.*
   - `mergedInto: integer("merged_into").references((): AnyPgColumn => sessionCharacters.id, { onDelete: "set null" })` — ⏳ doc: *set on a seat the seat-members boot pass departed because another seat of the session resolved to the same cast member: the surviving seat. S4 re-stamps this seat's lines to the survivor's card and merges its values, then clears nothing; S5 drops the column.*
   - `index("session_characters_cast_member_idx").on(t.sessionId, t.castMemberId)` — **NOT unique** (0.6 data can hold two seats resolving to one member; a unique one comes in S4 after the merge, partial on `removed_at IS NULL`). Say so in a one-line comment.
6. **Owner-kind CHECKs** — the five `… IN ('card', 'cast_member', …, 'player_seat')` / `IN ('session', 'session_cast', 'player_seat', 'session_location')` checks on `attribute_configs`, `attribute_values`, `zone_contents`, `owner_sheets`, `attribute_carries` (grep `'session_cast'` in schema.ts; five hits ~9757, 9865, 10045, 10402, 10466): append `'seated_member'` to each list, keeping `'session_cast'`. Nothing else in those tables. (Do NOT touch any TypeScript owner-kind union elsewhere — those files belong to another lane.)

## Generate (never against the owner's data dir)
1. Before: read `drizzle/meta/_journal.json`'s last entry (0144, `when` 1793832414417). `pgrep -af "vite dev"` and note what runs (you will NOT start, stop or touch any server).
2. `mkdir -p /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S1/gen-data` then, from the app root:
   `SERENE_PUB_DATA_DIR=/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S1/gen-data npx drizzle-kit generate --config ./src/lib/server/db/drizzle.config.ts --name seat_cast_members`
   It must not prompt (no renames here). If it prompts or crashes, stop and report the output.
3. After: the new file must be `drizzle/0145_seat_cast_members.sql` + `drizzle/meta/0145_snapshot.json` + one journal entry whose `when` exceeds 1793832414417. Read the SQL whole. Sanctioned edit only: if an FK is emitted before the index it needs, move the index above it. Otherwise **never hand-edit generated SQL**. Report the SQL verbatim in your report (it is short).
4. If anything in the SQL drops or recreates an existing table/column/constraint other than the five CHECKs (drop + add of the check is expected) and the `sprite_sets.character_id` `DROP NOT NULL`, stop and report.

## Test (new file `src/lib/server/db/seatCast0145.int.test.ts`)
Pattern: `src/lib/server/db/localModelsKey0144.int.test.ts` (read it): `migrationsFolderThrough("0144_local_models_per_modality_key")`, an in-memory `new PGlite()`, `migrate` to 0144, insert 0.6-shaped rows with raw SQL (a user, two characters, a lorebook, a member `lorebook_bindings` linked to card 1, a session, **two** `session_characters` rows (cards 1 and 2), a `session_personas` row, a `messages` row and a `session_messages` row, a `sprite_sets` row for card 1 — read the schema for the NOT NULL columns each needs), then `migrate` to the real folder, and assert:
- every pre-existing `session_characters` row got a distinct non-null `id`, and a new insert without `id` gets the next one; the (session, character) unique index still refuses a duplicate;
- `cast_member_id` is null on the seats, the player seat, both message rows; `merged_into` null; two seats of one session may share one `cast_member_id` (non-unique index);
- `sprite_sets`: the old row is intact; a member-owned set (`character_id` null, `cast_member_id` set) inserts; a row with both or neither is refused (the CHECK); deleting the member deletes its set;
- `lorebook_bindings.overlay_of` SET NULL on the referenced member's delete; `timbre` null by default;
- each of the five CHECKs accepts `'seated_member'` and still accepts `'session_cast'` — assert via `pg_get_constraintdef` on `pg_constraint` (by constraint name) containing both;
- a second `migrate` on the real folder leaves the ledger (`drizzle.__drizzle_migrations` hashes) unchanged.
`it(…, 60_000)` timeouts on every DB test. Close the PGlite client in `finally`/`afterAll`.

## Run (targeted only)
`npx vitest run src/lib/server/db/seatCast0145.int.test.ts src/lib/server/db/localModelsKey0144.int.test.ts src/lib/server/db/migrationJournal.test.ts src/lib/server/db/migrationSet.test.ts src/lib/server/db/migrationLedgerRepair.test.ts src/lib/server/db/migrationLedgerRepair.int.test.ts src/lib/server/db/ledgerSplice.int.test.ts src/lib/server/db/dataUpgrades/atticStash.int.test.ts src/lib/server/attic/upgrade.tiny.int.test.ts`
Then `npx tsc --noEmit -p . 2>&1 | grep -E "error TS" | sort | uniq > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S1/w1-tsc.txt; wc -l` that file, and list every error that mentions `sprite` or a file you did not edit; **do not fix errors in files outside your owned list** — report them with file:line and the one-line fix you would make. (Other lanes have errors in flight; only report ones your change causes — compare by grepping for `characterId`/`spriteSets`/`castMemberId`.)

## Files owned
`src/lib/server/db/schema.ts` (only the tables above), `drizzle/0145_seat_cast_members.sql`, `drizzle/meta/0145_snapshot.json`, `drizzle/meta/_journal.json` (the one appended entry — it is dirty at HEAD; drizzle-kit appends; never reformat), `src/lib/server/db/seatCast0145.int.test.ts` (new).
## Files readable
Anything.
## Out of scope
Any reader or writer of the new columns; any TypeScript owner-kind union; `state/**`, `sockets/state.ts`, `messages/verbs.ts`, `sessions/settings.ts`, `db/defaults.ts`, `lorebooks/ownBook.ts`, the SDK.
## Stop and ask (in your report) when
drizzle-kit prompts or emits anything beyond the listed changes; a name beyond the ones above seems needed; a test can't pass without touching a non-owned file.

## Rules (quoted)
- CLAUDE.md Hard rules: *"Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*. Never seed a row at a hardcoded id. `0000`–`0093` are 0.5.3's and byte-identical forever."* · *"Never add a top-level `await` to `src/lib/server/db/index.ts`."* · *"Inside `db.transaction(async (tx) => …)` use only `tx`."* · *"Never `kill -9` the dev server."*
- Memory (migrations): *"drizzle-kit diffs against the previous **snapshot** … Never hand-edit generated SQL to force a schema match."* · *"drizzle-kit emits foreign keys BEFORE indexes … move the index; this is the one sanctioned edit to a generated file."* · *"Read the journal's last `when` before and after generating."*
- Memory (schema column): *"Adding a column to an EXISTING table in db/schema.ts before db:generate breaks every test touching that table (42703) … generate immediately after adding them, in the same lane."* — so add the columns and generate in one sitting.
- NOMENCLATURE R1 *one word, one meaning*; R3 *qualify, never the bare noun*; R6 *mark ⏳ transitional / 🚧 provisional*.
- Tests: *"Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs."* · *"An int test that opens a DB inside an `it` needs a 60 s timeout under load."*
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Done means
The four files written; the SQL quoted in your report with the journal `when`; the listed tests green (counts); the tsc errors your change causes listed with file:line.
