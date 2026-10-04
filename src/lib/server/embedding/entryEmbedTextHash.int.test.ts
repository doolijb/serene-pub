/**
 * `lorebook_entries.embed_text_hash` — the hash of what the default space
 * embeds, stored on the entry by Postgres.
 *
 * The queue's staleness check compares it with the vector's `source_hash`. It
 * used to hash every entry's whole text inside that check, on every pick and
 * every reply's scoped count — twenty times the cost of the check it replaced
 * on a 2,000-entry library. A stored column makes the check compare two short
 * strings; a GENERATED one means no writer can forget to update it, including a
 * raw statement that pins `updated_at`.
 *
 * ⚠ The column's expression spells the entry-type list out, frozen when the
 * migration was cut; `entryEmbedText` derives it from the declarations. This
 * test is what ties the two: a type whose `embedText` role changes (or a new
 * embeddable type) fails here until a migration re-spells the column.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"
import { EMBEDDABLE_ENTRY_TYPES } from "./entrySources"

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
		path.join(os.tmpdir(), "serene-pub-vitest-embed-text-hash-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** The recipe as the app spells it: `entryEmbedText`, sha-256, 16 hex. */
async function recipeHash(id: number): Promise<string> {
	const { entryEmbedText } = await import("./vectorizationQueue")
	const [row] = await testDb
		.select({
			hash: sql<string>`left(encode(sha256(convert_to(${entryEmbedText}, 'UTF8')), 'hex'), 16)`
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
	return row.hash
}

async function storedHash(id: number): Promise<string | null> {
	const [row] = await testDb
		.select({ hash: schema.lorebookEntries.embedTextHash })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
	return row.hash
}

describe("lorebook_entries.embed_text_hash", () => {
	let lorebookId: number

	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "embed-text-hash")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Hashes" })
			.returning()
		lorebookId = book.id
	}, 60_000)

	it("is the hash of what the default space embeds, for every embeddable entry type", async () => {
		expect(EMBEDDABLE_ENTRY_TYPES.length).toBeGreaterThan(0)
		let position = 0
		for (const type of EMBEDDABLE_ENTRY_TYPES)
			for (const title of ["A title", ""]) {
				// A backslash, an escape-shaped run and a non-ASCII letter: the
				// bytes the column hashes must be the text's UTF-8, exactly.
				const [row] = await testDb
					.insert(schema.lorebookEntries)
					.values(
						entryInsert({
							lorebookId,
							typeId: type.typeId,
							position: position++,
							title,
							content: "C:\\x41 \\123 über 😀"
						} as any) as any
					)
					.returning()
				expect(
					await storedHash(row.id),
					`${type.typeId}, title "${title}"`
				).toBe(await recipeHash(row.id))
			}
	}, 60_000)

	it("follows a write that changes the text, even one that pins updated_at", async () => {
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					lorebookId,
					typeId: EMBEDDABLE_ENTRY_TYPES[0]!.typeId,
					position: 100,
					title: "Before",
					content: "Old words."
				} as any) as any
			)
			.returning()
		const before = await storedHash(row.id)
		await testDb
			.update(schema.lorebookEntries)
			.set({
				content: "New words.",
				updatedAt: sql`${schema.lorebookEntries.updatedAt}`
			})
			.where(eq(schema.lorebookEntries.id, row.id))
		const after = await storedHash(row.id)
		expect(after).not.toBe(before)
		expect(after).toBe(await recipeHash(row.id))
	}, 60_000)
})
