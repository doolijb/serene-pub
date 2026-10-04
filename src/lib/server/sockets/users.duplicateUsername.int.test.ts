/**
 * A username already in use is refused in words — by the pre-check, and by the
 * unique index when two creates race past it.
 *
 * The index path is the one that broke silently: drizzle-orm (0.44+) wraps a
 * failed query, so the SQLSTATE the handler checks is on the driver error
 * under `.cause`, not on the error it catches. Read off the wrapper, the
 * violation is not recognised and the admin is told nothing useful — or, from
 * a handler that forwards `e.message`, is shown the SQL.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import * as schemaModule from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const schema = await import("$lib/server/db/schema")
	const db = await createTestDb()
	return { db, schema, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let admin: any

beforeAll(async () => {
	const m = await import("$lib/server/db")
	testDb = m.db as unknown as TestDb
	await testDb
		.insert(schemaModule.systemSettings)
		.values({ id: 1, isAccountsEnabled: true })
}, 60_000)

beforeEach(async () => {
	vi.restoreAllMocks()
	await testDb.delete(schemaModule.passphrases)
	await testDb.delete(schemaModule.users)
	;[admin] = await testDb
		.insert(schemaModule.users)
		.values({ username: "admin", isAdmin: true, lastLoginAt: new Date() })
		.returning()
	await testDb.insert(schemaModule.users).values({ username: "taken" })
})

const socketFor = (id: number) =>
	({
		user: { id, isAdmin: true },
		io: { to: () => ({ disconnectSockets: () => {} }) }
	}) as any

function collector() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => {
			events.push({ event, data })
		}
	}
}

describe("users:create with a username already in use", () => {
	test("the pre-check refuses it, emitted and thrown", async () => {
		const { usersCreate } = await import("./users")
		const c = collector()
		await expect(
			usersCreate.handler(
				socketFor(admin.id),
				{ username: "taken", passphrase: "Correct!Horse1" },
				c.emit
			)
		).rejects.toThrow("Username already exists")
		expect(c.events).toEqual([
			{
				event: "users:create:error",
				data: { error: "Username already exists" }
			}
		])
	}, 60_000)

	test("the index refuses it when the pre-check was raced past, in the same words", async () => {
		const { usersCreate } = await import("./users")
		const users = testDb.query.users
		const real = users.findFirst.bind(users)
		// The handler reads the caller's own row, then pre-checks the name.
		// The second read misses, as it would for a create racing another.
		const findFirst = vi.spyOn(users, "findFirst")
		findFirst.mockImplementationOnce(real as any)
		findFirst.mockResolvedValueOnce(undefined as any)

		const c = collector()
		await expect(
			usersCreate.handler(
				socketFor(admin.id),
				{ username: "taken", passphrase: "Correct!Horse1" },
				c.emit
			)
		).rejects.toThrow("Username already exists")
		expect(findFirst).toHaveBeenCalledTimes(2)
		expect(c.events).toEqual([
			{
				event: "users:create:error",
				data: { error: "Username already exists" }
			}
		])
		// Nothing of the query reached the admin.
		expect(JSON.stringify(c.events)).not.toMatch(/Failed query|insert into/i)

		const rows = await testDb.query.users.findMany({
			where: (u, { eq }) => eq(u.username, "taken")
		})
		expect(rows).toHaveLength(1)
	}, 60_000)
})
