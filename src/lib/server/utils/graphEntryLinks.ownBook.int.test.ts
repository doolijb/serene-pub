/**
 * 🚧 A session's own-book link whose end is a lorebook entry: kept for that
 * session when the entry is on its line, each end named as the session reads it
 * (the lorebook's amendments on its line, the session's held ones included).
 * No other session of the lorebook sees it.
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
		path.join(os.tmpdir(), "serene-pub-vitest-graph-links-own-book-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const room = async (
	lorebookId: number,
	title: string,
	over: Record<string, unknown> = {}
) =>
	(
		await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: ++n,
				title,
				content: "…",
				...over
			})
			.returning()
	)[0]!

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const user = await createTestUser(db, `graph-links-own-book-${++n}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Harbour" })
		.returning()
	const docks = await room(book!.id, "The Docks")
	const quay = await room(book!.id, "The Quay")
	const session = async () => {
		const [s] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `S${++n}`,
				lorebookId: book!.id
			})
			.returning()
		const ownBook = await insertOwnBook(asDb(), {
			sessionId: s!.id,
			userId: user.id,
			name: null,
			overlayOf: book!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return { session: s!, ownBook }
	}
	return { book: book!, docks: docks, quay, session }
}

const link = (lorebookId: number, from: number, to: number) =>
	db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromEntryId: from,
			toEntryId: to,
			relationshipType: "leads to"
		})
		.returning()
		.then((r) => r[0]!)

describe("readGraphEntryLinks reads an own-book link that ends in a lorebook entry", () => {
	it("the session sees it, ends named as it reads them; another session and the lorebook's own reading do not", async () => {
		const { readGraphEntryLinks } = await import("./graphEntryLinks")
		const w = await world()
		const a = await w.session()
		const b = await w.session()
		const cellar = await room(a.ownBook.id, "The Cellar")
		const l = await link(a.ownBook.id, cellar.id, w.docks.id)
		const bare = await w.session() // a session whose own book has no links
		// A held change of the Docks' name in session A's own book.
		await db.insert(schema.entryAmendments).values({
			lorebookId: a.ownBook.id,
			entryId: w.docks.id,
			year: null,
			fields: { name: "The Burned Docks" },
			base: { name: { v: "The Docks" } },
			sourceMessageId: null
		})
		const seen = await readGraphEntryLinks(asDb(), a.session.id)
		expect(seen?.map((x) => x.id)).toEqual([l.id])
		expect(seen![0]!.from).toEqual({
			kind: "entry",
			id: cellar.id,
			name: "The Cellar"
		})
		expect(seen![0]!.to).toEqual({
			kind: "entry",
			id: w.docks.id,
			name: "The Burned Docks"
		})
		expect(
			(await readGraphEntryLinks(asDb(), b.session.id))!.map((x) => x.id)
		).toEqual([])
		expect(
			(await readGraphEntryLinks(asDb(), bare.session.id))!.map(
				(x) => x.id
			)
		).toEqual([])
	})

	it("a lorebook-to-lorebook link in the own book is kept; one the session reads as Off drops", async () => {
		const { readGraphEntryLinks } = await import("./graphEntryLinks")
		const w = await world()
		const a = await w.session()
		const l = await link(a.ownBook.id, w.docks.id, w.quay.id)
		expect(
			(await readGraphEntryLinks(asDb(), a.session.id))!.map((x) => x.id)
		).toEqual([l.id])
		await db.insert(schema.entryAmendments).values({
			lorebookId: a.ownBook.id,
			entryId: w.quay.id,
			year: null,
			fields: { enabled: false },
			base: { enabled: { v: true } },
			sourceMessageId: null
		})
		expect(
			(await readGraphEntryLinks(asDb(), a.session.id))!.map((x) => x.id)
		).toEqual([])
	})
})
