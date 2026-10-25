ALTER TABLE "pipeline_prompts" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_specs" ADD COLUMN "instance_values" json;