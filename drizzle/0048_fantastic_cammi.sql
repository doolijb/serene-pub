ALTER TABLE "narrative_nodes" ADD COLUMN "node_visibility" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD COLUMN "aliases" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
UPDATE "narrative_nodes" SET "node_visibility" = 'legendary', "node_state" = 'active' WHERE "node_state" = 'legendary';--> statement-breakpoint
UPDATE "narrative_nodes" SET "node_visibility" = 'hidden', "node_state" = 'active' WHERE "node_state" = 'hidden';