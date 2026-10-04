/**
 * `embed_text_hash` on `session_messages`, `characters` and
 * `lorebook_bindings` — the hash of what each row embeds, stored by Postgres.
 *
 * The queue reads each row's text through one SQL recipe
 * (`messageEmbedText`, `characterEmbedText`, `bindingEmbedText`) and compares
 * the vector's `embedding_source_hash` with the row's GENERATED column. The
 * column spells the recipe a second time, in the schema; this test is what ties
 * the two, for every recipe's branches and for text whose bytes are easy to get
 * wrong (a backslash, an escape-shaped run, a non-ASCII letter, an emoji).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-vitest-column-embed-hash-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const TRICKY = "C:\\x41 \\123 über 😀"

/** The recipe as the app spells it, hashed as the app hashes. */
const digest = (text: SQL) =>
	sql<string>`left(encode(sha256(convert_to(${text}, 'UTF8')), 'hex'), 16)`

async function agree(
	table:
		| typeof schema.sessionMessages
		| typeof schema.characters
		| typeof schema.lorebookBindings,
	text: SQL,
	id: number
) {
	const [row] = await testDb
		.select({ stored: table.embedTextHash, recipe: digest(text) })
		.from(table)
		.where(eq(table.id, id))
	expect(row.stored).toBe(row.recipe)
}

describe("embed_text_hash on the column stores", () => {
	let userId: number
	let bookId: number

	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		userId = (await createTestUser(testDb, "column-embed-hash")).id
		;[{ id: bookId }] = await testDb
			.insert(schema.lorebooks)
			.values({ userId, name: "Hashes" })
			.returning()
	}, 60_000)

	it("a message's is the hash of its content", async () => {
		const { messageEmbedText } = await import("./vectorizationQueue")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId, isGroup: false } as any)
			.returning()
		const [row] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "user", content: TRICKY })
			.returning()
		await agree(schema.sessionMessages, messageEmbedText, row.id)
	}, 60_000)

	it("a character's is the hash of its name and description", async () => {
		const { characterEmbedText } = await import("./vectorizationQueue")
		const [row] = await testDb
			.insert(schema.characters)
			.values({ userId, name: "Ünï", description: TRICKY } as any)
			.returning()
		await agree(schema.characters, characterEmbedText, row.id)
	}, 60_000)

	it("a member's is the hash of its name, with the summary when there is one", async () => {
		const { bindingEmbedText } = await import("./vectorizationQueue")
		let n = 0
		for (const summary of [TRICKY, "", null]) {
			const [row] = await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: bookId,
					binding: `{{char:${++n}}}`,
					name: "Maren \\ the ferrywoman",
					summary
				} as any)
				.returning()
			await agree(schema.lorebookBindings, bindingEmbedText, row.id)
		}
	}, 60_000)

	it("follows a write that changes the text, even one that pins updated_at", async () => {
		const { bindingEmbedText } = await import("./vectorizationQueue")
		const [row] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: bookId, binding: "{{char:9}}", name: "Before" })
			.returning()
		await testDb
			.update(schema.lorebookBindings)
			.set({
				name: "After",
				updatedAt: sql`${schema.lorebookBindings.updatedAt}`
			})
			.where(eq(schema.lorebookBindings.id, row.id))
		const [after] = await testDb
			.select({ hash: schema.lorebookBindings.embedTextHash })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, row.id))
		expect(after.hash).not.toBe(row.embedTextHash)
		await agree(schema.lorebookBindings, bindingEmbedText, row.id)
	}, 60_000)
})
