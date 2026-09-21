DROP INDEX "owner_sheets_owner_sheet_uq";--> statement-breakpoint
ALTER TABLE "owner_sheets" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "owner_sheets" ADD CONSTRAINT "owner_sheets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_sheets_session_idx" ON "owner_sheets" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_sheets_owner_sheet_uq" ON "owner_sheets" USING btree ("owner_kind","owner_id","session_id","sheet_id");