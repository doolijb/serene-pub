-- Chat presets are folded into pipeline presets (ruled 2026-08-24).
--
-- `chat_presets` was a second, mode-scoped bundle that *selected* pipeline
-- configurations for a chat — one more thing between a person and the settings
-- their chat runs on, and one more place for "which configuration is this chat
-- using" to be answered. The answer is now one thing: a chat runs on a
-- **preset**, which is a pipeline configuration somebody is allowed to see and
-- use, chosen in chat settings and switchable there.
--
-- Nothing is stranded. Applying a chat preset only ever wrote chat-scope rows
-- in `pipeline_config_selections` — references, never copies — and those rows
-- are exactly what the new picker reads and writes. A chat that had a preset
-- applied keeps the selections it produced; what goes away is the bundle that
-- produced them, and the ability to un-apply it as a unit.
--
-- `applied_preset_id` goes with it: it existed so removal knew which
-- selections to delete, and there is no longer a removal to perform.
ALTER TABLE "chats" DROP COLUMN IF EXISTS "applied_preset_id";--> statement-breakpoint
DROP TABLE IF EXISTS "chat_presets";
