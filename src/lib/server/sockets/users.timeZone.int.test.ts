/**
 * Timestamps are UTC instants, and the profile time zone only changes how
 * they are shown (owner ruling 2026-10-15).
 *
 * The bug this pins: `users`, `sessions`, `session_messages` and four more
 * tables declared `created_at`/`updated_at` as PG `date`. A row made at 17:00
 * Pacific stored "2026-10-15"; the client parsed that as UTC midnight — 17:00
 * on the 14th in Los Angeles — so a new session read "10 h ago" and an account
 * "Created 10/14". 0102 makes them `timestamp with time zone`.
 */
import { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { timeAgo } from "$lib/client/utils/timeAgo"

let testDb: TestDb

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

let userId: number

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: "tz-user" })
		.returning()
	userId = u.id
}, 60_000)

const sock = (id: number) => ({ user: { id, isAdmin: false } }) as any
const noopEmit = (async () => {}) as any

async function storedZone() {
	const row = await testDb.query.users.findFirst({
		where: eq(schema.users.id, userId),
		columns: { timeZone: true }
	})
	return row?.timeZone
}

describe("created_at / updated_at are instants, not days", () => {
	test("a new account's createdAt is now, to the second", async () => {
		const row = await testDb.query.users.findFirst({
			where: eq(schema.users.id, userId)
		})
		expect(row!.createdAt).toBeInstanceOf(Date)
		expect(Math.abs(row!.createdAt.getTime() - Date.now())).toBeLessThan(60_000)
	}, 60_000)

	test("a new session reads 'just now', created and updated", async () => {
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		expect(Math.abs(s.createdAt.getTime() - Date.now())).toBeLessThan(60_000)
		// What the wire carries — the ISO string a Date serialises to.
		expect(timeAgo(JSON.parse(JSON.stringify(s.updatedAt)))).toBe("just now")
		const [m] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: s.id, userId, role: "user", content: "hi" })
			.returning()
		expect(timeAgo(m.createdAt)).toBe("just now")
	}, 60_000)

	test("0102's date → timestamptz cast keeps a stored day at UTC midnight", async () => {
		// PGlite's session zone is GMT whatever the host's TZ, so the cast
		// reads an old `date` as UTC midnight of that day — no shift.
		const pg = new PGlite()
		try {
			await pg.exec(`CREATE TABLE t (d date); INSERT INTO t VALUES ('2026-10-15');`)
			await pg.exec(`ALTER TABLE t ALTER COLUMN d SET DATA TYPE timestamp with time zone`)
			const r = await pg.query<{ d: Date }>(`SELECT d FROM t`)
			expect(new Date(r.rows[0].d).toISOString()).toBe("2026-10-15T00:00:00.000Z")
		} finally {
			await pg.close()
		}
	}, 60_000)
})

describe("users:current:setTimeZone", () => {
	async function set(timeZone: string, onlyIfUnset?: boolean) {
		const { usersCurrentSetTimeZone } = await import("./users")
		return usersCurrentSetTimeZone.handler(
			sock(userId),
			{ timeZone, onlyIfUnset },
			noopEmit
		)
	}

	test("the first-load report fills an unset zone, canonically, once", async () => {
		expect(await storedZone()).toBeNull()
		const first = await set("US/Pacific", true)
		expect(first).toMatchObject({ changed: true, timeZone: "America/Los_Angeles" })
		expect(await storedZone()).toBe("America/Los_Angeles")
		const again = await set("Asia/Tokyo", true)
		expect(again.changed).toBe(false)
		expect(await storedZone()).toBe("America/Los_Angeles")
	}, 60_000)

	test("the picker overwrites; an unknown zone is refused", async () => {
		expect((await set("Europe/Paris")).changed).toBe(true)
		expect(await storedZone()).toBe("Europe/Paris")
		await expect(set("Nope/Nowhere")).rejects.toThrow("Unknown time zone")
		expect(await storedZone()).toBe("Europe/Paris")
	}, 60_000)
})
