/**
 * `writeTurnOrder` (PLAN-turn-order §4.2, unit A4): the ONE write path for
 * stored turn order, annex owner `core`'s `turnOrder`. Under the annex lock
 * (`lockSessionAnnex`) it reads the stored `basedOnAt`, drops a write
 * whose `basedOnAt` is older than what is stored (`{ written: false,
 * reason: 'stale' }`), and otherwise sets the one key as raw SQL —
 * so `updated_at` does not move, no `sessions:update` handler runs, and the
 * column is never read-modify-written.
 *
 * Plus the keyed lock it rides on: `withKeyedLock(key, id, fn)` serialises
 * same-(key, id) callers and leaves different keys — and different ids —
 * fully parallel; `withSessionGenerationLock` is the `generation` key.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { EMPTY_TURN_ORDER, readTurnOrder, type TurnOrderV1 } from "@serene-pub/sdk"
import { writeTurnOrder } from "./turnOrder"
import { coreAnnexIn } from "./coreAnnex"
import { withKeyedLock, withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"

let db: TestDb
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	userId = (await createTestUser(db, "turn-order-write")).id
}, 60_000)

const order = (basedOnAt: number, tag: string): TurnOrderV1 => ({
	...EMPTY_TURN_ORDER,
	order: [{ ref: "character:1", via: "strategy", tag }],
	basedOnAt,
	computedAt: basedOnAt + 1,
	runId: `run-${tag}`,
	event: "core:event/message-completed@1",
	strategy: "core:task/turn-round-robin@1"
})

async function makeSession(metadata: Record<string, unknown> = {}, annex: Record<string, unknown> = {}) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, metadata, annex })
		.returning()
	return session
}

const rowOf = async (id: number) =>
	(await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)))[0]!

describe("writeTurnOrder", () => {
	it("writes the document under annex owner core's turnOrder and leaves every other key alone", async () => {
		const s = await makeSession(
			{ keep: { nested: true }, other: 3 },
			{ core: { turnTally: { v: 1, lanes: {} }, "retake-quietly": true }, acme: { x: 1 } }
		)
		// Pin `updated_at` to a past instant so "unchanged" is a real
		// assertion and not now equalling now.
		await db.execute(
			sql`update ${schema.sessions} set updated_at = '2000-01-01T00:00:00Z' where id = ${s.id}`
		)
		const before = await rowOf(s.id)
		expect(new Date(before.updatedAt as Date).toISOString()).toContain("2000-01-01")
		const result = await writeTurnOrder(db, s.id, order(1000, "first"))
		expect(result).toEqual({ written: true })
		const after = await rowOf(s.id)
		expect(after.metadata.keep).toEqual({ nested: true })
		expect(after.metadata.other).toBe(3)
		expect((after.metadata as Record<string, unknown>).turnOrder).toBeUndefined()
		expect(coreAnnexIn(after.annex).turnTally).toEqual({ v: 1, lanes: {} })
		expect(coreAnnexIn(after.annex)["retake-quietly"]).toBe(true)
		expect((after.annex as Record<string, unknown>).acme).toEqual({ x: 1 })
		expect(readTurnOrder(coreAnnexIn(after.annex))).toMatchObject({
			v: 1,
			basedOnAt: 1000,
			runId: "run-first",
			order: [{ ref: "character:1", via: "strategy", tag: "first" }]
		})
		// Raw SQL: the drizzle `$onUpdate` never ran, so `updated_at` is as it was.
		expect(after.updatedAt).toEqual(before.updatedAt)
	})

	it("an older write returns stale and changes nothing", async () => {
		const s = await makeSession()
		expect(await writeTurnOrder(db, s.id, order(2000, "newer"))).toEqual({ written: true })
		expect(await writeTurnOrder(db, s.id, order(1000, "older"))).toEqual({
			written: false,
			reason: "stale"
		})
		expect(readTurnOrder(coreAnnexIn((await rowOf(s.id)).annex)).runId).toBe("run-newer")
	})

	it("an equal basedOnAt is not stale — the later write wins", async () => {
		const s = await makeSession()
		await writeTurnOrder(db, s.id, order(3000, "a"))
		expect(await writeTurnOrder(db, s.id, order(3000, "b"))).toEqual({ written: true })
		expect(readTurnOrder(coreAnnexIn((await rowOf(s.id)).annex)).runId).toBe("run-b")
	})

	it("concurrent writes keep the newer basedOnAt whichever lands first", async () => {
		const s = await makeSession()
		const results = await Promise.all([
			writeTurnOrder(db, s.id, order(5000, "late")),
			writeTurnOrder(db, s.id, order(4000, "early")),
			writeTurnOrder(db, s.id, order(4500, "middle"))
		])
		// Exactly the newest is stored; at least the newest was written, and
		// anything that ran after it was told it was stale.
		expect(results[0]).toEqual({ written: true })
		const stored = readTurnOrder(coreAnnexIn((await rowOf(s.id)).annex))
		expect(stored.basedOnAt).toBe(5000)
		expect(stored.runId).toBe("run-late")
	})

	it("a missing or invalid stored document never blocks a write, and a missing metadata column value is coalesced", async () => {
		const s = await makeSession({}, { core: { turnOrder: "garbage" } })
		expect(await writeTurnOrder(db, s.id, order(10, "over-garbage"))).toEqual({
			written: true
		})
		expect(readTurnOrder(coreAnnexIn((await rowOf(s.id)).annex)).runId).toBe("run-over-garbage")
	})

	it("a session that does not exist is not written — and is not stale either", async () => {
		expect(await writeTurnOrder(db, 999_999, order(1, "nobody"))).toEqual({
			written: false
		})
	})
})

describe("withKeyedLock", () => {
	const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

	it("serialises same-(key, id) callers in order", async () => {
		const seen: string[] = []
		await Promise.all([
			withKeyedLock("turnOrder", 1, async () => {
				await wait(20)
				seen.push("a")
			}),
			withKeyedLock("turnOrder", 1, async () => {
				seen.push("b")
			})
		])
		expect(seen).toEqual(["a", "b"])
	})

	it("different keys on the same id, and different ids, run in parallel", async () => {
		const seen: string[] = []
		await Promise.all([
			withKeyedLock("turnOrder", 1, async () => {
				await wait(20)
				seen.push("turnOrder:1")
			}),
			withKeyedLock("generation", 1, async () => {
				seen.push("generation:1")
			}),
			withKeyedLock("turnOrder", 2, async () => {
				seen.push("turnOrder:2")
			})
		])
		expect(seen.slice(0, 2).sort()).toEqual(["generation:1", "turnOrder:2"])
		expect(seen[2]).toBe("turnOrder:1")
	})

	it("a rejection releases the lock for the next caller", async () => {
		await expect(
			withKeyedLock("turnOrder", 3, async () => {
				throw new Error("boom")
			})
		).rejects.toThrow("boom")
		expect(await withKeyedLock("turnOrder", 3, async () => "next")).toBe("next")
	})

	it("withSessionGenerationLock is the generation key", async () => {
		const seen: string[] = []
		await Promise.all([
			withSessionGenerationLock(7, async () => {
				await wait(20)
				seen.push("first")
			}),
			withKeyedLock("generation", 7, async () => {
				seen.push("second")
			})
		])
		expect(seen).toEqual(["first", "second"])
	})
})
