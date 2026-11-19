ALTER TABLE "lorebook_bindings" ADD COLUMN "cast_member_lock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD COLUMN "entry_lock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "scene_lock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_bindings" ADD CONSTRAINT "lorebook_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;