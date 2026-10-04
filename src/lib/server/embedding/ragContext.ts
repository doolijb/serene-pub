/**
 * RAG context scoping helpers.
 *
 * When performing similarity search, results should be limited to content that
 * is actually associated with the current session. This prevents pulling in
 * irrelevant context from completely unrelated sessions, characters, or lorebooks.
 *
 * Use `getSessionRagContext` to resolve a session's linked content IDs, then pass
 * those IDs to `fetchScopedCandidates` and rank the result with
 * `rankScopedCandidates` (fetch once per turn, rank per query embedding) to
 * ensure all RAG results are relevant to the active conversation.
 */

import { db } from "$lib/server/db"
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	type SQL
} from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { castEdgeOnly, isCastEdge } from "$lib/server/utils/narrativeEdges"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
import { ENTRY_INDEX_SOURCES, entryTypesOfSource } from "./entrySources"
import { sessionReadingOf, lineOfReading, type LineReading } from "$lib/server/state/reading"
import {
	MAIN_HEAD,
	amendedFieldNames,
	entryAt,
	entryOnReadingSql,
	entryOverlaysFor,
	type EntryReading
} from "$lib/server/state/entriesOnReading"
import { onLineSql } from "$lib/server/state/lineSql"
import { cosineSimilarity } from "./index"
import { messageHasText } from "./messageText"
import { channelWhere } from "$lib/server/messages/channels"

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

export type SessionRagContext = {
	sessionId: number
	/** IDs of characters linked to the session via sessionCharacters */
	characterIds: number[]
	/** IDs of personas linked to the session via sessionPersonas */
	personaIds: number[]
	/** The session's primary lorebook ID, if any */
	lorebookId: number | null
	/**
	 * IDs of lorebooks in scope for lore/history/relationship retrieval — just
	 * the session's own lorebook (if any). Deliberately does NOT include a session
	 * character's or persona's own separate lorebook — RAG should only ever
	 * draw on the story world the session itself is scoped to, not unrelated
	 * lorebooks a cast member happens to also be attached to elsewhere.
	 */
	allLorebookIds: number[]
	/**
	 * Where the session reads its book (owner ruling 3): its line and its
	 * story clock, or the head of the line. Absent (a context built by hand)
	 * reads main at its head. See `entriesOnReading.ts`.
	 */
	reading?: LineReading | null
}

/**
 * Resolve all content IDs that are in scope for RAG search in a given session.
 * Results from outside this set should not be used as RAG context.
 */
export async function getSessionRagContext(
	sessionId: number
): Promise<SessionRagContext> {
	const [session, sessionCharsRows, sessionPersonasRows] = await Promise.all([
		db.query.sessions.findFirst({
			where: eq(schema.sessions.id, sessionId),
			columns: { lorebookId: true }
		}),
		db
			.select({ characterId: schema.sessionCharacters.characterId })
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId)),
		db
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, sessionId))
	])

	const lorebookId = session?.lorebookId ?? null
	const allLorebookIds: number[] = lorebookId ? [lorebookId] : []

	const characterIds = sessionCharsRows
		.map((cc) => cc.characterId)
		.filter((id): id is number => id != null)
	const personaIds = sessionPersonasRows
		.map((cp) => cp.personaId)
		.filter((id): id is number => id != null)

	return {
		sessionId,
		characterIds,
		personaIds,
		lorebookId,
		allLorebookIds,
		reading: lorebookId ? await sessionReadingOf(db, sessionId) : null
	}
}

// ---------------------------------------------------------------------------
// Scoped similarity search
// ---------------------------------------------------------------------------

export type ScopedRagItem =
	| {
			source: "message"
			sessionId: number
			id: number
			content: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "worldLore" | "characterLore"
			lorebookId: number
			id: number
			name: string
			content: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "historyEntry"
			lorebookId: number
			id: number
			name: ""
			content: string
			year: number
			month: number | null
			day: number | null
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "narrativeNode"
			lorebookId: number
			id: number
			name: string
			summary: string | null
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "narrativeRelationship"
			lorebookId: number
			id: number
			fromNodeId: number
			toNodeId: number
			relationshipType: string
			description: string
			status: string
			reason: string | null
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "character"
			id: number
			name: string
			description: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "persona"
			id: number
			name: string
			description: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }

// Plain `Omit<ScopedRagItem, "score">` would NOT distribute correctly over
// this discriminated union — `keyof ScopedRagItem` collapses to the
// *intersection* of all variants' keys (just "source"/"score"), so a
// non-distributive Omit would silently lose every variant's own exclusive
// fields (year/month/day, fromNodeId/toNodeId, etc.) instead of preserving
// them. The `T extends any ? ... : never` form forces TS to apply Omit to
// each union member separately, then re-union the results.
type DistributiveOmit<T, K extends PropertyKey> = T extends any
	? Omit<T, K>
	: never
export type ScopedRagCandidate = DistributiveOmit<ScopedRagItem, "score">

/**
 * The per-source row cap on a candidate fetch.
 *
 * **A memory bound, not a relevance cutoff.** Nothing is scored at fetch time —
 * each source query orders by `id DESC` and takes the first N — so a cap that
 * binds discards rows by insertion order, and the best semantic match for the
 * turn may be among the ones discarded. Raising this improves retrieval
 * quality; it is finite only because every candidate carries its embedding into
 * memory and the whole fetch has to fit there at once.
 *
 * The arithmetic. Six sources can actually reach the cap — messages, world
 * lore, character lore, history entries, narrative nodes and narrative
 * relationships. `character`/`persona` cannot: they are already bounded by the
 * session's cast. Embeddings are `real[]` in Postgres but arrive in JS as a
 * packed array of doubles, 8 bytes per dimension. Dimensions are 384/768/1024
 * for the bundled local models (models.ts) and up to 3072 against an
 * API-backed connection. So the worst case here is 6 x 2000 = 12,000 vectors
 * resident at once: ~74 MB at 768d, ~98 MB at 1024d, ~295 MB at 3072d —
 * transient, freed at the end of the turn, and only reachable by an install
 * holding more than 2,000 embedded rows in each of six sources simultaneously.
 * Scoring cost scales with the same product, once per query vector.
 *
 * When the cap does bind, the fetch says so rather than silently returning an
 * arbitrary subset — see `ScopedRagTruncation`. The actual fix is a pgvector
 * index, which would let SQL pick the closest rows rather than the newest and
 * make this number stop deciding anything.
 */
export const RAG_CANDIDATE_FETCH_CAP = 2000

/** One source whose fetch hit the cap, and how much it did not see. */
export type ScopedRagTruncation = {
	source: ScopedRagItem["source"]
	/** Rows returned for this source — necessarily RAG_CANDIDATE_FETCH_CAP. */
	fetched: number
	/** Rows matching the same filters in total. */
	available: number
}

export type ScopedRagFetch = {
	candidates: ScopedRagCandidate[]
	/**
	 * Empty on any normal turn. An entry means that source's candidates are the
	 * *newest* `fetched` of `available` rather than the best `fetched`, so
	 * whatever ranks them is choosing from an arbitrary subset.
	 */
	truncated: ScopedRagTruncation[]
}

/**
 * Counts what the cap left behind — and only when it left something behind.
 *
 * A second query per truncated source, which is why it is guarded: on a normal
 * turn it never runs, and when it does it is cheaper than the fetch it follows
 * because it moves no embedding columns. Reporting "at least the cap" would
 * have cost nothing at all, but it cannot tell a lorebook twelve rows over the
 * cap from one twelve thousand over, and that distance is the only thing the
 * report is for.
 */
async function noteTruncation(
	truncated: ScopedRagTruncation[],
	source: ScopedRagItem["source"],
	fetched: number,
	table: PgTable,
	where: SQL | undefined
) {
	if (fetched < RAG_CANDIDATE_FETCH_CAP) return
	const [total] = await db.select({ n: count() }).from(table).where(where)
	truncated.push({ source, fetched, available: total?.n ?? fetched })
}

/**
 * The **index vocabulary**: what this module's rows are called.
 *
 * ⚠ There are two source vocabularies in the retrieval path and they are not
 * the same list. This one is the vector index's, eight names, and it is what
 * every `source` on a `ScopedRagItem` and every member of `sources` below is
 * spelled in. The other is the ranker's five `SourceKind` budget groups
 * (`message`**s**, `worldLore`, `characterLore`, `history`, `relationships`),
 * which `weights.ts` matches **literally** as `sourceBudget` keys and the SDK
 * freezes as declared member keys.
 *
 * **Do not reconcile them by renaming.** `historyEntry` here and `history`
 * there is deliberate, documented at `bindings.ts` (`VECTOR_SOURCE_ALIASES`),
 * and renaming either side would change the semantic arm's budget caps and
 * force a registry re-projection, which must not become a pattern. They are reconciled **at boundaries** — `BUDGET_GROUP_ALIASES` on
 * the way into `core:task/rank-hybrid@1`, and `select()`'s
 * `excluded_unknown_source` receipt for what still has no group. This constant
 * is the request-side boundary, and `assertIndexSources` below is its guard.
 *
 * Listed rather than derived from `ScopedRagItem` because a union of object
 * types has no runtime form; `assertIndexSources` is what keeps the two honest,
 * since a name added to the type and not to this list fails the guard the first
 * time a caller asks for it.
 */
export const RAG_INDEX_SOURCES = [
	"message",
	"worldLore",
	"characterLore",
	"historyEntry",
	"narrativeNode",
	"narrativeRelationship",
	"character",
	"persona"
] as const

export type RagIndexSource = (typeof RAG_INDEX_SOURCES)[number]

/**
 * Fail loudly on a source this module cannot fetch.
 *
 * The trap this closes: `include()` tests the caller's `sources` against the
 * index vocabulary, so a caller who reasonably reached for a ranker name —
 * `sources: ["history"]`, or `["messages"]` — matched nothing and got an empty
 * fetch that looks exactly like a session with no indexed history. Silent, and
 * wrong in the direction that reads as "retrieval found nothing".
 *
 * The shipped caller is the `vector-search` binding, which names its sources
 * itself (`SEMANTIC_SEARCH_SOURCES`, the lorebook's entries); the definition
 * declares no `sources` param, so no spec can. Whoever adds one gets a
 * sentence naming both vocabularies instead of an empty list.
 */
export function assertIndexSources(sources: readonly string[]): void {
	const unknown = sources.filter(
		(s) => !(RAG_INDEX_SOURCES as readonly string[]).includes(s)
	)
	if (unknown.length === 0) return
	throw new Error(
		`fetchScopedCandidates: unknown source ${unknown.map((s) => `'${s}'`).join(", ")}. ` +
			`This argument is spelled in the vector index's vocabulary ` +
			`(${RAG_INDEX_SOURCES.join(", ")}), not in the ranker's five ` +
			`budget groups (messages, worldLore, characterLore, history, ` +
			`relationships). The two overlap on worldLore and characterLore ` +
			`only, and the difference is deliberate — see RAG_INDEX_SOURCES. ` +
			`Translate at the boundary; do not rename either side.`
	)
}

/**
 * How many of a session's newest messages a search leaves out, because the
 * prompt carries them verbatim: the transcript window
 * `core:query/session-history@1` reads by default (its `limit`, 100). A
 * message hit inside it would say again what the prompt already says.
 *
 * ⚠ A reply's read is sized by the context window since 2026-10-03 (its
 * `budget` port), so the prompt may carry more than 100 or fewer; this stays
 * the count until a retrieval decision moves it.
 */
export const RECENT_MESSAGES_IN_PROMPT = 100

export type ScopedRagOptions = {
	topK?: number
	/**
	 * Only return results from these content types.
	 *
	 * ⚠ The **index** vocabulary, not the ranker's budget groups — see
	 * `RAG_INDEX_SOURCES`. A ranker name here is a caller error and
	 * `assertIndexSources` says so rather than returning nothing.
	 */
	sources?: Array<RagIndexSource>
	/** Active embedding model — items from other models are excluded */
	modelId: string
	/**
	 * For messages: exclude the N most recent, which the prompt already
	 * carries verbatim. Defaults to `RECENT_MESSAGES_IN_PROMPT`.
	 */
	excludeRecentMessages?: number
	/**
	 * For messages: which channel they are drawn from (20 §7, R6).
	 *
	 * The semantic arm reaches the prompt, so it obeys the same rule the
	 * history read does — an omitted channel is the session's default lane,
	 * `main`, and a union across lanes has to be asked for by name
	 * (`ALL_CHANNELS`). Lore, history entries and the other sources are not
	 * lane-scoped: an entry belongs to the world rather than to one
	 * conversation inside one session.
	 */
	channel?: string
}

/**
 * Fetches every candidate item in scope for a session context — the DB-bound
 * half of a similarity search, with no query embedding involved and
 * nothing scored yet. Callers doing multiple similarity passes against the
 * same session context within one turn (eg. the 0.5 RAG path scoring
 * several query-message embeddings) should fetch once via this and call
 * rankScopedCandidates() per query embedding, rather than re-running the
 * whole fetch for each one.
 *
 * Each source query is capped at RAG_CANDIDATE_FETCH_CAP rows, newest id
 * first. Because there is no pgvector index behind these tables, similarity
 * cannot participate in the query at all — ranking scores whatever was
 * fetched, in-process, after the fact. So the cap does not select the best
 * rows, it selects the newest ones, and any source that hits it comes back in
 * `truncated` saying how many rows it never looked at. Callers are expected to
 * carry that into their diagnostics: an unreported cap turns a retrieval
 * quality loss into a result that looks complete.
 */
export async function fetchScopedCandidates(
	context: SessionRagContext,
	opts: Omit<ScopedRagOptions, "topK">
): Promise<ScopedRagFetch> {
	const {
		modelId,
		sources,
		excludeRecentMessages = RECENT_MESSAGES_IN_PROMPT
	} = opts
	const messageChannel = channelWhere(
		schema.sessionMessages.channel,
		opts.channel
	)

	// The request-side boundary between the two source vocabularies. See
	// `RAG_INDEX_SOURCES`: `include` below tests the caller's names against the
	// *index's*, so a ranker name silently fetches nothing without this.
	if (sources) assertIndexSources(sources)

	const include = (source: ScopedRagItem["source"]) =>
		!sources || sources.includes(source as any)

	const candidates: ScopedRagCandidate[] = []
	const truncated: ScopedRagTruncation[] = []

	// Messages from this session only. Recent messages are excluded since they're
	// already in the guaranteed context window. Cross-session context (other
	// conversations sharing this lorebook) flows through lore/history entries
	// instead — raw messages from another session are never pulled in here.
	if (include("message")) {
		let recentIds: number[] = []
		if (excludeRecentMessages > 0) {
			// Scoped like the fetch below: "already in the context window"
			// is a claim about the window the history read built, and that
			// window is one channel's.
			const recent = await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.sessionId, context.sessionId),
						messageChannel
					)
				)
				.orderBy(desc(schema.sessionMessages.id))
				.limit(excludeRecentMessages)
			recentIds = recent.map((r) => r.id)
		}

		const where = and(
			eq(schema.sessionMessages.sessionId, context.sessionId),
			eq(schema.sessionMessages.isHidden, false),
			isNotNull(schema.sessionMessages.embedding),
			eq(schema.sessionMessages.embeddingModel, modelId),
			messageHasText,
			messageChannel
		)
		const messages = await db
			.select({
				id: schema.sessionMessages.id,
				sessionId: schema.sessionMessages.sessionId,
				content: schema.sessionMessages.content,
				embedding: schema.sessionMessages.embedding,
				embeddingModel: schema.sessionMessages.embeddingModel
			})
			.from(schema.sessionMessages)
			.where(where)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(RAG_CANDIDATE_FETCH_CAP)

		// Counted against the fetch, not against what survives the recent-message
		// exclusion below — the cap is what the DB applied, and the two numbers
		// have to be answering the same question to be comparable.
		await noteTruncation(
			truncated,
			"message",
			messages.length,
			schema.sessionMessages,
			where
		)

		for (const msg of messages) {
			if (recentIds.includes(msg.id)) continue
			if (!msg.embedding) continue
			candidates.push({
				source: "message",
				sessionId: msg.sessionId,
				id: msg.id,
				content: msg.content,
				embedding: msg.embedding,
				embeddingModel: msg.embeddingModel
			})
		}
	}

	// Lorebook content (world lore, character lore, history entries)
	if (context.allLorebookIds.length > 0) {
		/**
		 * The entry sources, as one query shape.
		 *
		 * They read the same rows of the same table and differ only in the
		 * declared types and the label the candidate carries, so the scan lives
		 * here once — for EVERY declared type (`entrySources.ts`, finding
		 * #150): a place and an item index as `worldLore`, their band.
		 *
		 * ⚠ **`historyEntry` here, `history` in the budget.** The two
		 * vocabularies are deliberately different and documented at
		 * `bindings.ts:264-274` — the ranker matches `sourceBudget` keys
		 * literally, so collapsing them silently drops every history candidate.
		 *
		 * **As the session reads its book** (findings #38, #143): rows on its
		 * line at its moment, each resolved through the line's entry
		 * amendments before its text or its Off mark is trusted. `enabled` and
		 * `archived` stay in SQL unless one of the line's amendments sets
		 * them — then they are asked of the resolved row.
		 *
		 * ⚠ **The vector is the BASE text's** (owner ruling R1, "hybrid",
		 * 2026-09-30). An entry is embedded once, from its stored text, and
		 * an amendment that rewrites its content does not re-embed it: the
		 * score is the base text's, the content rendered is the amended
		 * one. Names are the other half of the ruling and do read amended
		 * (`annotations/loadVocabulary`, plan C1); content vectors stay as
		 * they are. `docs/lorebook-time.md` says so to users.
		 */
		const reading: EntryReading = context.reading ?? MAIN_HEAD
		const overlays = new Map<number, Map<number, any[]>>()
		for (const lorebookId of context.allLorebookIds)
			overlays.set(lorebookId, await entryOverlaysFor(db, lorebookId, reading))
		const amended = new Set<string>()
		for (const o of overlays.values())
			for (const f of amendedFieldNames(o)) amended.add(f)

		for (const source of ENTRY_INDEX_SOURCES) {
			if (!include(source)) continue
			const typeIds = entryTypesOfSource(source)
			const where = and(
				inArray(
					schema.lorebookEntries.lorebookId,
					context.allLorebookIds
				),
				entryOnReadingSql(reading),
				amended.has("enabled")
					? undefined
					: eq(schema.lorebookEntries.enabled, true),
				// Archived is out of retrieval, like disabled (L1).
				amended.has("archived")
					? undefined
					: eq(schema.lorebookEntries.archived, false),
				typeIds.length === 1
					? eq(schema.lorebookEntries.typeId, typeIds[0]!)
					: inArray(schema.lorebookEntries.typeId, typeIds),
				eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME),
				eq(schema.lorebookEntryVectors.chunkIndex, 0),
				eq(schema.lorebookEntryVectors.model, modelId)
			)
			const joined = () =>
				db
					.select({
						id: schema.lorebookEntries.id,
						lorebookId: schema.lorebookEntries.lorebookId,
						title: schema.lorebookEntries.title,
						content: schema.lorebookEntries.content,
						fields: schema.lorebookEntries.fields,
						enabled: schema.lorebookEntries.enabled,
						archived: schema.lorebookEntries.archived,
						embedding: schema.lorebookEntryVectors.vector,
						embeddingModel: schema.lorebookEntryVectors.model
					})
					.from(schema.lorebookEntries)
					.innerJoin(
						schema.lorebookEntryVectors,
						eq(
							schema.lorebookEntryVectors.entryId,
							schema.lorebookEntries.id
						)
					)
					.where(where)

			const rows = await joined()
				.orderBy(desc(schema.lorebookEntries.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			if (rows.length >= RAG_CANDIDATE_FETCH_CAP) {
				const [total] = await db
					.select({ n: count() })
					.from(schema.lorebookEntries)
					.innerJoin(
						schema.lorebookEntryVectors,
						eq(
							schema.lorebookEntryVectors.entryId,
							schema.lorebookEntries.id
						)
					)
					.where(where)
				truncated.push({
					source,
					fetched: rows.length,
					available: total?.n ?? rows.length
				})
			}

			for (const stored of rows) {
				if (!stored.embedding) continue
				// The wire names an amendment overlays: `name`, and the
				// declared fields flat.
				const fields = (stored.fields ?? {}) as Record<string, any>
				const row = entryAt(
					{
						id: stored.id,
						name: stored.title ?? null,
						content: stored.content,
						enabled: stored.enabled,
						archived: stored.archived,
						year: fields.year ?? null,
						month: fields.month ?? null,
						day: fields.day ?? null
					} as Record<string, any> & { id: number },
					overlays.get(stored.lorebookId) ?? new Map(),
					reading
				)
				if (row.enabled === false || row.archived === true) continue
				candidates.push({
					source,
					lorebookId: stored.lorebookId,
					id: stored.id,
					// History has no title — it is dated, and the block's
					// heading is the date. The empty string is what the old
					// history query hardcoded.
					name: source === "historyEntry" ? "" : (row.name ?? null),
					content: row.content,
					...(source === "historyEntry"
						? {
								year: row.year ?? null,
								month: row.month ?? null,
								day: row.day ?? null
							}
						: {}),
					embedding: stored.embedding,
					embeddingModel: stored.embeddingModel
				} as ScopedRagCandidate)
			}
		}

		if (include("narrativeNode")) {
			const where = and(
				inArray(
					schema.lorebookBindings.lorebookId,
					context.allLorebookIds
				),
				isNotNull(schema.lorebookBindings.embedding),
				eq(schema.lorebookBindings.embeddingModel, modelId)
			)
			const nodes = await db
				.select({
					id: schema.lorebookBindings.id,
					lorebookId: schema.lorebookBindings.lorebookId,
					name: schema.lorebookBindings.name,
					summary: schema.lorebookBindings.summary,
					embedding: schema.lorebookBindings.embedding,
					embeddingModel: schema.lorebookBindings.embeddingModel
				})
				.from(schema.lorebookBindings)
				.where(where)
				.orderBy(desc(schema.lorebookBindings.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			await noteTruncation(
				truncated,
				"narrativeNode",
				nodes.length,
				schema.lorebookBindings,
				where
			)

			for (const node of nodes) {
				if (!node.embedding) continue
				candidates.push({
					source: "narrativeNode",
					lorebookId: node.lorebookId,
					id: node.id,
					name: node.name,
					summary: node.summary,
					embedding: node.embedding,
					embeddingModel: node.embeddingModel
				})
			}
		}

		if (include("narrativeRelationship")) {
			const where = and(
				inArray(
					schema.narrativeRelationships.lorebookId,
					context.allLorebookIds
				),
				// An edge drawn on another line is that line's story
				// (finding #143): shared edges and the chain's own only.
				onLineSql(
					schema.narrativeRelationships.branchId,
					lineOfReading(reading)
				),
				castEdgeOnly,
				isNotNull(schema.narrativeRelationships.embedding),
				eq(schema.narrativeRelationships.embeddingModel, modelId)
			)
			const rels = await db
				.select({
					id: schema.narrativeRelationships.id,
					lorebookId: schema.narrativeRelationships.lorebookId,
					fromNodeId: schema.narrativeRelationships.fromNodeId,
					toNodeId: schema.narrativeRelationships.toNodeId,
					relationshipType:
						schema.narrativeRelationships.relationshipType,
					description: schema.narrativeRelationships.description,
					status: schema.narrativeRelationships.status,
					reason: schema.narrativeRelationships.reason,
					embedding: schema.narrativeRelationships.embedding,
					embeddingModel: schema.narrativeRelationships.embeddingModel
				})
				.from(schema.narrativeRelationships)
				.where(where)
				.orderBy(desc(schema.narrativeRelationships.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			await noteTruncation(
				truncated,
				"narrativeRelationship",
				rels.length,
				schema.narrativeRelationships,
				where
			)

			for (const rel of rels) {
				if (!rel.embedding || !isCastEdge(rel)) continue
				candidates.push({
					source: "narrativeRelationship",
					lorebookId: rel.lorebookId,
					id: rel.id,
					fromNodeId: rel.fromNodeId,
					toNodeId: rel.toNodeId,
					relationshipType: rel.relationshipType,
					description: rel.description,
					status: rel.status,
					reason: rel.reason,
					embedding: rel.embedding,
					embeddingModel: rel.embeddingModel
				})
			}
		}
	}

	// Characters linked to this session. Bounded by the session's cast rather
	// than by the cap, so truncation here would mean a cast of thousands.
	if (include("character") && context.characterIds.length > 0) {
		const where = and(
			inArray(schema.characters.id, context.characterIds),
			isNotNull(schema.characters.embedding),
			eq(schema.characters.embeddingModel, modelId)
		)
		const chars = await db
			.select({
				id: schema.characters.id,
				name: schema.characters.name,
				description: schema.characters.description,
				embedding: schema.characters.embedding,
				embeddingModel: schema.characters.embeddingModel
			})
			.from(schema.characters)
			.where(where)
			.orderBy(desc(schema.characters.id))
			.limit(RAG_CANDIDATE_FETCH_CAP)

		await noteTruncation(
			truncated,
			"character",
			chars.length,
			schema.characters,
			where
		)

		for (const char of chars) {
			if (!char.embedding) continue
			candidates.push({
				source: "character",
				id: char.id,
				name: char.name,
				description: char.description,
				embedding: char.embedding,
				embeddingModel: char.embeddingModel
			})
		}
	}

	// The characters this session's users VOICE. One table with the cast above,
	// but a separate source because it is a separate scope: the cast is who the
	// model plays, this is who the user plays, and an install can want one in
	// its RAG context without the other.
	//
	// ⚠ A character can be in BOTH (the user voices someone who is also cast),
	// and the same row admitted twice under two source names is the same text
	// twice in one prompt. The ids already fetched above are skipped, so the
	// overlap lands once, as `character`.
	if (include("persona") && context.personaIds.length > 0) {
		const alreadyFetched = new Set(
			candidates
				.filter((c) => c.source === "character")
				.map((c) => c.id)
		)
		const personaIds = context.personaIds.filter(
			(id) => !alreadyFetched.has(id)
		)
		if (personaIds.length > 0) {
			const where = and(
				inArray(schema.characters.id, personaIds),
				isNotNull(schema.characters.embedding),
				eq(schema.characters.embeddingModel, modelId)
			)
			const ps = await db
				.select({
					id: schema.characters.id,
					name: schema.characters.name,
					description: schema.characters.description,
					embedding: schema.characters.embedding,
					embeddingModel: schema.characters.embeddingModel
				})
				.from(schema.characters)
				.where(where)
				.orderBy(desc(schema.characters.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			await noteTruncation(
				truncated,
				"persona",
				ps.length,
				schema.characters,
				where
			)

			for (const p of ps) {
				if (!p.embedding) continue
				candidates.push({
					source: "persona",
					id: p.id,
					name: p.name,
					description: p.description,
					embedding: p.embedding,
					embeddingModel: p.embeddingModel
				})
			}
		}
	}

	return { candidates, truncated }
}

/**
 * Scores a candidate set (from fetchScopedCandidates()) against one query
 * embedding and returns the topK results, sorted by cosine similarity
 * descending. Pure and synchronous — cheap enough to call once per query
 * embedding without re-fetching.
 */
export function rankScopedCandidates(
	candidates: ScopedRagCandidate[],
	queryEmbedding: number[],
	topK?: number
): ScopedRagItem[] {
	const scored = candidates.map(
		(c) =>
			({
				...c,
				score: cosineSimilarity(queryEmbedding, c.embedding)
			}) as ScopedRagItem
	)
	scored.sort((a, b) => b.score - a.score)
	return topK ? scored.slice(0, topK) : scored
}
