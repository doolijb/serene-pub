ALTER TABLE "system_settings" ADD COLUMN "chara_vault_email" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "chara_vault_encrypted_token" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "chara_vault_token_iv" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "chara_vault_token_auth_tag" text;