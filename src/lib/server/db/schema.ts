import { relations, sql } from "drizzle-orm"
import {
	pgTable,
	integer,
	bigint,
	text,
	real,
	boolean,
	uniqueIndex,
	index,
	json,
	date,
	type AnyPgColumn,
	numeric,
	timestamp,
	varchar,
	uuid,
	check
} from "drizzle-orm/pg-core"

// ─── Enumerated value types ───────────────────────────────────────────────────

export type NodeState = "active" | "deceased" | "missing" | "departed"
export type NodeVisibility = "normal" | "legendary" | "hidden"
export type RelationshipVisibility = "secret" | "acknowledged" | "public"
import { GroupReplyStrategies } from "../../shared/constants/GroupReplyStrategies"
import { SessionCharacterVisibility } from "../../shared/constants/SessionCharacterVisibility"
import { SessionTypes } from "../../shared/constants/SessionTypes"

export const users = pgTable(
	"users",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable seed identity, e.g. "sampling-default". NULL for user-created
		 *  rows — see db/defaults.ts for why matching on id was unsafe. */
		seedKey: text("seed_key").unique(),
		username: text("username").notNull(),
		displayName: text("display_name"),
		theme: text("theme").notNull().default("hamlindigo"), // Remove next
		darkMode: boolean("dark_mode").notNull().default(true), // Remove next
		isAdmin: boolean("is_admin").notNull().default(false),
		isDeleted: boolean("is_deleted").notNull().default(false),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(t) => [
		// Without this, a check-then-insert race in users.ts's create handler
		// could let two concurrent signups with the same username both
		// succeed, after which username-keyed lookups (login, auth) resolve
		// nondeterministically.
		uniqueIndex("users_username_unique").on(t.username)
	]
)

export const userRelations = relations(users, ({ many, one }) => ({
	lorebooks: many(lorebooks),
	characters: many(characters),
	sessions: many(sessions),
	sessionGuests: many(sessionGuests),
	tags: many(tags),
	personas: many(personas),
	userSettings: one(userSettings),
	passphrases: many(passphrases)
}))

export const userSettings = pgTable(
	"user_settings",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		activeContextConfigId: integer("active_context_config_id").references(
			() => contextConfigs.id,
			{
				onDelete: "set null"
			}
		),
		activePromptConfigId: integer("active_prompt_config_id").references(
			() => promptConfigs.id,
			{
				onDelete: "set null"
			}
		),
		activeNarratorPromptConfigId: integer(
			"active_narrator_prompt_config_id"
		).references(() => narratorPromptConfigs.id, {
			onDelete: "set null"
		}),
		activeSummarizeWorldConfigId: integer(
			"active_summarize_world_config_id"
		).references(() => worldSummarizeConfigs.id, { onDelete: "set null" }),
		activeSummarizeCharacterConfigId: integer(
			"active_summarize_character_config_id"
		).references(() => characterSummarizeConfigs.id, {
			onDelete: "set null"
		}),
		activeSummarizeSceneConfigId: integer(
			"active_summarize_scene_config_id"
		).references(() => sceneSummarizeConfigs.id, { onDelete: "set null" }),
		theme: text("theme").notNull().default("hamlindigo"),
		darkMode: boolean("dark_mode").notNull().default(true),
		showHomePageBanner: boolean("show_home_page_banner").default(true),
		enableEasyPersonaCreation: boolean("enable_easy_persona_creation")
			.notNull()
			.default(true),
		enableEasyCharacterCreation: boolean("enable_easy_character_creation")
			.notNull()
			.default(true),
		showAllCharacterFields: boolean("show_all_character_fields")
			.notNull()
			.default(false),
		backgroundImagePath: text("background_image_path"),
		backgroundOpacity: integer("background_opacity").notNull().default(75),
		// Personal viewing preference — independent of who owns the underlying
		// CharaVault account (a single admin-configured, instance-wide
		// credential; see systemSettings.charaVaultEmail). Only has any effect
		// when ENABLE_UNSAFE_CHARACTER_BROWSING is set.
		charaVaultIncludeNsfw: boolean("chara_vault_include_nsfw")
			.notNull()
			.default(false),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => [uniqueIndex("user_settings_user_id_unique").on(table.userId)]
)

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
	user: one(users, {
		fields: [userSettings.userId],
		references: [users.id]
	}),
	activeContextConfig: one(contextConfigs, {
		fields: [userSettings.activeContextConfigId],
		references: [contextConfigs.id]
	}),
	activePromptConfig: one(promptConfigs, {
		fields: [userSettings.activePromptConfigId],
		references: [promptConfigs.id]
	}),
	activeNarratorPromptConfig: one(narratorPromptConfigs, {
		fields: [userSettings.activeNarratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	activeSummarizeWorldConfig: one(worldSummarizeConfigs, {
		fields: [userSettings.activeSummarizeWorldConfigId],
		references: [worldSummarizeConfigs.id]
	}),
	activeSummarizeCharacterConfig: one(characterSummarizeConfigs, {
		fields: [userSettings.activeSummarizeCharacterConfigId],
		references: [characterSummarizeConfigs.id]
	}),
	activeSummarizeSceneConfig: one(sceneSummarizeConfigs, {
		fields: [userSettings.activeSummarizeSceneConfigId],
		references: [sceneSummarizeConfigs.id]
	})
}))

export const passphrases = pgTable(
	"passphrases",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		hash: text("hash").notNull(),
		salt: varchar("salt", { length: 512 }).notNull(),
		iterations: numeric("iterations").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		invalidatedAt: timestamp("invalidated_at")
	},
	(t) => [uniqueIndex("unique_user_passphrases").on(t.userId)]
)

export const passphrasesRelations = relations(passphrases, ({ one }) => ({
	user: one(users, {
		fields: [passphrases.userId],
		references: [users.id]
	})
}))

export const userTokens = pgTable("user_tokens", {
	id: uuid("id")
		.primaryKey()
		.default(sql`(gen_random_uuid ())`),
	// Nullable: onDelete "set null" on a notNull column is a contradiction
	// Postgres can't actually satisfy — it would throw the moment the
	// cascade fired on a real hard delete. In practice usersDelete deletes
	// these rows outright (see users.ts) rather than relying on this FK, but
	// the constraint itself still needs to be satisfiable.
	userId: integer("user_id").references(() => users.id, {
		onDelete: "set null"
	}),
	token: text("token").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	expiresAt: timestamp("expires_at").notNull(),
	browser: varchar("browser", { length: 256 }).notNull(),
	os: varchar("os", { length: 256 }).notNull()
})

export const usersTokenRelations = relations(userTokens, ({ many, one }) => ({
	user: one(users, {
		fields: [userTokens.userId],
		references: [users.id]
	})
}))

export const samplingConfigs = pgTable("sampling_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	name: text("name").notNull(), // Name for this sampling config (for selection)
	isImmutable: boolean("is_immutable").notNull().default(false), // Is this the built-in config? Then we don't want to allow mutation/deletion

	// Tuned defaults for roleplay:
	// More creative and less repetitive
	temperature: real("temperature").notNull().default(0.7), // Higher = more creative
	temperatureEnabled: boolean("temperature_enabled").notNull().default(true),

	topP: real("top_p").default(0.92), // Lower than 1, encourages diversity but not too random
	topPEnabled: boolean("top_p_enabled").notNull().default(false),

	topK: integer("top_k").default(80), // Allows more token options for creative replies
	topKEnabled: boolean("top_k_enabled").notNull().default(false),

	repetitionPenalty: real("repetition_penalty").default(1.15), // Slightly encourages less repetition but not too harsh
	repetitionPenaltyEnabled: boolean("repetition_penalty_enabled")
		.notNull()
		.default(false),

	frequencyPenalty: real("frequency_penalty").default(0.2), // Mild penalty for repetitive phrases
	frequencyPenaltyEnabled: boolean("frequency_penalty_enabled")
		.notNull()
		.default(false),

	presencePenalty: real("presence_penalty").default(0.6), // Encourage new topics and freshness
	presencePenaltyEnabled: boolean("presence_penalty_enabled")
		.notNull()
		.default(false),

	responseTokens: integer("response_tokens").default(512), // Allow longer, richer replies
	responseTokensEnabled: boolean("response_tokens_enabled")
		.notNull()
		.default(true),
	responseTokensUnlocked: boolean("response_tokens_unlocked")
		.notNull()
		.default(false), // Dynamic length allowed

	contextTokens: integer("context_tokens").default(4096), // Keep more conversation in memory/context
	contextTokensEnabled: boolean("context_tokens_enabled")
		.notNull()
		.default(true),
	contextTokensUnlocked: boolean("context_tokens_unlocked")
		.notNull()
		.default(false), // Allow for context window expansion

	seed: integer("seed").default(-1), // -1 for random, can be used for deterministic sampling
	seedEnabled: boolean("seed_enabled").notNull().default(false),
	// Min-P sampling
	minP: real("min_p").default(0.05),
	minPEnabled: boolean("min_p_enabled").notNull().default(false),
	// Typical-P sampling
	typicalP: real("typical_p").default(1.0),
	typicalPEnabled: boolean("typical_p_enabled").notNull().default(false),
	// Mirostat sampling
	mirostat: integer("mirostat").default(0), // 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0
	mirostatEnabled: boolean("mirostat_enabled").notNull().default(false),
	mirostatTau: real("mirostat_tau").default(5.0),
	mirostatTauEnabled: boolean("mirostat_tau_enabled")
		.notNull()
		.default(false),
	mirostatEta: real("mirostat_eta").default(0.1),
	mirostatEtaEnabled: boolean("mirostat_eta_enabled")
		.notNull()
		.default(false),
	// XTC sampling
	xtcProbability: real("xtc_probability").default(0.0),
	xtcProbabilityEnabled: boolean("xtc_probability_enabled")
		.notNull()
		.default(false),
	xtcThreshold: real("xtc_threshold").default(0.1),
	xtcThresholdEnabled: boolean("xtc_threshold_enabled")
		.notNull()
		.default(false),
	// DRY sampling
	dryMultiplier: real("dry_multiplier").default(0.0),
	dryMultiplierEnabled: boolean("dry_multiplier_enabled")
		.notNull()
		.default(false),
	dryBase: real("dry_base").default(1.75),
	dryBaseEnabled: boolean("dry_base_enabled").notNull().default(false),
	dryAllowedLength: integer("dry_allowed_length").default(2),
	dryAllowedLengthEnabled: boolean("dry_allowed_length_enabled")
		.notNull()
		.default(false),
	dryPenaltyLastN: integer("dry_penalty_last_n").default(-1),
	dryPenaltyLastNEnabled: boolean("dry_penalty_last_n_enabled")
		.notNull()
		.default(false),
	drySequenceBreakers: json("dry_sequence_breakers")
		.default(["\\n", ":", '"', "*"])
		.$type<string[]>(),
	drySequenceBreakersEnabled: boolean("dry_sequence_breakers_enabled")
		.notNull()
		.default(false),
	// Dynamic temperature
	dynatempRange: real("dynatemp_range").default(0.0),
	dynatempRangeEnabled: boolean("dynatemp_range_enabled")
		.notNull()
		.default(false),
	dynatempExponent: real("dynatemp_exponent").default(1.0),
	dynatempExponentEnabled: boolean("dynatemp_exponent_enabled")
		.notNull()
		.default(false),
	// Additional Ollama-specific
	tfsZ: real("tfs_z").default(1.0),
	tfsZEnabled: boolean("tfs_z_enabled").notNull().default(false),
	repeatLastN: integer("repeat_last_n").default(64),
	repeatLastNEnabled: boolean("repeat_last_n_enabled")
		.notNull()
		.default(false),
	penalizeNewline: boolean("penalize_newline").default(false),
	penalizeNewlineEnabled: boolean("penalize_newline_enabled")
		.notNull()
		.default(false),
	// OpenAI-specific
	logitBias: json("logit_bias").default({}).$type<Record<string, number>>(),
	logitBiasEnabled: boolean("logit_bias_enabled").notNull().default(false),
	// Stop sequences
	stop: json("stop").default([]).$type<string[]>(),
	stopEnabled: boolean("stop_enabled").notNull().default(false),
	// Max tokens (alternative to responseTokens for OpenAI compatibility)
	maxTokens: integer("max_tokens").default(-1),
	maxTokensEnabled: boolean("max_tokens_enabled").notNull().default(false)
})

export const samplingRelations = relations(samplingConfigs, () => ({}))

export const connections = pgTable("connections", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull(), // Connection name (e.g., ollama, llama, sessiongpt)
	type: text("type").notNull(), // Connection type/category (e.g., ollama, sessiongpt, etc)
	baseUrl: text("base_url"), // Base URL or endpoint for API
	model: text("model"), // Model name or identifier
	// Ollama-specific options
	extraJson: json("extra_json")
		.notNull()
		.default({})
		.$type<Record<string, any>>(), // Additional JSON options for the connections, api keys, etc.
	tokenCounter: text("token_counter").notNull().default("estimate"),
	promptFormat: text("prompt_format").default("vicuna")
})

export const connectionsRelations = relations(connections, () => ({}))

/**
 * Stop scripts attached to a connection (18 §4b) — the rides-along pattern.
 *
 * Stop behavior is usually a property of the *model*, not the story: "this
 * endpoint leaks ChatML", "this one echoes the speaker line" travel with the
 * endpoint, and every pipeline that runs against the connection — core's and
 * any extension's — inherits the guards with no wiring. Legal here because
 * stops are order-free (a min-reduction, 18 §5), so merging the connection's
 * set with a pipeline's chain needs no precedence rule.
 *
 * Only `core:script:text/stop@1` rows may attach — the entity layer refuses
 * anything else, because entity attachment is limited to operations whose
 * content actually flows through the entity (18 §4b's scope guard). `position`
 * is display order only; verdicts do not care.
 */
export const connectionScripts = pgTable(
	"connection_scripts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		connectionId: integer("connection_id")
			.notNull()
			.references(() => connections.id, { onDelete: "cascade" }),
		scriptId: integer("script_id")
			.notNull()
			.references(() => pipelineScripts.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("connection_scripts_pair_idx").on(
			t.connectionId,
			t.scriptId
		),
		index("connection_scripts_script_idx").on(t.scriptId)
	]
)

export const contextConfigs = pgTable("context_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/**
	 * Which template language `template` is written in — a registry id, not a
	 * hardcoded assumption (12 §2a).
	 *
	 * NULL means core's default, which is Handlebars. Stored rather than assumed
	 * so an extension can register its own engine and supply the renderer for
	 * it: the schema describes what the template *is*, and core resolves who can
	 * render it at run time. Without this column, "core renders Handlebars" is a
	 * fact buried in code, and a plugin shipping a different assembler would
	 * have nowhere to say so.
	 */
	engine: text("engine"),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	template: text("template") // Sillytavern storyString
})

export const contextConfigsRelations = relations(contextConfigs, () => ({}))

export const promptConfigs = pgTable("prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	// Reinforcement inserted right before the model's generation point —
	// after all session history, immediately preceding the seed turn — rather
	// than only at the top of a long prompt alongside systemPrompt. Mirrors
	// narratorPromptConfigs.postHistoryInstructions below.
	postHistoryInstructions: text("post_history_instructions"),
	// Number of messages back from the last message the post-history block
	// is positioned at. 0 = immediately after the last message (default).
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	// Minimum token count of session history required before
	// postHistoryInstructions is included — lets short sessions skip the
	// reminder since the system prompt is still close by. 0 = always
	// included.
	postHistoryTokenTrigger: integer("post_history_token_trigger")
		.notNull()
		.default(0),
	connectionId: integer("connection_id").references(() => connections.id, {
		onDelete: "set null"
	}),
	samplingConfigId: integer("sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	)
})

export const promptConfigsRelations = relations(promptConfigs, ({ one }) => ({
	connection: one(connections, {
		fields: [promptConfigs.connectionId],
		references: [connections.id]
	}),
	samplingConfig: one(samplingConfigs, {
		fields: [promptConfigs.samplingConfigId],
		references: [samplingConfigs.id]
	})
}))

// "session" prefix is deliberate: this is a prompt config scoped to the
// standard roleplay session type specifically, so a future narrator/environment
// config for a different session type can't collide with it.
export const narratorPromptConfigs = pgTable("narrator_prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	// Session-facing display name/label shown on messages generated with this
	// config (e.g. "Narrator", "The World", "Fate") — distinct from
	// `name` above, which only identifies the config itself in the sidebar.
	narratorName: text("narrator_name").notNull().default("Narrator"),
	// Reinforcement inserted right before the model's generation point —
	// after all session history, immediately preceding the seed turn — rather
	// than only at the top of a long prompt alongside systemPrompt. Far more
	// effective against a model drifting back into character-dialogue
	// patterns established over many prior turns. See defaults.ts's context
	// template for exactly where this lands relative to the seed.
	postHistoryInstructions: text("post_history_instructions"),
	// Number of messages back from the last message the post-history block
	// is positioned at. 0 = immediately after the last message (default).
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	// Minimum token count of session history required before
	// postHistoryInstructions is included. 0 = always included — the
	// Narrator's own seed keeps this at 0 so it's always reinforced.
	postHistoryTokenTrigger: integer("post_history_token_trigger")
		.notNull()
		.default(0),
	systemPrompt: text("system_prompt").notNull(),
	connectionId: integer("connection_id").references(() => connections.id, {
		onDelete: "set null"
	}),
	samplingConfigId: integer("sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	)
})

export const narratorPromptConfigsRelations = relations(
	narratorPromptConfigs,
	({ one }) => ({
		connection: one(connections, {
			fields: [narratorPromptConfigs.connectionId],
			references: [connections.id]
		}),
		samplingConfig: one(samplingConfigs, {
			fields: [narratorPromptConfigs.samplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const worldSummarizeConfigs = pgTable("world_summarize_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	batchSystemPrompt: text("batch_system_prompt").notNull(),
	synthSystemPrompt: text("synth_system_prompt").notNull(),
	nameSystemPrompt: text("name_system_prompt").notNull(),
	batchConnectionId: integer("batch_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	batchSamplingConfigId: integer("batch_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	synthConnectionId: integer("synth_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	synthSamplingConfigId: integer("synth_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	nameConnectionId: integer("name_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	nameSamplingConfigId: integer("name_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	)
})

export const worldSummarizeConfigsRelations = relations(
	worldSummarizeConfigs,
	({ one }) => ({
		batchConnection: one(connections, {
			fields: [worldSummarizeConfigs.batchConnectionId],
			references: [connections.id]
		}),
		batchSamplingConfig: one(samplingConfigs, {
			fields: [worldSummarizeConfigs.batchSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		synthConnection: one(connections, {
			fields: [worldSummarizeConfigs.synthConnectionId],
			references: [connections.id]
		}),
		synthSamplingConfig: one(samplingConfigs, {
			fields: [worldSummarizeConfigs.synthSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nameConnection: one(connections, {
			fields: [worldSummarizeConfigs.nameConnectionId],
			references: [connections.id]
		}),
		nameSamplingConfig: one(samplingConfigs, {
			fields: [worldSummarizeConfigs.nameSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const characterSummarizeConfigs = pgTable(
	"character_summarize_configs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable seed identity, e.g. "sampling-default". NULL for user-created
		 *  rows — see db/defaults.ts for why matching on id was unsafe. */
		seedKey: text("seed_key").unique(),
		isImmutable: boolean("is_immutable").notNull().default(false),
		name: text("name").notNull(),
		batchSystemPrompt: text("batch_system_prompt").notNull(),
		synthSystemPrompt: text("synth_system_prompt").notNull(),
		nameSystemPrompt: text("name_system_prompt").notNull(),
		batchConnectionId: integer("batch_connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		batchSamplingConfigId: integer("batch_sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		),
		synthConnectionId: integer("synth_connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		synthSamplingConfigId: integer("synth_sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		),
		nameConnectionId: integer("name_connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		nameSamplingConfigId: integer("name_sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		)
	}
)

export const characterSummarizeConfigsRelations = relations(
	characterSummarizeConfigs,
	({ one }) => ({
		batchConnection: one(connections, {
			fields: [characterSummarizeConfigs.batchConnectionId],
			references: [connections.id]
		}),
		batchSamplingConfig: one(samplingConfigs, {
			fields: [characterSummarizeConfigs.batchSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		synthConnection: one(connections, {
			fields: [characterSummarizeConfigs.synthConnectionId],
			references: [connections.id]
		}),
		synthSamplingConfig: one(samplingConfigs, {
			fields: [characterSummarizeConfigs.synthSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nameConnection: one(connections, {
			fields: [characterSummarizeConfigs.nameConnectionId],
			references: [connections.id]
		}),
		nameSamplingConfig: one(samplingConfigs, {
			fields: [characterSummarizeConfigs.nameSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const sceneSummarizeConfigs = pgTable("scene_summarize_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	batchSystemPrompt: text("batch_system_prompt").notNull(),
	synthSystemPrompt: text("synth_system_prompt").notNull(),
	nameSystemPrompt: text("name_system_prompt").notNull(),
	characterExtractionSystemPrompt: text("character_extraction_system_prompt")
		.notNull()
		.default(""),
	batchConnectionId: integer("batch_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	batchSamplingConfigId: integer("batch_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	synthConnectionId: integer("synth_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	synthSamplingConfigId: integer("synth_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	nameConnectionId: integer("name_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	nameSamplingConfigId: integer("name_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	characterExtractionConnectionId: integer(
		"character_extraction_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	characterExtractionSamplingConfigId: integer(
		"character_extraction_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" })
})

export const sceneSummarizeConfigsRelations = relations(
	sceneSummarizeConfigs,
	({ one }) => ({
		batchConnection: one(connections, {
			fields: [sceneSummarizeConfigs.batchConnectionId],
			references: [connections.id]
		}),
		batchSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.batchSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		synthConnection: one(connections, {
			fields: [sceneSummarizeConfigs.synthConnectionId],
			references: [connections.id]
		}),
		synthSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.synthSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nameConnection: one(connections, {
			fields: [sceneSummarizeConfigs.nameConnectionId],
			references: [connections.id]
		}),
		nameSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.nameSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		characterExtractionConnection: one(connections, {
			fields: [sceneSummarizeConfigs.characterExtractionConnectionId],
			references: [connections.id]
		}),
		characterExtractionSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.characterExtractionSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const graphBuildConfigs = pgTable("graph_build_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	nodeResolutionSystemPrompt: text("node_resolution_system_prompt")
		.notNull()
		.default(""),
	preFilterSystemPrompt: text("pre_filter_system_prompt")
		.notNull()
		.default(""),
	perspectiveSystemPrompt: text("perspective_system_prompt")
		.notNull()
		.default(""),
	nodeResolutionConnectionId: integer(
		"node_resolution_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	nodeResolutionSamplingConfigId: integer(
		"node_resolution_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	preFilterConnectionId: integer("pre_filter_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	preFilterSamplingConfigId: integer(
		"pre_filter_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	perspectiveConnectionId: integer("perspective_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	perspectiveSamplingConfigId: integer(
		"perspective_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	/** Prose, not JSON — the two-sentence intro written for a new character. */
	nodeDescriptionSystemPrompt: text("node_description_system_prompt")
		.notNull()
		.default(""),
	nodeDescriptionConnectionId: integer(
		"node_description_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	nodeDescriptionSamplingConfigId: integer(
		"node_description_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	/** Did any present character reach a new lifecycle state this scene? */
	stateDetectionSystemPrompt: text("state_detection_system_prompt")
		.notNull()
		.default(""),
	stateDetectionConnectionId: integer(
		"state_detection_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	stateDetectionSamplingConfigId: integer(
		"state_detection_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" })
})

export const graphBuildConfigsRelations = relations(
	graphBuildConfigs,
	({ one }) => ({
		nodeResolutionConnection: one(connections, {
			fields: [graphBuildConfigs.nodeResolutionConnectionId],
			references: [connections.id]
		}),
		nodeResolutionSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.nodeResolutionSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		preFilterConnection: one(connections, {
			fields: [graphBuildConfigs.preFilterConnectionId],
			references: [connections.id]
		}),
		preFilterSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.preFilterSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		perspectiveConnection: one(connections, {
			fields: [graphBuildConfigs.perspectiveConnectionId],
			references: [connections.id]
		}),
		perspectiveSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.perspectiveSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nodeDescriptionConnection: one(connections, {
			fields: [graphBuildConfigs.nodeDescriptionConnectionId],
			references: [connections.id]
		}),
		nodeDescriptionSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.nodeDescriptionSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		stateDetectionConnection: one(connections, {
			fields: [graphBuildConfigs.stateDetectionConnectionId],
			references: [connections.id]
		}),
		stateDetectionSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.stateDetectionSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const lorebooks = pgTable(
	"lorebooks",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Stable, DB-generated identity for export/import dedup — never
		// user-edited or regenerated. Backfills automatically on migration
		// (default value applies to existing rows too), so there's no app-side
		// generation or backfill script anywhere. Matches the existing
		// userTokens.id column's exact pattern.
		uuid: uuid("uuid")
			.notNull()
			.default(sql`(gen_random_uuid ())`),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		// Monotonic per-lorebook counter for {{char:N}} token numbers — never
		// decrements, even after a binding is deleted, so a number is never
		// reused within a lorebook (same never-reuse guarantee as before,
		// just scoped per lorebook instead of derived from the binding row's
		// own global id). Every binding-creation call site atomically
		// increments this via an UPDATE...RETURNING in the same transaction
		// as the insert — see deriveNextBindingToken() in
		// lorebookBindingToken.ts.
		nextBindingNumber: integer("next_binding_number").notNull().default(1),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => [
		index("lorebooks_user_id_idx").on(table.userId),
		// Unique per-owner, not globally — two different users legitimately
		// importing the same shared lorebook file must each be able to own a
		// row stamped with that file's uuid.
		uniqueIndex("lorebooks_uuid_idx").on(table.userId, table.uuid)
	]
)

export const lorebooksRelations = relations(lorebooks, ({ many, one }) => ({
	worldLoreEntries: many(worldLoreEntries),
	characterLoreEntries: many(characterLoreEntries),
	historyEntries: many(historyEntries),
	scenes: many(scenes),
	user: one(users, {
		fields: [lorebooks.userId],
		references: [users.id]
	}),
	lorebookBindings: many(lorebookBindings),
	lorebookTags: many(lorebookTags)
}))

export const lorebookBindings = pgTable(
	"lorebook_bindings",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}),
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}),
		binding: text("binding").notNull(), // e.g. "{{char:1}}" (preferred) or "{char:1}" (deprecated)
		// ── Narrative-graph fields (merged in from the former narrativeNodes
		// table — every binding is also this character's graph presence now;
		// see plan doc for the merge rationale) ──────────────────────────────
		sceneId: integer("scene_id").references(() => scenes.id, {
			onDelete: "set null"
		}),
		historyEntryId: integer("history_entry_id").references(
			() => historyEntries.id,
			{ onDelete: "set null" }
		),
		// Display name — kept in sync with the bound character/persona's own
		// name when characterId/personaId is set (see syncLorebookBindings*
		// helpers); user/LLM-set directly for unbound/background rows.
		name: text("name").notNull().default(""),
		nodeState: text("node_state")
			.notNull()
			.default("active")
			.$type<NodeState>(),
		nodeVisibility: text("node_visibility")
			.notNull()
			.default("normal")
			.$type<NodeVisibility>(),
		// Kept in sync with the bound character/persona's own aliases, same
		// as `name` above.
		aliases: json("aliases").notNull().default([]).$type<string[]>(),
		// Identities absorbed via narrativeGraph:mergeNode ("absorb"), kept
		// deliberately separate from `aliases` — `aliases` is a one-directional
		// sync target from the bound character/persona (see above), a full
		// REPLACE on every entity edit; an absorbed name written directly into
		// `aliases` would silently vanish the next time that sync fires. This
		// column is never touched by the sync helpers, so an absorbed identity
		// survives regardless of how many times the bound entity is edited
		// afterward. Every consumer that reads `aliases` for name-matching or
		// display must union it with this column — see
		// availableSceneCast.ts's collectAliases().
		absorbedAliases: json("absorbed_aliases")
			.notNull()
			.default([])
			.$type<string[]>(),
		summary: text("summary"),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at"),
		// Parent binding — set when this row is an alias/child of another
		// (2-level max), from graph-merge operations.
		parentNodeId: integer("parent_node_id").references(
			(): AnyPgColumn => lorebookBindings.id,
			{ onDelete: "set null" }
		),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(table) => ({
		uniqueBinding: uniqueIndex("lorebook_bindings_unique").on(
			table.lorebookId,
			table.characterId,
			table.personaId
		),
		lorebookIdIdx: index("lorebook_bindings_lorebook_id_idx").on(
			table.lorebookId
		),
		characterIdIdx: index("lorebook_bindings_character_id_idx").on(
			table.characterId
		),
		personaIdIdx: index("lorebook_bindings_persona_id_idx").on(
			table.personaId
		)
	})
)

export const lorebookBindingsRelations = relations(
	lorebookBindings,
	({ one, many }) => ({
		lorebook: one(lorebooks, {
			fields: [lorebookBindings.lorebookId],
			references: [lorebooks.id]
		}),
		character: one(characters, {
			fields: [lorebookBindings.characterId],
			references: [characters.id]
		}),
		persona: one(personas, {
			fields: [lorebookBindings.personaId],
			references: [personas.id]
		}),
		characterLoreEntries: many(characterLoreEntries),
		/** Scenes this binding appears in, via the scene_characters join. */
		sceneAppearances: many(sceneCharacters),
		// ── Narrative-graph relations (merged in from the former
		// narrativeNodes table — see the merge plan) ────────────────────────
		scene: one(scenes, {
			fields: [lorebookBindings.sceneId],
			references: [scenes.id]
		}),
		historyEntry: one(historyEntries, {
			fields: [lorebookBindings.historyEntryId],
			references: [historyEntries.id]
		}),
		parentNode: one(lorebookBindings, {
			fields: [lorebookBindings.parentNodeId],
			references: [lorebookBindings.id],
			relationName: "nodeAliases"
		}),
		aliasChildren: many(lorebookBindings, { relationName: "nodeAliases" }),
		outgoingRelationships: many(narrativeRelationships, {
			relationName: "fromNode"
		}),
		incomingRelationships: many(narrativeRelationships, {
			relationName: "toNode"
		})
	})
)

// Audit log for narrativeGraph:mergeNode ("absorb") — a consolidating,
// destructive operation (deletes the absorbed row, rewrites its
// references onto the survivor). This is what makes that safe: enough of
// the absorbed row's state and every rewrite/deletion performed is
// recorded here to reverse a mistaken absorb via narrativeGraph:undoMerge.
export const bindingMergeLogs = pgTable(
	"binding_merge_logs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		// Nullable: if the survivor is later itself deleted/absorbed elsewhere,
		// the log entry is kept for history but can no longer be undone.
		survivorId: integer("survivor_id").references(
			() => lorebookBindings.id,
			{
				onDelete: "set null"
			}
		),
		// Full field snapshot of the absorbed row (including its own binding
		// token) — enough to re-INSERT it verbatim on undo.
		absorbedSnapshot: json("absorbed_snapshot")
			.notNull()
			.$type<Record<string, unknown>>(),
		// Relationship rows whose fromNodeId/toNodeId were rewritten from the
		// absorbed id to the survivor's — {id, oldFromNodeId, oldToNodeId} so
		// undo can point them back.
		relationshipRewrites: json("relationship_rewrites")
			.notNull()
			.default([])
			.$type<
				{ id: number; oldFromNodeId: number; oldToNodeId: number }[]
			>(),
		// Full row snapshots of relationships deleted outright (self-loops
		// created by the rewrite, or third-party duplicates) — undo re-inserts
		// these rather than trying to re-derive them.
		deletedRelationships: json("deleted_relationships")
			.notNull()
			.default([])
			.$type<Record<string, unknown>[]>(),
		// Pre-merge participantCharacters/mentionedCharacters for every scene
		// whose arrays referenced the absorbed id — undo restores these
		// recorded values directly rather than reverse-computing the rewrite.
		sceneSnapshots: json("scene_snapshots").notNull().default([]).$type<
			{
				sceneId: number
				participantCharacters: number[]
				mentionedCharacters: number[]
			}[]
		>(),
		// Exact strings appended to the survivor's absorbedAliases by this
		// merge — undo removes precisely these, not a guess.
		absorbedAliasesAdded: json("absorbed_aliases_added")
			.notNull()
			.default([])
			.$type<string[]>(),
		// characterLoreEntries reassigned from the absorbed row to the
		// survivor — undo moves these back to the recreated absorbed row.
		reassignedCharacterLoreEntryIds: json(
			"reassigned_character_lore_entry_ids"
		)
			.notNull()
			.default([])
			.$type<number[]>(),
		// lorebookBindings rows whose parentNodeId pointed at the absorbed row,
		// reassigned to the survivor — without this, those alias-children would
		// otherwise be silently orphaned (parentNodeId SET NULL by the FK) when
		// the absorbed row is deleted, and undo would have no way to restore the
		// link. Undo moves these back to point at the recreated absorbed row.
		reassignedChildNodeIds: json("reassigned_child_node_ids")
			.notNull()
			.default([])
			.$type<number[]>(),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(table) => [
		index("binding_merge_logs_lorebook_id_idx").on(table.lorebookId)
	]
)

export const bindingMergeLogsRelations = relations(
	bindingMergeLogs,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [bindingMergeLogs.lorebookId],
			references: [lorebooks.id]
		}),
		user: one(users, {
			fields: [bindingMergeLogs.userId],
			references: [users.id]
		}),
		survivor: one(lorebookBindings, {
			fields: [bindingMergeLogs.survivorId],
			references: [lorebookBindings.id]
		})
	})
)

// Sticky "not a duplicate" dismissals for the proactive duplicate-review
// affordance (see availableSceneCast.ts's findDuplicateCandidates) — a
// dismissed pair is never re-flagged for this lorebook, even across
// future graph builds. Always stored with bindingIdA < bindingIdB so a
// pair is looked up the same way regardless of which order it was found.
export const dismissedDuplicatePairs = pgTable(
	"dismissed_duplicate_pairs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		bindingIdA: integer("binding_id_a")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		bindingIdB: integer("binding_id_b")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(table) => ({
		uniquePair: uniqueIndex("dismissed_duplicate_pairs_unique").on(
			table.lorebookId,
			table.bindingIdA,
			table.bindingIdB
		)
	})
)

export const worldLoreEntries = pgTable(
	"world_lore_entries",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		category: text("category"),
		keys: text("keys").notNull().default(""),
		/**
		 * How this entry may be retrieved (13 §10a / DECOMPOSITION §4).
		 *
		 * `keyword` — only the keyword scan surfaces it.
		 * `rag` — vector search surfaces it, **falling back to keyword when no
		 *   embeddings are available**, because the alternative is retrieving
		 *   nothing and reading as "the bot forgot my lore".
		 * `both` — both arms may surface it and the combined ranker decides.
		 *
		 * NULL means `rag`, the default. Nullable rather than defaulted so an
		 * entry that has never been touched is distinguishable from one a user
		 * deliberately set to the default — which is what makes a future change
		 * of default safe to apply to the first group and not the second.
		 */
		retrievalStrategy: text("retrieval_strategy"),
		/**
		 * How this entry's keys are matched: `substring` (today's behaviour),
		 * `word`, or `regex`.
		 *
		 * NULL falls back to `useRegex`, which is why that column stays. Keys
		 * match by substring today — `art` fires on "hearth" — so the default
		 * cannot change before parity without changing what every existing
		 * lorebook retrieves.
		 */
		matchMode: text("match_mode"),
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
		/**
		 * The deepest recursion level this entry may still be reached at.
		 *
		 * `0` is the conversation only: never dragged in by another entry.
		 * NULL is no opinion, and the query node's `maxRecursionDepth` decides
		 * — which is what makes turning recursion on for a whole lorebook one
		 * setting rather than several hundred. Nullable for the same reason
		 * `retrievalStrategy` is: an entry nobody has ruled on has to stay
		 * distinguishable from one somebody deliberately set to the default.
		 */
		recursionDepth: integer("recursion_depth"),
		content: text("content").notNull().default(""),
		priority: integer("priority").notNull().default(1),
		constant: boolean("constant").notNull().default(false),
		enabled: boolean("enabled").notNull().default(true),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		position: integer("position").notNull().default(0),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("world_lore_entries_lorebook_id_idx").on(table.lorebookId)
	]
)

export const worldLoreEntriesRelations = relations(
	worldLoreEntries,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [worldLoreEntries.lorebookId],
			references: [lorebooks.id]
		})
	})
)

export const characterLoreEntries = pgTable(
	"character_lore_entries",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		lorebookBindingId: integer("character_binding_id").references(
			() => lorebookBindings.id,
			{ onDelete: "set null" }
		),
		name: text("name").notNull(),
		keys: text("keys").notNull().default(""),
		/**
		 * How this entry may be retrieved (13 §10a / DECOMPOSITION §4).
		 *
		 * `keyword` — only the keyword scan surfaces it.
		 * `rag` — vector search surfaces it, **falling back to keyword when no
		 *   embeddings are available**, because the alternative is retrieving
		 *   nothing and reading as "the bot forgot my lore".
		 * `both` — both arms may surface it and the combined ranker decides.
		 *
		 * NULL means `rag`, the default. Nullable rather than defaulted so an
		 * entry that has never been touched is distinguishable from one a user
		 * deliberately set to the default — which is what makes a future change
		 * of default safe to apply to the first group and not the second.
		 */
		retrievalStrategy: text("retrieval_strategy"),
		/**
		 * How this entry's keys are matched: `substring` (today's behaviour),
		 * `word`, or `regex`.
		 *
		 * NULL falls back to `useRegex`, which is why that column stays. Keys
		 * match by substring today — `art` fires on "hearth" — so the default
		 * cannot change before parity without changing what every existing
		 * lorebook retrieves.
		 */
		matchMode: text("match_mode"),
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
		/**
		 * The deepest recursion level this entry may still be reached at.
		 *
		 * `0` is the conversation only: never dragged in by another entry.
		 * NULL is no opinion, and the query node's `maxRecursionDepth` decides
		 * — which is what makes turning recursion on for a whole lorebook one
		 * setting rather than several hundred. Nullable for the same reason
		 * `retrievalStrategy` is: an entry nobody has ruled on has to stay
		 * distinguishable from one somebody deliberately set to the default.
		 */
		recursionDepth: integer("recursion_depth"),
		content: text("content").notNull().default(""),
		priority: integer("priority").notNull().default(1),
		constant: boolean("constant").notNull().default(false),
		enabled: boolean("enabled").notNull().default(true),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		position: integer("position").notNull().default(0),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("character_lore_entries_lorebook_id_idx").on(table.lorebookId)
	]
)

export const characterLoreEntriesRelations = relations(
	characterLoreEntries,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [characterLoreEntries.lorebookId],
			references: [lorebooks.id]
		}),
		lorebookBinding: one(lorebookBindings, {
			fields: [characterLoreEntries.lorebookBindingId],
			references: [lorebookBindings.id]
		})
	})
)

export const historyEntries = pgTable(
	"history_entries",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		year: integer("year").notNull().default(1), // Default to year 1
		month: integer("month"), // Default to January
		day: integer("day"), // Default to 1
		keys: text("keys").notNull().default(""),
		/**
		 * How this entry may be retrieved (13 §10a / DECOMPOSITION §4).
		 *
		 * `keyword` — only the keyword scan surfaces it.
		 * `rag` — vector search surfaces it, **falling back to keyword when no
		 *   embeddings are available**, because the alternative is retrieving
		 *   nothing and reading as "the bot forgot my lore".
		 * `both` — both arms may surface it and the combined ranker decides.
		 *
		 * NULL means `rag`, the default. Nullable rather than defaulted so an
		 * entry that has never been touched is distinguishable from one a user
		 * deliberately set to the default — which is what makes a future change
		 * of default safe to apply to the first group and not the second.
		 */
		retrievalStrategy: text("retrieval_strategy"),
		/**
		 * How this entry's keys are matched: `substring` (today's behaviour),
		 * `word`, or `regex`.
		 *
		 * NULL falls back to `useRegex`, which is why that column stays. Keys
		 * match by substring today — `art` fires on "hearth" — so the default
		 * cannot change before parity without changing what every existing
		 * lorebook retrieves.
		 */
		matchMode: text("match_mode"),
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
		/**
		 * The deepest recursion level this entry may still be reached at.
		 *
		 * `0` is the conversation only: never dragged in by another entry.
		 * NULL is no opinion, and the query node's `maxRecursionDepth` decides
		 * — which is what makes turning recursion on for a whole lorebook one
		 * setting rather than several hundred. Nullable for the same reason
		 * `retrievalStrategy` is: an entry nobody has ruled on has to stay
		 * distinguishable from one somebody deliberately set to the default.
		 */
		recursionDepth: integer("recursion_depth"),
		content: text("content").notNull().default(""),
		constant: boolean("constant").notNull().default(false),
		enabled: boolean("enabled").notNull().default(true),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		position: integer("position").notNull().default(0),
		isCompleted: boolean("is_completed").notNull().default(false),
		graphed: boolean("graphed").notNull().default(false),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [index("history_entries_lorebook_id_idx").on(table.lorebookId)]
)

export const historyEntriesRelations = relations(
	historyEntries,
	({ one, many }) => ({
		lorebook: one(lorebooks, {
			fields: [historyEntries.lorebookId],
			references: [lorebooks.id]
		}),
		scenes: many(scenes)
	})
)

export const tags = pgTable(
	"tags",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // Tag name (unique per user, case-insensitive)
		description: text("description"),
		colorPreset: text("color_preset")
			.notNull()
			.default("preset-filled-primary-500") // Color preset for the tag
	},
	(table) => [
		index("tags_user_id_idx").on(table.userId),
		uniqueIndex("tags_user_id_name_unique").on(
			table.userId,
			sql`lower(${table.name})`
		)
	]
)

export const tagsRelations = relations(tags, ({ many, one }) => ({
	user: one(users, {
		fields: [tags.userId],
		references: [users.id]
	}),
	characterTags: many(characterTags),
	personaTags: many(personaTags),
	lorebookTags: many(lorebookTags),
	sessionTags: many(sessionTags)
}))

export const characterTags = pgTable(
	"character_tags",
	{
		characterId: integer("character_id")
			.notNull()
			.references(() => characters.id, { onDelete: "cascade" }), // FK to characters.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [
		// Without this, nothing stopped the same (characterId, tagId) pair
		// being inserted repeatedly (a double-click/retry), silently
		// duplicating the association and inflating counts anywhere that
		// renders a tag list — matches the composite unique PKs already used
		// on sessionCharacters/sessionPersonas/sessionGuests for the same reason.
		uniqueIndex("character_tags_unique").on(t.characterId, t.tagId)
	]
)

export const characterTagsRelations = relations(characterTags, ({ one }) => ({
	character: one(characters, {
		fields: [characterTags.characterId],
		references: [characters.id]
	}),
	tag: one(tags, {
		fields: [characterTags.tagId],
		references: [tags.id]
	})
}))

export const personaTags = pgTable(
	"persona_tags",
	{
		personaId: integer("persona_id")
			.notNull()
			.references(() => personas.id, { onDelete: "cascade" }), // FK to personas.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("persona_tags_unique").on(t.personaId, t.tagId)]
)

export const personaTagsRelations = relations(personaTags, ({ one }) => ({
	persona: one(personas, {
		fields: [personaTags.personaId],
		references: [personas.id]
	}),
	tag: one(tags, {
		fields: [personaTags.tagId],
		references: [tags.id]
	})
}))

export const lorebookTags = pgTable(
	"lorebook_tags",
	{
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }), // FK to lorebooks.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("lorebook_tags_unique").on(t.lorebookId, t.tagId)]
)

export const lorebookTagsRelations = relations(lorebookTags, ({ one }) => ({
	lorebook: one(lorebooks, {
		fields: [lorebookTags.lorebookId],
		references: [lorebooks.id]
	}),
	tag: one(tags, {
		fields: [lorebookTags.tagId],
		references: [tags.id]
	})
}))

export const sessionTags = pgTable(
	"session_tags",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }), // FK to sessions.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("session_tags_unique").on(t.sessionId, t.tagId)]
)

export const sessionTagsRelations = relations(sessionTags, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionTags.sessionId],
		references: [sessions.id]
	}),
	tag: one(tags, {
		fields: [sessionTags.tagId],
		references: [tags.id]
	})
}))

export const characters = pgTable(
	"characters",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Stable, DB-generated identity for export/import dedup — see lorebooks.uuid.
		uuid: uuid("uuid")
			.notNull()
			.default(sql`(gen_random_uuid ())`),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		name: text("name").notNull(),
		nickname: text("nickname"), // Optional nickname
		characterVersion: text("character_version").default("1.0"), // Version of the character schema
		description: text("description").notNull(),
		personality: text("personality"), // Persona field
		scenario: text("scenario"),
		firstMessage: text("first_message"),
		alternateGreetings: json("alternate_greetings")
			.notNull()
			.default([])
			.$type<string[]>(), // JSON array of alternate greetings
		exampleDialogues: json("example_dialogues")
			.notNull()
			.default([])
			.$type<string[]>(), // JSON/text
		metadata: json("metadata")
			.notNull()
			.default({})
			.$type<Record<string, any>>(), // JSON/text for extra fields
		avatar: text("avatar"), // Path or URL to avatar image
		creatorNotes: text("creator_notes"), // Notes from the character creator
		creatorNotesMultilingual: json("creator_notes_multilingual").$type<
			Record<string, string>
		>(),
		groupOnlyGreetings: json("group_only_greetings").$type<string[]>(), // JSON array of greetings for group sessions
		postHistoryInstructions: text("post_history_instructions"), // Instructions for post-history processing
		source: json("source").notNull().default([]).$type<string[]>(), // JSON array of sources (e.g., URLs, books)
		assets: json("assets").notNull().default([]).$type<
			Array<{
				type: string
				uri: string
				name: string
				ext: string
			}>
		>(), // JSON array of asset paths or URLs
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
			onDelete: "set null"
		}), // Optional FK to lorebooks.id
		extensions: json("extensions")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		aliases: json("aliases").notNull().default([]).$type<string[]>(),
		summary: text("summary"),
		creator: text("creator"), // Card creator/author, per Character Card V3 spec
		category: text("category"), // Serene Pub-specific grouping/filter tag
		isFavorite: boolean("is_favorite").notNull().default(false), // 1 if favorite, 0 otherwise
		isDeleted: boolean("is_deleted").notNull().default(false),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("characters_user_id_idx").on(table.userId),
		// Unique per-owner, not globally — see lorebooks_uuid_idx.
		uniqueIndex("characters_uuid_idx").on(table.userId, table.uuid)
	]
)

export const charactersRelations = relations(characters, ({ many, one }) => ({
	user: one(users, {
		fields: [characters.userId],
		references: [users.id]
	}),
	lorebook: one(lorebooks, {
		fields: [characters.lorebookId],
		references: [lorebooks.id]
	}),
	characterTags: many(characterTags),
	sessionCharacters: many(sessionCharacters),
	sessionMessages: many(sessionMessages),
	galleryImages: many(characterGalleryImages)
}))

// Tracks display order for a character's uploaded gallery images. The
// images themselves are plain files on disk (see getCharacterDataDir) —
// this table exists purely so drag-to-reorder has somewhere persistent to
// write to; filenames are never renamed on reorder (only `position`
// changes), so `characters.avatar` — which stores a full image path — can
// never be invalidated by a reorder.
export const characterGalleryImages = pgTable(
	"character_gallery_images",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		characterId: integer("character_id")
			.notNull()
			.references(() => characters.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		position: integer("position").notNull().default(0),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
	},
	(t) => [
		uniqueIndex("character_gallery_images_unique").on(t.characterId, t.path)
	]
)

export const characterGalleryImagesRelations = relations(
	characterGalleryImages,
	({ one }) => ({
		character: one(characters, {
			fields: [characterGalleryImages.characterId],
			references: [characters.id]
		})
	})
)

export const personas = pgTable(
	"personas",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Stable, DB-generated identity for export/import dedup — see lorebooks.uuid.
		uuid: uuid("uuid")
			.notNull()
			.default(sql`(gen_random_uuid ())`),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		isDefault: boolean("is_default").notNull(), // Is this the default persona for the user?
		avatar: text("avatar"), // e.g. 'user-default.png', '1747379438925-Ryvn.png'
		name: text("name").notNull(), // e.g. 'Warren', 'Master Desir'
		description: text("description").notNull(), // Persona description (long text)
		position: integer("position").default(0),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`), // Created at timestamp
		updatedAt: timestamp("updated_at")
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()), // Updated at timestamp
		lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
			onDelete: "set null"
		}), // Optional lorebook for this persona
		aliases: json("aliases").notNull().default([]).$type<string[]>(),
		summary: text("summary"),
		creator: text("creator"), // Card creator/author, per Character Card V3 spec
		category: text("category"), // Serene Pub-specific grouping/filter tag
		isDeleted: boolean("is_deleted").notNull().default(false),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("personas_user_id_idx").on(table.userId),
		// Unique per-owner, not globally — see lorebooks_uuid_idx.
		uniqueIndex("personas_uuid_idx").on(table.userId, table.uuid)
	]
)

export const personasRelations = relations(personas, ({ one, many }) => ({
	user: one(users, {
		fields: [personas.userId],
		references: [users.id]
	}),
	lorebook: one(lorebooks, {
		fields: [personas.lorebookId],
		references: [lorebooks.id]
	}),
	personaTags: many(personaTags),
	galleryImages: many(personaGalleryImages)
}))

// Mirrors characterGalleryImages — see its comment for the "why a table,
// not filename renaming" rationale.
export const personaGalleryImages = pgTable(
	"persona_gallery_images",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		personaId: integer("persona_id")
			.notNull()
			.references(() => personas.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		position: integer("position").notNull().default(0),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
	},
	(t) => [
		uniqueIndex("persona_gallery_images_unique").on(t.personaId, t.path)
	]
)

export const personaGalleryImagesRelations = relations(
	personaGalleryImages,
	({ one }) => ({
		persona: one(personas, {
			fields: [personaGalleryImages.personaId],
			references: [personas.id]
		})
	})
)

// Sessions (group or 1:1)
export const sessions = pgTable(
	"sessions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		name: text("name"), // Optional session/group name
		isGroup: boolean("is_group").notNull(), // 1 for group session, 0 for 1:1
		/**
		 * The session's mode — a shape-bearing input type id (19 §0). Every session
		 * has one; the default is the F29 floor, which is also the backfill
		 * for every session created before modes existed. Creation validates the
		 * cast and fields against the mode's declared shape.
		 */
		modeId: text("mode_id").notNull().default("core:input/user-message@1"),
		/**
		 * Values for the mode's declared `fields` (19 §1), keyed by field
		 * name. Rendered in session settings from the shape's SettingsSchema and
		 * supplied back through the input node's published document — the
		 * whole round trip. Keys the mode does not declare are dropped at the
		 * supply side, so a mode switch cannot smuggle stale facts.
		 */
		modeFields: json("mode_fields")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		sessionType: text("session_type")
			.notNull()
			.default(SessionTypes.ROLEPLAY), // "roleplay" | "summarize"
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
		scenario: text("scenario"),
		metadata: json("metadata")
			.notNull()
			.default({})
			.$type<Record<string, any>>(), // JSON for extra settings
		groupReplyStrategy: text("group_reply_strategy").default(
			GroupReplyStrategies.ORDERED
		),
		lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
			onDelete: "set null"
		}),
		connectionId: integer("connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		samplingConfigId: integer("sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		),
		promptConfigId: integer("prompt_config_id").references(
			() => promptConfigs.id,
			{ onDelete: "set null" }
		),
		narratorPromptConfigId: integer("narrator_prompt_config_id").references(
			() => narratorPromptConfigs.id,
			{ onDelete: "set null" }
		),
		drafts: json("drafts")
			.$type<Record<string, string>>()
			.notNull()
			.default({})
	},
	(table) => [index("sessions_user_id_idx").on(table.userId)]
)

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
	sessionMessages: many(sessionMessages),
	sessionPersonas: many(sessionPersonas),
	sessionCharacters: many(sessionCharacters),
	sessionGuests: many(sessionGuests),
	lorebook: one(lorebooks, {
		fields: [sessions.lorebookId],
		references: [lorebooks.id]
	}),
	connection: one(connections, {
		fields: [sessions.connectionId],
		references: [connections.id]
	}),
	samplingConfig: one(samplingConfigs, {
		fields: [sessions.samplingConfigId],
		references: [samplingConfigs.id]
	}),
	promptConfig: one(promptConfigs, {
		fields: [sessions.promptConfigId],
		references: [promptConfigs.id]
	}),
	narratorPromptConfig: one(narratorPromptConfigs, {
		fields: [sessions.narratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	sessionTags: many(sessionTags),
	scenes: many(scenes)
}))

// Session messages
export const sessionMessages = pgTable(
	"session_messages",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		// Nullable + set null (not cascade): this is who SENT the message, not
		// who owns the session it's in — a message can easily belong to a session
		// owned by a different user (a guest's message in someone else's
		// session). Cascading a user delete here would silently wipe messages
		// out of sessions that user doesn't even own; nulling authorship instead
		// (matching characterId/personaId below) preserves the session's history.
		userId: integer("user_id").references(() => users.id, {
			onDelete: "set null"
		}),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}), // nullable
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}), // nullable
		role: text("role").notNull(), // 'user', 'character', 'system', etc
		// True for a manually-triggered Narrator response (narration/environment
		// flavor, not a character) — characterId/personaId stay null, role stays
		// "assistant" so existing history-building code keeps including it.
		isNarratorResponse: boolean("is_narrator_response")
			.notNull()
			.default(false),
		content: text("content").notNull(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		isEdited: boolean("is_edited").notNull().default(false), // 1 if edited, 0 otherwise
		metadata: json("metadata").notNull().default({}).$type<{
			isGreeting?: boolean
			swipes?: {
				currentIdx: number | null
				history: string[]
				thinkingHistory?: (string | null)[]
			}
			// Native model thinking content (e.g. Ollama `think: true`) for the
			// message's currently-active swipe — mirrors swipes.thinkingHistory[currentIdx],
			// kept denormalized here since that's what SessionMessage.svelte reads.
			thinking?: string | null
			narratorInstructions?: string // Optional extra focus text for a Narrator response generation
			narratorName?: string // Display name resolved at generation time for a Narrator response message (e.g. "Narrator")
		}>(), // JSON for extra info
		isGenerating: boolean("is_generating").notNull().default(false), // 1 if processing, 0 otherwise
		generationStage: text("generation_stage"), // 'queued' | 'loading' | 'generating' | null; only meaningful while isGenerating
		error: json("error").$type<{ message: string; code?: string } | null>(),
		queueItemId: text("queue_item_id"), // UUID of the current llmQueue item, nullable
		isHidden: boolean("is_hidden").notNull().default(false), // Whether this message is processed or not
		debugMeta: json("debug_meta").$type<Record<string, any>>(),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	// The single hottest query in the app — every session load filters by this.
	(table) => [index("session_messages_session_id_idx").on(table.sessionId)]
)

export const sessionMessagesRelations = relations(
	sessionMessages,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionMessages.sessionId],
			references: [sessions.id]
		}),
		user: one(users, {
			fields: [sessionMessages.userId],
			references: [users.id]
		}),
		character: one(characters, {
			fields: [sessionMessages.characterId],
			references: [characters.id]
		}),
		persona: one(personas, {
			fields: [sessionMessages.personaId],
			references: [personas.id]
		})
	})
)

// Many-to-many: sessions <-> personas
export const sessionPersonas = pgTable(
	"session_personas",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}),
		position: integer("position").default(0), // Position in the session
		// Soft-delete: set when this participant is removed from the session so
		// past messages can still resolve a speaker name. Null = active.
		removedAt: timestamp("removed_at"),
		// Snapshot of the persona's name at removal time, for the case where
		// the persona is later deleted globally (personaId nulls out via
		// onDelete: "set null") and no live name is available anymore.
		removedName: text("removed_name")
	},
	(table) => [
		uniqueIndex("session_personas_pk").on(table.sessionId, table.personaId),
		// canViewPersona() looks up sessionPersonas by personaId alone.
		index("session_personas_persona_id_idx").on(table.personaId)
	]
)

export const sessionPersonasRelations = relations(
	sessionPersonas,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionPersonas.sessionId],
			references: [sessions.id]
		}),
		persona: one(personas, {
			fields: [sessionPersonas.personaId],
			references: [personas.id]
		})
	})
)

// Many-to-many: sessions <-> characters
export const sessionCharacters = pgTable(
	"session_characters",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}),
		position: integer("position").default(0), // Position in the session
		isActive: boolean("is_active").notNull().default(true), // 1 if active in session, 0 if not
		// Character visibility optimization setting
		visibility: text("visibility")
			.notNull()
			.default(SessionCharacterVisibility.VISIBLE), // Controls how much character info is shown when not responding
		// Soft-delete: set when this participant is removed from the session so
		// past messages can still resolve a speaker name. Null = active.
		removedAt: timestamp("removed_at"),
		// Snapshot of the character's name at removal time, for the case where
		// the character is later deleted globally (characterId nulls out via
		// onDelete: "set null") and no live name is available anymore.
		removedName: text("removed_name")
	},
	(table) => [
		uniqueIndex("session_characters_pk").on(
			table.sessionId,
			table.characterId
		),
		// canViewCharacter() looks up sessionCharacters by characterId alone.
		index("session_characters_character_id_idx").on(table.characterId)
	]
)

export const sessionCharactersRelations = relations(
	sessionCharacters,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionCharacters.sessionId],
			references: [sessions.id]
		}),
		character: one(characters, {
			fields: [sessionCharacters.characterId],
			references: [characters.id]
		})
	})
)

// Many-to-many: sessions <-> lorebooks
export const sessionLorebooks = pgTable(
	"session_lorebooks",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		position: integer("position").default(0) // Optional: position/order in the session
	},
	(table) => ({})
)

export const sessionLorebooksRelations = relations(
	sessionLorebooks,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionLorebooks.sessionId],
			references: [sessions.id]
		}),
		lorebook: one(lorebooks, {
			fields: [sessionLorebooks.lorebookId],
			references: [lorebooks.id]
		})
	})
)

// Many-to-many: sessions <-> users (guests)
export const sessionGuests = pgTable(
	"session_guests",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		isPlayer: boolean("is_player").notNull().default(true)
	},
	(table) => ({
		pk: uniqueIndex("session_guests_pk").on(table.sessionId, table.userId)
	})
)

export const sessionGuestsRelations = relations(sessionGuests, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionGuests.sessionId],
		references: [sessions.id]
	}),
	user: one(users, {
		fields: [sessionGuests.userId],
		references: [users.id]
	})
}))

/**
 * Singleton table for system-wide settings
 */
export const systemSettings = pgTable("system_settings", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	defaultConnectionId: integer("default_connection_id").references(
		() => connections.id,
		{
			onDelete: "set null"
		}
	),
	lockConnection: boolean("lock_connection").notNull().default(false),
	defaultSamplingConfigId: integer("default_sampling_id").references(
		() => samplingConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockSamplingConfig: boolean("lock_sampling_config")
		.notNull()
		.default(false),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultContextConfigId: integer("default_context_config_id").references(
		() => contextConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockContextConfig: boolean("lock_context_config").notNull().default(false),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultPromptConfigId: integer("default_prompt_config_id").references(
		() => promptConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockPromptConfig: boolean("lock_prompt_config").notNull().default(false),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultNarratorPromptConfigId: integer(
		"default_narrator_prompt_config_id"
	).references(() => narratorPromptConfigs.id, { onDelete: "set null" }),
	isAccountsEnabled: boolean("is_accounts_enabled").notNull().default(false),
	vectorizationEnabled: boolean("vectorization_enabled")
		.notNull()
		.default(false),
	embeddingModelName: text("embedding_model_name"),
	embeddingModelDimensions: integer("embedding_model_dimensions"),
	summarizationEnabled: boolean("summarization_enabled")
		.notNull()
		.default(false),
	/**
	 * The scripts kill switch (18 §10, §13.3 — ruled: default **on**). Unlike
	 * plugins, nothing executes until an admin authors or imports a script, so
	 * this is a recovery lever rather than a gate: off returns every run to
	 * vanilla instantly, with every chain and attachment kept in place.
	 */
	scriptsEnabled: boolean("scripts_enabled").notNull().default(true),
	contextDebuggingEnabled: boolean("context_debugging_enabled")
		.notNull()
		.default(false),
	/**
	 * Compile prompts through the pipeline instead of `PromptBuilder`.
	 *
	 * Off by default and deliberately so: the two paths are byte-identical
	 * across the parity corpus, which is a strong claim about the cases someone
	 * wrote fixtures for and says nothing about a lorebook nobody imagined.
	 * `npm run pipeline:compare` answers that for a given instance, and this
	 * flag is what an admin flips once it has.
	 *
	 * Only the *prompt* changes hands. Queueing, streaming, persistence, swipes
	 * and thinking extraction stay with the code that already handles them —
	 * the pipeline hands over a compiled payload at the one seam every adapter
	 * funnels through, so everything downstream is untouched legacy code.
	 */
	/**
	 * ⚠ Transitional, and **not a long-term choice an admin makes**.
	 *
	 * There is no legacy-versus-pipeline switch in the destination: pipelines
	 * become the only path that compiles a reply. This gates the changeover
	 * while the remaining specs are built, and comes out with the last of them.
	 * Nothing new should branch on it.
	 */
	pipelinesEnabled: boolean("pipelines_enabled").notNull().default(false),
	/**
	 * Show the legacy Prompt Configs sidebar, read-only.
	 *
	 * The one toggle that survives the changeover. Configuration moves to the
	 * pipeline view, but a user who spent a year tuning prompt configs needs to
	 * be able to *read* what they had — during the migration to check it landed,
	 * and afterwards to consult a wording they have not re-created yet.
	 *
	 * Defaults on, because the alternative is that upgrading hides a year of
	 * someone's work behind a setting they do not know exists. The legacy tables
	 * themselves go in 0.8.0; this is what keeps them legible until then.
	 */
	legacyPromptConfigsVisible: boolean("legacy_prompt_configs_visible")
		.notNull()
		.default(true),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultSummarizeWorldConfigId: integer(
		"default_summarize_world_config_id"
	).references(() => worldSummarizeConfigs.id, { onDelete: "set null" }),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultSummarizeCharacterConfigId: integer(
		"default_summarize_character_config_id"
	).references(() => characterSummarizeConfigs.id, { onDelete: "set null" }),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultSummarizeSceneConfigId: integer(
		"default_summarize_scene_config_id"
	).references(() => sceneSummarizeConfigs.id, { onDelete: "set null" }),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultGraphBuildConfigId: integer(
		"default_graph_build_config_id"
	).references(() => graphBuildConfigs.id, { onDelete: "set null" }),
	// Admin-configured CharaVault account, shared instance-wide across all
	// users (not a per-user credential). Never sent to the client — see
	// systemSettingsGet's column exclusions.
	charaVaultEmail: text("chara_vault_email"),
	charaVaultEncryptedToken: text("chara_vault_encrypted_token"),
	charaVaultTokenIv: text("chara_vault_token_iv"),
	charaVaultTokenAuthTag: text("chara_vault_token_auth_tag"),
	/**
	 * Whether `migrateContextTemplates` has run.
	 *
	 * A ledger flag rather than a re-derived condition, and that distinction is
	 * the whole reason the column exists. That migration carries each scope's
	 * context config into `pipeline_context_templates` and, where the template
	 * is one somebody wrote, pins that scope's variable layouts to the bare
	 * rows so the heading is not written twice.
	 *
	 * Both halves have to happen once. The obvious alternative — re-checking
	 * each boot whether the selected template is core's — quietly re-pins
	 * anyone who resets that setting on purpose, so the panel would keep
	 * reverting with nothing on screen saying why. A migration that has run is
	 * a fact about the database, and this is where that fact lives.
	 */
	contextTemplatesMigrated: boolean("context_templates_migrated")
		.notNull()
		.default(false)
})

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
	defaultConnection: one(connections, {
		fields: [systemSettings.defaultConnectionId],
		references: [connections.id]
	}),
	defaultSamplingConfig: one(samplingConfigs, {
		fields: [systemSettings.defaultSamplingConfigId],
		references: [samplingConfigs.id]
	}),
	defaultContextConfig: one(contextConfigs, {
		fields: [systemSettings.defaultContextConfigId],
		references: [contextConfigs.id]
	}),
	defaultPromptConfig: one(promptConfigs, {
		fields: [systemSettings.defaultPromptConfigId],
		references: [promptConfigs.id]
	}),
	defaultNarratorPromptConfig: one(narratorPromptConfigs, {
		fields: [systemSettings.defaultNarratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	defaultSummarizeWorldConfig: one(worldSummarizeConfigs, {
		fields: [systemSettings.defaultSummarizeWorldConfigId],
		references: [worldSummarizeConfigs.id]
	}),
	defaultSummarizeCharacterConfig: one(characterSummarizeConfigs, {
		fields: [systemSettings.defaultSummarizeCharacterConfigId],
		references: [characterSummarizeConfigs.id]
	}),
	defaultSummarizeSceneConfig: one(sceneSummarizeConfigs, {
		fields: [systemSettings.defaultSummarizeSceneConfigId],
		references: [sceneSummarizeConfigs.id]
	}),
	defaultGraphBuildConfig: one(graphBuildConfigs, {
		fields: [systemSettings.defaultGraphBuildConfigId],
		references: [graphBuildConfigs.id]
	})
}))

export const ollamaSettings = pgTable("ollama_settings", {
	id: integer("id").primaryKey().default(1),
	ollamaManagerEnabled: boolean("ollama_manager_enabled")
		.notNull()
		.default(false),
	ollamaManagerBaseUrl: text("ollama_base_url")
		.notNull()
		.default("http://localhost:11434/")
})

export const koboldCppSettings = pgTable("koboldcpp_settings", {
	id: integer("id").primaryKey().default(1),
	koboldCppManagerEnabled: boolean("koboldcpp_manager_enabled")
		.notNull()
		.default(false),
	koboldCppManagerBaseUrl: text("koboldcpp_base_url")
		.notNull()
		.default("http://localhost:5001"),
	koboldCppManagerModelsDir: text("koboldcpp_models_dir"),
	koboldCppManagedMode: text("koboldcpp_managed_mode"), // null | "managed" | "external"
	koboldCppManagedBinaryVariant: text("koboldcpp_managed_binary_variant"),
	koboldCppManagedBinaryDir: text("koboldcpp_managed_binary_dir"),
	koboldCppManagedPort: integer("koboldcpp_managed_port")
		.notNull()
		.default(5001),
	koboldCppManagedAdminPassword: text("koboldcpp_managed_admin_password"),
	koboldCppManagedModelTtlSecs: integer("koboldcpp_managed_model_ttl_secs")
		.notNull()
		.default(300),
	koboldCppManagedSubprocessTimeoutSecs: integer(
		"koboldcpp_managed_subprocess_timeout_secs"
	)
		.notNull()
		.default(1800),
	koboldCppManagedReleaseTag: text("koboldcpp_managed_release_tag")
})

// Tracks .gguf models in the KoboldCPP models directory, whether downloaded through
// the UI or placed there manually — rows for manually-placed files are created on
// discovery during a koboldcpp:listModels scan. Models with status != "complete"
// (still downloading, or errored) are excluded from the available models list.
export const koboldCppModels = pgTable("koboldcpp_models", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	filename: text("filename").notNull().unique(),
	modelName: text("model_name").notNull(),
	modelUrl: text("model_url"),
	downloadUrl: text("download_url"),
	description: text("description"),
	quantization: text("quantization"),
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	status: text("status").notNull().default("downloading"), // "downloading" | "complete" | "error"
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
})

export type SelectKoboldCppModel = typeof koboldCppModels.$inferSelect
export type InsertKoboldCppModel = typeof koboldCppModels.$inferInsert

/**
 * Scenes: discrete story moments within a session, used as the foundation for
 * vectorization and causal graph construction.
 */
export const scenes = pgTable(
	"scenes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Session is nullable — session deletion sets this to null; scenes persist until lorebook is deleted
		sessionId: integer("session_id").references(() => sessions.id, {
			onDelete: "set null"
		}),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		// History entry this scene contributes to — cascade so scenes don't outlive their entry
		historyEntryId: integer("history_entry_id")
			.notNull()
			.references(() => historyEntries.id, { onDelete: "cascade" }),
		name: text("name"),
		// The IDs of sessionMessages included in this scene
		selectedMessageIds: json("selected_message_ids")
			.notNull()
			.default([])
			.$type<number[]>(),
		summary: text("summary"),
		// Scene cast lives in the `scene_characters` join table now — see it
		// for why the old participant_characters/mentioned_characters JSON
		// arrays had to go. Read/write them through
		// src/lib/server/utils/sceneCast.ts, which projects the join rows back
		// into the `number[]` shape the socket payloads and client still use.
		//
		// When this scene's cast was last genuinely resolved to binding ids.
		// NULL means "never resolved" — which is NOT the same as "resolved and
		// nobody was in it", and that distinction is the whole point: without
		// it, a legitimately castless scene is indistinguishable from an
		// unprocessed one and would be re-extracted on every single build.
		// Written by scene create/update (only when the payload actually
		// carries cast — a rename must not mark a scene resolved) and by
		// graph-build apply. Used for cost disclosure, never as a gate.
		castResolvedAt: timestamp("cast_resolved_at"),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		// Whether this scene has been processed into the causal graph
		graphed: boolean("graphed").notNull().default(false),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => [
		index("scenes_lorebook_id_idx").on(table.lorebookId),
		index("scenes_session_id_idx").on(table.sessionId),
		index("scenes_history_entry_id_idx").on(table.historyEntryId)
	]
)

export const scenesRelations = relations(scenes, ({ one, many }) => ({
	session: one(sessions, {
		fields: [scenes.sessionId],
		references: [sessions.id]
	}),
	lorebook: one(lorebooks, {
		fields: [scenes.lorebookId],
		references: [lorebooks.id]
	}),
	historyEntry: one(historyEntries, {
		fields: [scenes.historyEntryId],
		references: [historyEntries.id]
	}),
	lorebookBindings: many(lorebookBindings),
	characters: many(sceneCharacters)
}))

export type SceneCharacterRole = "participant" | "mentioned"

/**
 * Which characters are in a scene, and how — replacing the untyped
 * `participant_characters` / `mentioned_characters` JSON arrays.
 *
 * Those arrays had no FK, no type constraint and no index, and every one of
 * those gaps produced a real bug:
 *   - No FK → a deleted binding left a dangling id, which graphBuilder had to
 *     silently warn-and-skip, and which deleteNode had to hand-clean by
 *     loading every scene in the lorebook. ON DELETE cascade does both.
 *   - No type constraint → the column physically held ids OR pre-merge name
 *     strings OR nothing, so "is this scene's cast resolved?" was answered by
 *     sniffing array shapes at runtime. `binding_id integer` cannot hold a
 *     name.
 *   - No index → "which scenes feature X" meant loading every scene and
 *     filtering in JS, in four separate places.
 *
 * UNIQUE is (scene, binding, ROLE) and the role component is load-bearing: a
 * character legitimately appears as both participant and mentioned (absorb
 * remaps each array independently, and narrativeGraph.absorb's tests assert
 * the survivor lands in both), so a role-less constraint would reject real
 * data at migration time.
 *
 * `ordinal` preserves the arrays' observable order. Export serialization
 * writes the cast in stored order, and lorebook import compares exported
 * bytes to detect "unchanged vs conflict" — reordering would silently mark
 * every lorebook conflicted on re-import.
 */
export const sceneCharacters = pgTable(
	"scene_characters",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sceneId: integer("scene_id")
			.notNull()
			.references(() => scenes.id, { onDelete: "cascade" }),
		bindingId: integer("binding_id")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		role: text("role").notNull().$type<SceneCharacterRole>(),
		ordinal: integer("ordinal").notNull().default(0)
	},
	(table) => [
		uniqueIndex("scene_characters_unique").on(
			table.sceneId,
			table.bindingId,
			table.role
		),
		index("scene_characters_scene_id_idx").on(table.sceneId),
		index("scene_characters_binding_id_idx").on(table.bindingId)
	]
)

export const sceneCharactersRelations = relations(
	sceneCharacters,
	({ one }) => ({
		scene: one(scenes, {
			fields: [sceneCharacters.sceneId],
			references: [scenes.id]
		}),
		binding: one(lorebookBindings, {
			fields: [sceneCharacters.bindingId],
			references: [lorebookBindings.id]
		})
	})
)

/**
 * Narrative relationships: versioned, typed connections between narrative nodes.
 * Multiple rows between the same pair of nodes record how the relationship evolved over time.
 *
 * Examples:
 *   Year 1: Aria → Kael  (neutral)       "just met"
 *   Year 2: Aria → Kael  (life_debt)     "Aria saved Kael from burning building"
 *   Year 5: Aria → Kael  (ally)          "Kael repaid the debt; now genuine friends"
 */
export const narrativeRelationships = pgTable(
	"narrative_relationships",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		// Post-merge: references lorebookBindings.id (formerly narrativeNodes.id
		// — see the lorebookBindings/narrativeNodes merge plan). Column names
		// kept as-is; only the FK target changed.
		fromNodeId: integer("from_node_id")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		toNodeId: integer("to_node_id")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		// History entry this relationship state was established in (optional)
		historyEntryId: integer("history_entry_id").references(
			() => historyEntries.id,
			{
				onDelete: "set null"
			}
		),
		// Scene that establishes/changes this relationship (optional)
		sceneId: integer("scene_id").references(() => scenes.id, {
			onDelete: "set null"
		}),
		// Relationship type: ally | enemy | rival | mentor | family | romantic | neutral | complicated | life_debt | etc.
		relationshipType: text("relationship_type")
			.notNull()
			.default("neutral"),
		// Description of the relationship at this point in time
		description: text("description").notNull().default(""),
		// Who can see this relationship — see RelationshipVisibility type
		visibility: text("visibility")
			.notNull()
			.default("acknowledged")
			.$type<RelationshipVisibility>(),
		// Current state: active | resolved | broken | evolved
		status: text("status").notNull().default("active"),
		// Why this relationship changed (for non-initial entries)
		reason: text("reason"),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(table) => [
		index("narrative_relationships_from_node_id_idx").on(table.fromNodeId),
		index("narrative_relationships_to_node_id_idx").on(table.toNodeId),
		index("narrative_relationships_lorebook_id_idx").on(table.lorebookId)
	]
)

export const narrativeRelationshipsRelations = relations(
	narrativeRelationships,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [narrativeRelationships.lorebookId],
			references: [lorebooks.id]
		}),
		fromNode: one(lorebookBindings, {
			fields: [narrativeRelationships.fromNodeId],
			references: [lorebookBindings.id],
			relationName: "fromNode"
		}),
		toNode: one(lorebookBindings, {
			fields: [narrativeRelationships.toNodeId],
			references: [lorebookBindings.id],
			relationName: "toNode"
		}),
		historyEntry: one(historyEntries, {
			fields: [narrativeRelationships.historyEntryId],
			references: [historyEntries.id]
		}),
		scene: one(scenes, {
			fields: [narrativeRelationships.sceneId],
			references: [scenes.id]
		})
	})
)

export const setup = pgTable("setup", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" })
		.unique(),
	summarizationStepComplete: boolean("summarization_step_complete")
		.notNull()
		.default(false),
	ragStepComplete: boolean("rag_step_complete").notNull().default(false)
})

export const setupRelations = relations(setup, ({ one }) => ({
	user: one(users, {
		fields: [setup.userId],
		references: [users.id]
	})
}))

export const vectorizationConfigs = pgTable("vectorization_configs", {
	id: integer("id").primaryKey().default(1),
	embeddingModelTtlMinutes: integer("embedding_model_ttl_minutes")
		.notNull()
		.default(5),
	// "local" (in-process ONNX model) or "api" (external OpenAI-compatible
	// embeddings endpoint). Only one is ever active, so this singleton table
	// holds both configs rather than a dedicated multi-row connections table.
	mode: text("mode").notNull().default("local"),
	apiBaseUrl: text("api_base_url"),
	// Encrypted at rest (AES-256-GCM via tokenCrypto.ts, VECTORIZATION_API_KEY_INFO)
	// — apiKey holds the ciphertext, apiKeyIv/apiKeyAuthTag the companion
	// values needed to decrypt it. Never echoed back to the client in
	// plaintext (vectorization:listModels returns apiKeySet instead).
	apiKey: text("api_key"),
	apiKeyIv: text("api_key_iv"),
	apiKeyAuthTag: text("api_key_auth_tag"),
	apiModel: text("api_model"),
	apiDimensions: integer("api_dimensions")
})

export const customThemes = pgTable("custom_themes", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull().unique(),
	label: text("label").notNull(),
	css: text("css").notNull(),
	cssKey: text("css_key").notNull().default(""),
	uploadedBy: integer("uploaded_by").references(() => users.id, {
		onDelete: "set null"
	}),
	isInstanceTheme: boolean("is_instance_theme").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
})

export const customThemesRelations = relations(customThemes, ({ one }) => ({
	uploader: one(users, {
		fields: [customThemes.uploadedBy],
		references: [users.id]
	})
}))

// ─── Pipelines (0.6) ──────────────────────────────────────────────────────────
//
// Storage for the pipeline system described in the extensibility docs (02 §2).
// These tables run *beside* the existing prompt/context config tables through
// 0.7–0.8; nothing here replaces or reads them yet. Retained means frozen: the
// old path keeps working and stops changing (08 §5a).
//
// The governing idea is that **rows are the system of record** and a pipeline
// document is a deterministic projection of them (F3). Import writes rows,
// export reads rows, and `import(export(rows))` has to be the identity — which
// is why the shape here mirrors the document's shape closely enough to be
// checked rather than argued about.
//
// Anything the constitution names is a column; anything a node type defines
// stays in jsonb. That line is what keeps a plugin's config out of the schema
// while leaving every law queryable.

/** A pipeline's stable identity. Versions hang off it; "replace" moves a pointer. */
export const pipelineSpecs = pgTable("pipeline_specs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** `ns:name` — the authored id, unique per instance and PK-agnostic across them. */
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	/** NULL for core specs; the owning plugin otherwise (12 §3b). */
	sourcePluginId: integer("source_plugin_id"),
	/**
	 * Publishing is a pointer move, never an overwrite (02 §3). A run in flight
	 * keeps the version it started on, and a receipt's claim to describe a
	 * specific version stays true.
	 */
	activeVersionId: integer("active_version_id"),
	createdAt: timestamp("created_at").notNull().defaultNow()
})

export const pipelineSpecVersions = pgTable(
	"pipeline_spec_versions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		semver: text("semver").notNull(),
		engineRange: text("engine_range"),
		status: text("status").notNull().default("draft"), // draft | published | retired
		/**
		 * The document hash. Two instances that compiled the same authoring
		 * source land on the same string, which is what makes an import
		 * verifiable rather than trusted.
		 */
		canonicalHash: text("canonical_hash").notNull(),
		schemaVersion: integer("schema_version").notNull().default(1),
		/** Clones remember their origin, so an upstream diff is possible later. */
		derivedFromSpecVersionId: integer("derived_from_spec_version_id"),
		migratedFrom: text("migrated_from"),
		mode: json("mode").$type<Record<string, any> | null>(),
		/**
		 * Contributed surfaces (19 §3–§4) — the version's `contributes` block,
		 * stored like `mode` so function routing and the trigger UI are
		 * SELECTs over rows, never document loads.
		 */
		contributes: json("contributes").$type<Record<string, any> | null>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		publishedAt: timestamp("published_at")
	},
	(t) => [
		uniqueIndex("pipeline_spec_versions_spec_semver_idx").on(
			t.specId,
			t.semver
		)
	]
)

/**
 * Blocks — `async`, `map` and `loop`.
 *
 * ⚠ Not in 02 §2, which carries `block_*` columns on the node row only. That
 * predates the loop ruling (13 §1): a loop has a `max` and a predicate port
 * reference of its own, and neither belongs on any one of its member nodes.
 * Blocks also nest, so a block needs a parent. Filed as a docs finding rather
 * than left as a silent divergence.
 */
export const pipelineBlocks = pgTable(
	"pipeline_blocks",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		blockId: text("block_id").notNull(),
		kind: text("kind").notNull(), // async | map | loop
		/** Nesting: a block inside a block. NULL at the spine. */
		parentBlockId: text("parent_block_id"),
		mode: text("mode"), // parallel | sequential, for async
		/** Mandatory for map and loop — repetition without a bound is not expressible (F9). */
		max: integer("max"),
		/** For map: where the items come from. For loop: the predicate port. */
		overRef: json("over_ref").$type<Record<string, any> | null>(),
		repeatWhile: json("repeat_while").$type<Record<string, any> | null>(),
		position: integer("position").notNull().default(0)
	},
	(t) => [
		uniqueIndex("pipeline_blocks_version_block_idx").on(
			t.specVersionId,
			t.blockId
		),
		check(
			"pipeline_blocks_kind_check",
			sql`${t.kind} IN ('async', 'map', 'loop')`
		),
		// Repetition without a bound is not expressible (F9, 13 §1). Enforced
		// here as well as at publish, because the row is the system of record
		// and an unbounded loop reaching it through any other path is the one
		// failure the whole design refuses to allow.
		check(
			"pipeline_blocks_bounded_check",
			sql`${t.kind} = 'async' OR ${t.max} IS NOT NULL`
		)
	]
)

export const pipelineNodes = pgTable(
	"pipeline_nodes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		/**
		 * Explicit and unique per version. Overrides, receipts, lenses and
		 * `ctx.state` all key on it — generating it from position would orphan
		 * every user's tuning the first time a node is inserted above (F21).
		 */
		nodeKey: text("node_key").notNull(),
		/** The closed taxonomy, enforced by the database rather than by review (F1). */
		kind: text("kind").notNull(),
		typeId: text("type_id").notNull(),
		typeVersion: integer("type_version").notNull().default(1),
		config: json("config")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		/** Resolved at publish and stored, so a reference is readable off the row (16 §5b-i). */
		resolvedRefs: json("resolved_refs").$type<Record<
			string,
			string
		> | null>(),
		blockId: text("block_id"),
		blockKind: text("block_kind"),
		blockChain: text("block_chain"),
		toggleable: boolean("toggleable").notNull().default(false),
		enabledDefault: boolean("enabled_default").notNull().default(true),
		budgetTokens: integer("budget_tokens"),
		budgetCalls: integer("budget_calls"),
		position: integer("position").notNull()
	},
	(t) => [
		uniqueIndex("pipeline_nodes_version_key_idx").on(
			t.specVersionId,
			t.nodeKey
		),
		// F1 in the database. The five kinds are closed; a sixth is a schema
		// change and a constitutional argument, not a row somebody inserts.
		check(
			"pipeline_nodes_kind_check",
			sql`${t.kind} IN ('input', 'query', 'task', 'provider', 'consumer')`
		)
	]
)

/**
 * Edges FK to nodes, so a dangling edge is structurally impossible rather than
 * a lint finding somebody has to run.
 */
export const pipelineEdges = pgTable(
	"pipeline_edges",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		/**
		 * The node an edge leaves, where it leaves a node.
		 *
		 * Nullable since blocks became referenceable. A `map` or `async` block
		 * publishes an aggregate result (`branch-results@1`), and a spec that
		 * consumes it — a summarize pipeline merging its drafts, for instance —
		 * writes an edge whose source is the **block**, not any node inside it. The
		 * document model always allowed that; this table could not store it, so the
		 * first spec to consume a map output failed at publish with a message about
		 * a node that does not exist. See `from_block_id`.
		 */
		fromNodeId: integer("from_node_id").references(() => pipelineNodes.id, {
			onDelete: "cascade"
		}),
		/**
		 * The block an edge leaves, for a block's aggregate output.
		 *
		 * The block *id* rather than a row id, matching how `pipeline_nodes` and
		 * every other block reference key on the authored id (F21): blocks belong to
		 * a spec version, and an edge is re-resolved from the document on publish.
		 */
		fromBlockId: text("from_block_id"),
		fromPort: text("from_port").notNull(),
		toNodeId: integer("to_node_id")
			.notNull()
			.references(() => pipelineNodes.id, { onDelete: "cascade" }),
		toPort: text("to_port").notNull(),
		edgeShape: text("edge_shape"),
		/**
		 * Nullable rather than `NOT NULL DEFAULT false`, and that is not fussiness:
		 * the document distinguishes "this edge does not stream" from "streaming was
		 * never decided for this edge", and collapsing the two makes
		 * `import(export(rows))` stop being the identity. Caught by C1 against real
		 * rows, which is the only place it shows up.
		 */
		streaming: boolean("streaming"),
		/** True when derived from chain order rather than an explicit reference. */
		implicit: boolean("implicit")
	},
	(t) => [
		// Exactly one source. Both set would give the resolver two answers for
		// one edge; neither set is an edge from nothing, which is the state the
		// old `NOT NULL` was there to prevent and which must stay prevented now
		// that the column is nullable.
		check(
			"pipeline_edges_one_source_check",
			sql`(${t.fromNodeId} IS NULL) <> (${t.fromBlockId} IS NULL)`
		)
	]
)

/** Compile-time fragment includes, expanded at publish into namespaced rows (16 §3a). */
export const pipelineIncludes = pgTable("pipeline_includes", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	specVersionId: integer("spec_version_id")
		.notNull()
		.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
	key: text("key").notNull(),
	fragmentId: text("fragment_id").notNull()
})

/**
 * Author-shipped presets. Execution-affecting, so they round-trip with the
 * document (F4) — a preset that survives export but not import is a pipeline
 * that behaves differently on the far side for reasons nobody can see.
 */
export const pipelinePresets = pgTable(
	"pipeline_presets",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		/** Referenced programmatically by extension sync and core defaults (12 §3b). */
		slug: text("slug").notNull(),
		label: text("label").notNull(),
		description: text("description"),
		/**
		 * Who owns it, so an update replaces the right rows and uninstalling a
		 * preset pack leaves the pipeline alone (12 §3b). The slug is the
		 * authored identity; the FK is resolved locally where one exists.
		 */
		ownerSlug: text("owner_slug"),
		ownerPluginId: integer("owner_plugin_id"),
		isDefault: boolean("is_default").notNull().default(false)
	},
	(t) => [
		uniqueIndex("pipeline_presets_version_slug_idx").on(
			t.specVersionId,
			t.slug
		)
	]
)

export const pipelinePresetValues = pgTable("pipeline_preset_values", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	presetId: integer("preset_id")
		.notNull()
		.references(() => pipelinePresets.id, { onDelete: "cascade" }),
	nodeKey: text("node_key").notNull(),
	/** params | prompts | template | sampling | settings — never `connection` (12 §3a, F20). */
	slot: text("slot").notNull(),
	path: text("path"),
	value: json("value").$type<any>()
})

/**
 * The session's overrides, per pipeline (12 §2 as simplified 2026-08-24).
 *
 * Three layers remain: the pipeline's author defaults, the selected config's
 * values, and this table — **session scope only**. The instance's tuning lives in
 * the config itself (edited as a thing with a name, duplicated when shipped),
 * and the per-user layer no longer exists; migration 0140 folded instance rows
 * into configs and removed the rest. A session's overrides stay a separate table
 * because they are arguably the session's content, and must never travel with an
 * exported document.
 *
 * **The reason is export.** A preset is execution-affecting and round-trips (F4);
 * a user's overrides are their configuration and, at session scope, arguably their
 * content. One table means every export is a `WHERE scope_kind <> …` away from
 * shipping somebody's tuning — or, on the day someone forgets the predicate, their
 * session-scoped prompt edits — to whoever they sent a pipeline to. Two tables make
 * *"does this travel with the document"* a structural fact rather than a clause
 * somebody has to remember. Resolution reads both and projects preset rows in at
 * `scopeKind: 'preset'`, so the five-layer chain is still one ordered walk (see
 * `pipelines/config.ts`).
 *
 * **Keyed on the spec, not the spec version.** F21 makes node keys explicit and
 * stable precisely so a user's tuning survives the pipeline being edited above it;
 * hanging overrides off a version would throw all of it away on every publish,
 * which is the failure F21 exists to prevent.
 */
export const pipelineNodeOverrides = pgTable(
	"pipeline_node_overrides",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		/**
		 * Always `session` (ruled 2026-08-24). Kept as a column rather than dropped
		 * because the address index and every reader key on it, and because the
		 * closed set is enforced by the CHECK below — a second scope arriving in
		 * a later design lands as data, not as a schema rewrite.
		 */
		scopeKind: text("scope_kind").notNull(),
		/**
		 * The user or session. Zero at instance scope rather than NULL: this column is
		 * half of the uniqueness rule, and under Postgres' default NULL handling two
		 * instance-scope rows for the same path would both be accepted — so "there is
		 * one instance value for this path" would stop being true exactly where it
		 * matters most.
		 */
		scopeId: integer("scope_id").notNull().default(0),
		nodeKey: text("node_key").notNull(),
		/** connection | sampling | template | prompts | params | settings (12 §2). */
		slot: text("slot").notNull(),
		/** The field within the slot. Empty string for whole-slot values. */
		path: text("path").notNull().default(""),
		value: json("value").$type<any>(),
		/** Who wrote it — for the audit trail, never for resolution. */
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_node_overrides_addr_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId,
			t.nodeKey,
			t.slot,
			t.path
		),
		index("pipeline_node_overrides_scope_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId
		),
		// The closed set, in the database. `preset` and `author` reaching this
		// table through any path would give the resolver two answers for one layer.
		check(
			"pipeline_node_overrides_scope_check",
			sql`${t.scopeKind} = 'session'`
		)
	]
)

/**
 * Which preset a scope has selected (12 §3).
 *
 * **The selection stores a slug, not a preset id**, and that is the whole point of
 * 12 §3b. Presets hang off a *spec version*; a selection that pointed at a row id
 * would dangle the moment the pipeline published 1.1.0, and every user who had
 * chosen "Lore-heavy" would silently land back on the default — on an upgrade,
 * which is when they are least able to tell what changed. A slug is the identity
 * that survives, so the same name resolves against whichever version is live.
 *
 * A slug that no longer exists resolves to nothing rather than to an error: 12 §3b
 * retires presets instead of deleting them, and a selection pointing at a retired
 * one keeps working. Falling back is what happens when it is genuinely gone.
 */
export const pipelineConfigSelections = pgTable(
	"pipeline_config_selections",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		scopeKind: text("scope_kind").notNull(), // instance | session (ruled 2026-08-24: no user layer)
		scopeId: integer("scope_id").notNull().default(0),
		/**
		 * The author preset a scope selected, where it selected one.
		 *
		 * Nullable since configs landed: a scope now selects a *config*, and
		 * the two are different choices that can both be absent. Kept rather
		 * than dropped because author presets still ship with documents and a
		 * scope that had chosen one has not stopped choosing it.
		 */
		presetSlug: text("preset_slug"),
		/**
		 * The selected **config**, which is what a scope actually picks now.
		 *
		 * A row id here where `presetSlug` deliberately avoids one, and the
		 * difference is not an inconsistency — it is the reason the slug rule
		 * existed. Presets hang off a spec *version*, so an id would dangle the
		 * moment a pipeline republished. Configs hang off the **spec**, survive
		 * republishing by construction, and are renameable by their owner — which
		 * makes a name the unstable identifier here and the id the stable one.
		 *
		 * `ON DELETE SET NULL` is load-bearing rather than tidy. NULL is defined
		 * to mean *"fall back to the shipped default"*, so deleting a config a
		 * scope had selected returns that scope to core's default automatically.
		 * The alternative — a code path that checks whether the referenced row
		 * still exists — is a check every read has to remember, and the first
		 * read that forgets resolves a session against nothing.
		 */
		configId: integer("config_id").references(() => pipelineConfigs.id, {
			onDelete: "set null"
		}),
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_config_selections_addr_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId
		),
		check(
			"pipeline_config_selections_scope_check",
			sql`${t.scopeKind} IN ('instance', 'session')`
		)
	]
)

/**
 * A **named, swappable configuration for one pipeline** (12 §3).
 *
 * Many per pipeline, one selected per scope. This is what the Prompt Configs
 * sidebar becomes: "Session Prompts", "Session Prompts: Narrator", "Summarize: World"
 * stop being six hand-written tables and become six *namespaces*, each holding
 * as many configs as a user cares to keep.
 *
 * ## Why this is one generic pair and not seven concrete tables
 *
 * The tables it replaces store their steps as **flat columns** —
 * `batch_system_prompt`, `synth_connection_id`,
 * `perspective_sampling_config_id`. That shape enumerates a pipeline's nodes by
 * hand, so adding a graph step is a migration, and an extension shipping its own
 * pipeline cannot add columns to core's tables at all. A plugin namespace is
 * therefore unreachable by construction, not merely unimplemented.
 *
 * Keyed per node instead, the same rows describe core's five graph steps and a
 * plugin's three, with no schema change for either.
 *
 * ## Keyed on the spec, never on the spec version
 *
 * The natural instinct is a foreign key to `pipeline_nodes`, since that is where
 * a node "is". It would be wrong, and expensively: node rows belong to a spec
 * *version*, publishing is a pointer move to a new version (02 §3), and every
 * config would therefore be orphaned by the next release. F21 makes node keys
 * explicit and stable for exactly this reason — so a user's tuning survives the
 * pipeline being edited above it. `pipeline_node_overrides` already keys this
 * way, and the two must agree or the resolver reads one of them wrongly.
 */
export const pipelineConfigs = pgTable(
	"pipeline_configs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		/**
		 * Stable seed identity for the rows core ships, NULL for anything a user
		 * made — the same rule `db/defaults.ts` runs under, and for the same
		 * reason: matching a seeded row on `id` overwrote a user's config once
		 * already.
		 */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		/** Core's shipped config: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/** The one a scope falls back to when it has selected nothing. */
		isDefault: boolean("is_default").notNull().default(false),
		/**
		 * Whether this preset may be chosen, site-wide. Admin's switch.
		 *
		 * A pipeline has no enabled state — it is present or it is not — but a
		 * preset does, because presets are what a non-admin picks from and an
		 * instance owner decides what that list contains. Disabling one leaves
		 * every session already on it running: it stops being *offered*, which is
		 * a different thing from being withdrawn, and withdrawing a preset out
		 * from under a live session is not something a checkbox should do.
		 */
		enabled: boolean("enabled").notNull().default(true),
		/**
		 * Which of the mode's actions sessions on this preset include (19 §3).
		 *
		 * An array of function keys. **NULL is not the empty array** and the
		 * difference is load-bearing: NULL means this preset states nothing
		 * and the companion rule decides (mode-owner's namespace on, foreign
		 * off), so a companion arriving in a later update reaches every session
		 * whose preset never had a view. `[]` means somebody said *none*.
		 *
		 * The preset decides what is *included*; a session decides which of its
		 * included actions are switched on, and an admin may additionally turn
		 * on something outside the set for one session. Three layers, resolved in
		 * that order — the same shape as every other setting here.
		 */
		includedActions: json("included_actions").$type<string[] | null>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_configs_spec_idx").on(t.specId),
		uniqueIndex("pipeline_configs_spec_name_idx").on(t.specId, t.name)
	]
)

/**
 * Which of a mode's functions a session actually has (19 §3).
 *
 * §3 rules that a contribution from the **mode owner's own namespace** is a
 * *companion* — present by default, toggleable — and a foreign one is an
 * *attachment*, per-user opt-in. Both halves of that were design until this
 * table: every session of a mode rendered every trigger contributed to it, with
 * no way to say otherwise. This is the "otherwise".
 *
 * ## Rows are exceptions, absence is the rule
 *
 * A row exists only where somebody's choice **differs from the default** for
 * that function, and turning a function back to its default deletes the row
 * (reset-is-delete, the same discipline as the config layer and session presets).
 * So a session with no rows behaves exactly as it did before this table existed,
 * and — more usefully — a contributor changing sides later, or a new companion
 * arriving in an update, reaches every session that never had an opinion.
 *
 * ## Keyed by mode, deliberately
 *
 * A choice about `narrate` was made about *this mode's* narrate. Mode upgrades
 * move along the same bare type (`crawl@1 → crawl@2`, 19 §6), and a version
 * that retires a function should not leave a stale row deciding anything —
 * while a version that keeps it should keep the user's answer. Storing the
 * full mode id and matching on it gives the first for free; carrying answers
 * across an upgrade is a deliberate step in `upgradeSessionMode`, not an
 * accident of the key.
 *
 * `enabled` is `notNull` because a row *is* a stated position. "No opinion" is
 * spelled by having no row, and a nullable third state would make two
 * spellings for it.
 */
export const sessionFunctions = pgTable(
	"session_functions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		/** The full mode id the choice was made under. */
		modeId: text("mode_id").notNull(),
		/** The function key — `narrate`, `summarize-scene`, … (19 §3). */
		functionKey: text("function_key").notNull(),
		enabled: boolean("enabled").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("session_functions_session_mode_fn_idx").on(
			t.sessionId,
			t.modeId,
			t.functionKey
		)
	]
)

/**
 * "Same key, several contributors → the binding selects" (19 §3), as rows.
 *
 * A scope's choice of which spec serves a function for sessions of a mode —
 * `respond` selected among the bucket, a contributed key selected among its
 * contributors. Resolution is session > user > instance, then the default rule
 * (companion namespace first); a row is only ever a *choice among the
 * eligible*, so `resolveFunctionSpec` re-checks eligibility at read and a
 * binding whose spec left the bucket falls through rather than routing wrong.
 *
 * `specId` rather than slug, cascading: a deleted spec deletes its bindings,
 * and the scope falls back to default resolution automatically — the same
 * "NULL means inherit" posture `pipeline_config_selections.configId` records,
 * spelled as row-absence because the whole row is the choice.
 */
export const pipelineFunctionBindings = pgTable(
	"pipeline_function_bindings",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		scopeKind: text("scope_kind").notNull(), // instance | user | session
		/** Zero at instance scope — half of the uniqueness rule (see node overrides). */
		scopeId: integer("scope_id").notNull().default(0),
		/** Which sessions this binding shapes — bindings are mode-scoped like presets. */
		modeId: text("mode_id").notNull(),
		functionKey: text("function_key").notNull(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_function_bindings_addr_idx").on(
			t.scopeKind,
			t.scopeId,
			t.modeId,
			t.functionKey
		),
		check(
			"pipeline_function_bindings_scope_check",
			sql`${t.scopeKind} IN ('instance', 'session')`
		)
	]
)

/**
 * "The session scope may swap it" (19 §5): a node-type rebind.
 *
 * A scope's substitution of which **type** fills a node position in a spec —
 * the next-speaker strategy swap is the first use: the respond spec pins
 * `turn-manual`, and a session that wants round-robin rebinds the `speaker`
 * node. Applied when the document is loaded for a run, guarded by shape
 * compatibility (the substitute must publish the same `main` shape as the
 * pinned type — the swap-list membership rule made a load-time check), so a
 * stale rebind degrades to the pinned type rather than mis-wiring the run.
 *
 * `typeId` carries the full pin (`ns:kind/name@N`) as text rather than a
 * registry-row FK: the registry re-projects pre-1.0 (rows are deleted and
 * re-inserted at boot), and a rebind must survive that the way spec pins do.
 */
export const pipelineNodeRebinds = pgTable(
	"pipeline_node_rebinds",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		scopeKind: text("scope_kind").notNull(), // instance | user | session
		scopeId: integer("scope_id").notNull().default(0),
		nodeKey: text("node_key").notNull(),
		/** The substitute's pinned type id, e.g. `core:task/turn-round-robin@1`. */
		typeId: text("type_id").notNull(),
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_node_rebinds_addr_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId,
			t.nodeKey
		),
		check(
			"pipeline_node_rebinds_scope_check",
			sql`${t.scopeKind} IN ('instance', 'session')`
		)
	]
)

/**
 * One tuned value inside a config, addressed exactly like every other layer.
 *
 * `(node_key, slot, path)` is the same address `pipeline_node_overrides` uses,
 * which is what lets a config be projected into the five-layer chain as the
 * `preset` layer rather than resolved by a second, parallel walk (12 §2).
 *
 * ## What does *not* live here
 *
 * Connections and sampling configs are separate entities with their own rules,
 * referenced per provider node — never copied in. A row at `slot='connection'`
 * or `slot='sampling'` holds the *id of* a `connections` / `sampling_configs`
 * row, so choosing "my precise preset" once changes every pipeline that points
 * at it, and an admin moving the instance connection still reaches everyone
 * (12 §4, 17 §1a). Inlining either would fork it silently on the day it is
 * edited somewhere else, and inlining a connection would additionally copy
 * credentials into a table that is not the credentials table.
 */
export const pipelineConfigValues = pgTable(
	"pipeline_config_values",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		configId: integer("config_id")
			.notNull()
			.references(() => pipelineConfigs.id, { onDelete: "cascade" }),
		/** The stable node key, not a row id — see the note above on F21. */
		nodeKey: text("node_key").notNull(),
		/** connection | sampling | template | prompts | params | settings (12 §2). */
		slot: text("slot").notNull(),
		/** The field within the slot. Empty string for a whole-slot value. */
		path: text("path").notNull().default(""),
		value: json("value").$type<any>(),
		/**
		 * For `template` values: which language the source is written in, as a
		 * registered engine id (`core:template/handlebars@1`).
		 *
		 * Text rather than an enum, deliberately. Template engines are an open
		 * registry (F2, SDK `engines.ts`) so an extension can ship its own
		 * language and its own renderer; a CHECK constraint here would make that
		 * a core migration, which is the thing the registry exists to avoid. The
		 * validation is the lookup — an unregistered id fails at render with a
		 * message naming the plugin that should have supplied it.
		 *
		 * NULL for every slot that is not a template.
		 */
		engine: text("engine")
	},
	(t) => [
		uniqueIndex("pipeline_config_values_addr_idx").on(
			t.configId,
			t.nodeKey,
			t.slot,
			t.path
		),
		index("pipeline_config_values_config_idx").on(t.configId)
	]
)

/**
 * An authored prompt — text, and nothing else.
 *
 * A swappable entity like a connection or a sampling config, selected **per
 * provider node, per config**. A config row at `slot='prompts'` holds this
 * row's id, never a copy of its text, so renaming or rewriting a prompt reaches
 * every node pointing at it and an admin's edit is not silently forked.
 *
 * ## What it deliberately no longer carries
 *
 * `prompt_configs` — the table this succeeds — is a bundle: system text,
 * post-history text, `post_history_depth`, `post_history_token_trigger`, a
 * connection and a sampling config. Six unrelated decisions travelling as one,
 * so choosing a different wording also changed which model ran and how the
 * reminder was positioned. Here a prompt is text. The numbers are params
 * (per node, per config), and the connection and sampling config are their own
 * swappable entities selected the same way this one is.
 *
 * ## Namespaced to a pipeline
 *
 * A prompt written for session replies is not a prompt for scene summarization,
 * and offering it in that picker invites exactly the mistake the split exists
 * to prevent. The namespace is the spec, and selection refuses across it.
 *
 * ## Why `fields` is JSON
 *
 * A prompts slot declares its own named text fields — core's are `system` and
 * `postHistory` on one node, `systemPrompt` / `postHistoryInstructions` /
 * `narratorName` on another, and a plugin's are whatever it declares. Columns
 * would enumerate a set that is open by construction. The declaration is the
 * schema; this is the value.
 */
export const pipelinePrompts = pgTable(
	"pipeline_prompts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		/** Stable identity for the prompts core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		/** Core's shipped prompt: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/** field name → authored text, matching the slot's declared `fields`. */
		fields: json("fields")
			.notNull()
			.default({})
			.$type<Record<string, string>>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_prompts_spec_idx").on(t.specId),
		uniqueIndex("pipeline_prompts_spec_name_idx").on(t.specId, t.name)
	]
)

export const pipelinePromptsRelations = relations(
	pipelinePrompts,
	({ one }) => ({
		spec: one(pipelineSpecs, {
			fields: [pipelinePrompts.specId],
			references: [pipelineSpecs.id]
		})
	})
)

/**
 * User-authored scripts — the fourth paradigm's rows (18 §2).
 *
 * A script is typed text: the row holds the source and the *type* holds the
 * contract, projected into `pipeline_type_registry` with `kind: 'script'`. The
 * same entity pattern as prompts — a chain stores this row's id, never a copy
 * of its text — with one deliberate difference: **keyed by the script type,
 * not by a spec.** A slop filter is a statement about text, not about which
 * pipeline runs it, and the whole point of the tier is that one script serves
 * the reply pipeline, the summarizers, and any extension's hook that accepts
 * its type (18 §4a).
 *
 * `varsIn` / `varsOut` are the declared variable I/O (18 §6a): what the script
 * reads and what it may rewrite, as subsets of its hook's variable space.
 * In-but-not-out is read-only — enforcement is the executor's job, but the
 * declaration lives here so the editor, the import review and the receipt can
 * all say what a script touches without reading its source.
 */
export const pipelineScripts = pgTable(
	"pipeline_scripts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Pinned script type id — `core:script:text/transform@1`. */
		typeId: text("type_id").notNull(),
		/** Stable identity for anything core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		/** Core's shipped script: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/** A disabled script keeps its place in every chain and does nothing. */
		enabled: boolean("enabled").notNull().default(true),
		/** The function body. The sandbox contract is 18 §6. */
		source: text("source").notNull().default(""),
		varsIn: json("vars_in").notNull().default([]).$type<string[]>(),
		varsOut: json("vars_out").notNull().default([]).$type<string[]>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_scripts_type_idx").on(t.typeId),
		uniqueIndex("pipeline_scripts_type_name_idx").on(t.typeId, t.name)
	]
)

/**
 * How a context variable is *presented* — the swappable half of `{{{characters}}}`.
 *
 * Same entity pattern as `pipeline_prompts` above: the config stores a
 * reference, this row holds the content, and rewording reaches every node
 * pointing at it instead of forking at the first edit.
 *
 * ## Keyed by the variable, deliberately not by the spec
 *
 * This is the one place the prompt pattern is *not* copied, and the difference
 * is the entire feature. A prompt is namespaced to a pipeline because a session
 * reply's wording has no business in a summarizer's picker. A *rendering* is the
 * opposite: "characters as prose instead of JSON" is a statement about
 * characters, not about which pipeline asked for them. So the row names the
 * variable it renders, and any pipeline that renders `core:var/characters@1`
 * may select it — write one prose template, use it in reply and narration both.
 *
 * Selection is checked against `variable_id`, never against a spec. A
 * spec-ownership check copied from `prompts.ts` would compile, pass, and quietly
 * remove the reason this table exists.
 *
 * ## Why `engine` is nullable
 *
 * The same reason `context_configs.engine` is (12 §2a): NULL means core's
 * default, and a stored value keeps whatever it was authored in rather than
 * inheriting whatever core happens to render with later.
 */
export const pipelineVariableTemplates = pgTable(
	"pipeline_variable_templates",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** The registered variable this renders, e.g. `core:var/characters@1`. */
		variableId: text("variable_id").notNull(),
		/** Registered template engine id; NULL is core's default. */
		engine: text("engine"),
		name: text("name").notNull(),
		/** The template source, in whatever `engine` says it is written in. */
		source: text("source").notNull().default(""),
		/** Stable identity for the templates core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		/** Core's shipped rendering: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_variable_templates_variable_idx").on(t.variableId),
		uniqueIndex("pipeline_variable_templates_variable_name_idx").on(
			t.variableId,
			t.name
		)
	]
)

/**
 * The story string — the layout of a whole finished prompt.
 *
 * Supersedes `context_configs`, which stays as data only. This is the table the
 * pipeline reads; the legacy one is kept so a template somebody spent a year on
 * survives the upgrade, and is dropped once nothing needs to read it.
 *
 * ## What it owns, and what it no longer owns
 *
 * Structure: message blocks, placement, `{{#if}}`, `{{#each}}`. It has no
 * opinion on how the data inside is *presented* — the headings, fences and JSON
 * shape live in `pipeline_variable_templates`, one row per variable. The two
 * tables are the two halves of that split, which is why they are named as a
 * pair: this renders the whole context, that renders one value inside it.
 *
 * ## Keyed by the node whose context it renders, not by the pipeline
 *
 * `node_type_id` is the compatibility rule, and it is the same move
 * `pipeline_variable_templates` makes with `variable_id`: a row is keyed by
 * *what it renders against*, never by who happened to be rendering. Session reply
 * and the narrator both run `core:task/assemble`, so one template genuinely
 * serves both — which is how `context_configs` has always behaved, and
 * namespacing to a spec would turn that into two copies to keep in sync. A
 * pipeline with no such node offers no picker at all, so a summarizer's
 * settings cannot fill up with templates written for session.
 *
 * **Unversioned on purpose.** `core:task/assemble`, not `@2`. Which variables
 * exist is a property of the version and belongs to the lint; fragmenting the
 * pool on every version bump would strand every template a user wrote.
 *
 * ## `created_for_spec_id` sorts, and never refuses
 *
 * Which pipeline's panel a row was written in. The picker groups on it — used
 * here, then shipped, then everything else that fits — because "compatible" and
 * "the one I want" stop being the same answer at about ten rows. It is
 * deliberately not a permission: a template written while editing session replies
 * is still one scroll away in the narrator, because the whole reason this is not
 * spec-scoped is that it genuinely works there.
 */
export const pipelineContextTemplates = pgTable(
	"pipeline_context_templates",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/**
		 * The node type whose context this renders, unversioned — e.g.
		 * `core:task/assemble`. The hard compatibility rule.
		 */
		nodeTypeId: text("node_type_id").notNull(),
		/**
		 * Where it was authored, for grouping only. NULL for core's own and for
		 * anything migrated across, neither of which belongs to one pipeline.
		 * `set null` rather than cascade: deleting a pipeline must not delete
		 * somebody's template, which would be data loss wearing a tidy-up's
		 * costume.
		 */
		createdForSpecId: integer("created_for_spec_id").references(
			() => pipelineSpecs.id,
			{ onDelete: "set null" }
		),
		/** Registered template engine id; NULL is core's default. */
		engine: text("engine"),
		name: text("name").notNull(),
		/** The template source, in whatever `engine` says it is written in. */
		source: text("source").notNull().default(""),
		/** Stable identity for the templates core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		/** Core's shipped layout: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/**
		 * The `context_configs` row this was copied from, if it was.
		 *
		 * Not a foreign key and not used for resolution — the copy is
		 * independent the moment it exists. It is here so the migration can be
		 * idempotent without a ledger, and so "where did this come from" has an
		 * answer while both tables are still present.
		 */
		migratedFromContextConfigId: integer("migrated_from_context_config_id"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_context_templates_node_type_idx").on(t.nodeTypeId),
		index("pipeline_context_templates_spec_idx").on(t.createdForSpecId),
		uniqueIndex("pipeline_context_templates_node_type_name_idx").on(
			t.nodeTypeId,
			t.name
		),
		uniqueIndex("pipeline_context_templates_migrated_from_idx").on(
			t.migratedFromContextConfigId
		)
	]
)

/**
 * What a version change did to somebody's config, kept until they have seen it.
 *
 * A pipeline's tuneable surface is declared by its nodes, so publishing a new
 * version can *remove* an option a user had set. Silently dropping the value
 * would be the worst of the three available behaviours: the setting stops
 * applying, the panel stops showing it, and nothing anywhere says why the
 * pipeline started behaving differently. Silently keeping it is no better — it
 * is a row addressing a field that no longer exists, which resolves to nothing
 * and reads as corruption the first time anyone looks.
 *
 * So the value is culled and the cull is recorded. The notice is the part that
 * makes the cull honest.
 *
 * Back-fills are recorded too, under their own kind. They need no warning — a
 * new parameter arriving at its author default is the correct outcome — but
 * they answer the same question a cull does ("why is this different today"),
 * and a reader who has to consult two places to reconstruct one upgrade will
 * consult neither.
 */
export const pipelineConfigNotices = pgTable(
	"pipeline_config_notices",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		configId: integer("config_id")
			.notNull()
			.references(() => pipelineConfigs.id, { onDelete: "cascade" }),
		/** culled | backfilled. */
		kind: text("kind").notNull(),
		nodeKey: text("node_key").notNull(),
		slot: text("slot").notNull(),
		path: text("path").notNull().default(""),
		/** The label the option carried when it was culled — the panel has none now. */
		label: text("label"),
		/**
		 * What the user had set, for a cull.
		 *
		 * Kept rather than discarded: a notice that says "your value was removed"
		 * without saying what it was asks the user to remember something they
		 * configured months ago. Also makes an undo possible later without
		 * another migration.
		 */
		previousValue: json("previous_value").$type<any>(),
		/** Which version made the change, so a notice can name it. */
		specVersionId: integer("spec_version_id"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		/** NULL until the person has actually been shown it. */
		acknowledgedAt: timestamp("acknowledged_at")
	},
	(t) => [
		index("pipeline_config_notices_config_idx").on(t.configId),
		check(
			"pipeline_config_notices_kind_check",
			sql`${t.kind} IN ('culled', 'backfilled')`
		)
	]
)

export const pipelineConfigsRelations = relations(
	pipelineConfigs,
	({ one, many }) => ({
		spec: one(pipelineSpecs, {
			fields: [pipelineConfigs.specId],
			references: [pipelineSpecs.id]
		}),
		values: many(pipelineConfigValues),
		notices: many(pipelineConfigNotices)
	})
)

export const pipelineConfigNoticesRelations = relations(
	pipelineConfigNotices,
	({ one }) => ({
		config: one(pipelineConfigs, {
			fields: [pipelineConfigNotices.configId],
			references: [pipelineConfigs.id]
		})
	})
)

export const pipelineConfigValuesRelations = relations(
	pipelineConfigValues,
	({ one }) => ({
		config: one(pipelineConfigs, {
			fields: [pipelineConfigValues.configId],
			references: [pipelineConfigs.id]
		})
	})
)

/**
 * Materialized host knowledge about node types (02 §2).
 *
 * As rows rather than a module, every pin in every spec becomes joinable — and
 * more importantly, install-time validation can decide whether a plugin fits
 * this release **without executing it** (F6, 13 §10c).
 */
/**
 * What a run did, kept.
 *
 * Until this existed, a receipt was returned in memory and discarded — so the
 * first question anyone asks after a turn ("did that use the pipeline, and what
 * did it decide?") had no answer once the request was over. F3 says rows are the
 * system of record; that was true for specs and types and false for runs, which
 * is the one place a user actually looks.
 *
 * Deliberately **not** cascade-deleted with the spec version. A run happened; a
 * spec being retired later does not unhappen it, and a receipt whose spec was
 * deleted is still evidence about a message that is still in someone's session.
 * The reference is recorded as plain columns rather than a foreign key for the
 * same reason.
 */
export const pipelineRuns = pgTable(
	"pipeline_runs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** The SDK's own run id — stable across the receipt and its node rows. */
		runId: text("run_id").notNull().unique(),
		specSlug: text("spec_slug").notNull(),
		specVersion: text("spec_version").notNull(),
		/** Nullable on purpose: see the note above about retired specs. */
		specVersionId: integer("spec_version_id"),
		sessionId: integer("session_id").references(() => sessions.id, {
			onDelete: "set null"
		}),
		userId: integer("user_id").references(() => users.id, {
			onDelete: "set null"
		}),
		/** The message this run produced, when it produced one. */
		messageId: integer("message_id").references(() => sessionMessages.id, {
			onDelete: "set null"
		}),
		outcome: text("outcome").notNull(), // ok | halt | err | cancelled
		haltNodeKey: text("halt_node_key"),
		haltReason: text("halt_reason"),
		triggerSource: text("trigger_source").notNull(),
		/**
		 * What made this run reproducible.
		 *
		 * Stored because a receipt that cannot be replayed is a story about a
		 * run rather than a record of one — the seed is what lets the same
		 * inputs produce the same prompt again.
		 */
		seed: text("seed").notNull(),
		/** A preview stopped before the provider call and sent nothing. */
		isPreview: boolean("is_preview").notNull().default(false),
		startedAt: timestamp("started_at").notNull(),
		endedAt: timestamp("ended_at").notNull(),
		elapsedMs: integer("elapsed_ms").notNull().default(0),
		tokensSpent: integer("tokens_spent").notNull().default(0),
		/** The receipt verbatim, for anything the columns above do not answer. */
		receipt: json("receipt").notNull().$type<Record<string, any>>(),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_runs_session_idx").on(t.sessionId, t.id),
		index("pipeline_runs_message_idx").on(t.messageId)
	]
)

/**
 * One row per node, so "why did this turn include that lore" is a query.
 *
 * Split out of the receipt JSON rather than left inside it because the trail is
 * the thing a user reads, and reading it should not mean loading and walking a
 * blob for every run in a session. The blob stays on the run row as the source of
 * truth; these are the parts worth indexing.
 */
export const pipelineRunNodes = pgTable(
	"pipeline_run_nodes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		runId: integer("run_id")
			.notNull()
			.references(() => pipelineRuns.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		nodeKey: text("node_key").notNull(),
		kind: text("kind").notNull(),
		typeId: text("type_id").notNull(),
		result: text("result").notNull(), // ok | halt | err
		reason: text("reason"),
		elapsedMs: integer("elapsed_ms").notNull().default(0),
		tokens: integer("tokens"),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [index("pipeline_run_nodes_run_idx").on(t.runId, t.seq)]
)

export const pipelineTypeRegistry = pgTable(
	"pipeline_type_registry",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		typeId: text("type_id").notNull(),
		version: integer("version").notNull().default(1),
		kind: text("kind").notNull(),
		ownerPluginId: integer("owner_plugin_id"),
		status: text("status").notNull().default("live"), // live | deprecated | removed
		transport: text("transport").notNull().default("node"), // node | process
		ports: json("ports").notNull().default({}).$type<Record<string, any>>(),
		slots: json("slots").notNull().default({}).$type<Record<string, any>>(),
		configSchema: json("config_schema").$type<Record<string, any> | null>(),
		effects: text("effects"),
		/**
		 * Whether a failure here is absorbed as an empty result — and so
		 * whether the node may be switched off at all.
		 *
		 * It was in the content hash from the start but stored nowhere, which
		 * meant the panel could not read it: the only other source is the
		 * in-process descriptor, which does not exist for a `transport:
		 * 'process'` plugin type and is the exact thing F6 forbids reaching
		 * for. A property the hash protects but no reader can see is a
		 * declaration that only the executor honours.
		 */
		optional: boolean("optional").notNull().default(false),
		/**
		 * Script types only: how a chain of this operation treats what its
		 * links return — `transform` folds into the flowing variable bag,
		 * `verdict` is consumed by the hook and reduced (18 §5).
		 *
		 * NULL on every node type, which is not a default standing in for a
		 * value: a node type has no chain semantics to have. Stored rather than
		 * read off the descriptor for the reason `slots` is — the panel renders
		 * from rows and never loads the plugin that owns a type (F6), and a
		 * `transport: 'process'` script type has no descriptor in this process
		 * at all.
		 */
		semantics: text("semantics"),
		/**
		 * Interior script points (18 §4e), for node types that declare them.
		 * Stored for the reason `slots` is — the panel offers one chain option
		 * per point and renders from rows, never from an in-process descriptor
		 * (F6). Keys are hashed contract; labels refresh like slot text.
		 */
		scriptPoints: json("script_points").$type<Array<
			Record<string, unknown>
		> | null>(),
		/**
		 * The session-shape contract (19 §1) — present only on mode-bearing input
		 * types. Stored for the reason `slots` is: the mode picker and session
		 * settings render from rows (F6). Hashed contract; display stripped.
		 */
		sessionShape: json("session_shape").$type<Record<
			string,
			unknown
		> | null>(),
		causesEvent: text("causes_event"),
		isPublic: boolean("is_public").notNull().default(false),
		declaresRandomness: boolean("declares_randomness")
			.notNull()
			.default(false),
		earlyExit: boolean("early_exit").notNull().default(false),
		timeoutMsDefault: integer("timeout_ms_default"),
		timeoutKind: text("timeout_kind").default("wall"), // wall | idle
		connectionKind: text("connection_kind"),
		usageExtractor: text("usage_extractor"),
		i18n: json("i18n").$type<Record<string, any> | null>(),
		/** Which release seeded the row — what a drift diagnostic reports against. */
		release: text("release"),
		contentHash: text("content_hash")
	},
	(t) => [
		uniqueIndex("pipeline_type_registry_type_version_idx").on(
			t.typeId,
			t.version
		)
	]
)

/**
 * Core-defined events. Plugins cannot define events in 0.6 (F8, 13 §7g), and
 * the column is reserved rather than absent so reopening that is a permission
 * rather than a migration.
 */
export const pipelineEventRegistry = pgTable("pipeline_event_registry", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	slug: text("slug").notNull().unique(),
	version: integer("version").notNull().default(1),
	/**
	 * DATA events describe a change and carry write-target mappings, so they
	 * participate in the cycle check. ACTION events (`ui-action`,
	 * `schedule-tick`) have no write targets and drop out of it by
	 * construction, rather than needing an exception (13 §7g).
	 */
	family: text("family").notNull().default("data"), // data | action
	payloadShape: json("payload_shape").$type<Record<string, any> | null>(),
	ownerPluginId: integer("owner_plugin_id"),
	/** What makes consent enforceable without hand-classifying each event (11 §4). */
	affectsUser: boolean("affects_user").notNull().default(false),
	descriptionI18n: json("description_i18n").$type<Record<
		string,
		any
	> | null>()
})

export const pipelineEventSubscriptions = pgTable(
	"pipeline_event_subscriptions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/**
		 * The reference exactly as the document wrote it, `core:event/x@1`. Stored
		 * verbatim because a subscription is a pin, and re-deriving the string from
		 * its parts silently rewrites a document on the way back out — the version
		 * suffix was the first thing C1 caught.
		 */
		eventRef: text("event_ref").notNull(),
		/** Split out for joins and the cycle check; never used to rebuild `eventRef`. */
		eventSlug: text("event_slug").notNull(),
		eventVersion: integer("event_version").notNull().default(1),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		presetId: integer("preset_id").references(() => pipelinePresets.id, {
			onDelete: "set null"
		}),
		depthBound: integer("depth_bound"),
		enabled: boolean("enabled").notNull().default(true),
		createdBy: integer("created_by").references(() => users.id, {
			onDelete: "set null"
		})
	}
)

export const pipelineSpecsRelations = relations(pipelineSpecs, ({ many }) => ({
	versions: many(pipelineSpecVersions)
}))

export const pipelineSpecVersionsRelations = relations(
	pipelineSpecVersions,
	({ one, many }) => ({
		spec: one(pipelineSpecs, {
			fields: [pipelineSpecVersions.specId],
			references: [pipelineSpecs.id]
		}),
		nodes: many(pipelineNodes),
		edges: many(pipelineEdges),
		blocks: many(pipelineBlocks),
		includes: many(pipelineIncludes),
		presets: many(pipelinePresets)
	})
)

export const pipelineNodesRelations = relations(pipelineNodes, ({ one }) => ({
	specVersion: one(pipelineSpecVersions, {
		fields: [pipelineNodes.specVersionId],
		references: [pipelineSpecVersions.id]
	})
}))

export const pipelineEdgesRelations = relations(pipelineEdges, ({ one }) => ({
	specVersion: one(pipelineSpecVersions, {
		fields: [pipelineEdges.specVersionId],
		references: [pipelineSpecVersions.id]
	}),
	fromNode: one(pipelineNodes, {
		fields: [pipelineEdges.fromNodeId],
		references: [pipelineNodes.id],
		relationName: "edgeFrom"
	}),
	toNode: one(pipelineNodes, {
		fields: [pipelineEdges.toNodeId],
		references: [pipelineNodes.id],
		relationName: "edgeTo"
	})
}))

export const pipelinePresetsRelations = relations(
	pipelinePresets,
	({ one, many }) => ({
		specVersion: one(pipelineSpecVersions, {
			fields: [pipelinePresets.specVersionId],
			references: [pipelineSpecVersions.id]
		}),
		values: many(pipelinePresetValues)
	})
)

export const pipelinePresetValuesRelations = relations(
	pipelinePresetValues,
	({ one }) => ({
		preset: one(pipelinePresets, {
			fields: [pipelinePresetValues.presetId],
			references: [pipelinePresets.id]
		})
	})
)
