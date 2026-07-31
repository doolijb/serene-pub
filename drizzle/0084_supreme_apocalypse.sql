ALTER TABLE "chat_characters" ADD COLUMN "removed_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_characters" ADD COLUMN "removed_name" text;--> statement-breakpoint
ALTER TABLE "chat_personas" ADD COLUMN "removed_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_personas" ADD COLUMN "removed_name" text;