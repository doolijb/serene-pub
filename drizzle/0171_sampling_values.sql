-- Sampling configs become shape-keyed, so a config can describe something other
-- than text generation.
--
-- The table was thirty typed columns and thirty `<key>_enabled` booleans, which
-- is a layout that can only ever name *text* samplers. Image generation had two
-- ways in and both were bad: a second table, with its own seeding path, its own
-- picker and its own default-tracking column on system_settings; or image columns
-- sitting null on every text row. Either one makes the modality a branch in every
-- consumer, and neither survives the third modality.
--
-- So a row is now `{shape, values, enabled}` — an id saying which vocabulary it
-- speaks, an object of values, and the keys actually in play. The vocabulary
-- itself is declared in the SDK (sdk/src/sampling.ts), keyed by the same shape id
-- a provider declares, so a sampling config and the provider that consumes it
-- cannot drift into disagreeing about what a parameter is called.
--
-- Two kinds of key survive here without ever being sent to a backend: keys that
-- are switched off, and keys the shape does not declare. Neither is discarded —
-- turning a sampler off and on again must not lose the value you had, and the
-- UI-only `*_unlocked` flags below have nowhere else to live. `resolveSamplingValues`
-- is the single filter, and it runs on the way out.
--
-- Every existing row is text-gen, which is why the new column's default says so:
-- the conversion below is lossless for anything that was already set.
ALTER TABLE "sampling_configs" ADD COLUMN "shape" text DEFAULT 'core:shape/text-gen@1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "values" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_configs" ADD COLUMN "enabled" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint

-- The values, keyed by the camelCase names the adapters' key maps already use.
-- `json_strip_nulls` means a nullable column that was never written does not
-- become an explicit null; the resolver would treat one as unset anyway, but a
-- row that reads as what it actually holds is worth the function call.
--
-- `max_tokens` is carried across even though nothing reads it — no adapter and no
-- dispatch path ever consumed the column. It is absent from the SDK vocabulary,
-- so it falls through the resolver and is never sent; keeping it means the
-- conversion loses nothing that was on disk.
UPDATE "sampling_configs" SET "values" = json_strip_nulls(json_build_object(
	'temperature',          "temperature",
	'topP',                 "top_p",
	'topK',                 "top_k",
	'minP',                 "min_p",
	'typicalP',             "typical_p",
	'seed',                 "seed",
	'repetitionPenalty',    "repetition_penalty",
	'repeatLastN',          "repeat_last_n",
	'frequencyPenalty',     "frequency_penalty",
	'presencePenalty',      "presence_penalty",
	'penalizeNewline',      "penalize_newline",
	'mirostat',             "mirostat",
	'mirostatTau',          "mirostat_tau",
	'mirostatEta',          "mirostat_eta",
	'xtcProbability',       "xtc_probability",
	'xtcThreshold',         "xtc_threshold",
	'dryMultiplier',        "dry_multiplier",
	'dryBase',              "dry_base",
	'dryAllowedLength',     "dry_allowed_length",
	'dryPenaltyLastN',      "dry_penalty_last_n",
	'drySequenceBreakers',  "dry_sequence_breakers",
	'dynatempRange',        "dynatemp_range",
	'dynatempExponent',     "dynatemp_exponent",
	'tfsZ',                 "tfs_z",
	'responseTokens',       "response_tokens",
	'contextTokens',        "context_tokens",
	'stop',                 "stop",
	'logitBias',            "logit_bias",
	'maxTokens',            "max_tokens",
	-- Not parameters: form state for the two budget fields, which the sidebar
	-- reads to decide whether to cap their sliders. They are absent from the
	-- vocabulary, so they never reach an adapter.
	'responseTokensUnlocked', "response_tokens_unlocked",
	'contextTokensUnlocked',  "context_tokens_unlocked"
));--> statement-breakpoint

-- The switchboard. Written as a fold of single-element arrays rather than an
-- aggregate over a VALUES list, because that form needs no correlated subquery
-- and is impossible to get subtly wrong. Every `*_enabled` column is NOT NULL,
-- so there is no third state to handle.
UPDATE "sampling_configs" SET "enabled" = (
	(CASE WHEN "temperature_enabled"           THEN '["temperature"]'::jsonb          ELSE '[]'::jsonb END) ||
	(CASE WHEN "top_p_enabled"                 THEN '["topP"]'::jsonb                 ELSE '[]'::jsonb END) ||
	(CASE WHEN "top_k_enabled"                 THEN '["topK"]'::jsonb                 ELSE '[]'::jsonb END) ||
	(CASE WHEN "min_p_enabled"                 THEN '["minP"]'::jsonb                 ELSE '[]'::jsonb END) ||
	(CASE WHEN "typical_p_enabled"             THEN '["typicalP"]'::jsonb             ELSE '[]'::jsonb END) ||
	(CASE WHEN "seed_enabled"                  THEN '["seed"]'::jsonb                 ELSE '[]'::jsonb END) ||
	(CASE WHEN "repetition_penalty_enabled"    THEN '["repetitionPenalty"]'::jsonb    ELSE '[]'::jsonb END) ||
	(CASE WHEN "repeat_last_n_enabled"         THEN '["repeatLastN"]'::jsonb          ELSE '[]'::jsonb END) ||
	(CASE WHEN "frequency_penalty_enabled"     THEN '["frequencyPenalty"]'::jsonb     ELSE '[]'::jsonb END) ||
	(CASE WHEN "presence_penalty_enabled"      THEN '["presencePenalty"]'::jsonb      ELSE '[]'::jsonb END) ||
	(CASE WHEN "penalize_newline_enabled"      THEN '["penalizeNewline"]'::jsonb      ELSE '[]'::jsonb END) ||
	(CASE WHEN "mirostat_enabled"              THEN '["mirostat"]'::jsonb             ELSE '[]'::jsonb END) ||
	(CASE WHEN "mirostat_tau_enabled"          THEN '["mirostatTau"]'::jsonb          ELSE '[]'::jsonb END) ||
	(CASE WHEN "mirostat_eta_enabled"          THEN '["mirostatEta"]'::jsonb          ELSE '[]'::jsonb END) ||
	(CASE WHEN "xtc_probability_enabled"       THEN '["xtcProbability"]'::jsonb       ELSE '[]'::jsonb END) ||
	(CASE WHEN "xtc_threshold_enabled"         THEN '["xtcThreshold"]'::jsonb         ELSE '[]'::jsonb END) ||
	(CASE WHEN "dry_multiplier_enabled"        THEN '["dryMultiplier"]'::jsonb        ELSE '[]'::jsonb END) ||
	(CASE WHEN "dry_base_enabled"              THEN '["dryBase"]'::jsonb              ELSE '[]'::jsonb END) ||
	(CASE WHEN "dry_allowed_length_enabled"    THEN '["dryAllowedLength"]'::jsonb     ELSE '[]'::jsonb END) ||
	(CASE WHEN "dry_penalty_last_n_enabled"    THEN '["dryPenaltyLastN"]'::jsonb      ELSE '[]'::jsonb END) ||
	(CASE WHEN "dry_sequence_breakers_enabled" THEN '["drySequenceBreakers"]'::jsonb  ELSE '[]'::jsonb END) ||
	(CASE WHEN "dynatemp_range_enabled"        THEN '["dynatempRange"]'::jsonb        ELSE '[]'::jsonb END) ||
	(CASE WHEN "dynatemp_exponent_enabled"     THEN '["dynatempExponent"]'::jsonb     ELSE '[]'::jsonb END) ||
	(CASE WHEN "tfs_z_enabled"                 THEN '["tfsZ"]'::jsonb                 ELSE '[]'::jsonb END) ||
	(CASE WHEN "response_tokens_enabled"       THEN '["responseTokens"]'::jsonb       ELSE '[]'::jsonb END) ||
	(CASE WHEN "context_tokens_enabled"        THEN '["contextTokens"]'::jsonb        ELSE '[]'::jsonb END) ||
	(CASE WHEN "stop_enabled"                  THEN '["stop"]'::jsonb                 ELSE '[]'::jsonb END) ||
	(CASE WHEN "logit_bias_enabled"            THEN '["logitBias"]'::jsonb            ELSE '[]'::jsonb END)
)::json;--> statement-breakpoint

-- `max_tokens_enabled` is deliberately not folded in above: the key is not in the
-- vocabulary, so listing it as enabled would be a claim the resolver immediately
-- discards. The value it guarded is preserved in `values` regardless.
ALTER TABLE "sampling_configs" DROP COLUMN "temperature";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "temperature_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "top_p";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "top_p_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "top_k";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "top_k_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "repetition_penalty";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "repetition_penalty_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "frequency_penalty";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "frequency_penalty_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "presence_penalty";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "presence_penalty_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "response_tokens";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "response_tokens_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "response_tokens_unlocked";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "context_tokens";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "context_tokens_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "context_tokens_unlocked";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "seed";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "seed_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "min_p";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "min_p_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "typical_p";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "typical_p_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "mirostat";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "mirostat_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "mirostat_tau";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "mirostat_tau_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "mirostat_eta";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "mirostat_eta_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "xtc_probability";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "xtc_probability_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "xtc_threshold";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "xtc_threshold_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_multiplier";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_multiplier_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_base";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_base_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_allowed_length";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_allowed_length_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_penalty_last_n";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_penalty_last_n_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_sequence_breakers";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dry_sequence_breakers_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dynatemp_range";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dynatemp_range_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dynatemp_exponent";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "dynatemp_exponent_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "tfs_z";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "tfs_z_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "repeat_last_n";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "repeat_last_n_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "penalize_newline";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "penalize_newline_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "logit_bias";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "logit_bias_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "stop";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "stop_enabled";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "max_tokens";--> statement-breakpoint
ALTER TABLE "sampling_configs" DROP COLUMN "max_tokens_enabled";
