ALTER TABLE "state_proposals" DROP CONSTRAINT "state_proposals_status_check";--> statement-breakpoint
ALTER TABLE "attribute_values" ADD COLUMN "state_version" integer;--> statement-breakpoint
ALTER TABLE "session_possessions" ADD COLUMN "state_version" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "state_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "state_proposals" ADD COLUMN "base_version" integer;--> statement-breakpoint
ALTER TABLE "state_proposals" ADD CONSTRAINT "state_proposals_status_check" CHECK ("state_proposals"."status" IN ('pending', 'accepted', 'rejected', 'superseded'));