/**
 * The host's retrieval reads: whether vector search is usable
 * (`embedding_status`), `vector_search`, `entity_annotations`, the rows
 * behind recalled lines (`recalled_lines`), `mention_spans` and
 * `entity_link`.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	MENTION_EXTRACTOR_VERSION,
	extractMentions
} from "$lib/server/pipelines/ranking/mentions"
import { buildScanWindow } from "$lib/server/pipelines/ranking/signals"
import { noteMessagesRead } from "$lib/server/pipelines/runtime/loreSources"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import { channelWhere, resolveChannel } from "$lib/server/messages/channels"
import { holderBookOf } from "./host.loreWrites"
import {
	assertScoped,
	describePromotion,
	embeddingApi,
	toCandidate,
	cosine,
	toMessage
} from "./host.helpers"
import type { HostReadArgs } from "./host.types"

export async function readEmbeddingStatus(): Promise<unknown> {
	/**
	 * Whether vector search is usable on this instance, right now.
	 *
	 * Instance state, not data — which is why it arrives through a
	 * read rather than along an edge, and not as config either:
	 * config resolves before the run, and "is the embedding model
	 * loaded" is a fact about this moment.
	 *
	 * Delegates to `isModelReady()`, which is what the existing RAG
	 * gate in promptBuilder already uses. Intentionally not a second
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

export async function readVectorSearch(
	{ scope, node, q }: HostReadArgs
): Promise<unknown> {
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
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)

	const vectors: number[][] = Array.isArray(q.vectors)
		? q.vectors.filter(Array.isArray)
		: Array.isArray(q.vector)
			? [q.vector]
			: []
	if (sessionId === undefined || vectors.length === 0)
		return {
			lists: [],
			similarity: [],
			candidates: [],
			truncated: []
		}

	const {
		getSessionRagContext,
		fetchScopedCandidates,
		rankScopedCandidates
	} = await import("$lib/server/embedding/ragContext")
	const { getLoadedModelId } = await embeddingApi()

	const modelId = getLoadedModelId()
	if (!modelId)
		return {
			lists: [],
			similarity: [],
			candidates: [],
			truncated: []
		}

	const context = await getSessionRagContext(sessionId)

	/**
	 * **Index what this search is about to look at and cannot
	 * see, before it looks.**
	 *
	 * A row in scope with no current vector is invisible to the
	 * fetch below — it is not ranked low, it is not there — so a
	 * lorebook saved a moment ago contributes nothing at all
	 * until the background pass reaches it. The fix is not a
	 * second synchronous embed path beside the queue: these rows
	 * are **promoted to the front of the existing queue**, and
	 * the node resumes once its scope is covered. Fairness,
	 * failure backoff and model handling stay in one place.
	 *
	 * Bounded twice — the scan caps how many rows may be named,
	 * the lane caps how many are indexed and for how long —
	 * because this is synchronous work inside a turn.
	 *
	 * ⚠ Never throws into the turn. A promotion that cannot
	 * complete degrades to a report, which is the governing
	 * rule's "subtracts a signal, never halts": the search runs
	 * over whatever is indexed and the receipt says what was
	 * missing.
	 */
	const { promoteScopedVectors } = await import(
		"$lib/server/embedding/vectorizationQueue"
	)
	const promotion = await promoteScopedVectors(
		context,
		modelId,
		{
			// Only what the fetch below will look at: a row
			// embedded for a source it never searches is an
			// embed call inside the turn bought for nothing.
			sources: q.sources,
			excludeRecentMessages: q.excludeRecentMessages,
			channel: resolveChannel(q.channel)
		}
	)
	/**
	 * `truncated` rides back out untouched.
	 *
	 * The fetch is capped per source and scores nothing, so a
	 * capped source hands back its newest rows rather than its
	 * closest ones. Dropping that here would leave the mechanism
	 * reporting a `considered` count for a pool it silently
	 * never saw the whole of.
	 */
	const { candidates, truncated } =
		await fetchScopedCandidates(context, {
			modelId,
			sources: q.sources,
			excludeRecentMessages: q.excludeRecentMessages,
			// The semantic mechanism reaches the prompt, so it is
			// scoped exactly like the history read (20 §7): an
			// omitted channel is `main`, never every lane at
			// once. Lore is not lane-scoped — an entry belongs
			// to the world, not to a conversation.
			channel: resolveChannel(q.channel)
		})

	const topK = q.topK ?? 40
	const lists = vectors.map((vector) =>
		rankScopedCandidates(candidates, vector, topK).map(
			toCandidate
		)
	)

	/**
	 * `cos(i, j)` over the union of what came back.
	 *
	 * Derived, bounded and one-way: MMR needs to know which
	 * candidates resemble each other, and this answers that
	 * without any embedding leaving the host. N² is real — a topK
	 * in the thousands would want a different shape — but at the
	 * tens this mechanism works in it is smaller than two raw vectors.
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

	// Message hits only: an entry's id is not a message's.
	noteMessagesRead(
		scope,
		order
			.map((k) => union.get(k))
			.filter((hit) => hit?.source === "message")
	)
	return {
		lists,
		similarity,
		// The fused-set order the matrix is indexed against, so a
		// Task can line the two up without guessing.
		candidates: order.map((k) => union.get(k)),
		truncated,
		/**
		 * What the eager pass did, for the receipt. A turn that
		 * took a second longer because it embedded twelve
		 * entries first has to be able to say so.
		 */
		indexing: describePromotion("vectors", promotion)
	}
}

export async function readEntityAnnotations(
	{ db, scope, node, q }: HostReadArgs
): Promise<unknown> {
	/**
	 * The entity mechanism's index — design §13.5, and the IO half of
	 * it. Scoring is `ranking/entitySearch.ts`; the two are
	 * split for the reason the cosine pass is not: this one
	 * reads rows and returns keys, which is a small answer, and
	 * keeping the arithmetic pure is what makes it testable
	 * without a database.
	 *
	 * **One vocabulary for both sides.** The window's entities
	 * and the corpus's annotations are keys out of the same
	 * gazetteer, or they are two alphabets that never meet — a
	 * window resolving "Alice" to `character:5` would not find
	 * an entry annotated `open:alice`. It is built from the
	 * session's **lorebook**, so every session over one book
	 * agrees and the identity of that vocabulary rides on every
	 * stored row.
	 *
	 * **Which entries.** The caller passes the ids, and that is
	 * the privacy gate rather than a second one: `entryIds`
	 * comes from this host's own `lorebook_entries` read, which
	 * has already withheld character lore that is not the
	 * speaker's own. Re-deriving visibility here would be a
	 * second implementation of the rule bug 2 was about, free
	 * to disagree with the first.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)

	const {
		loadVocabulary,
		readEntryAnnotations,
		residentModelSpans,
		searchMessageAnnotations
	} = await import("$lib/server/annotations")
	const {
		promoteEntryAnnotations,
		enqueueSessionAnnotation
	} = await import("$lib/server/annotations/queue")
	const { extractEntities } = await import(
		"$lib/server/pipelines/ranking/entities"
	)

	const empty = {
		entities: [],
		entries: [],
		messages: [],
		diagnostics: {
			annotatedEntries: 0,
			rewroteEntries: 0,
			deferredEntries: 0,
			messagesFound: 0
		}
	}
	if (sessionId === undefined) return empty

	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return empty
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const vocabBook = session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))

	const vocabulary = await loadVocabulary(db, vocabBook, { holderBookId: await holderBookOf(db, sessionId) })

	const entryIds: number[] = Array.isArray(q.entryIds)
		? q.entryIds.map(Number).filter(Number.isFinite)
		: []

	/**
	 * Entries are repaired before they are read — §13.4's
	 * small-N regime — but **through the annotation lane's
	 * queue, not beside it**. The ids this query scoped are
	 * promoted to the front of that queue, indexed, and the node
	 * resumes when its scope is covered.
	 *
	 * Bounded twice, because this is synchronous work inside a
	 * turn: the lane caps how many items one promotion may
	 * process and how long it may take, so a book with two
	 * hundred un-annotated entries cannot silently stall a first
	 * message. Whatever the bound left is still queued and the
	 * background pass finishes it, which is why a partial
	 * promotion costs a smaller search rather than a wrong one.
	 *
	 * ⚠ Never throws and never blocks indefinitely: a promotion
	 * that cannot complete comes back as a report, and its
	 * `reason` goes on the receipt below.
	 */
	const pass = await promoteEntryAnnotations(
		entryIds,
		vocabulary,
		vocabBook
	)
	const index = await readEntryAnnotations(
		db,
		entryIds,
		vocabulary
	)

	const window: string =
		typeof q.window === "string" ? q.window : ""
	/**
	 * Tier zero over the window as well, when — and only when —
	 * the entity model is resident. The stored rows were read
	 * by it, so a window read the same way names what they
	 * name, lower-case and unfamiliar names included.
	 *
	 * ⚠ Never a load and never a wait: `residentModelSpans`
	 * asks the lease and nothing else, so a model that is not
	 * up answers no spans and the window is extracted
	 * lexically, exactly as before — an unavailable mechanism
	 * subtracts a signal.
	 */
	const windowPass = await residentModelSpans(window)
	const { entities, extractorVersion } = extractEntities(
		window,
		vocabulary.gazetteer,
		windowPass.spans
	)

	const maxMessages = Math.max(0, Number(q.maxMessages) || 0)
	/**
	 * Fetched far wider than it is returned, and deliberately.
	 *
	 * The rows come back newest-first, so fetching exactly
	 * `maxMessages` would take the most *recent* matches and
	 * then rank them — truncating before scoring, which is bug
	 * 3's shape in a new place. Widened to the annotation
	 * batch's ceiling so the ranking has a pool, and capped
	 * rather than unbounded because a session's whole history
	 * can match on one common name.
	 */
	const found =
		maxMessages > 0
			? await searchMessageAnnotations(
					db,
					sessionId,
					entities.map((e) => e.key),
					vocabulary,
					{ beforeId: q.beforeId }
				)
			: { hits: [], truncated: false }
	const messages = found.hits

	/**
	 * The transcript's own annotations, **queued** and not
	 * waited for — the one hard rule §13.4 states for this side,
	 * now expressed as a group on the annotation lane instead of
	 * a detached promise. Same "never blocks a turn" guarantee,
	 * with the work visible, bounded and interleaved with
	 * everything else that lane owes.
	 *
	 * Only when the message half is switched on: an install that
	 * has not asked for retrieval over its transcript should not
	 * be writing an index for it. That first write is also what
	 * opts the session into the lane's background sweep.
	 */
	if (maxMessages > 0)
		enqueueSessionAnnotation(
			sessionId,
			vocabBook,
			session.name ?? `Session #${sessionId}`
		)

	return {
		extractorVersion,
		gazetteerHash: vocabulary.hash,
		entities,
		entries: [...index].map(([id, keys]) => ({
			id,
			keys,
			entityLabels: index.entityLabels.get(id) ?? {}
		})),
		messages,
		diagnostics: {
			annotatedEntries: index.size,
			rewroteEntries: pass.processed,
			deferredEntries: pass.remaining,
			/**
			 * What the eager pass did, in words, for the
			 * receipt. A slow turn has to be explicable and so
			 * does a partial one — *"indexed 25 of 60 entries
			 * before searching (bounded)"* is the difference
			 * between a mechanism degrading and a mechanism
			 * disappearing.
			 */
			entityIndexing: describePromotion(
				"entry names",
				pass
			),
			messagesFound: messages.length,
			/**
			 * The message search hit its ceiling, so what it
			 * ranked is not the whole matching corpus.
			 * Reported for `vector-search`'s reason: a
			 * truncated retrieval and a complete one produce
			 * results that look exactly alike.
			 */
			messagesTruncated: found.truncated
		}
	}
}

export async function readRecalledLines(
	{ db, scope, node, q }: HostReadArgs
): Promise<unknown> {
	/**
	 * The rows behind entity-search's recalled lines
	 * (2026-09-27), in reading order, each with its **turn**:
	 * its 1-based position among its channel's visible
	 * messages — what a reader of that channel would count to
	 * reach it. Hidden and still-generating rows are excluded
	 * from the read and from the count, the rule
	 * `session_messages` states for every prompt-facing read.
	 *
	 * Rows only, for naming by the transcript's own chain
	 * (`processMessages`); no channel shaping, because a
	 * recalled line is one line, never a folio.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)
	const ids: number[] = Array.isArray(q.ids)
		? q.ids
				.map(Number)
				.filter((id: number) => Number.isInteger(id) && id > 0)
		: []
	if (sessionId === undefined || !ids.length) return []
	const sm = schema.sessionMessages
	const rows = await db
		.select({
			row: sm,
			// Qualified by hand: inside the subquery an
			// unqualified column is the inner row's own.
			turn: sql<number>`(select count(*)::int from session_messages earlier
								where earlier.session_id = session_messages.session_id
								and earlier.channel = session_messages.channel
								and earlier.is_hidden = false
								and earlier.is_generating = false
								and earlier.id <= session_messages.id)`
		})
		.from(sm)
		.where(
			and(
				eq(sm.sessionId, sessionId),
				inArray(sm.id, ids),
				eq(sm.isHidden, false),
				eq(sm.isGenerating, false)
			)
		)
		.orderBy(asc(sm.id))
	// The row exactly as the transcript read carries it, so the
	// one naming chain names it the same way.
	const recalled = rows.map((r: { row: any; turn: number }) => ({
		...toMessage(r.row),
		turn: Number(r.turn)
	}))
	noteMessagesRead(scope, recalled)
	return recalled
}

export async function readMentionSpans(
	{ db, scope, node, q }: HostReadArgs
): Promise<unknown> {
	/**
	 * What the scene refers to by **describing** it — the query
	 * half of the entity-vector space (retrieval plan phase 4).
	 *
	 * A host read rather than a pure Task, and the vocabulary is
	 * why: a definite description that turns out to be an
	 * authored lower-case name — *"the ashguard"* — must be
	 * dropped here, because the exact matcher owns it. A Task
	 * cannot know that, and a linker that received it would be
	 * offering a vector opinion about something already matched
	 * exactly.
	 *
	 * The same `loadVocabulary` the entity mechanism uses, so the two
	 * mechanisms cannot disagree about what counts as a name.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)

	const empty = {
		extractorVersion: MENTION_EXTRACTOR_VERSION,
		gazetteerHash: undefined as string | undefined,
		mentions: [] as any[],
		diagnostics: { claimed: 0 }
	}
	if (sessionId === undefined) return empty

	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return empty
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const linkBook = session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (linkBook == null) return empty

	const { loadVocabulary, EMPTY_VOCABULARY } = await import(
		"$lib/server/annotations"
	)
	const vocabulary = await loadVocabulary(db, linkBook, { holderBookId: await holderBookOf(db, sessionId) })
	// 🚧 pr-6 (§B-3a): the session's own book with nothing in it is
	// nothing to link a description to — skipped, no embed (the cost
	// of a session that reads no book).
	if (session.lorebookId == null && vocabulary.hash === EMPTY_VOCABULARY.hash)
		return empty

	const scanDepth = Math.max(1, Number(q.scanDepth) || 10)
	/**
	 * The guaranteed window, read the same way `keywordQuery`
	 * and the entity mechanism read it — newest `scanDepth` messages,
	 * in reading order. Not the whole history: a description is
	 * a reference to what is *being* discussed, and *"the
	 * captain"* from forty turns ago is a different captain.
	 */
	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			content: schema.sessionMessages.content
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isHidden, false),
				channelWhere(
					schema.sessionMessages.channel,
					resolveChannel(q.channel)
				)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(scanDepth)
	noteMessagesRead(scope, rows)
	const window = buildScanWindow(
		rows.reverse(),
		scanDepth
	).raw

	const all = extractMentions(window, vocabulary.gazetteer)
	const limit = Math.max(0, Number(q.limit) || 0)
	return {
		extractorVersion: all.extractorVersion,
		gazetteerHash: vocabulary.hash,
		mentions: limit
			? all.mentions.slice(0, limit)
			: all.mentions,
		diagnostics: {
			/**
			 * Descriptions an authored name was already sitting
			 * on — the exact matcher's, and correctly not this
			 * mechanism's. Counted by the detector rather than by
			 * scanning twice.
			 */
			claimed: all.claimed,
			windowChars: window.length
		}
	}
}

export async function readEntityLink(
	{ db, scope, node, q }: HostReadArgs
): Promise<unknown> {
	/**
	 * Mention → name, measured — the retrieval half of the
	 * entity-vector mechanism.
	 *
	 * The cosine pass runs here for `vector_search`'s reason and
	 * not a new one: a vector is a few hundred floats, and
	 * moving candidate vectors along a data edge would put them
	 * in the run's values, in its receipt and in every
	 * downstream node's input. What crosses the edge is a name,
	 * a mention and a number.
	 *
	 * ## The index is repaired before it is read
	 *
	 * §13.4's small-N regime: entries are few and change rarely,
	 * so a bounded pass brings the name vectors up to date in
	 * place rather than hoping a background job got there first.
	 * The pass is capped, so a book nobody has indexed converges
	 * over a turn or two instead of one reply paying for all of
	 * it — and `readEntityVectors` re-checks every identity
	 * afterwards, because "the repair ran" is an assumption and
	 * this is the reader.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)

	const empty = {
		hits: [] as any[],
		diagnostics: {
			names: 0,
			indexed: 0,
			reindexed: 0,
			deferredEntries: 0
		}
	}
	if (sessionId === undefined) return empty

	const entryIds: number[] = Array.isArray(q.entryIds)
		? q.entryIds.map(Number).filter(Number.isFinite)
		: []
	const mentions: Array<{ text: string; position: number }> =
		Array.isArray(q.mentions) ? q.mentions : []
	const vectors: number[][] = Array.isArray(q.vectors)
		? q.vectors.filter(Array.isArray)
		: []
	if (
		!entryIds.length ||
		!mentions.length ||
		vectors.length !== mentions.length
	)
		return empty

	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return empty

	const { getLoadedModelId, batchEmbed } =
		await embeddingApi()
	const modelId = getLoadedModelId()
	if (!modelId) return empty

	const { loadVocabulary } = await import(
		"$lib/server/annotations"
	)
	const { ensureEntityVectors, readEntityVectors } =
		await import("$lib/server/embedding/entityVectors")
	const entityBook =
		session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	const vocabulary = await loadVocabulary(db, entityBook, { holderBookId: await holderBookOf(db, sessionId) })

	const pass = await ensureEntityVectors(db, {
		lorebookId: entityBook,
		entryIds,
		gazetteerHash: vocabulary.hash,
		modelId,
		batchEmbed
	})
	const names = await readEntityVectors(
		db,
		entryIds,
		vocabulary.hash,
		modelId
	)

	/**
	 * Every mention against every name, and the honest bound on
	 * that is the two caps above it: `MAX_MENTIONS` on one side
	 * and `MAX_NAMES_PER_ENTRY` per entry on the other, over a
	 * pool that is already the ranker's candidate list. No
	 * threshold is applied — ruling R4 — so what comes back is
	 * every positive comparison and the ranking is the mechanism's.
	 */
	const hits: any[] = []
	for (const name of names)
		for (let i = 0; i < mentions.length; i++) {
			const mention = mentions[i]!
			const score = cosine(vectors[i], name.vector)
			if (!(score > 0)) continue
			hits.push({
				entryId: name.entryId,
				mention: mention.text,
				name: name.name,
				nameKind: name.kind,
				// Clamped, not rescaled: a similarity above 1 is
				// floating-point noise and one below 0 is "less
				// alike than unrelated", which is not evidence
				// and must never subtract from a score.
				score: Math.min(1, score),
				position: Number(mention.position) || 0
			})
		}

	return {
		hits,
		diagnostics: {
			/** Name vectors this turn could actually compare. */
			names: names.length,
			indexed: new Set(names.map((n) => n.entryId)).size,
			reindexed: pass.written,
			/**
			 * Entries the batch cap left for the next pass. Not
			 * an error — the mechanism links fewer entries this turn
			 * and the same number more next turn, which is
			 * staleness degrading to correct-and-verbose rather
			 * than to silently-wrong.
			 */
			deferredEntries: pass.deferred
		}
	}
}
