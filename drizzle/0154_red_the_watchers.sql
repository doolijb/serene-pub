ALTER TABLE "attribute_values" ADD COLUMN "story_clock_year" integer;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD COLUMN "story_clock_month" integer;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD COLUMN "story_clock_day" integer;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD COLUMN "story_clock_hour" integer;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD COLUMN "story_clock_minute" integer;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_story_clock_day_check" CHECK (("attribute_values"."story_clock_month" IS NOT NULL OR "attribute_values"."story_clock_day" IS NULL));--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_story_clock_year_check" CHECK (("attribute_values"."story_clock_year" IS NOT NULL OR ("attribute_values"."story_clock_month" IS NULL AND "attribute_values"."story_clock_hour" IS NULL)));--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_story_clock_hour_check" CHECK (("attribute_values"."story_clock_hour" IS NULL OR "attribute_values"."story_clock_hour" BETWEEN 0 AND 23));--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_story_clock_minute_check" CHECK (("attribute_values"."story_clock_minute" IS NULL OR ("attribute_values"."story_clock_hour" IS NOT NULL AND "attribute_values"."story_clock_minute" BETWEEN 0 AND 59)));