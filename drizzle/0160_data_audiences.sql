ALTER TABLE "pipeline_definition_registry" ADD COLUMN "audience_from" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "annex_audiences" jsonb DEFAULT '{}'::jsonb NOT NULL;