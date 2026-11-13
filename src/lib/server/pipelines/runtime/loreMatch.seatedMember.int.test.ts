/**
 * 🚧 `bind` of a `create-lore-entry@1` accepts `seated-member:<memberId>`
 * beside `character:<cardId>` (plan §27 S2, refs in): the member itself, in
 * this book's cast or refused in words.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { CHARACTER_LORE_TYPE_ID } from "$lib/shared/entries/types"

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
		path.join(os.tmpdir(), "serene-pub-vitest-lorematch-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

describe("resolveBind", () => {
	test("seated-member names a member of this book; another book's, or nobody's, is refused in the cast sentence", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { resolveBind } = await import(
			"$lib/server/pipelines/runtime/loreMatch"
		)
		const u = await createTestUser(testDb, "lorematch-1")
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Ilse", description: "The card." })
			.returning()
		const books = await testDb
			.insert(schema.lorebooks)
			.values([
				{ userId: u.id, name: "Here" },
				{ userId: u.id, name: "Elsewhere" }
			] as any)
			.returning()
		const [here, elsewhere] = books
		const member = async (
			lorebookId: number,
			name: string,
			characterId: number | null
		) =>
			(
				await testDb
					.insert(schema.lorebookBindings)
					.values({
						lorebookId,
						characterId,
						binding: `{{char:${name}}}`,
						name
					} as any)
					.returning()
			)[0]!
		const mHere = await member(here!.id, "Ilse of Here", card!.id)
		const mCardless = await member(here!.id, "Voice", null)
		const mElsewhere = await member(
			elsewhere!.id,
			"Ilse of Elsewhere",
			null
		)
		const at = { lorebookId: here!.id, typeId: CHARACTER_LORE_TYPE_ID }

		expect(
			await resolveBind(db(), at, `seated-member:${mHere.id}`, "n")
		).toBe(mHere.id)
		// A member with no card is still a member of the cast.
		expect(
			await resolveBind(db(), at, `seated-member:${mCardless.id}`, "n")
		).toBe(mCardless.id)
		// The card form is unchanged.
		expect(await resolveBind(db(), at, `character:${card!.id}`, "n")).toBe(
			mHere.id
		)

		await expect(
			resolveBind(db(), at, `seated-member:${mElsewhere.id}`, "n")
		).rejects.toThrow("Ilse of Elsewhere is not in this book's cast")
		await expect(
			resolveBind(db(), at, "seated-member:99999999", "n")
		).rejects.toThrow("cast member 99999999 is not in this book's cast")
	})
})
