ALTER TABLE "vectorization_configs" ADD COLUMN "mode" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "vectorization_configs" ADD COLUMN "api_base_url" text;--> statement-breakpoint
ALTER TABLE "vectorization_configs" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "vectorization_configs" ADD COLUMN "api_model" text;--> statement-breakpoint
ALTER TABLE "vectorization_configs" ADD COLUMN "api_dimensions" integer;