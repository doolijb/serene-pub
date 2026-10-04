/**
 * The 0.5.3 tables as the attic holds them (`attic_0_5_3`), typed for reading.
 *
 * Column names and types are 0.5.3's own (`git show v0.5.3:src/lib/server/db/schema.ts`)
 * and never change: the attic is a copy of a schema that is frozen forever.
 * Columns, with 0.5.3's defaults so a test can write a partial row
 * (`testAttic.ts`); no keys or indexes. The attic is made by
 * `CREATE TABLE … AS`, which copies rows and types and nothing else.
 *
 * ⚠ Outside `db/schema.ts` on purpose: drizzle-kit generates from that one
 * file, so nothing here can reach a snapshot or a generated migration.
 */
import { sql } from "drizzle-orm"
import {
	bigint,
	boolean,
	date,
	integer,
	json,
	numeric,
	pgSchema,
	real,
	text,
	timestamp,
	uuid,
	varchar
} from "drizzle-orm/pg-core"
import {
	ATTIC_LEDGER_PRUNED,
	ATTIC_SCHEMA
} from "$lib/server/db/dataUpgrades/0095_schema_0_6_0"

type NodeState = "active" | "deceased" | "missing" | "departed"
type NodeVisibility = "normal" | "legendary" | "hidden"
type RelationshipVisibility = "secret" | "acknowledged" | "public"
type SceneCharacterRole = "participant" | "mentioned"

export const attic = pgSchema(ATTIC_SCHEMA)

/** What the stash counted per table, for the reconciliation. */
export const manifest = attic.table("__manifest", {
	tableName: text("table_name").notNull(),
	rowCount: bigint("row_count", { mode: "number" }).notNull()
})

export const users = attic.table("users", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	username: text("username").notNull(),
	displayName: text("display_name"),
	theme: text("theme").notNull().default("hamlindigo"),
	darkMode: boolean("dark_mode").notNull().default(true),
	isAdmin: boolean("is_admin").notNull().default(false),
	isDeleted: boolean("is_deleted").notNull().default(false),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const userSettings = attic.table("user_settings", {
	id: integer("id").generatedByDefaultAsIdentity(),
	userId: integer("user_id").notNull(),
	activeContextConfigId: integer("active_context_config_id"),
	activePromptConfigId: integer("active_prompt_config_id"),
	activeNarratorPromptConfigId: integer("active_narrator_prompt_config_id"),
	activeSummarizeWorldConfigId: integer("active_summarize_world_config_id"),
	activeSummarizeCharacterConfigId: integer(
		"active_summarize_character_config_id"
	),
	activeSummarizeSceneConfigId: integer("active_summarize_scene_config_id"),
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
	charaVaultIncludeNsfw: boolean("chara_vault_include_nsfw")
		.notNull()
		.default(false),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const passphrases = attic.table("passphrases", {
	id: integer("id").generatedByDefaultAsIdentity(),
	userId: integer("user_id").notNull(),
	hash: text("hash").notNull(),
	salt: varchar("salt", { length: 512 }).notNull(),
	iterations: numeric("iterations").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	invalidatedAt: timestamp("invalidated_at")
})

export const userTokens = attic.table("user_tokens", {
	id: uuid("id")
		.notNull()
		.default(sql`(gen_random_uuid ())`),
	userId: integer("user_id"),
	token: text("token").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	expiresAt: timestamp("expires_at").notNull(),
	browser: varchar("browser", { length: 256 }).notNull(),
	os: varchar("os", { length: 256 }).notNull()
})

export const samplingConfigs = attic.table("sampling_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	name: text("name").notNull(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	temperature: real("temperature").notNull().default(0.7),
	temperatureEnabled: boolean("temperature_enabled").notNull().default(true),
	topP: real("top_p").default(0.92),
	topPEnabled: boolean("top_p_enabled").notNull().default(false),
	topK: integer("top_k").default(80),
	topKEnabled: boolean("top_k_enabled").notNull().default(false),
	repetitionPenalty: real("repetition_penalty").default(1.15),
	repetitionPenaltyEnabled: boolean("repetition_penalty_enabled")
		.notNull()
		.default(false),
	frequencyPenalty: real("frequency_penalty").default(0.2),
	frequencyPenaltyEnabled: boolean("frequency_penalty_enabled")
		.notNull()
		.default(false),
	presencePenalty: real("presence_penalty").default(0.6),
	presencePenaltyEnabled: boolean("presence_penalty_enabled")
		.notNull()
		.default(false),
	responseTokens: integer("response_tokens").default(512),
	responseTokensEnabled: boolean("response_tokens_enabled")
		.notNull()
		.default(true),
	responseTokensUnlocked: boolean("response_tokens_unlocked")
		.notNull()
		.default(false),
	contextTokens: integer("context_tokens").default(4096),
	contextTokensEnabled: boolean("context_tokens_enabled")
		.notNull()
		.default(true),
	contextTokensUnlocked: boolean("context_tokens_unlocked")
		.notNull()
		.default(false),
	seed: integer("seed").default(-1),
	seedEnabled: boolean("seed_enabled").notNull().default(false),
	minP: real("min_p").default(0.05),
	minPEnabled: boolean("min_p_enabled").notNull().default(false),
	typicalP: real("typical_p").default(1.0),
	typicalPEnabled: boolean("typical_p_enabled").notNull().default(false),
	mirostat: integer("mirostat").default(0),
	mirostatEnabled: boolean("mirostat_enabled").notNull().default(false),
	mirostatTau: real("mirostat_tau").default(5.0),
	mirostatTauEnabled: boolean("mirostat_tau_enabled")
		.notNull()
		.default(false),
	mirostatEta: real("mirostat_eta").default(0.1),
	mirostatEtaEnabled: boolean("mirostat_eta_enabled")
		.notNull()
		.default(false),
	xtcProbability: real("xtc_probability").default(0.0),
	xtcProbabilityEnabled: boolean("xtc_probability_enabled")
		.notNull()
		.default(false),
	xtcThreshold: real("xtc_threshold").default(0.1),
	xtcThresholdEnabled: boolean("xtc_threshold_enabled")
		.notNull()
		.default(false),
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
	dynatempRange: real("dynatemp_range").default(0.0),
	dynatempRangeEnabled: boolean("dynatemp_range_enabled")
		.notNull()
		.default(false),
	dynatempExponent: real("dynatemp_exponent").default(1.0),
	dynatempExponentEnabled: boolean("dynatemp_exponent_enabled")
		.notNull()
		.default(false),
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
	logitBias: json("logit_bias").default({}).$type<Record<string, number>>(),
	logitBiasEnabled: boolean("logit_bias_enabled").notNull().default(false),
	stop: json("stop").default([]).$type<string[]>(),
	stopEnabled: boolean("stop_enabled").notNull().default(false),
	maxTokens: integer("max_tokens").default(-1),
	maxTokensEnabled: boolean("max_tokens_enabled").notNull().default(false)
})

export const connections = attic.table("connections", {
	id: integer("id").generatedByDefaultAsIdentity(),
	name: text("name").notNull(),
	type: text("type").notNull(),
	baseUrl: text("base_url"),
	model: text("model"),
	extraJson: json("extra_json")
		.notNull()
		.default({})
		.$type<Record<string, any>>(),
	tokenCounter: text("token_counter").notNull().default("estimate"),
	promptFormat: text("prompt_format").default("vicuna")
})

export const contextConfigs = attic.table("context_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	template: text("template")
})

export const promptConfigs = attic.table("prompt_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	postHistoryInstructions: text("post_history_instructions"),
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	postHistoryTokenTrigger: integer("post_history_token_trigger")
		.notNull()
		.default(0),
	connectionId: integer("connection_id"),
	samplingConfigId: integer("sampling_config_id")
})

export const narratorPromptConfigs = attic.table("narrator_prompt_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	narratorName: text("narrator_name").notNull().default("Narrator"),
	postHistoryInstructions: text("post_history_instructions"),
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	postHistoryTokenTrigger: integer("post_history_token_trigger")
		.notNull()
		.default(0),
	systemPrompt: text("system_prompt").notNull(),
	connectionId: integer("connection_id"),
	samplingConfigId: integer("sampling_config_id")
})

export const worldSummarizeConfigs = attic.table("world_summarize_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	batchSystemPrompt: text("batch_system_prompt").notNull(),
	synthSystemPrompt: text("synth_system_prompt").notNull(),
	nameSystemPrompt: text("name_system_prompt").notNull(),
	batchConnectionId: integer("batch_connection_id"),
	batchSamplingConfigId: integer("batch_sampling_config_id"),
	synthConnectionId: integer("synth_connection_id"),
	synthSamplingConfigId: integer("synth_sampling_config_id"),
	nameConnectionId: integer("name_connection_id"),
	nameSamplingConfigId: integer("name_sampling_config_id")
})

export const characterSummarizeConfigs = attic.table(
	"character_summarize_configs",
	{
		id: integer("id").generatedByDefaultAsIdentity(),
		seedKey: text("seed_key"),
		isImmutable: boolean("is_immutable").notNull().default(false),
		name: text("name").notNull(),
		batchSystemPrompt: text("batch_system_prompt").notNull(),
		synthSystemPrompt: text("synth_system_prompt").notNull(),
		nameSystemPrompt: text("name_system_prompt").notNull(),
		batchConnectionId: integer("batch_connection_id"),
		batchSamplingConfigId: integer("batch_sampling_config_id"),
		synthConnectionId: integer("synth_connection_id"),
		synthSamplingConfigId: integer("synth_sampling_config_id"),
		nameConnectionId: integer("name_connection_id"),
		nameSamplingConfigId: integer("name_sampling_config_id")
	}
)

export const sceneSummarizeConfigs = attic.table("scene_summarize_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	batchSystemPrompt: text("batch_system_prompt").notNull(),
	synthSystemPrompt: text("synth_system_prompt").notNull(),
	nameSystemPrompt: text("name_system_prompt").notNull(),
	characterExtractionSystemPrompt: text("character_extraction_system_prompt")
		.notNull()
		.default(""),
	batchConnectionId: integer("batch_connection_id"),
	batchSamplingConfigId: integer("batch_sampling_config_id"),
	synthConnectionId: integer("synth_connection_id"),
	synthSamplingConfigId: integer("synth_sampling_config_id"),
	nameConnectionId: integer("name_connection_id"),
	nameSamplingConfigId: integer("name_sampling_config_id"),
	characterExtractionConnectionId: integer(
		"character_extraction_connection_id"
	),
	characterExtractionSamplingConfigId: integer(
		"character_extraction_sampling_config_id"
	)
})

export const graphBuildConfigs = attic.table("graph_build_configs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	seedKey: text("seed_key"),
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
	nodeResolutionConnectionId: integer("node_resolution_connection_id"),
	nodeResolutionSamplingConfigId: integer(
		"node_resolution_sampling_config_id"
	),
	preFilterConnectionId: integer("pre_filter_connection_id"),
	preFilterSamplingConfigId: integer("pre_filter_sampling_config_id"),
	perspectiveConnectionId: integer("perspective_connection_id"),
	perspectiveSamplingConfigId: integer("perspective_sampling_config_id"),
	nodeDescriptionSystemPrompt: text("node_description_system_prompt")
		.notNull()
		.default(""),
	nodeDescriptionConnectionId: integer("node_description_connection_id"),
	nodeDescriptionSamplingConfigId: integer(
		"node_description_sampling_config_id"
	),
	stateDetectionSystemPrompt: text("state_detection_system_prompt")
		.notNull()
		.default(""),
	stateDetectionConnectionId: integer("state_detection_connection_id"),
	stateDetectionSamplingConfigId: integer(
		"state_detection_sampling_config_id"
	)
})

export const lorebooks = attic.table("lorebooks", {
	id: integer("id").generatedByDefaultAsIdentity(),
	uuid: uuid("uuid")
		.notNull()
		.default(sql`(gen_random_uuid ())`),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	extraJson: json("extra_json")
		.notNull()
		.default({})
		.$type<Record<string, any>>(),
	userId: integer("user_id").notNull(),
	nextBindingNumber: integer("next_binding_number").notNull().default(1),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const lorebookBindings = attic.table("lorebook_bindings", {
	id: integer("id").generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id").notNull(),
	characterId: integer("character_id"),
	personaId: integer("persona_id"),
	binding: text("binding").notNull(),
	sceneId: integer("scene_id"),
	historyEntryId: integer("history_entry_id"),
	name: text("name").notNull().default(""),
	nodeState: text("node_state")
		.notNull()
		.default("active")
		.$type<NodeState>(),
	nodeVisibility: text("node_visibility")
		.notNull()
		.default("normal")
		.$type<NodeVisibility>(),
	aliases: json("aliases").notNull().default([]).$type<string[]>(),
	absorbedAliases: json("absorbed_aliases")
		.notNull()
		.default([])
		.$type<string[]>(),
	summary: text("summary"),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at"),
	parentNodeId: integer("parent_node_id"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow()
})

export const bindingMergeLogs = attic.table("binding_merge_logs", {
	id: integer("id").generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id").notNull(),
	userId: integer("user_id").notNull(),
	survivorId: integer("survivor_id"),
	absorbedSnapshot: json("absorbed_snapshot")
		.notNull()
		.$type<Record<string, unknown>>(),
	relationshipRewrites: json("relationship_rewrites")
		.notNull()
		.default([])
		.$type<{ id: number; oldFromNodeId: number; oldToNodeId: number }[]>(),
	deletedRelationships: json("deleted_relationships")
		.notNull()
		.default([])
		.$type<Record<string, unknown>[]>(),
	sceneSnapshots: json("scene_snapshots").notNull().default([]).$type<
		{
			sceneId: number
			participantCharacters: number[]
			mentionedCharacters: number[]
		}[]
	>(),
	absorbedAliasesAdded: json("absorbed_aliases_added")
		.notNull()
		.default([])
		.$type<string[]>(),
	reassignedCharacterLoreEntryIds: json("reassigned_character_lore_entry_ids")
		.notNull()
		.default([])
		.$type<number[]>(),
	reassignedChildNodeIds: json("reassigned_child_node_ids")
		.notNull()
		.default([])
		.$type<number[]>(),
	createdAt: timestamp("created_at").notNull().defaultNow()
})

export const dismissedDuplicatePairs = attic.table(
	"dismissed_duplicate_pairs",
	{
		id: integer("id").generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id").notNull(),
		bindingIdA: integer("binding_id_a").notNull(),
		bindingIdB: integer("binding_id_b").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow()
	}
)

export const worldLoreEntries = attic.table("world_lore_entries", {
	id: integer("id").generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id").notNull(),
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
		.default(sql`(CURRENT_TIMESTAMP)`),
	position: integer("position").notNull().default(0),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const characterLoreEntries = attic.table("character_lore_entries", {
	id: integer("id").generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id").notNull(),
	lorebookBindingId: integer("character_binding_id"),
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
		.default(sql`(CURRENT_TIMESTAMP)`),
	position: integer("position").notNull().default(0),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const historyEntries = attic.table("history_entries", {
	id: integer("id").generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id").notNull(),
	year: integer("year").notNull().default(1),
	month: integer("month"),
	day: integer("day"),
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
		.default(sql`(CURRENT_TIMESTAMP)`),
	position: integer("position").notNull().default(0),
	isCompleted: boolean("is_completed").notNull().default(false),
	graphed: boolean("graphed").notNull().default(false),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const tags = attic.table("tags", {
	id: integer("id").generatedByDefaultAsIdentity(),
	userId: integer("user_id").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	colorPreset: text("color_preset")
		.notNull()
		.default("preset-filled-primary-500")
})

export const characterTags = attic.table("character_tags", {
	characterId: integer("character_id").notNull(),
	tagId: integer("tag_id").notNull()
})

export const personaTags = attic.table("persona_tags", {
	personaId: integer("persona_id").notNull(),
	tagId: integer("tag_id").notNull()
})

export const lorebookTags = attic.table("lorebook_tags", {
	lorebookId: integer("lorebook_id").notNull(),
	tagId: integer("tag_id").notNull()
})

export const chatTags = attic.table("chat_tags", {
	chatId: integer("chat_id").notNull(),
	tagId: integer("tag_id").notNull()
})

export const characters = attic.table("characters", {
	id: integer("id").generatedByDefaultAsIdentity(),
	uuid: uuid("uuid")
		.notNull()
		.default(sql`(gen_random_uuid ())`),
	userId: integer("user_id").notNull(),
	name: text("name").notNull(),
	nickname: text("nickname"),
	characterVersion: text("character_version").default("1.0"),
	description: text("description").notNull(),
	personality: text("personality"),
	scenario: text("scenario"),
	firstMessage: text("first_message"),
	alternateGreetings: json("alternate_greetings")
		.notNull()
		.default([])
		.$type<string[]>(),
	exampleDialogues: json("example_dialogues")
		.notNull()
		.default([])
		.$type<string[]>(),
	metadata: json("metadata")
		.notNull()
		.default({})
		.$type<Record<string, any>>(),
	avatar: text("avatar"),
	creatorNotes: text("creator_notes"),
	creatorNotesMultilingual: json("creator_notes_multilingual").$type<
		Record<string, string>
	>(),
	groupOnlyGreetings: json("group_only_greetings").$type<string[]>(),
	postHistoryInstructions: text("post_history_instructions"),
	source: json("source").notNull().default([]).$type<string[]>(),
	assets: json("assets").notNull().default([]).$type<
		Array<{
			type: string
			uri: string
			name: string
			ext: string
		}>
	>(),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	lorebookId: integer("lorebook_id"),
	extensions: json("extensions")
		.notNull()
		.default({})
		.$type<Record<string, any>>(),
	aliases: json("aliases").notNull().default([]).$type<string[]>(),
	summary: text("summary"),
	creator: text("creator"),
	category: text("category"),
	isFavorite: boolean("is_favorite").notNull().default(false),
	isDeleted: boolean("is_deleted").notNull().default(false),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const characterGalleryImages = attic.table("character_gallery_images", {
	id: integer("id").generatedByDefaultAsIdentity(),
	characterId: integer("character_id").notNull(),
	path: text("path").notNull(),
	position: integer("position").notNull().default(0),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const personas = attic.table("personas", {
	id: integer("id").generatedByDefaultAsIdentity(),
	uuid: uuid("uuid")
		.notNull()
		.default(sql`(gen_random_uuid ())`),
	userId: integer("user_id").notNull(),
	isDefault: boolean("is_default").notNull(),
	avatar: text("avatar"),
	name: text("name").notNull(),
	description: text("description").notNull(),
	position: integer("position").default(0),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: timestamp("updated_at").default(sql`(CURRENT_TIMESTAMP)`),
	lorebookId: integer("lorebook_id"),
	aliases: json("aliases").notNull().default([]).$type<string[]>(),
	summary: text("summary"),
	creator: text("creator"),
	category: text("category"),
	isDeleted: boolean("is_deleted").notNull().default(false),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const personaGalleryImages = attic.table("persona_gallery_images", {
	id: integer("id").generatedByDefaultAsIdentity(),
	personaId: integer("persona_id").notNull(),
	path: text("path").notNull(),
	position: integer("position").notNull().default(0),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const chats = attic.table("chats", {
	id: integer("id").generatedByDefaultAsIdentity(),
	name: text("name"),
	isGroup: boolean("is_group").notNull(),
	chatType: text("chat_type").notNull().default("roleplay"),
	userId: integer("user_id").notNull(),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	scenario: text("scenario"),
	metadata: json("metadata")
		.notNull()
		.default({})
		.$type<Record<string, any>>(),
	groupReplyStrategy: text("group_reply_strategy").default("ordered"),
	lorebookId: integer("lorebook_id"),
	connectionId: integer("connection_id"),
	samplingConfigId: integer("sampling_config_id"),
	promptConfigId: integer("prompt_config_id"),
	narratorPromptConfigId: integer("narrator_prompt_config_id"),
	drafts: json("drafts").$type<Record<string, string>>().notNull().default({})
})

export const chatMessages = attic.table("chat_messages", {
	id: integer("id").generatedByDefaultAsIdentity(),
	chatId: integer("chat_id").notNull(),
	userId: integer("user_id"),
	characterId: integer("character_id"),
	personaId: integer("persona_id"),
	role: text("role").notNull(),
	isNarratorResponse: boolean("is_narrator_response")
		.notNull()
		.default(false),
	content: text("content").notNull(),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	isEdited: boolean("is_edited").notNull().default(false),
	// 0.5.3's keys, as 0.5.3 wrote them: `thinking` / `thinkingHistory` reach
	// 0.6 as `reasoning` / `reasoningHistory` (`etl/sessions.ts`).
	metadata: json("metadata").notNull().default({}).$type<{
		isGreeting?: boolean
		swipes?: {
			currentIdx: number | null
			history: string[]
			thinkingHistory?: (string | null)[]
		}
		thinking?: string | null
		narratorInstructions?: string
		narratorName?: string
	}>(),
	isGenerating: boolean("is_generating").notNull().default(false),
	generationStage: text("generation_stage"),
	error: json("error").$type<{ message: string; code?: string } | null>(),
	queueItemId: text("queue_item_id"),
	isHidden: boolean("is_hidden").notNull().default(false),
	debugMeta: json("debug_meta").$type<Record<string, any>>(),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at")
})

export const chatPersonas = attic.table("chat_personas", {
	chatId: integer("chat_id").notNull(),
	personaId: integer("persona_id"),
	position: integer("position").default(0),
	removedAt: timestamp("removed_at"),
	removedName: text("removed_name")
})

export const chatCharacters = attic.table("chat_characters", {
	chatId: integer("chat_id").notNull(),
	characterId: integer("character_id"),
	position: integer("position").default(0),
	isActive: boolean("is_active").notNull().default(true),
	visibility: text("visibility").notNull().default("visible"),
	removedAt: timestamp("removed_at"),
	removedName: text("removed_name")
})

export const chatLorebooks = attic.table("chat_lorebooks", {
	chatId: integer("chat_id").notNull(),
	lorebookId: integer("lorebook_id").notNull(),
	position: integer("position").default(0)
})

export const chatGuests = attic.table("chat_guests", {
	chatId: integer("chat_id").notNull(),
	userId: integer("user_id").notNull(),
	isPlayer: boolean("is_player").notNull().default(true)
})

export const systemSettings = attic.table("system_settings", {
	id: integer("id").generatedByDefaultAsIdentity(),
	defaultConnectionId: integer("default_connection_id"),
	lockConnection: boolean("lock_connection").notNull().default(false),
	defaultSamplingConfigId: integer("default_sampling_id"),
	lockSamplingConfig: boolean("lock_sampling_config")
		.notNull()
		.default(false),
	defaultContextConfigId: integer("default_context_config_id"),
	lockContextConfig: boolean("lock_context_config").notNull().default(false),
	defaultPromptConfigId: integer("default_prompt_config_id"),
	lockPromptConfig: boolean("lock_prompt_config").notNull().default(false),
	defaultNarratorPromptConfigId: integer("default_narrator_prompt_config_id"),
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
	defaultSummarizeWorldConfigId: integer("default_summarize_world_config_id"),
	defaultSummarizeCharacterConfigId: integer(
		"default_summarize_character_config_id"
	),
	defaultSummarizeSceneConfigId: integer("default_summarize_scene_config_id"),
	defaultGraphBuildConfigId: integer("default_graph_build_config_id"),
	charaVaultEmail: text("chara_vault_email"),
	charaVaultEncryptedToken: text("chara_vault_encrypted_token"),
	charaVaultTokenIv: text("chara_vault_token_iv"),
	charaVaultTokenAuthTag: text("chara_vault_token_auth_tag")
})

export const ollamaSettings = attic.table("ollama_settings", {
	id: integer("id").notNull().default(1),
	ollamaManagerEnabled: boolean("ollama_manager_enabled")
		.notNull()
		.default(false),
	ollamaManagerBaseUrl: text("ollama_base_url")
		.notNull()
		.default("http://localhost:11434/")
})

export const koboldCppSettings = attic.table("koboldcpp_settings", {
	id: integer("id").notNull().default(1),
	koboldCppManagerEnabled: boolean("koboldcpp_manager_enabled")
		.notNull()
		.default(false),
	koboldCppManagerBaseUrl: text("koboldcpp_base_url")
		.notNull()
		.default("http://localhost:5001"),
	koboldCppManagerModelsDir: text("koboldcpp_models_dir"),
	koboldCppManagedMode: text("koboldcpp_managed_mode"),
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

export const koboldCppModels = attic.table("koboldcpp_models", {
	id: integer("id").generatedByDefaultAsIdentity(),
	filename: text("filename").notNull(),
	modelName: text("model_name").notNull(),
	modelUrl: text("model_url"),
	downloadUrl: text("download_url"),
	description: text("description"),
	quantization: text("quantization"),
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	status: text("status").notNull().default("downloading"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow()
})

export const scenes = attic.table("scenes", {
	id: integer("id").generatedByDefaultAsIdentity(),
	chatId: integer("chat_id"),
	lorebookId: integer("lorebook_id").notNull(),
	historyEntryId: integer("history_entry_id").notNull(),
	name: text("name"),
	selectedMessageIds: json("selected_message_ids")
		.notNull()
		.default([])
		.$type<number[]>(),
	summary: text("summary"),
	castResolvedAt: timestamp("cast_resolved_at"),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	graphed: boolean("graphed").notNull().default(false),
	createdAt: date("created_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: date("updated_at")
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
})

export const sceneCharacters = attic.table("scene_characters", {
	id: integer("id").generatedByDefaultAsIdentity(),
	sceneId: integer("scene_id").notNull(),
	bindingId: integer("binding_id").notNull(),
	role: text("role").notNull().$type<SceneCharacterRole>(),
	ordinal: integer("ordinal").notNull().default(0)
})

export const narrativeRelationships = attic.table("narrative_relationships", {
	id: integer("id").generatedByDefaultAsIdentity(),
	lorebookId: integer("lorebook_id").notNull(),
	fromNodeId: integer("from_node_id").notNull(),
	toNodeId: integer("to_node_id").notNull(),
	historyEntryId: integer("history_entry_id"),
	sceneId: integer("scene_id"),
	relationshipType: text("relationship_type").notNull().default("neutral"),
	description: text("description").notNull().default(""),
	visibility: text("visibility")
		.notNull()
		.default("acknowledged")
		.$type<RelationshipVisibility>(),
	status: text("status").notNull().default("active"),
	reason: text("reason"),
	embedding: real("embedding").array(),
	embeddingModel: text("embedding_model"),
	vectorizedAt: timestamp("vectorized_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow()
})

export const setup = attic.table("setup", {
	id: integer("id").generatedByDefaultAsIdentity(),
	userId: integer("user_id").notNull(),
	summarizationStepComplete: boolean("summarization_step_complete")
		.notNull()
		.default(false),
	ragStepComplete: boolean("rag_step_complete").notNull().default(false)
})

export const vectorizationConfigs = attic.table("vectorization_configs", {
	id: integer("id").notNull().default(1),
	embeddingModelTtlMinutes: integer("embedding_model_ttl_minutes")
		.notNull()
		.default(5),
	mode: text("mode").notNull().default("local"),
	apiBaseUrl: text("api_base_url"),
	apiKey: text("api_key"),
	apiKeyIv: text("api_key_iv"),
	apiKeyAuthTag: text("api_key_auth_tag"),
	apiModel: text("api_model"),
	apiDimensions: integer("api_dimensions")
})

export const customThemes = attic.table("custom_themes", {
	id: integer("id").generatedByDefaultAsIdentity(),
	name: text("name").notNull(),
	label: text("label").notNull(),
	css: text("css").notNull(),
	cssKey: text("css_key").notNull().default(""),
	uploadedBy: integer("uploaded_by"),
	isInstanceTheme: boolean("is_instance_theme").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow()
})

/**
 * Every id the restore changed, by 0.5.3 table: a persona's character id, an
 * entry table's `lorebook_entries` id, a sampling config matched to its seed.
 * Written in the restore's transaction and read by the wiring that follows it,
 * possibly on a later boot.
 */
export const idmap = attic.table("__idmap", {
	tableName: text("table_name").notNull(),
	oldId: integer("old_id").notNull(),
	newId: integer("new_id").notNull()
})

/**
 * The migration ledger rows the stash pruned (matching no shipped migration
 * file), for the restore's upgrade note. Absent when none were pruned.
 */
export const ledgerPruned = attic.table(ATTIC_LEDGER_PRUNED, {
	hash: text("hash").notNull(),
	createdAt: bigint("created_at", { mode: "number" })
})

/** One row once the restore has committed; its absence means it has not. */
export const restored = attic.table("__restored", {
	at: timestamp("at").notNull()
})
