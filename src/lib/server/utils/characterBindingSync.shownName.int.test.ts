/**
 * The stored name is written by `writeBackShownName` (S4 tidy): a card edit
 * does not undo a dated rename on Main, and an undated card rename still
 * reaches a member that has no dated rename.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	insertCard,
	insertCastMember,
	writeCastVersion
} from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let userId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-shownname-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "shown-name-user")).id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let n = 0
async function bound() {
	const { card } = await insertCard(testDb as any, {
		userId,
		name: `Maren ${++n}`,
		description: "d"
	})
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `lb-${n}`, userId })
		.returning()
	const { member } = await insertCastMember(testDb as any, {
		lorebookId: lorebook!.id,
		binding: `{{char:${n}}}`,
		characterId: card.id,
		name: card.name
	})
	return { card, member }
}

const sync = async (characterId: number) => {
	const { syncLorebookBindingsForCharacter } = await import(
		"./characterBindingSync"
	)
	await syncLorebookBindingsForCharacter(characterId, testDb as any)
}

const nameOf = async (id: number) =>
	(
		await testDb
			.select({ name: schema.lorebookBindings.name })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, id))
	)[0]!.name

describe("a card edit and the stored member name", () => {
	test("a dated rename on Main survives a card edit", async () => {
		const { card, member } = await bound()
		await testDb.transaction((tx) =>
			writeCastVersion(
				tx as any,
				{
					member: member.id,
					changes: { name: "Maren Dated" },
					writtenBy: "user:1",
					at: {
						branchId: null,
						date: { year: 3 } as any,
						personalPosition: null
					}
				} as any
			)
		)
		await testDb
			.update(schema.characters)
			.set({ description: "edited" })
			.where(eq(schema.characters.id, card.id))
		await sync(card.id)
		expect(await nameOf(member.id)).toBe("Maren Dated")
	})

	test("an undated card rename reaches a member with no dated rename", async () => {
		const { card, member } = await bound()
		const { ensureCardVersion, updateCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		await testDb.transaction(async (tx) => {
			const current = await ensureCardVersion(tx as any, card.id)
			await updateCardVersion(tx as any, current!.id, {
				name: "Maren Renamed"
			})
		})
		await sync(card.id)
		expect(await nameOf(member.id)).toBe("Maren Renamed")
		await sync(card.id)
		expect(await nameOf(member.id)).toBe("Maren Renamed")
	})
})
