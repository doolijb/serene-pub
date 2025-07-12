// See https://svelte.dev/docs/kit/types#app.d.ts

import type { Component } from "@lucide/svelte"
import * as schema from "$lib/server/db/schema"
import type { Schema } from "inspector/promises"
import type { P } from "ollama/dist/shared/ollama.d792a03f.mjs"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions"
import { FileAcceptDetails } from "../node_modules/@zag-js/file-upload/dist/index.d"

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			latestReleaseTag?: string
			isNewerReleaseAvailable?: boolean
		}
		interface PageData {
			latestReleaseTag?: string
			isNewerReleaseAvailable?: boolean
		}
		// interface PageState {}
		// interface Platform {}
	}

	interface OpenChangeDetails {
		open: boolean
	}

	interface PanelsCtx {
		leftPanel: string | null
		rightPanel: string | null
		mobilePanel: string | null
		isMobileMenuOpen: boolean
		openPanel: (args: { key: string; toggle?: boolean }) => void
		closePanel: (args: {
			panel: "left" | "right" | "mobile"
		}) => Promise<boolean>
		onLeftPanelClose?: () => Promise<boolean>
		onRightPanelClose?: () => Promise<boolean>
		onMobilePanelClose?: () => Promise<boolean>
		leftNav: Record<
			string,
			{ icon: Component<Icons.IconProps, {}, "">; title: string }
		>
		rightNav: Record<
			string,
			{ icon: Component<Icons.IconProps, {}, "">; title: string }
		>
		digest: {
			characterId?: number
			personaId?: number
			chatPersonaId?: number
			chatCharacterId?: number
		}
	}

	interface UserCtx {
		user:
			| (SelectUser & {
					activeConnection: SelectConnection | null
					activeSamplingConfig: SelectSamplingConfig | null
					activeContextConfig: SelectContextConfig | null
					activePromptConfig: SelectPromptConfig | null
			  })
			| undefined
	}

	interface ThemeCtx {
		mode: "light" | "dark"
		theme: string
	}

	// Model select and insert
	type SelectUser = typeof schema.users.$inferSelect
	type InsertUser = typeof schema.users.$inferInsert
	type SelectSamplingConfig = typeof schema.samplingConfigs.$inferSelect
	type InsertSamplingConfig = typeof schema.samplingConfigs.$inferInsert
	type SelectConnection = typeof schema.connections.$inferSelect
	type InsertConnection = typeof schema.connections.$inferInsert
	type SelectContextConfig = typeof schema.contextConfigs.$inferSelect
	type InsertContextConfig = typeof schema.contextConfigs.$inferInsert
	type SelectPromptConfig = typeof schema.promptConfigs.$inferSelect
	type InsertPromptConfig = typeof schema.promptConfigs.$inferInsert
	type SelectLorebook = typeof schema.lorebooks.$inferSelect
	type InsertLorebook = typeof schema.lorebooks.$inferInsert
	type SelectWorldLoreEntry = typeof schema.worldLoreEntries.$inferSelect
	type InsertWorldLoreEntry = typeof schema.worldLoreEntries.$inferInsert
	type SelectCharacterLoreEntry =
		typeof schema.characterLoreEntries.$inferSelect
	type InsertCharacterLoreEntry =
		typeof schema.characterLoreEntries.$inferInsert
	type SelectHistoryEntry = typeof schema.historyEntries.$inferSelect
	type InsertHistoryEntry = typeof schema.historyEntries.$inferInsert
	type SelectTag = typeof schema.tags.$inferSelect
	type InsertTag = typeof schema.tags.$inferInsert
	type SelectCharacterTag = typeof schema.characterTags.$inferSelect
	type InsertCharacterTag = typeof schema.characterTags.$inferInsert
	type SelectCharacter = typeof schema.characters.$inferSelect
	type InsertCharacter = typeof schema.characters.$inferInsert
	type SelectPersona = typeof schema.personas.$inferSelect
	type InsertPersona = typeof schema.personas.$inferInsert
	type SelectChat = typeof schema.chats.$inferSelect
	type InsertChat = typeof schema.chats.$inferInsert
	type SelectChatMessage = typeof schema.chatMessages.$inferSelect
	type InsertChatMessage = typeof schema.chatMessages.$inferInsert
	type SelectChatPersona = typeof schema.chatPersonas.$inferSelect
	type InsertChatPersona = typeof schema.chatPersonas.$inferInsert
	type SelectChatCharacter = typeof schema.chatCharacters.$inferSelect
	type InsertChatCharacter = typeof schema.chatCharacters.$inferInsert
	type SelectChatLorebook = typeof schema.chatLorebooks.$inferSelect
	type InsertChatLorebook = typeof schema.chatLorebooks.$inferInsert
	type SelectLorebookBinding = typeof schema.lorebookBindings.$inferSelect
	type InsertLorebookBinding = typeof schema.lorebookBindings.$inferInsert

	namespace Sockets {
		namespace SamplingConfig {
			interface Call {
				id: number
			}
			interface Response {
				sampling: SelectSamplingConfig
			}
		}
		namespace SamplingConfigList {
			interface Call {}
			interface Response {
				samplingConfigsList: Partial<SelectSamplingConfig>[]
			}
		}
		namespace ContextConfigsList {
			interface Call {}
			interface Response {
				contextConfigsList: Partial<SelectContextConfig>[]
			}
		}
		namespace ContextConfig {
			interface Call {
				id: number
			}
			interface Response {
				contextConfig: SelectContextConfig
			}
		}
		namespace CreateContextConfig {
			interface Call {
				contextConfig: InsertContextConfig
			}
			interface Response {
				contextConfig: SelectContextConfig
			}
		}
		namespace UpdateContextConfig {
			interface Call {
				contextConfig: InsertContextConfig & { id: number }
			}
			interface Response {
				contextConfig: SelectContextConfig
			}
		}
		namespace SetUserActiveContextConfig {
			interface Call {
				id: number
			}
			interface Response {
				user: SelectUser
			}
		}
		namespace DeleteContextConfig {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		// PERSONAS
		namespace PersonaList {
			interface Call {}
			interface Response {
				personaList: Partial<SelectPersona>[]
			}
		}
		namespace Persona {
			interface Call {
				id: number
			}
			interface Response {
				persona: SelectPersona | null
			}
		}
		namespace CreatePersona {
			interface Call {
				persona: InsertPersona
				avatarFile?: Buffer
			}
			interface Response {
				persona: SelectPersona
			}
		}
		namespace UpdatePersona {
			interface Call {
				persona: InsertPersona & { id: number }
				avatarFile?: Buffer
			}
			interface Response {
				persona: SelectPersona
			}
		}
		namespace DeletePersona {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		// CHARACTERS
		namespace CharacterList {
			interface Call {}
			interface Response {
				characterList: Partial<SelectCharacter>[]
			}
		}
		namespace Character {
			interface Call {
				id: number
			}
			interface Response {
				character: SelectCharacter | null
			}
		}
		namespace CreateCharacter {
			interface Call {
				character: InsertCharacter
				avatarFile?: Buffer
			}
			interface Response {
				character: SelectCharacter
			}
		}
		namespace UpdateCharacter {
			interface Call {
				character: InsertCharacter & { id: number }
				avatarFile?: Buffer
			}
			interface Response {
				character: SelectCharacter
			}
		}
		namespace DeleteCharacter {
			interface Call {
				characterId: number
			}
			interface Response {
				id: number
			}
		}
		// CONNECTIONS
		namespace ConnectionsList {
			interface Call {}
			interface Response {
				connectionsList: Partial<SelectConnection>[]
			}
		}
		namespace Connection {
			interface Call {
				id: number
			}
			interface Response {
				connection: SelectConnection | null
			}
		}
		namespace CreateConnection {
			interface Call {
				connection: InsertConnection
			}
			interface Response {
				connection: SelectConnection
			}
		}
		namespace UpdateConnection {
			interface Call {
				connection: InsertConnection & { id: number }
			}
			interface Response {
				connection: SelectConnection
			}
		}
		namespace DeleteConnection {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		namespace SetUserActiveConnection {
			interface Call {
				id: number | null
			}
			interface Response {
				ok: boolean
			}
		}
		namespace TestConnection {
			interface Call {
				connection: any
			}
			interface Response {
				ok: boolean
				error: string | null
				models: any[]
			}
		}
		namespace RefreshModels {
			interface Call {
				connection: SelectConnection
			}
			interface Response {
				models: any[]
				error: string | null
			}
		}
		// --- WEIGHTS ---
		namespace DeleteSamplingConfig {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		namespace UpdateSamplingConfig {
			interface Call {
				samplingConfig: Partial<InsertSamplingConfig> & { id: number }
			}
			interface Response {
				samplingConfig: SelectSamplingConfig
			}
		}
		namespace SetUserActiveSamplingConfig {
			interface Call {
				id: number | null
			}
			interface Response {
				user: any
			}
		}
		// --- CHATS ---
		namespace ChatsList {
			interface Call {}
			interface Response {
				chatsList: Partial<
					SelectChat & {
						chatPersonas: SelectChatPersona &
							{ persona: SelectPersona }[]
						chatCharacters: SelectChatCharacter &
							{ character: SelectCharacter }[]
					}
				>[]
			}
		}
		namespace CreateChat {
			interface Call {
				chat: InsertChat
				personaIds: number[]
				characterIds: number[]
				characterPositions: Record<number, number>
			}
			interface Response {
				chat: SelectChat & {
					chatPersonas: SelectChatPersona &
						{ persona: SelectPersona }[]
					chatCharacters: SelectChatCharacter &
						{ character: SelectCharacter }[]
					chatMessages: SelectChatMessage[]
				}
			}
		}
		namespace UpdateChat {
			interface Call {
				chat: InsertChat & { id: number; userId?: undefined | number }
				personaIds: number[]
				characterIds: number[]
				characterPositions: Record<number, number>
			}
			interface Response {
				chat: SelectChat & {
					chatPersonas: SelectChatPersona &
						{ persona: SelectPersona }[]
					chatCharacters: SelectChatCharacter &
						{ character: SelectCharacter }[]
					chatMessages: SelectChatMessage[]
				}
			}
		}
		namespace Chat {
			interface Call {
				id: number
			}
			interface Response {
				chat: SelectChat & {
					chatPersonas: SelectChatPersona &
						{ persona: SelectPersona }[]
					chatCharacters: SelectChatCharacter &
						{ character: SelectCharacter }[]
					chatMessages: SelectChatMessage[]
				}
			}
		}
		namespace ChatMessage {
			interface Call {
				id?: number
				chatMessage?: SelectChatMessage
			}
			interface Response {
				chatMessage: SelectChatMessage
			}
		}
		// PROMPT CONFIGS
		namespace PromptConfigsList {
			interface Call {}
			interface Response {
				promptConfigsList: Partial<SelectPromptConfig>[]
			}
		}
		namespace PromptConfig {
			interface Call {
				id: number
			}
			interface Response {
				promptConfig: SelectPromptConfig
			}
		}
		namespace CreatePromptConfig {
			interface Call {
				promptConfig: InsertPromptConfig
			}
			interface Response {
				promptConfig: SelectPromptConfig
			}
		}
		namespace UpdatePromptConfig {
			interface Call {
				promptConfig: InsertPromptConfig & { id: number }
			}
			interface Response {
				promptConfig: SelectPromptConfig
			}
		}
		namespace DeletePromptConfig {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		namespace SetUserActivePromptConfig {
			interface Call {
				id: number
			}
			interface Response {
				user: SelectUser
			}
		}
		namespace SendPersonaMessage {
			interface Call {
				chatId: number
				personaId: number
				content: string
			}
			interface Response {
				chatMessage: SelectChatMessage
			}
		}
		namespace DeleteChat {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		namespace DeleteChatMessage {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}
		namespace UpdateChatMessage {
			interface Call {
				chatMessage: SelectChatMessage
			}
			interface Response {
				chatMessage: SelectChatMessage
			}
		}
		namespace RegenerateChatMessage {
			interface Call {
				id: number
			}
			interface Response {
				chatMessage?: SelectChatMessage
				error?: string
			}
		}
		namespace PromptTokenCount {
			interface Call {
				chatId: number
				content?: string
				role?: string
				personaId?: number
			}
			interface Response extends CompiledPrompt {}
		}
		namespace AbortChatMessage {
			interface Call {
				id: number
			}
			interface Response {
				id: number
				success: boolean
				info?: string
				error?: string
			}
		}
		namespace TriggerGenerateMessage {
			interface Call {
				chatId: number
				characterId?: number
				once?: boolean
			}
			interface Response {
				chatMessage?: SelectChatMessage
				error?: string
			}
		}
		namespace ChatMessageSwipeRight {
			interface Call {
				chatId: number
				chatMessageId: number
				count?: number
			}
			interface Response {
				chatId: number
				chatMessageId: number
				done: boolean
			}
		}
		namespace ChatMessageSwipeLeft {
			interface Call {
				chatId: number
				chatMessageId: number
			}
			interface Response {
				chatId: number
				chatMessageId: number
				done: boolean
			}
		}
		// Lorebook List
		namespace LorebookList {
			interface Call {
				userId?: number
			}
			interface Response {
				lorebookList: SelectLorebook[]
			}
		}

		// Single Lorebook
		namespace Lorebook {
			interface Call {
				id: number
			}
			interface Response {
				lorebook: SelectLorebook & {
					worldLoreEntries: SelectWorldLoreEntry[]
					characterLoreEntries: SelectCharacterLoreEntry[]
					historyEntries: SelectHistoryEntry[]
					lorebookBindings: SelectLorebookBinding[]
				}
			}
		}

		// Create Lorebook
		namespace CreateLorebook {
			interface Call {
				name: string
			}
			interface Response {
				lorebook: SelectLorebook
			}
		}

		// Create Lorebook Binding
		namespace CreateLorebookBinding {
			interface Call {
				lorebookBinding: {
					lorebookId: number
					characterId?: number | null
					personaId?: number | null
				}
			}
			interface Response {
				lorebookBinding: SelectLorebookBinding
			}
		}

		// Lorebook Binding List
		namespace LorebookBindingList {
			interface Call {
				lorebookId: number
				with?: {
					character?: boolean
					persona?: boolean
				}
			}
			interface Response {
				lorebookId: number
				lorebookBindingList: SelectLorebookBinding[]
			}
		}

		// Update Lorebook Binding
		namespace UpdateLorebookBinding {
			interface Call {
				lorebookBinding: {
					id: number
					characterId?: number | null
					personaId?: number | null
				}
			}
			interface Response {
				lorebookBinding: SelectLorebookBinding
			}
		}

		// World Lore Entry List
		namespace WorldLoreEntryList {
			interface Call {
				lorebookId: number
			}
			interface Response {
				worldLoreEntryList: SelectWorldLoreEntry[]
			}
		}

		// Create World Lore Entry
		namespace CreateWorldLoreEntry {
			interface Call {
				worldLoreEntry: InsertWorldLoreEntry
			}
			interface Response {
				worldLoreEntry: SelectWorldLoreEntry
			}
		}

		// Update World Lore Entry
		namespace UpdateWorldLoreEntry {
			interface Call {
				worldLoreEntry: {
					id: number
					name: string
					content: string
				}
			}
			interface Response {
				worldLoreEntry: SelectWorldLoreEntry
			}
		}

		// Delete World Lore Entry
		namespace DeleteWorldLoreEntry {
			interface Call {
				id: number
				lorebookId: number
			}
			interface Response {
				// id: number,
				// lorebookId: number
			}
		}

		// Update Lorebook
		namespace UpdateLorebook {
			interface Call {
				lorebook: {
					id: number
					name: string
				}
			}
			interface Response {
				lorebook: SelectLorebook
			}
		}

		// Delete Lorebook
		namespace DeleteLorebook {
			interface Call {
				id: number
			}
			interface Response {
				id: number
			}
		}

		// Update World Lore Entry Positions
		namespace UpdateWorldLoreEntryPositions {
			interface Call {
				lorebookId: number
				positions: Array<{ id: number; position: number }>
			}
			interface Response {
				lorebookId: number
			}
		}

		// Character Lore Entry List
		namespace CharacterLoreEntryList {
			interface Call {
				lorebookId: number
			}
			interface Response {
				characterLoreEntryList: SelectCharacterLoreEntry[]
			}
		}

		// Create Character Lore Entry
		namespace CreateCharacterLoreEntry {
			interface Call {
				characterLoreEntry: InsertCharacterLoreEntry
			}
			interface Response {
				characterLoreEntry: SelectCharacterLoreEntry
			}
		}

		// Update Character Lore Entry
		namespace UpdateCharacterLoreEntry {
			interface Call {
				characterLoreEntry: SelectCharacterLoreEntry
			}
			interface Response {
				characterLoreEntry: SelectCharacterLoreEntry
			}
		}

		// Delete Character Lore Entry
		namespace DeleteCharacterLoreEntry {
			interface Call {
				id: number
				lorebookId: number
			}
			interface Response {
				id: number
				lorebookId: number
			}
		}

		// Update Character Lore Entry Positions
		namespace UpdateCharacterLoreEntryPositions {
			interface Call {
				lorebookId: number
				positions: Array<{ id: number; position: number }>
			}
			interface Response {
				lorebookId: number
			}
		}

		namespace HistoryEntryList {
			interface Call {
				lorebookId: number
			}
			interface Response {
				historyEntryList: SelectHistoryEntry[]
			}
		}

		namespace CreateHistoryEntry {
			interface Call {
				historyEntry: InsertHistoryEntry
			}
			interface Response {
				historyEntry: SelectHistoryEntry
			}
		}

		namespace UpdateHistoryEntry {
			interface Call {
				historyEntry: SelectHistoryEntry
			}
			interface Response {
				historyEntry: SelectHistoryEntry
			}
		}

		namespace DeleteHistoryEntry {
			interface Call {
				id: number
				lorebookId: number
			}
			interface Response {
				id: number
				lorebookId: number
			}
		}

		namespace IterateNextHistoryEntry {
			interface Call {
				lorebookId: number
			}
			interface Response {
				historyEntry: SelectHistoryEntry
			}
		}
		// Character Card Import
		namespace CharacterCardImport {
			interface Call {
				file: string // base64 or data URL
			}
			interface Response {
				character: SelectCharacter
				book: any | null // adjust type if you have a type for character_book
			}
		}

		// Import Lorebook
		namespace LorebookImport {
			interface Call {
				lorebookData: SpecV3.Lorebook
				characterId?: number
			}
			interface Response {
				lorebook: SelectLorebook & {
					lorebookBindings: SelectLorebookBinding[]
					worldLoreEntries: SelectWorldLoreEntry[]
					characterLoreEntries: SelectCharacterLoreEntry[]
					historyEntries: SelectHistoryEntry[]
				}
			}
		}
		// Toggle Chat Character Active
		namespace ToggleChatCharacterActive {
			interface Call {
				chatId: number
				characterId: number
			}
			interface Response {
				chatId: number
				characterId: number
				isActive: boolean
			}
		}
		namespace SetTheme {
			interface Call {
				theme: string
				darkMode: boolean
			}
			interface Response {}
		}
	}

	export interface CharaImportMetadata {
		data: {
			alternate_greetings?: string[]
			avatar?: string
			character_version?: string
			creator?: string
			creator_notes?: string
			description: string
			extensions?: {
				[key: string]: {
					alt_expressions: Record<string, unknown>
					expressions: unknown
					full_path: string
					id: number
					related_lorebooks: unknown[]
				}
			}
			first_mes?: string
			mes_example?: string
			name: string
			personality?: string
			post_history_instructions?: string
			scenario?: string
			system_prompt?: string
			tags?: string[]
		}
		spec: string
		spec_version: string
	}

	export type CompiledPrompt = {
		prompt?: string
		messages?: ChatCompletionMessageParam[]
		meta: {
			tokenCounts: {
				total: number
				limit: number
			}
			chatMessages: {
				included: number
				total: number
				includedIds: number[]
				excludedIds: number[]
			}
			sources: {
				characters: Array<{
					id: number
					name: string
					nickname?: string
					description: boolean
					personality: boolean
					exampleDialogue: boolean
					postHistoryInstructions: boolean
					postHistoryInstructions: boolean
				}>
				personas: Array<{
					id: number
					name: string
					description: boolean
				}>
				scenario: null | "character" | "chat"
			}
		}
	}

	interface FileAcceptDetails {
		files: File[]
	}
}

export {}
