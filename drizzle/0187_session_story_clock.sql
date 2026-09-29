ALTER TABLE "sessions" ADD COLUMN "story_clock_year" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "story_clock_month" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "story_clock_day" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "story_clock_hour" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "story_clock_minute" integer;--> statement-breakpoint
-- A session pointed at a moment (0180) stood there: that IS its story clock
-- (DESIGN-story-time P3). Carried across, a day only beside its month; the
-- moment had no time of day. NULL stays NULL — the session follows its line.
UPDATE "sessions" SET
	"story_clock_year" = "lorebook_moment_year",
	"story_clock_month" = "lorebook_moment_month",
	"story_clock_day" = CASE WHEN "lorebook_moment_month" IS NULL THEN NULL ELSE "lorebook_moment_day" END
WHERE "lorebook_moment_year" IS NOT NULL;
