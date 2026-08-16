
UPDATE tags 
SET user_id = 1 
WHERE EXISTS (SELECT 1 FROM users WHERE users.id = 1);--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "theme" text DEFAULT 'hamlindigo' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "dark_mode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "show_all_character_fields";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "enable_easy_character_creation";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "enable_easy_persona_creation";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "show_home_page_banner";