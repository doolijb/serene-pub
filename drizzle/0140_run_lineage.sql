ALTER TABLE "pipeline_runs" ADD COLUMN "parent_run_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "root_run_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "pipeline_runs_root_idx" ON "pipeline_runs" USING btree ("root_run_id");