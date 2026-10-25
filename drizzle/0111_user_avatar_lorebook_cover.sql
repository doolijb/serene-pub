ALTER TABLE "lorebooks" ADD COLUMN "cover_media_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_media_id" integer;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD CONSTRAINT "lorebooks_cover_media_id_files_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_files_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;