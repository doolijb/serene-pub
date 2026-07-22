import type * as schema from "$lib/server/db/schema"
import type { db } from "$lib/server/db"
import type { SelectedFieldsFlat } from "drizzle-orm/pg-core"

export global {
	// Transaction handle type inferred directly from the db instance's own
	// `.transaction()` callback parameter, so it always matches whatever
	// driver (pglite) backs `db`.
	export type DbTransaction = Parameters<typeof db.transaction>[0] extends (
		tx: infer T,
		...args: any[]
	) => any
		? T
		: never

	// Column/expression map accepted by Drizzle's `.returning(fields)`. Kept
	// flat (rather than the wider `SelectedFields`) since `PgDelete.returning`
	// only accepts `SelectedFieldsFlat`; a flat map is still assignable
	// wherever the wider `SelectedFields` (e.g. `PgUpdate.returning`) is
	// expected.
	export type ReturningSelect = SelectedFieldsFlat
	// User types
	export type SelectUser = typeof schema.users.$inferSelect
	export type InsertUser = typeof schema.users.$inferInsert
	export type UpdateUser = Partial<SelectUser> & { id: number }

	// Sampling Config types
	export type SelectSamplingConfig =
		typeof schema.samplingConfigs.$inferSelect
	export type InsertSamplingConfig =
		typeof schema.samplingConfigs.$inferInsert
	export type UpdateSamplingConfig = Partial<SelectSamplingConfig> & {
		id: number
	}

	// Connection types
	export type SelectConnection = typeof schema.connections.$inferSelect
	export type InsertConnection = typeof schema.connections.$inferInsert
	export type UpdateConnection = Partial<SelectConnection> & { id: number }

	// Context Config types
	export type SelectContextConfig = typeof schema.contextConfigs.$inferSelect
	export type InsertContextConfig = typeof schema.contextConfigs.$inferInsert
	export type UpdateContextConfig = Partial<SelectContextConfig> & {
		id: number
	}

	// Prompt Config types
	export type SelectPromptConfig = typeof schema.promptConfigs.$inferSelect
	export type InsertPromptConfig = typeof schema.promptConfigs.$inferInsert
	export type UpdatePromptConfig = Partial<SelectPromptConfig> & {
		id: number
	}

	// Narrator Prompt Config types
	export type SelectNarratorPromptConfig =
		typeof schema.narratorPromptConfigs.$inferSelect
	export type InsertNarratorPromptConfig =
		typeof schema.narratorPromptConfigs.$inferInsert
	export type UpdateNarratorPromptConfig =
		Partial<SelectNarratorPromptConfig> & {
			id: number
		}

	// Lorebook types
	export type SelectLorebook = typeof schema.lorebooks.$inferSelect
	export type InsertLorebook = typeof schema.lorebooks.$inferInsert
	export type UpdateLorebook = Partial<SelectLorebook> & { id: number }

	// Lorebook Binding types
	export type SelectLorebookBinding =
		typeof schema.lorebookBindings.$inferSelect
	export type InsertLorebookBinding =
		typeof schema.lorebookBindings.$inferInsert
	export type UpdateLorebookBinding = Partial<SelectLorebookBinding> & {
		id: number
	}

	// World Lore Entry types
	export type SelectWorldLoreEntry =
		typeof schema.worldLoreEntries.$inferSelect
	export type InsertWorldLoreEntry =
		typeof schema.worldLoreEntries.$inferInsert
	export type UpdateWorldLoreEntry = Partial<SelectWorldLoreEntry> & {
		id: number
	}

	// Character Lore Entry types
	export type SelectCharacterLoreEntry =
		typeof schema.characterLoreEntries.$inferSelect
	export type InsertCharacterLoreEntry =
		typeof schema.characterLoreEntries.$inferInsert
	export type UpdateCharacterLoreEntry = Partial<SelectCharacterLoreEntry> & {
		id: number
	}

	// History Entry types
	export type SelectHistoryEntry = typeof schema.historyEntries.$inferSelect
	export type InsertHistoryEntry = typeof schema.historyEntries.$inferInsert
	export type UpdateHistoryEntry = Partial<SelectHistoryEntry> & {
		id: number
	}

	// Tag types
	export type SelectTag = typeof schema.tags.$inferSelect
	export type InsertTag = typeof schema.tags.$inferInsert
	export type UpdateTag = Partial<SelectTag> & { id: number }

	// Character Tag types
	export type SelectCharacterTag = typeof schema.characterTags.$inferSelect
	export type InsertCharacterTag = typeof schema.characterTags.$inferInsert

	// Persona Tag types
	export type SelectPersonaTag = typeof schema.personaTags.$inferSelect
	export type InsertPersonaTag = typeof schema.personaTags.$inferInsert

	// Lorebook Tag types
	export type SelectLorebookTag = typeof schema.lorebookTags.$inferSelect
	export type InsertLorebookTag = typeof schema.lorebookTags.$inferInsert

	// Chat Tag types
	export type SelectChatTag = typeof schema.chatTags.$inferSelect
	export type InsertChatTag = typeof schema.chatTags.$inferInsert

	// Character types
	export type SelectCharacter = typeof schema.characters.$inferSelect
	export type InsertCharacter = typeof schema.characters.$inferInsert
	export type UpdateCharacter = Partial<SelectCharacter> & { id: number }

	// Persona types
	export type SelectPersona = typeof schema.personas.$inferSelect
	export type InsertPersona = typeof schema.personas.$inferInsert
	export type UpdatePersona = Partial<SelectPersona> & { id: number }

	// Chat types
	export type SelectChat = typeof schema.chats.$inferSelect
	export type InsertChat = typeof schema.chats.$inferInsert
	export type UpdateChat = Partial<SelectChat> & { id: number }

	// Chat Message types
	export type SelectChatMessage = typeof schema.chatMessages.$inferSelect
	export type InsertChatMessage = typeof schema.chatMessages.$inferInsert
	export type UpdateChatMessage = Partial<SelectChatMessage> & { id: number }

	// Chat Persona types
	export type SelectChatPersona = typeof schema.chatPersonas.$inferSelect
	export type InsertChatPersona = typeof schema.chatPersonas.$inferInsert

	// Chat Character types
	export type SelectChatCharacter = typeof schema.chatCharacters.$inferSelect
	export type InsertChatCharacter = typeof schema.chatCharacters.$inferInsert

	// Chat Lorebook types
	export type SelectChatLorebook = typeof schema.chatLorebooks.$inferSelect
	export type InsertChatLorebook = typeof schema.chatLorebooks.$inferInsert

	export type SelectSystemSettings = typeof schema.systemSettings.$inferSelect
	export type InsertSystemSettings = typeof schema.systemSettings.$inferInsert

	export type SelectOllamaSettings = typeof schema.ollamaSettings.$inferSelect
	export type InsertOllamaSettings = typeof schema.ollamaSettings.$inferInsert

	export type SelectKoboldCppSettings =
		typeof schema.koboldCppSettings.$inferSelect
	export type InsertKoboldCppSettings =
		typeof schema.koboldCppSettings.$inferInsert

	export type SelectUserSettings = typeof schema.userSettings.$inferSelect
	export type InsertUserSettings = typeof schema.userSettings.$inferInsert

	// Scene types
	export type SelectScene = typeof schema.scenes.$inferSelect
	export type InsertScene = typeof schema.scenes.$inferInsert
	export type UpdateScene = Partial<SelectScene> & { id: number }

	// Narrative graph types
	export type SelectNarrativeNode = typeof schema.narrativeNodes.$inferSelect
	export type InsertNarrativeNode = typeof schema.narrativeNodes.$inferInsert
	export type UpdateNarrativeNode = Partial<SelectNarrativeNode> & {
		id: number
	}

	export type SelectNarrativeRelationship =
		typeof schema.narrativeRelationships.$inferSelect
	export type InsertNarrativeRelationship =
		typeof schema.narrativeRelationships.$inferInsert
	export type UpdateNarrativeRelationship =
		Partial<SelectNarrativeRelationship> & { id: number }

	// World Summarize Config types
	export type SelectWorldSummarizeConfig =
		typeof schema.worldSummarizeConfigs.$inferSelect
	export type InsertWorldSummarizeConfig =
		typeof schema.worldSummarizeConfigs.$inferInsert
	export type UpdateWorldSummarizeConfig =
		Partial<SelectWorldSummarizeConfig> & { id: number }

	// Character Summarize Config types
	export type SelectCharacterSummarizeConfig =
		typeof schema.characterSummarizeConfigs.$inferSelect
	export type InsertCharacterSummarizeConfig =
		typeof schema.characterSummarizeConfigs.$inferInsert
	export type UpdateCharacterSummarizeConfig =
		Partial<SelectCharacterSummarizeConfig> & { id: number }

	// Scene Summarize Config types
	export type SelectSceneSummarizeConfig =
		typeof schema.sceneSummarizeConfigs.$inferSelect
	export type InsertSceneSummarizeConfig =
		typeof schema.sceneSummarizeConfigs.$inferInsert
	export type UpdateSceneSummarizeConfig =
		Partial<SelectSceneSummarizeConfig> & { id: number }

	// Graph Build Config types
	export type SelectGraphBuildConfig =
		typeof schema.graphBuildConfigs.$inferSelect
	export type InsertGraphBuildConfig =
		typeof schema.graphBuildConfigs.$inferInsert
	export type UpdateGraphBuildConfig = Partial<SelectGraphBuildConfig> & {
		id: number
	}

	// Convenient re-exports of narrative graph inline types for server-side handlers
	export type NarrativeNodeShape = Sockets.NarrativeGraph.NarrativeNode
	export type NarrativeRelationshipShape =
		Sockets.NarrativeGraph.NarrativeRelationship
}
