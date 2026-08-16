ALTER TABLE "users" DROP CONSTRAINT "users_active_connection_id_connections_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_active_sampling_id_sampling_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_active_context_config_id_context_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_active_prompt_config_id_prompt_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "active_connection_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "active_sampling_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "active_context_config_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "active_prompt_config_id";