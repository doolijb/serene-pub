/**
 * One scan per batch of candidates, not one per row — over a real database.
 *
 * The background pickers used to run a full-table scan (an unindexable text-hash
 * predicate) for every item, so draining N rows cost N scans. Now a scan fetches
 * up to `SCAN_BATCH_SIZE` (50) candidates into a buffer the lane drains, and the
 * embeds go out in chunks of 16. What must not move: the same rows, in the same
 * order, each embedded once, and a row that changed or was embedded meanwhile is
 * handled exactly as the one-row picker would have.
 *
 * Scans are counted at the db boundary: `db.select` is wrapped so a select from
 * `characters` whose `.limit` is the batch size counts as one scan (a by-id
 * revalidation limits to 1 and is not counted).
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { defaultLoadoutRow } from "$lib/server/loadouts/testing"

let testDb: TestDb
let dataDir: string
let userId: number

const MODEL = "test-batch-scan-model"
const SCAN_SIZE = 50

/** The inputs of every embed call, in order: a batch has many, a single has one. */
let singleCalls: string[] = []
let batchCalls: string[][] = []
let failNextSingle = false
let scans = 0
/** Runs once the scan with the given number has read its rows. */
let afterScan: {
	number: number
	run: (rows: { id: number }[]) => Promise<void>
} | null = null

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("./index", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./index")>()
	return {
		...actual,
		isModelReady: () => true,
		isModelLoading: () => false,
		getLoadedModelId: () => MODEL,
		getConfiguredModelId: async () => MODEL,
		getConfiguredEmbeddingTarget: async () => ({
			modelId: MODEL,
			mode: "local" as const,
			ttlMinutes: 11
		}),
		loadConfiguredEmbeddingModel: async () => {},
		embed: async (text: string) => {
			singleCalls.push(text)
			if (failNextSingle) {
				failNextSingle = false
				throw new Error("embed failed")
			}
			return [0.1, 0.2, 0.3]
		},
		batchEmbed: async (texts: string[]) => {
			batchCalls.push(texts)
			return texts.map(() => [0.4, 0.5, 0.6])
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-batch-scan-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb

	await testDb.insert(schema.systemSettings).values({ id: 1 })
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name: "Batch Scan Embeddings",
			modality: "embeddings",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	const [model] = await testDb
		.insert(schema.connectionModels)
		.values({ connectionId: conn.id, model: MODEL, name: MODEL })
		.returning()
	await testDb.insert(schema.loadouts).values(
		defaultLoadoutRow({
			input: "text",
			output: "embedding",
			connectionId: conn.id,
			connectionModelId: model.id
		})
	)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "batch-scan-user")).id

	// Count scans of `characters`: from → where → limit(SCAN_SIZE).
	const original = testDb.select.bind(testDb) as any
	vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
		const builder = original(...args)
		const from = builder.from.bind(builder)
		builder.from = (table: unknown) => {
			const q = from(table)
			if (table !== schema.characters) return q
			const where = q.where.bind(q)
			q.where = (w: unknown) => {
				const q2 = where(w)
				const limit = q2.limit.bind(q2)
				q2.limit = (n: number) => {
					if (n !== SCAN_SIZE) return limit(n)
					scans++
					const mine = scans
					const query = limit(n)
					const then = query.then.bind(query)
					query.then = (res: any, rej: any) =>
						then(async (rows: { id: number }[]) => {
							const hook = afterScan
							if (hook && hook.number === mine) {
								afterScan = null
								await hook.run(rows)
							}
							return rows
						}).then(res, rej)
					return query
				}
				return q2
			}
			return q
		}
		return builder
	}) as any)
}, 60_000)

afterAll(async () => {
	const { stopVectorization } = await import("./vectorizationQueue")
	stopVectorization()
	await releaseDataDir(dataDir)
})

beforeEach(async () => {
	await testDb.delete(schema.characters)
	singleCalls = []
	batchCalls = []
	failNextSingle = false
	scans = 0
	afterScan = null
})

async function makeCharacters(count: number, prefix = "Batch") {
	const rows = await testDb
		.insert(schema.characters)
		.values(
			Array.from({ length: count }, (_, i) => ({
				userId,
				name: `${prefix} ${i}`,
				description: `${prefix} description ${i}`
			}))
		)
		.returning()
	return rows.map((r) => r.id)
}

const pick = async () => {
	const { pickNextItem } = await import("./vectorizationQueue")
	return pickNextItem(MODEL)
}

async function drain() {
	const ids: number[] = []
	for (;;) {
		const item = await pick()
		if (!item) return ids
		ids.push(item.ref!.id)
		await item.process()
	}
}

async function vectorOf(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.characters)
		.where(eq(schema.characters.id, id))
	return row
}

describe("one scan per batch", () => {
	test("120 characters: ceil(120/50)+1 scans, each row once in scan order, embeds in chunks of 16", async () => {
		const ids = await makeCharacters(120)

		const drained = await drain()

		expect(scans).toBe(Math.ceil(120 / SCAN_SIZE) + 1)
		expect(drained).toEqual(ids)
		expect(singleCalls).toEqual([])
		// Chunks are cut per scan (50 → 16+16+16+2, 50 → …, 20 → 16+4), so
		// ceil(50/16)*2 + ceil(20/16) calls rather than ceil(120/16).
		expect(batchCalls.length).toBe(4 + 4 + 2)
		expect(batchCalls.flat().length).toBe(120)
		for (const id of ids) {
			expect((await vectorOf(id))?.embeddingModel).toBe(MODEL)
		}
		// Nothing left: a further pick finds nothing, once more.
		expect(await pick()).toBeNull()
	}, 60_000)

	test("an unprocessed head is handed straight back", async () => {
		const ids = await makeCharacters(3)
		const first = await pick()
		const again = await pick()
		expect(first!.ref!.id).toBe(ids[0])
		expect(again!.ref!.id).toBe(ids[0])
		await drain()
	}, 60_000)

	test("a row edited after the scan embeds its new text on its own", async () => {
		const ids = await makeCharacters(3, "Edit")
		const first = await pick()
		await first!.process()
		expect(batchCalls.length).toBe(1)

		await testDb
			.update(schema.characters)
			.set({ description: "A wholly new description" })
			.where(eq(schema.characters.id, ids[1]!))

		const drained = [first!.ref!.id, ...(await drain())]
		expect(drained).toEqual(ids)
		expect(singleCalls.length).toBe(1)
		expect(singleCalls[0]).toContain("A wholly new description")
		expect(batchCalls.length).toBe(1)
	}, 60_000)

	test("a row embedded meanwhile by a promotion is skipped", async () => {
		const ids = await makeCharacters(3, "Promo")
		const first = await pick()
		await first!.process()

		const { embeddingLane } = await import("./vectorizationQueue")
		const report = await embeddingLane.promote({
			refs: [{ source: "character", id: ids[1]! }]
		})
		expect(report.processed).toBe(1)
		const promotedCalls = singleCalls.length

		const drained = [first!.ref!.id, ...(await drain())]
		expect(drained).toEqual([ids[0], ids[2]])
		// The promoted row was not embedded a second time.
		expect(singleCalls.length).toBe(promotedCalls)
		expect(batchCalls.length).toBe(1)
	}, 60_000)

	test("a failing item is handed back first on the next pick", async () => {
		const ids = await makeCharacters(3, "Fail")
		const first = await pick()
		await first!.process()
		const second = await pick()
		expect(second!.ref!.id).toBe(ids[1])

		// Its chunk's vector is not used once the row's own embed is asked for
		// to fail: change the text so the item embeds singly, and make that fail.
		await testDb
			.update(schema.characters)
			.set({ description: "Changed so it embeds alone" })
			.where(eq(schema.characters.id, ids[1]!))
		failNextSingle = true
		const retry = await pick()
		await expect(retry!.process()).rejects.toThrow("embed failed")

		const next = await pick()
		expect(next!.ref!.id).toBe(ids[1])
		await drain()
	}, 60_000)
})

describe("scan buffers", () => {
	test("a group replaced in the lane leaves no buffer", async () => {
		const ids = await makeCharacters(3, "Group")
		const { embeddingLane, _scanBufferKeys } = await import(
			"./vectorizationQueue"
		)
		const spec = {
			label: "g",
			ownerDisplayName: "u",
			lorebookIds: [],
			characterIds: ids,
			personaIds: []
		}
		const first = embeddingLane.enqueueGroup(spec)
		expect((await pick())!.ref!.id).toBe(ids[0])
		expect(_scanBufferKeys()).toContain(`group:${first.groupId}`)

		const second = embeddingLane.enqueueGroup(
			spec,
			(g) => g.groupId === first.groupId
		)
		await pick()
		expect(_scanBufferKeys()).not.toContain(`group:${first.groupId}`)
		expect(_scanBufferKeys()).toContain(`group:${second.groupId}`)

		await drain()
		embeddingLane.removeGroup(second.groupId)
	}, 60_000)

	test("a refill whose rows are all embedded meanwhile does not end the run early", async () => {
		const a = await makeCharacters(2, "A")
		const first = await pick()
		expect(first!.ref!.id).toBe(a[0])
		const { embeddingLane } = await import("./vectorizationQueue")
		await embeddingLane.promote({
			refs: a.map((id) => ({ source: "character" as const, id }))
		})
		const b = await makeCharacters(2, "B")
		let c: number[] = []
		afterScan = {
			number: 2,
			run: async () => {
				// The refill's rows stop needing a vector before they are read.
				await testDb
					.delete(schema.characters)
					.where(inArray(schema.characters.id, b))
				c = await makeCharacters(2, "C")
			}
		}

		const drained = await drain()
		expect(drained).toEqual(c)
	}, 60_000)
})
