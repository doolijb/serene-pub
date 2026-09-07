/**
 * The language resolution chain (R5).
 *
 * `user_settings.language → system_settings.default_language → "en"`, and the
 * middle step is the one worth a test: NULL at the user end means "follow the
 * instance default", not "English". Get that wrong and the admin's setup choice
 * applies to nobody, which is a bug that looks exactly like the feature working
 * on the only account anyone tests with.
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
	await testDb.delete(schemaModule.userSettings)
	await testDb.delete(schemaModule.users)
	await testDb
		.update(schemaModule.systemSettings)
		.set({ defaultLanguage: "en" })
		.where(eq(schemaModule.systemSettings.id, 1))
	;[user] = await testDb
		.insert(schemaModule.users)
		.values({ username: "member" })
		.returning()
})

async function setInstanceLanguage(language: string) {
	await testDb
		.update(schemaModule.systemSettings)
		.set({ defaultLanguage: language })
		.where(eq(schemaModule.systemSettings.id, 1))
}

async function setUserLanguage(language: string | null) {
	await testDb
		.insert(schemaModule.userSettings)
		.values({ userId: user.id, language })
		.onConflictDoUpdate({
			target: schemaModule.userSettings.userId,
			set: { language }
		})
}

const resolveUser = async () =>
	(await import("./index")).resolveUserLanguage(user.id)
const resolveInstance = async () =>
	(await import("./index")).resolveInstanceLanguage()

describe("resolveUserLanguage", () => {
	test("a user with no settings row at all follows the instance", async () => {
		// The row is created lazily on first `userSettings:get`, so this is the
		// normal state of a freshly invited account — not an error case.
		await setInstanceLanguage("de")
		expect(await resolveUser()).toMatchObject({
			code: "de",
			source: "instance"
		})
	})

	test("a settings row with NULL language follows the instance", async () => {
		await setInstanceLanguage("fr")
		await setUserLanguage(null)
		expect(await resolveUser()).toMatchObject({
			code: "fr",
			source: "instance"
		})
	})

	test("an explicit choice wins over the instance", async () => {
		await setInstanceLanguage("fr")
		await setUserLanguage("es")
		expect(await resolveUser()).toMatchObject({
			code: "es",
			source: "user"
		})
	})

	test("moving the instance default moves the inheritors and nobody else", async () => {
		// The property the whole nullable-column design exists for.
		await setInstanceLanguage("fr")
		await setUserLanguage(null)
		expect((await resolveUser()).code).toBe("fr")

		await setInstanceLanguage("de")
		expect((await resolveUser()).code).toBe("de")

		await setUserLanguage("es")
		await setInstanceLanguage("it")
		expect((await resolveUser()).code).toBe("es")
	})

	test("a stored code this build no longer offers reads as English", async () => {
		// The downgrade path. It must not throw: settings resolution is on the
		// critical path of every page load, so failing here takes the app down
		// rather than degrading one label.
		await setUserLanguage("kl")
		expect(await resolveUser()).toMatchObject({
			code: "en",
			// Still "user": they did choose, the choice is just unavailable.
			source: "user"
		})
	})

	test("carries the definition, so a caller needs one round trip", async () => {
		await setUserLanguage("ja")
		const resolved = await resolveUser()
		expect(resolved.definition.name).toBe("Japanese")
		// The R5 gate, reachable from the same object the lexical mechanism already
		// has in hand.
		expect(resolved.definition.features.stemming).toBe(false)
		expect(resolved.definition.features.whitespaceDelimited).toBe(false)
	})
})

describe("resolveInstanceLanguage", () => {
	test("reports the stored default", async () => {
		await setInstanceLanguage("sv")
		expect(await resolveInstance()).toMatchObject({
			code: "sv",
			source: "instance"
		})
	})

	test("an unknown stored default reads as English", async () => {
		await setInstanceLanguage("kl")
		expect((await resolveInstance()).code).toBe("en")
	})
})
