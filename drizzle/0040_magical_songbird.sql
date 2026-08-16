ALTER TABLE "chat_messages" ADD COLUMN "debug_meta" json;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "context_debugging_enabled" boolean DEFAULT false NOT NULL;