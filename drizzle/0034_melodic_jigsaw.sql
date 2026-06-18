ALTER TABLE "narrative_nodes" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "embedding" real[];--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "vectorized_at" timestamp;