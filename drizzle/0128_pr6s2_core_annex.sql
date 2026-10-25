DROP TABLE "plugin_rows" CASCADE;--> statement-breakpoint
ALTER TABLE "scene_cues" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "branch_of_session_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "branch_of_message_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "branch_of_name" text;