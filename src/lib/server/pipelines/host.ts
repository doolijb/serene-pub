/**
 * Core's side of the executor: the I/O a binding is not allowed to do itself.
 *
 * The executor sequences; the host performs effects. A binding describes what
 * it wants — "read these messages", "write this message" — and this module is
 * what actually touches the database. That split is not ceremony:
 *
 *   · it is the only way a **sidecar** Consumer can ever work, since a separate
 *     process has no database channel (F19). In-process and out-of-process
 *     Consumers obeying the same contract means the review gate sees the same
 *     thing in both cases — a payload, before anything has happened.
 *   · it keeps every effect inside the substrate the review gate, the budget
 *     and the receipt already sit in. A binding that closed over `db` would be
 *     outside all three, and nothing would look wrong until an admin asked why
 *     a run wrote something the receipt does not mention.
 *
 * Scope enforcement lives here too, for the same reason: the host is handed the
 * **node** that asked, so a Query's read is checked against what that spec is
 * allowed to see rather than against the query it happened to send (F30).
 */

import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { HostServices, NodeRef } from "@serene-pub/sdk"

type Db = { select: any; insert: any; update: any }

export interface HostScope {
	/** The chat this run belongs to. Reads outside it are refused, not filtered. */
	chatId?: number
	/** Who triggered the run, for authorship on writes. */
	userId?: number
	/**
	 * Where streamed tokens go while a Provider is still generating.
	 *
	 * On the scope rather than in the call payload, because a payload is a
	 * *value*: it lands in the receipt and in every downstream node's input, and
	 * a socket handle is not a thing to write down. The pipeline still gets the
	 * finished text on the port — this is only so the user sees it arrive.
	 */
	sink?: {
		onChunk?: (chunk: string) => void
		onThinking?: (chunk: string) => void
	}
	/** Aborts an in-flight provider call when the run is cancelled. */
	signal?: AbortSignal
}

export class HostScopeError extends Error {}

/**
 * A read a spec is not entitled to make is an **error, not an empty result**.
 *
 * Returning `[]` would let a mis-scoped pipeline look like a working one with a
 * quiet chat, and the symptom — "the bot forgot everything" — points at
 * retrieval rather than at permissions, which is where the week goes.
 */
function assertScoped(
	node: NodeRef,
	wanted: number | undefined,
	allowed: number | undefined
) {
	if (wanted === undefined) return
	if (allowed === undefined || wanted !== allowed)
		throw new HostScopeError(
			`${node.key} (${node.typeId}) asked for chat ${wanted}, but this run is scoped to ` +
				`${allowed ?? "no chat"}. A pipeline may only read the chat it was triggered in.`
		)
}

/**
 * The embedding module, imported once.
 *
 * It was `await import(...)` inside each call. Two Provider nodes running in
 * parallel — which is exactly what a retrieval block does — then raced on the
 * same dynamic import, and one of them observed a module that reported no model
 * loaded while its sibling embedded happily. The symptom was a provider error on
 * a healthy chat, on one of two identical calls, depending on timing.
 *
 * One promise, created on first use and reused: there is no second import to
 * race with, and the module is still not loaded for an instance that never
 * embeds.
 */
let embeddingModule: Promise<typeof import("$lib/server/embedding")> | null =
	null
const embeddingApi = () => (embeddingModule ??= import("$lib/server/embedding"))

export function createHost(db: Db, scope: HostScope = {}): HostServices {
	return {
		async read(table, query, node) {
			const q = (query ?? {}) as Record<string, any>

			switch (table) {
				case "chat_messages": {
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)
					if (chatId === undefined) return []

					// `isHidden` is the existing convention for a message that should
					// not reach a model. Honoured here rather than left to each
					// binding, so a new Query type cannot forget it.
					const rows = await db
						.select()
						.from(schema.chatMessages)
						.where(
							and(
								eq(schema.chatMessages.chatId, chatId),
								eq(schema.chatMessages.isHidden, false)
							)
						)
						.orderBy(desc(schema.chatMessages.id))
						.limit(Math.min(q.limit ?? 100, 500))

					// Reversed after a descending limit: "the most recent N, in
					// reading order" is what every caller wants, and doing it here
					// means no binding has to remember which end it got.
					return rows.reverse().map(toMessage)
				}

				case "chats": {
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)
					if (chatId === undefined) return []
					return await db
						.select()
						.from(schema.chats)
						.where(eq(schema.chats.id, chatId))
						.limit(1)
				}

				case "lorebook_entries": {
					// The chat's lorebook, or nothing. A pipeline cannot name a
					// lorebook it was not triggered against — lore is chat-scoped
					// data and a spec that could reach any lorebook could read one
					// belonging to another user's chat.
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)
					if (chatId === undefined) return []

					const [chat] = await db
						.select()
						.from(schema.chats)
						.where(eq(schema.chats.id, chatId))
						.limit(1)
					if (!chat?.lorebookId) return []

					const [world, character, history] = await Promise.all([
						db
							.select()
							.from(schema.worldLoreEntries)
							.where(
								eq(
									schema.worldLoreEntries.lorebookId,
									chat.lorebookId
								)
							),
						db
							.select()
							.from(schema.characterLoreEntries)
							.where(
								eq(
									schema.characterLoreEntries.lorebookId,
									chat.lorebookId
								)
							),
						db
							.select()
							.from(schema.historyEntries)
							.where(
								eq(
									schema.historyEntries.lorebookId,
									chat.lorebookId
								)
							)
					])

					// Tagged with their source rather than returned as three lists,
					// because every consumer downstream — scoring, budgeting, the
					// receipt — keys on source, and splitting them again at each
					// step is three chances to forget one.
					return [
						...world.map((e: any) => toLoreEntry(e, "worldLore")),
						...character.map((e: any) =>
							toLoreEntry(e, "characterLore")
						),
						...history.map((e: any) => toLoreEntry(e, "history"))
					]
				}

				case "chat_cast": {
					/**
					 * Who is in the chat, and the prompt config they speak under.
					 *
					 * One read rather than three, because the cast is only useful
					 * assembled: a character row without its `chatCharacters` join
					 * carries no visibility, and visibility is what decides whether
					 * that character appears in the prompt at all. Splitting them
					 * would let a spec read the characters and skip the join, which
					 * is a hidden character in every prompt and no error anywhere.
					 *
					 * The rows go out raw. Which of them are shown, named, or
					 * minimal is `promptFields.resolveContextInput`'s decision — the
					 * host retrieves, it does not choose.
					 */
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)
					if (chatId === undefined) return null

					const [chat] = await db
						.select()
						.from(schema.chats)
						.where(eq(schema.chats.id, chatId))
						.limit(1)
					if (!chat) return null

					const [chatCharacters, chatPersonas] = await Promise.all([
						db
							.select({
								isActive: schema.chatCharacters.isActive,
								visibility: schema.chatCharacters.visibility,
								character: schema.characters
							})
							.from(schema.chatCharacters)
							.innerJoin(
								schema.characters,
								eq(
									schema.chatCharacters.characterId,
									schema.characters.id
								)
							)
							.where(eq(schema.chatCharacters.chatId, chatId)),
						db
							.select({ persona: schema.personas })
							.from(schema.chatPersonas)
							.innerJoin(
								schema.personas,
								eq(
									schema.chatPersonas.personaId,
									schema.personas.id
								)
							)
							.where(eq(schema.chatPersonas.chatId, chatId))
					])

					return {
						chatCharacters,
						chatPersonas,
						chatScenario: (chat as any).scenario ?? null,
						isGroup: Boolean((chat as any).isGroup)
					}
				}

				case "embedding_status": {
					/**
					 * Whether vector search is usable on this instance, right now.
					 *
					 * Instance state, not data — which is why it arrives through a
					 * read rather than along an edge, and not as config either:
					 * config resolves before the run, and "is the embedding model
					 * loaded" is a fact about this moment.
					 *
					 * Delegates to `isModelReady()`, which is what the existing RAG
					 * gate in promptBuilder already uses. Deliberately not a second
					 * rule: it distinguishes *enabled* from *loaded and validated*,
					 * and re-deriving that here would eventually disagree with the
					 * legacy path about whether RAG is on — which is exactly the
					 * kind of divergence the parity corpus cannot see, because both
					 * paths would be internally consistent and different.
					 */
					const { isModelReady, getLoadedModelId } =
						await embeddingApi()
					const available = isModelReady()
					return {
						available,
						model: getLoadedModelId(),
						reason: available
							? undefined
							: "no embedding model is loaded and validated"
					}
				}

				case "vector_search": {
					/**
					 * Semantic retrieval, scored here rather than downstream.
					 *
					 * The cosine pass stays in the host for the same reason lore
					 * rows arrive without their `embedding` column: a vector is a
					 * few hundred floats, and moving candidate vectors along a data
					 * edge would put them in the run's values, its receipt and
					 * every downstream node's input. Ranking *policy* — MMR, per
					 * source caps, thresholds — is a Task and stays swappable; this
					 * is the retrieval itself.
					 *
					 * **Several query vectors, several ranked lists.** The legacy
					 * engine embeds the current window and the recent window
					 * separately and fuses their ranks, because "what is being said
					 * now" and "what was being said just before" are different
					 * questions and one blended embedding answers neither. The
					 * candidate pool is fetched once and scored against each.
					 */
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)

					const vectors: number[][] = Array.isArray(q.vectors)
						? q.vectors.filter(Array.isArray)
						: Array.isArray(q.vector)
							? [q.vector]
							: []
					if (chatId === undefined || vectors.length === 0)
						return { lists: [], similarity: [], candidates: [] }

					const {
						getChatRagContext,
						fetchScopedCandidates,
						rankScopedCandidates
					} = await import("$lib/server/embedding/ragContext")
					const { getLoadedModelId } = await embeddingApi()

					const modelId = getLoadedModelId()
					if (!modelId)
						return { lists: [], similarity: [], candidates: [] }

					const context = await getChatRagContext(chatId)
					const candidates = await fetchScopedCandidates(context, {
						modelId,
						sources: q.sources,
						excludeRecentMessages: q.excludeRecentMessages ?? 10
					})

					const topK = q.topK ?? 40
					const lists = vectors.map((vector) =>
						rankScopedCandidates(candidates, vector, topK).map(
							project
						)
					)

					/**
					 * `cos(i, j)` over the union of what came back.
					 *
					 * Derived, bounded and one-way: MMR needs to know which
					 * candidates resemble each other, and this answers that
					 * without any embedding leaving the host. N² is real — a topK
					 * in the thousands would want a different shape — but at the
					 * tens this arm works in it is smaller than two raw vectors.
					 */
					const union = new Map<string, any>()
					for (const list of lists)
						for (const hit of list)
							if (!union.has(`${hit.source}:${hit.id}`))
								union.set(`${hit.source}:${hit.id}`, hit)

					const byKey = new Map(
						candidates.map((c: any) => [`${c.source}:${c.id}`, c])
					)
					const order = [...union.keys()]
					const similarity = order.map((a) =>
						order.map((b) =>
							a === b
								? 1
								: cosine(
										byKey.get(a)?.embedding,
										byKey.get(b)?.embedding
									)
						)
					)

					return {
						lists,
						similarity,
						// The fused-set order the matrix is indexed against, so a
						// Task can line the two up without guessing.
						candidates: order.map((k) => union.get(k))
					}
				}

				default:
					throw new HostScopeError(
						`${node.key} (${node.typeId}) tried to read '${table}', which no Query type is ` +
							`bound to. Reads are enumerated here on purpose — a table nobody listed is a ` +
							`table nobody reviewed for scope.`
					)
			}
		},

		async call(payload, node) {
			const p = (payload ?? {}) as Record<string, any>

			switch (node.typeId) {
				case "core:provider/embed-text": {
					// The embedding call is a Provider because it reaches a model
					// (16 §1) — a Query may not. Splitting it out also means the
					// run's budget and receipt see the embedding call, which they
					// would not if retrieval quietly made it.
					const { embed, batchEmbed, isModelReady } =
						await embeddingApi()
					if (!isModelReady())
						throw new Error(
							"no embedding model is loaded and validated, so text cannot be embedded"
						)

					const texts: string[] = Array.isArray(p.texts)
						? p.texts.filter((t: unknown) => typeof t === "string")
						: p.text !== undefined && p.text !== null
							? [String(p.text)]
							: []

					// **No texts means no vectors**, not one vector of an empty
					// string. A chat on its first turn has no "recent" window,
					// so this is a normal state rather than an edge case — and
					// the previous shape embedded `undefined`, which crashed
					// inside the model wrapper and surfaced as a provider error
					// on a perfectly healthy chat.
					if (texts.length === 0) return { vectors: [], vector: null }

					const vectors =
						texts.length > 1
							? await batchEmbed(texts)
							: [await embed(texts[0]!)]
					return { vectors, vector: vectors[0] }
				}

				case "core:provider/generate-text": {
					/**
					 * The generation itself, through the existing adapters.
					 *
					 * This is the point of the whole split: the prompt was built by
					 * Tasks that anyone can inspect, and this sends it. Note what
					 * the binding does *not* get back — no connection, no URL, no
					 * key, no headers. See `dispatch.ts` for why that line is not
					 * negotiable rather than merely tidy.
					 */
					const { dispatchGeneration } = await import("./dispatch")
					if (scope.chatId === undefined)
						throw new HostScopeError(
							`${node.key} has no chat to generate in — the run was started without a chat scope`
						)

					const result = await dispatchGeneration({
						compiledPrompt: p.compiledPrompt,
						db: db as any,
						chatId: scope.chatId,
						userId: scope.userId,
						currentCharacterId: p.currentCharacterId ?? null,
						generatingMessageMetadata:
							p.generatingMessageMetadata ?? {},
						onChunk: scope.sink?.onChunk,
						onThinking: scope.sink?.onThinking,
						signal: scope.signal
					})
					return result
				}

				default:
					throw new Error(
						`${node.key} (${node.typeId}) has no dispatch path in core. A Provider core ` +
							`cannot call is one a user could add to a pipeline and watch fail at run time.`
					)
			}
		},

		async commit(payload, node) {
			const p = (payload ?? {}) as Record<string, any>

			switch (node.typeId) {
				case "core:consumer/create-message": {
					const chatId = p.chatId ?? scope.chatId
					if (chatId === undefined)
						throw new HostScopeError(
							`${node.key} has no chat to write to — the run was started without a chat scope`
						)
					const [row] = await db
						.insert(schema.chatMessages)
						.values({
							chatId,
							userId: p.userId ?? scope.userId ?? null,
							characterId: p.characterId ?? null,
							personaId: p.personaId ?? null,
							role: p.role ?? "assistant",
							content: String(p.text ?? ""),
							metadata: p.metadata ?? {},
							isGenerating: false
						})
						.returning()
					return { id: row.id, chatId: row.chatId }
				}

				case "core:consumer/update-message": {
					const target = p.target
					const id =
						typeof target === "number"
							? target
							: (target?.id ?? target?.ids?.[0])
					if (id === undefined)
						throw new HostScopeError(
							`${node.key} was given no message id to update. update-message takes a row id ` +
								`from outside the run — a message created in the same run cannot be updated ` +
								`by a second node (13 §10b).`
						)
					const [row] = await db
						.update(schema.chatMessages)
						.set({ content: String(p.text ?? ""), isEdited: true })
						.where(eq(schema.chatMessages.id, id))
						.returning()
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					assertScoped(node, row.chatId, scope.chatId)
					return { id: row.id, chatId: row.chatId }
				}

				case "embedding_status": {
					/**
					 * Whether vector search is usable on this instance.
					 *
					 * Instance state, not data — which is why it arrives through a
					 * read rather than along an edge. A binding cannot be handed it
					 * as config either: config is resolved before the run, and
					 * "is the embedding model loaded" is a fact about right now.
					 *
					 * It decides whether a `rag` entry falls back to keyword, so
					 * getting it silently wrong presents as a lorebook problem and
					 * sends the user to the wrong screen entirely.
					 */
					const [config] = await db
						.select()
						.from(schema.vectorizationConfigs)
						.limit(1)
					if (!config)
						return {
							available: false,
							reason: "no vectorization config"
						}

					const configured =
						config.mode === "api"
							? !!config.apiModel && !!config.apiBaseUrl
							: !!config.localModel

					return {
						available: configured,
						mode: config.mode,
						model:
							config.mode === "api"
								? config.apiModel
								: config.localModel,
						reason: configured
							? undefined
							: `vectorization is set to '${config.mode}' but no model is configured`
					}
				}

				default:
					throw new HostScopeError(
						`${node.key} (${node.typeId}) has no commit path in core. A Consumer that core ` +
							`cannot perform is one a user could add to a pipeline and watch fail at run time.`
					)
			}
		}
	}
}

/**
 * The row shape a Query publishes.
 *
 * Deliberately narrow: a binding gets what a prompt needs, not the whole row.
 * `queueItemId`, `embedding` and `debugMeta` have no business reaching a plugin
 * that asked for chat history, and the cheapest way to guarantee that is to
 * never put them in the value (F30).
 */
/** What leaves the host for one hit: an id, a score and the text. */
function project(item: any) {
	return {
		id: item.id,
		source: item.source,
		score: item.score,
		name: item.name ?? null,
		content: item.content ?? "",
		lorebookId: item.lorebookId ?? null,
		priority: item.priority ?? 1
	}
}

/** Cosine similarity, host-side, so no embedding reaches a data edge. */
function cosine(a?: number[], b?: number[]): number {
	if (!a || !b) return 0
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0
		const y = b[i] ?? 0
		dot += x * y
		na += x * x
		nb += y * y
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function toMessage(r: any) {
	return {
		id: r.id,
		role: r.role,
		content: r.content,
		characterId: r.characterId ?? null,
		personaId: r.personaId ?? null,
		isNarratorResponse: r.isNarratorResponse,
		createdAt: r.createdAt
	}
}

/**
 * A lore entry, narrowed to what retrieval and scoring need.
 *
 * `embedding` is deliberately absent: it is a large float array, it would
 * travel through every data edge and land in every receipt, and nothing
 * downstream of the vector search has any use for it. Vector similarity is
 * computed during retrieval and arrives as a score.
 */
function toLoreEntry(
	row: any,
	source: "worldLore" | "characterLore" | "history"
) {
	return {
		id: row.id,
		source,
		name: row.name ?? null,
		content: row.content ?? "",
		keys: row.keys ?? "",
		caseSensitive: row.caseSensitive ?? false,
		useRegex: row.useRegex ?? false,
		matchMode: row.matchMode ?? null,
		retrievalStrategy: row.retrievalStrategy ?? null,
		priority: row.priority ?? 1,
		constant: row.constant ?? false,
		enabled: row.enabled ?? true,
		position: row.position ?? 0,
		lorebookBindingId: row.lorebookBindingId ?? null,
		/** History entries only; used for the recency signal. */
		year: row.year ?? null,
		month: row.month ?? null,
		day: row.day ?? null,
		/** Whether this entry has a usable vector, not the vector itself. */
		hasEmbedding: Array.isArray(row.embedding) && row.embedding.length > 0
	}
}
