/**
 * Round-11 audit fix (MEDIUM): CharaVault's content-safety filtering
 * (hasExcludedTag/hasExcludedNameMatch, gated by the
 * ENABLE_UNSAFE_CHARACTER_BROWSING env var + the user's own
 * charaVaultIncludeNsfw setting) was only ever checked inside search()'s
 * filterRawItems — getCardBytes/getCardDetail took an opaque {folder,file}
 * ref and fetched/returned content with no content-policy check at all.
 * A user who knew or guessed a valid ref could import NSFW content via
 * characters:importFromLibrary even with browsing disabled instance-wide.
 * Fixed by enforcing the check inside getCardBytes itself (getCardDetail
 * already calls getCardBytes internally, so it inherits the check for
 * free), using the card's own embedded name/tags.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let fetchedBuffer: Buffer

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// getCardBytes's own disk-cache/session/rate-limiter machinery isn't what's
// under test here — stub it to hand back a controlled buffer directly so
// this test never makes a real network call.
vi.mock("../diskCache", () => ({
	getOrFetchCardBytes: async () => fetchedBuffer
}))

// Wraps (not replaces) the real parseCharacterCard so the double-parse
// regression test below can count invocations while every other test in
// this file still exercises the genuine parse/content-safety behavior.
vi.mock("$lib/server/utils/characterCardParser", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/utils/characterCardParser")
		>()
	return { ...actual, parseCharacterCard: vi.fn(actual.parseCharacterCard) }
})

function cardJson(name: string, tags: string[]) {
	return Buffer.from(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name,
				description: "A test description",
				personality: "",
				scenario: "",
				first_mes: "Hello!",
				mes_example: "",
				creator_notes: "",
				system_prompt: "",
				post_history_instructions: "",
				alternate_greetings: [],
				tags,
				creator: "",
				character_version: "",
				extensions: {}
			}
		})
	)
}

const originalEnv = process.env.ENABLE_UNSAFE_CHARACTER_BROWSING

beforeEach(async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// Fresh, uniquely-named user per test (createTestDb() persists one
	// PGlite instance across the whole file, not reset between tests) — a
	// fixed username would collide on the unique constraint across tests.
	;(globalThis as any).__testUser = await createTestUser(testDb)
})

afterEach(() => {
	if (originalEnv === undefined) {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
	} else {
		process.env.ENABLE_UNSAFE_CHARACTER_BROWSING = originalEnv
	}
})

describe("charaVaultSource.getCardBytes — content-safety gate", () => {
	test("rejects a card whose embedded tags match the exclusion list when browsing is disabled instance-wide", async () => {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
		const { charaVaultSource } = await import("./charaVaultSource")
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("Excluded Card", ["Dominant"])

		await expect(
			charaVaultSource.getCardBytes(
				{ folder: "f", file: "g.png" },
				{ userId: user.id }
			)
		).rejects.toThrow(/not available/i)
	})

	test("rejects a card whose embedded name matches an excluded substring", async () => {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
		const { charaVaultSource } = await import("./charaVaultSource")
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("A Milf Character", [])

		await expect(
			charaVaultSource.getCardBytes(
				{ folder: "f", file: "h.png" },
				{ userId: user.id }
			)
		).rejects.toThrow(/not available/i)
	})

	test("allows a clean card through when browsing is disabled", async () => {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
		const { charaVaultSource } = await import("./charaVaultSource")
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("Friendly Adventurer", ["fantasy"])

		const buffer = await charaVaultSource.getCardBytes(
			{ folder: "f", file: "i.png" },
			{ userId: user.id }
		)
		expect(buffer).toBe(fetchedBuffer)
	})

	test("allows an excluded-tag card through when the instance env gate is on and the user opted in", async () => {
		process.env.ENABLE_UNSAFE_CHARACTER_BROWSING = "true"
		const { charaVaultSource } = await import("./charaVaultSource")
		const schema = await import("$lib/server/db/schema")
		const user = (globalThis as any).__testUser
		await testDb
			.insert(schema.userSettings)
			.values({ userId: user.id, charaVaultIncludeNsfw: true })
		fetchedBuffer = cardJson("Excluded Card", ["Dominant"])

		const buffer = await charaVaultSource.getCardBytes(
			{ folder: "f", file: "j.png" },
			{ userId: user.id }
		)
		expect(buffer).toBe(fetchedBuffer)
	})

	test("still rejects an excluded-tag card when the env gate is on but the user hasn't opted in", async () => {
		process.env.ENABLE_UNSAFE_CHARACTER_BROWSING = "true"
		const { charaVaultSource } = await import("./charaVaultSource")
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("Excluded Card", ["Dominant"])

		await expect(
			charaVaultSource.getCardBytes(
				{ folder: "f", file: "k.png" },
				{ userId: user.id }
			)
		).rejects.toThrow(/not available/i)
	})
})

describe("charaVaultSource.getCardDetail — inherits the content-safety gate via getCardBytes", () => {
	test("rejects an excluded card through getCardDetail too", async () => {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
		const { charaVaultSource } = await import("./charaVaultSource")
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("Excluded Card", ["Dominant"])

		await expect(
			charaVaultSource.getCardDetail!(
				{ folder: "f", file: "l.png" },
				{ userId: user.id }
			)
		).rejects.toThrow(/not available/i)
	})
})

// Previously getCardDetail called getCardBytes (which parses via
// assertContentAllowed for the content-safety check), then immediately
// re-parsed the same buffer a second time to read description/lorebook
// presence — a confirmed duplicate parse on every card-detail view. Fixed
// by sharing one parse (getCardBytesAndParsed) between both getCardBytes
// and getCardDetail.
describe("charaVaultSource.getCardDetail — parses exactly once (double-parse fix)", () => {
	test("getCardDetail triggers exactly one parseCharacterCard call, not two", async () => {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
		const { charaVaultSource } = await import("./charaVaultSource")
		const { parseCharacterCard } = (await import(
			"$lib/server/utils/characterCardParser"
		)) as unknown as { parseCharacterCard: ReturnType<typeof vi.fn> }
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("Friendly Adventurer", ["fantasy"])
		parseCharacterCard.mockClear()

		await charaVaultSource.getCardDetail!(
			{ folder: "f", file: "m.png" },
			{ userId: user.id }
		)

		expect(parseCharacterCard).toHaveBeenCalledTimes(1)
	})

	test("getCardBytes on its own also parses exactly once (the content-safety check)", async () => {
		delete process.env.ENABLE_UNSAFE_CHARACTER_BROWSING
		const { charaVaultSource } = await import("./charaVaultSource")
		const { parseCharacterCard } = (await import(
			"$lib/server/utils/characterCardParser"
		)) as unknown as { parseCharacterCard: ReturnType<typeof vi.fn> }
		const user = (globalThis as any).__testUser
		fetchedBuffer = cardJson("Friendly Adventurer", ["fantasy"])
		parseCharacterCard.mockClear()

		await charaVaultSource.getCardBytes(
			{ folder: "f", file: "n.png" },
			{ userId: user.id }
		)

		expect(parseCharacterCard).toHaveBeenCalledTimes(1)
	})
})
