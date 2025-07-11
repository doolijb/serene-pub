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
} from "drizzle-orm/pg-core"
import { GroupReplyStrategies } from "../../shared/constants/GroupReplyStrategies"

export const users = pgTable("users", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	username: text("username").notNull(),
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
})

export const userRelations = relations(users, ({ many, one }) => ({
	lorebooks: many(lorebooks),
	characters: many(characters),
	chats: many(chats),
	activeSamplingConfig: one(samplingConfigs, {
		fields: [users.activeSamplingConfigId],
		references: [samplingConfigs.id]
	}),
	activeConnection: one(connections, {
		fields: [users.activeConnectionId],
		references: [connections.id]
	}),
	activeContextConfig: one(contextConfigs, {
		fields: [users.activeContextConfigId],
		references: [contextConfigs.id]
	}),
	activePromptConfig: one(promptConfigs, {
		fields: [users.activePromptConfigId],
		references: [promptConfigs.id]
	}),
	personas: many(personas)
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
	repetitionPenaltyEnabled: boolean("repetition_penalty_enabled").notNull().default(false),

	frequencyPenalty: real("frequency_penalty").default(0.2), // Mild penalty for repetitive phrases
	frequencyPenaltyEnabled: boolean("frequency_penalty_enabled").notNull().default(false),

	presencePenalty: real("presence_penalty").default(0.6), // Encourage new topics and freshness
	presencePenaltyEnabled: boolean("presence_penalty_enabled").notNull().default(false),

	responseTokens: integer("response_tokens").default(512), // Allow longer, richer replies
	responseTokensEnabled: boolean("response_tokens_enabled").notNull().default(true),
	responseTokensUnlocked: boolean("response_tokens_unlocked").notNull().default(false), // Dynamic length allowed

	contextTokens: integer("context_tokens").default(4096), // Keep more conversation in memory/context
	contextTokensEnabled: boolean("context_tokens_enabled").notNull().default(true),
	contextTokensUnlocked: boolean("context_tokens_unlocked").notNull().default(false), // Allow for context window expansion

	seed: integer("seed").default(-1), // -1 for random, can be used for deterministic sampling
	seedEnabled: boolean("seed_enabled").notNull().default(false)
})

export const samplingRelations = relations(samplingConfigs, () => ({}))

export const connections = pgTable("connections", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull(), // Connection name (e.g., ollama, llama, chatgpt)
	type: text("type").notNull(), // Connection type/category (e.g., ollama, chatgpt, etc)
	baseUrl: text("base_url"), // Base URL or endpoint for API
	model: text("model"), // Model name or identifier
	// Ollama-specific options
	extraJson: json("extra_json").notNull().default({}).$type<Record<string, any>>(), // Additional JSON options for the connections, api keys, etc.
	tokenCounter: text("token_counter").notNull().default("estimate"),
	promptFormat: text("prompt_format").default("vicuna")
})

export const connectionsRelations = relations(connections, () => ({}))

export const contextConfigs = pgTable("context_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	template: text("template"), // Sillytavern storyString
})

export const contextConfigsRelations = relations(contextConfigs, () => ({}))

export const promptConfigs = pgTable("prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt").notNull() // Maps to sillytavern sysPrompt.content
})

export const promptConfigsRelations = relations(promptConfigs, () => ({}))

export const lorebooks = pgTable("lorebooks", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	extraJson: json("extra_json").notNull().default({}).$type<Record<string, any>>() ,
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
}, table => ({

}))

export const lorebooksRelations = relations(lorebooks, ({ many, one }) => ({
	worldLoreEntries: many(worldLoreEntries),
	characterLoreEntries: many(characterLoreEntries),
	historyEntries: many(historyEntries),
	user: one(users, {
		fields: [lorebooks.userId],
		references: [users.id]
	}),
	lorebookBindings: many(lorebookBindings)
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
		binding: text("binding").notNull() // e.g. "{char:1}"
	},
	table => ({
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
	extraJson: json("extra_json").notNull().default({}).$type<Record<string, any>>() ,
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
	position: integer("position").notNull().default(0)
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
	extraJson: json("extra_json").notNull().default({}).$type<Record<string, any>>() ,
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
	position: integer("position").notNull().default(0)
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
	extraJson: json("extra_json").notNull().default({}).$type<Record<string, any>>(),
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
	position: integer("position").notNull().default(0)
})

export const historyEntriesRelations = relations(historyEntries, ({ one }) => ({
	lorebook: one(lorebooks, {
		fields: [historyEntries.lorebookId],
		references: [lorebooks.id]
	})
}))

export const tags = pgTable("tags", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull(), // Tag name (unique)
	description: text("description")
})

export const tagsRelations = relations(tags, ({ many }) => ({
	characterTags: many(characterTags)
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
	alternateGreetings: json("alternate_greetings").notNull().default([]).$type<string[]>(), // JSON array of alternate greetings
	exampleDialogues: text("example_dialogues"), // JSON/text
	metadata: json("metadata").notNull().default({}).$type<Record<string, any>>(), // JSON/text for extra fields
	avatar: text("avatar"), // Path or URL to avatar image
	creatorNotes: text("creator_notes"), // Notes from the character creator
	creatorNotesMultilingual: json("creator_notes_multilingual").$type<Record<string, string>>() ,
	groupOnlyGreetings: json("group_only_greetings").$type<string[]>(), // JSON array of greetings for group chats
	postHistoryInstructions: text("post_history_instructions"), // Instructions for post-history processing
	source: json("source").notNull().default([]).$type<string[]>(), // JSON array of sources (e.g., URLs, books)
	assets: json("assets").notNull().default([]).$type<Array<{
			type: string
			uri: string
			name: string
			ext: string
		}>
	>(), // JSON array of asset paths or URLs
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
	lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
		onDelete: "set null"
	}), // Optional FK to lorebooks.id
	extensions: json("extensions").notNull().default({}).$type<Record<string, any>>() ,
	isFavorite: boolean("is_favorite").notNull().default(false) // 1 if favorite, 0 otherwise
}, table => ({
}))

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
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`), // Created at timestamp
	updatedAt: date("updated_at").default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`), // Updated at timestamp
	lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
		onDelete: "set null"
	}) // Optional lorebook for this persona
})

export const personasRelations = relations(personas, ({ one, many }) => ({
	user: one(users, {
		fields: [personas.userId],
		references: [users.id]
	}),
	lorebook: one(lorebooks, {
		fields: [personas.lorebookId],
		references: [lorebooks.id]
	})
}))

// Chats (group or 1:1)
export const chats = pgTable("chats", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name"), // Optional chat/group name
	isGroup: boolean("is_group").notNull(), // 1 for group chat, 0 for 1:1
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
	scenario: text("scenario"),
	metadata: text("metadata"), // JSON for extra settings
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
	lorebook: one(lorebooks, {
		fields: [chats.lorebookId],
		references: [lorebooks.id]
	})
}))

// Chat messages
export const chatMessages = pgTable("chat_messages", {
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
	createdAt: date("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
	isEdited: boolean("is_edited").notNull().default(false), // 1 if edited, 0 otherwise
	metadata: json("metadata").notNull().default({}).$type<{isGreeting?: boolean, swipes?:{currentIdx: number | null, history: []}}>(), // JSON for extra info
	isGenerating: boolean("is_generating").notNull().default(false), // 1 if processing, 0 otherwise
	adapterId: text("adapter_id"), // UUID for in-flight adapter instance, nullable
	isHidden: boolean("is_hidden").notNull().default(false) // Whether this message is processed or not
}, table => ({

}))

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
export const chatPersonas = pgTable("chat_personas", {
	chatId: integer("chat_id")
		.notNull()
		.references(() => chats.id, { onDelete: "cascade" }),
	personaId: integer("persona_id").references(() => personas.id, {
		onDelete: "set null"
	}),
	position: integer("position").default(0) // Position in the chat
}, table => ({
	pk: uniqueIndex("chat_personas_pk").on(table.chatId, table.personaId)
}))

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
export const chatCharacters = pgTable("chat_characters", {
	chatId: integer("chat_id")
		.notNull()
		.references(() => chats.id, { onDelete: "cascade" }),
	characterId: integer("character_id").references(() => characters.id, {
		onDelete: "set null"
	}),
	position: integer("position").default(0), // Position in the chat
	isActive: boolean("is_active").notNull().default(true) // 1 if active in chat, 0 if not
}, table => ({
	pk: uniqueIndex("chat_characters_pk").on(table.chatId, table.characterId)
}))

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
	table => ({
	})
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

/**
 * Singleton table for system-wide settings
 */
export const systemSettings = pgTable("system_settings", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	ollamaManagerEnabled: boolean("ollama_manager_enabled").notNull().default(false),
	ollamaManagerBaseUrl: text("ollama_base_url").notNull().default("http://localhost:11434/"),
})