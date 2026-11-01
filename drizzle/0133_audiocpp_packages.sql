ALTER TABLE "audiocpp_settings" ADD COLUMN "enabled_package_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audiocpp_settings" ADD COLUMN "binary_verified" boolean;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "gguf_list_cache" jsonb DEFAULT '{}'::jsonb NOT NULL;