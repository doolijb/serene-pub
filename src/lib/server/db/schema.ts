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
	uuid
} from "drizzle-orm/pg-core"

// ─── Enumerated value types ───────────────────────────────────────────────────

export type NodeState = "active" | "deceased" | "missing" | "departed"
export type NodeVisibility = "normal" | "legendary" | "hidden"
export type RelationshipVisibility = "secret" | "acknowledged" | "public"
import { GroupReplyStrategies } from "../../shared/constants/GroupReplyStrategies"
import { ChatCharacterVisibility } from "../../shared/constants/ChatCharacterVisibility"
import { ChatTypes } from "../../shared/constants/ChatTypes"

export const users = pgTable(
	"users",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
	chats: many(chats),
	chatGuests: many(chatGuests),
	tags: many(tags),
	personas: many(personas),
	userSettings: one(userSettings),
	passphrases: many(passphrases)
}))

export const userSettings = pgTable("user_settings", {
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
	).references(() => characterSummarizeConfigs.id, { onDelete: "set null" }),
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
	name: text("name").notNull(), // Connection name (e.g., ollama, llama, chatgpt)
	type: text("type").notNull(), // Connection type/category (e.g., ollama, chatgpt, etc)
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

export const contextConfigs = pgTable("context_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	template: text("template") // Sillytavern storyString
})

export const contextConfigsRelations = relations(contextConfigs, () => ({}))

export const promptConfigs = pgTable("prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	// Reinforcement inserted right before the model's generation point —
	// after all chat history, immediately preceding the seed turn — rather
	// than only at the top of a long prompt alongside systemPrompt. Mirrors
	// narratorPromptConfigs.postHistoryInstructions below.
	postHistoryInstructions: text("post_history_instructions"),
	// Number of messages back from the last message the post-history block
	// is positioned at. 0 = immediately after the last message (default).
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	// Minimum token count of chat history required before
	// postHistoryInstructions is included — lets short chats skip the
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

// "chat" prefix is deliberate: this is a prompt config scoped to the
// standard roleplay chat type specifically, so a future narrator/environment
// config for a different chat type (e.g. Assistant) can't collide with it.
export const narratorPromptConfigs = pgTable("narrator_prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	// Chat-facing display name/label shown on messages generated with this
	// config (e.g. "Narrator", "The World", "Fate") — distinct from
	// `name` above, which only identifies the config itself in the sidebar.
	narratorName: text("narrator_name").notNull().default("Narrator"),
	// Reinforcement inserted right before the model's generation point —
	// after all chat history, immediately preceding the seed turn — rather
	// than only at the top of a long prompt alongside systemPrompt. Far more
	// effective against a model drifting back into character-dialogue
	// patterns established over many prior turns. See defaults.ts's context
	// template for exactly where this lands relative to the seed.
	postHistoryInstructions: text("post_history_instructions"),
	// Number of messages back from the last message the post-history block
	// is positioned at. 0 = immediately after the last message (default).
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	// Minimum token count of chat history required before
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
export const bindingMergeLogs = pgTable("binding_merge_logs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id")
		.notNull()
		.references(() => lorebooks.id, { onDelete: "cascade" }),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	// Nullable: if the survivor is later itself deleted/absorbed elsewhere,
	// the log entry is kept for history but can no longer be undone.
	survivorId: integer("survivor_id").references(() => lorebookBindings.id, {
		onDelete: "set null"
	}),
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
		.$type<{ id: number; oldFromNodeId: number; oldToNodeId: number }[]>(),
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
	sceneSnapshots: json("scene_snapshots")
		.notNull()
		.default([])
		.$type<
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
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
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
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
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
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
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
	chatTags: many(chatTags)
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
		// on chatCharacters/chatPersonas/chatGuests for the same reason.
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

export const chatTags = pgTable(
	"chat_tags",
	{
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }), // FK to chats.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("chat_tags_unique").on(t.chatId, t.tagId)]
)

export const chatTagsRelations = relations(chatTags, ({ one }) => ({
	chat: one(chats, {
		fields: [chatTags.chatId],
		references: [chats.id]
	}),
	tag: one(tags, {
		fields: [chatTags.tagId],
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
		groupOnlyGreetings: json("group_only_greetings").$type<string[]>(), // JSON array of greetings for group chats
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
	chatCharacters: many(chatCharacters),
	chatMessages: many(chatMessages),
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

// Chats (group or 1:1)
export const chats = pgTable(
	"chats",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		name: text("name"), // Optional chat/group name
		isGroup: boolean("is_group").notNull(), // 1 for group chat, 0 for 1:1
		chatType: text("chat_type").notNull().default(ChatTypes.ROLEPLAY), // "roleplay" | "assistant"
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
	(table) => [index("chats_user_id_idx").on(table.userId)]
)

export const chatsRelations = relations(chats, ({ one, many }) => ({
	user: one(users, {
		fields: [chats.userId],
		references: [users.id]
	}),
	chatMessages: many(chatMessages),
	chatPersonas: many(chatPersonas),
	chatCharacters: many(chatCharacters),
	chatGuests: many(chatGuests),
	lorebook: one(lorebooks, {
		fields: [chats.lorebookId],
		references: [lorebooks.id]
	}),
	connection: one(connections, {
		fields: [chats.connectionId],
		references: [connections.id]
	}),
	samplingConfig: one(samplingConfigs, {
		fields: [chats.samplingConfigId],
		references: [samplingConfigs.id]
	}),
	promptConfig: one(promptConfigs, {
		fields: [chats.promptConfigId],
		references: [promptConfigs.id]
	}),
	narratorPromptConfig: one(narratorPromptConfigs, {
		fields: [chats.narratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	chatTags: many(chatTags),
	scenes: many(scenes)
}))

// Chat messages
export const chatMessages = pgTable(
	"chat_messages",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }),
		// Nullable + set null (not cascade): this is who SENT the message, not
		// who owns the chat it's in — a message can easily belong to a chat
		// owned by a different user (a guest's message in someone else's
		// chat). Cascading a user delete here would silently wipe messages
		// out of chats that user doesn't even own; nulling authorship instead
		// (matching characterId/personaId below) preserves the chat's history.
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
			waitingForFunctionSelection?: boolean
			reasoning?: string // Assistant reasoning/thinking before response
			// Native model thinking content (e.g. Ollama `think: true`) for the
			// message's currently-active swipe — mirrors swipes.thinkingHistory[currentIdx],
			// kept denormalized here since that's what ChatMessage.svelte reads.
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
	// The single hottest query in the app — every chat load filters by this.
	(table) => [index("chat_messages_chat_id_idx").on(table.chatId)]
)

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
	chat: one(chats, {
		fields: [chatMessages.chatId],
		references: [chats.id]
	}),
	user: one(users, {
		fields: [chatMessages.userId],
		references: [users.id]
	}),
	character: one(characters, {
		fields: [chatMessages.characterId],
		references: [characters.id]
	}),
	persona: one(personas, {
		fields: [chatMessages.personaId],
		references: [personas.id]
	})
}))

// Many-to-many: chats <-> personas
export const chatPersonas = pgTable(
	"chat_personas",
	{
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }),
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}),
		position: integer("position").default(0), // Position in the chat
		// Soft-delete: set when this participant is removed from the chat so
		// past messages can still resolve a speaker name. Null = active.
		removedAt: timestamp("removed_at"),
		// Snapshot of the persona's name at removal time, for the case where
		// the persona is later deleted globally (personaId nulls out via
		// onDelete: "set null") and no live name is available anymore.
		removedName: text("removed_name")
	},
	(table) => [
		uniqueIndex("chat_personas_pk").on(table.chatId, table.personaId),
		// canViewPersona() looks up chatPersonas by personaId alone.
		index("chat_personas_persona_id_idx").on(table.personaId)
	]
)

export const chatPersonasRelations = relations(chatPersonas, ({ one }) => ({
	chat: one(chats, {
		fields: [chatPersonas.chatId],
		references: [chats.id]
	}),
	persona: one(personas, {
		fields: [chatPersonas.personaId],
		references: [personas.id]
	})
}))

// Many-to-many: chats <-> characters
export const chatCharacters = pgTable(
	"chat_characters",
	{
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}),
		position: integer("position").default(0), // Position in the chat
		isActive: boolean("is_active").notNull().default(true), // 1 if active in chat, 0 if not
		// Character visibility optimization setting
		visibility: text("visibility")
			.notNull()
			.default(ChatCharacterVisibility.VISIBLE), // Controls how much character info is shown when not responding
		// Soft-delete: set when this participant is removed from the chat so
		// past messages can still resolve a speaker name. Null = active.
		removedAt: timestamp("removed_at"),
		// Snapshot of the character's name at removal time, for the case where
		// the character is later deleted globally (characterId nulls out via
		// onDelete: "set null") and no live name is available anymore.
		removedName: text("removed_name")
	},
	(table) => [
		uniqueIndex("chat_characters_pk").on(table.chatId, table.characterId),
		// canViewCharacter() looks up chatCharacters by characterId alone.
		index("chat_characters_character_id_idx").on(table.characterId)
	]
)

export const chatCharactersRelations = relations(chatCharacters, ({ one }) => ({
	chat: one(chats, {
		fields: [chatCharacters.chatId],
		references: [chats.id]
	}),
	character: one(characters, {
		fields: [chatCharacters.characterId],
		references: [characters.id]
	})
}))

// Many-to-many: chats <-> lorebooks
export const chatLorebooks = pgTable(
	"chat_lorebooks",
	{
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		position: integer("position").default(0) // Optional: position/order in the chat
	},
	(table) => ({})
)

export const chatLorebooksRelations = relations(chatLorebooks, ({ one }) => ({
	chat: one(chats, {
		fields: [chatLorebooks.chatId],
		references: [chats.id]
	}),
	lorebook: one(lorebooks, {
		fields: [chatLorebooks.lorebookId],
		references: [lorebooks.id]
	})
}))

// Many-to-many: chats <-> users (guests)
export const chatGuests = pgTable(
	"chat_guests",
	{
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		isPlayer: boolean("is_player").notNull().default(true)
	},
	(table) => ({
		pk: uniqueIndex("chat_guests_pk").on(table.chatId, table.userId)
	})
)

export const chatGuestsRelations = relations(chatGuests, ({ one }) => ({
	chat: one(chats, {
		fields: [chatGuests.chatId],
		references: [chats.id]
	}),
	user: one(users, {
		fields: [chatGuests.userId],
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
	defaultContextConfigId: integer("default_context_config_id").references(
		() => contextConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockContextConfig: boolean("lock_context_config").notNull().default(false),
	defaultPromptConfigId: integer("default_prompt_config_id").references(
		() => promptConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockPromptConfig: boolean("lock_prompt_config").notNull().default(false),
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
	contextDebuggingEnabled: boolean("context_debugging_enabled")
		.notNull()
		.default(false),
	defaultSummarizeWorldConfigId: integer(
		"default_summarize_world_config_id"
	).references(() => worldSummarizeConfigs.id, { onDelete: "set null" }),
	defaultSummarizeCharacterConfigId: integer(
		"default_summarize_character_config_id"
	).references(() => characterSummarizeConfigs.id, { onDelete: "set null" }),
	defaultSummarizeSceneConfigId: integer(
		"default_summarize_scene_config_id"
	).references(() => sceneSummarizeConfigs.id, { onDelete: "set null" }),
	defaultGraphBuildConfigId: integer(
		"default_graph_build_config_id"
	).references(() => graphBuildConfigs.id, { onDelete: "set null" }),
	// Admin-configured CharaVault account, shared instance-wide across all
	// users (not a per-user credential). Never sent to the client — see
	// systemSettingsGet's column exclusions.
	charaVaultEmail: text("chara_vault_email"),
	charaVaultEncryptedToken: text("chara_vault_encrypted_token"),
	charaVaultTokenIv: text("chara_vault_token_iv"),
	charaVaultTokenAuthTag: text("chara_vault_token_auth_tag")
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
 * Scenes: discrete story moments within a chat, used as the foundation for
 * vectorization and causal graph construction.
 */
export const scenes = pgTable(
	"scenes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Chat is nullable — chat deletion sets this to null; scenes persist until lorebook is deleted
		chatId: integer("chat_id").references(() => chats.id, {
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
		// The IDs of chatMessages included in this scene
		selectedMessageIds: json("selected_message_ids")
			.notNull()
			.default([])
			.$type<number[]>(),
		summary: text("summary"),
		// Characters extracted from the scene summary at summarization time —
		// lorebookBindings ids, not name strings (see the merge plan's scene
		// character presence redesign). The underlying column stays `json`
		// either way — this is a pure TS-level type change, no DDL needed;
		// existing rows are backfilled by a data script resolving their old
		// name strings to binding ids.
		participantCharacters: json("participant_characters")
			.notNull()
			.default([])
			.$type<number[]>(),
		mentionedCharacters: json("mentioned_characters")
			.notNull()
			.default([])
			.$type<number[]>(),
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
		index("scenes_chat_id_idx").on(table.chatId),
		index("scenes_history_entry_id_idx").on(table.historyEntryId)
	]
)

export const scenesRelations = relations(scenes, ({ one, many }) => ({
	chat: one(chats, {
		fields: [scenes.chatId],
		references: [chats.id]
	}),
	lorebook: one(lorebooks, {
		fields: [scenes.lorebookId],
		references: [lorebooks.id]
	}),
	historyEntry: one(historyEntries, {
		fields: [scenes.historyEntryId],
		references: [historyEntries.id]
	}),
	lorebookBindings: many(lorebookBindings)
}))

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
