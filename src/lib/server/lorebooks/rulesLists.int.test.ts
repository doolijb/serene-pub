/**
 * A book's rules lists and its rules library (PLAN-lorebook-kinds §C): the
 * lists come from the rules the book is told by; another rules' entries are
 * not written to it; counts name only its own; the library offers the rules'
 * pieces for entryable lists; Edit a copy makes one entry, stamped, once.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-rules-lists-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const VIS = "core:ruleset/vis-itineris@1"
const WEAPONS = "core:entry/vis-itineris.weapons"
const THINGS = "core:entry/freeform.things"
let n = 0
const as = (id: number) => ({ user: { id, isAdmin: false } }) as any
const quiet = (() => {}) as any

async function owner() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `rules-lists-${++n}`)
}

async function book(userId: number, primaryRuleset?: string) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}`, ...(primaryRuleset ? { primaryRuleset } : {}) })
		.returning()
	return row
}

describe("entries:types", () => {
	test("a Freeform book's lists are Freeform's, with no library behind them", async () => {
		const { entryTypesHandler } = await import("$lib/server/sockets/entries")
		const me = await owner()
		const plain = await book(me.id)
		const res = await entryTypesHandler.handler(as(me.id), { lorebookId: plain.id }, quiet)
		expect(res.types.map((t) => t.typeId)).toEqual([
			"core:entry/freeform.things",
			"core:entry/freeform.conditions"
		])
		expect(res.types.every((t) => t.libraryRows === 0)).toBe(true)
		expect(res.rulesName).toBe("Freeform")
	})

	test("a Vis Itineris book's lists carry their labels and library counts", async () => {
		const { entryTypesHandler } = await import("$lib/server/sockets/entries")
		const me = await owner()
		const vis = await book(me.id, VIS)
		const res = await entryTypesHandler.handler(as(me.id), { lorebookId: vis.id }, quiet)
		const weapons = res.types.find((t) => t.typeId === WEAPONS)
		expect(weapons?.label).toBeTruthy()
		expect(weapons!.libraryRows).toBeGreaterThan(0)
		expect(res.types.find((t) => t.repertoireId === "creatures")?.libraryRows).toBe(0)
		expect(res.types.some((t) => t.repertoireId === "classes")).toBe(false)
		// What the workspace's rail heads the lists with.
		expect(res.rulesName).toBe("Vis Itineris")
	})
})

describe("writing and counting", () => {
	test("another rules' entry is not written to a book, and its own counts are", async () => {
		const { createEntryHandler, entryCountsHandler } = (await import(
			"$lib/server/sockets/entries"
		)) as any
		const me = await owner()
		const plain = await book(me.id)
		await expect(
			createEntryHandler.handler(
				as(me.id),
				{ entry: { lorebookId: plain.id, typeId: WEAPONS, name: "Club", content: "Heavy." } },
				quiet
			)
		).rejects.toThrow(/This book is told by Freeform/)
		const counts = await entryCountsHandler.handler(as(me.id), { lorebookId: plain.id }, quiet)
		expect(THINGS in counts.counts).toBe(true)
		expect(WEAPONS in counts.counts).toBe(false)
	})
})

describe("the rules library", () => {
	test("lists the pieces of entryable lists only, and nothing for Freeform", async () => {
		const { lorebooksLibraryHandler } = await import("$lib/server/sockets/lorebooks")
		const me = await owner()
		const vis = await book(me.id, VIS)
		const plain = await book(me.id)
		const lib = await lorebooksLibraryHandler.handler(as(me.id), { lorebookId: vis.id }, quiet)
		expect(lib.name).toBe("Vis Itineris library")
		expect(lib.rows.some((r) => r.typeId === WEAPONS && r.id === "club")).toBe(true)
		expect(lib.rows.some((r) => r.repertoireId === "classes")).toBe(false)
		const none = await lorebooksLibraryHandler.handler(as(me.id), { lorebookId: plain.id }, quiet)
		expect(none).toMatchObject({ name: null, rows: [] })
	})

	test("Edit a copy makes one stamped entry, and answers with it again", async () => {
		const { copyFromLibraryHandler } = await import("$lib/server/sockets/entries")
		const me = await owner()
		const vis = await book(me.id, VIS)
		const first = await copyFromLibraryHandler.handler(
			as(me.id),
			{ lorebookId: vis.id, typeId: WEAPONS, pieceId: "club" },
			quiet
		)
		expect(first.copied).toBe(true)
		expect(first.entry.name).toBe("Club")
		expect(first.entry.derivedFrom).toMatchObject({ compendium: VIS, piece: "club" })
		const again = await copyFromLibraryHandler.handler(
			as(me.id),
			{ lorebookId: vis.id, typeId: WEAPONS, pieceId: "club" },
			quiet
		)
		expect(again.copied).toBe(false)
		expect(again.entry.id).toBe(first.entry.id)
		const rows = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, vis.id))
		expect(rows).toHaveLength(1)
	})

	test("an unknown piece and someone else's book are refused", async () => {
		const { copyFromLibraryHandler } = await import("$lib/server/sockets/entries")
		const me = await owner()
		const stranger = await owner()
		const vis = await book(me.id, VIS)
		await expect(
			copyFromLibraryHandler.handler(
				as(me.id),
				{ lorebookId: vis.id, typeId: WEAPONS, pieceId: "no-such-thing" },
				quiet
			)
		).rejects.toThrow("That isn't in this book's rules library.")
		await expect(
			copyFromLibraryHandler.handler(
				as(stranger.id),
				{ lorebookId: vis.id, typeId: WEAPONS, pieceId: "club" },
				quiet
			)
		).rejects.toThrow()
	})

	test("a client cannot stamp a copy's origin through entries:create", async () => {
		const { createEntryHandler } = await import("$lib/server/sockets/entries")
		const me = await owner()
		const vis = await book(me.id, VIS)
		const made = await createEntryHandler.handler(
			as(me.id),
			{
				entry: {
					lorebookId: vis.id,
					typeId: "core:entry/world-lore",
					name: "A rumour",
					content: "Heard at the ferry.",
					derivedFrom: { compendium: VIS, piece: "club", version: "1" }
				} as any
			},
			quiet
		)
		expect(made.entry.derivedFrom ?? null).toBeNull()
	})
})
