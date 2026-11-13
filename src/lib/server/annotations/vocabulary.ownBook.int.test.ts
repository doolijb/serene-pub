/**
 * 🚧 A session that reads an attached lorebook through its own notes (its
 * "Session notes") answers to the notes' entries too: `loadVocabulary`'s
 * `holderBookId`. Named as amended on the notes, the notes first. Another
 * session of the same lorebook, and the lorebook's own reading, never hear them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-vocabulary-own-book-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const user = await createTestUser(db, `vocabulary-own-book-${++n}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Harbour" })
		.returning()
	const [lorebookEntry] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: "core:entry/location",
			typeVersion: 1,
			position: 0,
			title: "The Docks",
			content: "…"
		})
		.returning()
	const own = async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `S${++n}`,
				lorebookId: book!.id
			})
			.returning()
		const ownBook = await insertOwnBook(asDb(), {
			sessionId: session!.id,
			userId: user.id,
			name: null,
			overlayOf: book!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return { session: session!, ownBook }
	}
	return { user, book: book!, lorebookEntry: lorebookEntry!, own }
}

const entryIn = async (lorebookId: number, title: string) =>
	(
		await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: ++n,
				title,
				content: "…"
			})
			.returning()
	)[0]!

describe("loadVocabulary reads the holder's own book beside the lorebook", () => {
	it("the session gets its notes' entry name; another session and the lorebook's own reading do not", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const w = await world()
		const a = await w.own()
		const b = await w.own()
		const cellar = await entryIn(a.ownBook.id, "The Smugglers Cellar")
		const mine = await loadVocabulary(asDb(), w.book.id, {
			holderBookId: a.ownBook.id
		})
		expect(mine.gazetteer.byName.get("the smugglers cellar")).toEqual({
			kind: "entry",
			id: cellar.id
		})
		expect(mine.gazetteer.byName.get("the docks")).toEqual({
			kind: "entry",
			id: w.lorebookEntry.id
		})
		const other = await loadVocabulary(asDb(), w.book.id, {
			holderBookId: b.ownBook.id
		})
		expect(
			other.gazetteer.byName.get("the smugglers cellar")
		).toBeUndefined()
		const book = await loadVocabulary(asDb(), w.book.id)
		expect(
			book.gazetteer.byName.get("the smugglers cellar")
		).toBeUndefined()
		expect(mine.hash).not.toBe(book.hash)
		expect(other.hash).toBe(book.hash)
	})

	it("names the notes' entry as amended on the notes, and the notes' copy of a name wins", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const w = await world()
		const a = await w.own()
		const copy = await entryIn(a.ownBook.id, "The Docks")
		const cellar = await entryIn(a.ownBook.id, "The Cellar")
		await db.insert(schema.entryAmendments).values({
			lorebookId: a.ownBook.id,
			entryId: cellar.id,
			year: 10,
			fields: { name: "The Flooded Cellar" }
		})
		const { gazetteer } = await loadVocabulary(asDb(), w.book.id, {
			holderBookId: a.ownBook.id
		})
		expect(gazetteer.byName.get("the flooded cellar")).toEqual({
			kind: "entry",
			id: cellar.id
		})
		expect(gazetteer.byName.get("the docks")).toEqual({
			kind: "entry",
			id: copy.id
		})
	})

	it("a Full session (its own book passed as holder, as every call site does) reads its notes' entries too", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const w = await world()
		await db
			.insert(schema.userSettings)
			.values({ userId: w.user.id, loreWriteMode: "full" })
		const a = await w.own()
		const old = await entryIn(a.ownBook.id, "The Old Pier")
		const holder = (await sessionReadingOf(asDb(), a.session.id))
			?.holderBookId
		expect(holder).toBe(a.ownBook.id)
		const { gazetteer } = await loadVocabulary(asDb(), w.book.id, {
			holderBookId: holder
		})
		expect(gazetteer.byName.get("the old pier")).toEqual({
			kind: "entry",
			id: old.id
		})
	})
})
