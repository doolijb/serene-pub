ALTER TABLE "narrative_relationships" ALTER COLUMN "from_node_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ALTER COLUMN "to_node_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "from_entry_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "to_entry_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_from_entry_id_lorebook_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."lorebook_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_to_entry_id_lorebook_entries_id_fk" FOREIGN KEY ("to_entry_id") REFERENCES "public"."lorebook_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "narrative_relationships_from_entry_id_idx" ON "narrative_relationships" USING btree ("from_entry_id");--> statement-breakpoint
CREATE INDEX "narrative_relationships_to_entry_id_idx" ON "narrative_relationships" USING btree ("to_entry_id");--> statement-breakpoint
ALTER TABLE "lorebooks" DROP COLUMN "features";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "features_default";--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_from_endpoint_check" CHECK (("narrative_relationships"."from_node_id" IS NULL) <> ("narrative_relationships"."from_entry_id" IS NULL));--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_to_endpoint_check" CHECK (("narrative_relationships"."to_node_id" IS NULL) <> ("narrative_relationships"."to_entry_id" IS NULL));