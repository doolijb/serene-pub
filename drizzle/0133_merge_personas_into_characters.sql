-- HAND-EDITED, and this is the whole of the edit: the DATA MOVE below was
-- added ahead of the generated statements, and the generated statements were
-- REORDERED around it. Nothing generated was changed, added or removed.
--
-- `personas` folds into `characters`: a persona is not a different kind of row,
-- it is a character the user voices. drizzle-kit can express the drops but not
-- the move, and as generated the file could not run at all — `DROP TABLE
-- "personas" CASCADE` came first and took the six persona foreign keys with it,
-- so every `DROP CONSTRAINT …_persona_id_personas_id_fk` that followed was
-- dropping something already gone.
--
-- The order below is forced by three facts:
--   1. Every remap reads `personas`, so both DROP TABLEs go last.
--   2. `session_personas`/`session_messages`/`messages` KEEP `persona_id` and
--      have it re-pointed at `characters`. Their persona FK must be dropped
--      BEFORE the remap (the new value is a characters.id, which that FK would
--      reject) and the characters FK added AFTER it.
--   3. `lorebook_bindings`/`entry_annotations`/`message_annotations`/`files`
--      LOSE `persona_id`; their remap writes `character_id` instead, so it only
--      has to run while `persona_id` still exists.
--
-- Each remap is ONE `UPDATE … FROM`: a single statement reads the pre-update
-- snapshot, so an old persona id and a new character id occupying the same
-- number cannot double-map. `migrated_persona_id` is added and dropped inside
-- this migration, so the snapshot drizzle-kit keeps stays truthful.

ALTER TABLE "characters" ADD COLUMN "migrated_persona_id" integer;--> statement-breakpoint
-- One character per persona. `uuid` is unique per (user_id, uuid) on both
-- tables, so a persona whose uuid a character of the SAME user already holds
-- gets a fresh one — the alternative is the whole migration failing on one
-- user's card import history. `is_default_persona` is narrowed to the lowest-id
-- default per user: the partial unique index added by 0132 admits exactly one,
-- and a second one in the old table (which had no such index) must not take the
-- upgrade down with it.
INSERT INTO "characters" ("uuid","user_id","name","description","avatar_media_id","created_at","updated_at","lorebook_id","aliases","summary","creator","category","is_deleted","embedding","embedding_model","vectorized_at","is_persona","is_default_persona","migrated_persona_id")
SELECT
	CASE WHEN EXISTS (SELECT 1 FROM "characters" c WHERE c."user_id" = p."user_id" AND c."uuid" = p."uuid")
		THEN gen_random_uuid() ELSE p."uuid" END,
	p."user_id", p."name", p."description", p."avatar_media_id", p."created_at",
	COALESCE(p."updated_at", CURRENT_TIMESTAMP), p."lorebook_id", p."aliases", p."summary",
	p."creator", p."category", p."is_deleted", p."embedding", p."embedding_model", p."vectorized_at",
	true,
	p."is_default" AND p."id" = (SELECT MIN(d."id") FROM "personas" d WHERE d."user_id" = p."user_id" AND d."is_default"),
	p."id"
FROM "personas" p;--> statement-breakpoint
-- Tags fold into the character's own labels.
INSERT INTO "character_tags" ("character_id","tag_id")
SELECT c."id", pt."tag_id" FROM "persona_tags" pt JOIN "characters" c ON c."migrated_persona_id" = pt."persona_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Folded columns: persona_id → character_id. `character_id IS NULL` guards the
-- row that somehow has both — the arc is exclusive, so this cannot fire, and if
-- it ever did the character is the one to keep.
UPDATE "lorebook_bindings" b SET "character_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = b."persona_id" AND b."persona_id" IS NOT NULL AND b."character_id" IS NULL;--> statement-breakpoint
UPDATE "entry_annotations" a SET "character_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = a."persona_id" AND a."persona_id" IS NOT NULL AND a."character_id" IS NULL;--> statement-breakpoint
UPDATE "message_annotations" a SET "character_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = a."persona_id" AND a."persona_id" IS NOT NULL AND a."character_id" IS NULL;--> statement-breakpoint
UPDATE "files" f SET "character_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = f."persona_id" AND f."persona_id" IS NOT NULL AND f."character_id" IS NULL;--> statement-breakpoint
-- The annotation ENTITY KEY is the same reference in its other spelling
-- (`persona:3` beside `persona_id = 3`), and leaving it would put a row's key
-- and its resolved id in disagreement. Purely tidying: the gazetteer hash is
-- taken over those keys, so every one of these rows is stale the moment the
-- binding behind it becomes a character, and a stale row is re-extracted rather
-- than read. Remapping only lets the re-extraction land on this row instead of
-- beside it. `NOT EXISTS` protects the (parent, entity_key) primary key.
UPDATE "entry_annotations" a SET "entity_key" = 'character:' || c."id" FROM "characters" c
WHERE a."entity_key" = 'persona:' || c."migrated_persona_id"
	AND NOT EXISTS (SELECT 1 FROM "entry_annotations" x WHERE x."entry_id" = a."entry_id" AND x."entity_key" = 'character:' || c."id");--> statement-breakpoint
UPDATE "message_annotations" a SET "entity_key" = 'character:' || c."id" FROM "characters" c
WHERE a."entity_key" = 'persona:' || c."migrated_persona_id"
	AND NOT EXISTS (SELECT 1 FROM "message_annotations" x WHERE x."message_id" = a."message_id" AND x."entity_key" = 'character:' || c."id");--> statement-breakpoint
-- Kept columns: the persona FK comes off first, the remap runs, the characters
-- FK goes on after (generated statements, moved here intact).
ALTER TABLE "session_personas" DROP CONSTRAINT "session_personas_persona_id_personas_id_fk";
--> statement-breakpoint
UPDATE "session_personas" sp SET "persona_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = sp."persona_id";--> statement-breakpoint
ALTER TABLE "session_personas" ADD CONSTRAINT "session_personas_persona_id_characters_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" DROP CONSTRAINT "session_messages_persona_id_personas_id_fk";
--> statement-breakpoint
UPDATE "session_messages" sm SET "persona_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = sm."persona_id";--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_persona_id_characters_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_persona_id_personas_id_fk";
--> statement-breakpoint
UPDATE "messages" m SET "persona_id" = c."id" FROM "characters" c WHERE c."migrated_persona_id" = m."persona_id";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_persona_id_characters_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The remaining generated statements, in generated order. The three FKs above
-- are gone by now, so nothing is left for CASCADE to take.
ALTER TABLE "entry_annotations" DROP CONSTRAINT "entry_annotations_persona_id_personas_id_fk";
--> statement-breakpoint
ALTER TABLE "lorebook_bindings" DROP CONSTRAINT "lorebook_bindings_persona_id_personas_id_fk";
--> statement-breakpoint
ALTER TABLE "message_annotations" DROP CONSTRAINT "message_annotations_persona_id_personas_id_fk";
--> statement-breakpoint
ALTER TABLE "persona_tags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "personas" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "persona_tags" CASCADE;--> statement-breakpoint
DROP TABLE "personas" CASCADE;--> statement-breakpoint
DROP INDEX "files_persona_idx";--> statement-breakpoint
DROP INDEX "lorebook_bindings_persona_unique";--> statement-breakpoint
DROP INDEX "lorebook_bindings_persona_id_idx";--> statement-breakpoint
ALTER TABLE "entry_annotations" DROP COLUMN "persona_id";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN "persona_id";--> statement-breakpoint
ALTER TABLE "lorebook_bindings" DROP COLUMN "persona_id";--> statement-breakpoint
ALTER TABLE "message_annotations" DROP COLUMN "persona_id";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "enable_easy_persona_creation";--> statement-breakpoint
-- Added and dropped inside this one migration, so the snapshot stays truthful.
ALTER TABLE "characters" DROP COLUMN "migrated_persona_id";
