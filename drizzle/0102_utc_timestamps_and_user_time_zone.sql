ALTER TABLE "characters" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "lorebooks" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lorebooks" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "lorebooks" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lorebooks" ALTER COLUMN "updated_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenes" ALTER COLUMN "updated_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "session_messages" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_messages" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "updated_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "updated_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_zone" text;