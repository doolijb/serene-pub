import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		const { charactersImportCard, charactersImportResolve, charactersExportCard } =
			await import("./characters")
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
