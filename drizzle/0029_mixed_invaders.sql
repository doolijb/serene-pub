ALTER TABLE "scenes" DROP CONSTRAINT "scenes_chat_id_chats_id_fk";
--> statement-breakpoint
ALTER TABLE "scenes" DROP CONSTRAINT "scenes_lorebook_id_lorebooks_id_fk";
--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "chat_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "lorebook_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_lorebook_id_lorebooks_id_fk" FOREIGN KEY ("lorebook_id") REFERENCES "public"."lorebooks"("id") ON DELETE cascade ON UPDATE no action;