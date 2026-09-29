/**
 * The ranking store's writer (PLAN-sdk-1.0 §3.9, R58, R64).
 *
 * Called from `saveReceipt` once the run's row exists. Every node whose
 * declared out-ports include one of shape `core:shape/decisions@1` is a
 * ranking — core's `rank-hybrid`, a plugin's ranker — and is recorded with
 * no opt-in beyond publishing that shape:
 *
 * - one `rankings` row per such node;
 * - one `ranking_decisions` row per decision with a subject — core's lore
 *   candidates become `lore-entry` subjects; a decision with no subject (a
 *   message or relationship band) is counted on the ranking, never stored;
 * - one `ranking_subject_stats` upsert per subject PER RUN (the run's
 *   rankings folded, an inclusion winning), carrying the latest facts so
 *   readers never touch the append-only table;
 * - then the session is pruned to one round — each speaker's
 *   newest turn (R68). The rollup keeps its totals.
 *
 * All of it in one transaction.
 *
 * Bounded: at most `MAX_DECISIONS_PER_RANKING` decisions stored per ranking
 * and `MAX_DECISION_DETAIL_BYTES` of `detail` each; anything beyond is
 * noted on the ranking's own `detail`. Never throws — the store is
 * evidence, like the receipt it rides with.
 */

import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
// The core definitions must be registered for a port lookup to find them.
import "@serene-pub/core-catalog"
import {
	DECISIONS_SHAPE,
	LORE_ENTRY_SUBJECT,
	MAX_DECISION_DETAIL_BYTES,
	MAX_DECISIONS_PER_RANKING,
	getDefinition,
	subjectKindFindings,
	type Receipt,
	type RankingDecisionV1
} from "@serene-pub/sdk"

/** Out-ports of shape decisions, per pinned definition id. */
const decisionPortsCache = new Map<string, string[]>()
export function decisionPortsOf(definitionId: string): string[] {
	const hit = decisionPortsCache.get(definitionId)
	if (hit) return hit
	const out = (getDefinition(definitionId) as { ports?: { out?: Record<string, unknown> } } | undefined)
		?.ports?.out
	const ports = Object.entries(out ?? {})
		.filter(([, shape]) => shape === DECISIONS_SHAPE)
		.map(([port]) => port)
	decisionPortsCache.set(definitionId, ports)
	return ports
}

/**
 * The ranking bands whose numeric-id candidates are lorebook entries —
 * `historyEntry` included, the vector mechanism's spelling of `history`, so
 * one entry is one subject whichever mechanism brought it.
 */
const LORE_BANDS = new Set(["worldLore", "characterLore", "history", "historyEntry"])

/** Longest subject id the store keeps; a longer one is no subject. */
export const MAX_SUBJECT_ID = 64

/** The package slug a definition id belongs to (`core`, `acme.dice`). */
const slugOf = (definitionId: string) => definitionId.split(":")[0]

/**
 * The subject a decision is about: its own, or — for rankers that publish
 * the candidate they judged — a `lore-entry` when the candidate is a
 * lorebook entry: a lore band with a NUMERIC id. The docs source also rides
 * the world-lore band, with a string id (`slug#anchor`); it is no entry.
 *
 * A STATED kind is checked here, where it is written, never trusted: it must
 * be a subject kind at all (`subjectKindFindings`), a package may state only
 * its own `<slug>:<kind>`, and only core may state `lore-entry` outright —
 * a plugin's lore subjects come from the candidates core's sources made.
 * A stated subject that fails is no subject (counted, never stored).
 */
export function subjectOf(
	d: RankingDecisionV1,
	definitionId = "core:"
): { kind: string; id: string } | null {
	if (d.subject) {
		const kind = d.subject.kind
		if (subjectKindFindings(kind)) return null
		const slug = slugOf(definitionId)
		const own = kind === LORE_ENTRY_SUBJECT ? slug === "core" : kind.startsWith(`${slug}:`)
		const id = String(d.subject.id)
		return own && id.length <= MAX_SUBJECT_ID ? { kind, id } : null
	}
	const c = d.candidate
	if (c && typeof c.id === "number" && typeof c.source === "string" && LORE_BANDS.has(c.source))
		return { kind: LORE_ENTRY_SUBJECT, id: String(c.id) }
	return null
}

const boundedDetail = (
	detail: unknown
): { value: Record<string, unknown> | null; dropped: boolean } => {
	if (!detail || typeof detail !== "object") return { value: null, dropped: false }
	try {
		const text = JSON.stringify(detail)
		if (text.length > MAX_DECISION_DETAIL_BYTES) return { value: null, dropped: true }
		return { value: detail as Record<string, unknown>, dropped: false }
	} catch {
		return { value: null, dropped: true }
	}
}

export type ProjectedDecision = Omit<typeof schema.rankingDecisions.$inferInsert, "rankingId">

/**
 * One ranking's decisions, as the store keeps them — the ONE projection the
 * writer and the fire test share (§3.9: the fire test returns the preview's
 * decisions "from the same projection", never stored). Subjects derived,
 * rank counted among the included OF THE SAME SUBJECT KIND — a lore entry's
 * rank is its place among the lore that made it, never behind the messages a
 * ranker also judged — match facts carried as detail, bounds applied.
 */
export function projectRanking(
	all: RankingDecisionV1[],
	definitionId?: string
): {
	rows: ProjectedDecision[]
	withSubject: number
	detailsDropped: number
} {
	const includedRank = new Map<string, number>()
	let detailsDropped = 0
	let withSubject = 0
	const rows: ProjectedDecision[] = []
	for (const d of all) {
		if (!d || typeof d !== "object") continue
		const subject = subjectOf(d, definitionId)
		if (!subject) continue
		const rank = d.included
			? (includedRank.set(subject.kind, (includedRank.get(subject.kind) ?? 0) + 1),
				includedRank.get(subject.kind)!)
			: null
		withSubject++
		if (rows.length >= MAX_DECISIONS_PER_RANKING) continue
		// A lore candidate's match facts (L1) ride as detail when the
		// ranker stated none of its own.
		const matched = (d.candidate as { matched?: unknown } | undefined)?.matched
		const detail = boundedDetail(
			d.detail ?? (Array.isArray(matched) && matched.length ? { matched } : undefined)
		)
		if (detail.dropped) detailsDropped++
		const tokens = d.tokens ?? d.candidate?.tokens
		rows.push({
			subjectKind: subject.kind,
			subjectId: subject.id,
			included: d.included === true,
			reason: String(d.reason ?? "").slice(0, 64) || "unknown",
			score: typeof d.score === "number" && Number.isFinite(d.score) ? d.score : null,
			rank: typeof d.rank === "number" ? d.rank : rank,
			tokens: typeof tokens === "number" ? Math.round(tokens) : null,
			why: typeof d.why === "string" ? d.why.slice(0, 500) : null,
			detail: detail.value
		})
	}
	return { rows, withSubject, detailsDropped }
}

/**
 * Every ranking a receipt holds, projected but never stored — for the fire
 * test's preview (§3.9). Keyed by the ranking node.
 */
export function projectReceiptRankings(
	receipt: Receipt
): Array<{ nodeKey: string; judged: number; included: number; rows: ProjectedDecision[] }> {
	const out: Array<{ nodeKey: string; judged: number; included: number; rows: ProjectedDecision[] }> = []
	for (const node of receipt.nodes ?? []) {
		const ports = decisionPortsOf(node.definitionId)
		if (!ports.length) continue
		const output = (node.output ?? {}) as Record<string, unknown>
		const all = ports.flatMap((p) =>
			Array.isArray(output[p]) ? (output[p] as RankingDecisionV1[]) : []
		)
		out.push({
			nodeKey: node.nodeKey,
			judged: all.length,
			included: all.filter((d) => d?.included === true).length,
			rows: projectRanking(all, node.definitionId).rows
		})
	}
	return out
}

export interface RankingScope {
	runRowId: number
	sessionId: number | null
	userId: number | null
	/**
	 * The session's lore rollup moved (R81): called once, AFTER the
	 * transaction committed, when this run rolled up at least one
	 * `lore-entry` subject for a session — so a reader told of it reads what
	 * was written. Never for a session-less run, one that ranked no lore, or
	 * one whose write failed. Its own failure is logged, never the store's.
	 */
	onLoreRanked?: (sessionId: number) => void | Promise<void>
}

/** Record every ranking the receipt holds. Returns how many rankings were written. */
export async function recordRankings(
	db: Db,
	receipt: Receipt,
	scope: RankingScope
): Promise<number> {
	const nodes = receipt.nodes ?? []
	const inlet = nodes.find((n) => n.kind === "inlet")
	const speaker = (inlet?.output as Record<string, unknown> | undefined)?.speaker
	const speakerRef = typeof speaker === "string" ? speaker : null
	// The relationship lens's figures for the run, kept on its rankings so
	// the authoring readouts never open a receipt (R58).
	const { relationshipsFromReceipt } = await import(
		"$lib/server/pipelines/runtime/relationshipFigures"
	)
	const relationships = relationshipsFromReceipt(receipt)
	let written = 0
	/** Did this run roll up a lore entry for its session? Read only once committed. */
	let loreRanked = false
	try {
		// One transaction: a ranking without its decisions, or decisions
		// without their rollup, is a store that lies (§3.9). Only `tx` inside.
		await db.transaction(async (tx) => {
			// The rollup folds the WHOLE run, not each ranking: a spec that
			// ranks once per voice judges an entry several times in one turn,
			// and a later voice's exclusion must not overwrite an earlier
			// voice's inclusion. One row per subject per run — an inclusion
			// wins, otherwise the first judgement — so `timesJudged` counts
			// turns, and an upsert never touches a row twice in one statement.
			const bySubject = new Map<string, ProjectedDecision & { rankingId: number }>()
			for (const node of nodes) {
				const ports = decisionPortsOf(node.definitionId)
				if (!ports.length) continue
				const output = (node.output ?? {}) as Record<string, unknown>
				const all: RankingDecisionV1[] = ports.flatMap((p) =>
					Array.isArray(output[p]) ? (output[p] as RankingDecisionV1[]) : []
				)

				const { rows, withSubject, detailsDropped } = projectRanking(all, node.definitionId)
				const input = (node.input ?? {}) as { budget?: { remaining?: number; total?: number } }
				const budget = input.budget?.remaining ?? input.budget?.total
				const notes: Record<string, unknown> = {}
				if (withSubject > rows.length) notes.truncated = withSubject - rows.length
				if (detailsDropped) notes.detailsDropped = detailsDropped
				if (relationships) notes.relationships = relationships

				const [ranking] = await tx
					.insert(schema.rankings)
					.values({
						runId: scope.runRowId,
						nodeKey: node.nodeKey,
						definitionId: node.definitionId,
						sessionId: scope.sessionId,
						speakerRef,
						userId: scope.userId,
						candidatesJudged: all.length,
						decisionsStored: rows.length,
						budgetTotal: typeof budget === "number" ? Math.round(budget) : null,
						detail: Object.keys(notes).length ? notes : null
					})
					.returning({ id: schema.rankings.id })
				written++
				if (!rows.length) continue
				await tx
					.insert(schema.rankingDecisions)
					.values(rows.map((r) => ({ ...r, rankingId: ranking.id })))
				for (const r of rows) {
					const k = `${r.subjectKind}\u0000${r.subjectId}`
					const prev = bySubject.get(k)
					if (!prev || (!prev.included && r.included))
						bySubject.set(k, { ...r, rankingId: ranking.id })
				}
			}

			if (scope.sessionId != null && bySubject.size) {
				// When the TURN ran, not when its ranking was written.
				const now =
					typeof receipt.startedAt === "number" ? new Date(receipt.startedAt) : new Date()
				await tx
					.insert(schema.rankingSubjectStats)
					.values(
						[...bySubject.values()].map((r) => ({
							sessionId: scope.sessionId!,
							subjectKind: r.subjectKind,
							subjectId: r.subjectId,
							timesJudged: 1,
							timesIncluded: r.included ? 1 : 0,
							lastRankingId: r.rankingId,
							lastJudgedAt: now,
							lastIncludedAt: r.included ? now : null,
							lastIncludedRunId: r.included ? scope.runRowId : null,
							lastIncludedTokens: r.included ? (r.tokens ?? null) : null,
							lastIncluded: r.included,
							lastReason: r.reason,
							lastRank: r.rank ?? null,
							lastScore: r.score ?? null
						}))
					)
					.onConflictDoUpdate({
						target: [
							schema.rankingSubjectStats.sessionId,
							schema.rankingSubjectStats.subjectKind,
							schema.rankingSubjectStats.subjectId
						],
						set: {
							timesJudged: sql`${schema.rankingSubjectStats.timesJudged} + 1`,
							timesIncluded: sql`${schema.rankingSubjectStats.timesIncluded} + excluded.times_included`,
							lastRankingId: sql`excluded.last_ranking_id`,
							lastJudgedAt: sql`excluded.last_judged_at`,
							lastIncludedAt: sql`coalesce(excluded.last_included_at, ${schema.rankingSubjectStats.lastIncludedAt})`,
							lastIncludedRunId: sql`case when excluded.last_included then excluded.last_included_run_id else ${schema.rankingSubjectStats.lastIncludedRunId} end`,
							lastIncludedTokens: sql`case when excluded.last_included then excluded.last_included_tokens else ${schema.rankingSubjectStats.lastIncludedTokens} end`,
							lastIncluded: sql`excluded.last_included`,
							lastReason: sql`excluded.last_reason`,
							lastRank: sql`excluded.last_rank`,
							lastScore: sql`excluded.last_score`
						}
					})
				loreRanked = [...bySubject.values()].some((r) => r.subjectKind === LORE_ENTRY_SUBJECT)
			}
			if (written) await pruneRankings(tx, scope.sessionId)
		})
	} catch (err) {
		written = 0
		loreRanked = false
		console.warn("[rankings] could not record this run's rankings — the turn was unaffected:", err)
	}
	// Committed: now a reader told of it reads what was written (R81).
	if (loreRanked && scope.sessionId != null && scope.onLoreRanked) {
		try {
			await scope.onLoreRanked(scope.sessionId)
		} catch (err) {
			console.warn("[rankings] could not tell the session its lore was ranked:", err)
		}
	}
	return written
}

/**
 * Keep ONE round (R68): each speaker's newest turn — every
 * ranking that turn wrote — and nothing older. What a reader needs from the
 * per-turn record is "what did the last turn do", per character; how often
 * across the session is the rollup's, which is never pruned.
 *
 * Grouped by `speaker_ref` (a turn with no named speaker is one group of its
 * own); decisions cascade. Session-less runs (a pipeline fired outside any
 * session) are pruned by the same rule, as one pool.
 */
export async function pruneRankings(db: Db, sessionId: number | null): Promise<void> {
	const r = schema.rankings
	const scope = (alias: string) =>
		sessionId == null
			? sql.raw(`${alias}.session_id IS NULL`)
			: sql`${sql.raw(alias)}.session_id = ${sessionId}`
	await db.execute(sql`
		DELETE FROM ${r} AS old
		WHERE ${scope("old")}
			AND old.run_id < (
				SELECT max(newer.run_id) FROM ${r} AS newer
				WHERE ${scope("newer")}
					AND coalesce(newer.speaker_ref, '') = coalesce(old.speaker_ref, '')
			)
	`)
}

/** For tests: forget cached port lookups. */
export function _resetRankingStoreCache(): void {
	decisionPortsCache.clear()
}
