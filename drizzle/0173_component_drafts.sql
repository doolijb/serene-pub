ALTER TABLE "authored_components" ADD COLUMN "draft_files" jsonb;--> statement-breakpoint
ALTER TABLE "authored_components" ADD COLUMN "draft_entry" text;--> statement-breakpoint
ALTER TABLE "authored_components" ADD COLUMN "draft_framework" text;--> statement-breakpoint
ALTER TABLE "authored_components" ADD COLUMN "draft_errors" jsonb;--> statement-breakpoint
ALTER TABLE "authored_components" ADD COLUMN "draft_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "authored_components" ADD CONSTRAINT "authored_components_draft_framework_check" CHECK ("authored_components"."draft_framework" IS NULL OR "authored_components"."draft_framework" IN ('svelte', 'vanilla'));