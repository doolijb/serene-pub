-- An instance default per modality, not one default shared by all of them.
--
-- `default_connection_id` and `default_sampling_id` were written when text
-- generation was the only kind there was, so they carry no modality and every
-- consumer that reads them assumes one. Adding image generation without adding
-- these two would mean the world layer handing a text connection to an image
-- provider whenever a spec left the slot unset — a mismatch nothing would catch
-- until the request reached a backend that has no idea what a temperature is.
--
-- Deliberately two more columns rather than a modality-keyed table: there are as
-- many rows here as there are instances (one), the set of modalities is small and
-- known, and a foreign key per column is what makes "the default was deleted"
-- resolve to NULL instead of to a dangling id.
ALTER TABLE "system_settings" ADD COLUMN "default_image_connection_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "default_image_sampling_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_image_connection_id_connections_id_fk" FOREIGN KEY ("default_image_connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_image_sampling_id_sampling_configs_id_fk" FOREIGN KEY ("default_image_sampling_id") REFERENCES "public"."sampling_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Point the image sampling default at the seeded row, by seedKey rather than by
-- id: seeded ids are not stable across installs, and pointing a default at a
-- hardcoded id is the exact mistake that once overwrote a user's own config.
-- No image CONNECTION default is set — there is nothing to point at until
-- somebody adds one.
UPDATE "system_settings"
SET "default_image_sampling_id" = (
	SELECT "id" FROM "sampling_configs" WHERE "seed_key" = 'sampling-image-default'
)
WHERE "default_image_sampling_id" IS NULL;
