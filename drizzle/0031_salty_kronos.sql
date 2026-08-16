ALTER TABLE "scenes" DROP CONSTRAINT "scenes_history_entry_id_history_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "history_entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_history_entry_id_history_entries_id_fk" FOREIGN KEY ("history_entry_id") REFERENCES "public"."history_entries"("id") ON DELETE cascade ON UPDATE no action;