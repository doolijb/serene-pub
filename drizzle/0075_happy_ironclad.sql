ALTER TABLE "lorebook_bindings" ADD COLUMN "scene_id" integer;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "history_entry_id" integer;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "node_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "node_visibility" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "aliases" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "embedding" real[];--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "parent_node_id" integer;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD CONSTRAINT "lorebook_bindings_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD CONSTRAINT "lorebook_bindings_history_entry_id_history_entries_id_fk" FOREIGN KEY ("history_entry_id") REFERENCES "public"."history_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD CONSTRAINT "lorebook_bindings_parent_node_id_lorebook_bindings_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."lorebook_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lorebook_bindings_lorebook_id_idx" ON "lorebook_bindings" USING btree ("lorebook_id");