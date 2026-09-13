ALTER TABLE "lorebooks" ADD COLUMN "features" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "features_default" text DEFAULT 'simple' NOT NULL;
--> statement-breakpoint
-- `features` holds deviations from `system_settings.features_default`,
-- and that default is 'simple' — World Lore alone. A lorebook written
-- before the column may already have cast, history and graphs in it, so
-- every existing row is stamped with an explicit `everything`; only
-- lorebooks made from here on store NULL and follow the default.
UPDATE "lorebooks" SET "features" = '{"cast":true,"history":true,"timeline":true,"graphs":true,"nesting":true,"markers":true,"advanced":true}'::jsonb;
