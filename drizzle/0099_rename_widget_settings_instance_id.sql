ALTER TABLE "widget_settings" RENAME COLUMN "widget_slug" TO "widget_instance_id";--> statement-breakpoint
DROP INDEX "widget_settings_user_session_widget_idx";--> statement-breakpoint
DROP INDEX "widget_settings_widget_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "widget_settings_user_session_widget_idx" ON "widget_settings" USING btree ("user_id","session_id","widget_instance_id");--> statement-breakpoint
CREATE INDEX "widget_settings_widget_idx" ON "widget_settings" USING btree ("widget_instance_id");