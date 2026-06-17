// Global Socket Types
// This file contains all the type definitions for socket communications
// Moved from app.d.ts to be shared between client and server

import type { ListResponse } from "ollama"
import type { SpecV3 } from "@lenml/char-card-reader"

declare global {
	namespace Sockets {
		// Error types
		interface ErrorResponse {
			error: string
			description?: string
		}

		// Authentication namespace
		namespace Auth {
			namespace Login {
				interface Params {
					username: string
					password: string
				}
				interface Response {
					user: {
						id: number
						username: string
						isAdmin: boolean
					}
					token: string
				}
			}
			namespace LoginError {
				interface Params {}
				interface Response {
					error: string
				}
			}
			namespace LoginSuccess {
				interface Params {}
				interface Response {
					user: {
						id: number
						username: string
						isAdmin: boolean
					}
					token: string
				}
			}
			namespace Logout {
				interface Params {}
				interface Response {}
			}
			namespace LogoutError {
				interface Params {}
				interface Response {
					error: string
				}
			}
			namespace LogoutSuccess {
				interface Params {}
				interface Response {}
			}
		}

		// Characters namespace - using Params/Ack pattern
		namespace Characters {
			namespace List {
				interface Params {}
				interface Response {
					characterList: Partial<SelectCharacter>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					character: SelectCharacter | null
				}
			}
			namespace Create {
				interface Params {
					character: InsertCharacter
					avatarFile?: Buffer
				}
				interface Response {
					character: SelectCharacter
				}
			}
			namespace Update {
				interface Params {
					character: UpdateCharacter
					avatarFile?: Buffer | null
				}
				interface Response {
					character: SelectCharacter
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace ImportCard {
				interface Params {
					file: string // base64 encoded file (JSON or PNG)
				}
				interface Response {
					character: SelectCharacter
					book: SpecV3.Lorebook | null
				}
			}
			namespace ExportCard {
				interface Params {
					id: number
					format?: "json" | "png"
				}
				interface Response {
					blob: Buffer
					filename: string
				}
			}
			namespace SearchLibrary {
				interface Params {
					searchTerm?: string
				}
				interface Response {
					characters: {
						name: string
						description: string
						tags: string[]
						author: string
						version: string
						spec: string
						file: string
						category: string
					}[]
				}
			}
			namespace ImportFromLibrary {
				interface Params {
					fileUrl: string
				}
				interface Response {
					character: SelectCharacter
					book: SpecV3.Lorebook | null
				}
			}
		}

		// Connections namespace
		namespace Connections {
			namespace List {
				interface Params {}
				interface Response {
					connectionsList: Partial<SelectConnection>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					connection: SelectConnection | null
				}
			}
			namespace Create {
				interface Params {
					connection: InsertConnection
				}
				interface Response {
					connection: SelectConnection
				}
			}
			namespace Update {
				interface Params {
					connection: UpdateConnection
				}
				interface Response {
					connection: SelectConnection
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					id: number
				}
			}
			namespace SetUserActive {
				interface Params {
					id: number | null
				}
				interface Response {
					ok: boolean
				}
			}
			namespace Test {
				interface Params {
					connection: any // Connection data to test
				}
				interface Response {
					ok: boolean
					error: string | null
					models: any[]
				}
			}
			namespace RefreshModels {
				interface Params {
					connection: any // Connection data
				}
				interface Response {
					models: any[]
					error: string | null
				}
			}
		}

		// Personas namespace
		namespace Personas {
			namespace List {
				interface Params {}
				interface Response {
					personaList: Partial<SelectPersona>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					persona: SelectPersona | null
				}
			}
			namespace Create {
				interface Params {
					persona: InsertPersona
					avatarFile?: Buffer
				}
				interface Response {
					persona: SelectPersona
				}
			}
			namespace Update {
				interface Params {
					persona: UpdatePersona
					avatarFile?: Buffer | null
				}
				interface Response {
					persona: SelectPersona
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace ImportCard {
				interface Params {
					file: string // base64 encoded file (JSON or PNG)
				}
				interface Response {
					persona: SelectPersona
				}
			}
			namespace SearchLibrary {
				interface Params {
					searchTerm?: string
				}
				interface Response {
					personas: {
						name: string
						description: string
						tags: string[]
						author: string
						version: string
						spec: string
						file: string
						category: string
					}[]
				}
			}
			namespace ImportFromLibrary {
				interface Params {
					fileUrl: string
				}
				interface Response {
					persona: SelectPersona
				}
			}
		}

		// Chats namespace
		namespace Chats {
			namespace List {
				interface Params {
					chatType?: string
				}
				interface Response {
					chatList: (Partial<SelectChat> & { canEdit: boolean })[]
				}
			}
			namespace Get {
				interface Params {
					id: number
					limit?: number
					offset?: number
				}
				interface Response {
					chat:
						| (SelectChat & {
								chatMessages: SelectChatMessage[]
								chatCharacters: (SelectChatCharacter & {
									character: SelectCharacter
								})[]
								chatPersonas: (SelectChatPersona & {
									persona: SelectPersona
								})[]
								chatTags?: { tag: { name: string } }[]
								chatGuests?: { user: any }[]
								tags?: string[]
						  })
						| null
					messages?: SelectChatMessage[] | null // Legacy field
					pagination?: any
				}
			}
			namespace Create {
				interface Params {
					chat: InsertChat
					characterIds: number[]
					personaIds: number[]
					characterPositions: Record<number, number>
					tags?: string[]
				}
				interface Response {
					chat: SelectChat
				}
			}
			namespace Update {
				interface Params {
					chat: UpdateChat
				}
				interface Response {
					chat: SelectChat
				}
			}
			namespace AddPersona {
				interface Params {
					chatId: number
					personaId: number
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace AddGuest {
				interface Params {
					chatId: number
					guestUserId: number
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace RemoveGuest {
				interface Params {
					chatId: number
					guestUserId: number
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
					id?: number
				}
			}
			namespace ExportLogs {
				interface Params {
					id: number
				}
				interface Response {
					blob: Buffer
					filename: string
				}
			}
			namespace GetResponseOrder {
				interface Params {
					chatId: number
				}
				interface Response {
					chatId: number
					characterId?: number | null // Legacy field for backward compatibility
					nextCharacterId: number | null // Actually used field
					characterIds: number[] // Array of character IDs in order
				}
			}
			namespace ToggleChatCharacterActive {
				interface Params {
					chatId: number
					characterId: number
				}
				interface Response {
					chatId: number
					characterId: number
					isActive: boolean
					error?: string
				}
			}
			namespace UpdateChatCharacterVisibility {
				interface Params {
					chatId: number
					characterId: number
					visibility: string
				}
				interface Response {
					chatId: number
					characterId: number
					visibility: string
					error?: string
				}
			}
			namespace PromptTokenCount {
				interface Params {
					chatId: number
					content?: string
					role?: string
					personaId?: number
				}
				interface Response {
					prompt?: string
					messages?: any[]
					meta: {
						promptFormat: string
						templateName: string | null
						timestamp: string
						truncationReason: string | null
						currentTurnCharacterId: number
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
							characters: any[]
							personas: any[]
							scenario: string | null
						}
					}
					error?: string
				}
			}
			namespace TriggerGenerateMessage {
				interface Params {
					chatId: number
					characterId?: number
					once?: boolean
					triggered?: boolean
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace Branch {
				interface Params {
					chatId: number
					messageId: number
					title: string
				}
				interface Response {
					chat?: SelectChat
					error?: string
				}
			}
			// Assistant chat specific handlers
			namespace CreateAssistant {
				interface Params {}
				interface Response {
					chat?: SelectChat
					error?: string
				}
			}
			namespace SendAssistantMessage {
				interface Params {
					chatId: number
					content: string
				}
				interface Response {
					userMessage?: SelectChatMessage
					assistantMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace TitleGenerated {
				interface Call {
					chatId: number
					title: string
				}
			}
			namespace SetLorebook {
				interface Params {
					chatId: number
					lorebookId: number | null
				}
				interface Response {
					chat: SelectChat
				}
			}
			namespace Summarize {
				interface Params {
					chatId: number
					messageIds: number[] | 'all'
					loreType: 'world' | 'history' | 'character' | 'scene'
					topic?: string
					/** Character to bind the lore entry to (character lore only) */
					lorebookBindingCharacterId?: number | null
					/** Persona to bind the lore entry to (character lore only) */
					lorebookBindingPersonaId?: number | null
				}
				interface Progress {
					phase: 'drafting' | 'synthesizing'
					batch: number
					totalBatches: number
					partial: {
						content?: string
						raw?: string
					}
				}
				interface Response {
					content: string
					name?: string
					raw: string
					lorebookId: number
					batchCount: number
					/** Resolved lorebook binding ID (character lore only) */
					lorebookBindingId?: number | null
				}
				interface ErrorResponse {
					reason: 'no_lorebook' | 'no_connection' | 'generation_failed'
					error: string
				}
			}
		}

		// Chat Messages namespace
		namespace ChatMessages {
			namespace Get {
				interface Params {
					chatId: number
				}
				interface Response {
					chatMessages: SelectChatMessage[]
				}
			}
			namespace SendPersonaMessage {
				interface Params {
					chatId: number
					content: string
					personaId?: number | null
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace SendCharacterMessage {
				interface Params {
					chatId: number
					characterId?: number
					once?: boolean
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace Update {
				interface Params {
					id: number
					content?: string
					isHidden?: boolean
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					id: number // ID of the deleted message
					success?: string
					error?: string
				}
			}
			namespace DeleteFromId {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace Regenerate {
				interface Params {
					id: number
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace Continue {
				interface Params {
					id: number
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace SwipeLeft {
				interface Params {
					id: number
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace SwipeRight {
				interface Params {
					id: number
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace TogglePin {
				interface Params {
					id: number
				}
				interface Response {
					chatMessage?: SelectChatMessage
					error?: string
				}
			}
			namespace Cancel {
				interface Params {
					chatId: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace Stream {
				interface Params {
					enabled: boolean
					chatId: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
		}

		// Lorebooks namespace
		namespace Lorebooks {
			namespace List {
				interface Params {}
				interface Response {
					lorebookList: Partial<SelectLorebook>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					lorebook: SelectLorebook | null
					worldLoreEntries: SelectWorldLoreEntry[]
					characterLoreEntries: SelectCharacterLoreEntry[]
					historyEntries: SelectHistoryEntry[]
				}
			}
			namespace Create {
				interface Params {
					name: string
				}
				interface Response {
					lorebook: SelectLorebook
				}
			}
			namespace Update {
				interface Params {
					lorebook: UpdateLorebook
				}
				interface Response {
					lorebook: SelectLorebook
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace Export {
				interface Params {
					id: number
				}
				interface Response {
					blob: Buffer
					filename: string
				}
			}
			namespace Import {
				interface Params {
					lorebookData: object
				}
				interface Response {
					lorebook: SelectLorebook
				}
			}
			namespace BindingList {
				interface Params {
					lorebookId: number
				}
				interface Response {
					lorebookId: number
					lorebookBindingList: SelectLorebookBinding[]
				}
			}
			namespace CreateBinding {
				interface Params {
					lorebookBinding: InsertLorebookBinding
				}
				interface Response {
					lorebookBinding: SelectLorebookBinding
				}
			}
			namespace UpdateBinding {
				interface Params {
					lorebookBinding: UpdateLorebookBinding
				}
				interface Response {
					lorebookBinding: SelectLorebookBinding
				}
			}
		}

		// World Lore Entries namespace
		namespace WorldLoreEntries {
			namespace List {
				interface Params {
					lorebookId: number
				}
				interface Response {
					worldLoreEntryList: SelectWorldLoreEntry[]
				}
			}
			namespace Create {
				interface Params {
					worldLoreEntry: InsertWorldLoreEntry
				}
				interface Response {
					worldLoreEntry: SelectWorldLoreEntry
				}
			}
			namespace Update {
				interface Params {
					worldLoreEntry: UpdateWorldLoreEntry
				}
				interface Response {
					worldLoreEntry: SelectWorldLoreEntry
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace UpdatePositions {
				interface Params {
					updates: Array<{ id: number; position: number }>
				}
				interface Response {
					success?: string
					error?: string
				}
			}
		}

		// Character Lore Entries namespace
		namespace CharacterLoreEntries {
			namespace List {
				interface Params {
					lorebookId: number
				}
				interface Response {
					lorebookId: number
					characterLoreEntryList: SelectCharacterLoreEntry[]
				}
			}
			namespace Create {
				interface Params {
					characterLoreEntry: InsertCharacterLoreEntry
				}
				interface Response {
					characterLoreEntry: SelectCharacterLoreEntry
				}
			}
			namespace Update {
				interface Params {
					characterLoreEntry: UpdateCharacterLoreEntry
				}
				interface Response {
					characterLoreEntry: SelectCharacterLoreEntry
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace UpdatePositions {
				interface Params {
					lorebookId: number
					positions: Array<{ id: number; position: number }>
				}
				interface Response {
					success?: string
					error?: string
				}
			}
		}

		// History Entries namespace
		namespace HistoryEntries {
			namespace List {
				interface Params {
					lorebookId: number
				}
				interface Response {
					historyEntryList: SelectHistoryEntry[]
				}
			}
			namespace Create {
				interface Params {
					historyEntry: InsertHistoryEntry
				}
				interface Response {
					historyEntry: SelectHistoryEntry
				}
			}
			namespace Update {
				interface Params {
					historyEntry: UpdateHistoryEntry
				}
				interface Response {
					historyEntry: SelectHistoryEntry
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace IterateNext {
				interface Params {
					id: number
				}
				interface Response {
					historyEntry: SelectHistoryEntry
				}
			}
		}

		// Sampling Configs namespace
		namespace SamplingConfigs {
			namespace List {
				interface Params {}
				interface Response {
					samplingConfigsList: Partial<SelectSamplingConfig>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					sampling: SelectSamplingConfig
				}
			}
			namespace Create {
				interface Params {
					sampling: InsertSamplingConfig
				}
				interface Response {
					sampling: SelectSamplingConfig
				}
			}
			namespace Update {
				interface Params {
					sampling: UpdateSamplingConfig
				}
				interface Response {
					sampling: SelectSamplingConfig
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace SetUserActive {
				interface Params {
					id: number
				}
				interface Response {
					user: SelectUser
				}
			}
			namespace GetSupportedSamplers {
				interface Params {}
				interface Response {
					connectionType: string
					supportedSamplers: string[]
					unsupportedSamplers: Record<string, string>
				}
			}
		}

		// Context Configs namespace
		namespace ContextConfigs {
			namespace List {
				interface Params {}
				interface Response {
					contextConfigsList: Partial<SelectContextConfig>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					contextConfig: SelectContextConfig
				}
			}
			namespace Create {
				interface Params {
					contextConfig: InsertContextConfig
				}
				interface Response {
					contextConfig: SelectContextConfig
				}
			}
			namespace Update {
				interface Params {
					contextConfig: UpdateContextConfig
				}
				interface Response {
					contextConfig: SelectContextConfig
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace SetUserActive {
				interface Params {
					id: number | null
				}
				interface Response {
					user: SelectUser
				}
			}
		}

		// Prompt Configs namespace
		namespace PromptConfigs {
			namespace List {
				interface Params {}
				interface Response {
					promptConfigsList: Partial<SelectPromptConfig>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					promptConfig: SelectPromptConfig
				}
			}
			namespace Create {
				interface Params {
					promptConfig: InsertPromptConfig
				}
				interface Response {
					promptConfig: SelectPromptConfig
				}
			}
			namespace Update {
				interface Params {
					promptConfig: UpdatePromptConfig
				}
				interface Response {
					promptConfig: SelectPromptConfig
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace SetUserActive {
				interface Params {
					id: number | null
				}
				interface Response {
					user: SelectUser
				}
			}
		}

		// Users namespace
		namespace Users {
			namespace Get {
				interface Params {}
				interface Response {
					user: SelectUser
				}
			}
			namespace SetTheme {
				interface Params {
					theme: string
					darkMode: boolean
				}
				interface Response {}
			}
			namespace SetPassphrase {
				interface Params {
					passphrase: string
				}
				interface Response {
					success: boolean
					message?: string
				}
			}
			namespace HasPassphrase {
				interface Params {}
				interface Response {
					hasPassphrase: boolean
				}
			}
			namespace UpdateDisplayName {
				interface Params {
					displayName: string
				}
				interface Response {
					success: boolean
					displayName: string
				}
			}
			namespace ChangePassphrase {
				interface Params {
					currentPassphrase: string
					newPassphrase: string
				}
				interface Response {
					success: boolean
					message?: string
				}
			}
			namespace Logout {
				interface Params {}
				interface Response {
					success: boolean
				}
			}
			namespace List {
				interface Params {
					search?: string
				}
				interface Response {
					users: SelectUser[]
				}
			}
			namespace Create {
				interface Params {
					username: string
					displayName?: string
					isAdmin?: boolean
					passphrase: string
				}
				interface Response {
					user: SelectUser
				}
			}
			namespace Update {
				interface Params {
					id: number
					username?: string
					displayName?: string
					isAdmin?: boolean
					passphrase?: string
				}
				interface Response {
					user: SelectUser
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success: boolean
				}
			}
		}

		// Ollama namespace
		namespace Ollama {
			namespace SetBaseUrl {
				interface Params {
					baseUrl: string
				}
				interface Response {
					success: string
				}
			}
			namespace ModelsList {
				interface Params {}
				interface Response {
					models: any[]
				}
			}
			namespace DeleteModel {
				interface Params {
					modelName: string
				}
				interface Response {
					success: string
				}
			}
			namespace ConnectModel {
				interface Params {
					modelName: string
					connectionId: number
				}
				interface Response {
					success: string
				}
			}
			namespace ListRunningModels {
				interface Params {}
				interface Response {
					runningModels: any[]
				}
			}
			namespace PullModel {
				interface Params {
					modelName: string
					connectionId: number
				}
				interface Response {
					success: string
				}
			}
			namespace Version {
				interface Params {}
				interface Response {
					version: string
				}
			}
			namespace IsUpdateAvailable {
				interface Params {}
				interface Response {
					isUpdateAvailable: boolean
					currentVersion?: string
					latestVersion?: string
				}
			}
			namespace SearchAvailableModels {
				interface Params {
					searchTerm: string
					source: string
				}
				interface Response {
					models: any[]
				}
			}
			namespace ClearDownloadHistory {
				interface Params {}
				interface Response {
					success: string
				}
			}
			namespace CancelPull {
				interface Params {
					modelName: string
				}
				interface Response {
					success: string
				}
			}
			namespace GetDownloadProgress {
				interface Params {}
				interface Response {
					downloadingQuants: any
				}
			}
			namespace PullProgress {
				interface Params {}
				interface Response {
					downloadingQuants: any
				}
			}
			namespace RecommendedModels {
				interface Params {}
				interface Response {
					recommendedModels: any[]
				}
			}
		}

		namespace KoboldCpp {
			namespace SetBaseUrl {
				interface Params {
					baseUrl: string
				}
				interface Response {
					success: string
				}
			}
			namespace Version {
				interface Params {}
				interface Response {
					version: string
				}
			}
			namespace IsUpdateAvailable {
				interface Params {}
				interface Response {
					isUpdateAvailable: boolean
					currentVersion?: string
					latestVersion?: string
					releaseUrl?: string
				}
			}
			namespace ListModels {
				interface Params {}
				interface Response {
					currentModel: string | null
					availableConfigs: string[]
				}
			}
			namespace LoadModel {
				interface Params {
					filename: string
				}
				interface Response {
					success: string
				}
			}
			namespace ConnectModel {
				interface Params {
					modelName: string
				}
				interface Response {
					success: string
				}
			}
		}

		// Chat Lorebooks namespace
		namespace ChatLorebooks {
			namespace Get {
				interface Params {
					chatId: number
				}
				interface Response {
					chatLorebooks: SelectChatLorebook[]
				}
			}
			namespace Add {
				interface Params {
					chatLorebook: InsertChatLorebook
				}
				interface Response {
					chatLorebook: SelectChatLorebook
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
		}

		// Selection Memory namespace
		namespace SelectionMemory {
			namespace Get {
				interface Params {
					id: string
				}
				interface Response {
					selectionMemory: {
						chat: SelectChat | null
						character: SelectCharacter | null
						persona: SelectPersona | null
						prompt: SelectPromptConfig | null
						sampling: SelectSamplingConfig | null
						context: SelectContextConfig | null
						activePromptConfig: SelectPromptConfig | null
						activeSamplingConfig: SelectSamplingConfig | null
						activeContextConfig: SelectContextConfig | null
					}
				}
			}
			namespace Update {
				interface Params {
					selectionMemory: {
						chat: SelectChat | null
						character: SelectCharacter | null
						persona: SelectPersona | null
						prompt: SelectPromptConfig | null
						sampling: SelectSamplingConfig | null
						context: SelectContextConfig | null
						activePromptConfig: SelectPromptConfig | null
						activeSamplingConfig: SelectSamplingConfig | null
						activeContextConfig: SelectContextConfig | null
					}
				}
				interface Response {
					selectionMemory:
						| {
								chat: SelectChat | null
								character: SelectCharacter | null
								persona: SelectPersona | null
								prompt: SelectPromptConfig | null
								sampling: SelectSamplingConfig | null
								context: SelectContextConfig | null
								activePromptConfig: SelectPromptConfig | null
								activeSamplingConfig: SelectSamplingConfig | null
								activeContextConfig: SelectContextConfig | null
						  }
						| undefined
				}
			}
		}

		// Tags namespace
		namespace Tags {
			namespace List {
				interface Params {}
				interface Response {
					tagsList: SelectTag[]
				}
			}
			namespace Create {
				interface Params {
					tag: InsertTag
				}
				interface Response {
					tag: SelectTag
				}
			}
			namespace Update {
				interface Params {
					tag: SelectTag
				}
				interface Response {
					tag: SelectTag
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			namespace GetRelatedData {
				interface Params {
					tagId: number
				}
				interface Response {
					tagData: {
						tag: SelectTag
						characters: any[]
						personas: any[]
						lorebooks: any[]
					}
				}
			}
			namespace AddToCharacter {
				interface Params {
					tagId: number
					characterId: number
				}
				interface Response {
					success: boolean
				}
			}
			namespace RemoveFromCharacter {
				interface Params {
					tagId: number
					characterId: number
				}
				interface Response {
					success: boolean
				}
			}
		}

		// System Settings namespace
		namespace SystemSettings {
			namespace Get {
				interface Params {}
				interface Response {
					systemSettings: {
						ollamaManagerEnabled: boolean
						ollamaManagerBaseUrl: string
						isAccountsEnabled: boolean
						vectorizationEnabled: boolean
						embeddingModelName: string | null
						embeddingModelDimensions: number | null
					}
				}
			}
			namespace UpdateOllamaManagerEnabled {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateOllamaManagerBaseUrl {
				interface Params {
					baseUrl: string
				}
				interface Response {
					success: boolean
					baseUrl: string
				}
			}
			namespace UpdateKoboldCppManagerEnabled {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateKoboldCppManagerBaseUrl {
				interface Params {
					baseUrl: string
				}
				interface Response {
					success: boolean
					baseUrl: string
				}
			}
			namespace UpdateAccountsEnabled {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
		}

		// User Settings namespace
		namespace UserSettings {
			namespace Get {
				interface Params {}
				interface Response {
					userSettings: {
						activeConnectionId?: number | null
						activeSamplingConfigId?: number | null
						activeContextConfigId?: number | null
						activePromptConfigId?: number | null
						theme: string
						darkMode: boolean
						showHomePageBanner: boolean
						enableEasyPersonaCreation: boolean
						enableEasyCharacterCreation: boolean
						showAllCharacterFields: boolean
						backgroundImagePath: string | null
						backgroundOpacity: number
					}
				}
			}
			namespace ListBackgrounds {
				interface Params {}
				interface Response {
					defaults: string[]
					uploads: string[]
				}
			}
			namespace UploadBackground {
				interface Params {
					backgroundFile: Buffer | Uint8Array
					mimeType: string
				}
				interface Response {
					success: boolean
					path: string
				}
			}
			namespace DeleteBackground {
				interface Params {
					path: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace UpdateBackground {
				interface Params {
					path: string | null
					opacity: number
				}
				interface Response {
					success: boolean
					path: string | null
					opacity: number
				}
			}
			namespace UpdateTheme {
				interface Params {
					theme: string
				}
				interface Response {
					success: boolean
					theme: string
				}
			}
			namespace UpdateDarkMode {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateShowHomePageBanner {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateEasyPersonaCreation {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateEasyCharacterCreation {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateShowAllCharacterFields {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
		}

		// Scenes namespace
		namespace Scenes {
			/** Scene with resolved chat name for sidebar display */
			interface SceneWithMeta extends SelectScene {
				chatName: string | null
			}
			namespace List {
				interface Params {
					chatId: number
				}
				/** Scene enriched with its history entry data for chat display */
				interface SceneWithEntry extends SelectScene {
					historyEntry: {
						id: number
						year: number
						month: number | null
						day: number | null
						isCompleted: boolean
						/** The next history entry in date order for this lorebook, if any */
						nextEntry: { id: number; year: number; month: number | null; day: number | null } | null
					} | null
				}
				interface Response {
					sceneList: Sockets.Scenes.List.SceneWithEntry[]
				}
			}
			namespace ListByLorebook {
				interface Params {
					lorebookId: number
				}
				interface Response {
					sceneList: Sockets.Scenes.SceneWithMeta[]
				}
			}
			namespace Create {
				interface Params {
					scene: InsertScene
				}
				interface Response {
					scene: SelectScene
				}
			}
			namespace Update {
				interface Params {
					scene: UpdateScene
				}
				interface Response {
					scene: SelectScene
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			/** Get all message IDs already captured in scenes for a chat */
			namespace SenedMessageIds {
				interface Params {
					chatId: number
				}
				interface Response {
					scenedMessageIds: number[]
				}
			}
			namespace Compile {
				interface Params {
					historyEntryId: number
				}
				interface Progress {
					phase: 'drafting' | 'synthesizing'
					batch: number
					totalBatches: number
					partial: { content?: string; raw?: string }
				}
				interface Response {
					content: string
					historyEntryId: number
				}
				interface ErrorResponse {
					error: string
				}
			}
		}

		// General success/error responses
		namespace Success {
			interface Response {
				title: string
				description?: string
			}
		}

		namespace Error {
			interface Response {
				error: string
				description?: string
			}
		}

		// Legacy namespace for backward compatibility with old chat message events
		namespace ChatMessage {
			interface Call {
				chatMessage?: SelectChatMessage
			}
			interface Response {
				chatMessage: SelectChatMessage
			}
		}

		// Vectorization namespace
		namespace Vectorization {
			/** Embedding model definition sent to the client */
			interface ModelDef {
				id: string
				name: string
				description: string
				dimensions: number
				sizeLabel: string
				tier: "fast" | "balanced" | "best"
			}

			/**
			 * A priority group in the embedding queue. Groups are processed in order;
			 * within each group the order is: messages → lorebook content → characters → personas.
			 */
			interface PriorityGroup {
				groupId: string
				label: string
				ownerDisplayName: string
				chatId?: number
				lorebookIds: number[]
				characterIds: number[]
				personaIds: number[]
			}

			interface CompletedGroup extends PriorityGroup {
				completedAt: string
			}

			namespace ListModels {
				interface Params {}
				interface Response {
					models: ModelDef[]
					activeModelName: string | null
					vectorizationEnabled: boolean
					/** True if the model is loaded in memory and ready to embed */
					modelReady: boolean
					/** True if the model files are present in the local cache */
					modelCached: boolean
					/** Last load error message, if any */
					loadError: string | null
				}
			}

			namespace EnableVectorization {
				interface Params {
					/** Whether to start the queue immediately */
					startNow: boolean
					modelName: string
				}
				interface Response {
					success: boolean
					vectorizationEnabled: boolean
				}
			}

			namespace DisableVectorization {
				interface Params {}
				interface Response {
					success: boolean
				}
			}

			namespace SetModel {
				interface Params {
					modelName: string
				}
				interface Response {
					success: boolean
					modelName: string
					dimensions: number
				}
			}

			namespace StartQueue {
				interface Params {}
				interface Response {
					success: boolean
				}
			}

			namespace StopQueue {
				interface Params {}
				interface Response {
					success: boolean
				}
			}

			/** Server → client: queue progress updates */
			namespace Progress {
				interface Params {}
				interface Response {
					status: "idle" | "running" | "paused"
					currentItem?: {
						type: string
						label: string
					}
					queued: number
					completed: number
					priorityQueue: PriorityGroup[]
					history: CompletedGroup[]
				}
			}

			namespace GetQueue {
				interface Params {}
				interface Response {
					queue: PriorityGroup[]
					history: CompletedGroup[]
				}
			}

			namespace AddToQueue {
				interface Params {
					/** Add a chat and all its linked lorebooks/characters/personas */
					chatId?: number
					/** Add a lorebook by itself */
					lorebookId?: number
					/** Add a character by itself */
					characterId?: number
					characterName?: string
				}
				interface Response {
					success: boolean
					queue: PriorityGroup[]
				}
			}

			namespace MoveQueueGroup {
				interface Params {
					groupId: string
					direction: "up" | "down"
				}
				interface Response {
					success: boolean
					queue: PriorityGroup[]
				}
			}

			namespace RemoveFromQueue {
				interface Params {
					groupId: string
				}
				interface Response {
					success: boolean
					queue: PriorityGroup[]
				}
			}

			/** Server → client: model download progress */
			namespace ModelDownloadProgress {
				interface Params {}
				interface Response {
					modelId: string
					status: "loading" | "downloading" | "ready" | "error"
					percent?: number
					error?: string
				}
			}

			/** Counts for a single content type */
			interface RagTypeCounts {
				total: number
				/** Never embedded */
				nullCount: number
				/** Embedded with a different (stale) model */
				staleCount: number
				/** Correctly embedded with the active model */
				readyCount: number
			}

			/**
			 * Check the RAG embedding status for all content linked to a chat:
			 *  - Messages older than the last 10 (last 10 assumed in context window)
			 *  - Characters linked to the chat
			 *  - Personas linked to the chat
			 *  - Lorebook entries (world lore, character lore, history) for the chat's
			 *    lorebook and each linked character's lorebook
			 */
			namespace CheckRagStatus {
				interface Params {
					chatId: number
				}
				interface Response {
					/** False when vectorization is disabled or chat has ≤ 10 messages */
					applicable: boolean
					messages: RagTypeCounts
					characters: RagTypeCounts
					personas: RagTypeCounts
					/** null when the chat has no associated lorebook */
					lorebook: RagTypeCounts | null
					/** Whether the vectorization queue is currently running */
					queueRunning: boolean
					/** The active embedding model name, or null if none */
					activeModelName: string | null
					/** Whether the user has opted out of RAG for this chat */
					ragIgnored: boolean
				}
			}

			/** Set whether RAG is ignored for a specific chat */
			namespace SetChatRagIgnored {
				interface Params {
					chatId: number
					ignored: boolean
				}
				interface Response {
					success: boolean
					ragIgnored: boolean
				}
			}
		}
	}

	// Assistant namespace
	namespace Assistant {
		// Draft progress event - emitted during character draft generation
		namespace DraftProgress {
			interface Params {}
			interface Response {
				chatId: number
				timestamp: number
				status:
					| "started"
					| "generating_field"
					| "field_complete"
					| "field_error"
					| "validating"
					| "correcting"
					| "complete"
					| "validation_failed"
				message?: string
				field?: string
				fieldStatus?: "generating" | "validating" | "complete" | "error"
				value?: any
				error?: string
				currentField?: number
				totalFields?: number
				attempt?: number
				fields?: string[]
				draft?: any
				errors?: any[]
				generatedFields?: string[]
				correctedFields?: string[]
			}
		}
	}

	// Additional interfaces used by socket types
	export interface CharaImportMetadata {
		data: {
			alternate_greetings?: string[]
			avatar?: string
			character_version?: string
			creator?: string
			creator_notes?: string
			description: string
			extensions: Record<string, any>
			first_mes: string
			mes_example: string
			name: string
			personality: string
			post_history_instructions?: string
			scenario: string
			system_prompt?: string
			tags?: string[]
		}
		spec: string
		spec_version: string
	}

	export interface ConnectionSummary {
		connections: SelectConnection[]
		models: {
			[baseUrl: string]: ListResponse["models"]
		}
	}

	export interface FileCharacter {
		character: SelectCharacter
		avatar?: Buffer
	}

	export interface ConnectionHealthDetails {
		status: "ok" | "unreachable" | "error"
		url: string
		pingTime?: number
		details?: string
	}

	export interface ServerInfoDetails {
		info: any
	}

	export interface SyncDetails {
		syncSource: Partial<SelectUser> | null
		scenario: null | "character" | "chat"
	}

	interface FileAcceptDetails {
		files: File[]
	}

	// Import namespace
	namespace Import {
		namespace SillyTavern {
			namespace Scan {
				interface Params {
					directoryPath: string
				}
				interface Response {
					success: boolean
					data?: {
						characters: Array<{
							filename: string
							name: string
							selected: boolean
						}>
						personas: Array<{
							name: string
							selected: boolean
						}>
						chats: Array<{
							filename: string
							name: string
							characterNames: string[]
							isGroup: boolean
							selected: boolean
							disabled: boolean
							disabledReason?: string
						}>
						groupChats: Array<{
							filename: string
							name: string
							memberNames: string[]
							selected: boolean
							disabled: boolean
							disabledReason?: string
						}>
						lorebooks: Array<{
							filename: string
							name: string
							selected: boolean
						}>
					}
					error?: string
				}
			}
			namespace Execute {
				interface Params {
					directoryPath: string
					selectedData: {
						characters: Array<{
							filename: string
							name: string
							selected: boolean
						}>
						personas: Array<{
							name: string
							selected: boolean
						}>
						chats: Array<{
							filename: string
							name: string
							characterNames: string[]
							isGroup: boolean
							selected: boolean
							disabled: boolean
							disabledReason?: string
						}>
						groupChats: Array<{
							filename: string
							name: string
							memberNames: string[]
							selected: boolean
							disabled: boolean
							disabledReason?: string
						}>
						lorebooks: Array<{
							filename: string
							name: string
							selected: boolean
						}>
					}
				}
				interface Response {
					success: boolean
					message?: string
					error?: string
				}
			}
		}

	}
}

export {}

export {}
