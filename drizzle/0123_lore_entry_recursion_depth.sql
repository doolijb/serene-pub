-- Recursive lore triggering, as a per-entry ceiling.
--
-- A lorebook that describes a place, and separately the person who runs it, has
-- no way at one pass to bring the second in when only the first was named. That
-- is what recursion is for, and until now the code did one pass with no way to
-- ask for another.
--
-- NULL rather than `DEFAULT 0`, for the same reason `retrieval_strategy` is
-- nullable: an entry nobody has ruled on must stay distinguishable from one
-- somebody deliberately set to zero, or a later change of default silently
-- overrides a decision that was actually made. NULL means "no opinion", and the
-- query node's `maxRecursionDepth` — which itself defaults to 0 — decides. So
-- every existing install keeps exactly today's single-pass behaviour until
-- somebody turns the ceiling up.
ALTER TABLE "world_lore_entries" ADD COLUMN "recursion_depth" integer;--> statement-breakpoint
ALTER TABLE "character_lore_entries" ADD COLUMN "recursion_depth" integer;--> statement-breakpoint
ALTER TABLE "history_entries" ADD COLUMN "recursion_depth" integer;
