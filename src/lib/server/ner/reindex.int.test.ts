/**
 * Moving the entity star, over a real database.
 *
 * Every annotation row was written by whichever extractor was in force when the
 * lane reached it, so pointing the star at a different model makes every stored
 * row an answer from a producer that is gone. The freshness triple cannot catch
 * that on its own — the extractor VERSION did not move, the text did not move
 * and the vocabulary did not move — so the star's own consequence has to: clear
 * the rows and let the lane rebuild them. That is the same shape
 * `applyEmbeddingStarChange` has, keyed the same way (on the model IDENTITY,
 * never on the connection id), and these assert the three answers that follow
 * from that key: a real switch rebuilds, the same model twice is free, and
 * unstarring keeps what is there.
 *
 * The last case is the one that earns the file: with a model starred, the spans
 * it produces have to reach `entry_annotations` **the way tier 1 and tier 2
 * rows do** — same table, same freshness triple, same keys — or the entity arm
 * would read a corpus the model never touched.
 *
 * ⚠ The model runtime is stubbed. Nothing here downloads weights or loads
 * `onnxruntime-node`; what is under test is the wiring, not transformers.js.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

/** What the stubbed runtime holds, and what it claims to find. */
let resident: string | null = null
const MODEL_PHRASE = "ashguard riders"

vi.mock("$lib/server/ner", () => ({
	loadNerModel: async (id: string) => {
		resident = id
	},
	unloadNerModel: () => {
		resident = null
	},
	setNerTtlMinutes: () => {},
	getLoadedNerModelId: () => resident,
	isNerModelReady: () => resident !== null,
	isNerModelLoading: () => false,
	/**
	 * A model that finds one lower-case phrase — the case tier two provably
	 * cannot see, so a row carrying it can only have come from here.
	 */
	extractNerSpans: async (text: string) => {
		const start = text.toLowerCase().indexOf(MODEL_PHRASE)
		if (start < 0) return []
		return [
			{
				text: text.slice(start, start + MODEL_PHRASE.length),
				label: "ORG",
				start,
				end: start + MODEL_PHRASE.length,
				score: 0.77
			}
		]
	}
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-ner-reindex-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	const { annotationLane } = await import("$lib/server/annotations/queue")
	annotationLane.stop()
	await releaseDataDir(dataDir)
})

let seq = 0

async function seedBook(content: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `nerstar-${seq++}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id })
		.returning()
	const rows = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook!.id,
					name: "The order",
					keys: "",
					content
				}
			])
		)
		.returning()
	return { lorebook: lorebook!, entry: rows[0]! }
}

async function nerConnection(model: string) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name: `Entities ${model}`,
			type: CONNECTION_TYPE.LOCAL_ONNX_NER,
			modality: "ner",
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	const [m] = await testDb
		.insert(schema.connectionModels)
		.values({
			connectionId: conn!.id,
			model,
			name: model
		})
		.returning()
	return Object.assign(conn!, { modelId: m.id })
}

async function star(
	connectionId: number | null,
	connectionModelId?: number | null
) {
	await testDb.delete(schema.connectionDefaults)
	let mid: number | null | undefined = connectionModelId
	if (connectionId != null && mid === undefined) {
		const [m] = await testDb
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.connectionId, connectionId))
			.limit(1)
		mid = m?.id ?? null
	}
	await testDb.insert(schema.connectionDefaults).values({
		input: "text",
		output: "entities",
		connectionId,
		connectionModelId: mid ?? null
	})
}

const annotationsOf = async (entryId: number) =>
	await testDb
		.select()
		.from(schema.entryAnnotations)
		.where(eq(schema.entryAnnotations.entryId, entryId))

describe("starring an entity model", () => {
	test("clears every annotation and rebuilds them through the lane", async () => {
		const { lorebook, entry } = await seedBook(
			"Oathbound riders of the ashguard riders company answer to Vell."
		)
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("$lib/server/annotations/queue")
		const { applyNerStarChange, currentNerModelId } = await import(
			"./reindex"
		)

		// A lexical pass first: this is the corpus a person already has.
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()
		const lexical = await annotationsOf(entry.id)
		expect(lexical.length).toBeGreaterThan(0)
		expect(lexical.some((r) => r.tier === "model")).toBe(false)

		// The star moves. `before` is read the way the handler reads it: ahead
		// of the write, because afterwards the old answer is gone.
		const before = await currentNerModelId(testDb)
		expect(before).toBeNull()
		const conn = await nerConnection("Xenova/bert-base-NER")
		await star(conn.id)

		const change = await applyNerStarChange(testDb, before)
		expect(change).toMatchObject({
			reannotated: true,
			modelId: "Xenova/bert-base-NER"
		})
		expect(change.cleared).toBeGreaterThan(0)

		// And the lane it restarted rebuilds them, this time with the model's
		// spans in the same table, under the same freshness triple.
		await settleAnnotationQueue()
		const rebuilt = await annotationsOf(entry.id)
		const fromModel = rebuilt.find((r) => r.tier === "model")
		expect(
			fromModel,
			"the model's spans never reached entry_annotations"
		).toBeTruthy()
		expect(fromModel!.entityKey).toBe("open:ashguard riders")
		expect(fromModel!.confidence).toBeCloseTo(0.77, 2)
		expect(fromModel!.mentions).toBe(1)
		expect(fromModel!.spans.length).toBe(1)
	}, 60_000)

	test("pressing the star again costs nothing", async () => {
		// It is a button, and people press it twice. Keyed on the model identity
		// rather than the connection id, so a second row naming the same model is
		// free too.
		const { entry } = await seedBook("Vell rode with the ashguard riders.")
		const { annotationLane, settleAnnotationQueue } = await import(
			"$lib/server/annotations/queue"
		)
		const { applyNerStarChange, currentNerModelId } = await import(
			"./reindex"
		)

		const conn = await nerConnection("Xenova/bert-base-NER")
		await star(conn.id)
		annotationLane.start()
		await settleAnnotationQueue()
		const before = await currentNerModelId(testDb)

		const second = await nerConnection("Xenova/bert-base-NER")
		await star(second.id)
		const change = await applyNerStarChange(testDb, before)

		expect(change.reannotated).toBe(false)
		expect(change.cleared).toBe(0)
		expect((await annotationsOf(entry.id)).length).toBeGreaterThan(0)
	}, 60_000)

	test("unstarring keeps the corpus it has", async () => {
		// Turning the model off is not a decision to throw work away: the rows
		// stay, the lane goes back to the lexical tiers, and re-starring the same
		// model costs nothing.
		const { entry } = await seedBook("Vell rode with the ashguard riders.")
		const { annotationLane, settleAnnotationQueue } = await import(
			"$lib/server/annotations/queue"
		)
		const { applyNerStarChange, currentNerModelId } = await import(
			"./reindex"
		)

		const conn = await nerConnection("Xenova/bert-base-NER")
		await star(conn.id)
		annotationLane.start()
		await settleAnnotationQueue()
		const before = await currentNerModelId(testDb)
		const had = await annotationsOf(entry.id)
		expect(had.length).toBeGreaterThan(0)

		await star(null)
		const change = await applyNerStarChange(testDb, before)
		expect(change).toMatchObject({
			reannotated: false,
			cleared: 0,
			modelId: null
		})
		expect((await annotationsOf(entry.id)).length).toBe(had.length)
	}, 60_000)
})

describe("the cost the confirmation quotes", () => {
	test("counts annotated ROWS, not the entities underneath them", async () => {
		// The number on the confirmation has to be one a person recognises: their
		// lore and their transcript. Quoting the entity rows would be a figure
		// several times larger describing nothing anybody can point at.
		const { nerReannotateCost } = await import("./reindex")
		const { annotateEntry, EMPTY_VOCABULARY } = await import(
			"$lib/server/annotations"
		)
		const { entry } = await seedBook(
			"I met Kaelen at Lowmarket with Vell, and Kaelen again."
		)
		await annotateEntry(testDb, entry.id, EMPTY_VOCABULARY)

		const mine = await annotationsOf(entry.id)
		expect(mine.length).toBeGreaterThan(1)

		const all = await testDb.select().from(schema.entryAnnotations)
		const parents = new Set(all.map((r) => r.entryId)).size
		const { rows } = await nerReannotateCost(testDb)
		expect(rows).toBe(parents)
		expect(rows).toBeLessThan(all.length)
	}, 60_000)
})
