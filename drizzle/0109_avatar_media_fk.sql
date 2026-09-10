-- HAND-EDITED, and this is the whole of the edit: the two UPDATEs below were
-- added AHEAD of the generated ALTER TABLEs. drizzle-kit cannot express a
-- backfill, and without one this migration is unrunnable on any install that
-- has a dangling avatar pointer — ADD CONSTRAINT validates the existing rows
-- and refuses the table outright. A dangling pointer was legal until now (the
-- column was a plain integer by ruling), and the app has produced them: a file
-- deleted through a path that did not clear the pointer leaves one behind.
--
-- `NOT IN` is safe here specifically because `files.id` is the primary key and
-- so can never be NULL; the subquery cannot poison the comparison.
UPDATE "characters" SET "avatar_media_id" = NULL WHERE "avatar_media_id" IS NOT NULL AND "avatar_media_id" NOT IN (SELECT "id" FROM "files");--> statement-breakpoint
UPDATE "personas" SET "avatar_media_id" = NULL WHERE "avatar_media_id" IS NOT NULL AND "avatar_media_id" NOT IN (SELECT "id" FROM "files");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_avatar_media_id_files_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_avatar_media_id_files_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
