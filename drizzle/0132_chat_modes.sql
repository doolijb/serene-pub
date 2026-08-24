-- Chat modes: the mode is the input type (19 §0–§1, U-C1/U-C2).
--
-- `chat_shape` on the registry carries the shape contract for mode-bearing
-- input types, stored for the reason `slots` is: the mode picker and chat
-- settings render from rows (F6). `mode_id` on chats names each chat's mode;
-- the default is the F29 floor — `core:input/user-message@1`, the standard
-- chat, always present — which is also the backfill for every existing chat:
-- behaviour unchanged, now stated.
--
-- `user-message` re-projects because the shape is hashed contract (widening a
-- capability changes what existing sessions legally contain — the `optional`
-- lesson). Same narrow pre-release terms as 0127–0130.
ALTER TABLE "pipeline_type_registry" ADD COLUMN "chat_shape" json;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "mode_id" text DEFAULT 'core:input/user-message@1' NOT NULL;--> statement-breakpoint
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:input/user-message' AND "version" = 1;
