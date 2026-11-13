/**
 * `cardsNow`: cards as their current card version has them, never the ⏳
 * copy columns.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, newCardVersion } from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"
import { cardsNow } from "./seatedCast"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardsnow-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("cardsnow-user") })
		.returning()
	return row!
}

describe("cardsNow", () => {
	test("reads the current version's content, not v1's, and keeps the library facts", async () => {
		const u = await user()
		const { card, version } = await insertCard(testDb, {
			userId: u.id,
			name: "Maren",
			description: "first"
		})
		await newCardVersion(testDb, card.id, {
			...profileOf(version),
			name: "Maren Vale",
			description: "second"
		})
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, card.id))
		const now = (await cardsNow(testDb, [card.id])).get(card.id)
		expect(now).toMatchObject({
			id: card.id,
			userId: u.id,
			isDeleted: true,
			name: "Maren Vale",
			description: "second"
		})
	})

	test("never reads the copy columns: a stale copy does not show", async () => {
		const u = await user()
		const { card } = await insertCard(testDb, {
			userId: u.id,
			name: "Real",
			description: ""
		})
		await testDb
			.update(schema.characters)
			.set({ name: "Stale copy" })
			.where(eq(schema.characters.id, card.id))
		expect((await cardsNow(testDb, [card.id])).get(card.id)?.name).toBe("Real")
	})

	test("lifts a raw-inserted card to v1 on first ask", async () => {
		const u = await user()
		const [raw] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Raw", description: "old text" })
			.returning()
		const before = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, raw!.id))
		expect(before).toHaveLength(0)
		const now = (await cardsNow(testDb, [raw!.id])).get(raw!.id)
		expect(now).toMatchObject({ name: "Raw", description: "old text" })
		const after = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, raw!.id))
		expect(after).toHaveLength(1)
		expect(after[0]!.number).toBe(1)
	})

	test("skips unknown ids and reads nothing for no ids", async () => {
		expect((await cardsNow(testDb, [987654321])).size).toBe(0)
		expect((await cardsNow(testDb, [])).size).toBe(0)
	})
})
