ALTER TABLE "connection_models" ADD COLUMN "missing_since" timestamp;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "models_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "models_sync_error" text;