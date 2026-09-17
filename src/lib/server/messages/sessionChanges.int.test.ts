import { describe, it, expect, beforeAll } from "vitest"
import { inArray } from "drizzle-orm"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { markSessionChangesConsumed } from "./sessionChanges"

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
