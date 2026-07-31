ALTER TABLE "chat_messages" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "binding_merge_logs_lorebook_id_idx" ON "binding_merge_logs" USING btree ("lorebook_id");--> statement-breakpoint
CREATE INDEX "scenes_history_entry_id_idx" ON "scenes" USING btree ("history_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_user_id_unique" ON "user_settings" USING btree ("user_id");