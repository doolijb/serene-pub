ALTER TABLE "passphrases" ADD COLUMN "invalidated_at" timestamp;--> statement-breakpoint
ALTER TABLE "passphrases" DROP COLUMN "updated_at";