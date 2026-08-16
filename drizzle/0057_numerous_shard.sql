CREATE TABLE "koboldcpp_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"koboldcpp_manager_enabled" boolean DEFAULT false NOT NULL,
	"koboldcpp_base_url" text DEFAULT 'http://localhost:5001' NOT NULL,
	"koboldcpp_models_dir" text,
	"koboldcpp_managed_mode" text,
	"koboldcpp_managed_binary_variant" text,
	"koboldcpp_managed_binary_dir" text,
	"koboldcpp_managed_port" integer DEFAULT 5001 NOT NULL,
	"koboldcpp_managed_admin_password" text,
	"koboldcpp_managed_model_ttl_secs" integer DEFAULT 300 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ollama_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ollama_manager_enabled" boolean DEFAULT true NOT NULL,
	"ollama_base_url" text DEFAULT 'http://localhost:11434/' NOT NULL
);
--> statement-breakpoint
-- Migrate existing data before dropping columns
INSERT INTO "ollama_settings" ("id", "ollama_manager_enabled", "ollama_base_url")
SELECT 1, "ollama_manager_enabled", "ollama_base_url" FROM "system_settings" WHERE id = 1
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "koboldcpp_settings" (
  "id", "koboldcpp_manager_enabled", "koboldcpp_base_url", "koboldcpp_models_dir",
  "koboldcpp_managed_mode", "koboldcpp_managed_binary_variant", "koboldcpp_managed_binary_dir",
  "koboldcpp_managed_port", "koboldcpp_managed_admin_password", "koboldcpp_managed_model_ttl_secs"
)
SELECT
  1,
  COALESCE("koboldcpp_manager_enabled", false),
  COALESCE("koboldcpp_base_url", 'http://localhost:5001'),
  "koboldcpp_models_dir",
  "koboldcpp_managed_mode",
  "koboldcpp_managed_binary_variant",
  "koboldcpp_managed_binary_dir",
  COALESCE("koboldcpp_managed_port", 5001),
  "koboldcpp_managed_admin_password",
  COALESCE("koboldcpp_managed_model_ttl_secs", 300)
FROM "system_settings" WHERE id = 1
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "ollama_manager_enabled";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "ollama_base_url";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_manager_enabled";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_base_url";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_models_dir";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_managed_mode";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_managed_binary_variant";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_managed_binary_dir";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_managed_port";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_managed_admin_password";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "koboldcpp_managed_model_ttl_secs";