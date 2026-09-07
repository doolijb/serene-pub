/**
 * The auto-translation path (R5).
 *
 * Three properties matter enough to pin, and each one is a decision an operator
 * relies on rather than an implementation detail:
 *
 *   1. **Nothing leaves the instance until an admin says so.** Auto-translation
 *      ships off, and off must mean no engine call at all — not a call whose
 *      result is discarded.
 *   2. **A string is translated once, ever.** The cache is what makes the
 *      feature affordable; a cache that misses is an outbound HTTP request per
 *      string per page load.
 *   3. **English is free.** It is the source language, so the identity is the
 *      right answer and nothing should be stored or sent.
 *
 * The engine itself is stubbed. This is about what the app decides to call,
 * never about what a translation service returns.
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

/**
 * The library, stubbed at its own boundary rather than at ours — so the call
 * shape this app relies on (`Translate({...})` returning a callable) is part of
 * what these tests assert.
 */
const engineCalls: string[] = []
const ENGINE_FAILS_ON = "BOOM"
vi.mock("translate", () => ({
	Translate: () => async (text: string) => {
		engineCalls.push(text)
		if (text === ENGINE_FAILS_ON) throw new Error("engine unreachable")
		return `[t] ${text}`
	}
}))

beforeAll(async () => {
	const m = await import("$lib/server/db")
	testDb = m.db as unknown as TestDb
	await testDb.insert(schemaModule.systemSettings).values({ id: 1 })
}, 60_000)

beforeEach(async () => {
	engineCalls.length = 0
	await testDb.delete(schemaModule.uiTranslations)
	await testDb
		.update(schemaModule.systemSettings)
		.set({
			autoTranslateEnabled: false,
			autoTranslateEngine: "google",
			autoTranslateEndpoint: null
		})
		.where(eq(schemaModule.systemSettings.id, 1))
})

async function enableAutoTranslate() {
	await testDb
		.update(schemaModule.systemSettings)
		.set({ autoTranslateEnabled: true })
		.where(eq(schemaModule.systemSettings.id, 1))
}

const translateUiStrings = async (language: string, sources: string[]) =>
	(await import("./translate")).translateUiStrings(language, sources)

describe("auto-translation is off until an admin turns it on", () => {
	test("an untranslated string produces no engine call and no row", async () => {
		const res = await translateUiStrings("es", ["Language"])
		expect(res.entries).toEqual({})
		expect(res.translated).toBe(false)
		expect(engineCalls).toEqual([])
		expect(await testDb.select().from(schemaModule.uiTranslations)).toEqual(
			[]
		)
	})

	test("but an already-cached string is still served", async () => {
		// Turning the switch off must not blank an instance that was already
		// translated — the rows are the instance's, not the switch's.
		await testDb.insert(schemaModule.uiTranslations).values({
			language: "es",
			sourceKey: (await import("./translate")).sourceKey("Language"),
			source: "Language",
			translated: "Idioma",
			engine: "manual"
		})
		const res = await translateUiStrings("es", ["Language"])
		expect(res.entries).toEqual({ Language: "Idioma" })
		expect(engineCalls).toEqual([])
	})
})

describe("English costs nothing", () => {
	test("no lookup, no engine call, no row", async () => {
		await enableAutoTranslate()
		const res = await translateUiStrings("en", ["Language", "Settings"])
		expect(res.entries).toEqual({})
		expect(engineCalls).toEqual([])
	})
})

describe("with auto-translation on", () => {
	test("translates a miss, stores it, and serves the next ask from cache", async () => {
		await enableAutoTranslate()

		const first = await translateUiStrings("es", ["Language"])
		expect(first.entries).toEqual({ Language: "[t] Language" })
		expect(first.translated).toBe(true)
		expect(engineCalls).toEqual(["Language"])

		const rows = await testDb.select().from(schemaModule.uiTranslations)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			language: "es",
			source: "Language",
			translated: "[t] Language",
			engine: "google"
		})

		engineCalls.length = 0
		const second = await translateUiStrings("es", ["Language"])
		expect(second.entries).toEqual({ Language: "[t] Language" })
		expect(second.translated).toBe(false)
		expect(engineCalls).toEqual([])
	})

	test("a repeated source in one request is one engine call", async () => {
		await enableAutoTranslate()
		await translateUiStrings("es", ["Language", "Language", "Language"])
		expect(engineCalls).toEqual(["Language"])
	})

	test("a hit and a miss in the same request cost one call", async () => {
		await enableAutoTranslate()
		await translateUiStrings("es", ["Language"])
		engineCalls.length = 0

		const res = await translateUiStrings("es", ["Language", "Settings"])
		expect(engineCalls).toEqual(["Settings"])
		expect(res.entries).toEqual({
			Language: "[t] Language",
			Settings: "[t] Settings"
		})
	})

	test("caches are per language", async () => {
		await enableAutoTranslate()
		await translateUiStrings("es", ["Language"])
		engineCalls.length = 0
		await translateUiStrings("de", ["Language"])
		expect(engineCalls).toEqual(["Language"])
		expect(
			await testDb.select().from(schemaModule.uiTranslations)
		).toHaveLength(2)
	})

	test("drops anything longer than a UI string", async () => {
		// The second line of defence against user-authored content reaching an
		// outside service: nothing this long is a label, so it is not sent and
		// not stored, and the caller keeps showing what it has.
		await enableAutoTranslate()
		const { MAX_SOURCE_LENGTH } = await import("./translate")
		const long = "x".repeat(MAX_SOURCE_LENGTH + 1)
		const res = await translateUiStrings("es", [long, "Language"])
		expect(engineCalls).toEqual(["Language"])
		expect(res.entries).not.toHaveProperty(long)
	})

	test("an engine failure degrades to English rather than throwing", async () => {
		// The property `t()` depends on: a translation service being down must
		// cost a label, never a screen. The failed string is not cached, so it
		// is retried on a later request once the service is back.
		await enableAutoTranslate()
		const res = await translateUiStrings("es", [
			ENGINE_FAILS_ON,
			"Language"
		])
		expect(res.entries).toEqual({ Language: "[t] Language" })
		const rows = await testDb.select().from(schemaModule.uiTranslations)
		expect(rows.map((r) => r.source)).toEqual(["Language"])
	})

	test("caps how many misses one request may translate", async () => {
		// A screen with more misses than the cap fills in over the next few
		// requests instead of holding a socket open for an unbounded number of
		// outbound calls.
		await enableAutoTranslate()
		const { MAX_TRANSLATIONS_PER_REQUEST } = await import("./translate")
		const sources = Array.from(
			{ length: MAX_TRANSLATIONS_PER_REQUEST + 5 },
			(_, i) => `String ${i}`
		)
		const res = await translateUiStrings("es", sources)
		expect(engineCalls).toHaveLength(MAX_TRANSLATIONS_PER_REQUEST)
		expect(Object.keys(res.entries)).toHaveLength(
			MAX_TRANSLATIONS_PER_REQUEST
		)
	})
})
