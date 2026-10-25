ALTER TABLE "lorebooks" DROP CONSTRAINT IF EXISTS "lorebooks_compendium_mode_check";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_compendium_mode_check";--> statement-breakpoint
ALTER TABLE "lorebooks" DROP COLUMN IF EXISTS "compendium_mode";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "compendium_mode";
