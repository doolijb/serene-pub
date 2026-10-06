/**
 * L1a · the ranking store's writer (PLAN-sdk-1.0 §3.9, R64).
 *
 * Pinned: core's ranker is found by its port shape, not its name; lore
 * candidates become `lore-entry` decisions ranked among the included LORE
 * (never behind messages); a message candidate is counted, never stored;
 * the rollup folds a run's rankings (an inclusion wins) and keeps the latest
 * facts; the session is pruned to one round (each speaker's newest
 * turn, R68) while the rollup keeps its totals; a stated subject kind must be the package's own; a
 * deleted session takes its rows with it.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	decisionPortsOf,
	recordRankings,
	subjectOf
} from "$lib/server/pipelines/runtime/rankingStore"

let db: TestDb
let n = 0

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	await db
		.insert(schema.users)
		.values({ id: 1, username: "ranking-owner" } as any)
		.onConflictDoNothing()
}, 60_000)

async function newSession(): Promise<number> {
	const [row] = await db
		.insert(schema.sessions)
		.values({ name: `ranking-${n++}`, isGroup: false, userId: 1 } as any)
		.returning({ id: schema.sessions.id })
	return row.id
}

async function runRow(): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineRuns)
		.values({
			runId: `r-${n++}`,
			specSlug: "core:spec/chat-respond",
			specVersion: "1.0.0",
			outcome: "ok",
			triggerSource: "test",
			seed: 1,
			startedAt: new Date(),
			endedAt: new Date(),
			receipt: {}
		} as any)
		.returning({ id: schema.pipelineRuns.id })
	return row.id
}

const lore = (id: number, tokens = 10) => ({
	id,
	source: "worldLore",
	tokens,
	payload: { id, lorebookId: 1, name: `Entry ${id}` }
})

const rankNode = (decisions: unknown[], nodeKey = "rank") => ({
	nodeKey,
	kind: "task",
	definitionId: "core:task/rank-hybrid@1",
	result: "ok",
	input: { budget: { remaining: 900 } },
	output: { decisions }
})

/** One run; several decision lists are several rankings (a per-voice spec). */
const receiptWith = (...rankings: unknown[][]) =>
	({
		runId: "x",
		specId: "core:spec/chat-respond",
		nodes: [
			{ nodeKey: "input", kind: "inlet", definitionId: "core:inlet/user-message@1", result: "ok", output: { speaker: "character:3" } },
			...rankings.map((d, i) => rankNode(d, i ? `rank-${i}` : "rank"))
		]
	}) as any

describe("the ranking store", () => {
	it("finds core's ranker by its decisions port", () => {
		expect(decisionPortsOf("core:task/rank-hybrid@1")).toEqual(["decisions"])
		expect(decisionPortsOf("core:inlet/user-message@1")).toEqual([])
	})

	it("records lore decisions, counts the rest, and rolls them up", async () => {
		const sessionId = await newSession()
		const runRowId = await runRow()
		const written = await recordRankings(
			db,
			receiptWith([
				{ candidate: lore(11), included: true, reason: "keyword", score: 0.9, why: "matched" },
				{ candidate: lore(12), included: true, reason: "semantic", score: 0.7 },
				{ candidate: { id: 99, source: "messages", tokens: 5 }, included: true, reason: "recent" },
				{ candidate: lore(13), included: false, reason: "budget", score: 0.2 },
				{ subject: { kind: "lore-entry", id: 14 }, included: false, reason: "pinned-off", detail: { roll: 19 } }
			]),
			{ runRowId, sessionId, userId: 1 }
		)
		expect(written).toBe(1)
		const [ranking] = await db.select().from(schema.rankings).where(eq(schema.rankings.runId, runRowId))
		expect(ranking).toMatchObject({ candidatesJudged: 5, decisionsStored: 4, budgetTotal: 900, speakerRef: "character:3" })
		const rows = await db
			.select()
			.from(schema.rankingDecisions)
			.where(eq(schema.rankingDecisions.rankingId, ranking.id))
		const byId = new Map(rows.map((r) => [`${r.subjectKind}:${r.subjectId}`, r]))
		expect(byId.get("lore-entry:11")).toMatchObject({ included: true, rank: 1, tokens: 10, reason: "keyword" })
		expect(byId.get("lore-entry:12")).toMatchObject({ rank: 2 })
		expect(byId.get("lore-entry:13")).toMatchObject({ included: false, rank: null })
		expect(byId.get("lore-entry:14")?.detail).toEqual({ roll: 19 })
		expect([...byId.keys()].some((k) => k.includes("99"))).toBe(false)

		// Again: the rollup adds up and keeps the latest facts.
		await recordRankings(
			db,
			receiptWith([{ candidate: lore(11), included: false, reason: "budget", score: 0.1 }]),
			{ runRowId: await runRow(), sessionId, userId: 1 }
		)
		const [stat] = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(and(eq(schema.rankingSubjectStats.sessionId, sessionId), eq(schema.rankingSubjectStats.subjectId, "11")))
		expect(stat).toMatchObject({ timesJudged: 2, timesIncluded: 1, lastIncluded: false, lastReason: "budget" })
		expect(stat.lastIncludedAt).not.toBeNull()
	})

	it("keeps one round — each speaker's newest turn — and the rollup keeps its totals", async () => {
		const sessionId = await newSession()
		const turn = (speaker: string) =>
			({
				...receiptWith([{ candidate: lore(21), included: true, reason: "keyword" }]),
				nodes: [
					{ nodeKey: "input", kind: "inlet", definitionId: "core:inlet/user-message@1", result: "ok", output: { speaker } },
					rankNode([{ candidate: lore(21), included: true, reason: "keyword" }])
				]
			}) as any
		// Mira, Tobin, Mira, Tobin, Mira: the round is Tobin's 4th and Mira's 5th.
		const runs: number[] = []
		for (const speaker of ["character:1", "character:2", "character:1", "character:2", "character:1"]) {
			const runRowId = await runRow()
			runs.push(runRowId)
			await recordRankings(db, turn(speaker), { runRowId, sessionId, userId: 1 })
		}
		const kept = await db.select().from(schema.rankings).where(eq(schema.rankings.sessionId, sessionId))
		expect(kept.map((k) => k.runId).sort((a, b) => a - b)).toEqual([runs[3], runs[4]])
		const [stat] = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(and(eq(schema.rankingSubjectStats.sessionId, sessionId), eq(schema.rankingSubjectStats.subjectId, "21")))
		expect(stat.timesJudged).toBe(5)
	})

	it("a turn that ranks once per voice keeps all of that turn's rankings", async () => {
		const sessionId = await newSession()
		const runRowId = await runRow()
		await recordRankings(
			db,
			receiptWith(
				[{ candidate: lore(71), included: true, reason: "keyword" }],
				[{ candidate: lore(72), included: true, reason: "keyword" }]
			),
			{ runRowId, sessionId, userId: 1 }
		)
		const kept = await db.select().from(schema.rankings).where(eq(schema.rankings.sessionId, sessionId))
		expect(kept).toHaveLength(2)
	})

	it("an entry judged twice in one ranking is one rollup row, the inclusion winning", async () => {
		const sessionId = await newSession()
		await recordRankings(
			db,
			receiptWith([
				{ candidate: lore(31), included: false, reason: "budget" },
				{ candidate: lore(31), included: true, reason: "keyword" }
			]),
			{ runRowId: await runRow(), sessionId, userId: 1 }
		)
		const stats = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(eq(schema.rankingSubjectStats.sessionId, sessionId))
		expect(stats).toHaveLength(1)
		expect(stats[0]).toMatchObject({ timesIncluded: 1, lastIncluded: true })
	})

	it("ranks a lore entry among the lore it read in, never behind messages", async () => {
		const sessionId = await newSession()
		const runRowId = await runRow()
		await recordRankings(
			db,
			receiptWith([
				{ candidate: { id: 1, source: "messages" }, included: true, reason: "band-minimum" },
				{ candidate: { id: 2, source: "messages" }, included: true, reason: "band-minimum" },
				{ candidate: lore(41), included: true, reason: "keyword" }
			]),
			{ runRowId, sessionId, userId: 1 }
		)
		const [row] = await db
			.select()
			.from(schema.rankingDecisions)
			.innerJoin(schema.rankings, eq(schema.rankings.id, schema.rankingDecisions.rankingId))
			.where(eq(schema.rankings.runId, runRowId))
		expect(row.ranking_decisions.rank).toBe(1)
	})

	it("folds a run's rankings: a later voice's exclusion never erases an inclusion", async () => {
		const sessionId = await newSession()
		await recordRankings(
			db,
			receiptWith(
				[{ candidate: lore(51), included: true, reason: "keyword" }],
				[{ candidate: lore(51), included: false, reason: "budget" }]
			),
			{ runRowId: await runRow(), sessionId, userId: 1 }
		)
		const [stat] = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(eq(schema.rankingSubjectStats.sessionId, sessionId))
		// One turn, however many rankings judged it.
		expect(stat).toMatchObject({ timesJudged: 1, timesIncluded: 1, lastIncluded: true, lastReason: "keyword" })
	})

	it("a stated subject kind must be the package's own; lore-entry is core's to state", () => {
		const stated = (kind: string, id: unknown = 7) =>
			({ subject: { kind, id }, included: true, reason: "x" }) as any
		expect(subjectOf(stated("acme.dice:roll"), "acme.dice:task/roll@1")).toEqual({ kind: "acme.dice:roll", id: "7" })
		// Another package's slug, or core's own kind, is no subject.
		expect(subjectOf(stated("other.pkg:roll"), "acme.dice:task/roll@1")).toBeNull()
		expect(subjectOf(stated("lore-entry"), "acme.dice:task/roll@1")).toBeNull()
		expect(subjectOf(stated("lore-entry"), "core:task/rank-hybrid@1")).toEqual({ kind: "lore-entry", id: "7" })
		// Not a subject kind at all, or an id past the bound.
		expect(subjectOf(stated("Not A Kind"), "core:task/rank-hybrid@1")).toBeNull()
		expect(subjectOf(stated("acme.dice:roll", "x".repeat(65)), "acme.dice:task/roll@1")).toBeNull()
		// A plugin ranker's lore candidates are still lore: core's sources made them.
		expect(subjectOf({ candidate: lore(9), included: true, reason: "x" } as any, "acme.dice:task/roll@1")).toEqual({
			kind: "lore-entry",
			id: "9"
		})
	})

	it("a deleted session takes its rankings and rollup with it", async () => {
		const sessionId = await newSession()
		await recordRankings(db, receiptWith([{ candidate: lore(61), included: true, reason: "keyword" }]), {
			runRowId: await runRow(),
			sessionId,
			userId: 1
		})
		await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect(await db.select().from(schema.rankings).where(eq(schema.rankings.sessionId, sessionId))).toHaveLength(0)
		expect(
			await db.select().from(schema.rankingSubjectStats).where(eq(schema.rankingSubjectStats.sessionId, sessionId))
		).toHaveLength(0)
	})
})
