ALTER TABLE "sampling_configs" ADD COLUMN "min_p" real DEFAULT 0.05;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "min_p_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "typical_p" real DEFAULT 1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "typical_p_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "mirostat" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "mirostat_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "mirostat_tau" real DEFAULT 5;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "mirostat_tau_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "mirostat_eta" real DEFAULT 0.1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "mirostat_eta_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "xtc_probability" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "xtc_probability_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "xtc_threshold" real DEFAULT 0.1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "xtc_threshold_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_multiplier" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_multiplier_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_base" real DEFAULT 1.75;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_base_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_allowed_length" integer DEFAULT 2;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_allowed_length_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_penalty_last_n" integer DEFAULT -1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_penalty_last_n_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_sequence_breakers" json DEFAULT '["\\n",":","\"","*"]'::json;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dry_sequence_breakers_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dynatemp_range" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dynatemp_range_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dynatemp_exponent" real DEFAULT 1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "dynatemp_exponent_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "tfs_z" real DEFAULT 1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "tfs_z_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "repeat_last_n" integer DEFAULT 64;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "repeat_last_n_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "penalize_newline" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "penalize_newline_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "logit_bias" json DEFAULT '{}'::json;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "logit_bias_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "stop" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "stop_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "max_tokens" integer DEFAULT -1;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "max_tokens_enabled" boolean DEFAULT false NOT NULL;