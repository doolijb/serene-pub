ALTER TABLE "user_settings" ADD COLUMN "background_image_path" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "background_opacity" integer DEFAULT 75 NOT NULL;