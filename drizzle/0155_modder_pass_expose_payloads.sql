ALTER TABLE "pipeline_definition_registry" ADD COLUMN "payloads" json;--> statement-breakpoint
ALTER TABLE "pipeline_nodes" ADD COLUMN "expose" json;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "disabled_swaps" json DEFAULT '[]'::json NOT NULL;