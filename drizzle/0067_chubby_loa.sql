ALTER TABLE "chat_world_prompt_configs" RENAME TO "narrator_prompt_configs";--> statement-breakpoint
ALTER TABLE "chat_messages" RENAME COLUMN "is_world_response" TO "is_narrator_response";--> statement-breakpoint
ALTER TABLE "chats" RENAME COLUMN "chat_world_prompt_config_id" TO "narrator_prompt_config_id";--> statement-breakpoint
ALTER TABLE "system_settings" RENAME COLUMN "default_chat_world_prompt_config_id" TO "default_narrator_prompt_config_id";--> statement-breakpoint
ALTER TABLE "user_settings" RENAME COLUMN "active_chat_world_prompt_config_id" TO "active_narrator_prompt_config_id";--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" DROP CONSTRAINT "chat_world_prompt_configs_connection_id_connections_id_fk";
--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" DROP CONSTRAINT "chat_world_prompt_configs_sampling_config_id_sampling_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_chat_world_prompt_config_id_chat_world_prompt_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "system_settings" DROP CONSTRAINT "system_settings_default_chat_world_prompt_config_id_chat_world_prompt_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "user_settings" DROP CONSTRAINT "user_settings_active_chat_world_prompt_config_id_chat_world_prompt_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" ALTER COLUMN "narrator_name" SET DEFAULT 'Narrator';--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" ADD CONSTRAINT "narrator_prompt_configs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrator_prompt_configs" ADD CONSTRAINT "narrator_prompt_configs_sampling_config_id_sampling_configs_id_fk" FOREIGN KEY ("sampling_config_id") REFERENCES "public"."sampling_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_narrator_prompt_config_id_narrator_prompt_configs_id_fk" FOREIGN KEY ("narrator_prompt_config_id") REFERENCES "public"."narrator_prompt_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_narrator_prompt_config_id_narrator_prompt_configs_id_fk" FOREIGN KEY ("default_narrator_prompt_config_id") REFERENCES "public"."narrator_prompt_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_narrator_prompt_config_id_narrator_prompt_configs_id_fk" FOREIGN KEY ("active_narrator_prompt_config_id") REFERENCES "public"."narrator_prompt_configs"("id") ON DELETE set null ON UPDATE no action;