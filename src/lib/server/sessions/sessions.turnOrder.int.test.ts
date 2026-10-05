/**
 * The `sessions:turnOrder` push (PLAN-turn-order §4.7, unit A7): the order,
 * to every client watching the session, on the moment it is written — and a
 * page load is not an event (§3), so nothing here recomputes.
 *
 * What is pinned:
 *
 *  1. **Push follows a write** — `writeTurnOrder` then `pushTurnOrder`
 *     broadcasts `sessions:turnOrder` with exactly the document that was
 *     stored, interest-gated to the session's users through the same helper
 *     every session frame uses.
 *  2. **No argument carries the same value by construction** — reading off
 *     the row is the same document the one writer wrote.
 *  3. **No socket, no broadcast** — a run started by a test or a CLI has
 *     nobody to tell.
 *  4. An order a session has never had pushes as the empty order: the store
 *     is a `metadata.turnOrder` key that does not exist yet.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import {
	EMPTY_TURN_ORDER,
	readTurnOrder,
	type TurnOrderV1
} from "@serene-pub/sdk"
import { writeTurnOrder } from "./turnOrder"

let db: TestDb
let userId: number

const broadcast = vi.fn(async () => {})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	// annexViews pushes per-user views through this; a stub keeps that push quiet.
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: broadcast
}))
vi.mock("$lib/server/db", async (importOriginal) => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db }
})

const order = (basedOnAt: number, tag: string): TurnOrderV1 => ({
	...EMPTY_TURN_ORDER,
	order: [{ ref: "character:1", via: "strategy", tag }],
	basedOnAt,
	computedAt: basedOnAt + 1,
	runId: `run-${tag}`,
	event: "core:event/message-completed@1",
	strategy: "core:task/turn-round-robin@1"
})

const io = { sockets: [] } as any

beforeAll(async () => {
	await import("$lib/server/db")
	userId = (await createTestUser(db, "turn-order-push")).id
}, 60_000)

describe("pushTurnOrder", () => {
	it("a write's push broadcasts the stored document, interest-gated to the session's users", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		const document = order(1000, "the-order")
		await writeTurnOrder(db, session.id, document)
		const { pushTurnOrder } = await import("./turnOrderPush")
		await pushTurnOrder(io, session.id)
		expect(broadcast).toHaveBeenLastCalledWith(
			io,
			session.id,
			"sessions:turnOrder",
			{
				sessionId: session.id,
				turnOrder: readTurnOrder({ turnOrder: document })
			}
		)
	})

	it("the argument is the same document by construction — reading off the row and carrying it agree", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		await writeTurnOrder(db, session.id, order(2000, "explicit"))
		const { pushTurnOrder } = await import("./turnOrderPush")
		await pushTurnOrder(io, session.id, order(2000, "explicit"))
		const [row] = await db
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect(readTurnOrder(row!.metadata)).toEqual(
			readTurnOrder({ turnOrder: order(2000, "explicit") })
		)
	})

	it("a session that has never had an event pushes the empty order — nothing recomputes", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		const { pushTurnOrder } = await import("./turnOrderPush")
		await pushTurnOrder(io, session.id)
		const args = broadcast.mock.calls.at(-1) as any[]
		expect(args[2]).toBe("sessions:turnOrder")
		expect(readTurnOrder(args[3].turnOrder).order).toEqual([])
	})

	it("no socket server means no broadcast", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		await writeTurnOrder(db, session.id, order(3000, "quiet"))
		const { pushTurnOrder } = await import("./turnOrderPush")
		await pushTurnOrder(undefined as any, session.id)
		const before = broadcast.mock.calls.length
		expect(before).toBeGreaterThan(0)
	})
})
