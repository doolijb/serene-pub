ALTER TABLE "lorebooks" ALTER COLUMN "primary_ruleset" SET DEFAULT 'core:ruleset/freeform@1';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "genre_id" SET DEFAULT 'core:genre/story';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "primary_ruleset" SET DEFAULT 'core:ruleset/freeform@1';--> statement-breakpoint
ALTER TABLE "session_presets" ADD COLUMN "settings" json;--> statement-breakpoint
ALTER TABLE "session_presets" ADD COLUMN "calls_per_turn" integer;--> statement-breakpoint
ALTER TABLE "session_presets" ADD COLUMN "cast_floor" json;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "start_favourites" json;