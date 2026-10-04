/**
 * `lorebook_entries.annotation_text_hash` — the hash of what the annotation
 * lane reads for an entry, stored by Postgres (plan A23).
 *
 * The lane's picker compares it with `entry_annotations.source_hash` in SQL;
 * the run receipts and binding suggestions compute the same fact in JavaScript
 * with `entrySourceHash`. Two spellings of one recipe, so this pins them equal
 * over the text that could part them: backslashes (the `escape` decode), a key
 * that is NULL or holds a comma, characters outside the Basic Multilingual
 * Plane, and a text longer than the extractor's cut — the hash covers the
 * whole text, as the embedding lane's does, so an edit past the cut is an edit.
 *
 * ⚠ No case holds a NULL key. The app never writes one (`keysToArray`), and
 * drizzle reads a NULL `text[]` element back as the string "NULL", so the two
 * spellings would part there on the reader's side, not the recipe's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-annotation-text-hash-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("lorebook_entries.annotation_text_hash", () => {
	let lorebookId: number

	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "annotation-text-hash")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Hashes" })
			.returning()
		lorebookId = book!.id
	}, 60_000)

	async function insert(values: {
		name: string
		keys?: string
		content: string
		title?: string | null
		keysArray?: string[]
	}) {
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId,
						name: values.name,
						keys: values.keys ?? "",
						content: values.content
					}
				]).map((v) => ({
					...v,
					...(values.title !== undefined
						? { title: values.title }
						: {}),
					...(values.keysArray ? { keys: values.keysArray } : {})
				}))
			)
			.returning()
		return row!
	}

	const cases: Array<[string, Parameters<typeof insert>[0]]> = [
		["a plain entry", { name: "Stonefast", content: "A keep." }],
		[
			"backslashes, quotes and escapes",
			{
				name: "C:\\keep\\n",
				content: "It says \\x41 and \\\\ and 'quoted' and \"double\".",
				keysArray: ["back\\slash", "tab\there"]
			}
		],
		[
			"a key with a comma, and an empty key",
			{
				name: "Keys",
				content: "Body.",
				keysArray: ["Vell, Commander", "", "Ashguard"]
			}
		],
		["no title", { name: "Untitled", content: "Body.", title: null }],
		[
			"characters outside the Basic Multilingual Plane",
			{
				name: "Dragon 🐉",
				content: "Ēmber wakes 🐉🔥 — 龍 — e\u0301 — \u200d.",
				keysArray: ["🐉"]
			}
		],
		[
			"a text longer than the extractor's cut",
			{
				name: "Long",
				content: "🐉".repeat(12_000) + " tail past the cut"
			}
		],
		["nothing at all", { name: "", content: "", title: "", keysArray: [] }]
	]

	for (const [label, values] of cases)
		it(`matches entrySourceHash for ${label}`, async () => {
			const { entrySourceHash } = await import("./index")
			const inserted = await insert(values)
			const [row] = await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, inserted.id))
			expect(row!.annotationTextHash).toBe(entrySourceHash(row!))
		}, 60_000)

	it("moves with the keys, and not with a write beside the text", async () => {
		const row = await insert({ name: "Mover", content: "Body." })
		const before = row.annotationTextHash
		const [reordered] = await testDb
			.update(schema.lorebookEntries)
			.set({ position: 42 })
			.where(eq(schema.lorebookEntries.id, row.id))
			.returning()
		expect(reordered!.annotationTextHash).toBe(before)
		const [rekeyed] = await testDb
			.update(schema.lorebookEntries)
			.set({ keys: ["Mover", "the mover"] })
			.where(eq(schema.lorebookEntries.id, row.id))
			.returning()
		expect(rekeyed!.annotationTextHash).not.toBe(before)
	}, 60_000)
})
