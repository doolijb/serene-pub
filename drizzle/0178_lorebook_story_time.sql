ALTER TABLE "lorebook_branches" ADD COLUMN "story_clock_year" integer;--> statement-breakpoint
ALTER TABLE "lorebook_branches" ADD COLUMN "story_clock_month" integer;--> statement-breakpoint
ALTER TABLE "lorebook_branches" ADD COLUMN "story_clock_day" integer;--> statement-breakpoint
ALTER TABLE "lorebook_branches" ADD COLUMN "story_clock_hour" integer;--> statement-breakpoint
ALTER TABLE "lorebook_branches" ADD COLUMN "story_clock_minute" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "story_calendar" json;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "story_clock_year" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "story_clock_month" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "story_clock_day" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "story_clock_hour" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "story_clock_minute" integer;