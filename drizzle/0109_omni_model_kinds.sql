ALTER TABLE "connection_models" ADD COLUMN "reads" json;--> statement-breakpoint
ALTER TABLE "connection_models" ADD COLUMN "writes" json;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "transcript" text;