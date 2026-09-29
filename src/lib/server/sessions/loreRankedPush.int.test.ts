/**
 * The lore-ranked push (R81): a run that ranked a session's lore tells the
 * session ONCE, after the ranking store committed — the rollup a reader then
 * asks for is already there — scoped on `sessionId`. Nothing is said for a
 * run that ranked no lore, a session-less run, a preview that left nothing
 * behind, or a run with no socket server.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { scopeOfPayload, isGatedEvent } from "$lib/shared/sockets/interest"

let db: TestDb
let n = 0

/** What the rollup held for the session at the moment each push went out. */
const seenAtPush: Array<{ sessionId: number; rows: number }> = []
const record = async (_io: unknown, sessionId: number, _event: string, _data: unknown) => {
	// Read through the OUTER handle: inside the store's transaction this
	// would be refused (transactionGuard) — and before its commit, empty.
	const rows = await db
		.select()
		.from(schema.rankingSubjectStats)
		.where(eq(schema.rankingSubjectStats.sessionId, sessionId))
	seenAtPush.push({ sessionId, rows: rows.length })
}
const broadcast = vi.fn(record)
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: broadcast
}))

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	await db
		.insert(schema.users)
		.values({ id: 1, username: "lore-ranked-owner" } as any)
		.onConflictDoNothing()
}, 60_000)

beforeEach(() => {
	// Reset, not cleared: a once-implementation one test queued and never
	// spent must not reach the next.
	broadcast.mockReset()
	broadcast.mockImplementation(record)
	seenAtPush.length = 0
})

async function newSession(): Promise<number> {
	const [row] = await db
		.insert(schema.sessions)
		.values({ name: `lore-ranked-${n++}`, isGroup: false, userId: 1 } as any)
		.returning({ id: schema.sessions.id })
	return row.id
}

const lore = (id: number) => ({ id, source: "worldLore", tokens: 10, payload: { id, name: `Entry ${id}` } })

/** A turn's receipt whose one ranking judged these candidates. */
const receiptWith = (decisions: unknown[], extra: Record<string, unknown> = {}) =>
	({
		runId: `lore-ranked:${n++}`,
		specId: "core:spec/respond",
		specVersion: "1.0.0",
		outcome: "ok",
		triggerSource: "event",
		seed: "s",
		startedAt: Date.now(),
		endedAt: Date.now() + 1,
		nodes: [
			{ seq: 0, nodeKey: "input", kind: "inlet", definitionId: "core:inlet/user-message@1", result: "ok", output: { speaker: "character:3" } },
			{
				seq: 1,
				nodeKey: "rank",
				kind: "task",
				definitionId: "core:task/rank-hybrid@1",
				result: "ok",
				input: { budget: { remaining: 900 } },
				output: { decisions }
			}
		],
		emitted: [],
		consumption: { tokens: 0, nodeExecutions: 2 },
		...extra
	}) as any

const io = {} as any

describe("sessions:loreRanked", () => {
	it("is pushed once, scoped on the session, after the rollup it announces was committed", async () => {
		const { saveReceipt } = await import("$lib/server/pipelines/runtime/receipts")
		const sessionId = await newSession()
		const id = await saveReceipt(
			db,
			receiptWith([
				{ candidate: lore(21), included: true, reason: "keyword" },
				{ candidate: lore(22), included: false, reason: "budget" }
			]),
			{ sessionId, userId: 1, io }
		)
		expect(id).not.toBeNull()
		expect(broadcast).toHaveBeenCalledTimes(1)
		expect(broadcast).toHaveBeenCalledWith(io, sessionId, "sessions:loreRanked", { sessionId })
		// The rows were there to read when the push went out.
		expect(seenAtPush).toEqual([{ sessionId, rows: 2 }])
		// The payload names the scope the session page declares, and the gate knows the event.
		expect(isGatedEvent("sessions:loreRanked")).toBe(true)
		expect(scopeOfPayload("sessions:loreRanked", { sessionId })).toBe(String(sessionId))
		const [stat] = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(
				and(
					eq(schema.rankingSubjectStats.sessionId, sessionId),
					eq(schema.rankingSubjectStats.subjectId, "21")
				)
			)
		expect(stat).toMatchObject({ timesJudged: 1, lastIncluded: true })
	}, 60_000)

	it("is not pushed for a run that ranked no lore, a session-less run, a preview, or no socket server", async () => {
		const { saveReceipt } = await import("$lib/server/pipelines/runtime/receipts")
		const sessionId = await newSession()
		// Messages only: counted on the ranking, never a lore subject.
		await saveReceipt(
			db,
			receiptWith([{ candidate: { id: 99, source: "messages", tokens: 5 }, included: true, reason: "recent" }]),
			{ sessionId, userId: 1, io }
		)
		// Outside any session.
		await saveReceipt(db, receiptWith([{ candidate: lore(23), included: true, reason: "keyword" }]), {
			userId: 1,
			io
		})
		// A preview that left nothing behind is never stored.
		await saveReceipt(
			db,
			receiptWith([{ candidate: lore(24), included: true, reason: "keyword" }], { preview: true }),
			{ sessionId, userId: 1, io, artifacts: [] }
		)
		// Stored, but nobody to tell.
		await saveReceipt(db, receiptWith([{ candidate: lore(25), included: true, reason: "keyword" }]), {
			sessionId,
			userId: 1
		})
		expect(broadcast).not.toHaveBeenCalled()
		const rows = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(eq(schema.rankingSubjectStats.sessionId, sessionId))
		// Only the last run rolled lore up for this session.
		expect(rows.map((r) => r.subjectId)).toEqual(["25"])
	}, 60_000)

	it("a push that fails is logged, and the store and the receipt stand", async () => {
		const { saveReceipt } = await import("$lib/server/pipelines/runtime/receipts")
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		broadcast.mockImplementationOnce(async () => {
			throw new Error("socket gone")
		})
		const sessionId = await newSession()
		const id = await saveReceipt(db, receiptWith([{ candidate: lore(26), included: true, reason: "keyword" }]), {
			sessionId,
			userId: 1,
			io
		})
		expect(id).not.toBeNull()
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/could not tell the session its lore was ranked/),
			expect.any(Error)
		)
		const rows = await db
			.select()
			.from(schema.rankingSubjectStats)
			.where(eq(schema.rankingSubjectStats.sessionId, sessionId))
		expect(rows).toHaveLength(1)
		warn.mockRestore()
	}, 60_000)
})

describe("pushLoreRanked", () => {
	it("is a no-op with no socket server", async () => {
		const { pushLoreRanked } = await import("./loreRankedPush")
		await pushLoreRanked(undefined, 4)
		expect(broadcast).not.toHaveBeenCalled()
		await pushLoreRanked(io, 4)
		expect(broadcast).toHaveBeenCalledWith(io, 4, "sessions:loreRanked", { sessionId: 4 })
	})
})
