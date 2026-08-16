ALTER TABLE "character_lore_entries" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "history_entries" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "personas" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "world_lore_entries" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "character_lore_entries" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "history_entries" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "vectorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "world_lore_entries" ADD COLUMN "vectorized_at" timestamp;