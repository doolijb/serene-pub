ALTER TABLE "session_possessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "session_possessions" CASCADE;--> statement-breakpoint
ALTER TABLE "state_proposals" DROP CONSTRAINT "state_proposals_kind_check";--> statement-breakpoint
ALTER TABLE "state_proposals" ADD CONSTRAINT "state_proposals_kind_check" CHECK ("state_proposals"."kind" IN ('value'));