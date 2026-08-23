// Global Socket Types
// This file contains all the type definitions for socket communications
// Moved from app.d.ts to be shared between client and server

import type { ListResponse } from "ollama"
import type { SpecV3 } from "@lenml/char-card-reader"
import type {
	LibraryCatalogItem,
	CardSourceId,
	CardSourceSort
} from "$lib/shared/library/types"

declare global {
	namespace Sockets {
		// Error types
		interface ErrorResponse {
			error: string
			description?: string
		}

		/** Shape of the `*:searchLibrary:error` events (characters and personas both emit this). */
		interface SearchLibraryErrorResponse {
			error: string
			unreachable?: boolean
			rateLimited?: boolean
			retryAfterMs?: number
			requestId?: string
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
					// embedding/embeddingModel/vectorizedAt are deliberately
					// excluded — see the `columns` restriction in
					// charactersGet (characters.ts) — unlike Create/Update
					// below, which return the full row.
					character:
						| (Omit<
								SelectCharacter,
								"embedding" | "embeddingModel" | "vectorizedAt"
						  > & {
								isOwner: boolean
								ownerName: string | null
								tags: string[]
						  })
						| null
				}
			}
			namespace Create {
				interface Params {
					// "characters:create" always derives userId from the
					// authenticated socket (see charactersCreate in
					// characters.ts) — the client never supplies it.
					character: Omit<InsertCharacter, "userId">
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
					status: "created" | "unchanged" | "conflict"
					character: SelectCharacter | null
					book: SpecV3.Lorebook | null
					conflict?: {
						existingCharacter: SelectCharacter
						// The raw base64 file, held so the client can hand it
						// back verbatim in ImportResolve.Params.
						file: string
					}
				}
			}
			namespace ImportResolve {
				interface Params {
					action: "overwrite" | "createNew"
					file: string
					existingId: number
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
					/** Optional — embeds the whole shared lorebook (must be bound to this character) into the export. */
					lorebookId?: number | null
				}
				interface Response {
					blob: Buffer
					filename: string
				}
			}
			namespace SearchLibrary {
				interface Params {
					searchTerm?: string
					source?: CardSourceId
					category?: string
					sort?: CardSourceSort
					/** Only CharaVault honors this (its ?has_book= param) — ignored by other sources. */
					hasBook?: boolean
					/** Only CharaVault honors this (its ?creator= param) — ignored by other sources. */
					creatorFilter?: string
					cursor?: { limit: number; offset: number }
					/**
					 * Client-generated, echoed back verbatim on the response —
					 * lets the client tell which in-flight request a given
					 * response belongs to and discard stale ones, without
					 * blocking new searches from being sent while an older one
					 * is still pending (which previously made a slow CharaVault
					 * response feel like it froze the whole page).
					 */
					requestId?: string
				}
				interface Response {
					characters: LibraryCatalogItem[]
					hasMore: boolean
					/** Raw upstream offset for the next page's cursor — see CardSourceSearchResult.nextOffset. */
					nextOffset?: number
					requestId?: string
				}
			}
			namespace ImportFromLibrary {
				interface Params {
					source: CardSourceId
					ref: unknown
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
					characterId: number
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
					characterId: number
				}
			}
			namespace DeleteGalleryImage {
				interface Params {
					characterId: number
					path: string
				}
				interface Response {
					success: boolean
					characterId: number
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
			namespace ReorderGallery {
				interface Params {
					characterId: number
					/** Full gallery in the desired new order (paths as returned by ListGallery). */
					paths: string[]
				}
				interface Response {
					images: string[]
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
					// Echoes params.connection?.id — undefined for a
					// not-yet-created connection being tested before its
					// first save. Lets a listener discard a broadcast for a
					// different connection than the one it's currently
					// showing (this response is emitToUser, i.e. every open
					// tab, not just the requester).
					connectionId?: number
				}
			}
			namespace RefreshModels {
				interface Params {
					connection: any // Connection data
				}
				interface Response {
					models: any[]
					error: string | null
					connectionId?: number
				}
			}
		}

		// Personas namespace
		namespace Personas {
			namespace List {
				interface Params {}
				interface Response {
					// Matches the `with: { personaTags: { with: { tag: true } } }`
					// query in personasList (personas.ts).
					personaList: (Partial<SelectPersona> & {
						personaTags?: { tag: SelectTag }[]
					})[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					// embedding/embeddingModel/vectorizedAt are deliberately
					// excluded — see the `columns` restriction in
					// personasGet (personas.ts).
					persona:
						| (Omit<
								SelectPersona,
								"embedding" | "embeddingModel" | "vectorizedAt"
						  > & {
								isOwner: boolean
								ownerName: string | null
								tags: string[]
						  })
						| null
				}
			}
			namespace Create {
				interface Params {
					// "personas:create" always derives userId from the
					// authenticated socket (see personasCreate in
					// personas.ts) — the client never supplies it.
					persona: Omit<InsertPersona, "userId">
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
					status: "created" | "unchanged" | "conflict"
					persona: SelectPersona | null
					conflict?: {
						existingPersona: SelectPersona
						file: string
					}
				}
			}
			namespace ImportResolve {
				interface Params {
					action: "overwrite" | "createNew"
					file: string
					existingId: number
				}
				interface Response {
					persona: SelectPersona
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
					source?: CardSourceId
					category?: string
					sort?: CardSourceSort
					cursor?: { limit: number; offset: number }
					/**
					 * Client-generated, echoed back verbatim on the response —
					 * lets the client tell which in-flight request a given
					 * response belongs to and discard stale ones, without
					 * blocking new searches from being sent while an older one
					 * is still pending (which previously made a slow CharaVault
					 * response feel like it froze the whole page).
					 */
					requestId?: string
				}
				interface Response {
					personas: LibraryCatalogItem[]
					hasMore: boolean
					requestId?: string
				}
			}
			namespace ImportFromLibrary {
				interface Params {
					source: CardSourceId
					ref: unknown
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
					personaId: number
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
					personaId: number
				}
			}
			namespace DeleteGalleryImage {
				interface Params {
					personaId: number
					path: string
				}
				interface Response {
					success: boolean
					personaId: number
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
			namespace ReorderGallery {
				interface Params {
					personaId: number
					/** Full gallery in the desired new order (paths as returned by ListGallery). */
					paths: string[]
				}
				interface Response {
					images: string[]
				}
			}
			namespace SetDefault {
				interface Params {
					personaId: number
				}
				interface Response {
					success: boolean
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
					// Matches the `with: { chatCharacters, chatPersonas, chatTags }`
					// query in registerChatsHandlers' "chats:list" handler — the
					// character/persona rows are trimmed to a display-only column
					// subset there (id/name/shortDescription/avatar/visibility),
					// hence Partial<...> rather than the full Select* type.
					chatList: (Partial<SelectChat> & {
						canEdit: boolean
						isOwner: boolean
						isGuest: boolean
						chatCharacters?: (SelectChatCharacter & {
							character: Partial<SelectCharacter>
						})[]
						chatPersonas?: (SelectChatPersona & {
							persona: Partial<SelectPersona>
						})[]
						chatTags?: { tag: SelectTag }[]
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
								// chatGuests table has no `id` column (composite PK of
								// chatId+userId — see schema.ts chatGuests); the "chats:get"
								// handler queries it `with: { user: true }`, so each row is
								// the full join row plus the full joined user.
								chatGuests?: {
									chatId: number
									userId: number
									isPlayer: boolean
									user: SelectUser
								}[]
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
					// "chats:create" always derives userId from the authenticated
					// socket and computes isGroup from characterIds.length itself
					// (see chatsCreateHandler in chats.ts) — the client must not,
					// and structurally can't reliably, supply either.
					chat: Omit<InsertChat, "userId" | "isGroup">
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
					// promptTokenCountHandler returns just `{ error }` (no meta) on
					// every early-exit path (access denied, chat not found, no
					// connection/sampling configured, etc.) and on exception.
					error?: string
					meta?: {
						promptFormat: string
						templateName: string | null
						timestamp: string
						truncationReason: string | null
						// Matches CompiledPrompt.meta.currentTurnCharacterId
						// (promptBuilder/types.ts) — null in narrator/summarizer
						// mode, where there's no single "current turn" character.
						currentTurnCharacterId: number | null
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
						/**
						 * What retrieval did, in the pipeline's own terms.
						 *
						 * Replaces `rag` below rather than extending it. Those
						 * counters described the legacy infill engine's internal
						 * phases — a guaranteed window, a RAG pass, a fill pass —
						 * and the pipeline has none of them: it scores
						 * candidates, allocates a budget, and records per block
						 * why that block is in or out. `rag` stays declared only
						 * until the legacy path is deleted.
						 */
						retrieval?: {
							budget: {
								total: number
								used: number
								remaining: number
							} | null
							blocks: Array<{
								id: number | string
								source: string
								name: string | null
								tokens: number
								included: boolean
								why: string[]
							}>
						}
						rag?:
							| {
									used: true
									lore: {
										worldLore: {
											pinned: number
											rag: number
										}
										characterLore: {
											pinned: number
											rag: number
										}
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
							  }
							| {
									used: false
									lore: {
										worldLore: {
											pinned: number
											candidates: number
											included: number
											budget: number
											topScore: number
										}
										characterLore: {
											pinned: number
											candidates: number
											included: number
											budget: number
											topScore: number
										}
										history: {
											pinned: number
											candidates: number
											included: number
											budget: number
											topScore: number
											mostRecentDate: string | undefined
										}
									}
									messages: {
										guaranteed: number
										candidates: number
										filledIn: number
										budget: number
										total: number
									}
									tokens: {
										reserve: number
										total: number
										limit: number
										threshold: number
									}
									entries: Array<{
										type:
											| "worldLore"
											| "characterLore"
											| "history"
											| "message"
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
					}
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
			namespace TriggerNarratorResponse {
				interface Params {
					chatId: number
					/** Optional extra focus text for this specific generation. */
					instructions?: string
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace GetNarratorName {
				interface Params {
					chatId: number
				}
				interface Response {
					chatId: number
					narratorName: string
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
			/**
			 * Re-points a removed (soft-deleted) chat participant's message
			 * history to a new character/persona, and makes the new one an
			 * active participant. See chatsReassignRemovedParticipantHandler
			 * in chats.ts.
			 */
			namespace ReassignRemovedParticipant {
				interface Params {
					chatId: number
					type: "character" | "persona"
					oldId: number
					newId: number
				}
				interface Response {
					success?: boolean
					chat?: SelectChat
					error?: string
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
					messageIds: number[] | "all"
					loreType: "world" | "history" | "character" | "scene"
					topic?: string
					/** Character to bind the lore entry to (character lore only) */
					lorebookBindingCharacterId?: number | null
					/** Persona to bind the lore entry to (character lore only) */
					lorebookBindingPersonaId?: number | null
				}
				interface Progress {
					phase: "drafting" | "synthesizing" | "naming" | "extracting"
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
					/** Lorebook binding ids physically present in the scene (scene type only) */
					participantCharacters?: number[]
					/** Lorebook binding ids referenced but not physically present (scene type only) */
					mentionedCharacters?: number[]
					/** Extracted names not yet backed by a binding — suggested, physically present (scene type only) */
					suggestedParticipantCharacters?: string[]
					/** Extracted names not yet backed by a binding — suggested, referenced but absent (scene type only) */
					suggestedMentionedCharacters?: string[]
					/** Activity this run was tracked under, so the client can dismiss it once saved. */
					activityId?: string
				}
				interface ErrorResponse {
					reason:
						| "no_lorebook"
						| "no_connection"
						| "generation_failed"
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
					lorebook: (SelectLorebook & { tags: string[] }) | null
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
					// All default to true (matches the original always-include-
					// everything behavior) when omitted — the binding structure
					// itself (bindings[]) always exports regardless of these
					// flags; they only control whether the embedded character/
					// persona card payloads and the narrativeGraph block are
					// included.
					includeCharacters?: boolean
					includePersonas?: boolean
					includeNarrativeGraph?: boolean
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
					// "created": no uuid match, a fresh lorebook was inserted.
					// "unchanged": uuid matched an existing lorebook AND the
					//   content hash matched too — nothing was inserted, the
					//   existing lorebook is returned as-is.
					// "conflict": uuid matched an existing lorebook but the
					//   content differs — nothing was inserted; the client
					//   should prompt via lorebooks:importResolve.
					status: "created" | "unchanged" | "conflict"
					lorebook: SelectLorebook | null
					conflict?: {
						existingLorebook: SelectLorebook
						// The raw parsed import payload, held so the client
						// can hand it back verbatim in ImportResolve.Params
						// without re-uploading/re-parsing the file.
						lorebookData: object
					}
				}
			}
			namespace ImportResolve {
				interface Params {
					action: "overwrite" | "createNew"
					lorebookData: object
					existingId: number
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
					// Matches the `with: { character: true, persona: true }`
					// query in registerLorebookHandlers' "lorebooks:bindingList"
					// handler (lorebooks.ts).
					lorebookBindingList: (SelectLorebookBinding & {
						character?: SelectCharacter | null
						persona?: SelectPersona | null
					})[]
				}
			}
			namespace BindingsForCharacter {
				interface Params {
					characterId: number
				}
				interface Response {
					characterId: number
					// Distinct lorebooks that have a binding referencing this
					// character — the candidate list for charactersExportCard's
					// optional lorebookId, NOT the same as character.lorebookId.
					lorebooks: { id: number; name: string }[]
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
			namespace ResolveOrCreateBindingByName {
				interface Params {
					lorebookId: number
					name: string
					/** Client-generated correlation id, echoed back verbatim in the response */
					requestId: string
				}
				interface Response {
					lorebookBindingId: number
					created: boolean
					requestId: string
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
					lorebookId: number
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

		/**
		 * Pipelines — the configuration/preset layer, one namespace at a time.
		 *
		 * The payload deliberately carries no topology (05 §0a): an option is an
		 * opaque id, a label and a value, never a node key. Structural editing
		 * lives behind a system setting, and a default-view payload that shipped
		 * node keys would make that setting cosmetic.
		 */
		namespace Pipelines {
			interface Option {
				id: string
				label: string
				/**
				 * What *kind* of setting this is — `prompts`, `variables`,
				 * `weights`, `review` — as the descriptor declared it. The
				 * sidebar groups on this rather than on the step, because a
				 * facet is what someone is looking for and a step is where the
				 * machine happens to compute it. Names a kind, never a node.
				 */
				facet: string
				/**
				 * One of the few settings people actually reach for here.
				 *
				 * Declared on the type, so the panel leads with the author's
				 * answer rather than guessing from position or control kind.
				 */
				quick?: boolean
				description?: string
				control: string
				min?: number
				max?: number
				of?: readonly string[]
				/**
				 * For a `share` or `per-member` control: the bands, in render
				 * order, with the label and colour index the declaration gave
				 * them.
				 *
				 * Sent rather than known, for the same reason `choices` is. A
				 * plugin that adds a sixth retrieval source gets a labelled,
				 * coloured band without anyone editing the panel — the moment
				 * this list lived in the client, that would stop being true.
				 */
				members?: readonly {
					key: string
					label?: string
					description?: string
					tone?: number
				}[]
				/**
				 * For a `share` control: the tokens the split divides, when the
				 * window is known.
				 *
				 * A percentage is the setting; the absolute count is the thing
				 * it buys, and showing both is what lets somebody see what 30%
				 * actually means before they commit to it. Read from the
				 * sampling config — never typed, which is the whole reason the
				 * absolute budget parameter is gone.
				 */
				windowTokens?: number
				/**
				 * For a `*-ref` control: what it may be pointed at, already
				 * scoped by the declaration (this namespace's prompts, this
				 * shape's connections). The panel renders the list; it never
				 * decides what belongs in it.
				 */
				choices?: Array<{
					id: number
					label: string
					description?: string
				}>
				/**
				 * For a `prompts-ref` option: the selected prompt row in
				 * full, so the panel can show and edit its text inline.
				 * `readOnly` = a shipped prompt — clone it, never edit it.
				 */
				prompt?: {
					id: number
					name: string
					fields: Record<string, string>
					readOnly: boolean
					/** The field names this node declares — not always all of them. */
					declared: string[]
				}
				/**
				 * For a `variable-template-ref` option: the selected layout
				 * row in full, for the same reason — a name in a dropdown
				 * cannot answer "what does this produce".
				 *
				 * The variable id is deliberately absent: it is shaped like
				 * a node key (`core:var/history@1`) and the payload carries
				 * no topology. Every mutation is addressed by the option
				 * handle instead.
				 */
				variableTemplate?: {
					id: number
					name: string
					source: string
					readOnly: boolean
				}
				/**
				 * For a `context-template-ref` option: the selected story
				 * string, in full. The same ride-along as `prompt` and
				 * `variableTemplate`, and here it matters most — a context
				 * template is the largest authored thing in the product, and a
				 * picker showing "Default" says nothing about what the prompt
				 * will look like.
				 */
				contextTemplate?: {
					id: number
					name: string
					source: string
					readOnly: boolean
					/** usedHere | shipped | alsoFits — which group it sorted into. */
					group?: string
					/** The pipeline it was written in, when that is not this one. */
					origin?: string
				}
				authorDefault?: unknown
				value: unknown
				/**
				 * Where the value won, as the closed set it is.
				 *
				 * Spelled out rather than `string`, because the panel renders a
				 * label per source and a widened type let that stay a hardcoded
				 * map with no way to notice a sixth scope: the badge would fall
				 * back to printing the raw id. The scope chain is core's own and
				 * nothing extends it, so exhaustiveness is checkable — and a new
				 * scope should be a compile error in the panel, not a word
				 * nobody chose appearing in the UI.
				 */
				source: "chat" | "user" | "preset" | "instance" | "author"
				writable: boolean
				/**
				 * Where this option's edits land when it is not the viewer's
				 * default scope — an admin's non-prompt options write at
				 * "instance". Send it back as `scope` on set/clear.
				 */
				writeAt?: string
				overriddenHere: boolean
			}
			/**
			 * One step of the pipeline, in run order. The `key` is an ordinal,
			 * not a node key — grouping by step reveals the count and order
			 * (a deliberate 0.6 trade), never an address. `advanced` is the
			 * tuning parameters, collapsed by default in the panel.
			 */
			interface Step {
				key: string
				label: string
				/**
				 * What the step is — `query`, `task`, `provider`, `consumer`.
				 *
				 * Shown as a badge in the builder, where it is the difference
				 * between a step that reads rows and one that costs a model
				 * request. Names a kind, never a node.
				 */
				kind: string
				options: Option[]
				advanced: Option[]
			}
			/**
			 * A named configuration for this pipeline — the shipped immutable
			 * default plus any copies a person has made. Selecting one is what
			 * the old preset picker did, over the table the runtime actually
			 * resolves against.
			 */
			interface NamedConfig {
				id: number
				name: string
				isDefault: boolean
				readOnly: boolean
			}
			interface Namespace {
				slug: string
				name: string
				version: string
				event: string | null
				enabled: boolean
			}
			interface NamespaceDetail extends Namespace {
				configs: NamedConfig[]
				/** `source` is where the selection came from: chat | user | instance | shipped. */
				selectedConfig: {
					id: number
					name: string
					source: string
				} | null
				steps: Step[]
				/**
				 * The kinds of setting this pipeline contains, in render order,
				 * each with the heading it appears under.
				 *
				 * Sent rather than known. The panel used to hold this list and
				 * match options *into* it, so a facet it had not heard of —
				 * a plugin's own — matched no group and rendered nowhere at
				 * all. Two facets sharing a label are one group, which is how
				 * `connection` and `sampling` become "Model".
				 */
				facets: Array<{
					id: string
					label: string
					order: number
					simple: boolean
				}>
				writeScope: string
			}

			namespace List {
				interface Params {}
				interface Response {
					pipelinesList: Namespace[]
					/**
					 * Whether the legacy Prompt Configs sidebar is offered,
					 * read-only. The one toggle that outlives the changeover.
					 */
					legacyPromptConfigsVisible: boolean
				}
			}
			namespace Get {
				interface Params {
					slug: string
					/** Set when opened from inside a chat — writes land at chat scope. */
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace SetOption {
				interface Params {
					slug: string
					optionId: string
					value: unknown
					chatId?: number
					/** Admins only, and only to say "for everyone on this instance". */
					scope?: "instance"
					/**
					 * Edit this configuration itself rather than override it.
					 *
					 * The builder sends it; the sidebar does not. An override
					 * lands at instance/user/chat scope and *outranks* every
					 * configuration, so without this an edit made while one
					 * configuration was selected followed you to all of them.
					 */
					configId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace ClearOption {
				interface Params {
					slug: string
					optionId: string
					chatId?: number
					scope?: "instance"
					/** Reset this configuration's own value, not an override. */
					configId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * The review gate (01 §7). A run parked at a gated node pushes
			 * `pipelines:reviewRequested` with a form inferred from the
			 * payload the node received — the same schema strategy plugin
			 * settings and extension forms use. The person's decision resumes
			 * the run; `reject` halts it.
			 */
			interface PendingReview {
				id: string
				specId: string
				nodeKey: string
				typeId: string
				/** An SDK `SettingsSchema` — field declarations, one per payload key. */
				schema: Record<string, unknown>
				values: Record<string, unknown>
				requestedAt: number
			}
			namespace Reviews {
				interface Params {}
				interface Response {
					reviews: PendingReview[]
				}
			}
			namespace ResolveReview {
				interface Params {
					id: string
					action: "approve" | "edit" | "reject"
					/** For `edit`: the form values, folded back through the schema. */
					values?: Record<string, unknown>
				}
				interface Response {
					ok?: boolean
					error?: string
				}
			}
			/**
			 * Named-config CRUD from the builder.
			 *
			 * A pipeline is the backbone; a configuration is the thing someone
			 * keeps and tunes. Every one of these answers with the refreshed
			 * view, so the caller never has to reconcile its own copy.
			 */
			namespace CreateConfig {
				interface Params {
					slug: string
					name: string
					/** Copy this configuration's values instead of starting empty. */
					fromConfigId?: number
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					configId?: number
					error?: string
				}
			}
			namespace RenameConfig {
				interface Params {
					slug: string
					configId: number
					name: string
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace DeleteConfig {
				interface Params {
					slug: string
					configId: number
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace SelectConfig {
				interface Params {
					slug: string
					configId: number
					chatId?: number
					scope?: "instance"
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * Prompt CRUD from the panel. A prompt is namespaced to its
			 * pipeline, and every mutation checks that before touching the
			 * row. Clone answers with the new id so the panel can select the
			 * copy in the same gesture.
			 */
			namespace ClonePrompt {
				interface Params {
					slug: string
					promptId: number
					name?: string
					chatId?: number
				}
				interface Response {
					promptId?: number
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace UpdatePrompt {
				interface Params {
					slug: string
					promptId: number
					name?: string
					fields?: Record<string, string>
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace DeletePrompt {
				interface Params {
					slug: string
					promptId: number
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * Layout mutations address the *setting*, not the pipeline.
			 *
			 * `optionId` rather than a slug-plus-node pair because a layout row
			 * is shared across pipelines by design — "does this belong to this
			 * spec" has no true answer for one. The handle proves the caller is
			 * operating a control this pipeline offers them, and the setting's
			 * variable is what the target row has to match.
			 */
			/**
			 * What a draft would render, without saving it.
			 *
			 * A read despite living beside the writes: it renders against the
			 * registry's declared samples and touches no row. Admin-gated all
			 * the same, because it is reached from the library and the sample
			 * data describes the instance's own nodes.
			 */
			namespace PreviewTemplate {
				interface Params {
					/** "context" renders a whole template; "variable" one layout. */
					kind: "context" | "variable"
					source: string
					engine?: string | null
					/** The pool the draft belongs to — a node type or a variable id. */
					poolId: string
				}
				interface Response {
					/** Set for a context template: role-tagged blocks. */
					messages?: Array<{ role: string; content: string }>
					/** Set for a variable layout: the string it produces. */
					rendered?: string
					/** Lint findings, if any — a template can render and still be wrong. */
					issues?: string[]
					error?: string
				}
			}
			namespace CloneVariableTemplate {
				interface Params {
					slug: string
					optionId: string
					templateId: number
					name?: string
					chatId?: number
				}
				interface Response {
					templateId?: number
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace UpdateVariableTemplate {
				interface Params {
					slug: string
					optionId: string
					templateId: number
					name?: string
					source?: string
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace DeleteVariableTemplate {
				interface Params {
					slug: string
					optionId: string
					templateId: number
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * Context templates — the story string, mutated through the setting
			 * that renders it.
			 *
			 * `Create` exists where layouts have only `Clone` because a
			 * template pool can be legitimately empty: core ships one for the
			 * assemble step and nothing for any other node with a template
			 * slot, and a picker with no rows and no way to add one is a dead
			 * end rather than a default.
			 */
			namespace CreateContextTemplate {
				interface Params {
					slug: string
					optionId: string
					name?: string
					source?: string
					chatId?: number
				}
				interface Response {
					templateId?: number
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace CloneContextTemplate {
				interface Params {
					slug: string
					optionId: string
					templateId: number
					name?: string
					chatId?: number
				}
				interface Response {
					templateId?: number
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace UpdateContextTemplate {
				interface Params {
					slug: string
					optionId: string
					templateId: number
					name?: string
					source?: string
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace DeleteContextTemplate {
				interface Params {
					slug: string
					optionId: string
					templateId: number
					chatId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * The admin workspace's read: every authored thing, and what uses it.
			 *
			 * One round trip rather than four, because the page's value is
			 * cross-entity — "this layout is held by the narrator" is the answer
			 * a per-entity fetch cannot give without a second one.
			 */
			namespace Library {
				interface Params {}
				interface LibraryPipeline {
					slug: string
					name: string
					version: string | null
					status: string | null
					nodeCount: number
				}
				interface LibraryPrompt {
					id: number
					specSlug: string
					specName: string
					name: string
					isImmutable: boolean
					fields: Record<string, string>
					/** Pipelines currently pointing at it, by display name. */
					usedBy: string[]
				}
				interface LibraryTemplate {
					id: number
					name: string
					source: string
					engine: string | null
					isImmutable: boolean
					/** The pool: a node type id, or a variable id. */
					poolId: string
					poolLabel: string
					/** The pipeline it was authored in, when it records one. */
					origin?: string
					usedBy: string[]
				}
				interface LibraryPool {
					id: string
					label: string
				}
				interface Response {
					pipelines?: LibraryPipeline[]
					prompts?: LibraryPrompt[]
					contextTemplates?: LibraryTemplate[]
					variableTemplates?: LibraryTemplate[]
					/** Every declared pool, including the empty ones. */
					contextPools?: LibraryPool[]
					variablePools?: LibraryPool[]
					error?: string
				}
			}
			/**
			 * The workspace's writes.
			 *
			 * Gated on **admin**, not on an option handle. The panel's gate asks
			 * "does this pipeline offer you this control", which is the right
			 * question there and has no meaning here — the library is reached
			 * behind the admin check and edits rows directly, including ones no
			 * pipeline has selected. The entity modules still hold every rule
			 * about what may be edited or deleted; only the way in differs.
			 *
			 * Each answers with the whole refreshed view, because a mutation on
			 * this page routinely changes another tab: deleting a template
			 * changes what a pipeline is using.
			 */
			namespace LibraryTemplateWrite {
				/** Which pool a row belongs to. */
				type Kind = "context" | "variable"
				interface CreateParams {
					kind: Kind
					/** Node type id for a context template; variable id for a layout. */
					poolId: string
					name?: string
					source?: string
				}
				interface CloneParams {
					kind: Kind
					id: number
					name?: string
				}
				interface UpdateParams {
					kind: Kind
					id: number
					name?: string
					source?: string
				}
				interface DeleteParams {
					kind: Kind
					id: number
				}
				interface Response {
					library?: Library.Response
					error?: string
				}
			}
			namespace LibraryPromptWrite {
				interface CloneParams {
					id: number
					name?: string
				}
				interface UpdateParams {
					id: number
					name?: string
					fields?: Record<string, string>
				}
				interface DeleteParams {
					id: number
				}
				interface Response {
					library?: Library.Response
					error?: string
				}
			}
			/** The management page: versions, publish state, and the boot diagnostic. */
			namespace Detail {
				interface Params {
					slug: string
				}
				interface Response {
					spec?: {
						slug: string
						name: string
						versions: {
							id: number
							semver: string
							status: string
							canonicalHash: string
							isActive: boolean
							publishedAt: string | null
							nodeCount: number
						}[]
						/**
						 * The active version's shape, for the builder's map.
						 *
						 * This is topology — node keys, wiring, blocks — and it
						 * is deliberately on `pipelines:detail` rather than
						 * `pipelines:get`. The panel view is what the sidebar
						 * reads and 05 §0a forbids it knowing any of this; the
						 * management screen is the structural view and may.
						 * Keeping the two on different events is what makes the
						 * boundary a fact rather than a convention someone has
						 * to remember.
						 */
						graph?: {
							nodes: {
								key: string
								/** The type's display name, humanized. */
								label: string
								/** `input` | `query` | `task` | `provider` | `consumer`. */
								kind: string
								typeId: string
								/** Which block it belongs to, if any. */
								blockId: string | null
								/** `async` | `map` | `loop`. */
								blockKind: string | null
								/** Which chain within the block — parallel arms. */
								blockChain: string | null
								position: number
								toggleable: boolean
								enabledDefault: boolean
								/**
								 * The `ConfigStep` this node is configured by, or
								 * null when it declares nothing.
								 *
								 * The map is keyed by node and the inspector by
								 * step, and steps exist only for nodes with
								 * declarations — so without this the two cannot
								 * be paired without the client re-deriving the
								 * panel's indexing and drifting from it.
								 */
								stepKey: string | null
							}[]
							/**
							 * The declared blocks, which say what a frame *means*.
							 *
							 * `map` needs what it iterates over and how many times
							 * at most; `async` needs whether its chains actually run
							 * concurrently or merely together; `loop` needs its
							 * condition. None of that is derivable from the nodes or
							 * the edges — `over` is a data reference the edge table
							 * never carried — so it is read from `pipeline_blocks`
							 * rather than inferred.
							 */
							blocks: {
								id: string
								kind: string
								/** `parallel` | `sequential`, for async. */
								mode: string | null
								max: number | null
								/** The port this iterates over, e.g. `batches`. */
								over: string | null
								/**
								 * The `ConfigStep` that configures the block itself.
								 *
								 * A block carries a setting of its own — whether its
								 * chains run together — so it is a step like any
								 * node, and the frame has to be selectable or that
								 * step is unreachable.
								 */
								stepKey: string | null
							}[]
							edges: {
								/** The source node, when the source is a node. */
								from: string | null
								/**
								 * The source *block*, when it is not.
								 *
								 * A map block's output feeds the next node as
								 * `drafting --main--> synth`, and its iteration
								 * variable appears as `drafting.$item`. Both have
								 * no `fromNodeId`, so reading only nodes drops
								 * the two edges that make a block legible — the
								 * one going in and the one coming out.
								 */
								fromBlock: string | null
								fromPort: string
								to: string
							}[]
						}
					}
					error?: string
				}
			}
			/** Recent runs, for the simplified inspector (05 §0a, §6). */
			namespace Runs {
				interface Params {
					chatId?: number
					limit?: number
				}
				interface Response {
					runs: {
						id: number
						runId: string
						specSlug: string
						outcome: string
						haltNodeKey: string | null
						haltReason: string | null
						elapsedMs: number
						tokensSpent: number
						isPreview: boolean
						messageId: number | null
						startedAt: string
					}[]
				}
			}
		}

		// Narrator Prompt Configs namespace ("Chat Prompts: Narrator")
		namespace NarratorPromptConfigs {
			namespace List {
				interface Params {}
				interface Response {
					narratorPromptConfigsList: Partial<SelectNarratorPromptConfig>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					narratorPromptConfig: SelectNarratorPromptConfig
				}
			}
			namespace Create {
				interface Params {
					narratorPromptConfig: InsertNarratorPromptConfig
				}
				interface Response {
					narratorPromptConfig: SelectNarratorPromptConfig
				}
			}
			namespace Update {
				interface Params {
					narratorPromptConfig: UpdateNarratorPromptConfig
				}
				interface Response {
					narratorPromptConfig: SelectNarratorPromptConfig
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

		// Graph Build Configs namespace
		//
		// One config row holds a prompt + connection + sampling triple per LLM
		// step of a narrative-graph build. Unlike the narrator/summarize configs
		// the active selection is SYSTEM-wide, not per-user — it lives on
		// systemSettings.defaultGraphBuildConfigId — so this namespace has
		// SetDefault rather than SetUserActive.
		namespace GraphBuildConfigs {
			namespace List {
				interface Params {}
				interface Response {
					graphBuildConfigsList: Partial<SelectGraphBuildConfig>[]
					/** Currently selected system-wide, so the UI can mark it. */
					defaultGraphBuildConfigId?: number | null
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					graphBuildConfig: SelectGraphBuildConfig
				}
			}
			namespace Create {
				interface Params {
					graphBuildConfig: InsertGraphBuildConfig
				}
				interface Response {
					graphBuildConfig: SelectGraphBuildConfig
				}
			}
			namespace Update {
				interface Params {
					graphBuildConfig: UpdateGraphBuildConfig
				}
				interface Response {
					graphBuildConfig: SelectGraphBuildConfig
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
			namespace SetDefault {
				interface Params {
					id: number
				}
				interface Response {
					defaultGraphBuildConfigId: number | null
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
				interface Params {
					id: number
				}
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

		// Character Summarize Configs namespace
		namespace CharacterSummarizeConfigs {
			namespace List {
				interface Params {}
				interface Response {
					characterSummarizeConfigsList: Partial<SelectCharacterSummarizeConfig>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
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

		// Scene Summarize Configs namespace
		namespace SceneSummarizeConfigs {
			namespace List {
				interface Params {}
				interface Response {
					sceneSummarizeConfigsList: Partial<SelectSceneSummarizeConfig>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
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
					// Note: ollamaConnectModelHandler (src/lib/server/sockets/ollama.ts)
					// looks up/creates the connection from modelName alone and never
					// reads a connectionId - no caller has ever supplied one. Previously
					// declared as a required field here, which didn't match reality.
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
					// Note: ollamaPullModelHandler (src/lib/server/sockets/ollama.ts)
					// only reads modelName - no caller has ever supplied connectionId.
					// Previously declared as a required field here, which didn't match
					// reality.
				}
				interface Response {
					success: string
				}
			}
			namespace Version {
				interface Params {
					/** Test this URL instead of the saved ollamaManagerBaseUrl — lets the
					 * setup screen's "Test" button check what's currently typed rather
					 * than whatever was last persisted. */
					baseUrl?: string
				}
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
					// Optional - not sent alongside `models` by the server today, but
					// the client's success-path handler defensively checks for it
					// (errors currently arrive via the separate
					// "ollama:searchAvailableModels:error" event).
					error?: string
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
					// Optional - see SearchAvailableModels.Response.error above for
					// why the success-path handler defensively checks for this.
					error?: string
				}
			}
		}

		namespace KoboldCPP {
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
				interface Params {
					/** Test this URL instead of the saved koboldCppManagerBaseUrl — lets
					 * the setup screen's "Test" button check what's currently typed
					 * rather than whatever was last persisted. */
					baseUrl?: string
				}
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
					downloads: DownloadProgress.Response["downloads"]
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
			namespace SetManagedAdminPassword {
				interface Params {
					/** Empty string clears the stored password. */
					password: string
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
					status:
						| "starting"
						| "downloading"
						| "success"
						| "error"
						| "cancelled"
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
					error?: string
				}
			}
			namespace SubprocessStatus {
				interface Response {
					status:
						| "stopped"
						| "starting"
						| "running"
						| "crashed"
						| "stopping"
					pid: number | null
					startedAt: string | null
					lastError: string | null
					restartCount: number
					// True when this "running" status is an already-active koboldcpp
					// instance found on the configured port that this Manager can't
					// verify it spawned (no matching PID-file record) — Stop/Unload
					// can't act on a process the app doesn't actually control.
					isExternal: boolean
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
					// "tags:create" always derives userId from the
					// authenticated socket (see tagsCreate in tags.ts) —
					// the client never supplies it.
					tag: Omit<InsertTag, "userId">
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
		}

		// Card Sources namespace — the pluggable character/persona browsing
		// backends (GitHub community library, CharaVault, ...).
		namespace CardSources {
			namespace Capabilities {
				interface Params {}
				interface Response {
					unsafeBrowsingEnabled: boolean
					sources: {
						id: CardSourceId
						label: string
						description: string
						url: string
						supportsPersonas: boolean
						supportsCharacters: boolean
					}[]
					charaVaultConnected: boolean
				}
			}
			namespace CharaVaultConnect {
				interface Params {
					email: string
					token: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace CharaVaultDisconnect {
				interface Params {}
				interface Response {
					success: boolean
				}
			}
			namespace CharaVaultStatus {
				interface Params {}
				interface Response {
					connected: boolean
					email: string | null
				}
			}
			namespace CardDetail {
				interface Params {
					source: CardSourceId
					ref: unknown
					/** Client-generated, echoed back verbatim — lets the client discard a response for an item that's no longer the open one (eg. closed and reopened a different card before the first fetch resolved). */
					requestId?: string
				}
				interface Response {
					description?: string
					hasLorebook?: boolean
					requestId?: string
				}
			}
		}

		// System Settings namespace
		namespace SystemSettings {
			namespace Get {
				interface Params {}
				interface Response {
					// Mirrors the columns actually queried in systemSettingsGet
					// (systemSettings.ts) — `id` is always excluded from every
					// row via `columns: { id: false }` etc. The CharaVault
					// credential fields are deliberately never sent to the
					// client either — see cardSources:charaVault:status instead.
					systemSettings: Omit<
						SelectSystemSettings,
						| "id"
						| "charaVaultEmail"
						| "charaVaultEncryptedToken"
						| "charaVaultTokenIv"
						| "charaVaultTokenAuthTag"
					>
					ollamaSettings: Omit<SelectOllamaSettings, "id">
					// koboldCppManagedAdminPassword is deliberately never sent to
					// the client (server-only secret) — see the `columns` filter
					// in systemSettingsGet. koboldCppManagedAdminPasswordSet tells the
					// client whether one is already stored, without ever revealing it,
					// so the UI can show a bullet placeholder vs. an empty field.
					koboldCppSettings: Omit<
						SelectKoboldCppSettings,
						"id" | "koboldCppManagedAdminPassword"
					> & { koboldCppManagedAdminPasswordSet: boolean }
					isAndroidWrapper: boolean
					// Capability, not platform — true unless the current process
					// can't load onnxruntime-node's native binary (Android's Bionic
					// userspace, Intel Macs since onnxruntime-node 1.24.3, or any
					// future platform gap). See embedding/index.ts's
					// getLocalEmbeddingUnsupportedReason().
					localEmbeddingsSupported: boolean
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
						activeNarratorPromptConfigId?: number | null
						activeSummarizeWorldConfigId?: number | null
						activeSummarizeCharacterConfigId?: number | null
						activeSummarizeSceneConfigId?: number | null
						theme: string
						darkMode: boolean
						showHomePageBanner: boolean
						enableEasyPersonaCreation: boolean
						enableEasyCharacterCreation: boolean
						showAllCharacterFields: boolean
						backgroundImagePath: string | null
						backgroundOpacity: number
						charaVaultIncludeNsfw: boolean
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
			namespace UpdateCharaVaultIncludeNsfw {
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
			/**
			 * Scene cast, as every socket payload and the client still speak
			 * it. Storage moved to the `scene_characters` join table, but the
			 * wire shape deliberately did not — server-side
			 * `utils/sceneCast.ts` projects rows to these arrays and back, so
			 * the ~140 consumers of this shape were left alone.
			 *
			 * Values are lorebookBindings ids (NOT character ids — the write
			 * path scoped them as character ids for a while, which silently
			 * erased every unbound/NPC binding on save).
			 */
			interface SceneCast {
				participantCharacters: number[]
				mentionedCharacters: number[]
			}
			/** Scene with resolved chat name for sidebar display */
			interface SceneWithMeta extends SelectScene, SceneCast {
				chatName: string | null
			}
			namespace List {
				interface Params {
					chatId: number
				}
				/** Scene enriched with its history entry data for chat display */
				interface SceneWithEntry extends SelectScene, SceneCast {
					historyEntry: {
						id: number
						year: number
						month: number | null
						day: number | null
						isCompleted: boolean
						/** The next history entry in date order for this lorebook, if any */
						nextEntry: {
							id: number
							year: number
							month: number | null
							day: number | null
						} | null
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
					scene: InsertScene & Partial<SceneCast>
				}
				interface Response {
					scene: SelectScene & SceneCast
				}
			}
			namespace Update {
				interface Params {
					scene: UpdateScene & Partial<SceneCast>
				}
				interface Response {
					scene: SelectScene & SceneCast
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
					phase: "drafting" | "synthesizing"
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
					/**
					 * The scene was created solely to carry this run (the
					 * chat-side summarize flow), so abandoning the run should
					 * delete it. Omitted by the lorebook-side re-process, whose
					 * scene already exists and must survive a cancel.
					 */
					ephemeralOnCancel?: boolean
				}
				interface Progress {
					sceneId: number
					phase: "drafting" | "synthesizing" | "naming" | "extracting"
					batch: number
					totalBatches: number
					partial?: { content?: string; raw?: string }
				}
				interface Response {
					sceneId: number
					activityId: string
					content: string
					name?: string
					participantCharacters: number[]
					mentionedCharacters: number[]
					/** Extracted names not yet backed by a binding — suggested, physically present */
					suggestedParticipantCharacters?: string[]
					/** Extracted names not yet backed by a binding — suggested, referenced but absent */
					suggestedMentionedCharacters?: string[]
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
				id?: number
			}
			interface Response {
				// chatMessageHandler ("chats.ts") omits `chatMessage` and sets
				// `error` instead on the not-found/invalid-params/exception paths
				// (see the "chatMessage:error" emits), so both fields are optional.
				chatMessage?: SelectChatMessage
				error?: string
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
			// Inline shape of a persisted narrative node (mirrors
			// schema.lorebookBindings — merged with the former
			// narrativeNodes table, see the merge plan; "node" naming kept
			// here for minimal API churn even though it's the same row as
			// a lorebook binding now)
			interface NarrativeNode {
				id: number
				lorebookId: number
				characterId: number | null
				personaId: number | null
				binding: string
				sceneId: number | null
				historyEntryId: number | null
				parentNodeId: number | null
				name: string
				nodeState: string
				nodeVisibility: string
				aliases: string[]
				/** Identities absorbed via narrativeGraph:mergeNode — see schema.ts */
				absorbedAliases: string[]
				summary: string | null
				embedding: number[] | null
				embeddingModel: string | null
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
			/**
			 * A proposed change to an EXISTING binding (state and/or summary),
			 * kept in its own channel rather than in `nodes`. `nodes` is
			 * INSERT-only; putting an existing node there would create a
			 * duplicate binding for a character that already has one, on every
			 * apply. Carries the previous values so the review UI can render a
			 * diff rather than an unexplained new value.
			 */
			interface NodeUpdateProposal {
				/** Always "existing_<lorebookBindings.id>" — never an INSERT key. */
				tempId: string
				/** Display only; identity fields stay owned by entity sync. */
				name: string
				nodeState?: string
				previousNodeState?: string
				/** The model's justification for the state change. */
				nodeStateReason?: string
				/**
				 * Fill-blanks-only: proposed solely for nodes that had no
				 * summary, so `previousSummary` is always empty/null. A
				 * non-empty stored summary is either a prior build's output or
				 * a hand edit (summary is user-writable via
				 * lorebooks:updateBinding) and is never overwritten.
				 */
				summary?: string
				previousSummary?: string | null
				sceneIndex?: number
			}
			/**
			 * A scene whose cast the build had to derive (legacy name strings,
			 * or nothing stored). Written back to the scene row at apply, so a
			 * one-time extraction becomes a permanent fast path — and only
			 * then, because a discarded proposal must leave the DB untouched.
			 * TempIds rather than ids: a discovered node has no id until apply
			 * inserts it.
			 */
			interface ResolvedSceneCast {
				sceneId: number | null
				historyEntryId: number | null
				participantTempIds: string[]
				mentionedTempIds: string[]
			}
			interface GraphProposal {
				nodes: NodeProposal[]
				relationships: RelationshipProposal[]
				/** Optional so existing `{ nodes, relationships }` literals stay valid. */
				updatedNodes?: NodeUpdateProposal[]
				resolvedSceneCast?: ResolvedSceneCast[]
			}

			/**
			 * Why a build produced the relationship count it did.
			 *
			 * Deliberately NOT inside GraphProposal: the proposal is what apply
			 * commits, and this describes the run instead. It travels on the
			 * activity, alongside sceneLabels/seedNodeNames.
			 */
			interface RelationshipDiagnostics {
				/** Perspective calls issued — the denominator for the rest. */
				perspectiveCalls: number
				/** Scenes with no second character to relate anyone to. */
				scenesSkippedNoPair: number
				/** Response held no balanced JSON object. */
				noJson: number
				/** A balanced object was found but did not parse. */
				badJson: number
				/** Parsed, but `relationships` was not an array. */
				notArray: number
				/** Entries lacking a relationship type. */
				missingType: number
				/** Entries lacking a target name. */
				missingTarget: number
				/**
				 * Entries whose `from` was not the perspective character —
				 * a third party, or the pair the wrong way round. Both are
				 * discarded rather than repaired.
				 */
				wrongSource: number
				/** Perspective calls re-issued after a non-JSON response. */
				retried: number
				/** Retries that then produced usable JSON. */
				retriedRecovered: number
				/** Target names matching no character in their scene, deduped. */
				unresolvedTargets: string[]
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
					/**
					 * Summarized scenes whose cast has never been resolved
					 * (castResolvedAt IS NULL). Each costs roughly one
					 * extraction call on the next build — used for up-front
					 * cost disclosure, never to refuse a build.
					 *
					 * An over-estimate on purpose: scenes still holding legacy
					 * name strings resolve without an LLM call. Making it exact
					 * would mean scanning the cast columns' shapes again, which
					 * is precisely what castResolvedAt exists to stop. Do not
					 * "refine" it.
					 */
					unresolvedCastSceneCount: number
					/**
					 * Parent bindings with an empty name. They can never match
					 * an extracted name, so a build proposes a fresh node
					 * beside each — surfaced so the user can name or delete
					 * them. See migration 0075's missing backfill.
					 */
					namelessBindingCount: number
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
					phase:
						| "loading"
						| "extracting_characters"
						| "generating_descriptions"
						| "detecting_state_changes"
						| "extracting_perspectives"
						| "parsing"
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
					/**
					 * Which lorebook this failure belongs to. emitToUser is
					 * user-scoped, so without this a build failing in one tab
					 * would un-stick a GraphBuildModal open on a *different*
					 * lorebook in another tab. Listeners must filter on it.
					 */
					lorebookId?: number
				}
			}
			namespace ApplyProposal {
				interface Params {
					lorebookId: number
					proposal: GraphProposal
					/** replace: delete existing graph first; extend: keep existing */
					mode: "replace" | "extend"
					/**
					 * No seedTempIdMap. A build's `existing_<id>` tempIds carry
					 * the row id in the string, so the map the client used to
					 * send was a pure identity map — and the server validated
					 * only its values, never its pairing, so a wrong-but-owned
					 * mapping silently attached relationships to the wrong
					 * character. The server parses and validates the tempIds
					 * itself now; the client cannot influence the mapping.
					 */
				}
				interface Response {
					nodes: NarrativeNode[]
					relationships: NarrativeRelationship[]
				}
				interface ErrorResponse {
					error: string
					/**
					 * emitToUser is user-scoped, so a failure for one lorebook
					 * would otherwise un-stick a modal open on another in a
					 * second tab. Listeners must filter on it.
					 */
					lorebookId?: number
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
			namespace CheckNodeMergeReferences {
				interface Params {
					nodeId: number
				}
				interface Response {
					referencedByMergeLog: boolean
				}
			}
			namespace UpdateRelationship {
				interface Params {
					relationship: Partial<NarrativeRelationship> & {
						id: number
					}
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
			/**
			 * Absorb one binding into another — a real, consolidating merge:
			 * the absorbed row is deleted and every reference to it
			 * (relationships, scene participant/mentioned arrays, character
			 * lore) is rewritten onto the survivor, whose absorbedAliases
			 * gains the absorbed identity's name/aliases. Destructive, but
			 * reversible via UndoMerge (see the audit log this writes).
			 * `nodeId`/`parentNodeId` name the two sides being combined —
			 * which one actually survives is decided server-side (a bound
			 * row always wins via auto-swap), not necessarily `parentNodeId`.
			 */
			namespace MergeNode {
				interface Params {
					nodeId: number
					parentNodeId: number
				}
				interface Response {
					survivorNode: NarrativeNode
				}
			}
			/** Reverses a previous MergeNode (absorb) via its audit log entry */
			namespace UndoMerge {
				interface Params {
					mergeLogId: number
				}
				interface Response {
					restoredNode: NarrativeNode
				}
			}
			/** Recent absorbs for this lorebook, for the Bindings tab's undo list */
			namespace ListMergeLogs {
				interface Params {
					lorebookId: number
				}
				interface MergeLogEntry {
					id: number
					survivorId: number | null
					survivorName: string | null
					absorbedName: string
					createdAt: Date | string
				}
				interface Response {
					lorebookId: number
					mergeLogs: MergeLogEntry[]
				}
			}
			/** Likely-duplicate binding pairs for a lorebook's proactive review affordance */
			namespace DuplicateCandidates {
				interface Params {
					lorebookId: number
				}
				interface Candidate {
					bindingIdA: number
					bindingIdB: number
					nameA: string
					nameB: string
				}
				interface Response {
					lorebookId: number
					candidates: Candidate[]
				}
			}
			/** Marks a binding pair as reviewed-and-not-a-duplicate — never re-flagged */
			namespace DismissDuplicate {
				interface Params {
					lorebookId: number
					bindingIdA: number
					bindingIdB: number
				}
				interface Response {
					lorebookId: number
					candidates: DuplicateCandidates.Candidate[]
				}
			}
			/**
			 * Scenes whose participantCharacters/mentionedCharacters still hold
			 * pre-lorebookBindings-merge name strings instead of binding ids — see
			 * graphBuilder.ts's header comment. Scoped identically to List's
			 * totalSummarizedCount (lorebookId + non-null summary).
			 */
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
						manifest: Array<{
							relativePath: string
							length: number
						}>
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
						// Individual chat logs (chats/<CharacterName>/<file>.jsonl) are
						// deliberately never staged at scan time -- only their content
						// (potentially large) gets uploaded later for whatever the user
						// actually selects. Their relative paths are sent here instead,
						// purely so the scan can list what's available without needing
						// the files themselves on disk yet.
						deferredChatPaths?: string[]
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
				interface Params {
					name: string
				}
				interface Response {
					name: string
					css: string
					cssKey: string
				}
			}

			namespace Save {
				interface Params {
					id?: number
					name: string
					label: string
					css: string
				}
				interface Response {
					theme: ThemeMeta
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

			namespace SetInstanceTheme {
				interface Params {
					id: number
					enabled: boolean
				}
				interface Response {
					success: boolean
				}
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
}

export {}
