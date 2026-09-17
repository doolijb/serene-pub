/**
 * The persona CARD, round-tripped — what survived the `personas:*` family.
 *
 * This was `personas.import-export.int.test.ts`, against the socket handlers.
 * 0133 retired those: a persona is a character, so `characters:importCard` and
 * `characters:exportCard` are the only card handlers. What did NOT go is the
 * persona card itself — a lorebook export embeds bound persona cards under
 * `extensions.serenepub.personas`, which is a format other programs hold — so
 * the coverage moves down one layer, onto `utils/personaCard.ts`, where that
 * format is now built and read.
 *
 * Each case below is the same question the socket test asked: does a card
 * round-trip byte-stable, does the uuid decide identity, is that identity
 * PER-USER, and is a malformed uuid absent rather than fatal.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-persona-card-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

const minimalPersonaCard = {
	name: "Jordan",
	description: "A curious traveler",
	creator: "tester",
	extensions: {}
}

async function personasOf(userId: number) {
	return testDb.query.characters.findMany({
		where: (c, { and, eq }) =>
			and(eq(c.userId, userId), eq(c.isPersona, true))
	})
}

describe("persona cards (PGlite integration)", () => {
	test("a plain persona card creates a character flagged as a persona", async () => {
		const { createPersonaFromParsedData } = await import("./personaCard")
		const user = await makeUser("persona-v2-import-user")

		const persona = await createPersonaFromParsedData(
			minimalPersonaCard,
			undefined,
			user.id,
			testDb as any
		)

		expect(persona.name).toBe("Jordan")
		expect(persona.description).toBe("A curious traveler")
		expect(persona.creator).toBe("tester")
		// The whole point of the merge: it is a character, and it is one the
		// user plays.
		expect(persona.isPersona).toBe(true)
		expect(persona.isDefaultPersona).toBe(false)
	})

	test("re-reading a row's own exported card hashes identical — the 'unchanged' decision", async () => {
		const {
			createPersonaFromParsedData,
			buildPersonaExportCard,
			canonicalPersonaContent,
			personaFieldsFromParsedData
		} = await import("./personaCard")
		const { hashCanonicalJson } = await import(
			"$lib/server/utils/contentHash"
		)
		const user = await makeUser("persona-unchanged-user")

		const created = await createPersonaFromParsedData(
			minimalPersonaCard,
			undefined,
			user.id,
			testDb as any
		)

		const exported = buildPersonaExportCard(created)
		expect(hashCanonicalJson(canonicalPersonaContent(created))).toBe(
			hashCanonicalJson(
				canonicalPersonaContent(
					personaFieldsFromParsedData(exported) as any
				)
			)
		)

		expect(await personasOf(user.id)).toHaveLength(1)
	})

	test("an edited card of the same row hashes differently — the 'conflict' decision — and overwrite lands in place", async () => {
		const {
			createPersonaFromParsedData,
			overwritePersonaFromParsedData,
			buildPersonaExportCard,
			canonicalPersonaContent,
			personaFieldsFromParsedData
		} = await import("./personaCard")
		const { hashCanonicalJson } = await import(
			"$lib/server/utils/contentHash"
		)
		const user = await makeUser("persona-conflict-user")

		const created = await createPersonaFromParsedData(
			minimalPersonaCard,
			undefined,
			user.id,
			testDb as any
		)
		const edited = {
			...buildPersonaExportCard(created),
			description: "A completely different description"
		}

		expect(hashCanonicalJson(canonicalPersonaContent(created))).not.toBe(
			hashCanonicalJson(
				canonicalPersonaContent(
					personaFieldsFromParsedData(edited) as any
				)
			)
		)

		const overwritten = await overwritePersonaFromParsedData(
			created.id,
			edited,
			undefined,
			testDb as any
		)
		expect(overwritten.id).toBe(created.id)
		expect(overwritten.description).toBe(
			"A completely different description"
		)
		// An overwrite must not silently un-flag it.
		expect(overwritten.isPersona).toBe(true)
		expect(await personasOf(user.id)).toHaveLength(1)
	})

	test("an explicit external uuid is stamped onto the new row", async () => {
		const { createPersonaFromParsedData, extractPersonaUuid } =
			await import("./personaCard")
		const user = await makeUser("persona-external-uuid-user")
		const fixedUuid = "33333333-3333-3333-3333-333333333333"

		const card = {
			...minimalPersonaCard,
			extensions: { serenepub: { uuid: fixedUuid } }
		}
		expect(extractPersonaUuid(card)).toBe(fixedUuid)

		const persona = await createPersonaFromParsedData(
			card,
			undefined,
			user.id,
			testDb as any
		)
		expect(persona.uuid).toBe(fixedUuid)
	})

	test("two users may hold the same external uuid — identity is per-owner", async () => {
		const { createPersonaFromParsedData } = await import("./personaCard")
		const userA = await makeUser("persona-uuid-collision-user-a")
		const userB = await makeUser("persona-uuid-collision-user-b")
		const sharedUuid = "44444444-4444-4444-4444-444444444444"

		const a = await createPersonaFromParsedData(
			{
				...minimalPersonaCard,
				extensions: { serenepub: { uuid: sharedUuid } }
			},
			undefined,
			userA.id,
			testDb as any
		)
		const b = await createPersonaFromParsedData(
			{
				...minimalPersonaCard,
				name: "Different Name Entirely",
				extensions: { serenepub: { uuid: sharedUuid } }
			},
			undefined,
			userB.id,
			testDb as any
		)

		expect(a.uuid).toBe(sharedUuid)
		expect(b.uuid).toBe(sharedUuid)
		expect(b.id).not.toBe(a.id)
	})

	test("a same-user uuid collision falls back to a fresh uuid rather than throwing", async () => {
		const { createPersonaFromParsedData } = await import("./personaCard")
		const user = await makeUser("persona-same-user-uuid")
		const fixedUuid = "55555555-5555-5555-5555-555555555555"
		const card = {
			...minimalPersonaCard,
			extensions: { serenepub: { uuid: fixedUuid } }
		}

		const first = await createPersonaFromParsedData(
			card,
			undefined,
			user.id,
			testDb as any
		)
		const second = await createPersonaFromParsedData(
			card,
			undefined,
			user.id,
			testDb as any
		)

		expect(first.uuid).toBe(fixedUuid)
		expect(second.uuid).not.toBe(fixedUuid)
		expect(await personasOf(user.id)).toHaveLength(2)
	})

	test("a malformed uuid is treated as absent — imports as new, no raw DB error", async () => {
		const { createPersonaFromParsedData, extractPersonaUuid } =
			await import("./personaCard")
		const user = await makeUser("persona-malformed-uuid-user")

		const malformedCard = {
			...minimalPersonaCard,
			extensions: { serenepub: { uuid: "not-a-real-uuid" } }
		}
		expect(extractPersonaUuid(malformedCard)).toBeUndefined()

		const persona = await createPersonaFromParsedData(
			malformedCard,
			undefined,
			user.id,
			testDb as any
		)
		expect(persona.name).toBe("Jordan")
	})

	/**
	 * ⚠ The card stays SMALL. A persona card is name/description/creator plus
	 * the serenepub extension block; a file claiming to be one must not smuggle
	 * a system prompt or a greeting into the row, and widening the shape would
	 * conflict every lorebook anybody had already exported.
	 */
	test("character-only fields on a persona card are not written", async () => {
		const { createPersonaFromParsedData } = await import("./personaCard")
		const user = await makeUser("persona-narrow-card-user")

		const persona = await createPersonaFromParsedData(
			{
				...minimalPersonaCard,
				personality: "smuggled",
				scenario: "smuggled",
				first_mes: "smuggled",
				post_history_instructions: "smuggled"
			},
			undefined,
			user.id,
			testDb as any
		)

		expect(persona.personality).toBeNull()
		expect(persona.scenario).toBeNull()
		expect(persona.firstMessage).toBeNull()
		expect(persona.postHistoryInstructions).toBeNull()
	})

	test("exporting a persona as PNG with no avatar throws a clean error", async () => {
		const { createPersonaFromParsedData } = await import("./personaCard")
		const { charactersExportCard } = await import(
			"$lib/server/sockets/characters"
		)
		const user = await makeUser("persona-no-avatar-user")

		const persona = await createPersonaFromParsedData(
			minimalPersonaCard,
			undefined,
			user.id,
			testDb as any
		)

		await expect(
			charactersExportCard.handler(
				{ user: { id: user.id } } as any,
				{ id: persona.id, format: "png" },
				() => {}
			)
		).rejects.toThrow(/no avatar/i)
	})
})
