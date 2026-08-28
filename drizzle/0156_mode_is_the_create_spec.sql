-- The session type is the create spec (23 §7, ruled 2026-08-28): the standard
-- mode's identity moves from the input type to core:spec/create-chat. Existing
-- sessions and their per-mode function choices follow; the column default
-- speaks the new vocabulary. Plugin modes still spelled as input-type ids are
-- untouched — the transitional union in listSessionModes serves them.
UPDATE "sessions" SET "mode_id" = 'core:spec/create-chat' WHERE "mode_id" = 'core:input/user-message@1';
--> statement-breakpoint
UPDATE "session_functions" SET "mode_id" = 'core:spec/create-chat' WHERE "mode_id" = 'core:input/user-message@1';
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "mode_id" SET DEFAULT 'core:spec/create-chat';
