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
					character:
						| (SelectCharacter & { isOwner: boolean; ownerName: string | null })
						| null
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
			namespace ListGallery {
				interface Params {
					characterId: number
				}
				interface Response {
					images: string[]
				}
			}
			namespace UploadGalleryImage {
				interface Params {
					characterId: number
					imageFile: Buffer | Uint8Array
					mimeType: string
				}
				interface Response {
					success: boolean
					path: string
				}
			}
			namespace DeleteGalleryImage {
				interface Params {
					characterId: number
					path: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace SetAvatar {
				interface Params {
					characterId: number
					path: string
				}
				interface Response {
					character: any
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
					id?: number | null
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
					persona:
						| (SelectPersona & { isOwner: boolean; ownerName: string | null })
						| null
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
			namespace ListGallery {
				interface Params {
					personaId: number
				}
				interface Response {
					images: string[]
				}
			}
			namespace UploadGalleryImage {
				interface Params {
					personaId: number
					imageFile: Buffer | Uint8Array
					mimeType: string
				}
				interface Response {
					success: boolean
					path: string
				}
			}
			namespace DeleteGalleryImage {
				interface Params {
					personaId: number
					path: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace SetAvatar {
				interface Params {
					personaId: number
					path: string
				}
				interface Response {
					persona: any
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
					chatList: (Partial<SelectChat> & {
						canEdit: boolean
						isOwner: boolean
						isGuest: boolean
					})[]
				}
			}
			/** Client → server: "my persona is actively typing in this chat" ping */
			namespace Typing {
				interface Params {
					chatId: number
					personaId: number
				}
				interface Response {
					success: boolean
				}
			}
			/** Server → client: broadcast of another participant's typing ping */
			namespace UserTyping {
				interface Params {}
				interface Response {
					chatId: number
					personaId: number
					personaName: string
				}
			}
			namespace Get {
				interface Params {
					id: number
					limit?: number
					/** Cursor: fetch messages with id < beforeId (newest-first page before this id) */
					beforeId?: number
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
					pagination?: { total: number; hasMore: boolean } | null
					/** Echoed from request — present only on load-more responses, not initial load */
					beforeId?: number
					/** The current user's in-progress composer draft, if any */
					userDraft?: string | null
				}
			}
			namespace SaveDraft {
				interface Params {
					chatId: number
					content: string
				}
				interface Response {
					success: boolean
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
					characterIds?: number[]
					personaIds?: number[]
					characterPositions?: Record<number, number>
					tags?: string[]
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
						rag?: (
							{
								used: true
								lore: {
									worldLore: { pinned: number; rag: number }
									characterLore: { pinned: number; rag: number }
									history: { pinned: number; rag: number }
								}
								graphPairs: number
								messages: {
									guaranteed: number
									ragOlder: number
									filledIn: number
									total: number
								}
								scores: {
									messageScores: number[]
									loreScores: number[]
									thresholdUsed: number
									queryMessageCount: number
								}
							} | {
								used: false
								lore: {
									worldLore: { pinned: number; candidates: number; included: number; budget: number; topScore: number }
									characterLore: { pinned: number; candidates: number; included: number; budget: number; topScore: number }
									history: { pinned: number; candidates: number; included: number; budget: number; topScore: number; mostRecentDate: string | undefined }
								}
								messages: {
									guaranteed: number
									candidates: number
									filledIn: number
									budget: number
									total: number
								}
								tokens: { reserve: number; total: number; limit: number; threshold: number }
								entries: Array<{
									type: "worldLore" | "characterLore" | "history" | "message"
									id: number
									name: string
									score: {
										total: number
										keyword: number
										nameMatch: number
										entityCooccurrence: number
										tfidf: number
										sceneAffinity: number
										lastRefRecency: number
										recency: number
										density: number
										includedReason: string
									}
								}>
							}
						)
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
					/** Characters physically present in the scene (scene type only) */
					participantCharacters?: string[]
					/** Characters referenced but not physically present (scene type only) */
					mentionedCharacters?: string[]
				}
				interface ErrorResponse {
					reason: 'no_lorebook' | 'no_connection' | 'generation_failed'
					error: string
				}
				interface TraceEntry {
					label: string
					system: string
					user: string
					response: string
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
					/** The specific message the Stop button was clicked on. Optional
					 * for backwards compatibility — omitting it falls back to
					 * cancelling every generating message in the chat. */
					id?: number
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
			namespace Preview {
				interface Params {
					template: string
				}
				interface Response {
					messages?: { role: string; content: string }[]
					error?: string
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

		// World Summarize Configs namespace
		namespace WorldSummarizeConfigs {
			namespace List {
				interface Params {}
				interface Response {
					worldSummarizeConfigsList: Partial<SelectWorldSummarizeConfig>[]
				}
			}
			namespace Get {
				interface Params { id: number }
				interface Response {
					worldSummarizeConfig: SelectWorldSummarizeConfig
				}
			}
			namespace Create {
				interface Params {
					worldSummarizeConfig: InsertWorldSummarizeConfig
				}
				interface Response {
					worldSummarizeConfig: SelectWorldSummarizeConfig
				}
			}
			namespace Update {
				interface Params {
					worldSummarizeConfig: UpdateWorldSummarizeConfig
				}
				interface Response {
					worldSummarizeConfig: SelectWorldSummarizeConfig
				}
			}
			namespace Delete {
				interface Params { id: number }
				interface Response { success?: string; error?: string }
			}
			namespace SetUserActive {
				interface Params { id: number | null }
				interface Response { user: SelectUser }
			}
		}

		// Character Summarize Configs namespace
		namespace CharacterSummarizeConfigs {
			namespace List {
				interface Params {}
				interface Response {
					characterSummarizeConfigsList: Partial<SelectCharacterSummarizeConfig>[]
				}
			}
			namespace Get {
				interface Params { id: number }
				interface Response {
					characterSummarizeConfig: SelectCharacterSummarizeConfig
				}
			}
			namespace Create {
				interface Params {
					characterSummarizeConfig: InsertCharacterSummarizeConfig
				}
				interface Response {
					characterSummarizeConfig: SelectCharacterSummarizeConfig
				}
			}
			namespace Update {
				interface Params {
					characterSummarizeConfig: UpdateCharacterSummarizeConfig
				}
				interface Response {
					characterSummarizeConfig: SelectCharacterSummarizeConfig
				}
			}
			namespace Delete {
				interface Params { id: number }
				interface Response { success?: string; error?: string }
			}
			namespace SetUserActive {
				interface Params { id: number | null }
				interface Response { user: SelectUser }
			}
		}

		// Scene Summarize Configs namespace
		namespace SceneSummarizeConfigs {
			namespace List {
				interface Params {}
				interface Response {
					sceneSummarizeConfigsList: Partial<SelectSceneSummarizeConfig>[]
				}
			}
			namespace Get {
				interface Params { id: number }
				interface Response {
					sceneSummarizeConfig: SelectSceneSummarizeConfig
				}
			}
			namespace Create {
				interface Params {
					sceneSummarizeConfig: InsertSceneSummarizeConfig
				}
				interface Response {
					sceneSummarizeConfig: SelectSceneSummarizeConfig
				}
			}
			namespace Update {
				interface Params {
					sceneSummarizeConfig: UpdateSceneSummarizeConfig
				}
				interface Response {
					sceneSummarizeConfig: SelectSceneSummarizeConfig
				}
			}
			namespace Delete {
				interface Params { id: number }
				interface Response { success?: string; error?: string }
			}
			namespace SetUserActive {
				interface Params { id: number | null }
				interface Response { user: SelectUser }
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
					success: boolean
				}
			}
			namespace SetModelsDir {
				interface Params {
					dir: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace Version {
				interface Params {}
				interface Capabilities {
					txt2img: boolean
					vision: boolean
					tts: boolean
					transcribe: boolean
					embeddings: boolean
					multiplayer: boolean
					websearch: boolean
					adminEnabled: boolean
				}
				interface Response {
					version: string
					capabilities: Capabilities
					isLocal: boolean
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
				interface ModelFile {
					name: string
					size: number
					modelName?: string
					modelUrl?: string
					description?: string
					quantization?: string
					sizeBytes?: number
				}
				interface Response {
					currentModel: string | null
					availableModels: ModelFile[]
					modelsDirSet: boolean
				}
			}
			namespace DeleteModel {
				interface Params {
					modelName: string
				}
				interface Response {
					success: boolean
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
			namespace Perf {
				interface Params {}
				interface Response {
					lastProcess: number
					lastEval: number
					lastTokenCount: number
					queue: number
					idle: boolean
					uptime: number
					avgGenSpeed: number
					avgPromptSpeed: number
					totalGens: number
				}
			}
			namespace GetLoadedConfig {
				interface Params {}
				interface Response {
					// null if nothing loaded, or this process doesn't know (e.g. right
					// after a restart — koboldcpp doesn't expose these for querying).
					config: {
						model: string
						contextSize: number
						gpuLayers: number
						flashAttention: boolean
						batchSize: number
						rawConfigJson: string
					} | null
				}
			}
			namespace SearchModels {
				interface Params {
					searchTerm: string
				}
				interface PullOption {
					label: string
					filename: string
					downloadUrl: string
					sizeBytes?: number
				}
				interface ModelResult {
					name: string
					description?: string
					downloads?: number
					likes?: number
					trendingScore?: number
					url?: string
					pullOptions: PullOption[]
				}
				interface Response {
					models: ModelResult[]
				}
			}
			namespace DownloadModel {
				interface Params {
					modelName: string
					filename: string
					downloadUrl: string
					modelUrl?: string
					description?: string
					quantization?: string
					sizeBytes?: number
				}
				interface Response {
					success: boolean
				}
			}
			namespace DownloadProgress {
				interface DownloadEntry {
					filename: string
					modelName: string
					status: string
					downloaded: number
					total: number
					isDone: boolean
				}
				interface Response {
					downloads: Record<string, DownloadEntry>
				}
			}
			namespace CancelDownload {
				interface Params {
					filename: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace GetDownloadProgress {
				interface Params {}
				interface Response {
					downloads: DownloadProgress.Response['downloads']
				}
			}
			namespace ClearDownloadHistory {
				interface Params {}
				interface Response {
					success: boolean
				}
			}
			namespace RecommendedModels {
				interface RecommendedModel extends SearchModels.ModelResult {
					ollamaName: string
					recommendedVram?: number
					parameterSize?: string
				}
				interface Params {}
				interface Response {
					models: RecommendedModel[]
				}
			}

			// --- Managed mode ---

			namespace SetManagedMode {
				interface Params {
					mode: "managed" | "external" | null
				}
				interface Response {
					success: boolean
				}
			}
			namespace SetManagedPort {
				interface Params {
					port: number
				}
				interface Response {
					success: boolean
				}
			}
			namespace SetManagedBinaryDir {
				interface Params {
					dir: string
					variant?: string
				}
				interface Response {
					success: boolean
					error?: string
				}
			}
			namespace SetModelTtl {
				interface Params {
					ttlSecs: number
				}
				interface Response {
					success: boolean
				}
			}
			namespace SetSubprocessTimeout {
				interface Params {
					timeoutSecs: number
				}
				interface Response {
					success: boolean
				}
			}
			namespace ListBinaryVariants {
				interface Params {
					tag?: string
				}
				interface BinaryVariant {
					name: string
					displayName: string
					platform: "linux" | "windows" | "macos" | "other"
					description: string
					downloadUrl: string
					sizeBytes: number
				}
				interface Response {
					variants: BinaryVariant[]
					releaseTag: string
					defaultDir: string
				}
			}
			namespace ListReleaseVersions {
				interface Params {}
				interface ReleaseVersion {
					tag: string
					publishedAt: string
					isLatest: boolean
				}
				interface Response {
					versions: ReleaseVersion[]
				}
			}
			namespace DownloadBinary {
				interface Params {
					assetName: string
					downloadUrl: string
					destDir: string
					releaseTag: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace CheckManagedBinaryUpdate {
				interface Params {}
				interface Response {
					isUpdateAvailable: boolean
					installedTag: string | null
					latestTag: string
					releaseUrl: string
				}
			}
			namespace BinaryDownloadProgress {
				interface DownloadState {
					assetName: string
					status: "starting" | "downloading" | "success" | "error" | "cancelled"
					downloaded: number
					total: number
					isDone: boolean
					error?: string
				}
				interface Response {
					download: DownloadState | null
				}
			}
			namespace GetBinaryDownloadProgress {
				interface Params {}
				interface Response {
					download: BinaryDownloadProgress.DownloadState | null
				}
			}
			namespace CancelBinaryDownload {
				interface Params {}
				interface Response {
					success: boolean
				}
			}
			namespace StartSubprocess {
				interface Params {}
				interface Response {
					success: boolean
				}
			}
			namespace StopSubprocess {
				interface Params {}
				interface Response {
					success: boolean
				}
			}
			namespace SubprocessStatus {
				interface Response {
					status: "stopped" | "starting" | "running" | "crashed" | "stopping"
					pid: number | null
					startedAt: string | null
					lastError: string | null
					restartCount: number
				}
			}
			namespace GetSubprocessStatus {
				interface Params {}
				interface Response {
					status: SubprocessStatus.Response
				}
			}
			namespace UnloadModel {
				interface Params {}
				interface Response {
					success: boolean
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
						isAccountsEnabled: boolean
						vectorizationEnabled: boolean
						embeddingModelName: string | null
						embeddingModelDimensions: number | null
						summarizationEnabled: boolean
						contextDebuggingEnabled: boolean
						defaultConnectionId: number | null
						lockConnection: boolean
						defaultSamplingConfigId: number | null
						lockSamplingConfig: boolean
						defaultContextConfigId: number | null
						lockContextConfig: boolean
						defaultPromptConfigId: number | null
						lockPromptConfig: boolean
					}
					ollamaSettings: {
						ollamaManagerEnabled: boolean
						ollamaManagerBaseUrl: string
					}
					koboldCppSettings: {
						koboldCppManagerEnabled: boolean
						koboldCppManagerBaseUrl: string
						koboldCppManagerModelsDir: string | null
						koboldCppManagedMode: string | null
						koboldCppManagedBinaryVariant: string | null
						koboldCppManagedBinaryDir: string | null
						koboldCppManagedPort: number
						koboldCppManagedAdminPassword: string | null
						koboldCppManagedModelTtlSecs: number
					}
					isAndroidWrapper: boolean
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
			namespace UpdateSummarizationEnabled {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
					enabled: boolean
				}
			}
			namespace UpdateContextDebuggingEnabled {
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
					activityId: string
				}
				interface ErrorResponse {
					error: string
				}
			}
			namespace Process {
				interface Params {
					sceneId: number
				}
				interface Progress {
					sceneId: number
					phase: "drafting" | "synthesizing" | "extracting"
					batch: number
					totalBatches: number
					partial?: { content?: string; raw?: string }
				}
				interface Response {
					sceneId: number
					activityId: string
					content: string
					name?: string
					participantCharacters: string[]
					mentionedCharacters: string[]
					raw: string
				}
				interface ErrorResponse {
					sceneId: number
					error: string
				}
				interface TraceEntry {
					sceneId: number
					label: string
					system: string
					user: string
					response: string
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

		// VectorizationConfig namespace
		namespace VectorizationConfig {
			namespace Get {
				interface Params {}
				interface Response {
					config: { embeddingModelTtlMinutes: number }
				}
			}
			namespace Update {
				interface Params {
					embeddingModelTtlMinutes: number
				}
				interface Response {
					success: boolean
				}
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
					/** True if the active backend (local or API) is loaded/validated and ready to embed */
					modelReady: boolean
					/** True if the model files are present in the local cache (local mode only — always false in API mode) */
					modelCached: boolean
					/** Last load error message, if any */
					loadError: string | null
					/** Which embedding backend is configured */
					mode: "local" | "api"
					apiBaseUrl: string | null
					/** Returned as-is for the admin's own settings form to pre-fill, same as connections.apiKey elsewhere in the app */
					apiKey: string | null
					apiModel: string | null
					apiDimensions: number | null
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

			namespace SetApiConfig {
				interface Params {
					baseUrl: string
					apiKey?: string | null
					model: string
					/** Whether to start the queue immediately */
					startNow: boolean
				}
				interface Response {
					success: boolean
					/** Set when success is false — e.g. the test embed call failed. Nothing is persisted in this case. */
					error?: string | null
					/** The composite api::baseUrl::model identifier now active, when success is true */
					modelName?: string
					dimensions?: number
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

			/** Server → client: one specific item finished (re)embedding — lets
			 * list/detail UIs update their "vectorized/stale" badge without
			 * waiting for the next explicit CRUD action or a manual refresh. */
			namespace ItemUpdated {
				interface Params {}
				interface Response {
					type: string
					id: number
					lorebookId?: number
					embeddingModel: string
					vectorizedAt: string
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

		// Narrative Graph namespace
		namespace NarrativeGraph {
			// Inline shape of a persisted narrative node (mirrors schema.narrativeNodes)
			interface NarrativeNode {
				id: number
				lorebookId: number
				sceneId: number | null
				historyEntryId: number | null
				lorebookBindingId: number | null
				parentNodeId: number | null
				name: string
				nodeState: string
				nodeVisibility: string
				aliases: string[]
				summary: string | null
				embedding: number[] | null
				embeddingModel: string | null
				characterIds: number[]
				createdAt: Date | string
				updatedAt: Date | string
			}
			// Inline shape of a persisted narrative relationship (mirrors schema.narrativeRelationships)
			interface NarrativeRelationship {
				id: number
				lorebookId: number
				fromNodeId: number
				toNodeId: number
				historyEntryId: number | null
				sceneId: number | null
				relationshipType: string
				description: string
				visibility: string
				status: string
				reason: string | null
				embedding: number[] | null
				embeddingModel: string | null
				createdAt: Date | string
				updatedAt: Date | string
			}

			// A proposal returned from a graph build — pending user approval
			interface NodeProposal {
				tempId: string
				name: string
				nodeState: string
				summary: string
				/** Which scene index (0-based) in the ordered scene list introduced this node */
				sceneIndex?: number
				/** DB scene id where this node first appeared — stored on commit */
				sceneId?: number
				/** DB history entry id where this node originates (direct entry, no scene) */
				historyEntryId?: number
			}
			interface RelationshipProposal {
				fromTempId: string
				toTempId: string
				relationshipType: string
				description: string
				visibility: string
				status: string
				reason?: string
				/** Which scene index (0-based) established this relationship */
				sceneIndex?: number
				/** DB scene id where this relationship was first established — stored on commit */
				sceneId?: number
				/** DB history entry id where this relationship originates (direct entry, no scene) */
				historyEntryId?: number
			}
			interface GraphProposal {
				nodes: NodeProposal[]
				relationships: RelationshipProposal[]
			}

			namespace List {
				interface Params {
					lorebookId: number
				}
				interface Response {
					nodes: NarrativeNode[]
					relationships: NarrativeRelationship[]
					/** Scenes with a summary not yet processed into the graph (ready to extend) */
					ungraphedSceneCount: number
					/** Scenes without a summary not yet processed (need summarising first) */
					ungraphedUnsummarizedCount: number
					/** All scenes with a summary (used for replace-mode preflight) */
					totalSummarizedCount: number
					/** History entries with content and no scenes, not yet graphed */
					ungraphedHistoryEntryCount: number
					/** All history entries with content and no scenes (for replace-mode preflight) */
					totalDirectHistoryEntryCount: number
				}
			}
			interface TraceEntry {
				label: string
				system: string
				user: string
				response: string
			}
			namespace Build {
				interface Params {
					lorebookId: number
					/** replace: rebuild from scratch; extend: seed LLM with existing graph, only add new entries */
					mode?: "replace" | "extend"
					/** If true, resume from the last saved checkpoint rather than starting over */
					resume?: boolean
				}
				interface Progress {
					phase: "loading" | "extracting_characters" | "generating_descriptions" | "detecting_state_changes" | "extracting_perspectives" | "parsing"
					sceneIndex: number
					totalScenes: number
					nodesFound: number
					relationshipsFound: number
					/** e.g. "Aria → Kael" — shown during perspective extraction */
					currentPair?: string
					/** Human-readable label for the current scene (e.g. "Year 3, Month 5") */
					currentSceneLabel?: string
				}
				interface Response {
					proposal: GraphProposal
					/** Ordered list of scene labels used (for mapping sceneIndex → human-readable) */
					sceneLabels: string[]
					/** Maps seed tempIds (e.g. "existing_5") → real DB node id — only present in extend mode */
					seedTempIdMap: Record<string, number>
				}
				interface ErrorResponse {
					error: string
					raw?: string
				}
			}
			namespace ApplyProposal {
				interface Params {
					lorebookId: number
					proposal: GraphProposal
					/** replace: delete existing graph first; extend: keep existing, resolve seed tempIds */
					mode: "replace" | "extend"
					/** Required when mode is "extend" — maps seed tempIds → real DB node ids */
					seedTempIdMap?: Record<string, number>
				}
				interface Response {
					nodes: NarrativeNode[]
					relationships: NarrativeRelationship[]
				}
			}
			namespace UpdateNode {
				interface Params {
					node: Partial<NarrativeNode> & { id: number }
				}
				interface Response {
					node: NarrativeNode
				}
			}
			namespace DeleteNode {
				interface Params {
					id: number
				}
				interface Response {
					success: string
				}
			}
			namespace UpdateRelationship {
				interface Params {
					relationship: Partial<NarrativeRelationship> & { id: number }
				}
				interface Response {
					relationship: NarrativeRelationship
				}
			}
			namespace DeleteRelationship {
				interface Params {
					id: number
				}
				interface Response {
					success: string
				}
			}
			namespace CreateRelationship {
				interface Params {
					lorebookId: number
					fromNodeId: number
					toNodeId: number
					relationshipType: string
					status: string
					description?: string
					visibility?: string
					historyEntryId?: number
				}
				interface Response {
					relationship: NarrativeRelationship
				}
			}
			namespace CreateNode {
				interface Params {
					lorebookId: number
					name: string
					nodeState: string
					nodeVisibility?: string
					summary?: string
					historyEntryId?: number | null
				}
				interface Response {
					node: NarrativeNode
				}
			}
			/** Three-layer context query for prompt injection */
			namespace QueryContext {
				interface Params {
					lorebookId: number
					chatId: number
					speakerCharacterId?: number
					speakerPersonaId?: number
				}
				interface RelationshipEntry {
					fromNodeId: number
					fromNodeName: string
					fromNodeState: string
					toNodeId: number
					toNodeName: string
					toNodeState: string
					relationshipType: string
					description: string
					visibility: string
				}
				interface LegendaryNodeEntry {
					nodeId: number
					nodeName: string
					summary: string | null
					publicRelationships: RelationshipEntry[]
				}
				interface Response {
					/** Layer 1: speaker's outbound relationships (all visibilities) */
					speakerRelationships: RelationshipEntry[]
					/** Layer 2: inverse rels from chat participants → speaker, acknowledged/public only */
					inverseRelationships: RelationshipEntry[]
					/** Layer 3: legendary/historical nodes + public relationships (RAG-scored) */
					legendaryNodes: LegendaryNodeEntry[]
				}
			}
			/** Link a binding to an existing node or request a new one */
			namespace LinkBindingNode {
				interface Params {
					bindingId: number
					/** null = create a new node automatically */
					nodeId: number | null
				}
				interface Response {
					bindingId: number
					nodeId: number
				}
			}
			/** Link an orphaned lorebook binding to a character/persona, or create/skip */
			namespace LinkOrphanBinding {
				interface Params {
					bindingId: number
					characterId?: number
					personaId?: number
					/** true = user chose to skip, leave binding orphaned */
					skip?: boolean
				}
				interface Response {
					success: boolean
				}
			}
			/** Merge a node as an alias child of a parent node */
			namespace MergeNode {
				interface Params {
					nodeId: number
					parentNodeId: number
				}
				interface Response {
					parentNode: NarrativeNode
					childNode: NarrativeNode
				}
			}
			/** Unlink a child alias node from its parent, restoring it as an independent node */
			namespace DemergeNode {
				interface Params {
					nodeId: number
				}
				interface Response {
					node: NarrativeNode
				}
			}
		}

		namespace BindingCheck {
			/** Emitted after a chat save when orphaned bindings are found in the lorebook */
			namespace Result {
				interface OrphanedBinding {
					id: number
					binding: string
				}
				interface UnboundEntity {
					type: "character" | "persona"
					id: number
					name: string
				}
				interface Response {
					lorebookId: number
					chatId: number
					/** Chars/personas in the chat that have no binding (shown if orphaned bindings exist) */
					unboundEntities: UnboundEntity[]
					/** Existing bindings in the lorebook with no char/persona linked */
					orphanedBindings: OrphanedBinding[]
				}
			}
			/** Emitted when a binding has no graph node and unlinked nodes exist to choose from */
			namespace NodeResult {
				interface UnlinkedNode {
					id: number
					name: string
					nodeState: string
					summary: string | null
					score?: number
				}
				interface PendingBinding {
					bindingId: number
					binding: string
					entityName: string
				}
				interface Response {
					lorebookId: number
					pendingBindings: Array<{
						binding: PendingBinding
						unlinkedNodes: UnlinkedNode[]
					}>
				}
			}
		}

		// Import namespace
		namespace Import {
			namespace SillyTavern {
				namespace StartSession {
					interface Params {}
					interface Response {
						success: boolean
						importSessionId?: string
						error?: string
					}
				}
				namespace StageFiles {
					/**
					 * Files are concatenated into a single blob with a manifest
					 * describing how to slice it back apart — socket.io's binary
					 * parser reliably supports one large binary attachment per
					 * message, but disconnects the transport almost immediately
					 * when a message contains more than ~10-14 separate binary
					 * attachments (verified empirically against socket.io 4.8.x),
					 * regardless of total payload size.
					 */
					interface Params {
						importSessionId: string
						manifest: Array<{ relativePath: string; length: number }>
						blob: Uint8Array
					}
					interface Response {
						success: boolean
						staged?: number
						error?: string
					}
				}
				namespace Scan {
					interface Params {
						importSessionId: string
					}
					interface Response {
						success: boolean
						data?: {
							characters: Array<{
								filename: string
								name: string
								selected: boolean
								disabled?: boolean
							}>
							personas: Array<{
								name: string
								selected: boolean
								disabled?: boolean
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
						importSessionId: string
						selectedData: {
							characters: Array<{
								filename: string
								name: string
								selected: boolean
								disabled?: boolean
							}>
							personas: Array<{
								name: string
								selected: boolean
								disabled?: boolean
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
						errors?: string[]
					}
				}
			}
		}

		namespace Activity {
			interface GraphBuildActivity {
				kind: "graph_build"
				id: string
				userId: number
				// userId is intentionally exposed to clients so they can identify their own activities
				lorebookId: number
				lorebookLabel: string
				mode: "replace" | "extend"
				status: "building" | "review" | "error"
				phase: string
				sceneIndex: number
				totalScenes: number
				nodesFound: number
				relsFound: number
				currentPair?: string
				currentSceneLabel?: string
				proposal?: NarrativeGraph.GraphProposal
				sceneLabels?: string[]
				seedTempIdMap?: Record<string, number>
				errorMessage?: string
				errorRaw?: string
				startedAt: string
			}
			interface SceneSummarizeActivity {
				kind: "scene_summarize"
				id: string
				userId: number
				sceneId: number
				sceneName?: string
				lorebookId: number
				lorebookLabel?: string
				historyEntryId?: number
				status: "running" | "review" | "error"
				phase?: "drafting" | "synthesizing" | "extracting"
				batch?: number
				totalBatches?: number
				errorMessage?: string
				pendingResult?: {
					content: string
					name?: string
					participantCharacters: string[]
					mentionedCharacters: string[]
					raw: string
				}
				startedAt: string
			}
			namespace Update {
				interface Response {
					activities: (GraphBuildActivity | SceneSummarizeActivity)[]
				}
			}
			namespace Dismiss {
				interface Request {
					id: string
				}
			}
			namespace Cancel {
				interface Request {
					id: string
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

		namespace Setup {
			namespace Get {
				interface Params {}
				interface Response {
					setup: {
						summarizationStepComplete: boolean
						ragStepComplete: boolean
					} | null
				}
			}
			namespace MarkComplete {
				interface Params {
					step: "summarization" | "rag"
				}
				interface Response {
					setup: {
						summarizationStepComplete: boolean
						ragStepComplete: boolean
					}
				}
			}
		}

		namespace TaskQueue {
			interface QueuedTask {
				id: string
				taskType: string
				connectionName: string
				samplingName: string
				status: "queued" | "loading" | "generating" | "done" | "error" | "cancelled"
				startedAt: string
				chatId?: number
				lorebookId?: number
				label?: string
			}
			namespace Update {
				interface Response {
					tasks: QueuedTask[]
				}
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

	namespace CustomThemes {
		interface ThemeMeta {
			id: number
			name: string
			label: string
			cssKey: string
			isInstanceTheme: boolean
			uploadedBy?: number | null
			uploaderName?: string | null
			createdAt: string
		}

		namespace List {
			interface Params {}
			interface Response {
				myThemes: ThemeMeta[]
				instanceThemes: ThemeMeta[]
			}
		}

		namespace GetCss {
			interface Params { name: string }
			interface Response { name: string; css: string; cssKey: string }
		}

		namespace Save {
			interface Params {
				id?: number
				name: string
				label: string
				css: string
			}
			interface Response { theme: ThemeMeta }
		}

		namespace Delete {
			interface Params { id: number }
			interface Response { success: boolean }
		}

		namespace SetInstanceTheme {
			interface Params { id: number; enabled: boolean }
			interface Response { success: boolean }
		}
	}

	export interface SyncDetails {
		syncSource: Partial<SelectUser> | null
		scenario: null | "character" | "chat"
	}

	interface FileAcceptDetails {
		files: File[]
	}

}

export {}
