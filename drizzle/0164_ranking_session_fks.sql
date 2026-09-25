-- Rows a deleted session left behind before these FKs existed.
DELETE FROM "ranking_subject_stats" WHERE "session_id" NOT IN (SELECT "id" FROM "sessions");--> statement-breakpoint
DELETE FROM "rankings" WHERE "session_id" IS NOT NULL AND "session_id" NOT IN (SELECT "id" FROM "sessions");--> statement-breakpoint
ALTER TABLE "ranking_subject_stats" ADD CONSTRAINT "ranking_subject_stats_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;