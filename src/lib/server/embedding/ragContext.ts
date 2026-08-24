/**
 * RAG context scoping helpers.
 *
 * When performing similarity search, results should be limited to content that
 * is actually associated with the current session. This prevents pulling in
 * irrelevant context from completely unrelated sessions, characters, or lorebooks.
 *
 * Use `getSessionRagContext` to resolve a session's linked content IDs, then pass
 * those IDs to `scopedRankBySimilarity` (or filter manually) to ensure all
 * RAG results are relevant to the active conversation.
 */

import { db } from "$lib/server/db"
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { cosineSimilarity } from "./index"

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
		allLorebookIds
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

export const RAG_CANDIDATE_FETCH_CAP = 500

export type ScopedRagOptions = {
	topK?: number
	/** Only return results from these content types */
	sources?: Array<
		| "message"
		| "worldLore"
		| "characterLore"
		| "historyEntry"
		| "narrativeNode"
		| "narrativeRelationship"
		| "character"
		| "persona"
	>
	/** Active embedding model — items from other models are excluded */
	modelId: string
	/**
	 * For messages: exclude the N most recent (they're already in the context window).
	 * Defaults to 10.
	 */
	excludeRecentMessages?: number
}

/**
 * Fetches every candidate item in scope for a session context — the DB-bound
 * half of a similarity search, with no query embedding involved and
 * nothing scored yet. Callers doing multiple similarity passes against the
 * same session context within one turn (eg. RagInfillEngine.ts scoring
 * several query-message embeddings) should fetch once via this and call
 * rankScopedCandidates() per query embedding, rather than re-running the
 * whole fetch for each one. Each source query is capped at
 * RAG_CANDIDATE_FETCH_CAP rows (newest first) — bounds worst-case
 * latency/memory on a pathologically large lorebook/session; there's no
 * pgvector index backing these queries, so ranking by similarity still
 * requires scoring whatever's fetched in-process rather than letting SQL
 * pick the closest matches.
 */
export async function fetchScopedCandidates(
	context: SessionRagContext,
	opts: Omit<ScopedRagOptions, "topK">
): Promise<ScopedRagCandidate[]> {
	const { modelId, sources, excludeRecentMessages = 10 } = opts

	const include = (source: ScopedRagItem["source"]) =>
		!sources || sources.includes(source as any)

	const candidates: ScopedRagCandidate[] = []

	// Messages from this session only. Recent messages are excluded since they're
	// already in the guaranteed context window. Cross-session context (other
	// conversations sharing this lorebook) flows through lore/history entries
	// instead — raw messages from another session are never pulled in here.
	if (include("message")) {
		let recentIds: number[] = []
		if (excludeRecentMessages > 0) {
			const recent = await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, context.sessionId))
				.orderBy(desc(schema.sessionMessages.id))
				.limit(excludeRecentMessages)
			recentIds = recent.map((r) => r.id)
		}

		const messages = await db
			.select({
				id: schema.sessionMessages.id,
				sessionId: schema.sessionMessages.sessionId,
				content: schema.sessionMessages.content,
				embedding: schema.sessionMessages.embedding,
				embeddingModel: schema.sessionMessages.embeddingModel
			})
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, context.sessionId),
					eq(schema.sessionMessages.isHidden, false),
					isNotNull(schema.sessionMessages.embedding),
					eq(schema.sessionMessages.embeddingModel, modelId)
				)
			)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(RAG_CANDIDATE_FETCH_CAP)

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
		if (include("worldLore")) {
			const wles = await db
				.select({
					id: schema.worldLoreEntries.id,
					lorebookId: schema.worldLoreEntries.lorebookId,
					name: schema.worldLoreEntries.name,
					content: schema.worldLoreEntries.content,
					embedding: schema.worldLoreEntries.embedding,
					embeddingModel: schema.worldLoreEntries.embeddingModel
				})
				.from(schema.worldLoreEntries)
				.where(
					and(
						inArray(
							schema.worldLoreEntries.lorebookId,
							context.allLorebookIds
						),
						eq(schema.worldLoreEntries.enabled, true),
						isNotNull(schema.worldLoreEntries.embedding),
						eq(schema.worldLoreEntries.embeddingModel, modelId)
					)
				)
				.orderBy(desc(schema.worldLoreEntries.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			for (const wle of wles) {
				if (!wle.embedding) continue
				candidates.push({
					source: "worldLore",
					lorebookId: wle.lorebookId,
					id: wle.id,
					name: wle.name,
					content: wle.content,
					embedding: wle.embedding,
					embeddingModel: wle.embeddingModel
				})
			}
		}

		if (include("characterLore")) {
			const cles = await db
				.select({
					id: schema.characterLoreEntries.id,
					lorebookId: schema.characterLoreEntries.lorebookId,
					name: schema.characterLoreEntries.name,
					content: schema.characterLoreEntries.content,
					embedding: schema.characterLoreEntries.embedding,
					embeddingModel: schema.characterLoreEntries.embeddingModel
				})
				.from(schema.characterLoreEntries)
				.where(
					and(
						inArray(
							schema.characterLoreEntries.lorebookId,
							context.allLorebookIds
						),
						eq(schema.characterLoreEntries.enabled, true),
						isNotNull(schema.characterLoreEntries.embedding),
						eq(schema.characterLoreEntries.embeddingModel, modelId)
					)
				)
				.orderBy(desc(schema.characterLoreEntries.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			for (const cle of cles) {
				if (!cle.embedding) continue
				candidates.push({
					source: "characterLore",
					lorebookId: cle.lorebookId,
					id: cle.id,
					name: cle.name,
					content: cle.content,
					embedding: cle.embedding,
					embeddingModel: cle.embeddingModel
				})
			}
		}

		if (include("historyEntry")) {
			const hes = await db
				.select({
					id: schema.historyEntries.id,
					lorebookId: schema.historyEntries.lorebookId,
					content: schema.historyEntries.content,
					year: schema.historyEntries.year,
					month: schema.historyEntries.month,
					day: schema.historyEntries.day,
					embedding: schema.historyEntries.embedding,
					embeddingModel: schema.historyEntries.embeddingModel
				})
				.from(schema.historyEntries)
				.where(
					and(
						inArray(
							schema.historyEntries.lorebookId,
							context.allLorebookIds
						),
						eq(schema.historyEntries.enabled, true),
						isNotNull(schema.historyEntries.embedding),
						eq(schema.historyEntries.embeddingModel, modelId)
					)
				)
				.orderBy(desc(schema.historyEntries.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)

			for (const he of hes) {
				if (!he.embedding) continue
				candidates.push({
					source: "historyEntry",
					lorebookId: he.lorebookId,
					id: he.id,
					name: "",
					content: he.content,
					year: he.year,
					month: he.month,
					day: he.day,
					embedding: he.embedding,
					embeddingModel: he.embeddingModel
				})
			}
		}

		if (include("narrativeNode")) {
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
				.where(
					and(
						inArray(
							schema.lorebookBindings.lorebookId,
							context.allLorebookIds
						),
						isNotNull(schema.lorebookBindings.embedding),
						eq(schema.lorebookBindings.embeddingModel, modelId)
					)
				)
				.orderBy(desc(schema.lorebookBindings.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)
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
				.where(
					and(
						inArray(
							schema.narrativeRelationships.lorebookId,
							context.allLorebookIds
						),
						isNotNull(schema.narrativeRelationships.embedding),
						eq(
							schema.narrativeRelationships.embeddingModel,
							modelId
						)
					)
				)
				.orderBy(desc(schema.narrativeRelationships.id))
				.limit(RAG_CANDIDATE_FETCH_CAP)
			for (const rel of rels) {
				if (!rel.embedding) continue
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

	// Characters linked to this session
	if (include("character") && context.characterIds.length > 0) {
		const chars = await db
			.select({
				id: schema.characters.id,
				name: schema.characters.name,
				description: schema.characters.description,
				embedding: schema.characters.embedding,
				embeddingModel: schema.characters.embeddingModel
			})
			.from(schema.characters)
			.where(
				and(
					inArray(schema.characters.id, context.characterIds),
					isNotNull(schema.characters.embedding),
					eq(schema.characters.embeddingModel, modelId)
				)
			)
			.orderBy(desc(schema.characters.id))
			.limit(RAG_CANDIDATE_FETCH_CAP)

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

	// Personas linked to this session
	if (include("persona") && context.personaIds.length > 0) {
		const ps = await db
			.select({
				id: schema.personas.id,
				name: schema.personas.name,
				description: schema.personas.description,
				embedding: schema.personas.embedding,
				embeddingModel: schema.personas.embeddingModel
			})
			.from(schema.personas)
			.where(
				and(
					inArray(schema.personas.id, context.personaIds),
					isNotNull(schema.personas.embedding),
					eq(schema.personas.embeddingModel, modelId)
				)
			)
			.orderBy(desc(schema.personas.id))
			.limit(RAG_CANDIDATE_FETCH_CAP)

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

	return candidates
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

/**
 * Run a similarity search over all content associated with the given session context.
 * Results are scoped to only include content linked to this session, filtered to the
 * active embedding model, and sorted by cosine similarity descending.
 *
 * Thin wrapper around fetchScopedCandidates()+rankScopedCandidates() for
 * single-query callers — a caller scoring multiple query embeddings
 * against the same session context in one turn should call those two
 * directly instead, fetching once and reusing the candidate set.
 */
export async function scopedRankBySimilarity(
	queryEmbedding: number[],
	context: SessionRagContext,
	opts: ScopedRagOptions
): Promise<ScopedRagItem[]> {
	const candidates = await fetchScopedCandidates(context, opts)
	return rankScopedCandidates(candidates, queryEmbedding, opts.topK)
}
