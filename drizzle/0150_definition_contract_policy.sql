ALTER TABLE "pipeline_definition_registry" ADD COLUMN "live_row" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_definition_registry" ADD COLUMN "review" json;--> statement-breakpoint
ALTER TABLE "pipeline_definition_registry" ADD COLUMN "media" json;--> statement-breakpoint
ALTER TABLE "pipeline_definition_registry" ADD COLUMN "policy" jsonb;