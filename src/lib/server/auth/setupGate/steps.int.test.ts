/**
 * Which steps a session still owes (plan 27 §1).
 *
 * Derived on every handshake rather than stored, so an admin clearing someone's
 * two-factor — or turning on the site-wide requirement — changes what that
 * session owes without anything having to go back and update it. These tests
 * assert exactly that: change the world, re-derive, get the new answer.
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

let user: any

beforeAll(async () => {
	const m = await import("$lib/server/db")
	testDb = m.db as unknown as TestDb
	await testDb.insert(schemaModule.systemSettings).values({ id: 1 })
}, 60_000)

beforeEach(async () => {
	await testDb.delete(schemaModule.userTotp)
	await testDb.delete(schemaModule.passphrases)
	await testDb.delete(schemaModule.users)
	await testDb
		.update(schemaModule.systemSettings)
		.set({ requireTwoFactor: false })
		.where(eq(schemaModule.systemSettings.id, 1))
	;[user] = await testDb
		.insert(schemaModule.users)
		.values({ username: "member" })
		.returning()
})

async function givePassphrase() {
	const { set } = await import("$lib/server/providers/users/passphrase/set")
	await set({ userId: String(user.id), passphrase: "Correct!Horse1" })
}

async function giveTotp(enabled = true) {
	await testDb.insert(schemaModule.userTotp).values({
		userId: user.id,
		secret: { ciphertext: "x", iv: "y", authTag: "z" },
		enabledAt: enabled ? new Date() : null
	})
}

const steps = async () => (await import("./index")).pendingSetupSteps(user.id)

describe("password step", () => {
	test("is owed when no passphrase exists", async () => {
		expect(await steps()).toEqual(["password"])
	})

	test("clears once a passphrase is set", async () => {
		await givePassphrase()
		expect(await steps()).toEqual([])
	})

	test("returns when the active passphrase is invalidated", async () => {
		await givePassphrase()
		// This is what redeeming an account invite does — the row is
		// invalidated rather than deleted, and the same predicate every
		// passphrase lookup uses then finds nothing.
		await testDb
			.update(schemaModule.passphrases)
			.set({ invalidatedAt: new Date() })
			.where(eq(schemaModule.passphrases.userId, user.id))
		expect(await steps()).toEqual(["password"])
	})
})

describe("two-factor step", () => {
	test("is not owed while the site does not require it", async () => {
		await givePassphrase()
		await expect(steps()).resolves.toEqual([])
	})

	test("is owed when required and the user has none", async () => {
		await givePassphrase()
		await testDb
			.update(schemaModule.systemSettings)
			.set({ requireTwoFactor: true })
			.where(eq(schemaModule.systemSettings.id, 1))
		expect(await steps()).toEqual(["twoFactor"])
	})

	test("is satisfied by an enabled factor", async () => {
		await givePassphrase()
		await giveTotp(true)
		await testDb
			.update(schemaModule.systemSettings)
			.set({ requireTwoFactor: true })
			.where(eq(schemaModule.systemSettings.id, 1))
		expect(await steps()).toEqual([])
	})

	test("is not satisfied by an unconfirmed enrolment", async () => {
		await givePassphrase()
		await giveTotp(false)
		await testDb
			.update(schemaModule.systemSettings)
			.set({ requireTwoFactor: true })
			.where(eq(schemaModule.systemSettings.id, 1))
		// A secret exists but was never proved; treating that as satisfied
		// would let someone through on a factor they cannot actually use.
		expect(await steps()).toEqual(["twoFactor"])
	})

	test("returns immediately when an admin clears the factor", async () => {
		await givePassphrase()
		await giveTotp(true)
		await testDb
			.update(schemaModule.systemSettings)
			.set({ requireTwoFactor: true })
			.where(eq(schemaModule.systemSettings.id, 1))
		expect(await steps()).toEqual([])

		const { clearTotp } = await import("$lib/server/auth/totp/service")
		await clearTotp(user.id, { revokeSessions: false })
		expect(await steps()).toEqual(["twoFactor"])
	})
})

describe("ordering", () => {
	test("password comes before two-factor", async () => {
		await testDb
			.update(schemaModule.systemSettings)
			.set({ requireTwoFactor: true })
			.where(eq(schemaModule.systemSettings.id, 1))
		// Someone handed an account invite has neither, and only the password
		// step can be satisfied first.
		expect(await steps()).toEqual(["password", "twoFactor"])
	})
})
