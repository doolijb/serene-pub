ALTER TABLE "state_proposals" DROP CONSTRAINT "state_proposals_kind_check";--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "library_write_mode" text;--> statement-breakpoint
ALTER TABLE "state_proposals" ADD CONSTRAINT "state_proposals_kind_check" CHECK ("state_proposals"."kind" IN ('value', 'clock', 'library'));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_library_write_mode_check" CHECK ("user_settings"."library_write_mode" IS NULL OR "user_settings"."library_write_mode" IN ('full', 'review', 'off'));