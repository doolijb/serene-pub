/**
 * `users:current:updateDisplayName` — the signed-in person names themselves.
 *
 * Self-scoped, so it answers in every mode: accounts on or off, admin or
 * member. The stored value is the trimmed one, and an empty value clears the
 * name back to NULL — the app then calls the person by their username.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

let adminId: number
let memberId: number

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username: "name-admin", isAdmin: true })
		.returning()
	const [member] = await testDb
		.insert(schema.users)
		.values({ username: "name-member", isAdmin: false })
		.returning()
	adminId = admin.id
	memberId = member.id
}, 60_000)

const sock = (id: number, isAdmin: boolean) =>
	({
		user: { id, isAdmin },
		io: { to: () => ({ emit: () => {}, disconnectSockets: () => {} }) }
	}) as any
const noopEmit = (async () => {}) as any

async function setAccounts(enabled: boolean) {
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1, isAccountsEnabled: enabled })
		.onConflictDoUpdate({
			target: schema.systemSettings.id,
			set: { isAccountsEnabled: enabled }
		})
}

async function storedName(id: number) {
	const row = await testDb.query.users.findFirst({
		where: eq(schema.users.id, id),
		columns: { displayName: true }
	})
	return row?.displayName
}

async function update(id: number, isAdmin: boolean, displayName: string) {
	const { usersCurrentUpdateDisplayName } = await import("./users")
	return usersCurrentUpdateDisplayName.handler(
		sock(id, isAdmin),
		{ displayName },
		noopEmit
	)
}

describe("updateDisplayName answers in every mode", () => {
	for (const accounts of [false, true]) {
		test(`accounts ${accounts ? "on" : "off"}: admin and member both save`, async () => {
			await setAccounts(accounts)
			await update(adminId, true, "Morgan")
			expect(await storedName(adminId)).toBe("Morgan")
			await update(memberId, false, "Rin")
			expect(await storedName(memberId)).toBe("Rin")
		}, 60_000)
	}
})

describe("updateDisplayName rules", () => {
	test("stores the trimmed name", async () => {
		await setAccounts(false)
		const res = await update(adminId, true, "  Ada  ")
		expect(res.displayName).toBe("Ada")
		expect(await storedName(adminId)).toBe("Ada")
	}, 60_000)

	test("a short name is a name", async () => {
		await setAccounts(false)
		await update(adminId, true, "Jo")
		expect(await storedName(adminId)).toBe("Jo")
	}, 60_000)

	test("empty clears the name back to the default", async () => {
		await setAccounts(false)
		await update(adminId, true, "Someone")
		const res = await update(adminId, true, "   ")
		expect(res.displayName).toBeNull()
		expect(await storedName(adminId)).toBeNull()
	}, 60_000)

	test("refuses a name over 50 characters", async () => {
		await setAccounts(false)
		await update(adminId, true, "Kept")
		await expect(update(adminId, true, "x".repeat(51))).rejects.toThrow(
			/50 characters/
		)
		expect(await storedName(adminId)).toBe("Kept")
	}, 60_000)
})
