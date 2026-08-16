-- Convert chats.metadata from TEXT to JSON with proper casting
ALTER TABLE "chats" ALTER COLUMN "metadata" SET DATA TYPE json USING 
  CASE 
    WHEN "metadata" IS NULL OR "metadata" = '' THEN '{}'::json
    ELSE "metadata"::json
  END;--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "metadata" SET DEFAULT '{}'::json;--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "metadata" SET NOT NULL;