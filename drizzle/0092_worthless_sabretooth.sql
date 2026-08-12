ALTER TABLE "character_summarize_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "context_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "graph_build_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "prompt_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "scene_summarize_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "world_summarize_configs" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "character_summarize_configs" ADD CONSTRAINT "character_summarize_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "context_configs" ADD CONSTRAINT "context_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "graph_build_configs" ADD CONSTRAINT "graph_build_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" ADD CONSTRAINT "narrator_prompt_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "prompt_configs" ADD CONSTRAINT "prompt_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD CONSTRAINT "sampling_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "scene_summarize_configs" ADD CONSTRAINT "scene_summarize_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
ALTER TABLE "world_summarize_configs" ADD CONSTRAINT "world_summarize_configs_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint

-- Backfill seed_key onto rows this app's seed (db/defaults.ts) created, so the
-- seed keeps matching them instead of inserting a second copy of every built-in
-- on the next boot.
--
-- Matched on id AND name together, not id alone: a row at a seeded id whose name
-- no longer matches is NOT one of ours. That case is real — a preset briefly
-- shipped at sampling_configs id 3 overwrote a user's own config, and this
-- migration must leave that row alone rather than adopt it.
UPDATE "sampling_configs" SET "seed_key" = 'sampling-default'  WHERE "id" = 1 AND "name" = 'Default';--> statement-breakpoint
UPDATE "sampling_configs" SET "seed_key" = 'sampling-disabled' WHERE "id" = 2 AND "name" = 'Disabled';--> statement-breakpoint

UPDATE "context_configs" SET "seed_key" = 'context-default' WHERE "id" = 1 AND "name" = 'Default';--> statement-breakpoint

UPDATE "prompt_configs" SET "seed_key" = 'prompt-roleplay-simple'    WHERE "id" = 1  AND "name" = 'Roleplay - Simple';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-roleplay-immersive' WHERE "id" = 2  AND "name" = 'Roleplay - Immersive';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-roleplay-detailed'  WHERE "id" = 3  AND "name" = 'Roleplay - Detailed';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-writer-realistic'   WHERE "id" = 4  AND "name" = 'Writer - Realistic';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-writer-creative'    WHERE "id" = 5  AND "name" = 'Writer - Creative';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-text-adventure'     WHERE "id" = 6  AND "name" = 'Text Adventure';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-neutral-chat'       WHERE "id" = 7  AND "name" = 'Neutral - Chat';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-lightning-1-1'      WHERE "id" = 8  AND "name" = 'Lightning 1.1';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-chain-of-thought'   WHERE "id" = 9  AND "name" = 'Chain of Thought';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-assistant-simple'   WHERE "id" = 10 AND "name" = 'Assistant - Simple';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-assistant-expert'   WHERE "id" = 11 AND "name" = 'Assistant - Expert';--> statement-breakpoint
UPDATE "prompt_configs" SET "seed_key" = 'prompt-actor'              WHERE "id" = 12 AND "name" = 'Actor';--> statement-breakpoint

UPDATE "narrator_prompt_configs" SET "seed_key" = 'narrator-default' WHERE "id" = 1 AND "name" = 'Narrator';--> statement-breakpoint

UPDATE "world_summarize_configs"     SET "seed_key" = 'summarize-world-default'     WHERE "id" = 1 AND "name" = 'Default World Summarization';--> statement-breakpoint
UPDATE "character_summarize_configs" SET "seed_key" = 'summarize-character-default' WHERE "id" = 1 AND "name" = 'Default Character Summarization';--> statement-breakpoint
UPDATE "scene_summarize_configs"     SET "seed_key" = 'summarize-scene-default'     WHERE "id" = 1 AND "name" = 'Default Scene Summarization';--> statement-breakpoint

UPDATE "graph_build_configs" SET "seed_key" = 'graph-build-default' WHERE "id" = 1 AND "name" = 'Default Graph Build';--> statement-breakpoint

UPDATE "users" SET "seed_key" = 'user-admin' WHERE "id" = 1 AND "username" = 'admin';--> statement-breakpoint

-- A row that is not ours has no business being flagged built-in: isImmutable
-- makes it un-editable AND un-deletable in the UI, so a user cannot repair it
-- themselves. The preset incident above left exactly such a row behind. Scoped
-- to sampling_configs because that is the only table where it has occurred.
UPDATE "sampling_configs" SET "is_immutable" = false WHERE "seed_key" IS NULL AND "is_immutable" = true;
