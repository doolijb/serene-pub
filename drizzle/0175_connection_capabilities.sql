-- A connection carries a SET of capabilities, not a single modality.
--
-- `connections.modality` said one thing per connection — "this is a text
-- connection" — and adapters were split into two families by it. That cannot
-- describe a real backend: KoboldCPP does text, images, vision, speech and
-- transcription from one process and already reports so over its own version
-- endpoint. Nor was it ever true here — rows with `modality: 'embeddings'`
-- already existed and belonged to neither family.
--
-- What replaces it: `capabilities` (what this connection can do, resolved from
-- the adapter's declaration, its preset, a probe and the user's toggles) and
-- `preset` (which named service it was created from, so those defaults can be
-- recomputed later).
--
-- `modality` is deliberately NOT dropped here. It still has readers until the
-- capability work lands everywhere, and a column that is merely ignored is much
-- cheaper to remove later than one that is missed now.
ALTER TABLE "connections" ADD COLUMN "capabilities" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint

-- Which named service this came from — a slug, never the numeric `value`, which
-- is an ordering artifact that has already skipped an index once.
--
-- NULL means "custom", and that is the honest backfill for every existing row:
-- guessing from `base_url` would confidently mis-attribute somebody's private
-- endpoint to OpenRouter and then apply OpenRouter's capability defaults to it.
ALTER TABLE "connections" ADD COLUMN "preset" text;--> statement-breakpoint

-- The instance default, per capability.
--
-- A table rather than a column pair per capability: the capability space is open
-- (a plugin may add one), so a column per capability does not scale and each new
-- one would be a migration. Only transforms are ever registered here — there is
-- no such thing as a "default tool-calling connection".
CREATE TABLE "connection_defaults" (
	"capability" text PRIMARY KEY NOT NULL,
	"connection_id" integer,
	"sampling_config_id" integer
);--> statement-breakpoint
ALTER TABLE "connection_defaults" ADD CONSTRAINT "connection_defaults_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_defaults" ADD CONSTRAINT "connection_defaults_sampling_config_id_sampling_configs_id_fk" FOREIGN KEY ("sampling_config_id") REFERENCES "public"."sampling_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Backfill from `modality`, by static SQL and never by loading an adapter.
--
-- Loading one would throw: `openai-embeddings` and `local-onnx` are live `type`
-- values that fall straight through `getConnectionAdapter`'s switch. A migration
-- that dies on a row a user actually has is worse than an imprecise backfill.
--
-- This only has to keep every existing pipeline running. The full set — vision,
-- structured output, everything the protocol can express — is filled in by
-- `resolveCapabilities` on the next connection test.
--
-- An unrecognised modality lands as `{}` on purpose: "not determined yet", which
-- shows up in the UI as something to press Test on. Guessing `text->text` for it
-- would be silently wrong, and silently wrong is the failure mode this whole
-- change exists to remove.
UPDATE "connections" SET "capabilities" = CASE "modality"
	WHEN 'text-gen'   THEN '{"resolved":{"text->text":"native"}}'::json
	WHEN 'image-gen'  THEN '{"resolved":{"text->image":"native"}}'::json
	WHEN 'embeddings' THEN '{"resolved":{"text->embedding":"native"}}'::json
	ELSE '{}'::json
END;--> statement-breakpoint

-- Carry the two existing instance defaults across. Written as inserts guarded by
-- the source being set, so an install that never chose one gets no row rather
-- than a row pointing at nothing.
INSERT INTO "connection_defaults" ("capability", "connection_id", "sampling_config_id")
SELECT 'text->text', "default_connection_id", "default_sampling_id"
FROM "system_settings"
WHERE "default_connection_id" IS NOT NULL OR "default_sampling_id" IS NOT NULL;--> statement-breakpoint

INSERT INTO "connection_defaults" ("capability", "connection_id", "sampling_config_id")
SELECT 'text->image', "default_image_connection_id", "default_image_sampling_id"
FROM "system_settings"
WHERE "default_image_connection_id" IS NOT NULL OR "default_image_sampling_id" IS NOT NULL;--> statement-breakpoint

-- The per-modality columns 0172 added are superseded by the table above. They
-- shipped on this branch and were never released, so they go rather than linger.
-- `default_connection_id` / `default_sampling_id` stay: the legacy generation
-- path still reads them, and the rows above were seeded from them.
ALTER TABLE "system_settings" DROP COLUMN "default_image_connection_id";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "default_image_sampling_id";--> statement-breakpoint

-- Belt and braces for the slot-address fix.
--
-- A `connection` or `sampling` slot holds one value at the empty path. Two other
-- spellings existed — `'ref'` from the app's legacy projection and `'$ref'`,
-- which the SDK executor read and nothing ever wrote. The resolver now folds
-- both at read time and warns; this moves any row that is actually on disk, so
-- that warning means "something is still writing the old address" rather than
-- "there is old data".
--
-- Guarded against clobbering: if a row already exists at the empty path for the
-- same address, the legacy one is dropped rather than colliding with it.
DELETE FROM "pipeline_config_values" a
WHERE a."slot" IN ('connection','sampling')
	AND a."path" IN ('ref','$ref')
	AND EXISTS (
		SELECT 1 FROM "pipeline_config_values" b
		WHERE b."config_id" = a."config_id" AND b."node_key" = a."node_key"
			AND b."slot" = a."slot" AND b."path" = ''
	);--> statement-breakpoint
UPDATE "pipeline_config_values" SET "path" = ''
WHERE "slot" IN ('connection','sampling') AND "path" IN ('ref','$ref');--> statement-breakpoint

DELETE FROM "pipeline_node_overrides" a
WHERE a."slot" IN ('connection','sampling')
	AND a."path" IN ('ref','$ref')
	AND EXISTS (
		SELECT 1 FROM "pipeline_node_overrides" b
		WHERE b."spec_id" = a."spec_id" AND b."scope_kind" = a."scope_kind"
			AND b."scope_id" = a."scope_id" AND b."node_key" = a."node_key"
			AND b."slot" = a."slot" AND b."path" = ''
	);--> statement-breakpoint
UPDATE "pipeline_node_overrides" SET "path" = ''
WHERE "slot" IN ('connection','sampling') AND "path" IN ('ref','$ref');
