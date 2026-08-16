ALTER TABLE "chat_messages" ADD COLUMN "generation_stage" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "error" json;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "queue_item_id" text;--> statement-breakpoint
ALTER TABLE "chat_messages" DROP COLUMN "adapter_id";--> statement-breakpoint
-- Any row still marked as generating predates this migration/restart and its
-- in-memory queue/adapter state is gone — clear it instead of leaving a
-- permanently-stuck "typing..." bubble.
UPDATE "chat_messages" SET "is_generating" = false, "generation_stage" = null, "queue_item_id" = null, "error" = '{"message":"Interrupted by server restart"}' WHERE "is_generating" = true;