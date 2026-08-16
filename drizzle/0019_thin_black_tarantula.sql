ALTER TABLE "system_settings" ADD COLUMN "default_connection_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "lock_connection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "default_sampling_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "lock_sampling_config" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "default_context_config_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "lock_context_config" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "default_prompt_config_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "lock_prompt_config" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "active_connection_id" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "active_sampling_id" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "active_context_config_id" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "active_prompt_config_id" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_connection_id_connections_id_fk" FOREIGN KEY ("default_connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_sampling_id_sampling_configs_id_fk" FOREIGN KEY ("default_sampling_id") REFERENCES "public"."sampling_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_context_config_id_context_configs_id_fk" FOREIGN KEY ("default_context_config_id") REFERENCES "public"."context_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_default_prompt_config_id_prompt_configs_id_fk" FOREIGN KEY ("default_prompt_config_id") REFERENCES "public"."prompt_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_connection_id_connections_id_fk" FOREIGN KEY ("active_connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_sampling_id_sampling_configs_id_fk" FOREIGN KEY ("active_sampling_id") REFERENCES "public"."sampling_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_context_config_id_context_configs_id_fk" FOREIGN KEY ("active_context_config_id") REFERENCES "public"."context_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_prompt_config_id_prompt_configs_id_fk" FOREIGN KEY ("active_prompt_config_id") REFERENCES "public"."prompt_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Data migration: Copy active configs from user ID 1 to user_settings and system_settings
DO $$
DECLARE
    user1_connection_id integer;
    user1_sampling_id integer;
    user1_context_id integer;
    user1_prompt_id integer;
BEGIN
    -- Check if user ID 1 exists and get their active configs
    SELECT 
        active_connection_id,
        active_sampling_id,
        active_context_config_id,
        active_prompt_config_id
    INTO 
        user1_connection_id,
        user1_sampling_id,
        user1_context_id,
        user1_prompt_id
    FROM users 
    WHERE id = 1;

    -- Only proceed if user ID 1 exists
    IF FOUND THEN
        -- Update user_settings for user ID 1 if a record exists
        UPDATE user_settings 
        SET 
            active_connection_id = user1_connection_id,
            active_sampling_id = user1_sampling_id,
            active_context_config_id = user1_context_id,
            active_prompt_config_id = user1_prompt_id
        WHERE user_id = 1;

        -- Update system_settings (assuming there's only one record)
        UPDATE system_settings 
        SET 
            default_connection_id = user1_connection_id,
            default_sampling_id = user1_sampling_id,
            default_context_config_id = user1_context_id,
            default_prompt_config_id = user1_prompt_id;

        RAISE NOTICE 'Copied active configs from user ID 1 to user_settings and system_settings';
    ELSE
        RAISE NOTICE 'User ID 1 not found, skipping data migration';
    END IF;
END $$;