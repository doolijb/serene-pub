/**
 * Promotion to admin requires a prior sign-in (plan 27 §5).
 *
 * A freshly created or invited account is an unproven claim about who holds it.
 * Granting it admin before anyone has demonstrated they can actually sign in
 * means a mistyped username or an intercepted invite hands over the instance.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
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
	// The account-management handlers refuse outright when accounts are off —
	// there is no roster to manage on a single-user instance.
	await testDb
		.insert(schemaModule.systemSettings)
		.values({ id: 1, isAccountsEnabled: true })
}, 60_000)

beforeEach(async () => {
	await testDb.delete(schemaModule.users)
	;[admin] = await testDb
		.insert(schemaModule.users)
		.values({ username: "admin", isAdmin: true, lastLoginAt: new Date() })
		.returning()
})

const noopEmit = () => {}
// Changing isAdmin disconnects the target's room so the new privilege level
// is re-read on reconnect, so the handler needs a usable `io`.
const socketFor = (id: number) =>
	({
		user: { id, isAdmin: true },
		io: { to: () => ({ disconnectSockets: () => {} }) }
	}) as any

async function makeMember(lastLoginAt: Date | null) {
	const [u] = await testDb
		.insert(schemaModule.users)
		.values({ username: `member-${Math.random()}`, lastLoginAt })
		.returning()
	return u
}

describe("users:create", () => {
	test("never creates an administrator, even when asked", async () => {
		const { usersCreate } = await import("./users")
		await usersCreate.handler(
			socketFor(admin.id),
			{
				username: "newcomer",
				isAdmin: true,
				passphrase: "Correct!Horse1"
			},
			noopEmit
		)
		const created = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.username, "newcomer")
		})
		expect(created?.isAdmin).toBe(false)
	})
})

describe("users:update", () => {
	test("refuses to promote an account that has never signed in", async () => {
		const { usersUpdate } = await import("./users")
		const member = await makeMember(null)
		await expect(
			usersUpdate.handler(
				socketFor(admin.id),
				{ id: member.id, isAdmin: true },
				noopEmit
			)
		).rejects.toThrow(/never signed in/i)

		const after = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.id, member.id)
		})
		expect(after?.isAdmin).toBe(false)
	})

	test("allows promotion once the account has signed in", async () => {
		const { usersUpdate } = await import("./users")
		const member = await makeMember(new Date())
		await usersUpdate.handler(
			socketFor(admin.id),
			{ id: member.id, isAdmin: true },
			noopEmit
		)
		const after = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.id, member.id)
		})
		expect(after?.isAdmin).toBe(true)
	})

	test("always allows demotion — removing privilege is the safe direction", async () => {
		const { usersUpdate } = await import("./users")
		const [member] = await testDb
			.insert(schemaModule.users)
			.values({ username: "was-admin", isAdmin: true, lastLoginAt: null })
			.returning()

		// Never signed in, yet somehow an admin (a restored backup, a legacy
		// row). Blocking demotion here would strand the instance.
		await usersUpdate.handler(
			socketFor(admin.id),
			{ id: member.id, isAdmin: false },
			noopEmit
		)
		const after = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.id, member.id)
		})
		expect(after?.isAdmin).toBe(false)
	})

	test("leaves other fields editable on an account that has never signed in", async () => {
		const { usersUpdate } = await import("./users")
		const member = await makeMember(null)
		await usersUpdate.handler(
			socketFor(admin.id),
			{ id: member.id, displayName: "Renamed" },
			noopEmit
		)
		const after = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.id, member.id)
		})
		expect(after?.displayName).toBe("Renamed")
	})
})
