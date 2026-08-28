-- The deep genre rename (24 §2–§3): `genre` replaces both "type" and "mode",
-- and the genre owns its id — sessions now hold `core:genre/chat`, never a
-- spec slug or an input-type id. Pre-release: values migrate in place and
-- these renames squash before release.

-- The genre id migration: both prior spellings of the standard genre.
UPDATE "sessions" SET "mode_id" = 'core:genre/chat'
	WHERE "mode_id" IN ('core:spec/create-chat', 'core:input/user-message@1');
--> statement-breakpoint
UPDATE "session_functions" SET "mode_id" = 'core:genre/chat'
	WHERE "mode_id" IN ('core:spec/create-chat', 'core:input/user-message@1');
--> statement-breakpoint
UPDATE "pipeline_function_bindings" SET "mode_id" = 'core:genre/chat'
	WHERE "mode_id" IN ('core:spec/create-chat', 'core:input/user-message@1');
--> statement-breakpoint
UPDATE "session_presets" SET "type_slug" = 'core:genre/chat'
	WHERE "type_slug" IN ('core:spec/create-chat', 'core:input/user-message@1');
--> statement-breakpoint
UPDATE "session_type_settings" SET "type_slug" = 'core:genre/chat'
	WHERE "type_slug" IN ('core:spec/create-chat', 'core:input/user-message@1');
--> statement-breakpoint

-- Column renames: mode → genre.
ALTER TABLE "sessions" RENAME COLUMN "mode_id" TO "genre_id";
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "genre_id" SET DEFAULT 'core:genre/chat';
--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "mode_fields" TO "genre_fields";
--> statement-breakpoint
ALTER TABLE "session_functions" RENAME COLUMN "mode_id" TO "genre_id";
--> statement-breakpoint
ALTER TABLE "pipeline_function_bindings" RENAME COLUMN "mode_id" TO "genre_id";
--> statement-breakpoint
ALTER TABLE "pipeline_spec_versions" RENAME COLUMN "mode" TO "genre";
--> statement-breakpoint

-- The usage lock (24 §4), as columns so dispatch by (genre, event) is a
-- SELECT: the input node's declared { genre, event }.
ALTER TABLE "pipeline_spec_versions" ADD COLUMN "input_genre" text;
--> statement-breakpoint
ALTER TABLE "pipeline_spec_versions" ADD COLUMN "input_event" text;
--> statement-breakpoint

-- Table renames: type → genre.
ALTER TABLE "session_presets" RENAME COLUMN "type_slug" TO "genre_id";
--> statement-breakpoint
ALTER INDEX "session_presets_type_idx" RENAME TO "session_presets_genre_idx";
--> statement-breakpoint
ALTER TABLE "session_type_settings" RENAME COLUMN "type_slug" TO "genre_id";
--> statement-breakpoint
ALTER TABLE "session_type_settings" RENAME TO "session_genre_settings";
