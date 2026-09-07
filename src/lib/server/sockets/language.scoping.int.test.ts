/**
 * The language writers' guards (R5).
 *
 * Two things are being defended here and they fail in opposite directions:
 *
 *   - **The instance default is an admin setting.** A non-admin who could write
 *     it would change what every other user on the instance reads.
 *   - **An unsupported code must be refused, not stored.** `resolveUserLanguage`
 *     collapses an unknown code onto English so a downgraded install keeps
 *     working; if a writer let one in, that downgrade path would become the
 *     normal way a bad value behaves — an instance rendering English with a
 *     setting insisting otherwise, and nothing on screen saying why.
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

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schemaModule.systemSettings).values({ id: 1 })
}, 60_000)

beforeEach(async () => {
	await testDb
		.update(schemaModule.systemSettings)
		.set({
			defaultLanguage: "en",
			autoTranslateEnabled: false,
			autoTranslateEngine: "google",
			autoTranslateEndpoint: null
		})
		.where(eq(schemaModule.systemSettings.id, 1))
})

async function makeUser(username: string, isAdmin: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, username)
	if (isAdmin) {
		await testDb
			.update(schemaModule.users)
			.set({ isAdmin: true })
			.where(eq(schemaModule.users.id, user.id))
	}
	return { ...user, isAdmin }
}

function fakeSocket(user: { id: number; isAdmin: boolean }) {
	return { user: { id: user.id, isAdmin: user.isAdmin } } as any
}

const noopEmit = () => {}

async function storedDefault() {
	const row = await testDb.query.systemSettings.findFirst({
		where: eq(schemaModule.systemSettings.id, 1),
		columns: { defaultLanguage: true }
	})
	return row?.defaultLanguage
}

describe("systemSettings:updateDefaultLanguage", () => {
	test("a non-admin cannot move the instance default", async () => {
		const { systemSettingsUpdateDefaultLanguage } = await import(
			"./systemSettings"
		)
		const member = await makeUser("lang-member", false)

		await expect(
			systemSettingsUpdateDefaultLanguage.handler(
				fakeSocket(member),
				{ language: "es" },
				noopEmit
			)
		).rejects.toThrow(/unauthorized/i)
		expect(await storedDefault()).toBe("en")
	})

	test("an admin can, and only to a language this build offers", async () => {
		const { systemSettingsUpdateDefaultLanguage } = await import(
			"./systemSettings"
		)
		const admin = await makeUser("lang-admin", true)

		await systemSettingsUpdateDefaultLanguage.handler(
			fakeSocket(admin),
			{ language: "es" },
			noopEmit
		)
		expect(await storedDefault()).toBe("es")

		await expect(
			systemSettingsUpdateDefaultLanguage.handler(
				fakeSocket(admin),
				{ language: "kl" },
				noopEmit
			)
		).rejects.toThrow(/unsupported language/i)
		// Refused, not partially applied.
		expect(await storedDefault()).toBe("es")
	})

	test("a regional subtag is refused rather than truncated", async () => {
		// It would be stored happily and then rejected by the translate
		// engine, which validates against ISO 639-1 — a failure that would
		// surface as "translation silently does nothing" for exactly the
		// people who picked it.
		const { systemSettingsUpdateDefaultLanguage } = await import(
			"./systemSettings"
		)
		const admin = await makeUser("lang-admin-subtag", true)
		await expect(
			systemSettingsUpdateDefaultLanguage.handler(
				fakeSocket(admin),
				{ language: "pt-BR" },
				noopEmit
			)
		).rejects.toThrow(/unsupported language/i)
	})
})

describe("systemSettings:updateAutoTranslate", () => {
	async function storedAutoTranslate() {
		return await testDb.query.systemSettings.findFirst({
			where: eq(schemaModule.systemSettings.id, 1),
			columns: {
				autoTranslateEnabled: true,
				autoTranslateEngine: true,
				autoTranslateEndpoint: true
			}
		})
	}

	test("a non-admin cannot turn on outbound translation", async () => {
		// This is the switch that decides whether the instance talks to an
		// outside service at all, so it is the one a non-admin most obviously
		// must not reach.
		const { systemSettingsUpdateAutoTranslate } = await import(
			"./systemSettings"
		)
		const member = await makeUser("autotranslate-member", false)
		await expect(
			systemSettingsUpdateAutoTranslate.handler(
				fakeSocket(member),
				{ enabled: true, engine: "google", endpoint: null },
				noopEmit
			)
		).rejects.toThrow(/unauthorized/i)
		expect((await storedAutoTranslate())?.autoTranslateEnabled).toBe(false)
	})

	test("refuses an endpoint that is not an http(s) URL", async () => {
		// It becomes the target of a server-side fetch, so a scheme nobody
		// meant to allow is a request the server makes on a typo.
		const { systemSettingsUpdateAutoTranslate } = await import(
			"./systemSettings"
		)
		const admin = await makeUser("autotranslate-admin-bad-url", true)
		for (const endpoint of ["file:///etc/passwd", "not a url"]) {
			await expect(
				systemSettingsUpdateAutoTranslate.handler(
					fakeSocket(admin),
					{ enabled: true, engine: "libre", endpoint },
					noopEmit
				)
			).rejects.toThrow(/endpoint must be/i)
		}
		expect((await storedAutoTranslate())?.autoTranslateEnabled).toBe(false)
	})

	test("accepts a loopback endpoint, which is the point of the option", async () => {
		// Deliberately allowed, unlike the plugin fetch capability: this is an
		// admin naming where their own LibreTranslate runs, and blocking it
		// would leave only the third-party engine this setting exists to avoid.
		const { systemSettingsUpdateAutoTranslate } = await import(
			"./systemSettings"
		)
		const admin = await makeUser("autotranslate-admin-libre", true)
		await systemSettingsUpdateAutoTranslate.handler(
			fakeSocket(admin),
			{
				enabled: true,
				engine: "libre",
				endpoint: "http://localhost:5000/translate"
			},
			noopEmit
		)
		expect(await storedAutoTranslate()).toMatchObject({
			autoTranslateEnabled: true,
			autoTranslateEngine: "libre",
			autoTranslateEndpoint: "http://localhost:5000/translate"
		})
	})

	test("refuses an engine that needs a key we do not store", async () => {
		// `deepl` and `yandex` exist in the library and are not offered: a key
		// is a secret, and a secret column is an encryption scheme plus a
		// never-send-to-client exclusion that this lane did not build.
		const { systemSettingsUpdateAutoTranslate } = await import(
			"./systemSettings"
		)
		const admin = await makeUser("autotranslate-admin-engine", true)
		await expect(
			systemSettingsUpdateAutoTranslate.handler(
				fakeSocket(admin),
				{ enabled: true, engine: "deepl" as any, endpoint: null },
				noopEmit
			)
		).rejects.toThrow(/unsupported engine/i)
	})
})

describe("userSettings:updateLanguage", () => {
	async function storedUserLanguage(userId: number) {
		const row = await testDb.query.userSettings.findFirst({
			where: eq(schemaModule.userSettings.userId, userId),
			columns: { language: true }
		})
		return row?.language
	}

	test("stores an explicit choice and reports the effective language", async () => {
		const { userSettingsUpdateLanguage, userSettingsGet } = await import(
			"./userSettings"
		)
		const member = await makeUser("lang-choice", false)
		await userSettingsGet.handler(fakeSocket(member), {}, noopEmit)

		const res = await userSettingsUpdateLanguage.handler(
			fakeSocket(member),
			{ language: "de" },
			noopEmit
		)
		expect(res).toMatchObject({
			language: "de",
			effectiveLanguage: "de"
		})
		expect(await storedUserLanguage(member.id)).toBe("de")
	})

	test("null clears the choice back to inheriting the instance", async () => {
		// Not "clear the field": it is what puts someone back under the admin's
		// choice, so opening the picker once cannot pin them away from it.
		const { userSettingsUpdateLanguage, userSettingsGet } = await import(
			"./userSettings"
		)
		const { systemSettingsUpdateDefaultLanguage } = await import(
			"./systemSettings"
		)
		const admin = await makeUser("lang-inherit-admin", true)
		const member = await makeUser("lang-inherit", false)
		await userSettingsGet.handler(fakeSocket(member), {}, noopEmit)

		await systemSettingsUpdateDefaultLanguage.handler(
			fakeSocket(admin),
			{ language: "fr" },
			noopEmit
		)
		await userSettingsUpdateLanguage.handler(
			fakeSocket(member),
			{ language: "de" },
			noopEmit
		)
		expect(await storedUserLanguage(member.id)).toBe("de")

		const res = await userSettingsUpdateLanguage.handler(
			fakeSocket(member),
			{ language: null },
			noopEmit
		)
		expect(res).toMatchObject({
			language: null,
			effectiveLanguage: "fr"
		})
		expect(await storedUserLanguage(member.id)).toBeNull()
	})

	test("refuses a language this build does not offer", async () => {
		const { userSettingsUpdateLanguage, userSettingsGet } = await import(
			"./userSettings"
		)
		const member = await makeUser("lang-bad", false)
		await userSettingsGet.handler(fakeSocket(member), {}, noopEmit)

		await expect(
			userSettingsUpdateLanguage.handler(
				fakeSocket(member),
				{ language: "kl" },
				noopEmit
			)
		).rejects.toThrow(/unsupported language/i)
		expect(await storedUserLanguage(member.id)).toBeNull()
	})
})
