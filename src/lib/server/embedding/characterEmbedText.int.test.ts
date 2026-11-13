/**
 * What a card embeds is its **current card version's** name and description
 * (the highest `number`), not the `characters` row's copies; a card with no
 * version yet falls back to the row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"
import { insertCard, newCardVersion } from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-card-embed-text-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("characterEmbedText reads the card's current version", () => {
	async function embedTextOf(cardId: number) {
		const { characterEmbedText } = await import("./vectorizationQueue")
		const [row] = await testDb
			.select({ text: characterEmbedText })
			.from(schema.characters)
			.where(eq(schema.characters.id, cardId))
		return row.text
	}

	it("a new card version's name and description are what the card embeds", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, "card-embed-text")
		const { card, version } = await insertCard(testDb as unknown as Db, {
			userId: u.id,
			name: "Old name",
			description: "Old description."
		} as any)
		expect(await embedTextOf(card.id)).toBe("Old name\nOld description.")
		const v2 = await newCardVersion(testDb as unknown as Db, card.id, {
			...profileOf(version),
			name: "New name",
			description: "New description."
		})
		expect(v2.number).toBe(2)
		// The row's own columns moved with it (⏳ copies); put them back to
		// show the text no longer comes from them.
		await testDb
			.update(schema.characters)
			.set({ name: "Copy name", description: "Copy description." })
			.where(eq(schema.characters.id, card.id))
		expect(await embedTextOf(card.id)).toBe("New name\nNew description.")
	}, 60_000)

	it("a card with no version yet embeds the row's name and description", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, "card-embed-text-raw")
		const [row] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Raw", description: "Raw card." } as any)
			.returning()
		expect(await embedTextOf(row.id)).toBe("Raw\nRaw card.")
	}, 60_000)
})
