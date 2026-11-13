ALTER TABLE "scenes" ALTER COLUMN "history_entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "name_is_default" boolean DEFAULT false NOT NULL;