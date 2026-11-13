ALTER TABLE "pipeline_variable_templates" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "pipeline_variable_templates" ADD COLUMN "pub_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_presets" ADD COLUMN "variable_layouts" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_variable_templates_variable_reference_idx" ON "pipeline_variable_templates" USING btree ("variable_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_variable_templates_pub_default_idx" ON "pipeline_variable_templates" USING btree ("variable_id") WHERE "pipeline_variable_templates"."pub_default" = true;