ALTER TABLE "character_lore_entries" ADD COLUMN "retrieval_strategy" text;--> statement-breakpoint
ALTER TABLE "character_lore_entries" ADD COLUMN "match_mode" text;--> statement-breakpoint
ALTER TABLE "history_entries" ADD COLUMN "retrieval_strategy" text;--> statement-breakpoint
ALTER TABLE "history_entries" ADD COLUMN "match_mode" text;--> statement-breakpoint
ALTER TABLE "world_lore_entries" ADD COLUMN "retrieval_strategy" text;--> statement-breakpoint
ALTER TABLE "world_lore_entries" ADD COLUMN "match_mode" text;