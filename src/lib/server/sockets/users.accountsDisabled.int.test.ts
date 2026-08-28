/**
 * With accounts off the instance is single-user: the admin roster handlers
 * (users:list/create/update/delete) refuse outright — the socket surface, not
 * just the hidden UI. Self-scoped handlers stay live; the sole user still
 * owns their profile. Flipping the setting turns the roster back on.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
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

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username: "roster-admin", isAdmin: true })
		.returning()
	adminId = admin.id
}, 60_000)

const sock = () =>
	({
		user: { id: adminId, isAdmin: true },
		io: { to: () => ({ emit: () => {}, disconnectSockets: () => {} }) }
	}) as any
const noopEmit = () => {}

async function setAccounts(enabled: boolean) {
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1, isAccountsEnabled: enabled })
		.onConflictDoUpdate({
			target: schema.systemSettings.id,
			set: { isAccountsEnabled: enabled }
		})
}

describe("accounts off — the roster refuses", () => {
	test("list/create/update/delete all refuse, even for an admin", async () => {
		await setAccounts(false)
		const { usersList, usersCreate, usersUpdate, usersDelete } =
			await import("./users")
		await expect(
			usersList.handler(sock(), {} as any, noopEmit)
		).rejects.toThrow(/Accounts are disabled/)
		await expect(
			usersCreate.handler(
				sock(),
				{ username: "x", passphrase: "Aa!aaaaaaaaa" } as any,
				noopEmit
			)
		).rejects.toThrow(/Accounts are disabled/)
		await expect(
			usersUpdate.handler(
				sock(),
				{ id: adminId, displayName: "X" } as any,
				noopEmit
			)
		).rejects.toThrow(/Accounts are disabled/)
		await expect(
			usersDelete.handler(sock(), { id: 999999 } as any, noopEmit)
		).rejects.toThrow(/Accounts are disabled/)
	}, 60_000)

	test("self-scoped handlers stay live for the sole user", async () => {
		await setAccounts(false)
		const { usersGet } = await import("./users")
		const res = await usersGet.handler(
			sock(),
			{ id: adminId } as any,
			noopEmit
		)
		expect(res.user?.id).toBe(adminId)
	}, 60_000)

	test("turning accounts on turns the roster back on", async () => {
		await setAccounts(true)
		const { usersList } = await import("./users")
		const res = await usersList.handler(sock(), {} as any, noopEmit)
		expect(res.users.some((u: any) => u.id === adminId)).toBe(true)
	}, 60_000)
})
