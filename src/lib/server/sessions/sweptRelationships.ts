/**
 * 🚧 **A sweep's ties, filed on the Graph's review screen**
 * (PLAN-genre-restructure §4, lane 2, 2026-10-19).
 *
 * The Story sweep's *Track relationships* task answers how the characters
 * now stand with each other — `{ from, to, how }`, by name. They reach the
 * graph the way a graph build's do: as a **proposal** a person reviews and
 * applies (`narrativeGraph:apply`), never as rows. The sweep's outlet is
 * `core:outlet/graph-proposal@1`, and its host commit hands a list here.
 *
 * Only ties between two members the lorebook's graph already holds are
 * proposed — matched by name or alias exactly, else by the graph's own
 * loose name rule when exactly one member answers. A name nobody answers
 * to is reported on the outcome, never invented as a member: the sweep's
 * *Note new people* task files people as lore, and the graph's own build
 * decides who becomes a member.
 *
 * A graph build in flight for the book is the person's and is never
 * superseded; a review already waiting gets the new ties added to it, so a
 * sweep every few turns does not stack a review per sweep.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import { collectAliases, namesMatch } from "$lib/server/utils/summarizer/availableSceneCast"
import { RELATIONSHIP_TEXT_LIMITS } from "$lib/shared/lorebooks/linkVocabulary"

/** One tie the sweep found. */
export interface SweptTie {
	from: string
	to: string
	how: string
}

export interface SweptTiesFiled {
	/** How many ties the review now holds from this sweep. */
	filed: number
	/** One sentence per tie (or reason) that was not filed. */
	skipped: string[]
	/** The graph review activity they wait in. */
	activityId?: string
}

/** The ties a sweep handed over, read defensively. */
export function readSweptTies(raw: unknown): SweptTie[] {
	if (!Array.isArray(raw)) return []
	const out: SweptTie[] = []
	for (const t of raw) {
		if (!t || typeof t !== "object") continue
		const r = t as Record<string, unknown>
		const from = typeof r.from === "string" ? r.from.trim() : ""
		const to = typeof r.to === "string" ? r.to.trim() : ""
		const how = typeof r.how === "string" ? r.how.trim() : ""
		if (from && to && how && from.toLowerCase() !== to.toLowerCase()) out.push({ from, to, how })
	}
	return out
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/**
 * File `raw` (the sweep's ties) for review on session `sessionId`'s lorebook
 * graph. Never throws for a tie it cannot place — that is a sentence.
 */
export async function fileSweptRelationships(db: Db, sessionId: number, raw: unknown): Promise<SweptTiesFiled> {
	const ties = readSweptTies(raw)
	if (!ties.length) return { filed: 0, skipped: [] }
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId,
			branchId: schema.sessions.lorebookBranchId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session || session.userId == null) return { filed: 0, skipped: ["this session has no owner to file for"] }
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book (main line only).
	const lorebookId = session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (lorebookId == null) return { filed: 0, skipped: ["this session is gone"] }
	const [book] = await db
		.select({ name: schema.lorebooks.name })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	const bindings = await db
		.select({
			id: schema.lorebookBindings.id,
			name: schema.lorebookBindings.name,
			aliases: schema.lorebookBindings.aliases,
			absorbedAliases: schema.lorebookBindings.absorbedAliases,
			parentNodeId: schema.lorebookBindings.parentNodeId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const members = bindings
		.filter((b: { parentNodeId: number | null; name: string }) => b.parentNodeId === null && b.name.trim())
		.map((b: { id: number; name: string; aliases: string[] | null; absorbedAliases: string[] | null }) => ({
			id: b.id,
			names: [b.name.trim(), ...collectAliases(b)]
		}))
	/** The one member a name answers to: exactly first, then the graph's loose rule when only one answers. */
	const memberNamed = (name: string): number | null => {
		const key = name.trim().toLowerCase()
		const exact = members.filter((m: { names: string[] }) => m.names.some((n) => n.toLowerCase() === key))
		if (exact.length === 1) return exact[0].id
		if (exact.length > 1) return null
		const loose = members.filter((m: { names: string[] }) => m.names.some((n) => namesMatch(n, name)))
		return loose.length === 1 ? loose[0].id : null
	}

	const skipped: string[] = []
	const relationships: Sockets.NarrativeGraph.RelationshipProposal[] = []
	for (const tie of ties) {
		const from = memberNamed(tie.from)
		const to = memberNamed(tie.to)
		if (from === null || to === null) {
			skipped.push(`${tie.from} → ${tie.to}: ${from === null ? tie.from : tie.to} is not one member of the lorebook's graph.`)
			continue
		}
		if (from === to) continue
		relationships.push({
			fromTempId: `existing_${from}`,
			toTempId: `existing_${to}`,
			relationshipType: cap(tie.how, RELATIONSHIP_TEXT_LIMITS.wording),
			description: cap(tie.how, RELATIONSHIP_TEXT_LIMITS.description),
			visibility: "acknowledged",
			status: "active",
			reason: "Noticed while the story was kept (Track relationships)."
		})
	}
	if (!relationships.length) return { filed: 0, skipped }

	const { activityStore } = await import("$lib/server/utils/activityStore")
	const waiting = activityStore
		.getFor(session.userId, false)
		.find((a) => a.kind === "graph_build" && a.lorebookId === lorebookId)
	if (waiting?.kind === "graph_build" && waiting.status === "building")
		return {
			filed: 0,
			skipped: [...skipped, "a graph build is running for this lorebook, so the sweep's ties wait for the next sweep"]
		}
	const seedTempIdMap = Object.fromEntries(
		relationships.flatMap((r) => [r.fromTempId, r.toTempId]).map((t) => [t, Number(t.slice("existing_".length))])
	)
	if (waiting?.kind === "graph_build" && waiting.status === "review" && waiting.proposal) {
		const seen = new Set(waiting.proposal.relationships.map((r) => `${r.fromTempId}|${r.toTempId}|${r.relationshipType}`))
		const added = relationships.filter((r) => !seen.has(`${r.fromTempId}|${r.toTempId}|${r.relationshipType}`))
		if (added.length)
			activityStore.update(waiting.id, {
				proposal: { ...waiting.proposal, relationships: [...waiting.proposal.relationships, ...added] },
				seedTempIdMap: { ...(waiting.seedTempIdMap ?? {}), ...seedTempIdMap },
				relsFound: waiting.relsFound + added.length
			})
		return { filed: added.length, skipped, activityId: waiting.id }
	}
	const id = activityStore.start({
		userId: session.userId,
		lorebookId,
		lorebookLabel: book?.name ?? "Lorebook",
		mode: "extend",
		branchId: session.lorebookId != null ? (session.branchId ?? null) : null
	})
	activityStore.update(id, {
		status: "review",
		phase: "review",
		relsFound: relationships.length,
		proposal: { nodes: [], relationships, updatedNodes: [], resolvedSceneCast: [] },
		sceneLabels: [],
		seedTempIdMap,
		processedSceneIds: [],
		processedHistoryEntryIds: []
	})
	return { filed: relationships.length, skipped, activityId: id }
}
