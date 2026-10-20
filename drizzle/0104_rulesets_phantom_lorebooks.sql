ALTER TABLE "system_settings" ALTER COLUMN "lore_write_mode_default" SET DEFAULT 'full';--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD COLUMN "derived_from" jsonb;--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD COLUMN "source_message_id" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "primary_ruleset" text DEFAULT 'core:ruleset/story@1' NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "ruleset_version" text;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "compendium_mode" text DEFAULT 'referenced' NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "overlay_of" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "primary_ruleset" text DEFAULT 'core:ruleset/story@1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ruleset_version" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "compendium_mode" text DEFAULT 'referenced' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rigour" text DEFAULT 'prose' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "on_revision" text DEFAULT 'overwrite' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "on_revision_default" text DEFAULT 'overwrite' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "on_revision_default" text;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD CONSTRAINT "lorebooks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD CONSTRAINT "lorebooks_overlay_of_lorebooks_id_fk" FOREIGN KEY ("overlay_of") REFERENCES "public"."lorebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lorebooks_session_id_idx" ON "lorebooks" USING btree ("session_id") WHERE "lorebooks"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lorebooks_overlay_of_idx" ON "lorebooks" USING btree ("overlay_of") WHERE "lorebooks"."overlay_of" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD CONSTRAINT "lorebooks_compendium_mode_check" CHECK ("lorebooks"."compendium_mode" IN ('derived', 'referenced'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_compendium_mode_check" CHECK ("sessions"."compendium_mode" IN ('derived', 'referenced'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rigour_check" CHECK ("sessions"."rigour" IN ('prose', 'mechanics', 'scripts'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_on_revision_check" CHECK ("sessions"."on_revision" IN ('overwrite', 'branch'));--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_on_revision_default_check" CHECK ("system_settings"."on_revision_default" IN ('overwrite', 'branch'));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_on_revision_default_check" CHECK ("user_settings"."on_revision_default" IS NULL OR "user_settings"."on_revision_default" IN ('overwrite', 'branch'));