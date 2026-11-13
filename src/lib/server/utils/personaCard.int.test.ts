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

/** A card's versions, oldest first. */
async function versionsOf(cardId: number) {
	const { asc, eq } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))
		.orderBy(asc(schema.characterVersions.number))
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

		// …and it has its first card version (cv-writers).
		const versions = await versionsOf(persona.id)
		expect(versions).toHaveLength(1)
		expect(versions[0]).toMatchObject({
			number: 1,
			name: "Jordan",
			description: "A curious traveler"
		})
	})

	test("the avatar of a persona card becomes the face of its current card version", async () => {
		const { createPersonaFromParsedData, overwritePersonaFromParsedData } =
			await import("./personaCard")
		const { PNG } = await import("pngjs")
		const picture = (seed: number) => {
			const img = new PNG({ width: 2, height: 2 })
			img.data.fill(200)
			img.data[0] = seed
			return PNG.sync.write(img)
		}
		const user = await makeUser("persona-face-user")
		const warnings: string[] = []
		const persona = await createPersonaFromParsedData(
			minimalPersonaCard,
			picture(1),
			user.id,
			testDb as any,
			warnings
		)
		expect(warnings).toEqual([])
		expect(persona.avatarMediaId).toEqual(expect.any(Number))
		let versions = await versionsOf(persona.id)
		expect(versions).toHaveLength(1)
		expect(versions[0].faceMediaId).toBe(persona.avatarMediaId)

		// An overwrite's new picture is the new version's face; v1 keeps the old one.
		const again = await overwritePersonaFromParsedData(
			persona.id,
			{ ...minimalPersonaCard, description: "Changed" },
			picture(2),
			testDb as any,
			warnings
		)
		expect(warnings).toEqual([])
		expect(again.avatarMediaId).not.toBe(persona.avatarMediaId)
		versions = await versionsOf(persona.id)
		expect(versions.map((v) => v.faceMediaId)).toEqual([
			persona.avatarMediaId,
			again.avatarMediaId
		])
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

	test("an edited card of the same row hashes differently — the 'conflict' decision — and overwrite adds a card version", async () => {
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
		// the row's description is the current version's ⏳ copy
		expect(overwritten.description).toBe(
			"A completely different description"
		)
		// An overwrite must not silently un-flag it.
		expect(overwritten.isPersona).toBe(true)
		expect(await personasOf(user.id)).toHaveLength(1)
		// No write in place: v1 is as it was, v2 holds the file's card.
		const versions = await versionsOf(created.id)
		expect(versions.map((v) => v.number)).toEqual([1, 2])
		expect(versions[0]).toMatchObject({ description: "A curious traveler" })
		expect(versions[1]).toMatchObject({
			name: "Jordan",
			description: "A completely different description"
		})
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
	test("the likeness round-trips through the persona card, and an overwrite merges it", async () => {
		const {
			createPersonaFromParsedData,
			overwritePersonaFromParsedData,
			buildPersonaExportCard,
			canonicalPersonaContent,
			personaFieldsFromParsedData
		} = await import("./personaCard")
		const { readLikeness } = await import("$lib/server/characters/likeness")
		const { hashCanonicalJson } = await import(
			"$lib/server/utils/contentHash"
		)
		const user = await makeUser("persona-likeness-user")
		const likeness = { prompt: "adult man, grey beard, blue coat", negative: "hat" }

		const created = await createPersonaFromParsedData(
			{ ...minimalPersonaCard, extensions: { serenepub: { likeness } } },
			undefined,
			user.id,
			testDb as any
		)
		expect(readLikeness(created.extensions)).toEqual(likeness)

		// Out: carried under the same key a character card uses.
		const exported = buildPersonaExportCard(created)
		expect(exported.extensions.serenepub.likeness).toEqual(likeness)
		// …and outside the dedup hash, so the book still reads unchanged.
		expect(hashCanonicalJson(canonicalPersonaContent(created))).toBe(
			hashCanonicalJson(
				canonicalPersonaContent(personaFieldsFromParsedData(exported) as any)
			)
		)

		// In again, on another account: the likeness lands on the new row.
		const other = await makeUser("persona-likeness-other")
		const copy = await createPersonaFromParsedData(
			exported,
			undefined,
			other.id,
			testDb as any
		)
		expect(readLikeness(copy.extensions)).toEqual(likeness)

		// A likeness image id from elsewhere names no file of theirs: dropped,
		// so the likeness falls back to the avatar (the character-card rule).
		const foreignId = await createPersonaFromParsedData(
			{
				...minimalPersonaCard,
				extensions: { serenepub: { likeness: { ...likeness, imageMediaId: 999_999 } } }
			},
			undefined,
			other.id,
			testDb as any
		)
		expect(readLikeness(foreignId.extensions)).toEqual(likeness)

		// SillyTavern's key is read when ours is absent (one direction).
		const fromSt = await createPersonaFromParsedData(
			{
				...minimalPersonaCard,
				extensions: { sd_character_prompt: { positive: "red scarf", negative: "glasses" } }
			},
			undefined,
			other.id,
			testDb as any
		)
		expect(readLikeness(fromSt.extensions)).toEqual({ prompt: "red scarf", negative: "glasses" })

		// An overwrite adds a version: the version's other keys survive, the likeness is replaced.
		const { updateCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const [first] = await versionsOf(copy.id)
		await updateCardVersion(testDb as any, first.id, {
			extensions: { other: { kept: true } }
		})
		const overwritten = await overwritePersonaFromParsedData(
			copy.id,
			{ ...exported, extensions: { serenepub: { likeness: { prompt: "clean-shaven" } } } },
			undefined,
			testDb as any
		)
		const afterOverwrite = await versionsOf(overwritten.id)
		expect(afterOverwrite.map((v) => v.number)).toEqual([1, 2])
		expect(afterOverwrite[0].likeness).toEqual(likeness)
		expect(afterOverwrite[1].likeness).toEqual({ prompt: "clean-shaven" })
		expect(afterOverwrite[1].extensions).toEqual({ other: { kept: true } })

		// A card with no likeness leaves the current version's alone.
		await overwritePersonaFromParsedData(
			copy.id,
			minimalPersonaCard,
			undefined,
			testDb as any
		)
		const afterUntouched = await versionsOf(copy.id)
		expect(afterUntouched).toHaveLength(3)
		expect(afterUntouched[2].likeness).toEqual({ prompt: "clean-shaven" })
	})

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
