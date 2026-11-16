ALTER TABLE "variants" ALTER COLUMN "path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "boot_markers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "same_as_variant_id" integer;--> statement-breakpoint
CREATE INDEX "messages_session_id_id_idx" ON "messages" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "pipeline_run_nodes_err_definition_idx" ON "pipeline_run_nodes" USING btree ("definition_id") WHERE "pipeline_run_nodes"."result" = 'err';--> statement-breakpoint
CREATE INDEX "pipeline_runs_started_idx" ON "pipeline_runs" USING btree ("started_at") WHERE NOT "pipeline_runs"."is_preview";--> statement-breakpoint
CREATE INDEX "plugin_hook_invocations_finished_idx" ON "plugin_hook_invocations" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "session_messages_session_id_id_idx" ON "session_messages" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "session_messages_generating_idx" ON "session_messages" USING btree ("session_id") WHERE "session_messages"."is_generating";--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_same_as_check" CHECK (("variants"."path" IS NULL) = ("variants"."same_as_variant_id" IS NOT NULL));