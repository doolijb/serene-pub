/**
 * The `your-move` producer (PLAN-notifications §5, owner ruling Q1) against a
 * real session whose order is stored on `sessions.metadata.turnOrder`.
 *
 * Pinned:
 *  1. A person head raises for that person; an empty order raises nothing.
 *  2. The same head settled again does not re-raise — `read_at` stays.
 *  3. The head moving to an AI entry clears the row `superseded`.
 *  4. The due user's own send clears their row `acted`.
 *  5. The head moving from one member to another supersedes the first.
 *  6. A deleted session: the boot re-check and the delete's prefix clear.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { EMPTY_TURN_ORDER, type TurnEntryV1 } from "@serene-pub/sdk"
import { regardingFor, YOUR_MOVE } from "$lib/shared/notifications/kinds"

let db: TestDb
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db }
})

let ownerId: number
let guestId: number

async function makeSession(name = "Tea at Elara's") {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: true, name })
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guestId })
	const persona = async (userId: number, name: string) => {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId, name, description: name, metadata: {} } as any)
			.returning()
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: c.id })
		return c.id
	}
	const ownerPersona = await persona(ownerId, "Owner persona")
	const guestPersona = await persona(guestId, "Guest persona")
	const [ai] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: "Elara",
			description: "Elara",
			metadata: {}
		} as any)
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: ai.id, position: 0 })
	return { id: session.id, ownerPersona, guestPersona, aiId: ai.id }
}

async function setHead(sessionId: number, ref: string | null) {
	const order: TurnEntryV1[] = ref
		? [{ ref: ref as TurnEntryV1["ref"], via: "strategy" }]
		: []
	await db
		.update(schema.sessions)
		.set({
			metadata: {
				turnOrder: {
					...EMPTY_TURN_ORDER,
					order,
					basedOnAt: Date.now(),
					computedAt: Date.now(),
					strategy: "core:task/turn-round-robin@1"
				}
			}
		} as any)
		.where(eq(schema.sessions.id, sessionId))
}

async function rowsFor(sessionId: number) {
	return await db
		.select()
		.from(schema.notifications)
		.where(eq(schema.notifications.regarding, regardingFor.move(sessionId)))
		.orderBy(schema.notifications.id)
}

beforeAll(async () => {
	await import("$lib/server/db")
	ownerId = (await createTestUser(db, "your-move-owner")).id
	guestId = (await createTestUser(db, "your-move-guest")).id
}, 60_000)

describe("your-move", () => {
	it("an empty order raises nothing; a person head raises for that person", async () => {
		const { settleYourMove } = await import("./yourMove")
		const s = await makeSession()
		await setHead(s.id, null)
		await settleYourMove(db as any, { sessionId: s.id })
		expect(await rowsFor(s.id)).toHaveLength(0)

		await setHead(s.id, `character:${s.ownerPersona}`)
		await settleYourMove(db as any, { sessionId: s.id })
		const rows = await rowsFor(s.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			userId: ownerId,
			kind: YOUR_MOVE.id,
			href: `/sessions/${s.id}`,
			vars: { session: "Tea at Elara's" },
			clearedAt: null
		})
	}, 60_000)

	it("the same head again does not re-raise (read_at stays); an AI head supersedes", async () => {
		const { settleYourMove } = await import("./yourMove")
		const { markNotificationsRead } = await import("./store")
		const s = await makeSession()
		await setHead(s.id, `character:${s.guestPersona}`)
		await settleYourMove(db as any, { sessionId: s.id })
		const [row] = await rowsFor(s.id)
		expect(row.userId).toBe(guestId)
		await markNotificationsRead(guestId, [row.id], db as any)
		const [read] = await rowsFor(s.id)
		expect(read.readAt).not.toBeNull()

		await settleYourMove(db as any, {
			sessionId: s.id,
			cause: { kind: "run", auto: true, userId: ownerId }
		})
		const again = await rowsFor(s.id)
		expect(again).toHaveLength(1)
		expect(again[0].readAt).toEqual(read.readAt)
		expect(again[0].lastRaisedAt).toEqual(read.lastRaisedAt)
		expect(again[0].clearedAt).toBeNull()

		await setHead(s.id, `character:${s.aiId}`)
		await settleYourMove(db as any, {
			sessionId: s.id,
			cause: { kind: "run", auto: false, userId: ownerId }
		})
		const [cleared] = await rowsFor(s.id)
		expect(cleared.clearedAt).not.toBeNull()
		expect(cleared.clearedHow).toBe("superseded")
	}, 60_000)

	it("the due user's own send clears their row as acted", async () => {
		const { settleYourMove } = await import("./yourMove")
		const s = await makeSession()
		await setHead(s.id, `user:${ownerId}`)
		await settleYourMove(db as any, { sessionId: s.id })
		expect((await rowsFor(s.id))[0].userId).toBe(ownerId)

		await setHead(s.id, `character:${s.aiId}`)
		await settleYourMove(db as any, {
			sessionId: s.id,
			cause: { kind: "user", userId: ownerId }
		})
		const [row] = await rowsFor(s.id)
		expect(row.clearedHow).toBe("acted")
	}, 60_000)

	it("the head moving to another member: sender acted, the next person raised", async () => {
		const { settleYourMove } = await import("./yourMove")
		const s = await makeSession()
		await setHead(s.id, `character:${s.ownerPersona}`)
		await settleYourMove(db as any, { sessionId: s.id })

		await setHead(s.id, `character:${s.guestPersona}`)
		await settleYourMove(db as any, {
			sessionId: s.id,
			cause: { kind: "user", userId: ownerId }
		})
		const rows = await rowsFor(s.id)
		expect(rows).toHaveLength(2)
		expect(rows[0]).toMatchObject({ userId: ownerId, clearedHow: "acted" })
		expect(rows[1]).toMatchObject({ userId: guestId, clearedAt: null })

		// Not caused by a send: the other's row is superseded.
		await setHead(s.id, `character:${s.ownerPersona}`)
		await settleYourMove(db as any, {
			sessionId: s.id,
			cause: { kind: "settings", userId: ownerId }
		})
		const after = await rowsFor(s.id)
		expect(after[1]).toMatchObject({
			userId: guestId,
			clearedHow: "superseded"
		})
		expect(
			after.filter((r) => r.userId === ownerId && r.clearedAt === null)
		).toHaveLength(1)
	}, 60_000)

	it("a persona whose owner left the session is nobody's move", async () => {
		const { settleYourMove } = await import("./yourMove")
		const s = await makeSession()
		await setHead(s.id, `character:${s.guestPersona}`)
		await settleYourMove(db as any, { sessionId: s.id })
		await db
			.delete(schema.sessionGuests)
			.where(
				and(
					eq(schema.sessionGuests.sessionId, s.id),
					eq(schema.sessionGuests.userId, guestId)
				)
			)
		await settleYourMove(db as any, { sessionId: s.id })
		const [row] = await rowsFor(s.id)
		expect(row.clearedHow).toBe("superseded")
	}, 60_000)

	it("a deleted session: the boot re-check clears its rows, and so does the delete's prefix clear", async () => {
		const { settleYourMove, recheckYourMove } = await import("./yourMove")
		const { clearNotifications } = await import("./store")
		const kept = await makeSession()
		await setHead(kept.id, `character:${kept.guestPersona}`)
		await settleYourMove(db as any, { sessionId: kept.id })

		const gone = await makeSession()
		await setHead(gone.id, `character:${gone.ownerPersona}`)
		await settleYourMove(db as any, { sessionId: gone.id })
		await db.delete(schema.sessions).where(eq(schema.sessions.id, gone.id))
		await recheckYourMove(db as any)
		expect((await rowsFor(gone.id))[0].clearedHow).toBe("superseded")
		// The still-due person's row survives the re-check.
		expect((await rowsFor(kept.id))[0].clearedAt).toBeNull()

		// The delete handler's clear: every row about the session, any user.
		const n = await clearNotifications(
			{ regarding: `session:${kept.id}/`, prefix: true },
			"superseded",
			db as any
		)
		expect(n).toBe(1)
		expect((await rowsFor(kept.id))[0].clearedHow).toBe("superseded")
	}, 60_000)
})
