import { relations, sql } from "drizzle-orm"
import {
	pgTable,
	integer,
	text,
	real,
	boolean,
	uniqueIndex,
	json,
	date,
	type PgTableWithColumns,
	numeric,
	timestamp,
	varchar,
	uuid
} from "drizzle-orm/pg-core"
import { GroupReplyStrategies } from "../../shared/constants/GroupReplyStrategies"
import { ChatCharacterVisibility } from "../../shared/constants/ChatCharacterVisibility"
import { ChatTypes } from "../../shared/constants/ChatTypes"

export const users = pgTable("users", {
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
})

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
	activeConnectionId: integer("active_connection_id").references(
		() => connections.id,
		{
			onDelete: "set null"
		}
	),
	activeSamplingConfigId: integer("active_sampling_id").references(
		() => samplingConfigs.id,
		{
			onDelete: "set null"
		}
	),
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
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
		.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
})

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
	user: one(users, {
		fields: [userSettings.userId],
		references: [users.id]
	}),
	activeConnection: one(connections, {
		fields: [userSettings.activeConnectionId],
		references: [connections.id]
	}),
	activeSamplingConfig: one(samplingConfigs, {
		fields: [userSettings.activeSamplingConfigId],
		references: [samplingConfigs.id]
	}),
	activeContextConfig: one(contextConfigs, {
		fields: [userSettings.activeContextConfigId],
		references: [contextConfigs.id]
	}),
	activePromptConfig: one(promptConfigs, {
		fields: [userSettings.activePromptConfigId],
		references: [promptConfigs.id]
	})
}))

export const passphrases: PgTableWithColumns<any> & {
	usePermissions?: boolean
} = pgTable(
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
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "set null" }),
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
	systemPrompt: text("system_prompt").notNull() // Maps to sillytavern sysPrompt.content
})

export const promptConfigsRelations = relations(promptConfigs, () => ({}))

export const lorebooks = pgTable(
	"lorebooks",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => ({})
)

export const lorebooksRelations = relations(lorebooks, ({ many, one }) => ({
	worldLoreEntries: many(worldLoreEntries),
	characterLoreEntries: many(characterLoreEntries),
	historyEntries: many(historyEntries),
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
		binding: text("binding").notNull() // e.g. "{{char:1}}" (preferred) or "{char:1}" (deprecated)
	},
	(table) => ({
		uniqueBinding: uniqueIndex("lorebook_bindings_unique").on(
			table.lorebookId,
			table.characterId,
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
		characterLoreEntries: many(characterLoreEntries)
	})
)

export const worldLoreEntries = pgTable("world_lore_entries", {
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
})

export const worldLoreEntriesRelations = relations(
	worldLoreEntries,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [worldLoreEntries.lorebookId],
			references: [lorebooks.id]
		})
	})
)

export const characterLoreEntries = pgTable("character_lore_entries", {
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
})

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

export const historyEntries = pgTable("history_entries", {
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
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const historyEntriesRelations = relations(historyEntries, ({ one }) => ({
	lorebook: one(lorebooks, {
		fields: [historyEntries.lorebookId],
		references: [lorebooks.id]
	})
}))

export const tags = pgTable("tags", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	name: text("name").notNull(), // Tag name (unique)
	description: text("description"),
	colorPreset: text("color_preset")
		.notNull()
		.default("preset-filled-primary-500") // Color preset for the tag
})

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

export const characterTags = pgTable("character_tags", {
	characterId: integer("character_id")
		.notNull()
		.references(() => characters.id, { onDelete: "cascade" }), // FK to characters.id
	tagId: integer("tag_id")
		.notNull()
		.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
})

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

export const personaTags = pgTable("persona_tags", {
	personaId: integer("persona_id")
		.notNull()
		.references(() => personas.id, { onDelete: "cascade" }), // FK to personas.id
	tagId: integer("tag_id")
		.notNull()
		.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
})

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

export const lorebookTags = pgTable("lorebook_tags", {
	lorebookId: integer("lorebook_id")
		.notNull()
		.references(() => lorebooks.id, { onDelete: "cascade" }), // FK to lorebooks.id
	tagId: integer("tag_id")
		.notNull()
		.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
})

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

export const chatTags = pgTable("chat_tags", {
	chatId: integer("chat_id")
		.notNull()
		.references(() => chats.id, { onDelete: "cascade" }), // FK to chats.id
	tagId: integer("tag_id")
		.notNull()
		.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
})

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

export const characters = pgTable("characters", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
	isFavorite: boolean("is_favorite").notNull().default(false), // 1 if favorite, 0 otherwise
	isDeleted: boolean("is_deleted").notNull().default(false),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

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
	chatMessages: many(chatMessages)
}))

export const personas = pgTable("personas", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
	isDeleted: boolean("is_deleted").notNull().default(false),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const personasRelations = relations(personas, ({ one, many }) => ({
	user: one(users, {
		fields: [personas.userId],
		references: [users.id]
	}),
	lorebook: one(lorebooks, {
		fields: [personas.lorebookId],
		references: [lorebooks.id]
	}),
	personaTags: many(personaTags)
}))

// Chats (group or 1:1)
export const chats = pgTable("chats", {
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
	}) // Primary lorebook for this chat
})

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
	chatTags: many(chatTags)
}))

// Chat messages
export const chatMessages = pgTable(
	"chat_messages",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		chatId: integer("chat_id")
			.notNull()
			.references(() => chats.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // nullable for system/character messages
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}), // nullable
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}), // nullable
		role: text("role"), // 'user', 'character', 'system', etc
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
			swipes?: { currentIdx: number | null; history: [] }
			waitingForFunctionSelection?: boolean
			reasoning?: string // Assistant reasoning/thinking before response
		}>(), // JSON for extra info
		isGenerating: boolean("is_generating").notNull().default(false), // 1 if processing, 0 otherwise
		adapterId: text("adapter_id"), // UUID for in-flight adapter instance, nullable
		isHidden: boolean("is_hidden").notNull().default(false), // Whether this message is processed or not
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => ({})
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
		position: integer("position").default(0) // Position in the chat
	},
	(table) => ({
		pk: uniqueIndex("chat_personas_pk").on(table.chatId, table.personaId)
	})
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
			.default(ChatCharacterVisibility.VISIBLE) // Controls how much character info is shown when not responding
	},
	(table) => ({
		pk: uniqueIndex("chat_characters_pk").on(
			table.chatId,
			table.characterId
		)
	})
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
	ollamaManagerEnabled: boolean("ollama_manager_enabled")
		.notNull()
		.default(false),
	ollamaManagerBaseUrl: text("ollama_base_url")
		.notNull()
		.default("http://localhost:11434/"),
	koboldCppManagerEnabled: boolean("koboldcpp_manager_enabled")
		.notNull()
		.default(false),
	koboldCppManagerBaseUrl: text("koboldcpp_base_url")
		.notNull()
		.default("http://localhost:5001"),
	isAccountsEnabled: boolean("is_accounts_enabled").notNull().default(false),
	vectorizationEnabled: boolean("vectorization_enabled")
		.notNull()
		.default(false),
	embeddingModelName: text("embedding_model_name"),
	embeddingModelDimensions: integer("embedding_model_dimensions")
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
	})
}))

/**
 * Scenes: discrete story moments within a chat, used as the foundation for
 * vectorization and causal graph construction.
 */
export const scenes = pgTable("scenes", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	chatId: integer("chat_id")
		.notNull()
		.references(() => chats.id, { onDelete: "cascade" }),
	lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
		onDelete: "set null"
	}),
	// The IDs of chatMessages included in this scene
	selectedMessageIds: json("selected_message_ids")
		.notNull()
		.default([])
		.$type<number[]>(),
	summary: text("summary"),
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
})

export const scenesRelations = relations(scenes, ({ one, many }) => ({
	chat: one(chats, {
		fields: [scenes.chatId],
		references: [chats.id]
	}),
	lorebook: one(lorebooks, {
		fields: [scenes.lorebookId],
		references: [lorebooks.id]
	}),
	narrativeNodes: many(narrativeNodes)
}))

/**
 * Narrative nodes: entities in the causal graph (characters, relationships,
 * plot threads, locations, items, factions, themes).
 */
export const narrativeNodes = pgTable("narrative_nodes", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id")
		.notNull()
		.references(() => lorebooks.id, { onDelete: "cascade" }),
	// Scene where this node was first introduced/updated (optional)
	sceneId: integer("scene_id").references(() => scenes.id, {
		onDelete: "set null"
	}),
	// Node type: character | relationship | plot_thread | location | item | faction | theme
	nodeType: text("node_type").notNull(),
	// Lifecycle state of this node in the narrative
	nodeState: text("node_state").notNull().default("active"), // active | resolved | superseded | retconned
	// The full content/description of this node
	content: text("content").notNull().default(""),
	// A shorter summary for context infill
	summary: text("summary"),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	// Character IDs this node is associated with
	characterIds: json("character_ids").notNull().default([]).$type<number[]>(),
	// Optional chat scope (null = global to lorebook)
	chatId: integer("chat_id").references(() => chats.id, {
		onDelete: "set null"
	}),
	// Whether this node is pending user review before being committed
	pendingReview: boolean("pending_review").notNull().default(false),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
		.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
})

export const narrativeNodesRelations = relations(
	narrativeNodes,
	({ one, many }) => ({
		lorebook: one(lorebooks, {
			fields: [narrativeNodes.lorebookId],
			references: [lorebooks.id]
		}),
		scene: one(scenes, {
			fields: [narrativeNodes.sceneId],
			references: [scenes.id]
		}),
		chat: one(chats, {
			fields: [narrativeNodes.chatId],
			references: [chats.id]
		}),
		outgoingEdges: many(narrativeEdges, { relationName: "fromNode" }),
		incomingEdges: many(narrativeEdges, { relationName: "toNode" })
	})
)

/**
 * Narrative edges: typed relationships between narrative nodes.
 */
export const narrativeEdges = pgTable("narrative_edges", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	fromNodeId: integer("from_node_id")
		.notNull()
		.references(() => narrativeNodes.id, { onDelete: "cascade" }),
	toNodeId: integer("to_node_id")
		.notNull()
		.references(() => narrativeNodes.id, { onDelete: "cascade" }),
	// Edge type: causes | enables | prevents | resolves | contradicts | precedes | follows | relates_to
	edgeType: text("edge_type").notNull(),
	notes: text("notes"),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const narrativeEdgesRelations = relations(narrativeEdges, ({ one }) => ({
	fromNode: one(narrativeNodes, {
		fields: [narrativeEdges.fromNodeId],
		references: [narrativeNodes.id],
		relationName: "fromNode"
	}),
	toNode: one(narrativeNodes, {
		fields: [narrativeEdges.toNodeId],
		references: [narrativeNodes.id],
		relationName: "toNode"
	})
}))
