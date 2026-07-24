ALTER TABLE "narrator_prompt_configs" ADD COLUMN "post_history_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" ADD COLUMN "post_history_token_trigger" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_configs" ADD COLUMN "post_history_instructions" text;--> statement-breakpoint
ALTER TABLE "prompt_configs" ADD COLUMN "post_history_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_configs" ADD COLUMN "post_history_token_trigger" integer DEFAULT 0 NOT NULL;