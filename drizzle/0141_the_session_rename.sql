-- Chats become sessions (ruled 2026-08-24).
--
-- The container is renamed, not re-meant: a **session** is the top-level thing
-- a mode runs in — a chat, a game, whatever ships next — and "Chat" survives
-- purely as the standard mode's display name (the F29 floor's i18n). The
-- window for this closes at 0.7-pre1, when the SDK vocabulary freezes; it is
-- taken now, pre-release, while every rename is an ALTER instead of an alias.
--
-- Four parts: table/column/index renames; the scope-kind value ('chat' rows
-- become 'session' rows, with their CHECKs re-stated); the core type registry
-- wiped for re-sync (type ids and port names changed — session-scope,
-- session-history, sessionId — so every core row re-projects at boot, the 0134
-- precedent applied wholesale); and the template scope key ({{chatMessages}}
-- becomes {{sessionMessages}} in stored and legacy sources, which changes no
-- rendered byte — the key never appears in output).
--
-- Foreign-key constraint names keep their historical spellings; nothing reads
-- them, and renaming every one buys nothing but migration bulk.

ALTER TABLE "chats" RENAME TO "sessions";--> statement-breakpoint
ALTER TABLE "chat_tags" RENAME TO "session_tags";--> statement-breakpoint
ALTER TABLE "chat_messages" RENAME TO "session_messages";--> statement-breakpoint
ALTER TABLE "chat_personas" RENAME TO "session_personas";--> statement-breakpoint
ALTER TABLE "chat_characters" RENAME TO "session_characters";--> statement-breakpoint
ALTER TABLE "chat_lorebooks" RENAME TO "session_lorebooks";--> statement-breakpoint
ALTER TABLE "chat_guests" RENAME TO "session_guests";--> statement-breakpoint
ALTER TABLE "chat_functions" RENAME TO "session_functions";--> statement-breakpoint

ALTER TABLE "sessions" RENAME COLUMN "chat_type" TO "session_type";--> statement-breakpoint
ALTER TABLE "session_tags" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "session_messages" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "session_personas" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "session_characters" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "session_lorebooks" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "session_guests" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "session_functions" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "scenes" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "pipeline_runs" RENAME COLUMN "chat_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "pipeline_type_registry" RENAME COLUMN "chat_shape" TO "session_shape";--> statement-breakpoint

ALTER INDEX IF EXISTS "chats_user_id_idx" RENAME TO "sessions_user_id_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_tags_unique" RENAME TO "session_tags_unique";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_messages_chat_id_idx" RENAME TO "session_messages_session_id_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_personas_pk" RENAME TO "session_personas_pk";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_personas_persona_id_idx" RENAME TO "session_personas_persona_id_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_characters_pk" RENAME TO "session_characters_pk";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_characters_character_id_idx" RENAME TO "session_characters_character_id_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_guests_pk" RENAME TO "session_guests_pk";--> statement-breakpoint
ALTER INDEX IF EXISTS "scenes_chat_id_idx" RENAME TO "scenes_session_id_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "chat_functions_chat_mode_fn_idx" RENAME TO "session_functions_session_mode_fn_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "pipeline_runs_chat_idx" RENAME TO "pipeline_runs_session_idx";--> statement-breakpoint

-- The scope kind: rows written under the old container name mean the same
-- thing under the new one, so they rename rather than reset.
UPDATE "pipeline_node_overrides" SET "scope_kind" = 'session' WHERE "scope_kind" = 'chat';--> statement-breakpoint
UPDATE "pipeline_config_selections" SET "scope_kind" = 'session' WHERE "scope_kind" = 'chat';--> statement-breakpoint
UPDATE "pipeline_function_bindings" SET "scope_kind" = 'session' WHERE "scope_kind" = 'chat';--> statement-breakpoint
UPDATE "pipeline_node_rebinds" SET "scope_kind" = 'session' WHERE "scope_kind" = 'chat';--> statement-breakpoint
ALTER TABLE "pipeline_node_overrides" DROP CONSTRAINT IF EXISTS "pipeline_node_overrides_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_node_overrides" ADD CONSTRAINT "pipeline_node_overrides_scope_check" CHECK ("scope_kind" = 'session');--> statement-breakpoint
ALTER TABLE "pipeline_config_selections" DROP CONSTRAINT IF EXISTS "pipeline_config_selections_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_config_selections" ADD CONSTRAINT "pipeline_config_selections_scope_check" CHECK ("scope_kind" IN ('instance', 'session'));--> statement-breakpoint
ALTER TABLE "pipeline_function_bindings" DROP CONSTRAINT IF EXISTS "pipeline_function_bindings_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_function_bindings" ADD CONSTRAINT "pipeline_function_bindings_scope_check" CHECK ("scope_kind" IN ('instance', 'session'));--> statement-breakpoint
ALTER TABLE "pipeline_node_rebinds" DROP CONSTRAINT IF EXISTS "pipeline_node_rebinds_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_node_rebinds" ADD CONSTRAINT "pipeline_node_rebinds_scope_check" CHECK ("scope_kind" IN ('instance', 'session'));--> statement-breakpoint

-- Core types re-project at boot with their renamed ids and ports.
DELETE FROM "pipeline_type_registry" WHERE "owner_plugin_id" IS NULL;--> statement-breakpoint

-- The template scope key. Rendered output never contains the key, so no
-- golden byte moves; stored sources and the legacy column both rewrite so
-- the upgrade-path copy carries the new name too.
UPDATE "pipeline_context_templates" SET "source" = REPLACE("source", 'chatMessages', 'sessionMessages') WHERE "source" LIKE '%chatMessages%';--> statement-breakpoint
UPDATE "pipeline_context_templates" SET "source" = REPLACE("source", 'chatMessage', 'sessionMessage') WHERE "source" LIKE '%chatMessage%';--> statement-breakpoint
UPDATE "pipeline_variable_templates" SET "source" = REPLACE("source", 'chatMessages', 'sessionMessages') WHERE "source" LIKE '%chatMessages%';--> statement-breakpoint
UPDATE "context_configs" SET "template" = REPLACE("template", 'chatMessages', 'sessionMessages') WHERE "template" LIKE '%chatMessages%';
