import { describe, it, expect, beforeAll } from "vitest"
import { and, eq, inArray } from "drizzle-orm"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { markSessionChangesConsumed } from "./sessionChanges"
import { FORM_SUPERSEDED_EVENT, recordFormSuperseded } from "./blocks"

/**
 * Overlap-safe consume: two runs reading the same unconsumed rows must not
 * both be able to mark them — only the first mark should win, and the loser
 * has to be told it lost rather than silently believing it delivered
 * everything it read (see the docblock on `markSessionChangesConsumed`).
 */

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "session-changes-user")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session.id
}, 60_000)

describe("markSessionChangesConsumed", () => {
	it("lets only the first of two racing marks claim the rows", async () => {
		const [a, b] = await db
			.insert(schema.sessionChanges)
			.values([
				{
					sessionId,
					event: "core:event/message-deleted@1",
					payload: { event: "core:event/message-deleted@1" }
				},
				{
					sessionId,
					event: "core:event/message-hidden@1",
					payload: { event: "core:event/message-hidden@1" }
				}
			])
			.returning()
		const ids = [a.id, b.id]

		// The first run reads and marks — it should claim both rows.
		const firstCount = await markSessionChangesConsumed(db, ids, "run-a")
		expect(firstCount).toBe(2)

		// A second run that read the same unconsumed rows before either
		// marked (the race this guards) tries to mark the same ids and must
		// come back short: the rows are already claimed, not re-claimed.
		const secondCount = await markSessionChangesConsumed(db, ids, "run-b")
		expect(secondCount).toBe(0)

		// The rows stay credited to the run that actually won them, never
		// overwritten by the loser.
		const rows = await db
			.select({
				id: schema.sessionChanges.id,
				consumedByRunId: schema.sessionChanges.consumedByRunId
			})
			.from(schema.sessionChanges)
			.where(inArray(schema.sessionChanges.id, ids))
		const byId = new Map(rows.map((r) => [r.id, r.consumedByRunId]))
		expect(byId.get(a.id)).toBe("run-a")
		expect(byId.get(b.id)).toBe("run-a")
	})

	it("marks a partial overlap only for the ids still unconsumed", async () => {
		const [a, b] = await db
			.insert(schema.sessionChanges)
			.values([
				{
					sessionId,
					event: "core:event/message-edited@1",
					payload: { event: "core:event/message-edited@1" }
				},
				{
					sessionId,
					event: "core:event/message-swiped@1",
					payload: { event: "core:event/message-swiped@1" }
				}
			])
			.returning()

		// Run A only ever saw `a` (say, its read window ended before `b` was
		// written) and marks it alone.
		const firstCount = await markSessionChangesConsumed(db, [a.id], "run-a")
		expect(firstCount).toBe(1)

		// Run B's read included both — its mark should claim only `b`, the
		// one still unconsumed, and report exactly that.
		const secondCount = await markSessionChangesConsumed(
			db,
			[a.id, b.id],
			"run-b"
		)
		expect(secondCount).toBe(1)
	})
})

/**
 * The once of `form-superseded` (U5f review, 2026-09-17): two stale presses
 * reaching the door together — a person's press and an oracle's dispatched
 * answer are two callers of `fireAction`, and only the socket door is
 * serialised in memory — each find no record and, without the
 * `formSuperseded` advisory lock around check-and-insert, both record.
 *
 * ⚠ PGlite is one connection and runs the two transactions one after the
 * other on its own — but it interleaves two callers' queries turn about
 * ahead of a transaction, which is exactly the defect's shape (check, check,
 * insert, insert), so this does detect the regression; the lock is what
 * makes the same true on a pool.
 */
describe("recordFormSuperseded", () => {
	it("records a form superseded once when two stale presses land together", async () => {
		const form = { sessionId, messageId: 4242, blockId: "q1" }
		await Promise.all([recordFormSuperseded(db, form), recordFormSuperseded(db, form)])
		const rows = await db
			.select({ id: schema.sessionChanges.id, payload: schema.sessionChanges.payload })
			.from(schema.sessionChanges)
			.where(
				and(
					eq(schema.sessionChanges.sessionId, sessionId),
					eq(schema.sessionChanges.event, FORM_SUPERSEDED_EVENT)
				)
			)
		expect(rows, "two presses each found no record and both recorded").toHaveLength(1)
		expect(rows[0]!.payload).toMatchObject({ messageId: 4242, blockId: "q1" })

		// Another block on the same message is its own once.
		await recordFormSuperseded(db, { ...form, blockId: "q2" })
		await recordFormSuperseded(db, { ...form, blockId: "q2" })
		const after = await db
			.select({ id: schema.sessionChanges.id })
			.from(schema.sessionChanges)
			.where(
				and(
					eq(schema.sessionChanges.sessionId, sessionId),
					eq(schema.sessionChanges.event, FORM_SUPERSEDED_EVENT)
				)
			)
		expect(after).toHaveLength(2)
	})
})
