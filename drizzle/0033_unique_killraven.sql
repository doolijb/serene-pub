ALTER TABLE "narrative_edges" RENAME TO "narrative_relationships";--> statement-breakpoint
ALTER TABLE "narrative_relationships" RENAME COLUMN "edge_type" TO "relationship_type";--> statement-breakpoint
ALTER TABLE "narrative_relationships" RENAME COLUMN "notes" TO "description";--> statement-breakpoint
ALTER TABLE "narrative_relationships" DROP CONSTRAINT "narrative_edges_from_node_id_narrative_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "narrative_relationships" DROP CONSTRAINT "narrative_edges_to_node_id_narrative_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "narrative_nodes" DROP CONSTRAINT "narrative_nodes_chat_id_chats_id_fk";
--> statement-breakpoint
ALTER TABLE "narrative_relationships" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "narrative_nodes" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "narrative_nodes" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "lorebook_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "history_entry_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "scene_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "pending_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD COLUMN "history_entry_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_lorebook_id_lorebooks_id_fk" FOREIGN KEY ("lorebook_id") REFERENCES "public"."lorebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_from_node_id_narrative_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."narrative_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_to_node_id_narrative_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."narrative_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_history_entry_id_history_entries_id_fk" FOREIGN KEY ("history_entry_id") REFERENCES "public"."history_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD CONSTRAINT "narrative_nodes_history_entry_id_history_entries_id_fk" FOREIGN KEY ("history_entry_id") REFERENCES "public"."history_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_nodes" DROP COLUMN "chat_id";