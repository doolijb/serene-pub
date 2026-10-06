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

/**
 * NER modules a test serves by type, ahead of the real registry — which every
 * other type still goes through. Stands in for a registry entry without this
 * file importing the registry (`importBoundary.test.ts` enumerates who does).
 */
const fakes = vi.hoisted(() => new Map<string, unknown>())
vi.mock("$lib/server/utils/getNerAdapter", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("$lib/server/utils/getNerAdapter")>()
	return {
		getNerAdapter: async (type: string) =>
			(fakes.get(type) as any) ?? (await real.getNerAdapter(type))
	}
})

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
		// ⚠ The stamp, pinned. A star move clears every row whose
		// `entity_model` differs from the new identity, so a respelling for
		// local ONNX (a prefix, a connection id) would re-annotate every
		// install's whole corpus on the first restart after it shipped.
		expect(rebuilt.map((r) => r.entityModel)).toEqual(
			rebuilt.map(() => "Xenova/bert-base-NER")
		)
	}, 60_000)

	test("a local ONNX star resolves to the bare HuggingFace id", async () => {
		// The identity half of the pin above, read where the broker reads it.
		const { resolveNerTarget } = await import("./target")
		const conn = await nerConnection("Xenova/bert-base-NER")
		await star(conn.id)
		const target = await resolveNerTarget(testDb)
		expect(target).toMatchObject({
			connectionId: conn.id,
			type: CONNECTION_TYPE.LOCAL_ONNX_NER,
			modelId: "Xenova/bert-base-NER"
		})
		expect(target!.connection.model).toBe("Xenova/bert-base-NER")
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

	test("unstarring and re-starring the same model keeps the corpus", async () => {
		// The A10 fix, for the entity star: the rows carry the model that
		// annotated them, and that is what a star move is compared against —
		// not the star before the write, which after an unstar is nothing.
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
		const had = await annotationsOf(entry.id)
		expect(had.some((r) => r.tier === "model")).toBe(true)

		let before = await currentNerModelId(testDb)
		await star(null)
		await applyNerStarChange(testDb, before)
		before = await currentNerModelId(testDb)
		await star(conn.id)
		const change = await applyNerStarChange(testDb, before)

		expect(change).toMatchObject({ reannotated: false, cleared: 0 })
		const kept = await annotationsOf(entry.id)
		expect(kept.map((r) => [r.entityKey, r.annotatedAt])).toEqual(
			had.map((r) => [r.entityKey, r.annotatedAt])
		)
	}, 60_000)

	test("re-starring the model re-scans only what was annotated without it", async () => {
		const conn = await nerConnection("Xenova/bert-base-NER")
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("$lib/server/annotations/queue")
		const { applyNerStarChange, currentNerModelId } = await import(
			"./reindex"
		)
		const { annotateEntry, EMPTY_VOCABULARY } = await import(
			"$lib/server/annotations"
		)
		// A run still winding down from the last test would miss the group.
		await settleAnnotationQueue()
		await star(conn.id)
		const { lorebook: book, entry: withModel } = await seedBook(
			"Vell met the ashguard riders at dawn."
		)
		enqueueLorebookAnnotation(book.id, "Book")
		await settleAnnotationQueue()
		expect(
			(await annotationsOf(withModel.id)).some((r) => r.tier === "model")
		).toBe(true)
		let before = await currentNerModelId(testDb)
		await star(null)
		await applyNerStarChange(testDb, before)

		// Written while nothing was starred: the lexical tiers only.
		const { lorebook: lexicalBook, entry: lexical } = await seedBook(
			"Kaelen rode with the ashguard riders."
		)
		await annotateEntry(testDb, lexical.id, EMPTY_VOCABULARY, null)
		expect(
			(await annotationsOf(lexical.id)).some((r) => r.tier === "model")
		).toBe(false)
		const keptBefore = await annotationsOf(withModel.id)

		before = await currentNerModelId(testDb)
		await star(conn.id)
		const change = await applyNerStarChange(testDb, before)
		await settleAnnotationQueue()
		enqueueLorebookAnnotation(lexicalBook.id, "Lexical book")
		await settleAnnotationQueue()

		expect(change.reannotated).toBe(true)
		expect(change.cleared).toBeGreaterThan(0)
		expect(
			(await annotationsOf(withModel.id)).map((r) => r.annotatedAt)
		).toEqual(keptBefore.map((r) => r.annotatedAt))
		expect(
			(await annotationsOf(lexical.id)).some((r) => r.tier === "model")
		).toBe(true)
	}, 60_000)

	test("deleting the starred connection stops the lane, unloads the model and keeps the corpus", async () => {
		const { entry } = await seedBook("Vell rode with the ashguard riders.")
		const { annotationLane, settleAnnotationQueue } = await import(
			"$lib/server/annotations/queue"
		)
		const { withStarConsequences } = await import(
			"$lib/server/connections/starConsequences"
		)
		const conn = await nerConnection("Xenova/bert-base-NER")
		await star(conn.id)
		annotationLane.start()
		await settleAnnotationQueue()
		expect(resident).toBe("Xenova/bert-base-NER")
		const had = await annotationsOf(entry.id)
		const stop = vi.spyOn(annotationLane, "stop")

		// What `connections:delete` runs.
		await withStarConsequences(testDb, () =>
			testDb
				.delete(schema.connections)
				.where(eq(schema.connections.id, conn.id))
		)

		expect(stop).toHaveBeenCalled()
		expect(resident).toBeNull()
		expect((await annotationsOf(entry.id)).length).toBe(had.length)
		stop.mockRestore()
	}, 60_000)

	test("deleting the starred model does the same", async () => {
		const { annotationLane, settleAnnotationQueue } = await import(
			"$lib/server/annotations/queue"
		)
		const { withStarConsequences } = await import(
			"$lib/server/connections/starConsequences"
		)
		const conn = await nerConnection("Xenova/bert-base-NER")
		// Starred the way the handler stars it, so the lane restarts leasing
		// the model; then work to do, so it loads it.
		await withStarConsequences(testDb, () => star(conn.id))
		await seedBook("Kaelen rode with the ashguard riders.")
		annotationLane.start()
		await settleAnnotationQueue()
		expect(resident).toBe("Xenova/bert-base-NER")
		const stop = vi.spyOn(annotationLane, "stop")

		// What `connections:deleteModel` runs.
		await withStarConsequences(testDb, () =>
			testDb
				.delete(schema.connectionModels)
				.where(eq(schema.connectionModels.id, conn.modelId))
		)

		expect(stop).toHaveBeenCalled()
		expect(resident).toBeNull()
		stop.mockRestore()
	}, 60_000)
})

/**
 * The annotation lane reads entities through the starred type's ADAPTER — the
 * seam a NER type that does not run in this process (LLM-prompted entities, say)
 * will plug into. Served by type the way a registry entry would serve it, by a
 * module with no `residency`, because it has nothing to load.
 */
describe("the lane reads entities through the adapter", () => {
	test("a starred type's adapter is where the lane's model spans come from", async () => {
		const FAKE = "c0-int-test-ner"
		const PHRASE = "kestrel moor"
		const calls: Array<{ text: string; model?: string }> = []
		fakes.set(FAKE, {
			Adapter: class {
				constructor(public connection: any) {}
				async extractEntities(req: { text: string; model?: string }) {
					calls.push(req)
					const start = req.text.toLowerCase().indexOf(PHRASE)
					if (start < 0) return []
					return [
						{
							text: req.text.slice(start, start + PHRASE.length),
							label: "LOC",
							start,
							end: start + PHRASE.length,
							score: 0.42
						}
					]
				}
			},
			listModels: async () => ({ models: [] }),
			testConnection: async () => ({ ok: true })
		})
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("$lib/server/annotations/queue")
		const { applyNerStarChange, currentNerModelId } = await import(
			"./reindex"
		)
		await settleAnnotationQueue()
		try {
			const [conn] = await testDb
				.insert(schema.connections)
				.values({
					name: "Hosted entities",
					type: FAKE,
					modality: "ner",
					extraJson: {},
					capabilities: {}
				} as any)
				.returning()
			await testDb.insert(schema.connectionModels).values({
				connectionId: conn!.id,
				model: "hosted-ner-1",
				name: "hosted-ner-1"
			})
			const before = await currentNerModelId(testDb)
			await star(conn!.id)
			await applyNerStarChange(testDb, before)

			const { lorebook, entry } = await seedBook(
				"Riders crossed the kestrel moor at dusk."
			)
			enqueueLorebookAnnotation(lorebook.id, "Book")
			await settleAnnotationQueue()

			const rows = await annotationsOf(entry.id)
			const fromModel = rows.find((r) => r.tier === "model")
			expect(
				fromModel,
				"the adapter's spans never reached entry_annotations"
			).toBeTruthy()
			expect(fromModel!.entityKey).toBe("open:kestrel moor")
			expect(fromModel!.confidence).toBeCloseTo(0.42, 2)
			expect(rows.map((r) => r.entityModel)).toEqual(
				rows.map(() => "hosted-ner-1")
			)
			// Called with the leased model, on the row's own text.
			expect(
				calls.some(
					(c) => c.model === "hosted-ner-1" && c.text.includes(PHRASE)
				)
			).toBe(true)
			// And the in-process runtime was never asked to load anything:
			// a backend with no residency is leased as it stands.
			expect(resident).toBeNull()

			// The model's label rides on the model row, and only there…
			expect(fromModel!.entityLabel).toBe("LOC")
			for (const r of rows.filter((r) => r.tier !== "model"))
				expect(r.entityLabel).toBeNull()
			// …and is read back beside the keys.
			const { loadVocabulary, readEntryAnnotations } = await import(
				"$lib/server/annotations"
			)
			const index = await readEntryAnnotations(
				testDb as any,
				[entry.id],
				await loadVocabulary(testDb as any, lorebook.id)
			)
			expect(index.entityLabels.get(entry.id)).toEqual({
				"open:kestrel moor": "LOC"
			})
		} finally {
			const before = await currentNerModelId(testDb)
			await star(null)
			await applyNerStarChange(testDb, before)
			await settleAnnotationQueue()
			fakes.delete(FAKE)
		}
	}, 60_000)
})

/**
 * The live query window is read by the entity model too — when, and only when,
 * a lease on it holds. Never a load and never a wait: with nothing leased the
 * window is the lexical tiers' alone, exactly as before.
 */
describe("the query window", () => {
	test("is read by the leased adapter, and lexically without one", async () => {
		const FAKE = "c1-int-test-ner"
		const PHRASE = "kestrel moor"
		const calls: string[] = []
		fakes.set(FAKE, {
			Adapter: class {
				constructor(public connection: any) {}
				async extractEntities(req: { text: string }) {
					calls.push(req.text)
					const start = req.text.toLowerCase().indexOf(PHRASE)
					if (start < 0) return []
					return [
						{
							text: req.text.slice(start, start + PHRASE.length),
							label: "LOC",
							start,
							end: start + PHRASE.length,
							score: 0.42
						}
					]
				}
			},
			listModels: async () => ({ models: [] }),
			testConnection: async () => ({ ok: true })
		})
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("$lib/server/annotations/queue")
		const { applyNerStarChange, currentNerModelId } = await import(
			"./reindex"
		)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		await settleAnnotationQueue()
		try {
			const [conn] = await testDb
				.insert(schema.connections)
				.values({
					name: "Hosted entities, windowed",
					type: FAKE,
					modality: "ner",
					extraJson: {},
					capabilities: {}
				} as any)
				.returning()
			await testDb.insert(schema.connectionModels).values({
				connectionId: conn!.id,
				model: "hosted-ner-2",
				name: "hosted-ner-2"
			})
			const before = await currentNerModelId(testDb)
			await star(conn!.id)
			await applyNerStarChange(testDb, before)

			// The lane annotates the book, which is what takes the lease.
			const { lorebook, entry } = await seedBook(
				"Riders crossed the kestrel moor at dusk."
			)
			enqueueLorebookAnnotation(lorebook.id, "Book")
			await settleAnnotationQueue()

			const [session] = await testDb
				.insert(schema.sessions)
				.values({
					userId: lorebook.userId,
					isGroup: false,
					lorebookId: lorebook.id
				})
				.returning()
			const window = "At dusk they reached the kestrel moor."
			const node = {
				key: "entities",
				definitionId: "core:query/entity-search@1"
			} as any
			const ask = () =>
				createHost(testDb as any, { sessionId: session!.id }).read!(
					"entity_annotations",
					{
						sessionId: session!.id,
						entryIds: [entry.id],
						window,
						maxMessages: 0
					},
					node
				) as Promise<any>

			const read = await ask()
			expect(calls).toContain(window)
			// Lower case, so only the model can have named it.
			expect(read.entities).toContainEqual(
				expect.objectContaining({
					key: "open:kestrel moor",
					tier: "model",
					label: "LOC"
				})
			)
			expect(read.entries).toEqual([
				expect.objectContaining({
					id: entry.id,
					entityLabels: { "open:kestrel moor": "LOC" }
				})
			])

			// No star: nothing is asked, and the window is read lexically.
			const starred = await currentNerModelId(testDb)
			await star(null)
			await applyNerStarChange(testDb, starred)
			calls.length = 0
			const lexical = await ask()
			expect(calls).not.toContain(window)
			expect(
				lexical.entities.some((e: any) => e.key === "open:kestrel moor")
			).toBe(false)
		} finally {
			const before = await currentNerModelId(testDb)
			await star(null)
			await applyNerStarChange(testDb, before)
			await settleAnnotationQueue()
			fakes.delete(FAKE)
		}
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
