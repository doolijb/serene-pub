ALTER TABLE "lorebook_bindings" DROP CONSTRAINT "lorebook_bindings_narrative_node_id_narrative_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD COLUMN "lorebook_binding_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD CONSTRAINT "narrative_nodes_lorebook_binding_id_lorebook_bindings_id_fk" FOREIGN KEY ("lorebook_binding_id") REFERENCES "public"."lorebook_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" DROP COLUMN "narrative_node_id";--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD CONSTRAINT "narrative_nodes_lorebook_binding_id_unique" UNIQUE("lorebook_binding_id");