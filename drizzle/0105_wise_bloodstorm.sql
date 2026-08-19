ALTER TABLE "pipeline_edges" ALTER COLUMN "from_node_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_edges" ADD COLUMN "from_block_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_edges" ADD CONSTRAINT "pipeline_edges_one_source_check" CHECK (("pipeline_edges"."from_node_id" IS NULL) <> ("pipeline_edges"."from_block_id" IS NULL));