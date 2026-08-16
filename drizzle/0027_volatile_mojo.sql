ALTER TABLE "character_lore_entries" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "history_entries" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "narrative_nodes" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "world_lore_entries" ADD COLUMN "embedding_model" text;