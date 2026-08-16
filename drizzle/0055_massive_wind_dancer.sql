ALTER TABLE "system_settings" ADD COLUMN "koboldcpp_managed_mode" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "koboldcpp_managed_binary_variant" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "koboldcpp_managed_binary_dir" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "koboldcpp_managed_port" integer DEFAULT 5001 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "koboldcpp_managed_admin_password" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "koboldcpp_managed_model_ttl_secs" integer DEFAULT 300 NOT NULL;