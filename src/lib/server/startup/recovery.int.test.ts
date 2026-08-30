/**
 * Environment-driven account recovery (plan 26 §10, tier 3).
 *
 * The behaviour that has to hold: the reset applies exactly once per key, never
 * reverts a password the user chose afterwards, refuses a password the app's
 * own UI would reject, and clears the second factor as well — because a
 * password reset alone leaves someone who also lost their authenticator stuck
 * at the code prompt.
 */
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
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

const GOOD_PASSWORD = "Recovered!Pass1"
const OTHER_PASSWORD = "Another!Pass2"

const ENV_KEYS = [
	"SERENE_PUB_ADMIN_USERNAME",
	"SERENE_PUB_ADMIN_PASSWORD",
	"SERENE_PUB_ENABLE_ACCOUNTS",
	"SERENE_PUB_PLATFORM",
	"SERENE_PUB_RECOVERY_KEY",
	"SERENE_PUB_RECOVERY_PASSWORD"
]

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schemaModule.systemSettings).values({ id: 1 })
}, 60_000)

beforeEach(async () => {
	for (const k of ENV_KEYS) delete process.env[k]
	await testDb.delete(schemaModule.userTotpRecoveryCodes)
	await testDb.delete(schemaModule.userTotp)
	await testDb.delete(schemaModule.userTokens)
	await testDb.delete(schemaModule.passphrases)
	await testDb.delete(schemaModule.users)
	await testDb
		.update(schemaModule.systemSettings)
		.set({ recoveryKeyHash: null })
		.where(eq(schemaModule.systemSettings.id, 1))
})

afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k]
	vi.restoreAllMocks()
})

async function makeAdmin(username = "admin") {
	const [user] = await testDb
		.insert(schemaModule.users)
		.values({ username, isAdmin: true })
		.returning()
	return user
}

async function currentHash(userId: number) {
	const row = await testDb.query.passphrases.findFirst({
		where: eq(schemaModule.passphrases.userId, userId)
	})
	return row?.hash ?? null
}

async function run() {
	const { applyEnvironmentRecovery } = await import("./recovery")
	await applyEnvironmentRecovery()
}

describe("first-boot credentials", () => {
	test("sets the username and password while the admin has none", async () => {
		const admin = await makeAdmin("placeholder")
		process.env.SERENE_PUB_ADMIN_USERNAME = "jody"
		process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD

		await run()

		const after = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.id, admin.id)
		})
		expect(after?.username).toBe("jody")
		expect(await currentHash(admin.id)).not.toBeNull()
	})

	test("does nothing once a passphrase exists — it is first boot only", async () => {
		const admin = await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD
		await run()
		const first = await currentHash(admin.id)

		// A second boot with the variable still present must not touch it.
		process.env.SERENE_PUB_ADMIN_USERNAME = "someone-else"
		process.env.SERENE_PUB_ADMIN_PASSWORD = OTHER_PASSWORD
		await run()

		expect(await currentHash(admin.id)).toBe(first)
		const after = await testDb.query.users.findFirst({
			where: eq(schemaModule.users.id, admin.id)
		})
		expect(after?.username).toBe("admin")
	})

	test("refuses a password the app's own UI would reject", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {})
		const admin = await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = "short"
		await run()
		// Otherwise .env becomes a route to a password the UI refuses.
		expect(await currentHash(admin.id)).toBeNull()
		expect(err).toHaveBeenCalled()
	})
})

describe("first-boot account enabling", () => {
	async function accountsEnabled() {
		const r = await testDb.query.systemSettings.findFirst({
			where: eq(schemaModule.systemSettings.id, 1)
		})
		return r?.isAccountsEnabled ?? false
	}

	beforeEach(async () => {
		await testDb
			.update(schemaModule.systemSettings)
			.set({ isAccountsEnabled: false })
			.where(eq(schemaModule.systemSettings.id, 1))
	})

	test("enables accounts when a valid admin password is also set", async () => {
		const admin = await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD
		process.env.SERENE_PUB_ENABLE_ACCOUNTS = "true"
		await run()
		expect(await accountsEnabled()).toBe(true)
		expect(await currentHash(admin.id)).not.toBeNull()
	})

	test("does nothing without a password — a login wall with no credential is unrecoverable", async () => {
		await makeAdmin()
		process.env.SERENE_PUB_ENABLE_ACCOUNTS = "true"
		await run()
		expect(await accountsEnabled()).toBe(false)
	})

	test("does nothing when the password is rejected", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = "weak"
		process.env.SERENE_PUB_ENABLE_ACCOUNTS = "true"
		await run()
		expect(await accountsEnabled()).toBe(false)
	})

	test("is off by default", async () => {
		await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD
		await run()
		expect(await accountsEnabled()).toBe(false)
	})

	test("treats false and 0 as off", async () => {
		for (const val of ["false", "0"]) {
			await testDb.delete(schemaModule.passphrases)
			await testDb.delete(schemaModule.users)
			await makeAdmin()
			process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD
			process.env.SERENE_PUB_ENABLE_ACCOUNTS = val
			await run()
			expect(await accountsEnabled()).toBe(false)
		}
	})

	test("refuses on the Android build, which is single-user", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD
		process.env.SERENE_PUB_ENABLE_ACCOUNTS = "true"
		process.env.SERENE_PUB_PLATFORM = "android"
		await run()
		expect(await accountsEnabled()).toBe(false)
		expect(warn).toHaveBeenCalled()
	})

	test("does not fire on a later boot once a passphrase exists", async () => {
		const admin = await makeAdmin()
		process.env.SERENE_PUB_ADMIN_PASSWORD = GOOD_PASSWORD
		await run()
		void admin
		// Second boot with the flag newly added: first-boot only means exactly
		// that, so an existing install is never flipped by an env var.
		process.env.SERENE_PUB_ENABLE_ACCOUNTS = "true"
		await run()
		expect(await accountsEnabled()).toBe(false)
	})
})

describe("the one-time recovery key", () => {
	test("resets the password, then ignores the same key on every later boot", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const admin = await makeAdmin()
		process.env.SERENE_PUB_RECOVERY_KEY = "let-me-back-in"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = GOOD_PASSWORD

		await run()
		const reset = await currentHash(admin.id)
		expect(reset).not.toBeNull()
		expect(warn).toHaveBeenCalled()

		// The user then picks their own password.
		const { set } = await import(
			"$lib/server/providers/users/passphrase/set"
		)
		await set({ userId: String(admin.id), passphrase: OTHER_PASSWORD })
		const chosen = await currentHash(admin.id)

		// Reboot with the variables still sitting in .env — the whole reason
		// the reset is keyed is that nobody removes them.
		await run()
		expect(await currentHash(admin.id)).toBe(chosen)
	})

	test("a different key resets again", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const admin = await makeAdmin()
		process.env.SERENE_PUB_RECOVERY_KEY = "first-key"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = GOOD_PASSWORD
		await run()
		const first = await currentHash(admin.id)

		process.env.SERENE_PUB_RECOVERY_KEY = "second-key"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = OTHER_PASSWORD
		await run()

		expect(await currentHash(admin.id)).not.toBe(first)
	})

	test("stores only a hash of the key, never the key itself", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const admin = await makeAdmin()
		process.env.SERENE_PUB_RECOVERY_KEY = "super-secret-key"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = GOOD_PASSWORD
		await run()

		const settings = await testDb.query.systemSettings.findFirst({
			where: eq(schemaModule.systemSettings.id, 1)
		})
		expect(settings?.recoveryKeyHash).toMatch(/^[0-9a-f]{64}$/)
		expect(settings?.recoveryKeyHash).not.toContain("super-secret-key")
		void admin
	})

	test("clears the second factor as well as the password", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const admin = await makeAdmin()
		await testDb.insert(schemaModule.userTotp).values({
			userId: admin.id,
			secret: { ciphertext: "x", iv: "y", authTag: "z" },
			enabledAt: new Date()
		})
		await testDb.insert(schemaModule.userTotpRecoveryCodes).values({
			userId: admin.id,
			codeHash: "deadbeef"
		})

		process.env.SERENE_PUB_RECOVERY_KEY = "let-me-back-in"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = GOOD_PASSWORD
		await run()

		// A password reset alone would leave them stuck at the code prompt.
		expect(
			await testDb.query.userTotp.findFirst({
				where: eq(schemaModule.userTotp.userId, admin.id)
			})
		).toBeUndefined()
		expect(
			await testDb.query.userTotpRecoveryCodes.findMany({
				where: eq(schemaModule.userTotpRecoveryCodes.userId, admin.id)
			})
		).toHaveLength(0)
	})

	test("revokes every existing session for the recovered account", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const admin = await makeAdmin()
		await testDb.insert(schemaModule.userTokens).values({
			userId: admin.id,
			token: "stale",
			expiresAt: new Date(Date.now() + 86_400_000),
			browser: "test",
			os: "test"
		})

		process.env.SERENE_PUB_RECOVERY_KEY = "let-me-back-in"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = GOOD_PASSWORD
		await run()

		// Whoever held that session was authenticated under credentials that
		// no longer exist.
		expect(
			await testDb.query.userTokens.findMany({
				where: eq(schemaModule.userTokens.userId, admin.id)
			})
		).toHaveLength(0)
	})

	test("refuses a weak password and leaves the key unspent", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {})
		const admin = await makeAdmin()
		process.env.SERENE_PUB_RECOVERY_KEY = "let-me-back-in"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = "weak"
		await run()

		expect(await currentHash(admin.id)).toBeNull()
		expect(err).toHaveBeenCalled()
		// Not recorded as used, so fixing the password and rebooting works
		// rather than silently requiring a brand-new key.
		const settings = await testDb.query.systemSettings.findFirst({
			where: eq(schemaModule.systemSettings.id, 1)
		})
		expect(settings?.recoveryKeyHash).toBeNull()
	})

	test("needs both the key and the password to do anything", async () => {
		const admin = await makeAdmin()
		process.env.SERENE_PUB_RECOVERY_KEY = "lonely-key"
		await run()
		expect(await currentHash(admin.id)).toBeNull()
	})

	test("targets the lowest-id admin rather than assuming id 1", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		// The original admin is gone; ids start wherever the sequence is.
		const [plain] = await testDb
			.insert(schemaModule.users)
			.values({ username: "regular", isAdmin: false })
			.returning()
		const admin = await makeAdmin("the-admin")

		process.env.SERENE_PUB_RECOVERY_KEY = "let-me-back-in"
		process.env.SERENE_PUB_RECOVERY_PASSWORD = GOOD_PASSWORD
		await run()

		expect(await currentHash(admin.id)).not.toBeNull()
		expect(await currentHash(plain.id)).toBeNull()
	})
})
