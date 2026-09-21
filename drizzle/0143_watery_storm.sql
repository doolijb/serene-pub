ALTER TABLE "pipeline_context_templates" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_context_templates" ADD COLUMN "owner_plugin_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline_context_templates" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "pipeline_prompts" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_prompts" ADD COLUMN "owner_plugin_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline_prompts" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "pipeline_variable_templates" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_variable_templates" ADD COLUMN "owner_plugin_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline_variable_templates" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "pipeline_context_templates" ADD CONSTRAINT "pipeline_context_templates_template_id_unique" UNIQUE("template_id");--> statement-breakpoint
ALTER TABLE "pipeline_prompts" ADD CONSTRAINT "pipeline_prompts_template_id_unique" UNIQUE("template_id");--> statement-breakpoint
ALTER TABLE "pipeline_variable_templates" ADD CONSTRAINT "pipeline_variable_templates_template_id_unique" UNIQUE("template_id");--> statement-breakpoint
--
-- Backfill: core's seeded template rows get their namespaced template id (R19).
--
-- `template_id` is the owner-namespaced name a spec references — `owner:template/name@N`.
-- Core's is DERIVED from `seed_key`, which stays the storage identity, by the one rule
-- `coreTemplateIdFor()` applies in `pipelines/entities/templateIds.ts`: lower-case, every
-- run of non-[a-z0-9] becomes a single hyphen, hyphens trimmed at the ends. The TS
-- function and the three statements below are each a single regexp so the two can be read
-- against one another; `coreTemplateIds.int.test.ts` asserts they agree on every seeded
-- row. The whole seed key is slugified rather than its last segment: four core prompt
-- slugs (`summarize-world-default`, `-character-`, `-scene-`, `graph-build-default`)
-- name a row in three to five pools each, so a last-segment id would collide, and an
-- id that changes when a new row is added is not an id.
--
-- Restricted to core's own key prefixes on purpose. A row migrated from 0.5 also carries
-- a `seed_key` (`migrated-prompt:…`), and it came from a person's legacy configuration —
-- stamping it `core:` would claim it for core and make it immutable-by-owner on the next
-- pass. Those rows keep NULL and are referenceable by row id as they are today.
--
-- Idempotent (`template_id IS NULL`) and deterministic (a pure function of `seed_key`);
-- the boot seeders write the identical value through the same derivation, so a row this
-- statement does not reach converges on the next boot rather than staying nameless.
--
UPDATE "pipeline_prompts"
SET "template_id" = 'core:template/' || trim(both '-' from regexp_replace(lower("seed_key"), '[^a-z0-9]+', '-', 'g')) || '@1'
WHERE "seed_key" LIKE 'pipeline-prompt:%' AND "template_id" IS NULL;--> statement-breakpoint
UPDATE "pipeline_context_templates"
SET "template_id" = 'core:template/' || trim(both '-' from regexp_replace(lower("seed_key"), '[^a-z0-9]+', '-', 'g')) || '@1'
WHERE "seed_key" LIKE 'pipeline-context-template:%' AND "template_id" IS NULL;--> statement-breakpoint
UPDATE "pipeline_variable_templates"
SET "template_id" = 'core:template/' || trim(both '-' from regexp_replace(lower("seed_key"), '[^a-z0-9]+', '-', 'g')) || '@1'
WHERE "seed_key" LIKE 'pipeline-variable-template:%' AND "template_id" IS NULL;
