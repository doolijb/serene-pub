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
import type { ComboRow } from "$lib/shared/capabilities/combos"
import type {
	EntryTypeId,
	LorebookEntry,
	LorebookEntryPatch,
	NewLorebookEntry
} from "$lib/shared/entries/types"
import type { MediaFrame } from "$lib/shared/media/frame"
import type { ModelFacts } from "$lib/shared/connections/modelFacts"
import type { SpriteSetView } from "$lib/shared/sprites"

declare global {
	namespace Sockets {
		// Error types
		interface ErrorResponse {
			error: string
			description?: string
		}

		/**
		 * The revision-bearing address of an entity's avatar, joined alongside
		 * `avatarMediaId` by every payload builder that ships one.
		 *
		 * A character or persona row holds an id and nothing else, and
		 * `/media/{id}?v=thumb` is ONE URL string for every revision of that
		 * file — so a browser that cached those pixels keeps serving them when
		 * the row changes in place (a re-cut thumbnail, a moved display
		 * pointer). `/media/{uuid}?v=thumb&r={rev}` changes when the bytes do,
		 * which is what dislodges them.
		 *
		 * Null when the entity wears no avatar; absent when the builder did not
		 * join, which the client reads as "fall back to the by-id redirect".
		 */
		interface AvatarMedia {
			uuid: string
			rev: number
			/** The stored crop, so "adjust crop" opens on what is stored rather
			 *  than on the default rule. Null when nothing was cropped. */
			frame?: MediaFrame | null
		}

		/** A character or persona on the wire, with its avatar's real address
		 *  joined on. Additive: every consumer of the bare row still type-checks. */
		type WithAvatarMedia<T> = T & { avatarMedia?: AvatarMedia | null }

		/** Shape of the `*:searchLibrary:error` events (characters and personas both emit this). */
		interface SearchLibraryErrorResponse {
			error: string
			unreachable?: boolean
			rateLimited?: boolean
			retryAfterMs?: number
			requestId?: string
		}

		/**
		 * One row of `connection_defaults`, on the wire.
		 *
		 * Named once here rather than spelled inline at each of the three places
		 * that send it — `systemSettings:get`, `connectionDefaults:list`, and
		 * `SystemSettingsCtx`. It was inline in all three, which is how one of
		 * them ends up nullable and the other two not.
		 *
		 * Both halves are independently nullable and that asymmetry is the
		 * contract: a null `connectionId` is fatal to a run, a null
		 * `samplingConfigId` is not — `resolveSampling(null)` means "send
		 * nothing and let the backend use its own defaults", which is a
		 * perfectly good answer.
		 */
		interface CapabilityDefault {
			connectionId: number | null
			/**
			 * WHICH MODEL on that endpoint (0114).
			 *
			 * NULL beside a stated `connectionId` means the registration is
			 * INCOMPLETE, and it resolves as unconfigured — a connection has no
			 * default model to fall back to, so "the endpoint, whichever model"
			 * names nothing a run can dispatch to. Every registration the
			 * backfill left behind, and every one the `ON DELETE SET NULL` on
			 * `connection_models` releases, reads this way. See
			 * `docs/connections.md`, "Choosing a pair".
			 *
			 * ⚠ Half of a PAIR. It travels with `connectionId` and is cleared
			 * whenever that changes — a `connection_models` row belongs to one
			 * endpoint, so a model surviving an endpoint change would name a
			 * model of some other connection.
			 */
			connectionModelId: number | null
			samplingConfigId: number | null
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
					/**
					 * `isPersona` / `isDefaultPersona` / `folderId` ride the
					 * row: the persona picker and the folder-grouped library
					 * are both reads of THIS list, not of a second family.
					 */
					characterList: WithAvatarMedia<Partial<SelectCharacter>>[]
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
						| (WithAvatarMedia<
								Omit<
									SelectCharacter,
									| "embedding"
									| "embeddingModel"
									| "vectorizedAt"
								>
						  > & {
								isOwner: boolean
								ownerName: string | null
								tags: string[]
						  })
						| null
					/**
					 * The requested character id — present on a not-found reply so
					 * the interest scope can still be derived.
					 *
					 * A reply with `character: null` has no `character.id` for
					 * `SCOPED_EVENTS` to read, so without this the payload would
					 * carry no scope and only a bare `characters:get` key — one that
					 * matches every other character's reply as well — could receive
					 * it. Absent on a successful reply, where the id is on the
					 * character. Same treatment as `Sessions.Get.Response`.
					 */
					characterId?: number
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
					character: WithAvatarMedia<SelectCharacter>
				}
			}
			namespace Update {
				interface Params {
					character: UpdateCharacter
					avatarFile?: Buffer | null
				}
				interface Response {
					character: WithAvatarMedia<SelectCharacter>
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
					/**
					 * Non-fatal problems during an otherwise successful
					 * import — e.g. the card's image exceeded the size limit
					 * and was skipped. The character IS imported; these are
					 * shown as a warning rather than an error, because
					 * reporting them as a failure for a character that
					 * actually exists is what made this flow confusing.
					 */
					warnings?: string[]
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
					/** See ImportCard.Response.warnings. */
					warnings?: string[]
				}
			}
			namespace ExportCard {
				interface Params {
					id: number
					/** `charx` is the one format that carries sprites (DESIGN-sprites §4). */
					format?: "json" | "png" | "charx"
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
					/**
					 * Which of the source's CATALOGUES to browse — the word
					 * describes the remote library, not our table. A card
					 * source still publishes characters and personas
					 * separately (`supportsPersonas`), and a persona-catalogue
					 * card lands here flagged `isPersona`. Defaults to
					 * `"characters"`.
					 */
					catalog?: "characters" | "personas"
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
					/** See SearchLibrary.Params.catalog. */
					catalog?: "characters" | "personas"
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
					images: Media[]
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
					media: Media
					characterId: number
				}
			}
			namespace DeleteGalleryImage {
				interface Params {
					characterId: number
					mediaId: number
				}
				interface Response {
					success: boolean
					characterId: number
				}
			}
			namespace SetAvatar {
				interface Params {
					characterId: number
					mediaId: number
				}
				interface Response {
					character: any
				}
			}
			namespace ReorderGallery {
				interface Params {
					characterId: number
					/** Full gallery in the desired new order (ids as returned by ListGallery). */
					mediaIds: number[]
				}
				interface Response {
					images: Media[]
				}
			}
			/*
			 * Sprites (DESIGN-sprites §7). Every reply and cascade carries
			 * `characterId` top-level — errors included — because the family is
			 * SCOPED on it (`SCOPED_EVENTS`). Every mutation answers with the
			 * character's whole sprite list, so one handler shape serves them all.
			 */
			namespace ListSprites {
				interface Params {
					characterId: number
				}
				interface Response {
					characterId: number
					/** Default set first. */
					sets: SpriteSetView[]
				}
			}
			namespace CreateSpriteSet {
				interface Params {
					characterId: number
					name: string
				}
				type Response = ListSprites.Response
			}
			namespace UpdateSpriteSet {
				interface Params {
					characterId: number
					setId: number
					/** A new name. ⚠ Strands cast amendments naming the old one. */
					name?: string
					/** Make this the character's default set. */
					makeDefault?: boolean
				}
				type Response = ListSprites.Response
			}
			namespace DeleteSpriteSet {
				interface Params {
					characterId: number
					setId: number
				}
				type Response = ListSprites.Response
			}
			namespace UploadSprite {
				interface Params {
					characterId: number
					/** Omitted = the default set (created when missing). */
					setId?: number
					label: string
					imageFile: Buffer | Uint8Array
					filename?: string
				}
				type Response = ListSprites.Response
			}
			namespace AddStandardSprites {
				interface Params {
					characterId: number
					setId?: number
				}
				type Response = ListSprites.Response & { added: number }
			}
			namespace UpdateSprite {
				interface Params {
					characterId: number
					spriteId: number
					/** Move to another sprite label. */
					label?: string
					/** Move to another set of the same character. */
					setId?: number
				}
				type Response = ListSprites.Response
			}
			namespace DeleteSprite {
				interface Params {
					characterId: number
					spriteId: number
				}
				type Response = ListSprites.Response
			}
			/**
			 * The Sprites tab's test box: which sprite the default picker would
			 * choose for a line, in one set, with its score and runner-up.
			 * `reason` says why there is no pick (no embedding model, no sprites).
			 */
			namespace TestSprite {
				interface Params {
					characterId: number
					setId?: number
					text: string
				}
				interface Response {
					characterId: number
					text: string
					pick: {
						set: string
						label: string
						score: number
						runnerUp?: { label: string; score: number }
					} | null
					reason?: string
				}
			}
			namespace ReorderSprites {
				interface Params {
					characterId: number
					setId: number
					label: string
					/** That label's variants in the new order. */
					spriteIds: number[]
				}
				type Response = ListSprites.Response
			}
			/**
			 * Make this the persona a new session starts with.
			 *
			 * One transaction: the caller's previous default is cleared and
			 * this one set, so `characters_default_persona_unique` never sees
			 * two. Sets `isPersona` too — a default you cannot play is not a
			 * state worth having.
			 */
			namespace SetDefaultPersona {
				interface Params {
					characterId: number
				}
				interface Response {
					success: boolean
				}
			}
			/** File a character under a folder, or `null` for the top level. */
			namespace SetFolder {
				interface Params {
					characterId: number
					folderId: number | null
				}
				interface Response {
					success?: boolean
					error?: string
					characterId?: number
				}
			}
		}

		/**
		 * A file as a client is allowed to see it (28 §7, resplit by 0182).
		 *
		 * Note what is NOT here: `path`. `toClientMedia` is the only thing that
		 * builds one, its return type has no path field, and since 0182 a path
		 * only exists on a `variants` row that no payload builder ever loads —
		 * so leaking the on-disk location stays a type error rather than a
		 * review catch.
		 *
		 * `mime`/`bytes` describe the DISPLAY variant. They come off the file
		 * row (denormalised there on purpose) so that building this needs one
		 * query and no variant lookup.
		 */
		interface Media {
			/** `files.id`. What `avatarMediaId` and friends point at. */
			id: number
			/** The public address, shared by every variant of this file. */
			uuid: string
			/** Cache token. Every URL below carries it; it changes when the
			 *  bytes behind that URL do, which is what lets the response be
			 *  immutable for a year. */
			rev: number
			kind: string
			/** The display variant's mime. */
			mime: string
			/** The display variant's byte length. */
			bytes: number
			width: number | null
			height: number | null
			/** Milliseconds, when the source has a time dimension. */
			durationMs: number | null
			/** The region a thumbnail is cut from, in source pixels of the
			 *  original. Null means the default rule applies — see
			 *  `$lib/shared/media/frame`. */
			frame: MediaFrame | null
			filename: string | null
			visibility: string
			position: number
			/** `/media/{uuid}?r={rev}` — the display form. ALREADY HAS A QUERY
			 *  STRING: anything appending to it must use `&`. */
			url: string
			/** `/media/{uuid}?v=thumb&r={rev}`. Derived on first request, so the
			 *  first fetch of a fresh upload pays for the encode. */
			thumbUrl: string
			/** `/media/{uuid}?v=original&r={rev}`. The bytes as uploaded — for a
			 *  download or a card export, never for routine rendering. */
			originalUrl: string
			characterId: number | null
			sessionId: number | null
			messageId: number | null
		}

		/** One stored representation, for the management panel only. */
		interface MediaVariantRow {
			variant: string
			mime: string
			bytes: number
			isOriginal: boolean
			cache: boolean
			fidelity: string
			/** True when `files.display_variant_id` names this row — i.e. this
			 *  is what a bare `/media/{uuid}` serves. */
			isDisplay: boolean
		}

		/** A file plus the extras the management panel needs. */
		interface ManagedMedia extends Media {
			createdAt: string
			/** Bytes on disk across EVERY representation. `bytes` above is only
			 *  what showing this file costs; this is what storing it costs, and
			 *  they are different questions once one file has three rows. */
			storedBytes: number
			/** What is held right now. A freshly uploaded file that has never
			 *  been viewed has exactly one entry — that is healthy, not a
			 *  missing thumbnail. */
			variants: MediaVariantRow[]
			/** What the file is grouped under. `name` is null when the parent
			 *  no longer exists — which is exactly how an orphan becomes
			 *  visible, since 28 keeps the id rather than nulling it. */
			attachedTo: {
				type: "character" | "session"
				id: number
				name: string | null
			} | null
			/**
			 * The parent id is stale: this file names a character or a
			 * session that has been deleted, so nothing can reach it any more.
			 *
			 * Server-computed, because "no name came back" and "there is no
			 * parent to name" are different states and only the server can tell
			 * them apart. A file with `attachedTo: null` is a user-level upload
			 * with no parent BY DESIGN — not an orphan, and never reclaimable
			 * on that basis.
			 */
			orphaned: boolean
			/**
			 * How many DISTINCT messages render this file — a `core:image` /
			 * `core:file` part, or an `image` block inside a block tree.
			 *
			 * Deleting a file does NOT remove these parts (28 §2 tolerates the
			 * dangling reference on purpose), so this is the count of chat
			 * transcripts that would show a broken image afterwards. Non-zero
			 * makes `media:delete` require `confirmMessageRefs`.
			 */
			messageRefs: number
		}

		namespace Media {
			namespace List {
				interface Params {
					sort?: "newest" | "oldest" | "largest" | "smallest" | "name"
					kind?: string
				}
				interface Response {
					media: ManagedMedia[]
					totalBytes: number
				}
			}
			namespace RegenerateThumbnail {
				interface Params {
					mediaId: number
				}
				interface Response {
					mediaId: number
					regenerated: boolean
				}
			}
			namespace SetVisibility {
				interface Params {
					mediaId: number
					visibility: string
				}
				interface Response {
					mediaId: number
					visibility: string
				}
			}
			/**
			 * Re-cut what a thumbnail shows, without touching the bytes.
			 *
			 * `frame` is in source pixels of the ORIGINAL, and NULL clears it so
			 * the default rule applies again — it is never the rule's current
			 * output written down. The existing thumbnail is removed and `rev`
			 * bumped, so every open view re-addresses the new crop.
			 */
			namespace SetFrame {
				interface Params {
					mediaId: number
					frame: MediaFrame | null
				}
				interface Response {
					media: Media
				}
			}
			namespace Delete {
				interface Params {
					mediaId: number
					/**
					 * Acknowledges that messages render this file and will show
					 * a broken image once it is gone.
					 *
					 * The handler REFUSES a referenced file without it, and
					 * re-counts rather than trusting a number from the client —
					 * a panel left open while a session generated another image
					 * is holding a stale count, and the point of the gate is
					 * that nobody deletes chat history's images unaware.
					 */
					confirmMessageRefs?: boolean
				}
				interface Response {
					mediaId: number
					/** Messages left showing a broken image by this delete —
					 *  what the caller confirmed, echoed back. */
					messageRefs: number
				}
			}
			/** What the cleanup actions would do, priced before anyone commits. */
			namespace CleanupPreview {
				interface Params {}
				interface Response {
					/** Freely re-derivable rows (`cache: true`). The safe
					 *  action. */
					derived: { files: number; variants: number; bytes: number }
					/**
					 * Originals that can be culled because a full-fidelity
					 * representation already exists that is NOT LARGER.
					 *
					 * A JPEG photograph never qualifies, and that is correct:
					 * its lossless WebP would be bigger, so culling would free
					 * the small file and keep the big one — the opposite of what
					 * an admin means by "reclaim space".
					 */
					originals: { files: number; bytes: number }
					/** Counted, not culled, with the reason — so "why did it
					 *  skip 400 of my photos" is answerable. */
					skipped: { files: number; reason: string }[]
					derivedCacheEnabled: boolean
				}
			}
			namespace CullDerived {
				interface Params {}
				interface Response {
					variants: number
					bytes: number
				}
			}
			namespace CullOriginals {
				/** `confirm` must be the exact string the UI showed. Typing it
				 *  is the gate; this is irreversible. */
				interface Params {
					confirm: string
				}
				interface Response {
					files: number
					freedBytes: number
					/** Bytes written to derive a display form first, where one
					 *  did not exist. Reported because "reclaimed 4GB" is a lie
					 *  if 1GB went straight back. */
					addedBytes: number
					skipped: { files: number; reason: string }[]
				}
			}
			namespace SetCachePolicy {
				interface Params {
					derivedCacheEnabled: boolean
				}
				interface Response {
					derivedCacheEnabled: boolean
				}
			}
			/**
			 * A file's bytes changed while its id stayed put — a re-cut
			 * thumbnail, or a display pointer moved by a cull.
			 *
			 * Server-initiated, so `Params` is empty: nothing asks for this. It
			 * exists because a bump writes NOTHING to the character or persona
			 * wearing the file, so no `characters:update` would fire and every
			 * open view would keep its stale `<img src>` until a reload.
			 * Carrying the uuid as well as the token lets a view that never
			 * joined the media row build the bustable URL from this alone.
			 */
			namespace Changed {
				interface Params {}
				interface Response {
					id: number
					uuid: string
					rev: number
					/** The crop as it now stands. Re-framing is one of the
					 *  reasons the bytes changed, so a view holding an old frame
					 *  learns the new one from the same announcement. */
					frame: MediaFrame | null
				}
			}
		}

		// Connections namespace
		namespace Plugins {
			/** A row of the installed-plugins list, as the admin panel renders it. */
			interface PluginRow {
				pluginId: string
				name: string
				version: string
				bundleHash: string
				backends: ("quickjs" | "ses")[]
				backend: "quickjs" | "ses"
				sequential: boolean
				enabled: boolean
				/** Whether the manifest declares a settings schema (12 §6). */
				hasSettings: boolean
				/**
				 * A declared permission no admin has decided about yet. Until
				 * one does it is refused, so this is both "waiting for you" and
				 * the explanation for a plugin that runs but reaches nothing.
				 */
				needsReview?: boolean
				/**
				 * Whether the runtime holds a loaded copy right now (warm) —
				 * runtime truth from the live manager, never stored. Absent or
				 * false when the runtime gate is off: nothing is ever loaded.
				 */
				warm?: boolean
				/**
				 * Its swap contributions (R66), read-only here: the switches
				 * live on the genre hub `genreId` names.
				 */
				swaps?: { total: number; off: number; genreId: string | null }
			}
			/**
			 * A plugin's settings surface (12 §6): the manifest's schema, the
			 * stored values with every secret reduced to `{$secretSet}` —
			 * plaintext never reaches a client — and whether the plugin is
			 * ready or waiting on configuration.
			 */
			interface SettingsView {
				/** The manifest-declared `SettingsSchema`, verbatim. */
				schema: Record<string, any>
				values: Record<string, unknown>
				state:
					| { state: "ready" }
					| {
							state: "needs-configuration"
							missing: string[]
							message: string
					  }
				/** Stored fields the current schema no longer declares. */
				orphaned: string[]
			}
			namespace GetSettings {
				interface Params {
					pluginId: string
				}
				interface Response {
					pluginId: string
					/** Null: not installed, or declares no settings. */
					settings: SettingsView | null
					error?: string
				}
			}
			/**
			 * Drop a plugin's loaded copy — and a SES plugin's dedicated
			 * worker — while keeping it installed and enabled; the next hook
			 * call faults it back in cold. The manager defers the release
			 * while calls are in flight. Distinct from disable (hooks stop
			 * firing) and uninstall (the plugin is forgotten).
			 */
			namespace Unload {
				interface Params {
					pluginId: string
				}
				interface Response {
					plugins: PluginRow[]
					error?: string
				}
			}
			namespace SetSettings {
				interface Params {
					pluginId: string
					/**
					 * Declared fields only. A secret is written as plaintext
					 * (encrypted at the server's one write path), cleared
					 * with null/"", and left unchanged by omission.
					 */
					values: Record<string, unknown>
				}
				interface Response {
					pluginId: string
					settings?: SettingsView | null
					error?: string
				}
			}
			/** One in-flight sandbox call, for the live sandbox monitor. */
			interface ActiveRow {
				callId: number
				pluginId: string
				pluginName: string
				hookName: string
				backend: "quickjs" | "ses"
				user?: string
				lifecycle: boolean
				startedAt: number
			}
			/** One hook-invocation log entry. */
			interface LogRow {
				id: number
				pluginId: string
				pluginName: string
				hookName: string
				backend: string
				mode: string
				triggeredBy: string | null
				runId: string | null
				durationMs: number
				ok: boolean
				outcome: string
				reason: string | null
				finishedAt: string | Date
			}
			namespace List {
				interface Params {}
				interface Response {
					plugins: PluginRow[]
					/** Whether the sandbox is actually on (SP_PLUGINS_ENABLED). */
					sandboxEnabled: boolean
				}
			}
			namespace Install {
				interface Params {
					pluginId: string
					name: string
					version?: string
					bundleSource: string
					backends: ("quickjs" | "ses")[]
					sequential?: boolean
					manifest?: Record<string, unknown>
					/**
					 * The plugin's client-side files (20 §12) — frame
					 * documents and assets, base64. Replaced wholesale on
					 * install like the bundle; unsafe paths are refused by
					 * name in the response.
					 */
					files?: Array<{ path: string; mime: string; data: string }>
				}
				interface Response {
					plugins: PluginRow[]
				}
			}
			/**
			 * The dev install (D-6): a folder on the server's own disk, read
			 * as `serene-pub build` wrote it. Never a URL — see the handler.
			 */
			namespace InstallLocal {
				interface Params {
					/** The package root — the folder holding `dist/plugin/`. */
					dir: string
				}
				interface Response {
					pluginId: string
					/** Spec slugs saved, owned by the plugin. */
					specs: string[]
					/** Config seed keys written. */
					configs: string[]
					/** Genre ids whose declaration this install supplied. */
					genres: string[]
					/** Client files stored. */
					files: number
					/** Anything refused or worth saying, one sentence each. */
					warnings: string[]
					plugins: PluginRow[]
				}
			}
			namespace SetEnabled {
				interface Params {
					pluginId: string
					enabled: boolean
				}
				interface Response {
					plugins: PluginRow[]
				}
			}
			namespace SetBackend {
				interface Params {
					pluginId: string
					backend: "quickjs" | "ses"
				}
				interface Response {
					plugins: PluginRow[]
				}
			}
			namespace SetSequential {
				interface Params {
					pluginId: string
					sequential: boolean
				}
				interface Response {
					plugins: PluginRow[]
				}
			}
			namespace Uninstall {
				interface Params {
					pluginId: string
				}
				interface Response {
					plugins: PluginRow[]
				}
			}
			namespace Active {
				interface Params {}
				interface Response {
					active: ActiveRow[]
				}
			}
			/**
			 * Ask one in-flight hook to stop itself — its `ctx.signal` fires
			 * and it winds down in its own frame. The cooperative half of
			 * `Kill`, and the one to reach for first: a hook that wakes returns
			 * an ordinary result, having released whatever it was holding.
			 *
			 * `aborted` says only that there was a call in flight to signal,
			 * never that the hook acted on it — that is observable exactly one
			 * way, by the call leaving the monitor.
			 */
			namespace Abort {
				interface Params {
					callId: number
				}
				interface Response {
					aborted: boolean
					active: ActiveRow[]
				}
			}
			namespace Kill {
				interface Params {
					callId: number
				}
				interface Response {
					killed: boolean
					active: ActiveRow[]
				}
			}
			namespace Logs {
				interface Params {
					pluginId?: string
					limit?: number
				}
				interface Response {
					logs: LogRow[]
				}
			}
			/** One declared permission and whether an admin has granted it. */
			interface PermState {
				key: string
				kind: "system" | "resource" | "event"
				label: string
				accountAffecting: boolean
				/** In force right now — reviewed *and* not denied. */
				granted: boolean
				/** Declared, but awaiting an admin's first decision. Refused meanwhile. */
				pending: boolean
			}
			/** The storage-quota picture for a plugin, for the admin override control. */
			interface StorageQuota {
				/** Storage is declared and not admin-denied. */
				granted: boolean
				/** Bytes the runtime enforces right now (override ?? declared). */
				effectiveBytes: number | null
				/** The manifest-declared quota (author-band-clamped), if any. */
				declaredBytes: number | null
				/** The admin override in force (bytes), or null for none. */
				overrideBytes: number | null
				/** The admin override band the value is clamped into. */
				minBytes: number
				maxBytes: number
			}
			namespace Permissions {
				interface Params {
					pluginId: string
				}
				interface Response {
					pluginId: string
					permissions: PermState[]
					/** Present when the plugin declares storage — drives the override control. */
					storage?: StorageQuota
				}
			}
			namespace SetPermission {
				interface Params {
					pluginId: string
					key: string
					granted: boolean
				}
				interface Response {
					pluginId: string
					permissions: PermState[]
					storage?: StorageQuota
				}
			}
			/**
			 * Record that an admin has reviewed this plugin's requested
			 * permissions — the consent act. Everything still granted goes into
			 * force; anything they denied first stays denied.
			 */
			namespace ReviewPermissions {
				interface Params {
					pluginId: string
				}
				interface Response {
					pluginId: string
					permissions: PermState[]
					storage?: StorageQuota
				}
			}
			namespace SetStorageQuota {
				interface Params {
					pluginId: string
					/** New override in bytes, or null to clear it (revert to the manifest quota). */
					bytes: number | null
				}
				interface Response {
					pluginId: string
					permissions: PermState[]
					storage?: StorageQuota
				}
			}
		}
		namespace Connections {
			namespace List {
				interface Params {}
				/**
				 * One endpoint in the list, WITH its models.
				 *
				 * The models ride on the list rather than being fetched per
				 * card: the index is one screen of every endpoint and every
				 * model, searchable across both, and a card that has to ask
				 * for its rows before search can see them is a card search
				 * gets wrong until it loads. One query on the server, one
				 * message on the wire, one render.
				 *
				 * `modelsSync` is when the endpoint's listing was last
				 * reconciled and what went wrong if it could not be — the
				 * "checked 3 minutes ago" / "couldn't reach the host" line
				 * under the endpoint's name.
				 */
				interface Row extends Partial<SelectConnection> {
					models: Models.ModelRow[]
					modelsSync: ModelsSync
					/**
					 * Whether a credential is stored — never the credential.
					 *
					 * The one bit that lets the index say "needs a key" (gold,
					 * unfinished) instead of "couldn't list models" (red,
					 * broken) for a connection nobody has finished. The
					 * encrypted envelope stays in `extra_json`, which this
					 * projection deliberately omits. See
					 * `$lib/shared/connections/credentials.ts`.
					 */
					hasCredential?: boolean
				}
				interface Response {
					connectionsList: Row[]
				}
			}
			/** When an endpoint's models were last reconciled, and how it went. */
			interface ModelsSync {
				/** ISO time of the last attempt, or null if nothing has ever checked. */
				at: string | null
				/** The last attempt's failure, or null after a successful one. */
				error: string | null
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
					/**
					 * What the save quietly changed on its way in, where it
					 * changed something the payload asserted.
					 *
					 * Today that is exactly one thing: a `preset` the server
					 * refused to store — not a slug, not a slug this build
					 * knows, or a slug belonging to a different API than the
					 * type the row now has. The handler normalizes it to NULL
					 * ("custom") rather than refusing the whole update, so
					 * without this the connection would come back saved and a
					 * preset the user had chosen would simply be gone.
					 *
					 * Not an `error`: the save SUCCEEDED and `connection` is the
					 * real, written row. A client shows it as a warning
					 * alongside the success, never instead of it.
					 */
					notice?: string
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
			/**
			 * Register this connection as the instance default for ONE
			 * capability. Formerly `SetUserActive`, and the rename is the point.
			 *
			 * "Active" described a single starred connection the app then used
			 * for whatever it happened to need. There is no such thing: a
			 * default belongs to a capability, and one KoboldCPP row does chat,
			 * vision, image generation, speech and transcription from one
			 * process — so starring it says nothing about which of the five was
			 * meant.
			 *
			 * ⚠ `capability` is a REQUIRED param and cannot be derived from the
			 * connection. Deriving it would have to guess among everything the
			 * row can do, and the guess most likely to be written is "the first
			 * one", which is how an image-capable connection ends up as the chat
			 * default. `id: null` clears that one capability's default and
			 * leaves the others alone.
			 */
			namespace SetDefault {
				interface Params {
					/** A `CapabilityId` — in practice always a transform id. */
					capability: string
					id: number | null
					/**
					 * WHICH MODEL on that endpoint (0114). Absent or null means
					 * its default model, which is what the one-click paths
					 * (`koboldcpp:connectModel`, `ollama:connectModel`) mean —
					 * they have just made the model they are connecting the
					 * endpoint's default.
					 */
					modelId?: number | null
				}
				interface Response {
					ok: boolean
					capability: string
					id?: number | null
					modelId?: number | null
				}
			}
			/**
			 * The connection's stop guards (18 §4b): stop scripts riding the
			 * endpoint, inherited by every pipeline that runs against it.
			 * `available` is every stop script on the instance — only
			 * `text/stop` may attach; the server refuses the rest.
			 */
			namespace Scripts {
				interface Params {
					id: number
				}
				interface ScriptRow {
					id: number
					name: string
					enabled: boolean
				}
				interface Response {
					connectionId?: number
					attached?: ScriptRow[]
					available?: ScriptRow[]
					error?: string
				}
			}
			namespace ScriptWrite {
				interface Params {
					id: number
					scriptId: number
				}
				type Response = Scripts.Response
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
					// Anything else the test learned that a form can use —
					// An image backend returns its sampler list here. A test is the moment
					// the connection is known to be reachable, so it is the
					// cheapest place to fetch what a form cannot guess; a
					// dedicated round trip per backend-specific list would be
					// one more endpoint per backend.
					extra?: Record<string, unknown>
					// What the connection turned out to be able to do, with
					// this test's own probe folded in (0175). Present only for
					// a passing test — a failed one learned nothing — and the
					// form shows it without having to re-read the row, which
					// for an unsaved connection does not exist yet.
					capabilities?: import("@serene-pub/sdk").CapabilitySet
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
			/**
			 * Reading a connection's capabilities for the toggle panel (0175).
			 *
			 * Its own event rather than a field on the row, because
			 * `capabilities` is server-owned: connectionsUpdate strips the column
			 * off the payload so a stale client copy can never land back on top of
			 * a probe (the comment there records the bug that caused). A panel
			 * that read the column out of the editor's `connection` — or wrote it
			 * back through `connections:update` — would walk into the same one.
			 * So the panel is handed a `connectionId` and fetches for itself.
			 */
			namespace Capabilities {
				interface Params {
					id: number
				}

				/**
				 * The shape of the `connections.capabilities` json column.
				 *
				 * The same shape as `StoredCapabilities`
				 * (server/connections/resolve.ts) on purpose: wire, server and row
				 * model are one definition rather than three that happen to agree
				 * today.
				 */
				interface Stored {
					/**
					 * The effective set everything reads. A CACHE of the other two
					 * plus the static manifest — derived, never the source.
					 */
					resolved?: import("@serene-pub/sdk").CapabilitySet
					/**
					 * What a person switched by hand. THE DURABLE INTENT.
					 *
					 * Three states, not two. A key may be ABSENT (auto — nobody has
					 * stated an intent, so preset and probe decide), a tier (on), or
					 * `false` (off, explicitly). Clearing an override DELETES the
					 * key; writing `false` to mean "stop overriding" would blind the
					 * row to whatever its backend reports from then on.
					 */
					overrides?: import("@serene-pub/sdk").CapabilityOverrides
					/**
					 * The last successful test, and when it answered — the honest
					 * owner of "what does this backend actually do". `at` is load
					 * bearing for the panel: an untested connection has to say so
					 * rather than look authoritative.
					 */
					probe?: {
						found: import("@serene-pub/sdk").CapabilitySet
						at?: string
					}
				}

				interface Response {
					connectionId: number
					/**
					 * From the SAVED row, never the editor's form state: the key
					 * space belongs to the persisted type, and Document View's edit
					 * page can change `type` in local state long before a save.
					 */
					type?: string
					preset?: string | null
					capabilities?: Stored
					error?: string
				}
			}
			/**
			 * Switching ONE capability. Singular by design: a bulk `overrides`
			 * payload lets a stale client blow away an override it never rendered,
			 * which is the same clobber class connectionsUpdate already guards.
			 */
			namespace SetCapability {
				interface Params {
					id: number
					capability: import("@serene-pub/sdk").CapabilityId
					/**
					 * THREE STATES ON THE WIRE, matching the three the column holds:
					 *
					 * - `null` — clear the override. The handler DELETES the key, so
					 *   authority goes back to the probe. Reachable again after any
					 *   toggle; a two-state control would destroy it with no way
					 *   back.
					 * - `"native"` — on. The only value the UI sends for on, because
					 *   resolution clamps an override down to what the adapter can
					 *   actually do; offering a grade on write would be a promise the
					 *   key space may refuse.
					 * - `"emulated"` — accepted, reserved for a future
					 *   force-emulated control.
					 * - `false` — off, explicitly.
					 *
					 * `null` rather than `undefined`: undefined does not survive
					 * JSON, so "clear" would arrive as an absent key —
					 * indistinguishable from a malformed payload. The wire has to be
					 * able to SAY it.
					 *
					 * ⚠ A BAND NAME, while the column stores a GRADE. `"native"` means
					 * "this capability's top band", which is a different number per
					 * capability — 2 for `tools`, 1 for `text->image` — so a numeric
					 * wire would force the client to know every capability's scale
					 * just to say "on". The handler converts, at the same place it
					 * gates the key space.
					 */
					value: import("@serene-pub/sdk").Band | false | null
				}
				/**
				 * Identical to the read's, so one client handler serves both and the
				 * two can never disagree — the same reason ScriptWrite reuses
				 * Scripts.Response.
				 */
				type Response = Capabilities.Response
			}

			/**
			 * The MODELS on this endpoint (0114) — the second half of the pair.
			 *
			 * ## Under `Connections` and not its own namespace
			 *
			 * `ConnectionDefaults` earned its own because its subject is the
			 * CAPABILITY; a model's subject is the connection it hangs off. It
			 * has no identity apart from one, every handler is addressed by
			 * `{ id }` the way `Scripts` is, and the editor that renders it is a
			 * section of the connection form. Same file, same admin gate, same
			 * `connections:` prefix — which is this file's convention for
			 * "something a connection HAS".
			 *
			 * ## All five answer with the same refreshed view
			 *
			 * The `Scripts` pattern exactly, for the reason given there: a write
			 * changes more than the row it names — creating the first model
			 * stars it, deleting the starred one promotes another, and both move
			 * the endpoint's legacy mirror — so two fetches that could disagree
			 * are one fetch that cannot.
			 */
			namespace Models {
				interface Params {
					/** The CONNECTION. A model is always addressed through its endpoint. */
					id: number
				}
				/**
				 * One model row, as a client sees it.
				 *
				 * ⚠ No `extraJson`. The column exists and is merged onto the pair
				 * for an adapter to read, and nothing writes it yet — putting it
				 * on the wire before there is a control for it would make the
				 * only way to set it a hand-crafted socket call, and the
				 * encrypted `apiKey` the crypto path walks lives on the ENDPOINT.
				 * The handlers refuse the field rather than trusting that.
				 */
				interface ModelRow {
					id: number
					connectionId: number
					/** What the adapter sends. */
					model: string
					/** What a person sees. Defaults to `model`. */
					name: string
					enabled: boolean
					/**
					 * ISO time since which the service has stopped listing
					 * this model, or null while it still does. A missing model
					 * is unavailable everywhere: refused at dispatch, refused
					 * by the star, greyed in every picker with this as the
					 * reason. See the column comment in schema.ts.
					 */
					missingSince: string | null
					/** NULL means "the sampling config decides". */
					contextWindow: number | null
					/**
					 * What the HOST said about this model on the last successful
					 * listing — context window, price per million tokens,
					 * parameter size, quantisation, size on disk. Sparse; an
					 * absent field means unknown and renders as `—`.
					 *
					 * ⚠ Never `contextWindow` above, which is the admin's
					 * override and the one the resolver reads. These two agree
					 * only by coincidence and the UI shows the override when one
					 * is set. See `$lib/shared/connections/modelFacts.ts`.
					 */
					facts?: ModelFacts
					/** NULL means "the endpoint's". A `completion_templates.key`. */
					promptFormat: string | null
					/** NULL means "the endpoint's". */
					tokenCounter: string | null
					sortOrder: number
					/**
					 * This MODEL's capability layer, in the same shape the
					 * endpoint's column holds. Layered OVER the endpoint's at
					 * resolution; on its own it says only what a person set for
					 * this checkpoint and what a probe of it answered.
					 */
					capabilities?: Capabilities.Stored
					/**
					 * The transform ids this (endpoint, model) pair may be
					 * registered as the default for, judged server-side as the
					 * merged pair. Empty for a switched-off model. Drives the
					 * per-model default dropdown — the client offers exactly
					 * these, never more.
					 */
					satisfiableCapabilities?: string[]
					/**
					 * Present only on a LOCAL ONNX endpoint's rows (embeddings,
					 * entities): the state of the model's files on this machine
					 * and what the recommended list knows about it. Absent on
					 * every other endpoint — a remote host's models have no disk
					 * state here. See `LocalModelState`.
					 */
					local?: LocalModelState
				}
				interface Response {
					connectionId?: number
					models?: ModelRow[]
					/** The endpoint's `type`, for the capability panel's key space. */
					type?: string
					preset?: string | null
					/** When the endpoint's listing was last reconciled. */
					modelsSync?: ModelsSync
					error?: string
				}
			}
			/**
			 * Reconcile an endpoint's models against what its service lists —
			 * or every endpoint's, when no id is given.
			 *
			 * Automatic syncs (no `force`) skip endpoints whose listing is
			 * fresh, so the sidebar can ask on every open without hitting a
			 * cloud API each time; a forced sync is the Refresh button. Each
			 * synced endpoint is also broadcast as `connections:models` and the
			 * whole list as `connections:list`, so every open view updates
			 * without asking again.
			 */
			namespace SyncModels {
				interface Params {
					/** One endpoint, or every endpoint when absent. */
					id?: number
					/** Re-ask the host even when the last listing is fresh. */
					force?: boolean
				}
				interface Result {
					connectionId: number
					added: number
					restored: number
					missing: number
					listed: number
					error: string | null
					syncedAt: string
				}
				interface Response {
					/** One entry per endpoint that was actually synced. */
					results: Result[]
					error?: string
				}
			}
			/** Add one model by hand. `name` defaults to `model`. */
			namespace CreateModel {
				interface Params {
					id: number
					model: {
						model: string
						name?: string | null
						enabled?: boolean
						contextWindow?: number | null
						promptFormat?: string | null
						tokenCounter?: string | null
						sortOrder?: number
					}
				}
				type Response = Models.Response
			}
			/**
			 * Edit one model. A PARTIAL payload: an absent key is "leave it
			 * alone", which is what lets the row editor save a rename without
			 * restating every override.
			 */
			namespace UpdateModel {
				interface Params {
					id: number
					modelId: number
					model: Partial<
						Omit<CreateModel.Params["model"], "model">
					> & { model?: string }
				}
				type Response = Models.Response
			}
			namespace DeleteModel {
				interface Params {
					id: number
					modelId: number
				}
				type Response = Models.Response
			}
			/**
			 * Add models a probe listed, all at once.
			 *
			 * ⚠ The probed list is NEVER auto-persisted; this runs on an explicit
			 * press. `listModels` on a large OpenAI-compatible host returns a
			 * hundred ids including embeddings and transcription endpoints, and
			 * writing those as rows would fill every picker on the instance with
			 * things nobody can chat to.
			 */
			namespace ImportModels {
				interface Params {
					id: number
					models: { model: string; name?: string | null }[]
				}
				interface Response extends Models.Response {
					/** How many rows it created, and how many were already there. */
					added?: number
					skipped?: number
				}
			}

			/**
			 * A local ONNX model's files on this machine, and what the
			 * recommended list says about it. Rides on `ModelRow.local` for the
			 * two local ONNX endpoint types only.
			 *
			 * `state` is a fact about the disk, re-checked on every sync — never
			 * durable state — and it is independent of whether the model is the
			 * capability default ("active"): a default that is `not_downloaded`
			 * is exactly what a person needs to see before the first job stalls.
			 */
			interface LocalModelState {
				state: "not_downloaded" | "downloading" | "on_disk" | "error"
				/** Bytes on disk once `on_disk`; the list's size until then. */
				sizeBytes: number | null
				/** 0–100 while `downloading`. */
				percent?: number
				downloadedBytes?: number
				totalBytes?: number
				/** The Hub's own sentence when `error`. */
				error?: string | null
				/** Resident in the lane right now (only the active model can be). */
				loaded: boolean
				/** True for a row a person added by Hub id — the one removable kind. */
				addedByUser: boolean
				/** From the recommended list (or the Hub's config for an added row). */
				catalog?: {
					tier?: "fast" | "balanced" | "best"
					/** MB the list says the download is. */
					sizeMb?: number
					/** transformers.js DataType the download requests (q8, fp32, …). */
					dtype?: string
					dimensions?: number
					maxInputTokens?: number
					pooling?: "mean" | "cls" | "last_token"
					prefixes?: { query?: string; document?: string }
					labels?: string[]
					languages?: string
					tags?: string[]
					license?: string
					released?: string
					parameterSize?: string
					description?: string
				}
			}
			/** Warm the transformers cache for one local ONNX model. Admin; local ONNX types only. */
			namespace DownloadModel {
				interface Params {
					/** The CONNECTION. */
					id: number
					modelId: number
				}
				interface Response {
					connectionId: number
					modelId: number
					local: LocalModelState
					error?: string
				}
			}
			/**
			 * Stop a download. The current file finishes or fails first, then the
			 * partial cache directory is removed — the row says so meanwhile.
			 */
			namespace CancelModelDownload {
				interface Params {
					id: number
					modelId: number
				}
				interface Response extends DownloadModel.Response {}
			}
			/** Delete the model's cache directory and registry row. Refused for the active model. */
			namespace RemoveModelFiles {
				interface Params {
					id: number
					modelId: number
				}
				interface Response extends DownloadModel.Response {}
			}
			/**
			 * Add a Hugging Face model that is not on the recommended list, as a
			 * `not_downloaded` row. Validated against the Hub before a row exists:
			 * config.json fetchable, an onnx/ export present, and — for
			 * embeddings — a readable hidden size; for entities — an id2label.
			 */
			namespace AddHubModel {
				interface Params {
					id: number
					/** `org/name`. */
					hubId: string
					/** transformers.js DataType; unset = the export's default. */
					dtype?: string | null
				}
				interface Response extends Models.Response {
					created?: Models.ModelRow
				}
			}
			/**
			 * Pushed while a local ONNX download runs, and once when it settles.
			 * One event moves the index row, the model view and the lane panel.
			 */
			namespace ModelDownloadProgress {
				interface Params {}
				interface Response {
					connectionId: number
					modelId: number
					local: LocalModelState
				}
			}
		}

		/**
		 * The admin Defaults screen (Admin → Defaults): which connection and
		 * sampling config this instance uses for each capability.
		 *
		 * Its own namespace rather than more events on `Connections`, because
		 * the subject is the CAPABILITY, not a connection — the screen is a list
		 * of capabilities that happens to name connections, and it is now the
		 * definition of "does this instance have this capability at all".
		 *
		 * Registering a default here is the ONLY way a connection becomes usable
		 * by a run. Nothing picks one because it exists, because it is the only
		 * one, or because it is capable: the resolution chain is
		 * `capability default → pipeline config → session override`, and if no
		 * tier set one the run fails with a sentence naming this screen.
		 */
		namespace ConnectionDefaults {
			namespace List {
				interface Params {}
				interface Response {
					/**
					 * Every capability this build can serve or core demands.
					 * Aggregated, never a hardcoded list — see `combos.ts`.
					 */
					combos: ComboRow[]
					/** What is registered today, keyed by capability. `{}` if nothing is. */
					defaults: Record<string, CapabilityDefault>
					/**
					 * The connections offerable per capability, already judged.
					 *
					 * Sent rather than derived client-side, and never filtered
					 * down to the eligible ones: a row the user cannot pick is
					 * DISABLED with a reason, because "why isn't mine in the
					 * list" has no answer anywhere if the row is simply absent.
					 * A connection with no capabilities recorded at all is
					 * undetermined, not incapable.
					 */
					connectionOptions: Record<string, ConnectionOption[]>
					samplingOptions: Record<string, SamplingOption[]>
				}
				interface ConnectionOption {
					id: number
					name: string
					/** False disables the row; `reason` says why, in words. */
					eligible: boolean
					reason?: string
					/**
					 * The user's own note about this connection, shown beside
					 * the row so the reminder arrives at the moment of choosing.
					 *
					 * ⚠ Display-only free text, and absent when there is none.
					 * Nothing parses it and no eligibility follows from it —
					 * `eligible` and `reason` are where a verdict about this
					 * connection lives, precisely so this field never has to be
					 * one. See the `connections.notes` column comment.
					 */
					notes?: string
					/**
					 * The MODELS on this endpoint (0114), so the card can offer
					 * the second half of the pair.
					 *
					 * Absent where the endpoint has none — a picker showing
					 * "Default model" over an empty list is the honest rendering
					 * of a connection nobody has finished setting up.
					 */
					models?: ModelOption[]
				}
				/**
				 * One model, for the pair picker. Disabled models are INCLUDED
				 * and marked: a registration made before somebody switched one
				 * off has to still be shown as what it is, or the card renders
				 * empty and "why is mine not in the list" has no answer.
				 */
				interface ModelOption {
					id: number
					/** What a person sees. */
					name: string
					/** What the adapter sends — the subtitle, when the two differ. */
					model: string
					enabled: boolean
					/**
					 * Set while the service has stopped listing this model. Shown
					 * greyed with the reason, never dropped — a registration made
					 * before the model vanished has to still show as what it is.
					 */
					missingSince: string | null
				}
				interface SamplingOption {
					id: number
					name: string
				}
			}
			/**
			 * Write one half of one capability's default.
			 *
			 * `half` rather than a whole row, because the two are independently
			 * meaningful and independently clearable: clearing the sampling
			 * config means "let the backend use its own defaults" and must not
			 * disturb the connection beside it.
			 */
			namespace Set {
				interface Params {
					capability: string
					half: "connection" | "sampling"
					id: number | null
					/**
					 * The MODEL, when the half is `connection` (0114). Absent or
					 * null means "that endpoint's default model".
					 *
					 * On the same event rather than a sixth one, because the
					 * connection and the model are ONE choice made in one
					 * control: sending them separately would make a moment in
					 * which the registration names an endpoint and a model
					 * belonging to the previous one.
					 */
					modelId?: number | null
				}
				interface Response {
					capability: string
					defaults: Record<string, CapabilityDefault>
				}
			}
		}

		// Personas namespace
		/**
		 * The library's folders. Owner-scoped, flat, characters only.
		 *
		 * ⚠ There is no `personas:*` family: a persona is a character the user
		 * voices, so every persona surface talks to `characters:*` and reads
		 * `isPersona` off the row.
		 */
		namespace CharacterFolders {
			namespace List {
				interface Params {}
				interface Response {
					folders: (SelectCharacterFolder & {
						/** How many of the caller's characters are filed here. */
						characterCount: number
					})[]
				}
			}
			namespace Create {
				interface Params {
					name: string
				}
				interface Response {
					folder: SelectCharacterFolder
				}
			}
			namespace Update {
				interface Params {
					id: number
					name?: string
					position?: number
				}
				interface Response {
					folder: SelectCharacterFolder
				}
			}
			namespace Delete {
				interface Params {
					id: number
				}
				interface Response {
					success?: boolean
					error?: string
					/** The deleted folder's id, so a scope can be derived. */
					id?: number
				}
			}
		}

		/**
		 * The session catalogue's admin half (23 §9): types (create specs),
		 * presets (the bundle users pick), and the all-users sessions list.
		 */
		namespace SessionAdmin {
			interface GenreRow {
				/** The create spec's slug — the session type (23 §7). */
				slug: string
				name: string
				description: string
				family: string
				/** May users start sessions of this type? */
				enabled: boolean
				defaultPresetId: number | null
				presetCount: number
				/** The genre's create pipeline slug (24 §3); null for transitional input-type genres. */
				createSpecSlug: string | null
			}
			namespace Genres {
				interface Params {}
				interface Response {
					genres: GenreRow[]
				}
			}
			namespace UpdateGenre {
				interface Params {
					slug: string
					enabled?: boolean
					defaultPresetId?: number | null
				}
				interface Response {
					slug: string
					ok: boolean
					error?: string
				}
			}
			namespace GenreDetail {
				interface Params {
					genreId: string
				}
				interface Slot {
					event: string
					required: boolean
					open: boolean
					/** Pipelines whose input lock answers this slot. */
					candidates: { slug: string; name: string }[]
				}
				interface Response {
					genre?: {
						genreId: string
						name: string
						description: string
						family: string
						shape: Record<string, unknown>
						createSpecSlug: string | null
						/** The app-wide switch (R66): off stops new sessions only. */
						enabled: boolean
						defaultPresetId: number | null
					}
					slots: Slot[]
					presets: PresetRow[]
					sessionCount: number
					/** Plugins' swap contributions to this genre's pipelines, with the admin's switch (R66). */
					swaps?: SwapRow[]
					error?: string
				}
				interface SwapRow {
					pluginId: string
					pluginName: string
					spec: string
					specName: string
					node: string
					definition: string
					name: string
					/** Not in the plugin's `disabled_swaps`. */
					enabled: boolean
				}
			}
			namespace SetPresetsEnabled {
				interface Params {
					genreId: string
					enabled: boolean
				}
				interface Response {
					genreId: string
					changed: number
					refused: Array<{ id: number; name: string; reason: string }>
				}
			}
			namespace SetSwapEnabled {
				interface Params {
					pluginId: string
					spec: string
					node: string
					definition: string
					enabled: boolean
					/** The hub to re-send, when the switch was thrown from one. */
					genreId?: string
				}
				interface Response {
					ok: boolean
					error?: string
				}
			}
			/**
			 * The creation pre-fill a preset supplies (23 §9) — the keys the
			 * new-session form applies (`applyPresetDefaults`), each optional
			 * and each type-checked at apply, so a preset written by an older
			 * build or a plugin can carry keys this one ignores.
			 */
			interface PresetDefaults {
				name?: string
				scenario?: string
				/** Swaps to seat the session with (R40); see the SDK's `PresetDefaults`. */
				swaps?: import("@serene-pub/sdk").StoredSwapContribution[]
				lorebookId?: number | null
				tags?: string[]
				genreFields?: Record<string, unknown>
				[key: string]: unknown
			}

			interface PresetRow {
				id: number
				name: string
				description: string | null
				genreId: string
				/**
				 * The event bindings (24 §1): event → {spec, config?}. `config`
				 * is a pipeline_configs id; absent = the spec's shipped default.
				 */
				bindings: Record<string, { spec: string; config?: number }>
				primarySlug: string | null
				configSelections: Record<string, number>
				/**
				 * Which actions sessions on this preset include, by
				 * **identity** — `<spec slug>#<key>` (U5c review, W-A). `null`
				 * states nothing (the companion rule decides); `[]` states
				 * none. ⏳ A bare function key in a stored row includes the
				 * companion's action for that function only.
				 */
				includedActions: string[] | null
				/**
				 * The creation pre-fill (23 §9): loose keys the create form
				 * applies where it recognises one and ignores otherwise. Null
				 * when the preset declares none.
				 */
				defaults: PresetDefaults | null
				enabled: boolean
				isDefault: boolean
				isImmutable: boolean
				/**
				 * Slots whose bound pipeline this instance cannot resolve
				 * (ruled 2026-09-10), from the boot reconcile's notices.
				 *
				 * Absent means the reconcile found none. It never means the
				 * preset refuses to run: a stale slot falls back to the
				 * genre's default and the session says so — this is what puts
				 * the same fact in front of the administrator, who is the only
				 * person who can fix it.
				 */
				staleBindings?: StaleBinding[]
			}
			/**
			 * One preset slot the instance cannot honour, as every surface
			 * repeats it: the admin list, the preset editor, the session
			 * banner, and the run's own explanation.
			 */
			interface StaleBinding {
				event: string
				/** The slug the preset still names. */
				bound: string
				/** Why it does not resolve, as a sentence. */
				reason: string
				/** The genre's own answer, which runs instead. Null = none. */
				fallbackSpec: string | null
				/** When the condition was first observed, ISO 8601. */
				firstSeenAt?: string
			}
			namespace Presets {
				interface Params {}
				interface Response {
					presets: PresetRow[]
				}
			}
			namespace CreatePreset {
				interface Params {
					name: string
					genreId: string
					description?: string
					/** Copy this preset's selections instead of starting bare. */
					fromPresetId?: number
					/** The creation pre-fill — see `PresetRow.defaults`. */
					defaults?: PresetDefaults | null
				}
				interface Response {
					preset?: PresetRow
					error?: string
				}
			}
			namespace UpdatePreset {
				interface Params {
					id: number
					name?: string
					description?: string | null
					bindings?: Record<string, { spec: string; config?: number }>
					primarySlug?: string | null
					configSelections?: Record<string, number>
					/**
					 * Identities (`<spec slug>#<key>`), validated against what
					 * the genre is offered; an entry nothing contributes is
					 * refused by name. ⏳ A bare function key one companion
					 * action carries is accepted and stored as its identity.
					 */
					includedActions?: string[] | null
					/**
					 * The creation pre-fill — see `PresetRow.defaults`. `null`
					 * clears it; absent leaves it alone.
					 */
					defaults?: PresetDefaults | null
					enabled?: boolean
					isDefault?: boolean
				}
				interface Response {
					preset?: PresetRow
					error?: string
				}
			}
			namespace DeletePreset {
				interface Params {
					id: number
				}
				interface Response {
					id: number
					ok: boolean
					error?: string
				}
			}
			namespace SessionsList {
				interface Params {
					limit?: number
				}
				interface Row {
					id: number
					name: string | null
					userId: number | null
					username: string
					genreId: string
					genreName: string
					presetId: number | null
					presetName: string | null
					isGroup: boolean
					characterCount: number
					personaCount: number
					messageCount: number
					updatedAt: string | null
				}
				interface Response {
					sessions: Row[]
				}
			}
		}

		// Sessions namespace
		namespace Sessions {
			/**
			 * Show a character in another sprite set FOR THIS SESSION ONLY
			 * (DESIGN-sprites §2.3) — "she changed clothes in this scene".
			 * `set: null` clears it. Pushed to every member as
			 * `sessions:spriteSetChanged`.
			 */
			namespace SetSpriteSet {
				interface Params {
					sessionId: number
					characterId: number
					set: string | null
				}
				interface Response {
					sessionId: number
					characterId: number
					set: string | null
					error?: string
				}
			}
			namespace List {
				interface Params {
					sessionType?: string
				}
				/**
				 * The session's latest visible line — what "pick up where you
				 * left off" shows without opening the session.
				 *
				 * Absent on a session with nothing to show. "Nothing to show"
				 * is wider than "no rows": an in-flight generation
				 * (`is_generating`), a message the owner hid (`is_hidden`) and
				 * a blank body are all skipped, so a session mid-generation
				 * still reads as its last real line rather than an empty
				 * quote. A composer draft can never appear here at all — a
				 * draft is a `sessions.drafts` entry, not a message row.
				 */
				interface LastMessage {
					/** First ~160 characters, markdown stripped, whitespace collapsed. */
					excerpt: string
					/**
					 * Who said it — the persona or character name, the
					 * Narrator's display name for a narration, null when the
					 * row names nobody.
					 */
					speakerName: string | null
					/** The caller's side of the conversation said it (`role = 'user'`). */
					isUser: boolean
					/**
					 * When the line landed, ISO-8601.
					 *
					 * Read off `session_messages.updated_at`, which is a real
					 * `timestamp` defaulting to the insert instant — unlike
					 * `created_at`, a `date` column (day granularity, a
					 * pre-0.6 schema fact) that would make a message from a
					 * minute ago read as hours old.
					 */
					createdAt: string
				}
				interface Response {
					// Matches the `with: { sessionCharacters, sessionPersonas, sessionTags }`
					// query in registerSessionsHandlers' "sessions:list" handler — the
					// character/persona rows are trimmed to a display-only column
					// subset there (id/name/shortDescription/avatar/visibility),
					// hence Partial<...> rather than the full Select* type.
					sessionList: (Partial<SelectSession> & {
						canEdit: boolean
						isOwner: boolean
						isGuest: boolean
						/** The mode's display name — the card's "type" chip. */
						genreName?: string
						/**
						 * How many messages the session holds — the same
						 * notion `sessions:adminList` reports, a plain row
						 * count over `session_messages`.
						 */
						messageCount?: number
						/** The latest visible line, absent when there is none. */
						lastMessage?: LastMessage
						/**
						 * What the session's run in flight is doing (R-19) —
						 * *Jasmine is typing* — as a locale map the client
						 * resolves. Absent when nothing is running; kept
						 * current between lists by `sessions:runStatus`.
						 */
						runStatus?: import("@serene-pub/sdk").StatusText
						sessionCharacters?: (SelectSessionCharacter & {
							character: Partial<SelectCharacter>
						})[]
						sessionPersonas?: (SelectSessionPersona & {
							persona: Partial<SelectCharacter>
						})[]
						sessionTags?: { tag: SelectTag }[]
					})[]
				}
			}
			/** Client → server: "my persona is actively typing in this session" ping */
			namespace Typing {
				interface Params {
					sessionId: number
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
					sessionId: number
					personaId: number
					personaName: string
				}
			}
			/**
			 * Server → client (R-19): a run in this session changed its status,
			 * or ended (`status: null`). Broadcast to the session's users on
			 * every change; the session list keeps its row current from it.
			 */
			namespace RunStatus {
				interface Params {}
				interface Response {
					sessionId: number
					runId: string
					status: import("@serene-pub/sdk").StatusText | null
				}
			}
			/**
			 * Server → client: this session's list row moved — a message
			 * landed, was edited, hidden, deleted, swiped, regenerated or
			 * streamed. Broadcast to the session's users so the sidebar row,
			 * the session detail panel and the home page's "continue" card
			 * quote the session as it is now without re-reading the whole
			 * list.
			 *
			 * The same three facts `sessions:list` projects for the row, from
			 * the same projection (`server/sessions/rowProjection.ts`), so a
			 * patched row and a freshly listed one say the same thing.
			 */
			namespace RowChanged {
				interface Params {}
				interface Response {
					sessionId: number
					/**
					 * Every row the session holds — the list's own notion,
					 * which counts hidden and in-flight rows too.
					 */
					messageCount: number
					/**
					 * The latest visible line, or `null` when there is none
					 * now. NULL is the answer, never an absent field: deleting
					 * or hiding the last visible message has to CLEAR the
					 * quote, and a field that could mean "unchanged" could not
					 * say that.
					 */
					lastMessage: List.LastMessage | null
					/** The session row's `updated_at`, as the list sends it. */
					updatedAt: string
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
					session:
						| (SelectSession & {
								sessionMessages: SelectSessionMessage[]
								sessionCharacters: (SelectSessionCharacter & {
									character: WithAvatarMedia<SelectCharacter>
								})[]
								sessionPersonas: (SelectSessionPersona & {
									persona: WithAvatarMedia<SelectCharacter>
								})[]
								sessionTags?: { tag: { name: string } }[]
								// sessionGuests table has no `id` column (composite PK of
								// sessionId+userId — see schema.ts sessionGuests); the "sessions:get"
								// handler queries it `with: { user: true }`, so each row is
								// the full join row plus the full joined user.
								sessionGuests?: {
									sessionId: number
									userId: number
									isPlayer: boolean
									user: SelectUser
								}[]
								tags?: string[]
						  })
						| null
					messages?: SelectSessionMessage[] | null // Legacy field
					pagination?: { total: number; hasMore: boolean } | null
					/** Echoed from request — present only on load-more responses, not initial load */
					beforeId?: number
					/** The current user's in-progress composer draft, if any */
					userDraft?: string | null
					/**
					 * The requested session id — present on a not-found reply so
					 * the interest scope can still be derived.
					 *
					 * A reply with `session: null` has no `session.id` for
					 * `SCOPED_EVENTS` to read, so without this the payload would
					 * carry no scope and only a bare `sessions:get` key — one that
					 * matches every other session's reply as well — could receive
					 * it. Absent on a successful reply, where the id is on the
					 * session.
					 */
					sessionId?: number
				}
			}
			namespace SaveDraft {
				interface Params {
					sessionId: number
					content: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace Create {
				interface Params {
					// "sessions:create" always derives userId from the authenticated
					// socket and computes isGroup from characterIds.length itself
					// (see sessionsCreateHandler in sessions.ts) — the client must not,
					// and structurally can't reliably, supply either.
					session: Omit<InsertSession, "userId" | "isGroup"> & {
						/**
						 * The swaps to seat the session with (R40) — each a
						 * definition the named node offers, written as the
						 * session's rebind after the row exists. Absent: the
						 * preset's `defaults.swaps`; none: every node's pin.
						 */
						swaps?: import("@serene-pub/sdk").StoredSwapContribution[]
					}
					characterIds: number[]
					personaIds: number[]
					characterPositions: Record<number, number>
					tags?: string[]
				}
				interface Response {
					session?: SelectSession
					/**
					 * Swaps the session could not be seated with (A8): each
					 * named with the setter's sentence. The session starts on
					 * those nodes' pins; nothing else about the create failed.
					 */
					refusedSwaps?: Array<{
						spec: string
						node: string
						definition: string
						reason: string
					}>
					/**
					 * A refusal, in a sentence the person can act on — the
					 * genre's shape not met, a genre this build does not
					 * register. Emitted on `sessions:create:error` and
					 * returned as the ack, like `connections:scripts`;
					 * never beside `session`.
					 */
					error?: string
				}
			}
			/**
			 * The mode picker's data (19 §2): every session mode this build
			 * registers, shape included so the form can gate its capability
			 * sections before anything is created.
			 */
			/**
			 * Upgrade a session's mode along its own type (19 §6, ruled): there
			 * is no mid-session mode swap — a session keeps its mode for life, and
			 * the mode evolves as the same bare input type at a higher
			 * version. The target's shape is still validated; refusals are
			 * sentences.
			 */
			namespace UpgradeGenre {
				interface Params {
					sessionId: number
					/** The target pin — same bare type, higher version. */
					genreId: string
				}
				interface Response {
					sessionId: number
					genreId: string
					error?: string
				}
			}
			/**
			 * The rebinding seams (19 §3, §5). Bindings select among the
			 * eligible — never contain; clearing is reset-is-delete.
			 */
			namespace Bindings {
				/**
				 * Which specs serve a **subject** for this session's genre, and
				 * the pick (plans/31 V2). A subject is an action's identity
				 * `<spec slug>#<key>` — whose only candidate is its declarer —
				 * or a core event id `core:event/…@1`, whose candidates are the
				 * bucket a preset or a session binding selects among.
				 */
				namespace Candidates {
					interface Params {
						sessionId: number
						subject: string
					}
					interface Response {
						sessionId: number
						subject: string
						/** Every eligible spec slug. */
						candidates: string[]
						/** What resolution currently lands on, scope included. */
						resolved: string | null
					}
				}
				/**
				 * Bind a subject at session scope (owner) or instance scope
				 * (admin). The event name keeps its word; the field is the
				 * subject (plans/31 V2 retired `function`).
				 */
				namespace BindFunction {
					interface Params {
						sessionId: number
						subject: string
						/** null clears the binding — inherit again. */
						specSlug: string | null
						/** Default 'session'. 'instance' requires admin. */
						scope?: "session" | "instance"
						/**
						 * The session's **enabled-when override** for this
						 * action (plans/29 R-15; U5e): a predicate or a list
						 * of them — `{ on, equals | truthy, reason }` over the
						 * session's published values — that replaces the
						 * action's own and the genre's default while set.
						 * `null` clears it; absent leaves it as it is. Session
						 * scope only, only for an action subject, and only with
						 * a `specSlug` (the override rides the binding row).
						 * Validated with the SDK's findings; a fault is the
						 * `error`.
						 */
						enabledWhen?:
							| Record<string, unknown>
							| Record<string, unknown>[]
							| null
					}
					interface Response {
						sessionId: number
						subject: string
						error?: string
					}
				}
				/**
				 * What one exposed node may be swapped to (PLAN-turn-order
				 * §4.7) — the generic replacement for the next-speaker pair.
				 *
				 * A spec marks a node `expose: { session: true }` (§4.11) and
				 * this answers what that node may become for this session.
				 * The Turn order control is the first caller: the turn-order
				 * spec's `strategy` node, whose options are the genre's
				 * declared list rather than a shape match.
				 */
				namespace NodeSwapOptions {
					interface Params {
						sessionId: number
						/** The spec the node belongs to. */
						spec: string
						nodeKey: string
					}
					interface Response {
						sessionId: number
						spec: string
						nodeKey: string
						options: { definitionId: string; name: string }[]
						/** The session's rebind, or null when it inherits. */
						selected: string | null
						/** The node's own pin — what `selected: null` means. */
						default: string | null
					}
				}
				/** The session form's pipeline cards (PLAN-turn-order §4.11). */
				namespace PipelineCards {
					interface Params {
						sessionId: number
					}
					interface Card {
						spec: string
						specName: string
						nodeKey: string
						options: { definitionId: string; name: string }[]
						/** The session's rebind, or null when it inherits `default`. */
						selected: string | null
						/** The node's own pin. */
						default: string | null
					}
					interface Response {
						sessionId: number
						cards: Card[]
					}
				}
				namespace SetNodeRebind {
					interface Params {
						sessionId: number
						spec: string
						nodeKey: string
						/** A definition from the offered list, or null to inherit. */
						definitionId: string | null
					}
					interface Response {
						sessionId: number
						spec: string
						nodeKey: string
						definitionId?: string | null
						error?: string
					}
				}
			}
			/**
			 * The account-visibility view (design §4): from one participant's
			 * seat, what of *their own* data this session exposes to everyone
			 * else in it. A character/persona/lorebook a person owns becomes
			 * viewable by every other participant — and readable by the
			 * pipelines that build this session's prompts — the moment it is
			 * bound in (mirrors `canViewCharacter`). This is the
			 * inverse of that access check, surfaced so a guest can see the
			 * consequence of their contributions before making them. The seam
			 * plugin events will plug into once account-affecting permissions
			 * exist; it stands on its own transparency value now.
			 */
			namespace AccountVisibility {
				interface Params {
					sessionId: number
				}
				interface ExposedEntity {
					id: number
					name: string
				}
				interface Viewer {
					userId: number
					username: string
					role: "owner" | "guest"
				}
				interface Response {
					sessionId: number
					/** The viewer's own relationship to the session. */
					isOwner: boolean
					isGuest: boolean
					/** Everyone else who can see the exposed entities below. */
					viewers: Viewer[]
					/** The viewer's own data this session exposes, by kind. */
					exposed: {
						characters: ExposedEntity[]
						personas: ExposedEntity[]
						lorebooks: ExposedEntity[]
					}
					error?: string
				}
			}
			/**
			 * Fire a contributed function on a session (19 §4): the generic half
			 * of the trigger surface. `respond` and `narrate` keep their
			 * dedicated events (message lifecycle, streaming, instructions);
			 * everything an extension contributes routes here — the function
			 * resolves to its serving spec (§3) and the spec runs.
			 */
			namespace TriggerFunction {
				interface Params {
					sessionId: number
					/**
					 * Which declaration was pressed — its identity `<spec
					 * slug>#<key>` (U5c review, W1; the one key since plans/31
					 * V2). The server checks THAT action's audience and
					 * enablement and runs THAT spec. The client sends it from
					 * every surface that has a declaration in hand: chips, the
					 * More menu, the palette, a message's menu, a frame's
					 * `invoke`. One of `action` and `key` is required.
					 */
					action?: string
					/**
					 * ⏳ A bare action **key**, for a press that has no
					 * declaration to name: a block stored before identities,
					 * a frame's bare `{ t: 'action', fn }`. The server resolves
					 * it to the genre's sole declarer of that key and refuses
					 * it — naming the identities — when several declare it.
					 * One release.
					 */
					key?: string
					/**
					 * ⚠ No `channel`. Audience is channel-free and the fire
					 * never consults the listing (W2), so a channel on the
					 * press would be accepted and unread — a field that
					 * means nothing is a field somebody will one day trust.
					 * The listing (`sessions:actions`) is where a channel is
					 * asked about.
					 */
					/**
					 * The message a `venue: 'message'` trigger was pressed on
					 * (19 §4). Verified to belong to the session, then rides
					 * the run's input as `messageId` — the id-from-outside
					 * shape 13 §10b types as `row-ids@1`. Absent for composer
					 * (`venue: 'composer'`) triggers, which have no subject.
					 */
					messageId?: number
					/**
					 * A block action's entered values (20 §6) — a form's
					 * fields, a choice's context. Rides the run's input as
					 * `payload`, shaped by the winning spec's input contract.
					 */
					payload?: Record<string, unknown>
					/**
					 * The **form** this press answers (R-15 *Forms*; U5d): the
					 * block's id within `messageId`, as the host stamped it at
					 * the write. Named, the server reads the block off the row
					 * — its function, its identity, its addressee — and holds
					 * the press to the addressee: the person portraying them
					 * may answer, nobody else. A `choices` press carries the
					 * option's key as `payload.choice`. Absent on every press
					 * that is not a form's.
					 */
					blockId?: string
					/**
					 * Names the run, so it can be cancelled and its progress
					 * keyed.
					 *
					 * Supplied by the CLIENT so that Cancel works during the
					 * window between pressing the button and the first progress
					 * event — which is exactly when somebody realises the prompt
					 * was wrong. Server-generated when absent.
					 */
					runId?: string
				}
				interface Response {
					sessionId: number
					/** The identity that was fired, once resolved; the bare `key` it was sent with until then. */
					action: string
					success?: boolean
					error?: string
					/**
					 * The run was stopped on request rather than failing.
					 *
					 * A third outcome beside `success` and `error`, not a
					 * politer error: somebody pressing Cancel is a deliberate
					 * act, and a consumer that has to tell "it broke" from
					 * "they stopped it" — a retry prompt, an activity card, a
					 * receipt view — must not do it by reading the sentence.
					 * The same flat flag `ImagesGenerateResponse` and
					 * `RunProgress` already carry, for the same reason and
					 * with the same meaning.
					 *
					 * ⚠ Set from the run handle's abort, NOT from the
					 * receipt's outcome. A node that throws on abort ends the
					 * run as `err` before the executor next polls its cancel
					 * hook, so the receipt does not always know it was
					 * cancelled; the registry, which recorded the actor before
					 * it aborted, always does. Which is why no `error` rides
					 * along here: the sentence would describe a failure that
					 * the abort caused, and every consumer that checks `error`
					 * first would render the cancel as a failure again.
					 */
					cancelled?: boolean
					/**
					 * Who stopped it: `user:<id>`, `system:superseded` (the
					 * client re-sent the same run id), `system:reset`. The
					 * registry's own vocabulary, and the same value the SDK
					 * stamps on `Receipt.cancelledBy`.
					 *
					 * On the wire whether or not anything renders it, because
					 * these are three different events — a supersede is
					 * bookkeeping nobody asked for, a person's cancel is an
					 * act — and a consumer cannot recover an actor that was
					 * thrown away here.
					 */
					cancelledBy?: string
					/**
					 * A run in the tree this press started is waiting at a
					 * review gate (U5d review, R-b). Alone, the pressed run
					 * itself parked: nothing has landed, the owner has the
					 * card (`pipelines:reviewRequested`), and how it ends
					 * arrives as a later push of this same event — `success`,
					 * `error` or `cancelled` — with its terminal
					 * `pipelines:progress` frame. Beside `success`, the
					 * pressed run finished and a run dispatched under it is
					 * the one waiting. Either way the ack, and the session's
					 * trigger lock, are released now rather than when the
					 * owner decides.
					 */
					parked?: boolean
				}
			}
			/**
			 * The contributed trigger set for a session's mode (19 §4): what
			 * the session view renders beside the intrinsic composer. Presence
			 * is data — retiring the contributing spec removes the button.
			 */
			/**
			 * The session's frame surfaces (20 §12): a mode-declared
			 * session-view that replaces core's log, and any enabled plugin's
			 * declared panels. Frames are opaque-origin sandboxes fed over a
			 * MessageChannel — the src is the plugin-ui route, CSP composed
			 * from the plugin's grants.
			 */
			/**
			 * The pipelines involved in a session (respond + enabled
			 * contributed functions), for grouping the chat's settings by
			 * pipeline. Each is a spec slug the config panel renders at
			 * session scope.
			 */
			namespace Pipelines {
				interface Params {
					sessionId: number
				}
				interface Pipeline {
					slug: string
					label: string
				}
				interface Response {
					sessionId: number
					pipelines: Pipeline[]
					/**
					 * Slots the session's preset binds to something that no
					 * longer answers, so the list above names the genre's
					 * default instead (ruled 2026-09-10).
					 *
					 * On the wire rather than left to the reader to notice:
					 * the list is a list of slugs, and a slug that is not the
					 * one the preset promises is indistinguishable from one
					 * that is unless the substitution is stated.
					 */
					presetFallbacks?: SessionAdmin.StaleBinding[]
				}
			}
			/**
			 * Whether this session is running what its preset says (ruled
			 * 2026-09-10) — the banner's one read.
			 *
			 * Its own verb rather than a field on `sessions:get`: the answer
			 * costs a resolution per bound event, and the session payload is
			 * fetched on every page and every message. Asked once, where the
			 * banner is.
			 */
			namespace PresetStatus {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					/** The preset the session was born on, or null. */
					presetId: number | null
					presetName: string | null
					/** Empty when every bound slot resolves. */
					stale: SessionAdmin.StaleBinding[]
				}
			}
			namespace View {
				interface Frame {
					pluginId: string
					src: string
					title?: string
					/** panels only. */
					panelId?: string
				}
				/**
				 * A mode-declared panel (21) as it crosses the wire — mirrors the
				 * SDK `PanelDecl`, plus a resolved `src` when the surface is a
				 * frame whose plugin is installed (absent → the frame is missing
				 * and the client shows a placeholder, never an error).
				 */
				interface ModePanel {
					id: string
					title: string
					icon?: string
					role?: "primary" | "secondary"
					surface:
						| { kind: "native"; component: string }
						| { kind: "frame"; pluginId: string; entry: string }
						| { kind: "remote"; owner: string; component: string }
					/**
					 * Resolved URL: a frame's document, or a remote component's
					 * module (`/plugin-ui/<owner>/<entry>`, run in the UI worker).
					 */
					src?: string
					/**
					 * The scoped data a remote may read — what it declared
					 * (`WidgetDecl.scopes`) that an admin granted its plugin
					 * (`widget:<scope>`). Absent = none.
					 */
					grants?: Array<"persona" | "characters" | "lore" | "session:full">
					channels?: string[]
					layout?: {
						span?: { ideal?: number; min?: number; max?: number }
						minInline?: number
						minBlock?: number
						collapsible?: boolean
						closable?: boolean
						prefer?: "grid" | "drawer"
					}
					defaultActive?: boolean
					/**
					 * Per-instance settings this panel offers, in the SDK's
					 * `FieldDecl` language (`WidgetDecl.settings`). The settings
					 * panel renders exactly what is declared here; core adds
					 * `title` and `lane` to every widget.
					 */
					settings?: Record<string, unknown>
				}
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					/** Present when the mode declares a custom session view. */
					sessionView?: Frame
					/**
					 * ⏳ Every enabled plugin's `surfaces.panels`, flattened.
					 *
					 * @deprecated A panel IS a widget (SDK `panelToWidgetDecl`)
					 * and the client seats widgets off `modePanels`; nothing
					 * reads this list. Kept one release for anything outside
					 * this repo that does.
					 */
					panels: Frame[]
					/** The mode's declared surface-grid panels (21). */
					modePanels: ModePanel[]
					/**
					 * The widgets this session's genre withholds (R71), by the id
					 * the page knows them by — core's included, so the page drops
					 * them from its own list too. Absent when it omits none.
					 */
					omitWidgets?: string[]
					/**
					 * The viewer's language code (`en`, `fr`, …) — every widget's
					 * envelope `locale.v1`, so a widget renders a locale map in
					 * the language the rest of the page speaks. Absent without
					 * access.
					 */
					language?: string
					/**
					 * The session's channels (20 §7), `main` first.
					 *
					 * `main` is implicit and always present; the rest are what
					 * the genre declares. This is the read side of the fact a
					 * message carries in `channel` — a panel's `channels` says
					 * which lanes it subscribes to, and this says which lanes
					 * there are to subscribe to.
					 */
					channels: string[]
					/**
					 * Why `continue` is unavailable on this session's messages,
					 * or absent when it is available.
					 *
					 * Session-level, and on THIS payload rather than on each
					 * message, because both halves of the answer are: the
					 * genre's declared `messageVerbs`, which this handler
					 * already reads, and the connection the session's replies
					 * resolve to. A per-message field would be the same string
					 * repeated once per row, and a lookup per message would be
					 * a round trip per row.
					 *
					 * The client renders it as the DISABLED Continue button's
					 * title rather than hiding the button: a control that
					 * vanishes teaches nothing, and this sentence names the
					 * switch to change and where it lives. The server refuses
					 * the verb regardless — see `continueVerbRefusal` — so this
					 * is an affordance, never the enforcement, and a stale one
					 * (an admin repointing the default mid-session) costs a
					 * refusal message rather than a wrong generation.
					 */
					continueRefusal?: string
					/**
					 * Which forbiddable message verbs this session's genre
					 * offers (20 §4; R-15, 2026-09-16): the genre-declared
					 * content actions (`retry`, `continue`, `stepBack`) and the
					 * opt-in built-ins (`delete`, `hide`, `swipe`). The floors
					 * — stop, branch, edit — are not here because nothing can
					 * take them away: a control for one is always present.
					 * Absent (no access, or an older server) reads as all on.
					 *
					 * An affordance, like `continueRefusal`: a forbidden
					 * built-in's control is ABSENT client-side, and the
					 * handler refuses the verb regardless.
					 */
					messageVerbs?: {
						retry: boolean
						continue: boolean
						stepBack: boolean
						delete: boolean
						hide: boolean
						swipe: boolean
					}
					/**
					 * What this session may write beyond messages (R-B,
					 * 2026-09-17): whether its own machinery may add lore
					 * entries to the attached lorebook, and whether it may
					 * open scenes. Absent (no access, or an older server)
					 * reads as both on — the standard chat's posture.
					 *
					 * An affordance, like `messageVerbs`: a forbidden write's
					 * control is ABSENT client-side, and the write sites
					 * refuse regardless — the summarize handler, the scene
					 * create handler and the lore-entry outlet each read the
					 * same declaration.
					 */
					writes?: {
						lore: boolean
						scenes: boolean
					}
					/**
					 * The envoys this session may seat or hear from (plans/29
					 * R-18; U5g): every one its genre and its installed actions
					 * declare, display text resolved for the viewer's
					 * language, with whether it is seated. The client renders
					 * an envoy's message — a row carrying `metadata.speaker =
					 * envoy:<slug>` and no `characterId` — from this list, and
					 * the Edit Session form offers the genre's for seating.
					 * Absent on an older server.
					 */
					envoys?: Envoy[]
				}
				/** One envoy as the client sees it — see `Response.envoys`. */
				interface Envoy {
					/** The address: `envoy:<slug>` names it. */
					slug: string
					/** Genre-declared, or brought by a contributed action. */
					origin: "genre" | "action"
					name: string
					description?: string
					/** A URL or data: URI — rendered as an image source. */
					image?: string
					/** `in-turn` may be picked to reply; `on-action` only posts through its action. */
					speaks: "in-turn" | "on-action"
					/** Seated by the genre with no choice. */
					default: boolean
					/** A live cast row exists for it. */
					seated: boolean
				}
			}
			/**
			 * Seat or unseat one of the genre's envoys (R-18; U5g) — the Edit
			 * Session form's toggle. Owner only. An action's envoy is seated
			 * by its action's post and has no toggle.
			 */
			namespace SetEnvoySeat {
				interface Params {
					sessionId: number
					slug: string
					seated: boolean
				}
				interface Response {
					sessionId: number
					slug: string
					seated: boolean
					error?: string
				}
			}
			/**
			 * The per-user surface-grid layout row (21 §10). Activation +
			 * placement only; availability is `View.modePanels`. The `layout`
			 * blob's shape is owned by the client surface manager and stored
			 * verbatim — the server never interprets it.
			 */
			/**
			 * A server→client surface intent (21 §9): a node/action asked to
			 * open or close panels in the caller's grid. A *proposal* — the
			 * client's per-user layout decides — carried out of band from the
			 * message stream for the general case (the common case rides the
			 * message's own channel, no event needed). Panels named here are
			 * declared panel ids; unknown ids are ignored.
			 */
			namespace SurfaceIntent {
				interface Push {
					sessionId: number
					open?: string[]
					close?: string[]
				}
			}
			/**
			 * One saved layout preset (PLAN 25 redesign, 2026-08-30) — a
			 * reusable layout DEFINITION scoped to a genre. The rows a caller
			 * is offered are the shipped per-genre defaults plus their OWN
			 * saved layouts; another user's presets are never listed.
			 */
			interface LayoutPreset {
				id: number
				name: string
				genreId: string
				/**
				 * `true` for the shipped per-genre default (author-less,
				 * seeded). Its layout is `{}` — "no overrides", i.e. the app's
				 * built-in arrangement — so applying it is the reset.
				 */
				isDefault: boolean
				/** `{ zoneLayout?, widgetGrid?, arrangedGrid? }`, verbatim. */
				layout: Record<string, unknown>
			}
			namespace PanelLayout {
				namespace Get {
					interface Params {
						sessionId: number
					}
					interface Response {
						sessionId: number
						/** `{}` when the user has no saved layout yet. */
						layout: Record<string, unknown>
						/**
						 * The preset this user has applied, or `null` for the
						 * genre default. A reference — never the definition.
						 */
						layoutPresetId: number | null
						/**
						 * This user's own per-widget settings, keyed by widget
						 * id. Stored verbatim; merged OVER the preset, under
						 * `layout`.
						 */
						layoutSettings: Record<string, unknown>
						/**
						 * This user's per-INSTANCE widget settings for this
						 * session, keyed by widget id: the deviations from each
						 * widget's declared defaults, never the defaults
						 * themselves. `{}` when nothing is overridden.
						 */
						widgetSettings: Record<string, Record<string, unknown>>
						/**
						 * The ALREADY-RESOLVED layout of the active preset —
						 * `layoutPresetId`'s row if it still resolves, else the
						 * genre default, else `{}`. Resolving server-side keeps
						 * the fallback chain in one place.
						 */
						presetLayout: Record<string, unknown>
						/** What the Presets tab lists: default + this user's. */
						presets: LayoutPreset[]
					}
				}
				namespace Set {
					interface Params {
						sessionId: number
						layout: Record<string, unknown>
						/**
						 * OPTIONAL, and absence is meaningful: a key that is
						 * not present leaves the stored column alone, so the
						 * surface manager's debounced blob save — which knows
						 * only `layout` — can never clobber the user's preset
						 * choice or their widget settings. `null` explicitly
						 * clears the selection back to the genre default.
						 */
						layoutPresetId?: number | null
						layoutSettings?: Record<string, unknown>
						/**
						 * The caller's per-instance widget settings, keyed by
						 * widget id, replacing what they have for this session.
						 * Absent leaves them alone, on the same rule as the two
						 * keys above. A widget mapped to an empty object is
						 * stored as nothing: settings are deviations, and an
						 * empty deviation set is not one.
						 */
						widgetSettings?: Record<string, Record<string, unknown>>
					}
					interface Response {
						sessionId: number
						ok: boolean
						error?: string
					}
				}
				/**
				 * Save the caller's current arrangement as a NEW user-authored
				 * preset for this session's genre. Never writes a seeded row:
				 * `authorUserId` is always the caller and `seedKey` always
				 * NULL, so the boot reconciler can never see, re-force, or
				 * prune what a user saved here.
				 */
				namespace Save {
					interface Params {
						sessionId: number
						name: string
						layout: Record<string, unknown>
					}
					interface Response {
						sessionId: number
						ok: boolean
						error?: string
						/** The row just written. */
						preset?: LayoutPreset
						/** The refreshed list, so the tab needs no re-fetch. */
						presets: LayoutPreset[]
					}
				}
				/**
				 * Rename one of the CALLER'S OWN presets. Managing a preset is a
				 * narrower permission than seeing one: the list mixes the shipped
				 * defaults with your saves, but only what you authored is yours to
				 * rename — and admins are deliberately not a superset, because a
				 * person's saved layouts are their own business.
				 */
				namespace Rename {
					interface Params {
						id: number
						/** Trimmed and capped server-side; must not be blank. */
						name: string
					}
					interface Response {
						/** Echoed back so a client can match the reply to its ask. */
						id: number
						ok: boolean
						error?: string
						/**
						 * The genre `presets` belongs to. Present only on success —
						 * a refusal must not say which genre an id lives in. A client
						 * on another genre ignores the list rather than adopting it.
						 */
						genreId?: string
						/** The row as it now reads. */
						preset?: LayoutPreset
						/** The refreshed list, so the tab needs no re-fetch. */
						presets: LayoutPreset[]
					}
				}
				/**
				 * Delete one of the caller's own presets. Nothing is stranded: the
				 * `layout_preset_id` FK is `ON DELETE SET NULL`, so every session
				 * that was on it silently falls back to the genre default. That is
				 * the intended behaviour, which is exactly why the count comes back
				 * — ask `Usage` first and warn before, not after.
				 */
				namespace Delete {
					interface Params {
						id: number
					}
					interface Response {
						id: number
						ok: boolean
						error?: string
						/** See `Rename.Response.genreId`. */
						genreId?: string
						/**
						 * How many sessions were on it, counted BEFORE the delete —
						 * afterwards the FK has already nulled the evidence. `0` on a
						 * refusal.
						 */
						affectedSessions: number
						/** The refreshed list, so the tab needs no re-fetch. */
						presets: LayoutPreset[]
					}
				}
				/**
				 * How many sessions are on one of the caller's own presets — what
				 * the delete confirmation warns with, asked before the delete
				 * rather than reported after it.
				 */
				namespace Usage {
					interface Params {
						id: number
					}
					interface Response {
						id: number
						ok: boolean
						error?: string
						/** Sessions currently pinned to it; `0` on a refusal. */
						sessions: number
					}
				}
			}
			/**
			 * @deprecated One release (plans/30 U5c, 2026-09-16). The
			 * contributed actions at the composer and message venues in the
			 * pre-U5c shape; `sessions:actions` is the projection — every
			 * venue, primary set and overflow, audience and slash name.
			 */
			namespace Triggers {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					triggers: {
						/** The action's key; with `specSlug`, its identity. */
						key: string
						/** `composer` | `message` — where a person meets it (R-15). */
						venue: string
						icon?: string
						name: string
						specSlug: string
					}[]
				}
			}
			/**
			 * A session's actions per **venue** and channel, for the caller
			 * (plans/29 R-15; plans/30 U5c). Every venue is a primary set plus
			 * an overflow that lists every enabled action (F38); the composer's
			 * and extra tab's entries carry the slash name the `/` palette
			 * calls them by; a newly installed action arrives `isNew` until the
			 * caller reports having seen it (`sessions:actionsSeen`).
			 *
			 * Core's message verbs are listed like any other action, under
			 * `specSlug: "core"`, so the client renders ONE list and hand-writes
			 * no verb button. An `itemGated` entry names `item` in its
			 * audience: whether the caller may act is decided per message, on
			 * the client by `canControlMessage` and on the server at the verb.
			 */
			namespace Actions {
				interface Params {
					sessionId: number
					/** Default `main`. */
					channel?: string
				}
				interface Action {
					/** With `specSlug`, the action's identity `<spec slug>#<key>` — the one key (plans/31 V2). */
					key: string
					specSlug: string
					name: string
					description?: string
					icon?: string
					slash: string
					quick: boolean
					audience: { see: string[]; act: string[] }
					venue: string
					channel?: string
					origin: "core" | "companion" | "attachment"
					floor: boolean
					canAct: boolean
					itemGated: boolean
					isNew: boolean
					/**
					 * The enabled-when verdict (plans/29 R-15; U5e) — the
					 * second verdict beside `canAct`, both shown, neither
					 * hiding the action: every predicate the server could
					 * evaluate over the session's published values holds.
					 * The `item.*` ones are not among them.
					 */
					enabled: boolean
					/**
					 * Why it is grey when `enabled` is false — the failing
					 * predicate's reason, a locale map with `{vars}` the
					 * client resolves with `statusText()`.
					 */
					reason?: {
						i18n: { en: string } & Record<string, string>
						vars?: Record<string, string | number>
					}
					/**
					 * The predicates over `item.*` — the message the action is
					 * pressed on — which the client evaluates per row with the
					 * SDK's `evaluateEnabledWhen` and the row's `item` document
					 * (`shared/actions/itemValues.ts`). Message venue only;
					 * absent when there are none.
					 */
					itemPredicates?: {
						on: string
						equals?: unknown
						truthy?: boolean
						reason: { en: string } & Record<string, string>
					}[]
				}
				interface Venue {
					primary: Action[]
					overflow: Action[]
				}
				interface Response {
					sessionId: number
					channel: string
					/**
					 * Keyed by venue kind; every listed kind present, possibly
					 * empty. `form` is never among them (U5d review, S1): an
					 * action a form carries is pressed from the block alone.
					 */
					venues: Record<string, Venue>
				}
			}
			/** The caller has met these actions — clears their *new* mark. */
			namespace ActionsSeen {
				interface Params {
					sessionId: number
					/** `<spec slug>#<action key>`, as `Actions.Action` identifies them. */
					keys: string[]
				}
				interface Response {
					sessionId: number
					/** How many were newly recorded. */
					seen: number
				}
			}
			/**
			 * The presets a session may run on, and the one it is on (19 §7).
			 *
			 * A *preset* is a pipeline configuration a person is allowed to
			 * see and use — the presets a non-admin is offered are the enabled
			 * ones. Admins additionally see the disabled, marked, because a
			 * preset an admin just switched off vanishing entirely would read
			 * as deleted.
			 */
			namespace PresetOptions {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					/** The pipeline whose presets these are. Null when none serves. */
					specSlug: string | null
					selectedId: number | null
					options: {
						configId: number
						name: string
						isDefault: boolean
						enabled: boolean
						readOnly: boolean
					}[]
				}
			}
			/** Put this session on a preset. */
			namespace ChoosePreset {
				interface Params {
					sessionId: number
					configId: number
				}
				interface Response {
					sessionId: number
					configId?: number
					error?: string
				}
			}
			/**
			 * The mode's functions and each one's state on this session (19 §3).
			 *
			 * Everything the mode was offered, not only what is in force —
			 * the control surface has to show what can be turned *on*, which
			 * is exactly the set a plain trigger list leaves out.
			 */
			namespace Functions {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					/** The mode the answers are stored against. */
					genreId: string
					/**
					 * Whether this viewer may switch on an action the preset
					 * leaves out. Sent rather than inferred client-side: the
					 * server decides the permission, and a UI that decided it
					 * separately would be a second answer to the same question.
					 */
					canAddOutsidePreset?: boolean
					functions: {
						/** With `specSlug`, the action's identity `<spec slug>#<key>` — the one key (plans/31 V2). */
						key: string
						/** Where it appears, per channel (R-15). */
						venues: { kind: string; channel?: string }[]
						quick: boolean
						slash: string
						icon?: string
						name: string
						specSlug: string
						/** Namespace-decided: the mode owner's, or someone else's. */
						origin: "companion" | "attachment"
						enabledByDefault: boolean
						enabled: boolean
						/** A session row states this, rather than a lower layer. */
						explicit: boolean
						/** The session's preset includes it — the permission line. */
						included: boolean
						/** Which layer decided. */
						source: "session" | "preset" | "default"
					}[]
					error?: string
				}
			}
			/** Turn one of the mode's functions on or off for this session. */
			namespace SetFunction {
				interface Params {
					sessionId: number
					/**
					 * Which declaration — its identity `<spec slug>#<key>`
					 * (U5c review, W1; the one key since plans/31 V2):
					 * enablement is per action. A bare key names the action
					 * when exactly one carries it; several is refused with
					 * their identities.
					 */
					action: string
					enabled: boolean
				}
				interface Response {
					sessionId: number
					action: string
					enabled?: boolean
					error?: string
				}
			}
			namespace Genres {
				interface Params {}
				interface Response {
					genres: {
						genreId: string
						name: string
						/** The picker card's subtitle; empty when undeclared. */
						description: string
						// Structurally mirrors SessionShape from @serene-pub/sdk,
						// stated inline so the shared socket contract does not
						// couple to the SDK package.
						shape: {
							characters?: { min: number; max?: number }
							personas?: { min: number; max?: number }
							lorebook?: "optional" | "required"
							composer?: "text" | "none"
							voice?: "character" | "narrator"
							/** SettingsSchema — the one field language. */
							fields?: Record<string, any>
						}
					}[]
				}
			}
			namespace Update {
				interface Params {
					session: UpdateSession
					characterIds?: number[]
					personaIds?: number[]
					characterPositions?: Record<number, number>
					tags?: string[]
				}
				interface Response {
					session: SelectSession
				}
			}
			namespace AddPersona {
				interface Params {
					sessionId: number
					personaId: number
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace AddGuest {
				interface Params {
					sessionId: number
					guestUserId: number
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			namespace RemoveGuest {
				interface Params {
					sessionId: number
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
			/**
			 * The session's turn order, pushed (PLAN-turn-order §4.7).
			 *
			 * Server → client, interest-gated like `sessions:view`: on every
			 * `turn-order-changed`, and beside `sessions:view` so a client
			 * that has just joined renders the same state as one that was
			 * already there. There is no request form — page load is not an
			 * event (§3), and the UI renders state rather than asking for a
			 * decision.
			 *
			 * ⏳ Replaces `sessions:getResponseOrder`, which asked the server
			 * to *preview* a decision a run would make. There is no decision
			 * to preview any more: the order is written down.
			 */
			/**
			 * The asker's view of the session annex (R57): per owner, the
			 * values whose audience holds for them. Requested on open and
			 * pushed to each member, their own, when the annex changes.
			 */
			namespace Annex {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					annex: Record<string, Record<string, unknown>>
					error?: string
				}
			}
			/**
			 * A package's event, recorded in this session (R56, E1d): pushed
			 * to everyone watching the session, and forwarded to its widgets
			 * as `event:recorded`. Core's own events never ride this push.
			 */
			namespace RecordedEvent {
				interface Push {
					sessionId: number
					event: string
					payload: unknown
					at: number
				}
			}
			namespace TurnOrder {
				interface Push {
					sessionId: number
					/** `TurnOrderV1` — the document as written. */
					turnOrder: unknown
				}
			}
			/**
			 * Take a prepared turn (§4.7) — Continue, and the picker.
			 *
			 * `entry` absent is the stored head. An entry given is a pick,
			 * and must be one of the prepared turns: firing is over the
			 * order, never over the cast.
			 */
			namespace FireTurn {
				interface Params {
					sessionId: number
					/** A `TurnEntryV1` from the order. Absent = the head. */
					entry?: {
						ref: string | null
						channel?: string
						subject?: string
						via?: string
					}
				}
				interface Response {
					sessionId: number
					ok: boolean
					runId?: string
					/**
					 * Why it did not fire, when it did not — `person` for
					 * somebody's own turn, which is not an error and carries
					 * no `error` string.
					 */
					reason?: string
					error?: string
				}
			}
			namespace ToggleSessionCharacterActive {
				interface Params {
					sessionId: number
					characterId: number
				}
				interface Response {
					sessionId: number
					characterId: number
					isActive: boolean
					error?: string
				}
			}
			namespace UpdateSessionCharacterVisibility {
				interface Params {
					sessionId: number
					characterId: number
					visibility: string
				}
				interface Response {
					sessionId: number
					characterId: number
					visibility: string
					error?: string
				}
			}
			namespace PromptTokenCount {
				interface Params {
					sessionId: number
					content?: string
					role?: string
					personaId?: number
				}
				interface Response {
					prompt?: string
					messages?: any[]
					// promptTokenCountHandler returns just `{ error }` (no meta) on
					// every early-exit path (access denied, session not found, no
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
						sessionMessages: {
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
						 * ⚠ `rag` was declared below this and is gone. It counted the
						 * legacy infill engine's internal phases — a guaranteed window, a
						 * RAG pass, a fill pass — which the pipeline does not have, and it
						 * carried a per-entry `score` naming `sceneAffinity`, `recency`
						 * and `density`: signals the ranking engine no longer computes
						 * (see `pipelines/ranking/weights.ts`). Nothing ever wrote it.
						 * The handler answers with `toCompiledPrompt`, and
						 * `CompiledPrompt.meta` dropped `rag` with the engines, so the
						 * field was unreachable as well as unread — and a contract naming
						 * culled signals is how the next implementer resurrects them.
						 *
						 * This is what the pipeline does record: it scores candidates,
						 * allocates a budget, and reports per block why it is in or out.
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
					}
				}
			}
			namespace TriggerGenerateMessage {
				interface Params {
					sessionId: number
					characterId?: number
					/**
					 * An explicit speaker that no id can name — a seated envoy,
					 * as `envoy:<slug>` (R-18; U5g). Ignored when `characterId`
					 * is given.
					 */
					speaker?: string
					once?: boolean
					triggered?: boolean
					/**
					 * Which channel this turn is asked for on (R-C) — passed
					 * straight to `runReply`, where it reaches the inlet's
					 * `channel` port and the host scope. `main` when absent.
					 */
					channel?: string
				}
				interface Response {
					success?: boolean
					error?: string
					/**
					 * The loop ended because nobody was due — the cast has all
					 * spoken since the person did, or the session's strategy
					 * waits to be told. Not an error; nothing was generated.
					 */
					nobodyDue?: boolean
				}
			}
			namespace TriggerNarratorResponse {
				interface Params {
					sessionId: number
					/** Optional extra focus text for this specific generation. */
					instructions?: string
					/**
					 * Who speaks, when this is a **side-character** turn rather
					 * than world narration (ruling 2026-09-07).
					 *
					 * The trigger's first step accepts either — a character
					 * from the dropdown, or a name somebody typed, or both
					 * (a character announced under a scene-specific name).
					 * Absent entirely, the request is world narration and the
					 * narrator speaks, exactly as before.
					 *
					 * ⚠ **participant ≠ character.** Sending this never adds
					 * anybody to the session's cast and never affects the
					 * rotation; it names a voice for one turn.
					 */
					speaker?: {
						characterId?: number | null
						name?: string | null
					}
				}
				interface Response {
					success?: boolean
					error?: string
				}
			}
			/**
			 * Who a side-character turn may be spoken by (ruling 2026-09-07):
			 * this person's characters, minus the session's cast — a cast
			 * member has a turn of their own. The free-form name needs no
			 * list, which is the point of offering both.
			 */
			namespace SideCharacterOptions {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					characters: Array<{
						id: number
						name: string
						nickname: string | null
					}>
					error?: string
				}
			}
			namespace GetNarratorName {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					narratorName: string
				}
			}
			namespace Branch {
				interface Params {
					sessionId: number
					messageId: number
					title: string
				}
				interface Response {
					session?: SelectSession
					error?: string
				}
			}
			/**
			 * Re-points a removed (soft-deleted) session participant's message
			 * history to a new character/persona, and makes the new one an
			 * active participant. See sessionsReassignRemovedParticipantHandler
			 * in sessions.ts.
			 */
			namespace ReassignRemovedParticipant {
				interface Params {
					sessionId: number
					type: "character" | "persona"
					oldId: number
					newId: number
				}
				interface Response {
					success?: boolean
					session?: SelectSession
					error?: string
				}
			}
			namespace SetLorebook {
				interface Params {
					sessionId: number
					lorebookId: number | null
				}
				interface Response {
					session: SelectSession
				}
			}
			namespace Summarize {
				interface Params {
					sessionId: number
					messageIds: number[] | "all"
					loreType: "world" | "history" | "character" | "scene"
					topic?: string
					/** Character to bind the lore entry to (character lore only) */
					lorebookBindingCharacterId?: number | null
				}
				interface Progress {
					phase: "drafting" | "synthesizing" | "naming" | "extracting"
					batch: number
					totalBatches: number
					partial: {
						content?: string
						raw?: string
					}
					/**
					 * What the run says it is doing (R-19) — *summarising part
					 * 2 of 5*, *merging the drafts* — a locale map the client
					 * resolves; shown in place of the phase's own label when
					 * present.
					 */
					status?: import("@serene-pub/sdk").StatusText
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

		// Session Messages namespace
		namespace SessionMessages {
			namespace Get {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionMessages: SelectSessionMessage[]
				}
			}
			namespace SendPersonaMessage {
				interface Params {
					sessionId: number
					content: string
					personaId?: number | null
					/**
					 * Which of the session's channels this line is written on
					 * (20 §7; R-C) — the composer's pick, `main` when absent,
					 * which is every session whose genre declares no channel of
					 * its own. A channel the genre never declared is refused at
					 * the handler, never coerced.
					 */
					channel?: string
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			namespace SendCharacterMessage {
				interface Params {
					sessionId: number
					characterId?: number
					once?: boolean
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
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
					sessionMessage?: SelectSessionMessage
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
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			namespace Continue {
				interface Params {
					id: number
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			/**
			 * A person's pick of a line's sprite (DESIGN-sprites §6) — the
			 * message menu's **Change sprite**. `sprite: null` clears it.
			 * Runs `core:spec/show-sprite`: receipted, emits `sprite-shown`,
			 * and a picker never overwrites it afterwards.
			 */
			namespace SetSprite {
				interface Params {
					id: number
					sprite: { set: string; label: string } | null
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			namespace SwipeLeft {
				interface Params {
					id: number
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			namespace SwipeRight {
				interface Params {
					id: number
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			namespace TogglePin {
				interface Params {
					id: number
				}
				interface Response {
					sessionMessage?: SelectSessionMessage
					error?: string
				}
			}
			namespace Cancel {
				interface Params {
					sessionId: number
					/** The specific message the Stop button was clicked on. Optional
					 * for backwards compatibility — omitting it falls back to
					 * cancelling every generating message in the session. */
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
					sessionId: number
				}
				interface Response {
					success?: string
					error?: string
				}
			}
		}

		// Lorebooks namespace
		namespace Lorebooks {
			/** A lorebook row as the wire carries it. */
			type WireLorebook = SelectLorebook
			namespace List {
				interface Params {}
				interface Response {
					lorebookList: Partial<WireLorebook>[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					lorebook: (WireLorebook & { tags: string[] }) | null
					/**
					 * Every entry of the book, of every type, in one list —
					 * `typeId` is what splits them, and nothing at this end
					 * needs them split. The three lists this replaces were the
					 * three tables' names on the wire.
					 */
					entries: LorebookEntry[]
					/**
					 * The id that was asked for, present so the interest scope
					 * can be derived.
					 *
					 * ⚠ Only the NOT-FOUND reply needs it: a found one is scoped
					 * by `lorebook.id`, and there is no lorebook to read an id off
					 * when the answer is null. Without it that reply could only
					 * reach a BARE `lorebooks:get` key — which matches every other
					 * book's reply too. Same treatment as `sessions:get`.
					 */
					lorebookId?: number
				}
			}
			namespace Create {
				interface Params {
					name: string
				}
				interface Response {
					lorebook: WireLorebook
				}
			}
			namespace Update {
				interface Params {
					lorebook: UpdateLorebook
				}
				interface Response {
					lorebook: WireLorebook
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
			namespace Duplicate {
				interface Params {
					lorebookId: number
					/** Defaults to `<name> (copy)`. */
					name?: string
				}
				interface Response {
					lorebook: WireLorebook
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
					lorebook: WireLorebook | null
					conflict?: {
						existingLorebook: WireLorebook
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
					lorebook: WireLorebook
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
						persona?: SelectCharacter | null
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
					/**
					 * The book already held this character or persona, so the
					 * row above is the one it already had, not a new one. Only
					 * ever true for a bound row: a background row has no entity
					 * to resolve through and is always created.
					 */
					existing: boolean
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

		/**
		 * Binding suggestions — names the story used that resolve to nothing.
		 *
		 * The candidates are **derived** on every `list` from the open tier of
		 * `entry_annotations` / `message_annotations`; the *status* is stored,
		 * because what a human said about a candidate is not in the text (plan
		 * §1). Every payload names its lorebook or a row that belongs to one, and
		 * the server checks ownership on each — a suggestion quotes a line of the
		 * owner's transcript.
		 */
		namespace BindingSuggestions {
			/** One row: the derived evidence and the stored decision, side by side. */
			interface Suggestion {
				id: number
				lorebookId: number
				/** `open:<normalized>` — the annotation key, verbatim. */
				entityKey: string
				/** The key without its tier prefix. */
				name: string
				/** The fullest surface form any source used — what to display. */
				surface: string
				status: "pending" | "ignored" | "added"
				/** Total mentions across every source that named it. */
				occurrences: number
				/** How many distinct entries/messages named it. */
				sourceCount: number
				/** ISO. The earliest and latest SOURCE timestamps, not scan times. */
				firstSeenAt: string
				lastSeenAt: string
				/** One line of the passage that named it, so a decision needs no hunting. */
				exampleContext: string
				/** `entry` | `message` | `''`. Provenance for the line above. */
				exampleSourceKind: string
				exampleSourceId: number | null
				/** What `add` created; null until then, and again if it is deleted. */
				resolvedBindingId: number | null
				/** ISO. When a human moved it off `pending`. */
				decidedAt: string | null
				/**
				 * ⚠ Whether the latest scan still derives it.
				 *
				 * A decision outlives its evidence — the passage was edited, or
				 * the vocabulary widened until the name resolves. The log keeps
				 * the row; this is what stops the UI claiming the story still
				 * says it.
				 */
				stillPresent: boolean
			}

			/** How much of the book the background annotation lane has walked. */
			interface Coverage {
				entries: { annotated: number; total: number }
				messages: { annotated: number; total: number }
			}

			/**
			 * The response every one of these handlers answers with.
			 *
			 * ⚠ `scanned` is not decoration. Annotation runs in the background,
			 * so an empty `suggestions` has two meanings — *"nothing to add"* and
			 * *"not looked yet"* — and only one of them is safe to render as an
			 * empty list. `outstanding` says how many sources the lane still
			 * owes, which is the partial case between them.
			 */
			interface ListResult {
				lorebookId: number
				suggestions: Suggestion[]
				/** False when no source of either kind carries a fresh annotation. */
				scanned: boolean
				/** Sources that exist but have no fresh annotation yet. */
				outstanding: number
				coverage: Coverage
			}
			namespace List {
				interface Params {
					lorebookId: number
				}
				type Response = ListResult
			}
			namespace Ignore {
				interface Params {
					id: number
				}
				interface Response extends ListResult {
					/** Echoed, so a late answer is not attributed to another row. */
					ignoredId: number
				}
			}
			namespace Unignore {
				interface Params {
					id: number
				}
				interface Response extends ListResult {
					restoredId: number
				}
			}
			namespace Add {
				interface Params {
					id: number
					/**
					 * An override of the suggestion's surface form.
					 *
					 * Optional: the normalised open-tier key is lowercased, so
					 * capitalising a name before accepting is the ordinary case.
					 * Trimmed, capped and never allowed to be empty server-side;
					 * everything else about the created row is server-derived.
					 */
					name?: string
				}
				interface Response extends ListResult {
					addedId: number
					lorebookBinding: SelectLorebookBinding
				}
			}
		}

		/**
		 * Lorebook entries — one namespace, every declared type.
		 *
		 * `WorldLoreEntries`, `CharacterLoreEntries` and `HistoryEntries` were
		 * three copies of this with three row shapes; `typeId` carries what the
		 * three namespaces used to carry, and `LorebookEntry<T>` is the one shape,
		 * branded by it. **Every payload names its type**, because that is what
		 * scopes the read or the write: a world lore id presented to a history
		 * update finds no row rather than being edited through the wrong shape.
		 */
		namespace Entries {
			namespace List {
				interface Params {
					lorebookId: number
					typeId: EntryTypeId
				}
				interface Response {
					lorebookId: number
					typeId: EntryTypeId
					entryList: LorebookEntry[]
				}
			}
			namespace Create {
				interface Params {
					entry: NewLorebookEntry
				}
				interface Response {
					entry: LorebookEntry
				}
			}
			namespace Update {
				interface Params {
					entry: LorebookEntryPatch
				}
				interface Response {
					entry: LorebookEntry
				}
			}
			namespace Delete {
				interface Params {
					id: number
					typeId: EntryTypeId
				}
				interface Response {
					success?: string
					error?: string
					/**
					 * The book the deleted entry was in, present so the interest
					 * scope can be derived — `{ success }` alone named neither the
					 * row nor its book, so this push could only ever reach a bare
					 * key.
					 */
					lorebookId: number
					/**
					 * The row that went, present so a workspace can tell whose
					 * delete it was without re-reading the list.
					 */
					entryId: number
				}
			}
			namespace UpdatePositions {
				interface Params {
					lorebookId: number
					typeId: EntryTypeId
					positions: Array<{ id: number; position: number }>
				}
				interface Response {
					success?: string
					error?: string
				}
			}
			/**
			 * How much of each kind the book holds — the navigation column's
			 * figures, in one query.
			 *
			 * Keyed by the **pool kind**: a declared type id, plus `scene` and
			 * `cast` for the two doors whose rows are not entries, and `places`
			 * for the entries that are on the map. A kind the book has none of
			 * comes back as 0 rather than absent, so a count that has not
			 * arrived stays distinguishable from a count of none.
			 *
			 * ⚠ `places` overlaps every other key rather than partitioning
			 * with them: an entry is a place because of its **edges** — one
			 * whose other end is an entry, or one typed with a way of getting
			 * there — so a world lore row can be counted twice, once as its
			 * type and once as a place. Summing the values is not the size of
			 * the book.
			 */
			namespace Counts {
				interface Params {
					lorebookId: number
					/**
					 * The line being read. Absent = main.
					 *
					 * ⚠ A count is of what the reader can SEE. Counting every
					 * row would put a fork's entries in main's figures, where
					 * the list beside them shows nothing of the kind.
					 */
					branchId?: number | null
				}
				interface Response {
					lorebookId: number
					counts: Record<string, number>
				}
			}
			/**
			 * What the newest run of one conversation decided about this
			 * book's entries — the retrieval markers on the list rows.
			 *
			 * ⚠ **Two states, and an absent entry is the third.** `fired` went
			 * into the prompt and `considered` was weighed and left out; an
			 * entry no mechanism reported on is missing from the map, which is
			 * a different fact from either and must not be drawn as a weaker
			 * `considered`.
			 */
			namespace RecentDecisions {
				interface Params {
					lorebookId: number
					/** The conversation whose newest run is being read. */
					sessionId: number
				}
				interface Response {
					/**
					 * Each entry's figures in that turn, off the ranking store
					 * (L1, R58) — what the Read-in line says for the book's
					 * owner without a receipt: rank among the entries judged,
					 * tokens, the key that matched, the budget.
					 */
					facts?: Record<
						number,
						{
							rank?: number
							of?: number
							tokens?: number
							matched?: string
							budget?: number
						}
					>
					lorebookId: number
					sessionId: number
					/** Which run answered, absent when none had a ranking. */
					runId?: string
					decisions: Record<number, "fired" | "considered">
					/**
					 * What the same run did with the narrative graph — the ceiling
					 * line's figures.
					 *
					 * ⚠ **The run's, not one member's.** The relationship mechanism
					 * walks the speaker's whole graph under one ceiling, so these say
					 * how many ties reached the prompt out of how many it walked —
					 * never how many of *this* member's did.
					 *
					 * ⚠ **Absent is the common answer.** Only the ranked mechanism
					 * (`core:query/relationship-search@1`) records figures; the two
					 * sibling nodes publish keyed sections and no diagnostics at all,
					 * so a pipeline built on those reports nothing here and the line
					 * stays absent rather than inventing a denominator.
					 */
					relationships?: {
						/** Ties that reached the prompt. */
						sent: number
						/** Ties the mechanism walked, the link hop's included. */
						considered: number
						/**
						 * The ceiling the node was given. Absent when it declared none,
						 * which is not the same as a ceiling of 0 — that one means the
						 * graph is left out altogether.
						 */
						cap?: number
						/**
						 * The tie type that filled the ceiling, where one plainly did.
						 *
						 * Said only when the cap actually bit and every tie that got
						 * through carries the one type: the receipt keeps what was sent
						 * and not what was cut, so naming a type on a mixed list would
						 * be a guess at which of them lost.
						 */
						cappedType?: string
					}
				}
			}
			/** Only a type declaring an `order` role answers this. */
			namespace IterateNext {
				interface Params {
					id: number
					typeId: EntryTypeId
				}
				interface Response {
					entry: LorebookEntry
				}
			}
			/**
			 * "Would this entry fire?" — asked from the editor, answered by a
			 * real turn.
			 *
			 * An entry does not fire in the abstract, so the question names a
			 * conversation. The answer is the **same row** the run receipt's
			 * retrieval panel renders (`Pipelines.RetrievalRow`) rather than a
			 * second vocabulary for the same decision: one shape, two readers.
			 */
			/** An entry's Off and Pin marks, and nothing else (L1). Owner or admin. */
			/** The entry-management widget's read (L1, R58): the session's book, with this session's rankings. */
			namespace SessionEntries {
				interface Params {
					sessionId: number
					query?: string
					sort?: "name" | "lastRead" | "timesRead" | "rank"
					filter?: "all" | "fired" | "pinned" | "off"
					offset?: number
					limit?: number
					/** Echoed on the answer, so a panel can drop replies to superseded asks. */
					request?: string
				}
				interface Row {
					id: number
					typeId: string
					title: string
					keys: string[]
					off: boolean
					pinned: boolean
					timesJudged: number
					timesIncluded: number
					lastJudgedAt: string | null
					lastIncluded: boolean | null
					lastReason: string | null
					lastRank: number | null
				}
				interface Response {
					sessionId: number
					lorebookId?: number | null
					bookName?: string
					/** The reader is not the book's owner: nothing is shown but whose it is. */
					ownerOnly?: boolean
					rows: Row[]
					total: number
					/** The page actually served — pulled back when the asked one ran past the end. */
					offset?: number
					request?: string
					error?: string
				}
			}
			namespace SetMarks {
				interface Params {
					entryId: number
					off?: boolean
					pinned?: boolean
				}
				interface Response {
					entryId: number
					off?: boolean
					pinned?: boolean
					error?: string
				}
			}
			namespace TestRetrieval {
				interface Params {
					id: number
					typeId: EntryTypeId
					/** Which conversation to test against. */
					sessionId: number
				}
				interface Response {
					/** Echoed, so a late answer is not shown under another entry. */
					id: number
					typeId: EntryTypeId
					sessionId: number
					/**
					 * This entry's decision, in the retrieval panel's shape.
					 *
					 * ⚠ **Absent is a real answer**, not an error: no mechanism
					 * offered this entry to the ranker and none declined it by
					 * name either. `ranked` and `notes` are what say why.
					 */
					row?: Pipelines.RetrievalRow
					/** False when the turn ranked nothing at all. */
					ranked?: boolean
					/**
					 * This entry's decision as the ranking store would keep it
					 * (L1, the same projection), never stored: whether it went
					 * in, why, its rank among the `of` let in, what it cost,
					 * and the keys that matched.
					 */
					decision?: {
						included: boolean
						reason: string
						rank: number | null
						of: number
						tokens: number | null
						matched: string[]
					}
					/**
					 * The mechanism-level half of the trail — how deep the scan
					 * went, whether an embedding model was there. This is what
					 * answers a missing `row`.
					 */
					notes?: string[]
					/** Wiring problems the turn reported. */
					warnings?: string[]
					error?: string
				}
			}
		}

		/**
		 * Dated overlays on an entry or a character card, and the lines of the
		 * story they belong to.
		 *
		 * Ruled 2026-09-23; design of record
		 * `~/.claude/plans/DESIGN-lore-amendments-branches.md`. An amendment says
		 * "from this date, these fields read differently"; resolution is
		 * `$lib/shared/lorebooks/amendments.ts`, which the server and the
		 * workspace both call so the two cannot disagree.
		 *
		 * ⚠ Its OWN namespace rather than `entries:*`, because an amendment
		 * hangs off an entry **or** a character card and neither owns the other.
		 */
		namespace Amendments {
			/** One dated overlay, as the wire carries it. */
			interface Row {
				id: number
				/** NULL = main, the shared line. */
				branchId: number | null
				year: number
				month: number | null
				day: number | null
				/** A partial of the subject's writable columns. */
				fields: Record<string, unknown>
				/** The event that made it true, where there is one. */
				historyEntryId: number | null
				createdAt: string
				updatedAt: string
			}
			interface EntryRow extends Row {
				entryId: number
			}
			/**
			 * An overlay on a CAST MEMBER — the person in this story — not on a
			 * character card, which is a reusable asset several books may
			 * share. Ruled 2026-09-23.
			 *
			 * ⚠ `fields` may carry `characterId`: which card represents this
			 * person is itself a thing that changes over a life, so it is
			 * amendable like any other column.
			 */
			interface CastRow extends Row {
				/** The `lorebook_bindings` row, as the route spells it. */
				castId: number
				lorebookId: number
			}
			/**
			 * Where in their own life a member stands, and when.
			 *
			 * ⚠ Two overlapping presences of one member are TWO of them in the
			 * room. That is the shape's whole purpose; a member with none has
			 * one implicit appearance and reads exactly as they do today.
			 */
			interface Presence {
				id: number
				/** The cast member (`lorebook_bindings` row). */
				castId: number
				branchId: number | null
				/** An age, a chapter — whatever the author counts in. */
				personalPosition: number
				fromYear: number
				fromMonth: number | null
				fromDay: number | null
				/** Absent = it never ends. **Exclusive** when present. */
				untilYear: number | null
				untilMonth: number | null
				untilDay: number | null
				note: string | null
			}
			/** One line of the story that diverged. `main` is never a row. */
			interface Branch {
				id: number
				lorebookId: number
				name: string
				forkedFromBranchId: number | null
				forkYear: number | null
				forkMonth: number | null
				forkDay: number | null
			}

			/**
			 * Every overlay in one book, in ONE message.
			 *
			 * ⚠ Not per entry. The pool resolves every row it draws, so a call
			 * per entry would be a call per row in a list.
			 */
			namespace List {
				interface Params {
					lorebookId: number
				}
				interface Response {
					lorebookId: number
					entries: EntryRow[]
					cast: CastRow[]
					presences: Presence[]
					branches: Branch[]
				}
			}

			namespace Create {
				interface Params {
					lorebookId: number
					/** Exactly one of these two. */
					entryId?: number
					/** A cast member (`lorebook_bindings` row). */
					castId?: number
					/**
					 * Where in their own life this begins, for a change to a
					 * member. Absent means the world date is the anchor, which
					 * is how every amendment read before appearances existed.
					 */
					personalPosition?: number | null
					branchId?: number | null
					year: number
					month?: number | null
					day?: number | null
					fields: Record<string, unknown>
					historyEntryId?: number | null
				}
				type Response = List.Response
			}

			namespace Update {
				interface Params {
					lorebookId: number
					id: number
					subject: "entry" | "cast"
					year?: number
					month?: number | null
					day?: number | null
					fields?: Record<string, unknown>
				}
				type Response = List.Response
			}

			namespace Delete {
				interface Params {
					lorebookId: number
					id: number
					subject: "entry" | "cast"
				}
				type Response = List.Response
			}

			/**
			 * Forking, switching and deleting a line.
			 *
			 * ⚠ There is no `main` here and never will be. Main is the absence
			 * of a branch id, so "switch to main" is a switch to `null` and
			 * "delete main" is not a sentence.
			 *
			 * ⚠ These answer with the same whole-book list as `list`, for the
			 * same reason the amendment writes do: a branch appearing changes
			 * which amendments a reader can see.
			 */
			/**
			 * Placing a member: from when, at what point of their life, until
			 * when. The same whole-book list comes back, as every write here
			 * does.
			 */
			namespace Place {
				interface Params {
					lorebookId: number
					castId: number
					personalPosition: number
					branchId?: number | null
					fromYear: number
					fromMonth?: number | null
					fromDay?: number | null
					untilYear?: number | null
					untilMonth?: number | null
					untilDay?: number | null
					note?: string | null
				}
				type Response = List.Response
			}

			namespace Unplace {
				interface Params {
					lorebookId: number
					/** A `cast_presences` row. */
					id: number
				}
				type Response = List.Response
			}

			namespace Fork {
				interface Params {
					lorebookId: number
					name: string
					/** The line being left. NULL = main. */
					forkedFromBranchId?: number | null
					/** Where it left. Absent = at the start, sharing nothing later. */
					forkYear?: number | null
					forkMonth?: number | null
					forkDay?: number | null
				}
				type Response = List.Response
			}

			namespace RenameBranch {
				interface Params {
					lorebookId: number
					id: number
					name: string
				}
				type Response = List.Response
			}

			/**
			 * ⚠ Removes the line's OWN rows — its amendments, its entries, its
			 * scenes, its edges — by cascade. Shared rows are untouched, and
			 * branches forked FROM it become children of main rather than
			 * disappearing with it.
			 */
			namespace DeleteBranch {
				interface Params {
					lorebookId: number
					id: number
				}
				type Response = List.Response
			}
		}

		/**
		 * Completion templates — the delimiters a connection's prompt is wrapped
		 * in, as rows.
		 *
		 * ⚠ **Every handler is admin-only, per handler.** The `/admin` layout gate
		 * is for the person; a row here shapes every prompt this instance sends,
		 * so the check that matters is the one in the handler.
		 */
		namespace CompletionTemplates {
			namespace List {
				interface Params {}
				interface Response {
					/** Built-ins first, then by name — the /admin/sampling ordering. */
					completionTemplatesList: SelectCompletionTemplate[]
				}
			}
			namespace Get {
				interface Params {
					id: number
				}
				interface Response {
					completionTemplate: SelectCompletionTemplate
				}
			}
			namespace Create {
				interface Params {
					completionTemplate: InsertCompletionTemplate
				}
				interface Response {
					completionTemplate: SelectCompletionTemplate
				}
			}
			namespace Update {
				interface Params {
					completionTemplate: UpdateCompletionTemplate
				}
				interface Response {
					completionTemplate: SelectCompletionTemplate
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
			/** The way to a variant of a built-in — /admin/prompts' rule. */
			namespace Clone {
				interface Params {
					id: number
				}
				interface Response {
					completionTemplate: SelectCompletionTemplate
				}
			}
			/**
			 * The connection format picker's options.
			 *
			 * Its own event rather than deriving from `list`, because the picker
			 * wants only what `is_selectable` allows and the changelist wants
			 * everything — and because the two lists drifting is exactly the defect
			 * this replaces: `PromptFormats.options` was a hand-written array beside
			 * the table, with only a test keeping them equal.
			 */
			namespace Options {
				interface Params {}
				interface Response {
					options: { value: string; label: string }[]
				}
			}
		}

		// Sampling Configs namespace
		namespace SamplingConfigs {
			namespace List {
				interface Params {}
				interface Response {
					/**
					 * Identity plus the whole stored config (0171). Named
					 * exactly rather than left as a `Partial`, because there
					 * are no typed sampler columns to project any more: a
					 * consumer resolves the numbers it displays out of
					 * `values`/`enabled`, and filters the list by `shape`, so
					 * the type has to promise those three are present.
					 */
					samplingConfigsList: Pick<
						SelectSamplingConfig,
						| "id"
						| "name"
						| "isImmutable"
						| "shape"
						| "values"
						| "enabled"
					>[]
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
				/** The value declaration (24 T6c) — single-key, for value-decl controls. */
				decl?: Record<string, Record<string, unknown>>
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
				 * For a `list` control: the declaration every row satisfies,
				 * with its display text already resolved.
				 *
				 * The list editor renders from this rather than from anything
				 * it knows about any particular list — which is why the field
				 * language grew a `list` kind rather than the prompt-block pack
				 * growing a control of its own. A plugin declaring an ordered
				 * list of its own rows gets the same editor, labelled, with no
				 * client change at all.
				 */
				item?: {
					fields: Array<{
						key: string
						label: string
						control: string
						of?: readonly string[]
						members?: readonly {
							key: string
							label?: string
							description?: string
						}[]
						default?: unknown
					}>
				}
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
					/**
					 * Offered but not selectable — a connection that cannot do
					 * what this slot's node needs. Shown rather than hidden,
					 * because "why isn't my connection in the list" has no
					 * answer when it is simply absent.
					 */
					disabled?: boolean
					/**
					 * Why, in the words the connection screen used ("Can't do
					 * Image generation."). Also appears WITHOUT `disabled`, for
					 * a connection nobody has tested yet — a caveat on a choice
					 * that is still selectable.
					 */
					reason?: string
					/**
					 * For a `connection-ref` choice: the MODELS on that endpoint
					 * (0114) — the second half of the pair the slot stores.
					 *
					 * Carried on the choice rather than fetched when one is
					 * picked, the same ride-along `prompt` makes below: a round
					 * trip per selection means the model picker renders empty
					 * for a moment every time the endpoint changes.
					 *
					 * Absent for every other kind of choice, and for an endpoint
					 * that has none — which is how the panel knows not to render
					 * a picker with no choice in it.
					 */
					models?: Array<{
						id: number
						/** What a person sees. */
						name: string
						/** What the adapter sends — the tooltip, when they differ. */
						model: string
						enabled: boolean
						/**
						 * Set while the host has stopped listing it. Offered
						 * greyed with the reason, never dropped — a slot
						 * pointed at it has to still show what it names.
						 */
						missingSince: string | null
					}>
				}>
				/**
				 * For a `prompts-ref` option: the field names the SLOT declares,
				 * independent of whether a prompt is selected.
				 *
				 * Distinct from `prompt.declared`, which says the same thing but
				 * only exists once a row is chosen — so the one moment it was
				 * needed, creating the first prompt for an empty slot, it was
				 * absent and the new prompt came out with no boxes at all.
				 */
				promptFields?: string[]
				/**
				 * For a `context-template-ref` option: every language this slot renders,
				 * most-preferred first.
				 *
				 * On the option rather than inside `contextTemplate`, for the reason
				 * `promptFields` is: the create button needs it precisely when no row is
				 * selected. A slot that accepts one language sends the one, so a client can
				 * treat "more than one entry" as "offer a choice" without a second flag.
				 */
				templateEngines?: string[]
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
					/**
					 * Text for fields this slot no longer declares, kept so the
					 * panel can offer it back. Not editable and not sent: it is
					 * there to be read and copied, which is the whole of what
					 * "recover/archive it for later" asks for.
					 */
					archived?: Record<string, string>
					/** usedHere | shipped | alsoFits — which group it sorted into. */
					group?: "usedHere" | "shipped" | "alsoFits"
					/** The pipeline it was written in, when that is not this one. */
					origin?: string
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
				/**
				 * For a `scripts-chain` option: the resolved chain, hydrated in
				 * order — what the id list *is*, so the panel renders names and
				 * badges without a second fetch. A deleted row still appears,
				 * marked `missing`; a dangle the panel hides is a chain that
				 * quietly shrank.
				 */
				scripts?: Array<{
					id: number
					name: string
					enabled: boolean
					typeLabel: string
					blastRadius: string
					operation: string
					missing?: boolean
				}>
				/**
				 * Stop guards the run's connection carries, shown beside the
				 * chain with provenance (18 §4c). Read-only here — managed in
				 * the connection's own settings.
				 */
				connectionScripts?: {
					connectionName: string
					entries: Array<{
						id: number
						name: string
						enabled: boolean
					}>
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
				source: "session" | "preset" | "author"
				writable: boolean
				overriddenHere: boolean
				/**
				 * Did somebody depart from the shipped default here (ruled
				 * 2026-09-10)?
				 *
				 * A configuration stores **deviations**: a row exists only
				 * where the value differs from what the declaration says, so
				 * this is the row's existence and nothing more. It is what the
				 * changed marker beside a field draws, and what the Changes
				 * view lists.
				 *
				 * Not a synonym for `overriddenHere`, which follows the scope
				 * an edit LANDS at and therefore describes the session's own
				 * override from inside a session. This one is always about the
				 * configuration, so a person in a session can see that a field
				 * was tuned for everyone without that being the thing their own
				 * reset would remove.
				 */
				changed: boolean
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
			 * default plus whatever an administrator has added. Selecting one
			 * is what the old preset picker did, over the table the runtime
			 * actually resolves against.
			 *
			 * Nobody but an administrator owns one. A person's relationship to
			 * a configuration is a *selection*, so this list is a menu rather
			 * than an inventory, and it carries no create/rename/delete verbs
			 * for the surfaces a non-admin sees.
			 */
			interface NamedConfig {
				id: number
				name: string
				isDefault: boolean
				readOnly: boolean
				/**
				 * Whether a non-admin may choose this preset.
				 *
				 * Only ever `false` in an admin's view — a withdrawn
				 * configuration is not listed for anyone else.
				 */
				enabled: boolean
				/**
				 * Which of the mode's actions sessions on this preset include,
				 * by identity (`<spec slug>#<key>`; W-A). `null` states nothing
				 * (the companion rule decides); `[]` states none.
				 */
				includedActions: string[] | null
			}
			/**
			 * What publishing a new version did to a configuration, kept until
			 * somebody has seen it.
			 *
			 * A version can *remove* an option a person deliberately set. The
			 * value is culled — a row addressing a field that no longer exists
			 * resolves to nothing and reads as corruption — and this is the
			 * half that makes the cull honest: what it was called, and what it
			 * held. Back-fills travel under their own kind, because they answer
			 * the same question ("why is this different today") and a reader who
			 * has to consult two places will consult neither.
			 *
			 * The ADDRESS is deliberately absent. `nodeKey` is topology and the
			 * payload carries none (05 §0a); the label is what a person needs
			 * and the id is what a dismissal names.
			 */
			interface ConfigNotice {
				id: number
				/**
				 * `culled` — a value this version does not declare, removed;
				 * `backfilled` — a value that arrived at the shipped default;
				 * `unbound` — a placed node whose definition this build does
				 * not run (removed or provisional, plans/29 R-2): nothing was
				 * removed, the node waits to be bound or taken out.
				 */
				kind: "culled" | "backfilled" | "unbound"
				/**
				 * What the control was called. Recovered from the version that
				 * last declared it, and humanized from the address when that
				 * version's declarations are gone — never empty, because a
				 * notice that cannot name what was lost is barely better than
				 * the silence it replaces.
				 */
				label: string
				/** What the user had set, for a cull. Absent for a back-fill. */
				previousValue?: unknown
				/** When the change happened, ISO-8601. */
				at: string
			}
			interface Namespace {
				slug: string
				name: string
				version: string
				event: string | null
				enabled: boolean
				/**
				 * Catalogue claims (23 §2) — declared metadata, never parsed
				 * from the slug. Null = unclassified, which sorts last and
				 * says so.
				 */
				taxonomy: {
					zone?: string
					role?: string
					genre?: string
				} | null
			}
			interface NamespaceDetail extends Namespace {
				configs: NamedConfig[]
				/** Every action this pipeline's mode is offered (19 §3). */
				modeActions: {
					/** The action's key; with `specSlug`, its identity. */
					key: string
					name: string
					specSlug: string
					origin: "companion" | "attachment"
				}[]
				/** `source` is where the selection came from: session | instance | shipped. */
				selectedConfig: {
					id: number
					name: string
					source: string
				} | null
				/**
				 * Whether this viewer may change the selection from here.
				 *
				 * A selection made inside a session is the session's; made
				 * anywhere else it is the instance's, which is the
				 * administrator's alone. False therefore means "show what is
				 * selected, offer no picker" — an absent control rather than a
				 * live one whose every use is refused.
				 */
				canSelectConfig: boolean
				steps: Step[]
				/**
				 * An envoy's settings (plans/29 R-18 (2); U5g) — no step of the
				 * run's spine names one, so it is not counted or numbered among
				 * `steps`. Render after them, under their own small heading
				 * ("Also configured here"); same `Step` shape as the rest.
				 */
				alsoConfigured: Step[]
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
					/** Set when opened from inside a session — writes land at session scope. */
					sessionId?: number
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
					sessionId?: number
					/**
					 * Edit this configuration itself rather than the resolved
					 * target. The builder sends it; without it the write lands
					 * at the session's override (when `sessionId` is set) or in the
					 * instance's selected config (admins, globally) — the only
					 * two destinations since the layer simplification
					 * (2026-08-24).
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
					sessionId?: number
					/** Reset this configuration's own value, not an override. */
					configId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * Reset a whole configuration — every deviation at once.
			 *
			 * A delete of the configuration's rows rather than a loop of
			 * `clearOption` over what the panel happened to be showing: a
			 * client-side loop leaves behind exactly the rows the viewer could
			 * not see, which is the half a person means least to keep.
			 */
			namespace ResetConfig {
				interface Params {
					slug: string
					sessionId?: number
					/** Which configuration. Absent means the instance's selected one. */
					configId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					/** How many deviations went, so "reset" and "nothing to reset" differ. */
					cleared?: number
					error?: string
				}
			}
			/**
			 * The builder's Save all (22 §3): the whole draft in one request —
			 * sets and clears together, answered with one refreshed view on
			 * `pipelines:get` like the per-option events. Entries apply in
			 * order and the first refusal stops the batch: a partially applied
			 * draft with an error names exactly where it stopped.
			 */
			namespace SetOptions {
				interface Params {
					slug: string
					sessionId?: number
					/** Edit this configuration itself rather than the resolved target. */
					configId?: number
					set: { optionId: string; value: unknown }[]
					clear: string[]
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
					/** How many writes landed before an error stopped the batch. */
					applied?: number
				}
			}
			/**
			 * One run's full receipt (22 §3) — the node-by-node record the
			 * summary row compresses. Admin-and-owner gated like the runs
			 * list; the receipt names node keys, which this surface may do
			 * (05 §0a binds the sidebar, not the admin).
			 */
			namespace Run {
				interface Params {
					runId: string
				}
				/**
				 * One participant the run asked about and who portrayed them
				 * — the receipt's pinned `portrayals` (R-21 (4)), with a name
				 * beside each reference so the inspector's line reads "Tom ·
				 * AI · Elara · you" rather than `character:12 · ai`.
				 *
				 * `name` is what the session's member list already shows: a
				 * cast character's name, a member's display name. Nothing about
				 * connections rides here, and a participant nobody portrays
				 * (`none`) is never named — the line shows its reference.
				 */
				interface PortrayalLine {
					/** The participant reference, as the receipt keys it. */
					ref: string
					/**
					 * The participant's name — a character's, an envoy's slug,
					 * a role's word; the reference itself when `by` is `none`.
					 */
					name: string
					by: "person" | "ai" | "none"
					/**
					 * The person, when `by` is `person`: their display name and
					 * whether they are the viewer. `you` is decided here so the
					 * client never compares user ids.
					 */
					person?: { name: string; you: boolean }
				}
				interface Response {
					run?: Runs.Response["runs"][number] & {
						receipt: Record<string, unknown>
						/**
						 * Who portrayed whom, in the order the receipt pinned
						 * them. Absent on a receipt that pinned none (a run
						 * written before U5a, a pre-call preview).
						 */
						portrayals?: PortrayalLine[]
					}
					error?: string
				}
			}
			/**
			 * Retrieval, explained — design §9, plan Part 6.
			 *
			 * The whole "why" trail is computed on every turn and, until this,
			 * was rendered nowhere: `keywordQuery.skipped[]`, the mechanisms'
			 * `diagnostics`, `merge`'s `foundBy`, and `select`'s `Decision`
			 * across eleven reasons all reach the receipt and stop there.
			 *
			 * Shaped the way the plan rules and **not** as a numeric panel:
			 * anchored to each result, content vocabulary before numbers, named
			 * ordered criteria rather than a composite float, and every row
			 * carrying an action. Two levels of disclosure and no third — the
			 * row is level one, `criteria` and `entry` are level two.
			 *
			 * Projected server-side rather than derived on the client from the
			 * raw receipt, for the reason every other handler here states: the
			 * receipt is an internal record whose shape grows, and a panel
			 * reading it directly is a second copy of what a decision means.
			 */
			interface RetrievalCriterion {
				/** The criterion's name, in content vocabulary. */
				label: string
				/** What was measured, in words. Numbers are the second half. */
				detail: string
				/**
				 * What the criterion measured, 0–1.
				 *
				 * The measurement and **not** a weighted contribution, which is
				 * the number a reader would rather have and the one this
				 * surface cannot honestly produce: the signal weights are flat
				 * per-signal config maps that `bindings.ts` folds into
				 * `RankingParams` privately, so anything here would either
				 * duplicate that fold or quietly assume the defaults. Worse,
				 * half the candidates carry a `presetScore` — rank fusion, a
				 * similarity — and were ordered by a number no weight touched,
				 * so a contribution column would explain the wrong arithmetic
				 * for them. The composite the ranker actually sorted on is on
				 * the row, once, as `score`.
				 */
				value?: number
			}
			/**
			 * The row's own entry, and the two levers it can offer.
			 *
			 * `constant` is "always include" and `enabled` is "never include" —
			 * both real columns with real editors, so the panel writes through
			 * `entries:update` rather than growing a verb of its own. Present
			 * only for a lore row whose entry the asker owns; a message or a
			 * graph node has neither field and gets no lever.
			 */
			interface RetrievalEntryRef {
				id: number
				typeId: EntryTypeId
				/** Current values, so a toggle can say what it will do. */
				constant: boolean
				enabled: boolean
				/** The entry's keys, for the keyword criterion's wording. */
				keys: string[]
				/**
				 * The book the entry lives in, so an explanation can offer to
				 * open it. Absent when the projection read no entries at all,
				 * and an absent book is no address: the action is not offered
				 * rather than guessed at.
				 */
				lorebookId?: number
			}
			interface RetrievalRow {
				/** `source:id` — stable, and what the panel keys `{#each}` on. */
				key: string
				id: number | string
				/** The budget group: `worldLore`, `history`, `messages`… */
				source: string
				/** That group's front-door name. */
				sourceLabel: string
				/**
				 * The entry's title, or a stand-in when it has none.
				 *
				 * The **recorded** one once `provenance` says the entry has
				 * moved, and the live one otherwise — see `currentTitle`.
				 */
				title: string
				/**
				 * The first line of what it says — content, not metadata.
				 *
				 * Always the recorded text: it is read off the candidate's own
				 * `payload`, which is the row as the run scored it, so this
				 * half of the panel has never had the drift `provenance`
				 * names.
				 */
				excerpt?: string
				/**
				 * Whether the entry behind this row is still what the run
				 * scored — the honest states of a record that keeps decisions
				 * but not content.
				 *
				 * A receipt stores candidate ids, scores and reasons; the
				 * titles and keys beside them are read **live** when the panel
				 * opens. So an entry edited or deleted after its run used to
				 * render the current text against the old decision, with
				 * nothing saying they were never together — a composite that
				 * never existed. Each candidate now records a fingerprint of
				 * its stored title, keys and content (`entrySourceHash`, the
				 * annotation lane's own hash), and this is that fingerprint
				 * compared against the row as it is now:
				 *
				 *  · `unchanged` — the live entry *is* what was scored, so the
				 *    panel may render it inline as it always has.
				 *  · `changed` — the row exists and is not what was scored.
				 *    The decision stands; the entry beside it is a reference,
				 *    and `currentTitle` is how it reads now.
				 *  · `deleted` — no such row in this session's lorebook any
				 *    more. The decision is all that is left of it.
				 *
				 * ⚠ **Absent means nothing is claimed**, and that is a real and
				 * common state rather than a fourth outcome: a receipt written
				 * before the fingerprint existed, a candidate from a mechanism that
				 * does not carry one, a run whose session or lorebook can no
				 * longer be read. A reader must not treat absence as
				 * `unchanged` — the whole defect this field exists for is a
				 * panel presenting an unverified pairing as a verified one.
				 */
				provenance?: "unchanged" | "changed" | "deleted"
				/**
				 * What happened to it, as a sentence — present exactly when
				 * `provenance` is `changed` or `deleted`.
				 *
				 * Content vocabulary and no numbers, like every other sentence
				 * on this row: the figures are the second level and this is a
				 * statement about the record.
				 */
				provenanceNote?: string
				/**
				 * The entry's title **as it reads now**, when that is not the
				 * title this row carries.
				 *
				 * The clearly-labelled reference half of a `changed` row: the
				 * decision is about the recorded title, and this is the one a
				 * reader will find if they go looking. Absent when the two
				 * agree, when the entry is gone, and when the run recorded no
				 * title to contrast with.
				 */
				currentTitle?: string
				/**
				 * `skipped` is not a weaker `excluded`: it means no mechanism ever
				 * offered this entry to the ranker, which is a different
				 * question with a different control behind it.
				 */
				outcome: "included" | "excluded" | "skipped"
				/** Level one: one sentence, in content vocabulary. */
				verdict: string
				/** The medal — how it got here, in two or three words. */
				marker: string
				/** What the medal is about, for colour and grouping. */
				markerKind:
					| "pinned"
					| "keyword"
					| "semantic"
					| "entity"
					/**
					 * The narrative graph. Its own kind rather than `semantic`,
					 * because the arm carries a score and no signals — the same
					 * shape a vector hit has — and folding it in would tell a
					 * reader an embedding decided something no embedding was
					 * consulted about.
					 */
					| "graph"
					| "floor"
					| "none"
				/** Level two, ordered by contribution where there is one. */
				criteria: RetrievalCriterion[]
				score?: number
				tokens?: number
				/**
				 * `select`'s own vocabulary — `filled_scored`,
				 * `excluded_share_cap`. Kept because it is what the code and
				 * the tests are written in, and a reader who knows it should
				 * not have to translate back from prose.
				 */
				reason?: string
				/** Which node decided, for a spec ranking in more than one gather branch. */
				nodeKey?: string
				/**
				 * The engine's own sentence, with the numbers that produced the
				 * decision — `select` writes it at the decision site because
				 * they exist there and nowhere else once the loop moves on
				 * (16 §7c). Level two, under the prose verdict.
				 */
				why?: string[]
				entry?: RetrievalEntryRef
			}
			/** One budget group's arithmetic — what `renderSelection` summarised. */
			interface RetrievalBand {
				source: string
				label: string
				allocated: number
				used: number
				entries: number
				cap: number
				/** How many candidates of this source the ranker turned away. */
				dropped: number
				/**
				 * Its slice of what retrieval actually spent, 0–1 — the figure
				 * behind `RetrievalBudget.headline`.
				 *
				 * Absent when nothing was spent at all, because a share of
				 * nothing is undefined rather than zero, and four rows each
				 * reading "0%" would be the panel asserting a division it never
				 * performed.
				 */
				share?: number
			}
			/**
			 * Where the room went — the budget, said in one sentence.
			 *
			 * The per-item token counts have always been on the receipt and the
			 * bands have always carried their sums; nothing ever added them up
			 * into a *statement*. A reader wanting to know what was eating the
			 * prompt had four numeric columns and a subtraction to do, which is
			 * the same failure the retrieval rows exist to fix one level down:
			 * the arithmetic was present and the finding was not.
			 *
			 * ⚠ **"The retrieved context", never "your prompt".** These bands
			 * budget what *retrieval* put in — world lore, character lore,
			 * history, messages, relationships — and the system prompt, the
			 * persona, the instructions and the reply itself sit outside every
			 * one of them. A share stated against "the prompt" would be a
			 * larger claim than the receipt can support, so every sentence here
			 * names the smaller thing it is honestly a share of.
			 */
			interface RetrievalBudget {
				/**
				 * Which band is taking the room, named before the figure that
				 * says how much.
				 */
				headline: string
				/**
				 * How full the room got — present only when the run recorded a
				 * ceiling to be full of. A run that halted before assembly
				 * recorded none, and inventing one from the sum of the bands
				 * would be reporting "100% full" for every such run.
				 */
				detail?: string
				/** Tokens the retrieved context actually holds. */
				used: number
				/** The ceiling assemble recorded for it, when it recorded one. */
				total?: number
				/** What was left of that ceiling. Present with `total`. */
				remaining?: number
			}
			/**
			 * One stop sequence, and where it came from (ruling 2026-09-10).
			 *
			 * The kind is what makes the panel's account possible at all: a flat
			 * list can say a string was sent and can never say WHY, so the wire
			 * rule that held one back reads as the app losing it.
			 *
			 *   · `format` — the completion template's own `stopStrings`.
			 *   · `speaker` — `Name:` for everyone in the scene but the speaker.
			 *   · `explicit` — what the author typed into the step's params.
			 */
			interface StopSequence {
				value: string
				kind: "format" | "speaker" | "explicit"
			}
			/** What a run sent, what it held back, and what ended the reply. */
			interface RetrievalStops {
				sent: StopSequence[]
				/**
				 * Held back by the wire rule — never "not composed". On a chat
				 * wire the roles carry the structure, so `format` and `speaker`
				 * entries have nothing to bite on and would override the model's
				 * own stop tokens; they are listed here so a reader can see that
				 * the app considered them rather than lost them.
				 */
				dropped: StopSequence[]
				/**
				 * Which rule decided the split.
				 *
				 * ⚠ Connection identity, so the egress projection removes this
				 * key for everyone who is not an administrator: the lists
				 * arrive, the word does not. A reader rendering it says what
				 * it means without it.
				 */
				wire: "chat" | "completion"
				/**
				 * The sequence the service says actually matched, where it says.
				 * Only llama.cpp reports the WORD; the others report a reason
				 * code that names no sequence, so this is usually absent.
				 */
				hit?: string
			}
			/**
			 * What the prompt cost and how much of it the service reused (ruled
			 * "later, non-disruptive" — this is the recording half).
			 *
			 * ⚠ `cached` absent means "this connection does not report reuse",
			 * which is a different answer from `cached: 0` ("nothing was
			 * reused"). KoboldCPP reports neither and Ollama reports the total
			 * only, and collapsing the two would tell those users their caching
			 * is broken.
			 *
			 * Carries no connection identity — three integers — so the
			 * projection has nothing to remove and a non-admin reading their own
			 * receipt sees all of it.
			 */
			interface RetrievalPromptCache {
				/** The whole prompt, as the service counted it. */
				prompt?: number
				/** Served from a cached prefix. */
				cached?: number
				/** Written to the cache by this request — Anthropic alone bills this apart. */
				write?: number
			}
			namespace RunExplain {
				interface Params {
					runId: string
				}
				interface Response {
					runId?: string
					explanation?: {
						rows: RetrievalRow[]
						bands: RetrievalBand[]
						/**
						 * Mechanism-level facts no row can carry — how deep the scan
						 * went, whether an embedding model was available.
						 */
						notes: string[]
						/**
						 * Wiring problems the run reported: disjoint fusion, a
						 * source the candidate fetch could not read whole.
						 */
						warnings: string[]
						/**
						 * False when the run recorded no ranking at all — a
						 * halt before retrieval, or a compacted receipt. The
						 * panel says so rather than rendering an empty list,
						 * which reads as "nothing matched".
						 */
						ranked: boolean
						/** Rows dropped from this projection for size. */
						omitted: number
						/**
						 * What is eating the room, summed by band.
						 *
						 * Absent when the run recorded no budget groups and
						 * put no tokens in — a halt before retrieval, a
						 * compacted receipt. Silence rather than a breakdown
						 * of nothing, for the reason `ranked` exists: an empty
						 * table reads as "nothing was retrieved" when the
						 * truth is "nothing was recorded".
						 */
						budget?: RetrievalBudget
						/**
						 * What ended the reply, and what was not allowed to.
						 *
						 * Absent means the run recorded nothing — a receipt from
						 * before this was kept, or a halt upstream of the
						 * provider — which is a different answer from "no stop
						 * sequences were sent", exactly as `budget` above is
						 * absent rather than zeroed.
						 */
						stops?: RetrievalStops
						/**
						 * The prompt cache, where the connection reported
						 * anything about it. Absent on a run that halted before
						 * the provider, and on every service that says nothing
						 * — silence rather than a row claiming zero reuse.
						 */
						promptCache?: RetrievalPromptCache
						/**
						 * The run took the genre's default because the
						 * session's preset bound the event to a pipeline this
						 * instance cannot resolve (ruled 2026-09-10).
						 *
						 * Absent on every ordinary run. Present, it is the
						 * answer to "why is this not the pipeline the preset
						 * says" — a question the node trail cannot answer,
						 * because the substitution happened before the first
						 * node.
						 */
						presetFallback?: {
							preset: string
							event: string
							bound: string
							reason: string
						}
					}
					error?: string
				}
			}
			/**
			 * What lore *would* fire, asked where the question is asked.
			 *
			 * The same explanation `RunExplain` gives for a turn that already
			 * happened, for the turn that has not yet: a real preview run
			 * against the draft sitting in the composer, projected by the same
			 * `explainRetrieval`. "Would" and "did" are one mechanism here
			 * rather than a second guess at the first — the whole reason this
			 * compiles a turn instead of re-deriving the gather rules.
			 *
			 * ⚠ **Asked for, never live.** A turn is a real run with a real
			 * embedding call behind it, so this answers a button rather than a
			 * keystroke — the rule `EntryFireTest` already states for the
			 * single-entry version of the same question.
			 */
			namespace PreviewRetrieval {
				interface Params {
					sessionId: number
					/**
					 * The unsent draft, spliced the way
					 * `sessions:promptTokenCount` splices it — without it the
					 * preview answers about the conversation *without* the
					 * message it is being asked about.
					 */
					content?: string
					/** Whose draft it is, so switching persona changes the answer. */
					personaId?: number | null
				}
				interface Response {
					sessionId?: number
					explanation?: RunExplain.Response["explanation"]
					error?: string
				}
			}
			/**
			 * Why *this reply* said what it said.
			 *
			 * `RunExplain` addresses a run, which is the admin workspace's
			 * vocabulary; a reader looking at a message has a message. This is
			 * the same projection addressed the way the question is asked, and
			 * it resolves the run itself rather than making the client carry a
			 * run id it was never given.
			 *
			 * Gated on the **session**, owner or guest — not on who owns the
			 * run. A guest reading a reply in a conversation they are part of
			 * is reading why that conversation said something to them, and an
			 * owner-only gate would refuse them their own evidence.
			 */
			namespace MessageExplain {
				interface Params {
					messageId: number
				}
				interface Response {
					messageId?: number
					/** The run behind the message, when one is recorded. */
					runId?: string
					explanation?: RunExplain.Response["explanation"]
					error?: string
				}
			}
			/**
			 * Which runs produced a given row.
			 *
			 * The reverse of a run's artifact list, and the direction a person
			 * actually asks in: they are looking at the *thing* — an image in
			 * the gallery, a reply in a session — and want to know what made
			 * it. Recorded since `pipeline_run_artifacts` replaced the nullable
			 * column, and unreadable from a client for anything but a message
			 * until this existed.
			 *
			 * ⚠ **Gated on the artifact, not on the run.** A run row carries a
			 * `user_id` and scoping to it would answer the wrong question —
			 * "did you make this run" rather than "may you see this row". Each
			 * kind is gated by whoever already owns that kind's access.
			 *
			 * Names and dates the runs; it does not carry a receipt. A receipt
			 * is what `Run` is for, and returning one here would put a run's
			 * whole output behind a gate written for an image.
			 */
			namespace ArtifactRuns {
				interface Params {
					/**
					 * Which table `entityId` belongs to.
					 *
					 * The artifact vocabulary's four kinds, of which two are
					 * answerable today: `variant` and `lore_entry` have
					 * producers but no reader asking this, and a gate written
					 * for a caller that does not exist is a gate nothing tests.
					 */
					kind:
						| "message"
						| "file"
						| "variant"
						| "lore_entry"
						| "session"
					entityId: number
				}
				interface Run {
					runId: string
					specSlug: string
					startedAt: string | Date
					/**
					 * A preview is a weaker record than a send — it halted
					 * before anything effectful — and which one a reader wants
					 * is the caller's question, so both come back labelled
					 * rather than one being filtered out here.
					 */
					isPreview: boolean
					/**
					 * What the run did to the row (R-15, 2026-09-16): `created`
					 * / `updated` wrote its content; `edited` · `hidden` ·
					 * `swiped` · `deleted` are the built-ins, whose receipts
					 * have no prompt — a reader after "the run that wrote this"
					 * skips them.
					 */
					actions: string[]
				}
				interface Response {
					kind: Params["kind"]
					entityId?: number
					/** Newest first. Empty when no run claims the row. */
					runs: Run[]
					error?: string
				}
			}
			/**
			 * Everything that has ever fired in one session.
			 *
			 * Every run's receipt has always recorded what fired, and nothing
			 * ever added them up — so "which entries is this session actually
			 * using?" meant opening runs one at a time and holding the answer
			 * in your head. This is the aggregate across a session's runs:
			 * which entries reached a prompt, how often, and when last.
			 *
			 * Read from the ranking store's rollup (§3.9): complete however long
			 * the session, because retention prunes the per-turn decisions and
			 * never the rollup. `judgedInRuns` is each entry's own denominator.
			 */
			interface SessionEntryUsageRow {
				/** `source:id` — the same key the run explanation rows use. */
				key: string
				id: number | string
				/** The budget group: `worldLore`, `history`, `messages`… */
				source: string
				/** That group's front-door name. */
				sourceLabel: string
				/**
				 * The entry's title as it reads **now**, falling back to the
				 * name the last run recorded and then to its id.
				 *
				 * No `provenance` here, deliberately. Drift is a statement
				 * about one decision and one entry at one moment; across
				 * fifty runs "has it been edited since" has fifty answers and
				 * the honest aggregate of them is none. A reader who needs
				 * that opens `lastRunId`, where the comparison is well posed.
				 */
				title: string
				/** How many runs put it in the prompt. */
				usedInRuns: number
				/**
				 * How many runs judged it at all, used or not — the
				 * denominator that makes `usedInRuns` mean something. "12 of
				 * 12" and "12 of 300" are different facts about one entry.
				 */
				judgedInRuns: number
				/** When it was last in a prompt, ISO. */
				lastUsedAt: string
				/** The run it was last in, so its own trail is one click away. */
				lastRunId: string
				/** What it cost the last time it went in. */
				tokens?: number
				entry?: RetrievalEntryRef
			}
			namespace SessionEntryUsage {
				interface Params {
					sessionId: number
					/** How many rows to answer with. */
					limit?: number
				}
				interface Response {
					sessionId?: number
					/**
					 * The finding, in one sentence — what this session keeps
					 * reaching for, before the figure that says how often.
					 */
					summary?: string
					/**
					 * What the aggregate did not cover, said in words: the run
					 * bound, the previews it left out, the tail it did not
					 * list.
					 */
					notes?: string[]
					/** Most-used first; see the handler on why frequency. */
					entries?: SessionEntryUsageRow[]
					/** ⏳ Equal to `runsTotal` since the rollup read; kept for the client. */
					runsRead?: number
					/** How many non-preview runs the session has in total. */
					runsTotal?: number
					/** Entries past `limit` that are not listed. */
					omitted?: number
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
				definitionId: string
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
					/**
					 * Which review the error is about. A refused edit leaves
					 * that card parked and decidable, so the client needs to
					 * know which one to re-enable — and, since errors reach
					 * every tab this person has open, which ones to ignore.
					 */
					id?: string
				}
			}
			/**
			 * The cap pause (E1c): a run tree held at a cycle cap for the
			 * session owner. `pipelines:capPauseRequested` pushes one;
			 * `continue` grants the tree one more window of each cap and
			 * runs the parked pipeline, `cancel` ends the tree there.
			 * `pipelines:capPauseClosed` retires the card in every tab.
			 */
			interface CapPause {
				id: string
				sessionId: number
				/** The event whose bound pipeline would run next. */
				event: string
				specSlug: string
				/** The runs so far, root first, then the one that would run. */
				chain: string[]
				/** The cap's sentence. */
				cap: string
				depth: number
				/** How many of the tree's runs are parked on this pause. */
				waiting: number
				requestedAt: number
			}
			namespace CapPauses {
				interface Params {}
				interface Response {
					pauses: CapPause[]
				}
			}
			namespace ResolveCapPause {
				interface Params {
					id: string
					action: "continue" | "cancel"
				}
				interface Response {
					ok?: boolean
					error?: string
					/** Which pause the error is about. */
					id?: string
				}
			}
			/**
			 * The events admin page (PLAN-turn-order §B2): the registry of every
			 * event, and the event map for a scope. Admin-only.
			 */
			namespace EventMap {
				interface Params {
					genreId?: string
					presetId?: number
					sessionId?: number
				}
				interface RegistryRow {
					id: string
					label: string
					description: string
					family: "data" | "action"
					affectsUser: boolean
					payload: string | null
					causedBy: string[]
					owner: string
					genres: Array<{ genreId: string; required: boolean }>
					presets: number
					recordedBy?: Array<{
						genreId: string
						recordedBy: string[] | "any"
					}>
				}
				interface MapNode {
					id: string
					kind: "event" | "spec" | "listener"
					label: string
					root: boolean
				}
				interface MapEdge {
					from: string
					to: string
					kind: "binds" | "causes" | "listens"
				}
				interface Response {
					events?: RegistryRow[]
					genres?: Array<{ genreId: string; name: string }>
					presets?: Array<{
						id: number
						name: string
						genreId: string
					}>
					eventMap?: { nodes: MapNode[]; edges: MapEdge[] }
					/** The scope the map was drawn for, echoed so a late reply can be told apart. */
					scope?: Params
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
					sessionId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					configId?: number
					error?: string
				}
			}
			/**
			 * Which actions a preset includes, and whether it may be chosen
			 * (19 §3). Admin-only: this decides what sessions using the preset
			 * can do, and which presets a non-admin is offered.
			 */
			namespace SetPresetActions {
				interface Params {
					slug: string
					configId: number
					/**
					 * Identities (`<spec slug>#<key>`; W-A). Omit to leave
					 * unchanged. `null` restores the default rule.
					 */
					includedActions?: string[] | null
					/** Omit to leave unchanged. */
					enabled?: boolean
					sessionId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace RenameConfig {
				interface Params {
					slug: string
					configId: number
					name: string
					sessionId?: number
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
					sessionId?: number
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
					sessionId?: number
					scope?: "instance"
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * The notices one configuration is holding, oldest first.
			 *
			 * Read separately from the view rather than folded into it: the
			 * view is re-emitted by every write, and a banner that reappeared
			 * on each keystroke-driven refresh would be a notice nobody could
			 * get rid of. This answers only when asked, and after a dismissal.
			 */
			namespace ConfigNotices {
				interface Params {
					slug: string
					configId: number
				}
				interface Response {
					configId?: number
					notices?: ConfigNotice[]
					error?: string
				}
			}
			/**
			 * Dismiss one notice — or, with no id, everything pending on the
			 * configuration.
			 *
			 * Answers on `pipelines:configNotices` with the refreshed list, the
			 * same "a mutation answers with the whole view" rule the option
			 * writes follow: what is left is the only thing the caller needs
			 * and re-deriving it client-side is how the two come to disagree.
			 */
			namespace AcknowledgeConfigNotices {
				interface Params {
					slug: string
					configId: number
					/** Omit to dismiss every pending notice for the config. */
					noticeId?: number
				}
				interface Response {
					configId?: number
					notices?: ConfigNotice[]
					error?: string
				}
			}
			/**
			 * Prompt CRUD from the panel.
			 *
			 * A prompt belongs to a `(node type, slot)` POOL, not to a
			 * pipeline: a node reused elsewhere brings its prompts with it, so
			 * "does this row belong to this spec" has no true answer for a
			 * shared one — the same situation `contextTemplateOptionGate`
			 * already describes for templates.
			 *
			 * So every mutation carries `optionId`, and the gate resolves the
			 * pool from the control the caller is operating. `slug` stays
			 * because it is what resolves that option handle and the viewer's
			 * write permission — not what scopes the row.
			 *
			 * Clone and Create answer with the new id so the panel can select
			 * the row in the same gesture.
			 */
			namespace ClonePrompt {
				interface Params {
					slug: string
					optionId: string
					promptId: number
					name?: string
					sessionId?: number
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
					optionId: string
					promptId: number
					name?: string
					fields?: Record<string, string>
					sessionId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			namespace DeletePrompt {
				interface Params {
					slug: string
					optionId: string
					promptId: number
					sessionId?: number
				}
				interface Response {
					pipeline?: NamespaceDetail
					error?: string
				}
			}
			/**
			 * A prompt written from scratch rather than cloned.
			 *
			 * Exists for the reason `CreateContextTemplate` does: a pool can be
			 * legitimately empty — a plugin's node ships no prose of its own —
			 * and a picker with no rows and no way to add one is a dead end
			 * rather than a default. A create must NAME a pool, and the option
			 * handle is how it does: the row is created from the control that
			 * will hold it, so the pool comes from the declaration rather than
			 * from the client.
			 */
			namespace CreatePrompt {
				interface Params {
					slug: string
					optionId: string
					name: string
					fields: Record<string, string>
					sessionId?: number
				}
				interface Response {
					promptId?: number
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
					/**
					 * Required, and no longer nullable. A preview whose engine
					 * was optional silently previewed in core's language: the
					 * draft rendered here and shipped raw markup in the real
					 * prompt, which is the one failure a preview exists to
					 * catch.
					 */
					engine: string
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
					sessionId?: number
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
					/** Registered engine id; null/absent means core's default. */
					engine?: string | null
					sessionId?: number
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
					sessionId?: number
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
					/**
					 * Which language to write it in — one of the engines the
					 * slot accepts. Absent means the slot's first, which is
					 * what every caller predating engine sets gets.
					 *
					 * Sent rather than inferred server-side because a slot
					 * accepting two languages has no way to know which one the
					 * person clicking `+` meant.
					 */
					engine?: string | null
					sessionId?: number
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
					sessionId?: number
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
					/** Registered engine id; null/absent means core's default. */
					engine?: string | null
					sessionId?: number
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
					sessionId?: number
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
					/** The pool: `<nodeDefinitionId>#<slot>`. */
					poolId: string
					/** Step name plus slot — what the page groups on. */
					poolLabel: string
					/** The pipeline it was authored in, when it records one. */
					origin?: string
					name: string
					isImmutable: boolean
					fields: Record<string, string>
					/** Text for fields the slot no longer declares. */
					archived: Record<string, string>
					/** Pipelines currently pointing at it, by display name. */
					usedBy: string[]
				}
				interface LibraryTemplate {
					id: number
					name: string
					source: string
					engine: string
					isImmutable: boolean
					/** The pool: a node type id, or a variable id. */
					poolId: string
					/**
					 * Must name the ENGINE as well as the node or variable — the
					 * pool is `(what it renders, which language)`, so two pools
					 * for one node type would otherwise render as one heading
					 * with each language's rows mixed into the other's.
					 */
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
					/**
					 * Every `(node type, slot)` pool a registered node declares,
					 * including the empty ones — a plugin's node that ships no
					 * prose still needs a heading to create the first row under.
					 */
					promptPools?: LibraryPool[]
					/**
					 * Every registered template engine — core's plus whatever
					 * enabled extensions declare. The editor's picker renders
					 * from this; a lone entry means no picker at all.
					 */
					engines?: Array<{ id: string; owner: string }>
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
					/** Registered engine id; null/absent means core's default. */
					engine?: string | null
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
					/** Registered engine id; null/absent means core's default. */
					engine?: string | null
				}
				interface DeleteParams {
					kind: Kind
					id: number
				}
				interface Response {
					library?: Library.Response
					error?: string
					/**
					 * Names the saved template references that the step does
					 * not supply.
					 *
					 * Advice, never a refusal: the template parsed and it will
					 * render — each of these renders as nothing, which is a
					 * silence the person who just saved is the only one placed
					 * to recognise. A syntax error comes back as `error`
					 * instead, and nothing is written.
					 */
					warnings?: TemplateWarning[]
				}
			}
			/** Something to say about a template, and where in it. */
			interface TemplateProblem {
				message: string
				line?: number
				column?: number
			}
			/** One unsupplied name, with where the template says it. */
			interface TemplateWarning extends TemplateProblem {
				name: string
			}
			namespace ValidateTemplate {
				interface Params {
					/** "context" for a whole template, "variable" for a layout. */
					kind: "context" | "variable"
					source: string
					/** The engine the row declares. Required — see PreviewTemplate. */
					engine: string
					/** The pool the draft belongs to — a node type or a variable id. */
					poolId: string
				}
				interface Response {
					/** A syntax error, if the source does not parse at all. */
					syntax?: TemplateProblem
					warnings: TemplateWarning[]
					/**
					 * False when the engine is a plugin's and core cannot
					 * analyse it. An empty `warnings` then means "not looked
					 * at", which an editor must not draw as a clean bill.
					 */
					checked: boolean
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
			/**
			 * The scripts page (18 §4d): every registered script type, every
			 * authored row, and what is holding each one. Grouped by type on
			 * the client — the content segment is in the id for exactly this.
			 */
			namespace Scripts {
				interface Params {}
				interface ScriptKind {
					/** Pinned id — `core:script:text/transform@1`. */
					typeId: string
					content: string
					operation: string
					semantics: "transform" | "verdict"
					name: string
					description: string
					/** The badge — what a script of this type is able to do. */
					blastRadius: string
					/** The variable space, from the type's declared ports. */
					varsIn: string[]
					varsOut: string[]
					/**
					 * Read-only context some hook supplies beyond the ports —
					 * the union across every hook accepting this type. Part of
					 * the fixed choice set for declared reads; never writable.
					 */
					extras: string[]
				}
				interface Script {
					id: number
					typeId: string
					name: string
					isImmutable: boolean
					enabled: boolean
					source: string
					/** Declared variable I/O (18 §6a). In-but-not-out is read-only. */
					varsIn: string[]
					varsOut: string[]
					/** Pipelines whose chains currently include it. */
					usedBy: string[]
				}
				interface Response {
					types?: ScriptKind[]
					scripts?: Script[]
					error?: string
				}
			}
			/**
			 * Sharing (18 §2, U-S7): the artifact carries the declared I/O so
			 * an importer sees what each script reads and rewrites before
			 * running it; import is per-script opt-in with a report — every
			 * entry lands or is named with a reason.
			 */
			namespace ScriptShare {
				interface ExportParams {
					ids: number[]
				}
				interface ExportResponse {
					blob?: unknown
					filename?: string
					error?: string
				}
				interface ImportParams {
					/** Parsed JSON — a bare entry or a scripts@1 pack. */
					artifact: unknown
					/** Pack indexes to import; absent means all. */
					accept?: number[]
				}
				interface ImportResponse {
					report?: {
						imported: Array<{ name: string; renamed?: string }>
						skipped: Array<{ name: string; reason: string }>
					}
					scripts?: Scripts.Response
					error?: string
				}
			}
			/** Writes on the scripts page. Admin-gated, like the library's. */
			namespace ScriptWrite {
				interface CreateParams {
					typeId: string
					name?: string
				}
				interface CloneParams {
					id: number
					name?: string
				}
				interface UpdateParams {
					id: number
					name?: string
					source?: string
					enabled?: boolean
					varsIn?: string[]
					varsOut?: string[]
				}
				interface DeleteParams {
					id: number
				}
				interface Response {
					scripts?: Scripts.Response
					error?: string
				}
			}
			/** The management page: versions, publish state, and the boot diagnostic. */
			/** The configurations inventory (admin IA 2026-08-28): every named
			 * config across every spec, with its dependents — the reverse edges
			 * the workspaces cannot show. Editing stays in the workspace. */
			namespace ConfigsIndex {
				interface Params {}
				interface Row {
					id: number
					name: string
					specSlug: string
					specName: string
					isDefault: boolean
					isImmutable: boolean
					usedByPresets: number
					usedBySessions: number
					updatedAt: string | null
				}
				interface Response {
					configs: Row[]
				}
			}
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
								/** `inlet` | `query` | `task` | `oracle` | `outlet`. */
								kind: string
								definitionId: string
								/** Which block it belongs to, if any. */
								clauseId: string | null
								/** `async` | `map` | `loop`. */
								clauseKind: string | null
								/** Which chain within the block — parallel arms. */
								clauseChain: string | null
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
							 * The declared clauses, which say what a frame *means*.
							 *
							 * `each` needs what it iterates over and how many times
							 * at most; `gather` needs whether its chains actually run
							 * concurrently or merely together; `loop` needs its
							 * condition. None of that is derivable from the nodes or
							 * the edges — `over` is a data reference the edge table
							 * never carried — so it is read from `pipeline_clauses`
							 * rather than inferred.
							 */
							clauses: {
								id: string
								kind: string
								/** `parallel` | `sequential`, for gather. */
								mode: string | null
								max: number | null
								/** The port this iterates over, e.g. `batches`. */
								over: string | null
								/** Which clause this one nests inside; null = the spine. */
								parentClauseId: string | null
								/**
								 * loop only — the port whose truthiness repeats
								 * the body ("repeats while generate.hasToolCalls").
								 * The renderable half of the construct (20 §10).
								 */
								repeatWhile: string | null
								/** junction only — the port the branches are chosen on ("junction on parse.call"). */
								on: string | null
								/**
								 * junction only — each branch's declared predicate,
								 * keyed by chain name. Declarations, never code.
								 */
								branches: Record<
									string,
									{
										path?: string
										equals?: unknown
										truthy?: boolean
										default?: boolean
									}
								> | null
								/**
								 * The `ConfigStep` that configures the clause itself.
								 *
								 * A clause carries a setting of its own — whether its
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
					sessionId?: number
					/** Only this pipeline's runs — filtered on the server, before `limit`. */
					specSlug?: string
					limit?: number
				}
				interface Response {
					runs: {
						id: number
						runId: string
						specSlug: string
						/** Whose run it is: the list is an administrator's, of every user's runs (R55). */
						userId: number | null
						username?: string | null
						/** The authored semver the slug resolved to. */
						specVersion: string
						/**
						 * The canonical hash of the document this run actually
						 * ran (ruling 2026-09-10).
						 *
						 * The slug and semver name an indirection: an edited
						 * document republishes under the same semver and the
						 * slug moves on, so the pair says *which pipeline* and
						 * this says *which document*. Null on a run that
						 * recorded none, which is one written before the column
						 * existed and whose backfill found no version row.
						 */
						specHash: string | null
						/**
						 * Whether the slug still resolves to that document.
						 *
						 * False for a receipt whose pipeline has been edited
						 * since — and false for one with no hash at all, because
						 * "current" would be a claim the row cannot support.
						 */
						specHashIsCurrent: boolean
						/**
						 * Set when the pinned document was superseded by the
						 * one-shot rename of 2026-09-16 rather than by an edit —
						 * the same content under new words and a new hash. The
						 * inspector reads *renamed <date>*, not *superseded*.
						 */
						specHashRenamedAt: string | null
						outcome: string
						haltNodeKey: string | null
						haltReason: string | null
						elapsedMs: number
						tokensSpent: number
						isPreview: boolean
						/**
						 * Every row this run produced, in the order it made
						 * them.
						 *
						 * Replaced a single `messageId`, which could only ever
						 * name one message and named none at all for the runs
						 * that produce several (greeting seeding) or produce
						 * something other than a message (an image render, a
						 * summary entry). Ruled 2026-09-08: messages are
						 * relational artifacts.
						 *
						 * `kind` is `message` | `file` | `variant` |
						 * `lore_entry`; `action` is `created` | `updated` |
						 * `attached`. `entityId` is the row's id in its own
						 * table — and deliberately not a foreign key behind the
						 * scenes, because the evidence outlives its subject.
						 */
						artifacts: {
							kind: string
							entityId: number
							action: string
						}[]
						/**
						 * The session this run belonged to, when it belonged to
						 * one.
						 *
						 * Carried so a receipt on screen can offer the
						 * session-wide view beside it — the run says what fired
						 * this turn, `pipelines:sessionEntryUsage` says what
						 * has ever fired, and without this the panel showing
						 * the first has no way to ask for the second. Null on a
						 * run with no session, and on one whose session has
						 * since been deleted (the column is `set null`).
						 */
						sessionId: number | null
						startedAt: string
					}[]
				}
			}
		}

		// Narrator Prompt Configs namespace ("Session Prompts: Narrator")
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
			/** What a model file is. "unknown" = the classifier could not tell;
			 * shown in both lists rather than hidden from either. */
			type ModelKind = "text" | "image" | "unknown"
			/** How good the `kind` answer is, descending: who is allowed to
			 * overwrite it. Nothing automatic ever overwrites "user". */
			type ModelKindSource = "user" | "detected" | "declared" | "assumed"
			/** A kind a caller can ASK for. "unknown" is an answer, never a request. */
			type ModelKindFilter = "text" | "image"

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
					/**
					 * Which directory this sets. REQUIRED, with no default: there
					 * are two columns now, and a caller that forgot to say would
					 * silently repoint the other one — which reads to a user as
					 * every model they own disappearing at once.
					 */
					kind: ModelKindFilter
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
					/** Required, not optional: every scanned file is backed by a
					 * row whose kind/kind_source columns are NOT NULL. */
					kind: ModelKind
					kindSource: ModelKindSource
					/** Why the classifier said so, for the Unverified badge's tooltip. */
					kindReason?: string
					/**
					 * Which directory the file was actually found in — evidence, not
					 * a verdict. A model whose `kind` disagrees with this is either a
					 * user override or a legacy flat install, and the UI needs to be
					 * able to tell those apart from a file sitting where it belongs.
					 */
					dirKind: ModelKindFilter
				}
				interface Response {
					currentModel: string | null
					availableModels: ModelFile[]
					/**
					 * The TEXT models directory is set. Keeps its original meaning
					 * rather than widening to "either", because three client files
					 * already read it and a silently-broadened flag would have them
					 * claiming a directory is configured when the one they are
					 * showing is not.
					 */
					/**
					 * A models directory is configured at all.
					 *
					 * One flag for both kinds, because the image directory falls
					 * back to the text one when unset — so a separate
					 * `imageModelsDirSet` could only ever repeat this value, and a
					 * second source for one fact is how the two come to disagree.
					 */
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
			/**
			 * The image counterpart of ConnectModel, and a separate event rather
			 * than a `kind` param on it: the two branches share almost nothing.
			 * Different type predicate, different response.
			 *
			 * They no longer differ in how the default is registered, which used
			 * to be the third reason: text starred
			 * `system_settings.default_connection_id` — a slot an image
			 * connection had no business claiming — while image wrote
			 * `connection_defaults`. Both write `connection_defaults` now, under
			 * the capability each one actually means.
			 */
			namespace ConnectImageModel {
				interface Params {
					filename: string
				}
				interface Response {
					success?: string
					error?: string
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
				/**
				 * One model this process believes is loaded, plus the knobs it was
				 * loaded with. The knob fields are per-kind and mutually exclusive:
				 * contextSize/gpuLayers/flashAttention/batchSize are text-only,
				 * threads/quant are image-only. They are optional here rather than
				 * split into a union because this crosses the wire and the client
				 * reads them for display, never to decide anything.
				 */
				interface Resident {
					file: string
					contextSize?: number
					gpuLayers?: number
					flashAttention?: boolean
					batchSize?: number
					threads?: number
					quant?: 0 | 1 | 2
				}
				interface Response {
					/**
					 * What is resident, per kind — null if nothing is loaded, or if
					 * this process does not know (right after a restart, say;
					 * koboldcpp does not expose these for querying).
					 *
					 * A map rather than one model, because "how many are resident"
					 * is the model manager's decision and not this payload's. Today
					 * exactly one key is ever present; a client that reads both
					 * keeps working when that stops being true.
					 */
					config: {
						resident: { text?: Resident; image?: Resident }
						rawConfigJson: string
					} | null
				}
			}
			namespace SearchModels {
				interface Params {
					searchTerm: string
					/** Defaults to "text" when absent. */
					kind?: ModelKindFilter
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
					/** Repo carries the `stable-diffusion.cpp` tag — the exact GGUF
					 * flavour koboldcpp requires. Badged and sorted first, never
					 * filtered on: legitimate SDXL repos are tagged `diffusers`. */
					sdcpp?: boolean
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
					/** The tab the user was in. Stored with kind_source "declared";
					 * the finished file is then sniffed and may correct it — a
					 * declaration is a guess about a file, a detection is a
					 * measurement of the file we now hold. Defaults to "text". */
					kind?: ModelKindFilter
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
					/** The list's quoted size in decimal bytes (the YAML's GB × 1e9);
					 * absent when the list quotes none. The Hub's sibling list
					 * carries no sizes, so `pullOptions[].sizeBytes` is usually empty. */
					sizeBytes?: number
					recommendedVram?: number
					parameterSize?: string
				}
				interface Params {
					/** Defaults to "text" when absent. */
					kind?: ModelKindFilter
				}
				interface Response {
					models: RecommendedModel[]
					/**
					 * The catalog could not be fetched, as opposed to being
					 * empty. The two look identical in a list and mean opposite
					 * things: empty says "there are none, go search Hugging
					 * Face", while failed usually means Hugging Face is exactly
					 * what is unreachable.
					 */
					failed?: boolean
				}
			}
			namespace SetModelKind {
				interface Params {
					filename: string
					kind: ModelKindFilter
				}
				interface Response {
					success: boolean
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

		// Session Lorebooks namespace
		namespace SessionLorebooks {
			namespace Get {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionLorebooks: SelectSessionLorebook[]
				}
			}
			namespace Add {
				interface Params {
					sessionLorebook: InsertSessionLorebook
				}
				interface Response {
					sessionLorebook: SelectSessionLorebook
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
						session: SelectSession | null
						character: SelectCharacter | null
						persona: SelectCharacter | null
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
						session: SelectSession | null
						character: SelectCharacter | null
						persona: SelectCharacter | null
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
								session: SelectSession | null
								character: SelectCharacter | null
								persona: SelectCharacter | null
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
					/**
					 * What every embedded row's `embedding_model` is compared
					 * against — a HuggingFace id, or `api::baseUrl::model`.
					 *
					 * Null when nothing is starred for `text->embedding`, which
					 * is what "embeddings are off" means now. Derived from the
					 * star rather than read from a column: it replaces
					 * `system_settings.embedding_model_name`, which four
					 * handlers had to keep in step with two other columns.
					 */
					activeEmbeddingModel: string | null
					/**
					 * The instance default connection and sampling config, per
					 * capability (0175). Keyed by `CapabilityId`. The ONLY place a
					 * default arrives from — `system_settings` no longer carries
					 * one (0181).
					 *
					 * Sent explicitly rather than riding on the settings row, because
					 * it is its own table now — a column pair per capability does not
					 * scale to an open capability space.
					 *
					 * ⚠ NOT optional, deliberately. It was, and an optional field is
					 * an open invitation for `?? settings.defaultConnectionId` to
					 * grow back beside it the moment a reader has to handle
					 * `undefined`. An instance with no defaults registered sends
					 * `{}`, which says the same thing without a second branch.
					 */
					capabilityDefaults: Record<string, CapabilityDefault>
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
			namespace UpdateRequireTwoFactor {
				interface Params {
					enabled: boolean
				}
				interface Response {
					success: boolean
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
			/**
			 * The two backup settings (ruled 2026-09-10).
			 *
			 * One event for both because they are one decision an admin makes
			 * about backups, and because a partial update is expressible: an
			 * omitted field is left alone rather than defaulted to false.
			 */
			namespace UpdateBackupSettings {
				interface Params {
					/** Take one a day. Omit to leave as it is. */
					backupDaily?: boolean
					/** Archive `users/` beside the dump. Omit to leave as is. */
					backupIncludeUserFiles?: boolean
				}
				interface Response {
					success: boolean
					backupDaily: boolean
					backupIncludeUserFiles: boolean
				}
			}
			/** The scripts kill switch (18 §10) — a recovery lever, default on. */
			namespace UpdateScriptsEnabled {
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
			/**
			 * Show or hide the Legacy configs panel (the 0.5 archives). The
			 * column has existed since the changeover — this is the write the
			 * admin Settings page needed; the nav already honors the read.
			 */
			namespace UpdateLegacyConfigsVisible {
				interface Params {
					visible: boolean
				}
				interface Response {
					success: boolean
					visible: boolean
				}
			}
			/**
			 * The instance's language (R5) — the admin's setup choice, and what
			 * every user who has not picked one of their own inherits.
			 */
			namespace UpdateDefaultLanguage {
				interface Params {
					/** ISO 639-1, from `LANGUAGES`. Refused otherwise. */
					language: string
				}
				interface Response {
					success: boolean
					language: string
				}
			}
			/**
			 * Whether the server may call an outside service to fill in UI
			 * strings, and which one. Off until an admin says otherwise — see
			 * the schema note on `auto_translate_enabled`.
			 */
			namespace UpdateAutoTranslate {
				interface Params {
					enabled: boolean
					engine: "google" | "libre"
					/** LibreTranslate base URL; ignored by `google`. */
					endpoint: string | null
				}
				interface Response {
					success: boolean
				}
			}
		}

		/**
		 * UI language (plan `retrieval-and-knowledge` §7 R5).
		 *
		 * One event, because there is only one question the client asks: "what
		 * do these English strings say in my language?" Everything else about
		 * language — which one, who set it — travels on the settings rows the
		 * client already receives.
		 */
		namespace Language {
			namespace Catalog {
				interface Params {
					/**
					 * English source strings the client has rendered and has no
					 * translation for. Capped server-side, both in count and in
					 * per-string length; see `server/i18n/translate.ts`.
					 */
					sources: string[]
				}
				interface Response {
					/** The caller's effective language, resolved server-side. */
					language: string
					/**
					 * Source → translation, for whatever could be answered. A
					 * requested string may legitimately be **absent**: the
					 * instance has no translation and auto-translation is off,
					 * or the engine failed. The client keeps showing English,
					 * which is why absence is not an error.
					 */
					entries: Record<string, string>
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
						enableEasyCharacterCreation: boolean
						showAllCharacterFields: boolean
						backgroundImagePath: string | null
						backgroundOpacity: number
						charaVaultIncludeNsfw: boolean
						/**
						 * The user's own choice (R5), or **null** meaning "follow
						 * the instance default".
						 *
						 * Sent as stored rather than pre-resolved, deliberately:
						 * the settings picker has to be able to show "Use the
						 * server default" as a distinct state from an explicit
						 * choice that happens to match it. `effectiveLanguage`
						 * beside it is what the UI actually renders in.
						 */
						language: string | null
						/**
						 * The resolved answer — user, else instance, else `en`.
						 * The one field anything drawing the interface reads.
						 */
						effectiveLanguage: string
					}
				}
			}
			/** Pick a UI language, or null to follow the instance default (R5). */
			namespace UpdateLanguage {
				interface Params {
					/** ISO 639-1 from `LANGUAGES`, or null to inherit. */
					language: string | null
				}
				interface Response {
					success: boolean
					language: string | null
					effectiveLanguage: string
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
			// ⚠ There is no `updateEasyPersonaCreation`: a persona is a
			// character, so the switch below governs both surfaces.
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
			/** Scene with resolved session name for sidebar display */
			interface SceneWithMeta extends SelectScene, SceneCast {
				sessionName: string | null
			}
			namespace List {
				interface Params {
					sessionId: number
				}
				/** Scene enriched with its history entry data for session display */
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
					/**
					 * Which session these scenes belong to.
					 *
					 * Present so the **interest scope** can be derived: the
					 * list is re-sent as a cascade after every scene write, and
					 * a tab reading another session has no use for it. Required
					 * rather than optional because every producer knows it —
					 * the handler takes it as a parameter, and the create,
					 * update and delete cascades pass the written scene's.
					 */
					sessionId: number
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
			/** Get all message IDs already captured in scenes for a session */
			namespace SenedMessageIds {
				interface Params {
					sessionId: number
				}
				interface Response {
					/**
					 * Which session these captured messages belong to.
					 *
					 * Present so the **interest scope** can be derived — see
					 * `List.Response` above, which carries it for the same
					 * reason and from the same producers.
					 */
					sessionId: number
					scenedMessageIds: number[]
				}
			}
			namespace Compile {
				interface Params {
					historyEntryId: number
				}
				interface Progress {
					/**
					 * Which history entry is being compiled.
					 *
					 * Present so the **interest scope** can be derived: the
					 * push fans out to the caller's whole user room, and a
					 * second tab compiling another entry has no business
					 * being shown this one's batches. `Response` below has
					 * always carried it; this is the same id on the progress
					 * frames that precede it.
					 */
					historyEntryId: number
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
					 * session-side summarize flow), so abandoning the run should
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

		// Legacy namespace for backward compatibility with old session message events
		namespace SessionMessage {
			interface Call {
				sessionMessage?: SelectSessionMessage
				id?: number
			}
			interface Response {
				// sessionMessageHandler ("sessions.ts") omits `sessionMessage` and sets
				// `error` instead on the not-found/invalid-params/exception paths
				// (see the "sessionMessage:error" emits), so both fields are optional.
				sessionMessage?: SelectSessionMessage
				error?: string
			}
		}

		/**
		 * Named entities — the annotation lane's model, as the sidebar sees it.
		 *
		 * ⚠ One event, not three. There is no `enable`, no `setModel` and no
		 * `loadModel` here: an entity backend is an ordinary connection, so
		 * creating and editing one is `connections:create`/`update` and choosing
		 * which one runs is `connections:setDefault`. What is left is the one
		 * question a screen cannot answer for itself.
		 */
		namespace Ner {
			namespace Status {
				interface Params {}
				interface Response {
					/** Is a `text->entities` connection starred? */
					starred: boolean
					/** The identity the lane would annotate under, or null. */
					modelId: string | null
					/** True once the model is loaded and the lane can use it. */
					modelReady: boolean
					/** The last load failure, or null. The lane keeps going without it. */
					loadError: string | null
					/**
					 * Annotated ROWS — entries and messages — not the entity rows
					 * underneath them.
					 *
					 * The number the switch confirmation quotes, and the reason it
					 * rides here rather than on an event of its own: it is one count
					 * query, asked at the same two moments as the rest of this.
					 *
					 * ⚠ No rate estimate accompanies it. Nothing in the lane measures
					 * throughput, so there is no honest "roughly N minutes" to put
					 * beside it.
					 */
					annotatedRows: number
					/** True while the model is resident. */
					loaded?: boolean
					/** ISO time the lane last used the model, or null. */
					lastUsedAt?: string | null
					/** Minutes idle before the lane unloads it. */
					ttlMinutes?: number
				}
			}
			/** Unload the entity model now. It reloads on the next message that needs it. */
			namespace UnloadModel {
				interface Params {}
				interface Response extends Status.Response {}
			}
		}

		// Vectorization namespace
		namespace Vectorization {
			/**
			 * A priority group in the embedding queue. Groups are processed in order;
			 * within each group the order is: messages → lorebook content → characters → personas.
			 */
			interface PriorityGroup {
				groupId: string
				label: string
				ownerDisplayName: string
				sessionId?: number
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
					/**
					 * The starred embedding connection, or null when nothing is
					 * starred — which is what "embeddings are off" means now.
					 */
					activeConnectionId: number | null
					/**
					 * The identity every embedded row is stamped with: a
					 * HuggingFace id, or `api::baseUrl::model`.
					 */
					activeModelName: string | null
					/** True if the active backend is loaded/validated and ready to embed */
					modelReady: boolean
					/** True if the model files are in the local cache (local only — false for a host) */
					modelCached: boolean
					/** Last load error message, if any */
					loadError: string | null
				}
			}

			/**
			 * Bring the starred backend up now. Configures nothing.
			 *
			 * ⚠ Replaces `enable`, `disable`, `setModel` and `setApiConfig`,
			 * all four of which wrote a column and then loaded. An embedding
			 * endpoint is an ordinary connection, so creating and editing one
			 * is `connections:create`/`update` and choosing which one runs is
			 * `connections:setDefault` — leaving only "the server restarted,
			 * load it again".
			 */
			namespace LoadModel {
				interface Params {}
				interface Response {
					success: boolean
					error?: string
				}
			}

			/**
			 * What moving the embedding star would cost, for the confirmation
			 * that precedes it.
			 *
			 * ⚠ Rows only. Nothing in the queue measures throughput, so there is
			 * no honest rate to put beside it.
			 */
			namespace ReindexCost {
				interface Params {}
				interface Response {
					/** How many rows currently carry a vector. */
					rows: number
					/**
					 * The same rows by what they are — `lorebookEntries`,
					 * `messages`, `characters`, … — so the switch confirmation can
					 * say "every entry in N lorebooks and the history of M
					 * sessions" instead of one bare number. Keys are the owner
					 * kinds the server counts; a kind with zero rows is omitted.
					 */
					byKind?: Record<string, number>
					/** Distinct lorebooks / sessions those rows belong to. */
					lorebooks?: number
					sessions?: number
				}
			}
			/** The embedding lane's residency, for the endpoint header and model view. */
			namespace Status {
				interface Params {}
				interface Response {
					/** Is a `text->embedding` connection starred? */
					starred: boolean
					/** The identity vectors are stamped with, or null. */
					modelId: string | null
					loaded: boolean
					loadError: string | null
					lastUsedAt: string | null
					ttlMinutes: number
					/** The queue: rows waiting to be embedded. */
					pending: number
				}
			}
			/** Unload the embedding model now. Autostart reloads it when the queue has work. */
			namespace UnloadModel {
				interface Params {}
				interface Response extends Status.Response {}
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
					/** Add a session and all its linked lorebooks/characters/personas */
					sessionId?: number
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
			 * Check the RAG embedding status for all content linked to a session:
			 *  - Messages older than the last 10 (last 10 assumed in context window)
			 *  - Characters linked to the session
			 *  - Personas linked to the session
			 *  - Lorebook entries (world lore, character lore, history) for the session's
			 *    lorebook and each linked character's lorebook
			 */
			namespace CheckRagStatus {
				interface Params {
					sessionId: number
				}
				interface Response {
					/** False when vectorization is disabled or session has ≤ 10 messages */
					applicable: boolean
					messages: RagTypeCounts
					characters: RagTypeCounts
					personas: RagTypeCounts
					/** null when the session has no associated lorebook */
					lorebook: RagTypeCounts | null
					/** Whether the vectorization queue is currently running */
					queueRunning: boolean
					/** The active embedding model name, or null if none */
					activeModelName: string | null
					/** Whether the user has opted out of RAG for this session */
					ragIgnored: boolean
				}
			}

			/** Set whether RAG is ignored for a specific session */
			namespace SetSessionRagIgnored {
				interface Params {
					sessionId: number
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
			/**
			 * One end of an edge, as a writer states it.
			 *
			 * An endpoint is a cast binding **or** an entry, never both and
			 * never neither — the same rule the table's two CHECK constraints
			 * hold. A road between two places is an edge whose ends are both
			 * entries; a keeper of a shrine is an edge with one of each.
			 */
			type RelationshipEndpoint =
				| { kind: "cast"; bindingId: number }
				| { kind: "entry"; entryId: number }

			/**
			 * One end of an edge, as the server hands it back.
			 *
			 * An entry endpoint carries what a graph needs to draw it as a
			 * node, so a reader never has to go and fetch the row to put a
			 * label on it. A cast endpoint carries no such pair because the
			 * binding it names is already in `nodes`.
			 */
			type WireRelationshipEndpoint =
				| { kind: "cast"; bindingId: number }
				| {
						kind: "entry"
						entryId: number
						name: string
						typeId: EntryTypeId
				  }

			// Inline shape of a persisted narrative relationship (mirrors schema.narrativeRelationships)
			interface NarrativeRelationship {
				id: number
				lorebookId: number
				/** Where the edge starts. The endpoint of record. */
				from: WireRelationshipEndpoint
				/** Where it ends. */
				to: WireRelationshipEndpoint
				/**
				 * ⚠ **Populated only when that end is a cast binding, and kept
				 * for one release.** Every endpoint was a binding before 0124,
				 * so these are what existing readers bind to; an entry endpoint
				 * reads `null` here and is only in `from`/`to`. Read `from`/`to`
				 * — these go in the release after next.
				 */
				fromNodeId: number | null
				toNodeId: number | null
				fromEntryId: number | null
				toEntryId: number | null
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
					/**
					 * The book these nodes belong to.
					 *
					 * ⚠ **Load-bearing, not informational.** `SCOPED_EVENTS`
					 * scopes this event on `payload.lorebookId`; without it the
					 * server's gate resolves the scope to null, matches no
					 * socket — every subscriber holds a SCOPED key — and drops
					 * the reply without a word. Added 2026-09-23 after exactly
					 * that: the Graph lens spun forever and Cast, Book settings
					 * and the workspace's own graph data were all starved.
					 */
					lorebookId: number
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
			/**
			 * One `narrativeGraph:buildLog` push: a trace entry, plus the book
			 * the build was asked for.
			 *
			 * `lorebookId` is present so the **interest scope** can be derived.
			 * It is not on `TraceEntry` itself because that shape is also the
			 * graph builder's `onLlmCall` argument, and the builder knows only
			 * the call it just made — the socket layer adds the book at the
			 * emit, which is where the build was started.
			 */
			interface BuildLogEntry extends TraceEntry {
				lorebookId: number
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
					/**
					 * The two ends. Both endpoints must be in `lorebookId` —
					 * an edge across two lorebooks is refused, not clamped.
					 */
					from?: RelationshipEndpoint
					to?: RelationshipEndpoint
					/**
					 * The pre-0124 spelling of a cast endpoint, accepted for
					 * one release. Ignored when `from`/`to` is given.
					 */
					fromNodeId?: number
					toNodeId?: number
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
					sessionId: number
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
					/** Layer 2: inverse rels from session participants → speaker, acknowledged/public only */
					inverseRelationships: RelationshipEntry[]
					/** Layer 3: legendary/historical nodes + public relationships (RAG-scored) */
					legendaryNodes: LegendaryNodeEntry[]
				}
			}
			/** Link an orphaned lorebook binding to a character, or create/skip */
			namespace LinkOrphanBinding {
				interface Params {
					bindingId: number
					characterId?: number
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
			/** Emitted after a session save when orphaned bindings are found in the lorebook */
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
					sessionId: number
					/** Chars/personas in the session that have no binding (shown if orphaned bindings exist) */
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
						// Individual session logs (sessions/<CharacterName>/<file>.jsonl) are
						// deliberately never staged at scan time -- only their content
						// (potentially large) gets uploaded later for whatever the user
						// actually selects. Their relative paths are sent here instead,
						// purely so the scan can list what's available without needing
						// the files themselves on disk yet.
						deferredSessionPaths?: string[]
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
							sessions: Array<{
								filename: string
								name: string
								characterNames: string[]
								isGroup: boolean
								selected: boolean
								disabled: boolean
								disabledReason?: string
							}>
							groupSessions: Array<{
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
							sessions: Array<{
								filename: string
								name: string
								characterNames: string[]
								isGroup: boolean
								selected: boolean
								disabled: boolean
								disabledReason?: string
							}>
							groupSessions: Array<{
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

		/**
		 * Widget styles (PLAN 25) — the `widget_styles` rows a person may see,
		 * use and manage. One namespace for both halves of the table: the
		 * presets a widget SHIPS (`source: "system"`, reconciler-managed and
		 * never editable here) and the styles people write.
		 *
		 * `list` answers with the rows the caller may USE — system + their own
		 * + everything shared on the instance — which is exactly the candidate
		 * set `shared/widgets/resolve.ts` expects to be handed. Management is a
		 * narrower question than visibility and is decided per verb by the
		 * server; nothing in this shape encodes it.
		 */
		namespace WidgetStyles {
			/** The wire projection of a `widget_styles` row. */
			interface WidgetStyleRow {
				id: number
				slug: string
				widgetSlug: string
				source: "system" | "user"
				/** null for system rows; the author for user rows. */
				ownerUserId: number | null
				visibility: "system" | "private" | "shared"
				title: string
				css: string
				vars: Record<string, string>
				updatedAt: string
			}

			namespace List {
				interface Params {
					/** Narrow to one widget's styles; omit for all of them. */
					widgetSlug?: string
				}
				interface Response {
					/** System + own + shared — the rows this caller may use. */
					styles: WidgetStyleRow[]
				}
			}

			namespace Create {
				interface Params {
					widgetSlug: string
					title: string
					css?: string
					vars?: Record<string, string>
					/** Defaults to "private". */
					visibility?: "private" | "shared"
				}
				interface Response {
					style: WidgetStyleRow
				}
			}

			namespace Update {
				interface Params {
					id: number
					title?: string
					css?: string
					vars?: Record<string, string>
					visibility?: "private" | "shared"
				}
				interface Response {
					style: WidgetStyleRow
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

			namespace Clone {
				interface Params {
					id: number
					/** Defaults to the source row's title plus " (copy)". */
					title?: string
				}
				interface Response {
					/** A new private row owned by the caller, with a new slug. */
					style: WidgetStyleRow
				}
			}
		}

		// Invites namespace (plan 27 §3)
		namespace Invites {
			interface InviteView {
				id: number
				kind: string
				userId: number | null
				/** Present for `account` invites, for the admin list. */
				username: string | null
				expiresAt: Date
				usedAt: Date | null
				revokedAt: Date | null
				createdAt: Date
			}
			/**
			 * A host an invite link could point at. The admin's own origin is added
			 * client-side, since only the browser knows it.
			 */
			interface HostOption {
				hostname: string
				label: string
				source: "tunnel" | "env"
				/** A tunnel always terminates TLS; other hosts follow the page. */
				forceHttps: boolean
				/** Higher wins when preselecting a default. */
				priority: number
			}

			namespace List {
				interface Params {}
				interface Response {
					invites: InviteView[]
					hostOptions: HostOption[]
				}
			}
			namespace Create {
				interface Params {
					kind: "register" | "account"
					/** Required for `account`; ignored for `register`. */
					userId?: number
				}
				interface Response {
					/** Returned once and never again — only the hash is stored. */
					token: string
					id: number
					expiresAt: Date
				}
			}
			namespace Revoke {
				interface Params {
					id: number
				}
				interface Response {
					success: boolean
				}
			}
		}

		// Account setup namespace (plan 27 §1)
		namespace Account {
			/** Ordered; the first entry is what the client should show. */
			type SetupStep = "password" | "twoFactor"

			namespace SetupState {
				interface Params {}
				interface Response {
					pending: SetupStep[]
					/** False means two-factor is offered but may be declined. */
					twoFactorRequired: boolean
				}
			}
			namespace SetPassword {
				interface Params {
					passphrase: string
				}
				interface Response {
					/** What remains after this step. */
					pending: SetupStep[]
				}
			}
		}

		// Totp namespace (plan 26 §10)
		namespace Totp {
			namespace Status {
				interface Params {}
				interface Response {
					/** A secret exists — enrolment may be half-finished. */
					enrolled: boolean
					/** The factor is in force. */
					enabled: boolean
					/** Unused recovery codes. Zero while enabled is a lockout waiting. */
					remainingCodes: number
					/** This session still owes a code before it can do anything. */
					verificationRequired: boolean
				}
			}
			namespace EnrollBegin {
				interface Params {}
				interface Response {
					/** Returned in the clear so it can be typed into an app that cannot scan. */
					secret: string
					otpauthUri: string
				}
			}
			namespace EnrollConfirm {
				interface Params {
					code: string
				}
				interface Response {
					/** Shown exactly once; only hashes are stored. */
					recoveryCodes: string[]
				}
			}
			namespace Verify {
				interface Params {
					/** A TOTP code or an unused recovery code. */
					code: string
				}
				interface Response {
					/** True means the authenticator is probably gone — prompt to re-enrol. */
					usedRecoveryCode: boolean
					remainingCodes: number
				}
			}
			namespace RegenerateCodes {
				interface Params {}
				interface Response {
					recoveryCodes: string[]
				}
			}
			namespace Disable {
				interface Params {
					code: string
				}
				interface Response {
					success: boolean
				}
			}
			namespace AdminClear {
				interface Params {
					userId: number
				}
				interface Response {
					success: boolean
				}
			}
		}

		// AllowedHosts namespace (plan 26 §9) — read-only. See
		// sockets/allowedHosts.ts for why there is no write side.
		namespace AllowedHosts {
			/**
			 * Where a host came from. `builtin` is this machine reaching itself,
			 * `env` is ALLOWED_ORIGINS, `tunnel` is the hostname a running tunnel
			 * currently answers on — allowed by the same-hostname rule rather than
			 * by being on the list, which the UI says out loud.
			 */
			type AllowedHostSourceName = "builtin" | "env" | "tunnel"

			interface HostEntry {
				hostname: string
				source: AllowedHostSourceName
			}

			namespace Get {
				interface Params {}
				interface Response {
					/**
					 * ALLOWED_ORIGINS=* disables the allowlist entirely. When true,
					 * every entry below is inert and the UI must lead with that.
					 */
					wildcard: boolean
					hosts: HostEntry[]
				}
			}
		}

		// Backups namespace (PLAN-pglite-recovery P2).
		//
		// The read/create/delete half of `db/recovery.ts`, which the recovery
		// page and the CLI also share. Restore is deliberately NOT here: on a
		// healthy instance it would mean swapping the database out from under a
		// live socket connection, and the only state in which restoring is the
		// right answer is the one where this surface does not exist — the
		// database will not open, so neither will these handlers.
		namespace Backups {
			interface BackupRow {
				/** Filename only. Every action below takes this back. */
				name: string
				bytes: number
				/** ISO 8601, from the file's mtime. */
				modifiedAt: string
				/** Whether a companion meta.json was archived beside it. */
				hasMeta: boolean
				/**
				 * Whether a user-file tier (`<name>.users.tgz`) is beside it —
				 * media and avatars, off by default (ruled 2026-09-10).
				 */
				hasUsers: boolean
				/** That tier's size. 0 when there is none. */
				usersBytes: number
			}

			/**
			 * A database a recovery set aside, or an attempted restore that did
			 * not open. Never deleted automatically — listed here so the owner
			 * can reclaim the disk without going back to the recovery page,
			 * which is unreachable once the instance is working again.
			 */
			interface SetAsideRow {
				name: string
				bytes: number
				modifiedAt: string
				kind: "broken" | "restore-failed"
			}

			namespace List {
				interface Params {}
				interface Response {
					backupsDir: string
					dataDir: string
					backups: BackupRow[]
					setAside: SetAsideRow[]
				}
			}

			namespace Create {
				interface Params {
					/** Goes in the filename; defaults to the stored version. */
					label?: string
					/**
					 * One-shot override of `backupIncludeUserFiles`. Omitted —
					 * the normal case — the stored setting decides.
					 */
					includeUserFiles?: boolean
				}
				interface Response {
					backup: BackupRow
				}
			}

			namespace Delete {
				interface Params {
					name: string
					/** `"backup"` removes a .tgz; `"setAside"` a directory. */
					kind: "backup" | "setAside"
				}
				interface Response {
					name: string
					success: boolean
				}
			}
		}

		// Tunnels namespace (plan 26 §8)
		//
		// Its own namespace and its own server file, deliberately never folded
		// into Connections: a tunnel gates whether this instance is reachable
		// from the public internet, which is not the kind of thing that should
		// share a surface with LLM endpoints. Never exposed to the plugin/hook
		// broker's callable surface at all.
		namespace Tunnels {
			/**
			 * The client-safe projection of a tunnel row.
			 *
			 * Spelled out field by field rather than derived as
			 * `Omit<SelectTunnel, "credential">`, on purpose: this is a wire
			 * contract, and deriving it from the table would let a future
			 * column join the client payload silently just by existing. The
			 * one field that must never be here is the credential — it is
			 * dropped entirely rather than masked, and `credentialSet` is all
			 * the UI needs to render "configured".
			 */
			interface TunnelView {
				id: number
				serverId: number
				provider: string
				mode: string
				hostname: string | null
				enabled: boolean
				autoStart: boolean
				status: string
				lastError: string | null
				ttlSeconds: number | null
				expiresAt: Date | null
				startedAt: Date | null
				stoppedAt: Date | null
				createdAt: Date
				updatedAt: Date
				credentialSet: boolean
			}

			namespace Get {
				interface Params {}
				interface Response {
					/** The seeded `local` server this tunnel belongs to. */
					serverId: number | null
					/** Null until an admin has configured one. */
					tunnel: TunnelView | null
					/**
					 * False when tunnels can't be used on this instance at all —
					 * the Android build today (26 §7). The UI hides the section;
					 * the server refuses regardless, so this is presentation only.
					 */
					available: boolean
					/** Human-readable reason when `available` is false. */
					unavailableReason?: string
					/**
					 * Whether accounts are on. Enabling a tunnel requires them
					 * (26 §5); surfaced so the UI can explain the disabled switch
					 * rather than just refusing on click.
					 */
					accountsEnabled: boolean
				}
			}

			namespace UpdateConfig {
				interface Params {
					provider: string
					mode: string
					/** Required for persistent providers; ignored for ephemeral. */
					hostname?: string | null
					/** Null = no expiry. */
					ttlSeconds?: number | null
					autoStart?: boolean
					/**
					 * Write-only. Omit to leave the stored credential untouched;
					 * pass null to clear it. Never echoed back.
					 */
					credential?: string | null
				}
				interface Response {
					tunnel: TunnelView
				}
			}

			namespace Enable {
				interface Params {}
				interface Response {
					tunnel: TunnelView
				}
			}

			namespace Disable {
				interface Params {}
				interface Response {
					tunnel: TunnelView
				}
			}
		}

		/**
		 * Stats and states (`DESIGN-stats-and-states.md`).
		 *
		 * Everything here is **session-scoped and resolved**: a caller reads
		 * what a value *is* after the session → lorebook → card → default
		 * chain, and writes at the session layer. The template layers — a
		 * card's starting values, a world's base ones — belong to the card
		 * editor and the lorebook workspace, which is why no verb here names
		 * them: this is the playing surface, and structure is authored away
		 * from it.
		 *
		 * A slot id is `owner:slot/name@N`; the values a template reads are
		 * keyed by the bare name (`hp`), which is the resolver's business and
		 * not this wire's.
		 */
		namespace State {
			/** An owner, as everything above the tables names one. */
			interface Owner {
				kind:
					| "card"
					| "cast_member"
					| "lorebook"
					| "session"
					| "session_cast"
				id: number
			}

			/** The resolved shape — the same object templates read as `state`. */
			interface ResolvedState {
				world: Record<string, unknown>
				cast: Record<string, Record<string, unknown>>
				possessions: Record<
					string,
					{ entryId: number; name: string; quantity: number }[]
				>
				/** The session's state version (U5f) — moved by every applied change. */
				version?: number
			}

			/**
			 * One held change, as the ledger renders it. `superseded` (U5f) is
			 * an accept that found the slot moved since `baseVersion`: decided,
			 * nothing applied, drawn collapsed with no buttons.
			 */
			interface ProposalRow {
				id: number
				sessionId: number
				messageId: number | null
				kind: "value" | "possession"
				payload: Record<string, unknown>
				status: "pending" | "accepted" | "rejected" | "superseded"
				proposedBy: string
				/** The state version the change is a delta against; null on a pre-U5f row. */
				baseVersion: number | null
				createdAt: string
			}

			/**
			 * What a slot IS, for a surface that has to draw it.
			 *
			 * A value alone cannot be drawn: `14` is a bar only because the
			 * slot is an integer with a floor and a ceiling, and `wary` is a
			 * chip only because the slot is an enum with a closed set. The
			 * registry that knows this is the host's, so the description
			 * travels with the read rather than being re-declared client-side.
			 *
			 * ⚠ `descriptor` is deliberately absent: it is the sentence the
			 * MODEL reads, and a widget rendering it would put prompt text on a
			 * bar.
			 */
			interface SlotDescriptor {
				slotId: string
				/** The key this slot's value is filed under in the state bag. */
				key: string
				/** …and its fully qualified key, always present in the bag. */
				qualifiedKey: string
				label: string
				description?: string
				type:
					| "integer"
					| "enum"
					| "text"
					| "boolean"
					| "list"
					| "derived"
				appliesTo: ("cast" | "world")[]
				/**
				 * A sheet entry said a session of this shape must have a value
				 * (R7). A surface shows it; creation is what refuses.
				 */
				required?: boolean
				/**
				 * Retired (R3): everything stored stays and still resolves,
				 * nothing new is written. A panel greys it with the label it
				 * last had rather than dropping it — the values are somebody's
				 * play. Present only when true.
				 */
				retired?: boolean
				/** The sheet that first named it, when a sheet did. */
				sheetId?: string
			}

			/**
			 * An owner a session's values belong to, keyed exactly as the
			 * resolved state keys them.
			 *
			 * The key is what the state bag uses (`world`, `verity`); the kind
			 * and id are what a write names. Sent rather than derived, because
			 * deriving it client-side would be a second copy of the resolver's
			 * key function, and the first name with an apostrophe in it is
			 * where the two would disagree.
			 */
			interface StateOwnerRow {
				key: string
				kind: "session" | "session_cast"
				id: number
				label: string
				/**
				 * The configuration in force for this owner, per slot — what a
				 * bar's bounds and a chip's options are read from. Only the
				 * slots this owner may carry appear.
				 */
				configs: Record<string, Record<string, unknown>>
			}

			/**
			 * One anchored row, as the transcript ledger reads it.
			 *
			 * The rows, not the resolved answer: resolution says what a stat is
			 * NOW, and a ledger is about what one message changed. Names ride
			 * along so a line needs no second lookup per row.
			 */
			interface LedgerRow {
				id: number
				kind: "value" | "possession"
				messageId: number | null
				ownerKey: string
				ownerLabel: string
				updatedBy: string
				createdAt: string
				/** Value rows. */
				slotId?: string
				slotLabel?: string
				/**
				 * An array for a `list` slot, one thing for every other type
				 * (the SDK's `SlotValue`). Referenced rather than spelled out
				 * so the wire cannot come to disagree with what a write is
				 * checked against.
				 */
				value?: import("@serene-pub/sdk").SlotValue
				/** Possession rows. */
				entryId?: number
				itemName?: string
				/** How many this row leaves the owner holding. */
				quantity?: number
			}

			/** What one slot read before this session first touched it. */
			interface LedgerBaseline {
				ownerKey: string
				slotId: string
				value: import("@serene-pub/sdk").SlotValue
			}

			namespace Get {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					state: ResolvedState
					/**
					 * Every slot this install declares, and every owner this
					 * session's values can belong to. Additive to the resolved
					 * state rather than folded into it: `state` is the shape a
					 * TEMPLATE reads, and a template author may never see which
					 * layer a number came from or what it is configured as.
					 */
					slots: SlotDescriptor[]
					owners: StateOwnerRow[]
				}
			}

			namespace Set {
				interface Params {
					sessionId: number
					owner: Owner
					slotId: string
					/** `null` clears this layer, so the read inherits again. */
					value: number | string | boolean | null
				}
				interface Response {
					sessionId: number
					state: ResolvedState
				}
			}

			namespace Give {
				interface Params {
					sessionId: number
					owner: Owner
					entryId: number
					quantity?: number
				}
				interface Response {
					sessionId: number
					state: ResolvedState
				}
			}

			namespace Take {
				interface Params {
					sessionId: number
					owner: Owner
					entryId: number
					quantity?: number
				}
				interface Response {
					sessionId: number
					state: ResolvedState
				}
			}

			namespace Transfer {
				interface Params {
					sessionId: number
					from: Owner
					to: Owner
					entryId: number
					quantity?: number
				}
				interface Response {
					sessionId: number
					state: ResolvedState
				}
			}

			namespace Proposals {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					proposals: ProposalRow[]
				}
			}

			/**
			 * The session's anchored rows, oldest first — what the transcript
			 * hangs under the message that changed something.
			 *
			 * A read of its own because the resolved state cannot answer it:
			 * `state:get` returns what every stat is now, and a ledger is the
			 * question "what did THIS message change", which only the rows and
			 * their anchors can answer.
			 */
			namespace Ledger {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
					rows: LedgerRow[]
					/**
					 * What each changed slot read before the session touched
					 * it, so the first line of a run reads `hp 20 → 14` rather
					 * than losing its left-hand side.
					 */
					baselines: LedgerBaseline[]
				}
			}

			namespace Decide {
				interface Params {
					proposalId: number
					accept: boolean
				}
				interface Response {
					sessionId: number
					proposalId: number
					/** `superseded` (U5f): the accept applied nothing — the slot moved since the proposal's base. */
					status: "accepted" | "rejected" | "superseded"
					/** `superseded` only: what moved, by name. */
					movedSlots?: string[]
					proposals: ProposalRow[]
					state: ResolvedState
				}
			}

			/**
			 * Attach a slot to an owner, or change what attaching decided.
			 *
			 * Deviations only: `config` is what this owner changes — `{ max: 40 }`
			 * — never the resolved whole.
			 */
			namespace Configure {
				interface Params {
					sessionId: number
					owner: Owner
					slotId: string
					config: Record<string, unknown>
				}
				interface Response {
					sessionId: number
					state: ResolvedState
				}
			}

			/**
			 * Something changed. Broadcast to every participant after every
			 * write, carrying no payload but the session — a surface re-reads
			 * rather than patching, which is the same posture `widgetStyles`
			 * takes and for the same reason: there is exactly one resolution
			 * and the client must not own a second one.
			 */
			namespace Changed {
				interface Params {
					sessionId: number
				}
				interface Response {
					sessionId: number
				}
			}

			// ── Attributes build (U2) ───────────────────────────────────
			//
			// Appended rather than folded into the shapes above: `ResolvedState`
			// is deliberately a SUBSET of what the resolver returns — the wire
			// says what a template may read, and a template author may never
			// see which layer a number came from. What is added here is the
			// vocabulary a *surface* needs beside the values.

			/**
			 * One cast member as `state.cast` holds them: their values, plus
			 * the three facts that say who they are (R17).
			 *
			 * The same objects are reachable two ways — `state.cast[slug]` and
			 * `state.cast.byId[characterId]` — and a client must not build a
			 * second index over them: the slugs are derived from the ids by the
			 * resolver, and deriving them again is where the two start to
			 * disagree about a name with an apostrophe in it.
			 */
			interface CastEntry {
				id: number
				key: string
				name: string
				[slot: string]: unknown
			}

			/**
			 * The roles, a **sibling** of the cast and never inside it (R16).
			 *
			 * An absent role is an absent KEY, not a null: "nobody has spoken
			 * yet" and "the speaker is nothing" are different sentences and a
			 * surface has to be able to tell them apart. There is deliberately
			 * no `narrator` — an envoy is not a character and carries no state
			 * — and no `addressed`, which nothing derives without a model.
			 */
			interface WhoKeys {
				speaker?: CastEntry
				last?: CastEntry
				previous?: CastEntry
				user?: CastEntry
				owner?: CastEntry
				next?: CastEntry
				/** Seated, active cast in position order. Always present, possibly empty. */
				active: CastEntry[]
			}

			/** An attribute sheet, as a surface offers or draws one (R6). */
			interface SheetRow {
				sheetId: string
				label: string
				description?: string
				/** `stored` is authored here; `code`/`plugin` arrive with a package. */
				origin: "stored" | "code" | "plugin"
				/** Offered nowhere new, kept everywhere it already is. */
				retired?: boolean
				/** The slots it gathers, in order — the order is content. */
				slots: {
					slotId: string
					required?: boolean
					default?: import("@serene-pub/sdk").SlotValue
					config?: Record<string, unknown>
				}[]
			}

			/** Which sheets one owner has, in the order they are drawn in. */
			interface OwnerSheetRow {
				owner: Owner
				/** Required for `session`/`session_cast`, absent for the template layers. */
				sessionId?: number
				sheetId: string
				position: number
			}

			/**
			 * An authored declaration as the editor lists one, and as a panel
			 * greys one whose package is gone (R4).
			 */
			interface DeclarationRow {
				slotId: string
				origin: "stored" | "code" | "plugin"
				/** The account the row belongs to; null for core's and a package's. */
				userId: number | null
				retired: boolean
				/** When this build last saw the declaration. */
				lastSeenAt: string
				/** The SDK's `AttributeSlotProps`, verbatim. */
				props: Record<string, unknown>
			}

			/** One rule, and what it did — what the ledger's "why" reads. */
			interface RuleFiring {
				slotId: string
				/** `world`, or the cast slug it ran against. */
				ownerKey: string
				rule: {
					when?: string
					set?: string
					add?: string
					remove?: string
				}
				result: "fired" | "skipped" | "refused"
				reason?: string
			}

			/**
			 * What one trip through the gate did (R11).
			 *
			 * A refusal is a **result** and not an error: the other changes in
			 * the set were still legitimate, and a surface has to be able to
			 * show "four landed, one was refused and here is the sentence".
			 */
			interface GateOutcome {
				applied: number[]
				proposed: number[]
				refused: { reason: string }[]
				rulesFired: RuleFiring[]
				/** Set when a turn's rules went past the budget. Never a refusal. */
				budgetWarning?: string
			}

			/** What a hard delete would take with it — shown BEFORE anything is (R3). */
			interface SlotFootprint {
				characters: number
				worlds: number
				values: number
			}
		}

		export interface SyncDetails {
			syncSource: Partial<SelectUser> | null
			scenario: null | "character" | "session"
		}

		interface FileAcceptDetails {
			files: File[]
		}
	}
}

export {}
