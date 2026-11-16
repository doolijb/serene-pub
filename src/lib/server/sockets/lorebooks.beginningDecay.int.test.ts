/**
 * An entry's Beginning and decay rate travel: duplicate, a lorebook file out and
 * back in, and a starter-kit copy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lb-beginning-decay-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const as = (id: number) => ({ user: { id }, io: {} }) as any
const quiet = (async () => {}) as any

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `bd-${++n}`)
}

/** A book with a Living entry that began at Year 5 Mo. 2 and an undated Fact entry. */
async function seed(userId: number, over: Record<string, unknown> = {}) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${++n}`, userId, ...over })
		.returning()
	const add = async (
		position: number,
		name: string,
		extra: Record<string, unknown>
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId: WORLD_LORE_TYPE_ID,
						lorebookId: book!.id,
						position,
						name,
						content: `${name}.`,
						keys: name.toLowerCase(),
						...extra
					} as any)
				)
				.returning()
		)[0]!
	await add(0, "Living", { decayRate: 0.4, year: 5, month: 2 })
	await add(1, "Fact", {})
	return book!
}

const rowsOf = async (lorebookId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	).sort((a, b) => a.position - b.position)

const shapeOf = (r: typeof schema.lorebookEntries.$inferSelect) => ({
	title: r.title,
	decayRate: r.decayRate,
	year: (r.fields as any)?.year ?? null,
	month: (r.fields as any)?.month ?? null,
	day: (r.fields as any)?.day ?? null
})

const LIVING = { title: "Living", decayRate: 0.4, year: 5, month: 2, day: null }
const FACT = { title: "Fact", decayRate: 0, year: null, month: null, day: null }

async function exported(id: number, userId: number) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { specBookWithGraph } = await buildLorebookExportData(id, userId, {})
	return JSON.parse(JSON.stringify(specBookWithGraph)) as any
}

async function importFile(userId: number, file: unknown) {
	const { lorebookImportHandler } = await import("./lorebooks")
	const res = await lorebookImportHandler.handler(
		as(userId),
		{ lorebookJson: JSON.stringify(file) },
		quiet
	)
	return res.lorebook!.id as number
}

describe("duplicate", () => {
	test("keeps every entry's Beginning and decay rate", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const me = await person()
		const book = await seed(me.id)
		const res = await lorebooksDuplicateHandler.handler(
			as(me.id),
			{ lorebookId: book.id },
			quiet
		)
		const copy = await rowsOf((res as any).lorebook.id)
		expect(copy.map(shapeOf)).toEqual([LIVING, FACT])
	})
})

describe("export and import", () => {
	test("the file carries the values only when set, and they come back", async () => {
		const me = await person()
		const other = await person()
		const book = await seed(me.id)
		const file = await exported(book.id, me.id)
		const bags = file.entries.map((e: any) => e.extensions.serenepub)
		const living = bags.find((b: any) => b.year === 5)
		expect(living).toMatchObject({ year: 5, month: 2, decayRate: 0.4 })
		expect("day" in living).toBe(false)
		const fact = file.entries.find((e: any) => e.name === "Fact").extensions
			.serenepub
		for (const key of ["year", "month", "day", "decayRate"])
			expect(key in fact).toBe(false)

		const id = await importFile(other.id, file)
		expect((await rowsOf(id)).map(shapeOf)).toEqual([LIVING, FACT])
	})

	test("a rate over 1 imports at 1, a non-number at 0, a day with no month imports Perpetual", async () => {
		const me = await person()
		const other = await person()
		const file = await exported((await seed(me.id)).id, me.id)
		const bag = (name: string) =>
			file.entries.find((e: any) => e.name === name).extensions.serenepub
		Object.assign(bag("Living"), { decayRate: 7 })
		Object.assign(bag("Fact"), { decayRate: "x", day: 3 })
		const rows = await rowsOf(await importFile(other.id, file))
		expect(shapeOf(rows[0]!)).toEqual({ ...LIVING, decayRate: 1 })
		expect(shapeOf(rows[1]!)).toEqual(FACT)
	})
})

describe("a starter-kit copy", () => {
	test("keeps both", async () => {
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const me = await person()
		const kit = await seed(me.id, { kind: "starter_kit" })
		const res = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "From kit", starterKit: { lorebookId: kit.id } } as any,
			quiet
		)
		expect((await rowsOf(res.lorebook!.id)).map(shapeOf)).toEqual([
			LIVING,
			FACT
		])
	})
})
