ALTER TABLE "session_messages" ADD COLUMN "rewind_ordinal" integer;--> statement-breakpoint
ALTER TABLE "session_messages" ADD COLUMN "rewind_taken" json;--> statement-breakpoint
CREATE INDEX "session_messages_session_rewind_idx" ON "session_messages" USING btree ("session_id","rewind_ordinal");