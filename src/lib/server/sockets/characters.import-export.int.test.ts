import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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
		path.join(os.tmpdir(), "serene-pub-characters-int-test-")
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

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

function toBase64(card: unknown): string {
	return Buffer.from(JSON.stringify(card), "utf-8").toString("base64")
}

const minimalV2Card = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "Aria",
		description: "A brave adventurer",
		personality: "Bold",
		scenario: "A fantasy world",
		first_mes: "Hello!",
		mes_example: "",
		creator_notes: "",
		system_prompt: "",
		post_history_instructions: "",
		alternate_greetings: [],
		tags: ["fantasy"],
		creator: "tester",
		character_version: "",
		extensions: {}
	}
}

describe("characters import/export (PGlite integration)", () => {
	test("imports a plain V2 JSON card, creating a row with correct fields", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("v2-import-user")

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalV2Card) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.character?.name).toBe("Aria")
		expect(res.character?.description).toBe("A brave adventurer")
		expect(res.character?.personality).toBe("Bold")
	})

	test("imports a V1 (flat, char_name) card with fields recovered via getRobustSpecV3Data, no phantom lorebook", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("v1-import-user")

		const v1Card = {
			char_name: "Vera",
			description: "A wanderer",
			personality: "Quiet",
			scenario: "A desert",
			first_mes: "...",
			tags: ["oc", "wanderer"]
		}

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(v1Card) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.character?.name).toBe("Vera")
		expect(res.book).toBeNull()
	})

	test("imports a card with an embedded lorebook, returning it in the response", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("embedded-book-user")

		const cardWithBook = {
			...minimalV2Card,
			data: {
				...minimalV2Card.data,
				character_book: {
					name: "Aria's Lore",
					description: "",
					extensions: {},
					entries: [
						{
							keys: ["sword"],
							content: "A magic sword",
							extensions: {},
							enabled: true,
							insertion_order: 0
						}
					]
				}
			}
		}

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(cardWithBook) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.book).toBeDefined()
		expect(res.book?.name).toBe("Aria's Lore")
		expect(res.book?.entries).toHaveLength(1)
	})

	test("re-importing the exact bytes of a previously-imported card (same uuid) reports unchanged with no new row", async () => {
		const { charactersImportCard, charactersExportCard } = await import(
			"./characters"
		)
		const user = await makeUser("unchanged-user")

		const created = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalV2Card) },
			noopEmit
		)
		expect(created.status).toBe("created")

		const exported = await charactersExportCard.handler(
			fakeSocket(user.id),
			{ id: created.character!.id, format: "json" },
			noopEmit
		)
		const exportedBase64 = exported.blob.toString("base64")

		const reimported = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: exportedBase64 },
			noopEmit
		)

		expect(reimported.status).toBe("unchanged")
		expect(reimported.character?.id).toBe(created.character!.id)

		const rows = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(rows).toHaveLength(1)
	})

	test("importing an edited version of an already-imported card (same uuid, different content) conflicts, then resolves via overwrite/createNew", async () => {
		const {
			charactersImportCard,
			charactersImportResolve,
			charactersExportCard
		} = await import("./characters")
		const user = await makeUser("conflict-user")

		const created = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalV2Card) },
			noopEmit
		)
		const exported = await charactersExportCard.handler(
			fakeSocket(user.id),
			{ id: created.character!.id, format: "json" },
			noopEmit
		)
		const exportedCard = JSON.parse(exported.blob.toString("utf-8"))
		exportedCard.data.description = "A completely different description"
		const editedBase64 = Buffer.from(
			JSON.stringify(exportedCard),
			"utf-8"
		).toString("base64")

		const conflictRes = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: editedBase64 },
			noopEmit
		)
		expect(conflictRes.status).toBe("conflict")
		expect(conflictRes.conflict?.existingCharacter.id).toBe(
			created.character!.id
		)

		const overwritten = await charactersImportResolve.handler(
			fakeSocket(user.id),
			{
				file: editedBase64,
				action: "overwrite",
				existingId: created.character!.id
			},
			noopEmit
		)
		expect(overwritten.character.id).toBe(created.character!.id)
		expect(overwritten.character.description).toBe(
			"A completely different description"
		)

		const asNew = await charactersImportResolve.handler(
			fakeSocket(user.id),
			{ file: editedBase64, action: "createNew", existingId: -1 },
			noopEmit
		)
		expect(asNew.character.id).not.toBe(created.character!.id)

		const rows = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(rows).toHaveLength(2)
	})

	test("a malformed extensions.serenepub.uuid is treated as absent — imports as new, no raw DB error", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("malformed-uuid-user")

		const malformedCard = {
			...minimalV2Card,
			data: {
				...minimalV2Card.data,
				extensions: { serenepub: { uuid: "not-a-real-uuid" } }
			}
		}

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(malformedCard) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.character?.name).toBe("Aria")
	})

	test("exporting as PNG with no avatar throws a clean error", async () => {
		const { charactersImportCard, charactersExportCard } = await import(
			"./characters"
		)
		const user = await makeUser("no-avatar-user")

		const created = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalV2Card) },
			noopEmit
		)

		await expect(
			charactersExportCard.handler(
				fakeSocket(user.id),
				{ id: created.character!.id, format: "png" },
				noopEmit
			)
		).rejects.toThrow(/no avatar/i)
	})

	test("importing a card with an explicit external uuid stamps that uuid onto the new row", async () => {
		const { charactersImportCard, charactersExportCard } = await import(
			"./characters"
		)
		const user = await makeUser("external-uuid-user")
		const fixedUuid = "11111111-1111-1111-1111-111111111111"

		const cardWithUuid = {
			...minimalV2Card,
			data: {
				...minimalV2Card.data,
				extensions: { serenepub: { uuid: fixedUuid } }
			}
		}

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(cardWithUuid) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.character?.uuid).toBe(fixedUuid)

		// Re-import via the row's own freshly-exported bytes (not the original
		// hand-crafted card) — buildCharacterCardV3 fills in normalized
		// defaults for fields the minimal hand-crafted card omits, so
		// comparing the hand-crafted card directly against the stored row's
		// own comparison data would spuriously "conflict" on that formatting
		// drift alone, independent of the uuid fix under test here.
		const exported = await charactersExportCard.handler(
			fakeSocket(user.id),
			{ id: res.character!.id, format: "json" },
			noopEmit
		)
		const reimported = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: exported.blob.toString("base64") },
			noopEmit
		)
		expect(reimported.status).toBe("unchanged")
		expect(reimported.character?.id).toBe(res.character!.id)

		const rows = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(rows).toHaveLength(1)
	})

	test("two different users importing cards that share the same external uuid both succeed and each keep that uuid", async () => {
		const { charactersImportCard } = await import("./characters")
		const userA = await makeUser("uuid-collision-user-a")
		const userB = await makeUser("uuid-collision-user-b")
		const sharedUuid = "22222222-2222-2222-2222-222222222222"

		const cardForA = {
			...minimalV2Card,
			data: {
				...minimalV2Card.data,
				name: "Aria",
				extensions: { serenepub: { uuid: sharedUuid } }
			}
		}
		const cardForB = {
			...minimalV2Card,
			data: {
				...minimalV2Card.data,
				name: "Different Name Entirely",
				extensions: { serenepub: { uuid: sharedUuid } }
			}
		}

		const resA = await charactersImportCard.handler(
			fakeSocket(userA.id),
			{ file: toBase64(cardForA) },
			noopEmit
		)
		expect(resA.status).toBe("created")
		expect(resA.character?.uuid).toBe(sharedUuid)

		const resB = await charactersImportCard.handler(
			fakeSocket(userB.id),
			{ file: toBase64(cardForB) },
			noopEmit
		)
		expect(resB.status).toBe("created")
		expect(resB.character?.uuid).toBe(sharedUuid)
		expect(resB.character?.id).not.toBe(resA.character?.id)
	})

	test("importing a character card with an embedded lorebook links the primary character to the imported lorebook with no duplicate character row", async () => {
		const { charactersImportCard, charactersExportCard } = await import(
			"./characters"
		)
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("embedded-book-relink-user")

		const created = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalV2Card) },
			noopEmit
		)
		const characterId = created.character!.id

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Aria's Lore", userId: user.id })
			.returning()
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId,
			binding: "{{char:1}}"
		})
		// hasLorebookEntries (in parseCharacterCardFromBase64) treats a
		// genuinely entry-less book as absent, same as v2/v3's own bookless
		// placeholder — a real entry is needed for `book` to come back
		// non-null on re-import below.
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "Ancient Ruins",
			content: "Ruins in the desert",
			keys: "ruins"
		})

		const exported = await charactersExportCard.handler(
			fakeSocket(user.id),
			{ id: characterId, format: "json", lorebookId: lorebook.id },
			noopEmit
		)
		const exportedCard = JSON.parse(exported.blob.toString("utf-8"))

		// Simulate a fresh account importing this exact exported file: delete
		// the original character and lorebook first, matching what a
		// different user's empty account would look like.
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebook.id))
		await testDb
			.delete(schema.characters)
			.where(eq(schema.characters.id, characterId))

		const reimportedCharacter = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(exportedCard) },
			noopEmit
		)
		expect(reimportedCharacter.status).toBe("created")
		expect(reimportedCharacter.book).not.toBeNull()

		const reimportedBook = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: reimportedCharacter.book! },
			noopEmit
		)
		expect(reimportedBook.status).toBe("created")

		const characterRows = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(characterRows).toHaveLength(1)

		const bindingRows = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) =>
				eq(b.lorebookId, (reimportedBook.lorebook as any).id)
		})
		expect(bindingRows).toHaveLength(1)
		expect(bindingRows[0].characterId).toBe(
			reimportedCharacter.character!.id
		)
	})

	test("exporting with an embedded lorebook selected includes character_book matching the source lorebook's entries", async () => {
		const { charactersImportCard, charactersExportCard } = await import(
			"./characters"
		)
		const user = await makeUser("export-with-book-user")

		const created = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalV2Card) },
			noopEmit
		)
		const characterId = created.character!.id

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Shared Lore", userId: user.id })
			.returning()
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId,
			binding: "{{char:1}}"
		})
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "Ancient Ruins",
			content: "Ruins in the desert",
			keys: "ruins"
		})

		const exported = await charactersExportCard.handler(
			fakeSocket(user.id),
			{ id: characterId, format: "json", lorebookId: lorebook.id },
			noopEmit
		)
		const exportedCard = JSON.parse(exported.blob.toString("utf-8"))

		expect(exportedCard.data.character_book).toBeDefined()
		expect(exportedCard.data.character_book.name).toBe("Shared Lore")
		expect(exportedCard.data.character_book.entries).toHaveLength(1)
		expect(exportedCard.data.character_book.entries[0].content).toBe(
			"Ruins in the desert"
		)
	})
})
