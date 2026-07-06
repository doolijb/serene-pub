UPDATE "narrative_nodes" SET "node_state" = 'hidden' WHERE "node_state" IN ('retconned', 'resolved', 'defunct');--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "narrative_node_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "visibility" text DEFAULT 'acknowledged' NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD CONSTRAINT "lorebook_bindings_narrative_node_id_narrative_nodes_id_fk" FOREIGN KEY ("narrative_node_id") REFERENCES "public"."narrative_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_nodes" DROP COLUMN "node_type";