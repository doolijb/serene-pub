ALTER TABLE "ranking_subject_stats" ADD COLUMN "last_included_run_id" integer;--> statement-breakpoint
ALTER TABLE "ranking_subject_stats" ADD COLUMN "last_included_tokens" integer;--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "ranking_retention";