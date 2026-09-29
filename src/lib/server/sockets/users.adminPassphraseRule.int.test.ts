/**
 * Admin create/edit enforces the one passphrase rule on the server.
 *
 * The admin user form checks `passphraseSchema` in the browser, but a socket
 * client can send anything. Without the server check an admin could set a
 * passphrase the app's own UI would refuse — too short, too long (unbounded
 * key-derivation cost), or missing a character class.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schemaModule from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { PASSPHRASE_MAX_LENGTH } from "$lib/shared/validation/passphrase"

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
	await testDb.delete(schemaModule.passphrases)
	await testDb.delete(schemaModule.users)
	;[admin] = await testDb
		.insert(schemaModule.users)
		.values({ username: "admin", isAdmin: true, lastLoginAt: new Date() })
		.returning()
})

const noopEmit = () => {}
const socketFor = (id: number) =>
	({
		user: { id, isAdmin: true },
		io: { to: () => ({ disconnectSockets: () => {} }) }
	}) as any

const WEAK = [
	["too short", "Ab!def"],
	["too long", "Ab!" + "x".repeat(PASSPHRASE_MAX_LENGTH)],
	["no uppercase", "correct!horse1"],
	["no lowercase", "CORRECT!HORSE1"],
	["no special character", "CorrectHorse12"]
] as const

describe("users:create", () => {
	test.each(WEAK)(
		"refuses a passphrase that breaks the rule (%s)",
		async (_label, weak) => {
			const { usersCreate } = await import("./users")
			await expect(
				usersCreate.handler(
					socketFor(admin.id),
					{ username: "newcomer", passphrase: weak },
					noopEmit
				)
			).rejects.toThrow(/Passphrase must/)
			// Refused before the row exists — no passphrase-less account left behind.
			const created = await testDb.query.users.findFirst({
				where: eq(schemaModule.users.username, "newcomer")
			})
			expect(created).toBeUndefined()
		},
		60_000
	)

	test("accepts a passphrase that meets the rule", async () => {
		const { usersCreate } = await import("./users")
		const res = await usersCreate.handler(
			socketFor(admin.id),
			{ username: "newcomer", passphrase: "Correct!Horse1" },
			noopEmit
		)
		expect(res.user.username).toBe("newcomer")
	}, 60_000)
})

describe("users:update", () => {
	test.each(WEAK)(
		"refuses a passphrase that breaks the rule (%s)",
		async (_label, weak) => {
			const [member] = await testDb
				.insert(schemaModule.users)
				.values({ username: "member" })
				.returning()
			const { usersUpdate } = await import("./users")
			await expect(
				usersUpdate.handler(
					socketFor(admin.id),
					{ id: member.id, displayName: "Renamed", passphrase: weak },
					noopEmit
				)
			).rejects.toThrow(/Passphrase must/)
			// Refused before any write — the rest of the edit is not applied either.
			const after = await testDb.query.users.findFirst({
				where: eq(schemaModule.users.id, member.id)
			})
			expect(after?.displayName).toBeNull()
			const rows = await testDb.query.passphrases.findMany({
				where: eq(schemaModule.passphrases.userId, member.id)
			})
			expect(rows).toHaveLength(0)
		},
		60_000
	)

	test("accepts a passphrase that meets the rule", async () => {
		const [member] = await testDb
			.insert(schemaModule.users)
			.values({ username: "member" })
			.returning()
		const { usersUpdate } = await import("./users")
		await usersUpdate.handler(
			socketFor(admin.id),
			{ id: member.id, passphrase: "Correct!Horse1" },
			noopEmit
		)
		const rows = await testDb.query.passphrases.findMany({
			where: eq(schemaModule.passphrases.userId, member.id)
		})
		expect(rows.length).toBeGreaterThan(0)
	}, 60_000)
})
