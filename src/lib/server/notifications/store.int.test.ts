/**
 * The notifications store end to end against real migrations (0189): the
 * partial unique index that makes a raise an upsert, clears by exact key and
 * by prefix, the asker-scoped read/dismiss writes, the list's two orders, the
 * boot lapse of memory-backed kinds, and pruning of cleared rows only.
 *
 * Every store call is handed `testDb` explicitly; `$lib/server/db` is replaced
 * wholesale so importing the store never opens the real database, and
 * `pushToUser` is a spy so pushes can be asserted without sockets.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const { getDb, setDb, pushSpy, viewingSpy } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		},
		pushSpy: vi.fn(),
		// Nobody is viewing anything unless a test says so.
		viewingSpy: vi.fn((_userId: number, _href: string) => false)
	}
})

vi.mock("$lib/server/db", () => ({
	get db() {
		return getDb()
	}
}))

vi.mock("$lib/server/sockets/utils/userPush", () => ({
	pushToUser: pushSpy
}))

vi.mock("./viewing", () => ({
	userIsViewing: viewingSpy
}))

import {
	NOTIFICATION_IDS_CAP,
	clearNotifications,
	dismissNotifications,
	lapseMemoryBackedNotifications,
	listNotifications,
	markNotificationsRead,
	openNotifications,
	openNotificationsOfKind,
	pruneNotifications,
	raiseNotification
} from "./store"
import {
	ACTIVITY_READY,
	OPEN_FORM,
	REPLY_FAILED,
	YOUR_MOVE,
	defineNotificationKind
} from "$lib/shared/notifications/kinds"

const T = schema.notifications
let testDb: TestDb
let db: Db

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	db = testDb as unknown as Db
	setDb(testDb)
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
})

async function newUser(): Promise<number> {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb)).id
}

function rowsOf(userId: number) {
	return testDb.select().from(T).where(eq(T.userId, userId)).orderBy(T.id)
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe("notifications store (PGlite integration)", () => {
	test("raise creates one row per user and bumps an open row on re-raise", async () => {
		const a = await newUser()
		const b = await newUser()
		pushSpy.mockClear()

		await raiseNotification(
			{
				userIds: [a, b, a],
				kind: YOUR_MOVE.id,
				regarding: "session:1/move",
				href: "/sessions/1",
				vars: { session: "The Guard Room" }
			},
			db
		)
		const [first] = await rowsOf(a)
		expect(await rowsOf(a)).toHaveLength(1)
		expect(await rowsOf(b)).toHaveLength(1)
		expect(first).toMatchObject({
			kind: YOUR_MOVE.id,
			level: "attention",
			href: "/sessions/1",
			vars: { session: "The Guard Room" },
			readAt: null,
			clearedAt: null
		})
		expect(pushSpy).toHaveBeenCalledWith(a, "notifications:changed", expect.any(Function))
		expect(pushSpy).toHaveBeenCalledWith(b, "notifications:changed", expect.any(Function))

		await testDb.update(T).set({ readAt: new Date() }).where(eq(T.id, first.id))
		await tick()
		await raiseNotification(
			{
				userIds: [a],
				kind: YOUR_MOVE.id,
				regarding: "session:1/move",
				href: "/sessions/1?again",
				vars: { session: "Renamed" }
			},
			db
		)
		const after = await rowsOf(a)
		expect(after).toHaveLength(1)
		expect(after[0].id).toBe(first.id)
		expect(after[0].readAt).toBeNull()
		expect(after[0].lastRaisedAt.getTime()).toBeGreaterThan(first.lastRaisedAt.getTime())
		expect(after[0].raisedAt.getTime()).toBe(first.raisedAt.getTime())
		expect(after[0].href).toBe("/sessions/1?again")
		expect(after[0].vars).toEqual({ session: "Renamed" })
	})

	test("an unknown kind raises nothing and does not throw", async () => {
		const a = await newUser()
		const err = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(
				raiseNotification(
					{ userIds: [a], kind: "nope:notification/missing@1", regarding: "x", href: "/" },
					db
				)
			).resolves.toBeUndefined()
		} finally {
			err.mockRestore()
		}
		expect(await rowsOf(a)).toHaveLength(0)
	})

	test("after a clear, raising the same regarding opens a NEW row", async () => {
		const a = await newUser()
		const input = {
			userIds: [a],
			kind: REPLY_FAILED.id,
			regarding: "session:2/failed:7",
			href: "/sessions/2"
		}
		await raiseNotification(input, db)
		expect(
			await clearNotifications({ regarding: input.regarding }, "acted", db)
		).toBe(1)
		await raiseNotification(input, db)
		const rows = await rowsOf(a)
		expect(rows).toHaveLength(2)
		expect(rows[0].clearedAt).not.toBeNull()
		expect(rows[1].clearedAt).toBeNull()
		expect(await openNotifications(input.regarding, db)).toHaveLength(1)
	})

	test("clearNotifications: exact, prefix, userId and exceptUserIds", async () => {
		const a = await newUser()
		const b = await newUser()
		const c = await newUser()
		const raise = (userIds: number[], regarding: string) =>
			raiseNotification({ userIds, kind: OPEN_FORM.id, regarding, href: "/" }, db)
		await raise([a, b, c], "session:42/move")
		await raise([a], "session:42/form:1/b1")
		await raise([a], "session:420/form:1/b1")
		await raise([a], "session:42_x/move")

		// Exact: only the one key, every user but the excepted one.
		expect(
			await clearNotifications(
				{ regarding: "session:42/move", exceptUserIds: [c] },
				"superseded",
				db
			)
		).toBe(2)
		const openC = await openNotifications("session:42/move", db)
		expect(openC.map((r) => r.id)).toHaveLength(1)
		expect((await rowsOf(c))[0].clearedAt).toBeNull()
		const [aMove] = (await rowsOf(a)).filter((r) => r.regarding === "session:42/move")
		expect(aMove.clearedHow).toBe("superseded")

		// LIKE wildcards in a prefix are literal: `session:4_/` matches nothing.
		expect(
			await clearNotifications({ regarding: "session:4_/", prefix: true }, "acted", db)
		).toBe(0)

		// Prefix: `session:42/` matches neither `session:420/` nor `session:42_x/`.
		expect(
			await clearNotifications({ regarding: "session:42/", prefix: true }, "acted", db)
		).toBe(2) // a's form row + c's move row
		const aRows = await rowsOf(a)
		const byKey = Object.fromEntries(aRows.map((r) => [r.regarding, r]))
		expect(byKey["session:42/form:1/b1"].clearedHow).toBe("acted")
		expect(byKey["session:420/form:1/b1"].clearedAt).toBeNull()
		expect(byKey["session:42_x/move"].clearedAt).toBeNull()

		// userId filter.
		await raise([a, b], "session:9/move")
		expect(
			await clearNotifications({ regarding: "session:9/move", userId: b }, "dismissed", db)
		).toBe(1)
		expect((await openNotifications("session:9/move", db)).map((r) => r.id)).toEqual(
			(await rowsOf(a)).filter((r) => r.regarding === "session:9/move").map((r) => r.id)
		)
		// Nothing left to clear returns 0.
		expect(
			await clearNotifications({ regarding: "session:9/move", userId: b }, "dismissed", db)
		).toBe(0)
	})

	test("markNotificationsRead: asker-scoped, view/either clear as viewed, resolve only reads", async () => {
		const a = await newUser()
		const b = await newUser()
		await raiseNotification(
			{ userIds: [a], kind: YOUR_MOVE.id, regarding: "s:1/move", href: "/" },
			db
		)
		await raiseNotification(
			{ userIds: [a], kind: OPEN_FORM.id, regarding: "s:1/form", href: "/" },
			db
		)
		await raiseNotification(
			{ userIds: [a, b], kind: REPLY_FAILED.id, regarding: "s:1/failed", href: "/" },
			db
		)
		const [move, form, failedA] = await rowsOf(a)
		const [failedB] = await rowsOf(b)

		pushSpy.mockClear()
		await markNotificationsRead(
			a,
			[move.id, form.id, failedA.id, failedB.id, "abc", 1.5, -3, null],
			db
		)
		expect(pushSpy).toHaveBeenCalledWith(a, "notifications:changed", expect.any(Function))
		const [m, f, r] = await rowsOf(a)
		expect(m.readAt).not.toBeNull()
		expect(m.clearedAt).toBeNull()
		expect(f.readAt).not.toBeNull()
		expect(f.clearedHow).toBe("viewed")
		expect(r.clearedHow).toBe("viewed")
		const [rb] = await rowsOf(b)
		expect(rb.readAt).toBeNull()
		expect(rb.clearedAt).toBeNull()

		// Junk-only lists write nothing.
		await markNotificationsRead(b, ["1", {}, 0], db)
		await markNotificationsRead(b, "not an array", db)
		expect((await rowsOf(b))[0].readAt).toBeNull()

		// The cap: an id past the first NOTIFICATION_IDS_CAP is ignored.
		const filler = Array.from({ length: NOTIFICATION_IDS_CAP }, (_, i) => 10_000_000 + i)
		await markNotificationsRead(b, [...filler, failedB.id], db)
		expect((await rowsOf(b))[0].readAt).toBeNull()
		await markNotificationsRead(b, [failedB.id, ...filler], db)
		expect((await rowsOf(b))[0].clearedHow).toBe("viewed")
	})

	test("dismissNotifications: asker-scoped, cleared as dismissed", async () => {
		const a = await newUser()
		const b = await newUser()
		await raiseNotification(
			{ userIds: [a, b], kind: YOUR_MOVE.id, regarding: "s:5/move", href: "/" },
			db
		)
		const [ra] = await rowsOf(a)
		const [rb] = await rowsOf(b)
		await dismissNotifications(a, [ra.id, rb.id], db)
		const [da] = await rowsOf(a)
		expect(da.clearedHow).toBe("dismissed")
		expect(da.clearedAt).not.toBeNull()
		expect(da.readAt).not.toBeNull()
		const [db2] = await rowsOf(b)
		expect(db2.clearedAt).toBeNull()
		expect(db2.readAt).toBeNull()
	})

	test("listNotifications: open newest-first, cleared newest-first and limited", async () => {
		const a = await newUser()
		for (const key of ["one", "two", "three"]) {
			await raiseNotification(
				{ userIds: [a], kind: YOUR_MOVE.id, regarding: `list:${key}`, href: "/" },
				db
			)
			await tick()
		}
		// Re-raising "one" moves it to the top.
		await raiseNotification(
			{ userIds: [a], kind: YOUR_MOVE.id, regarding: "list:one", href: "/" },
			db
		)
		const base = Date.now() - 60 * 60 * 1000
		await testDb.insert(T).values(
			Array.from({ length: 55 }, (_, i) => ({
				userId: a,
				kind: REPLY_FAILED.id,
				regarding: `list:cleared:${i}`,
				level: "error" as const,
				href: "/",
				clearedAt: new Date(base + i * 1000),
				clearedHow: "viewed" as const
			}))
		)
		const list = await listNotifications(a, db)
		expect(list.open.map((r) => r.regarding)).toEqual([
			"list:one",
			"list:three",
			"list:two"
		])
		expect(list.cleared).toHaveLength(50)
		expect(list.cleared[0].regarding).toBe("list:cleared:54")
		expect(list.cleared[49].regarding).toBe("list:cleared:5")
		expect(typeof list.open[0].raisedAt).toBe("string")
	})

	test("lapseMemoryBackedNotifications lapses only open rows of memory-backed kinds", async () => {
		const MEMORY = defineNotificationKind({
			id: "test:notification/memory@1",
			level: "info",
			clearsOn: "resolve",
			title: "Memory-backed",
			cta: "Open",
			memoryBacked: true
		})
		const a = await newUser()
		await raiseNotification(
			{ userIds: [a], kind: MEMORY.id, regarding: "mem:1", href: "/" },
			db
		)
		await raiseNotification(
			{ userIds: [a], kind: MEMORY.id, regarding: "mem:2", href: "/" },
			db
		)
		await clearNotifications({ regarding: "mem:2" }, "acted", db)
		await raiseNotification(
			{ userIds: [a], kind: YOUR_MOVE.id, regarding: "mem:move", href: "/" },
			db
		)
		expect(await openNotificationsOfKind(MEMORY.id, db)).toHaveLength(1)

		expect(await lapseMemoryBackedNotifications(db)).toBe(1)
		const byKey = Object.fromEntries((await rowsOf(a)).map((r) => [r.regarding, r]))
		expect(byKey["mem:1"].clearedHow).toBe("lapsed")
		expect(byKey["mem:2"].clearedHow).toBe("acted")
		expect(byKey["mem:move"].clearedAt).toBeNull()
		expect(await openNotificationsOfKind(MEMORY.id, db)).toHaveLength(0)
	})

	test("pruneNotifications drops old and over-cap CLEARED rows, never open ones", async () => {
		const x = await newUser()
		const y = await newUser()
		const now = new Date("2030-01-01T00:00:00Z")
		const day = 24 * 60 * 60 * 1000
		const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day)
		const row = (userId: number, regarding: string, clearedDaysAgo: number | null, raisedDaysAgo = 100) => ({
			userId,
			kind: REPLY_FAILED.id,
			regarding,
			level: "error" as const,
			href: "/",
			raisedAt: at(raisedDaysAgo),
			lastRaisedAt: at(raisedDaysAgo),
			clearedAt: clearedDaysAgo === null ? null : at(clearedDaysAgo),
			clearedHow: clearedDaysAgo === null ? null : ("viewed" as const)
		})
		await testDb.insert(T).values([
			row(x, "x:open-ancient", null, 400),
			row(x, "x:old", 31),
			row(x, "x:c1", 1),
			row(x, "x:c2", 2),
			row(x, "x:c3", 3),
			row(x, "x:c4", 4),
			row(x, "x:c5", 5),
			row(y, "y:c1", 1),
			row(y, "y:c2", 2),
			row(y, "y:open", null, 50)
		])
		await pruneNotifications(db, now, { days: 30, maxPerUser: 3 })
		const kept = await testDb
			.select({ regarding: T.regarding })
			.from(T)
			.where(and(inArray(T.userId, [x, y])))
			.orderBy(T.regarding)
		expect(kept.map((r) => r.regarding)).toEqual([
			"x:c1",
			"x:c2",
			"x:c3",
			"x:open-ancient",
			"y:c1",
			"y:c2",
			"y:open"
		])
	})
})

describe("raise is context aware (a tab already showing the href)", () => {
	const viewingOnly = (...userIds: number[]) =>
		viewingSpy.mockImplementation((userId) => userIds.includes(userId))

	afterEach(() => {
		viewingSpy.mockReset()
		viewingSpy.mockImplementation(() => false)
	})

	test("clearsOn view: a viewer gets no row and no push; a non-viewer is shipped as usual", async () => {
		const watching = await newUser()
		const away = await newUser()
		viewingOnly(watching)
		pushSpy.mockClear()

		await raiseNotification(
			{
				userIds: [watching, away],
				kind: REPLY_FAILED.id,
				regarding: "session:70/reply-failed",
				href: "/sessions/70"
			},
			db
		)
		expect(viewingSpy).toHaveBeenCalledWith(watching, "/sessions/70")
		expect(await rowsOf(watching)).toHaveLength(0)
		expect(await rowsOf(away)).toHaveLength(1)
		expect((await rowsOf(away))[0]).toMatchObject({ readAt: null, clearedAt: null })
		expect(pushSpy).not.toHaveBeenCalledWith(watching, expect.anything(), expect.anything())
		expect(pushSpy).toHaveBeenCalledWith(away, "notifications:changed", expect.any(Function))
	})

	test("clearsOn either: an open row the viewer already had is cleared viewed, not bumped", async () => {
		const u = await newUser()
		await raiseNotification(
			{
				userIds: [u],
				kind: OPEN_FORM.id,
				regarding: "session:71/form:1",
				href: "/sessions/71"
			},
			db
		)
		const [before] = await rowsOf(u)
		expect(before).toMatchObject({ clearedAt: null, readAt: null })

		viewingOnly(u)
		pushSpy.mockClear()
		await tick()
		await raiseNotification(
			{
				userIds: [u],
				kind: OPEN_FORM.id,
				regarding: "session:71/form:1",
				href: "/sessions/71",
				vars: { session: "new" }
			},
			db
		)
		const rows = await rowsOf(u)
		expect(rows).toHaveLength(1)
		expect(rows[0].clearedHow).toBe("viewed")
		expect(rows[0].clearedAt).not.toBeNull()
		expect(rows[0].readAt).not.toBeNull()
		// Cleared, not bumped: the raise's new vars never landed.
		expect(rows[0].lastRaisedAt.getTime()).toBe(before.lastRaisedAt.getTime())
		expect(rows[0].vars).toEqual({})
		expect(pushSpy).toHaveBeenCalledWith(u, "notifications:changed", expect.any(Function))
	})

	test("clearsOn either: a read open row keeps its first read time when cleared", async () => {
		const u = await newUser()
		await raiseNotification(
			{ userIds: [u], kind: OPEN_FORM.id, regarding: "session:72/form:1", href: "/sessions/72" },
			db
		)
		const readAt = new Date("2026-01-02T03:04:05Z")
		await testDb.update(T).set({ readAt }).where(eq(T.userId, u))
		viewingOnly(u)
		await raiseNotification(
			{ userIds: [u], kind: OPEN_FORM.id, regarding: "session:72/form:1", href: "/sessions/72" },
			db
		)
		const [row] = await rowsOf(u)
		expect(row.clearedHow).toBe("viewed")
		expect(row.readAt?.getTime()).toBe(readAt.getTime())
	})

	test("clearsOn resolve: a viewer's row is inserted already read and still pushed", async () => {
		const watching = await newUser()
		const away = await newUser()
		viewingOnly(watching)
		pushSpy.mockClear()

		await raiseNotification(
			{
				userIds: [watching, away],
				kind: YOUR_MOVE.id,
				regarding: "session:73/move",
				href: "/sessions/73"
			},
			db
		)
		const [w] = await rowsOf(watching)
		const [a] = await rowsOf(away)
		expect(w).toMatchObject({ clearedAt: null })
		expect(w.readAt).not.toBeNull()
		expect(a).toMatchObject({ clearedAt: null, readAt: null })
		expect(pushSpy).toHaveBeenCalledWith(watching, "notifications:changed", expect.any(Function))
		expect(pushSpy).toHaveBeenCalledWith(away, "notifications:changed", expect.any(Function))
	})

	test("clearsOn resolve: a re-raise while viewing bumps the open row but leaves it read", async () => {
		const u = await newUser()
		await raiseNotification(
			{ userIds: [u], kind: ACTIVITY_READY.id, regarding: "activity:74", href: "/sessions/74" },
			db
		)
		const [before] = await rowsOf(u)
		expect(before.readAt).toBeNull()

		viewingOnly(u)
		await tick()
		await raiseNotification(
			{
				userIds: [u],
				kind: ACTIVITY_READY.id,
				regarding: "activity:74",
				href: "/sessions/74",
				vars: { job: "Again" }
			},
			db
		)
		const rows = await rowsOf(u)
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(before.id)
		expect(rows[0].readAt).not.toBeNull()
		expect(rows[0].clearedAt).toBeNull()
		expect(rows[0].vars).toEqual({ job: "Again" })
		expect(rows[0].lastRaisedAt.getTime()).toBeGreaterThan(before.lastRaisedAt.getTime())
	})

	test("not viewing: a re-raise of a read resolve row lights it again (today's rule)", async () => {
		const u = await newUser()
		viewingOnly(u)
		await raiseNotification(
			{ userIds: [u], kind: YOUR_MOVE.id, regarding: "session:75/move", href: "/sessions/75" },
			db
		)
		expect((await rowsOf(u))[0].readAt).not.toBeNull()
		viewingOnly()
		await raiseNotification(
			{ userIds: [u], kind: YOUR_MOVE.id, regarding: "session:75/move", href: "/sessions/75" },
			db
		)
		expect((await rowsOf(u))[0].readAt).toBeNull()
	})

	test("a viewing check that throws falls back to shipping", async () => {
		const u = await newUser()
		viewingSpy.mockImplementation(() => {
			throw new Error("no io")
		})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await raiseNotification(
			{ userIds: [u], kind: REPLY_FAILED.id, regarding: "session:76/reply-failed", href: "/sessions/76" },
			db
		)
		warn.mockRestore()
		const rows = await rowsOf(u)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ readAt: null, clearedAt: null })
	})
})
