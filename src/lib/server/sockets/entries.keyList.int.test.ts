/**
 * Entry keys are a list end to end (finding #146).
 *
 * The column is `text[]`, the wire carries `string[]`, and the editor draws one
 * chip per element — so a regex key holding a comma (`\w{2,4}`) or a literal
 * "Smith, John" must come back from every write and every read as the one key
 * it was typed as. A join-then-split anywhere on the way tears it in two, and
 * the matcher then looks for `\w{2` and `4}`, which match nothing.
 *
 * Covered here: create, update, amendment (create + list), the book's entry
 * list, and the resolved read the retrieval path makes — then the matcher on
 * what that read hands it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { entryAsOf, type Amendment } from "$lib/shared/lorebooks/amendments"
import {
	buildScanWindow,
	keywordMatch
} from "$lib/server/pipelines/ranking/signals"
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
		path.join(os.tmpdir(), "serene-pub-entries-keylist-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

async function storedRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
	return row
}

const REGEX_KEY = String.raw`\w{2,4}`
const window = (text: string) => buildScanWindow([{ content: text }], 10)

describe("a key holding a comma is one key everywhere (#146)", () => {
	test("create, update, amendment and read-back keep the list whole", async () => {
		const { createEntryHandler, updateEntryHandler, entryListHandler } =
			await import("./entries")
		const { amendmentsCreateHandler, amendmentsListHandler } = await import(
			"./amendments"
		)
		const user = await makeUser("keylist-round-trip")
		const book = await makeLorebook(user.id, "Keylist Book")

		// ── create ──
		const { entry: created } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book.id,
					name: "Patterns",
					content: "Matched by pattern.",
					keys: [REGEX_KEY, "Smith, John"],
					secondaryKeys: ["x{1,2}"],
					selectiveLogic: "andAny",
					useRegex: true
				} as any
			},
			noopEmit
		)
		expect(created.keys).toEqual([REGEX_KEY, "Smith, John"])
		expect(created.secondaryKeys).toEqual(["x{1,2}"])
		expect((await storedRow(created.id)).keys).toEqual([
			REGEX_KEY,
			"Smith, John"
		])

		// ── update ──
		const { entry: updated } = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					id: created.id,
					keys: [REGEX_KEY, "b{1,3}"],
					secondaryKeys: ["y{2,}"]
				} as any
			},
			noopEmit
		)
		expect(updated.keys).toEqual([REGEX_KEY, "b{1,3}"])
		expect(updated.secondaryKeys).toEqual(["y{2,}"])
		const row = await storedRow(created.id)
		expect(row.keys).toEqual([REGEX_KEY, "b{1,3}"])
		expect(row.secondaryKeys).toEqual(["y{2,}"])

		// ── amendment ──
		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: created.id,
				year: 3,
				fields: { keys: ["(ab){2,3}", REGEX_KEY] }
			},
			noopEmit
		)
		const amendments = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		expect(amendments.entries).toHaveLength(1)
		expect(amendments.entries[0].fields.keys).toEqual([
			"(ab){2,3}",
			REGEX_KEY
		])

		// ── read-back: the list, then the resolved read ──
		const list = await entryListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, typeId: WORLD_LORE_TYPE_ID },
			noopEmit
		)
		const listed = list.entryList.find((e) => e.id === created.id)!
		expect(listed.keys).toEqual([REGEX_KEY, "b{1,3}"])

		const overlays = amendments.entries as unknown as Amendment[]
		const before = entryAsOf(listed, overlays, { moment: { year: 2 } })
		const after = entryAsOf(listed, overlays, { moment: { year: 3 } })
		expect(before.keys).toEqual([REGEX_KEY, "b{1,3}"])
		expect(after.keys).toEqual(["(ab){2,3}", REGEX_KEY])

		// The matcher gets the keys it was given, not their fragments: the
		// quantifier pattern matches whole, and nothing matches `(ab){2`.
		const match = keywordMatch(after, window("she said abab loudly"))
		expect(match.hits.map((h) => h.key)).toContain("(ab){2,3}")
		expect(match.signal).toBe(1)
	}, 60_000)

	test("a legacy comma string is split once, at the write boundary", async () => {
		const { createEntryHandler } = await import("./entries")
		const { amendmentsCreateHandler, amendmentsListHandler } = await import(
			"./amendments"
		)
		const user = await makeUser("keylist-legacy")
		const book = await makeLorebook(user.id, "Legacy Keys Book")

		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book.id,
					name: "Old client",
					content: "Sent the comma string.",
					keys: "tavern, inn"
				} as any
			},
			noopEmit
		)
		expect(entry.keys).toEqual(["tavern", "inn"])

		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: entry.id,
				year: 2,
				fields: { keys: "hall, lodge", secondaryKeys: "" }
			},
			noopEmit
		)
		const amendments = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		expect(amendments.entries[0].fields).toMatchObject({
			keys: ["hall", "lodge"],
			secondaryKeys: []
		})
	}, 60_000)
})
