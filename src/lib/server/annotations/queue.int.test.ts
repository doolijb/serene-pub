/**
 * The annotation lane, over a real database and with **no model starred**.
 *
 * This is the half of the ruling that the embedding queue could not have
 * hosted. Its loop opened with `if (!candidateModel) break`, before any picker
 * ran, so a lane whose work needs nothing loaded could not exist inside it — and
 * the entity extractor is dictionary-based on purpose, so that the zero-setup
 * install keeps matching names with nothing downloaded and nothing configured.
 *
 * ⚠ The lane CAN have a model now — a starred `text->entities` connection, tier
 * zero — which makes this file's subject sharper rather than obsolete: with
 * nothing starred it must behave exactly as it did when it could not have one.
 * Both runtimes below refuse to load anything, so a model requirement leaking
 * back into the shared primitives stops indexing here and says so, rather than
 * silently becoming a feature that needs a download.
 *
 * The second subject is staleness. Annotations are derived data over mutable
 * rows and their freshness is a triple — `(extractorVersion, sourceHash,
 * gazetteerHash)` — all of it compared in SQL, the content hash against the
 * row's GENERATED text hash; a rewrite of the content and a *rename somewhere
 * else in the book* both have to bring a row back round, a write beside the
 * text must not, and only a database can show that they do.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// No embedding model, no configured model, nothing loadable. The lane's whole
// claim is that none of this matters to it.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	isModelLoading: () => false,
	getLoadedModelId: () => null,
	getConfiguredModelId: async () => null,
	loadConfiguredEmbeddingModel: async () => {
		throw new Error("the annotation lane must never ask for a model")
	}
}))

// And no entity model. Nothing in this file stars one, so nothing may ask for
// one: the lexical tiers are what every case below is about, and a load here
// would mean the lane had started requiring what it is supposed to merely
// prefer.
vi.mock("$lib/server/ner", () => ({
	loadNerModel: async () => {
		throw new Error(
			"the annotation lane must never ask for a model without a star"
		)
	},
	unloadNerModel: () => {},
	setNerTtlMinutes: () => {},
	getLoadedNerModelId: () => null,
	isNerModelReady: () => false,
	isNerModelLoading: () => false,
	extractNerSpans: async () => {
		throw new Error(
			"the annotation lane must never extract with a model it did not lease"
		)
	}
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-annotation-lane-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	const { annotationLane } = await import("./queue")
	annotationLane.stop()
	await releaseDataDir(dataDir)
})

let bookSeq = 0

async function makeBook(entries: Array<{ name: string; content: string }>) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `annlane-${bookSeq++}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${bookSeq}`, userId: user.id })
		.returning()
	const rows = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues(
				entries.map((e) => ({
					lorebookId: lorebook!.id,
					name: e.name,
					keys: "",
					content: e.content
				}))
			)
		)
		.returning()
	return { user, lorebook: lorebook!, entries: rows }
}

const annotationsOf = async (entryId: number) =>
	await testDb
		.select()
		.from(schema.entryAnnotations)
		.where(eq(schema.entryAnnotations.entryId, entryId))

describe("a lane with no model starred indexes anyway", () => {
	test("declares which model it would load, and an admin surface can read that", async () => {
		const { annotationLane } = await import("./queue")
		const { DEFAULT_NER_TTL_MINUTES } = await import(
			"$lib/shared/constants/ner"
		)
		expect(annotationLane.declaration).toEqual({
			key: "annotation",
			label: "annotation",
			// ⚠ The ROLE is what this lane's model WOULD be, not whether one is
			// configured — that is the broker's `peek`, and it answers "none"
			// here. A role that flipped to null with nothing starred would make
			// the lane's identity depend on a setting, and an admin surface
			// enumerating the lanes could not say what this one is for.
			model: { role: "ner", ttlMinutes: DEFAULT_NER_TTL_MINUTES }
		})
	})

	test("asks for no model at all while nothing is starred", async () => {
		// The assertion the runtime mocks above make: both would throw. This is
		// the zero-setup guarantee stated as a test rather than as a comment.
		await import("./queue")
		const { nerBroker } = await import("$lib/server/ner/broker")
		expect(await nerBroker.peek()).toEqual({ kind: "none" })
		expect(await nerBroker.request({ wait: true })).toEqual({
			kind: "none",
			modelId: null
		})
	}, 60_000)

	test("annotates a book the background sweep has never seen", async () => {
		const { lorebook, entries } = await makeBook([
			{
				name: "The Ashguard Riders",
				content: "Oathbound riders who answer to Commander Vell."
			}
		])
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("./queue")

		expect(await annotationsOf(entries[0]!.id)).toEqual([])

		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		const rows = await annotationsOf(entries[0]!.id)
		expect(rows.length).toBeGreaterThan(0)
		// The entry names itself, which is the gazetteer resolving a title.
		expect(rows.map((r) => r.entityKey)).toContain(
			`entry:${entries[0]!.id}`
		)
	}, 60_000)

	test("re-annotates a row whose content moved under it", async () => {
		const { lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." },
			{
				name: "The Hedge Road",
				content: "The old track that runs past Stonefast."
			}
		])
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		const hedgeId = entries[1]!.id
		const before = (await annotationsOf(hedgeId)).map((r) => r.entityKey)
		expect(before).toContain(`entry:${entries[0]!.id}`)

		// The road stops mentioning the keep. A stale annotation would keep
		// justifying a hit with a sentence the text no longer contains, which is
		// the silent wrongness the triple exists to prevent.
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "The old track that runs past nothing at all." })
			.where(eq(schema.lorebookEntries.id, hedgeId))

		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		const after = (await annotationsOf(hedgeId)).map((r) => r.entityKey)
		expect(after).not.toContain(`entry:${entries[0]!.id}`)
	}, 60_000)

	test("re-annotates a whole book when a name elsewhere in it changes", async () => {
		const { lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." }
		])
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		const first = await annotationsOf(entries[0]!.id)
		expect(first.length).toBeGreaterThan(0)
		const firstHash = first[0]!.gazetteerHash

		/**
		 * A second entry changes the *vocabulary*, not the first entry's text.
		 * `sourceHash` alone would call the first entry fresh; `gazetteerHash`
		 * is what notices, and it is why extraction being a dictionary lookup
		 * makes renaming a load-bearing event.
		 */
		await testDb.insert(schema.lorebookEntries).values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "Commander Vell",
					keys: "",
					content: "She holds Stonefast for the crown."
				}
			])
		)

		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		const second = await annotationsOf(entries[0]!.id)
		expect(second.length).toBeGreaterThan(0)
		expect(second[0]!.gazetteerHash).not.toBe(firstHash)
	}, 60_000)

	test("stops handing back a row it has already indexed", async () => {
		const { lorebook, entries } = await makeBook([
			{ name: "Quiet Entry", content: "Nothing here names anything." }
		])
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		/**
		 * ⚠ The busy-loop this guards.
		 *
		 * The picker compares the row's stored `source_hash` with the entry's
		 * GENERATED text hash, so a unit of work that stamped any other hash
		 * would leave the predicate true and be handed the same row for ever —
		 * which is why the lane's unit of work stamps the column it read with
		 * the text.
		 *
		 * The entry names only itself, through its own title: `buildGazetteer`
		 * carries entry titles, and `entryAnnotationText` hands the extractor
		 * the title along with the body.
		 */
		const rows = await annotationsOf(entries[0]!.id)
		expect(rows.map((r) => r.entityKey)).toEqual([
			`entry:${entries[0]!.id}`
		])

		const at = rows[0]!.annotatedAt
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()

		const again = await annotationsOf(entries[0]!.id)
		expect(again.length).toBe(1)
		// Fresh: not rewritten, and — the part that matters — the lane went idle
		// rather than spinning on it.
		expect(again[0]!.annotatedAt).toEqual(at)
	}, 60_000)
})

describe("promotion on the annotation lane", () => {
	test("indexes the entries a query scoped, and reports that it covered them", async () => {
		const { lorebook, entries } = await makeBook([
			{ name: "The Sluice Gate", content: "Where the ash wastes drain." },
			{
				name: "The Ember Tide",
				content: "It comes past the Sluice Gate."
			}
		])
		const { promoteEntryAnnotations } = await import("./queue")
		const { loadVocabulary } = await import("./index")
		const vocabulary = await loadVocabulary(testDb as any, lorebook.id)

		const report = await promoteEntryAnnotations(
			entries.map((e) => e.id),
			vocabulary,
			lorebook.id
		)

		expect(report.requested).toBe(2)
		expect(report.processed).toBe(2)
		expect(report.remaining).toBe(0)
		expect(report.boundHit).toBe(false)
		for (const entry of entries)
			expect((await annotationsOf(entry.id)).length).toBeGreaterThan(0)
	}, 60_000)

	test("stops at the bound and leaves the rest to the queue", async () => {
		const { lorebook, entries } = await makeBook(
			Array.from({ length: 5 }, (_, i) => ({
				name: `Entry ${i}`,
				content: `Body ${i}`
			}))
		)
		const { promoteEntryAnnotations, settleAnnotationQueue } = await import(
			"./queue"
		)
		const { loadVocabulary } = await import("./index")
		const vocabulary = await loadVocabulary(testDb as any, lorebook.id)

		const report = await promoteEntryAnnotations(
			entries.map((e) => e.id),
			vocabulary,
			lorebook.id,
			{ maxItems: 2 }
		)

		expect(report.processed).toBe(2)
		expect(report.remaining).toBe(3)
		expect(report.boundHit).toBe(true)

		// Promoted into the queue rather than run beside it, so the remainder is
		// the background sweep's and arrives without another turn asking.
		await settleAnnotationQueue()
		for (const entry of entries)
			expect(
				(await annotationsOf(entry.id)).length,
				`entry ${entry.id} was never picked up in the background`
			).toBeGreaterThan(0)
	}, 60_000)

	test("annotates a session with no lorebook at all, against the empty vocabulary", async () => {
		/**
		 * ⚠ The regression this pins.
		 *
		 * An install with no lorebook on the session gets `EMPTY_VOCABULARY`,
		 * and that is a working state: both sides of the entity arm fall to the
		 * open tier and their keys still agree. A promotion that refused to run
		 * without a lorebook id would take the arm's whole entry half away from
		 * precisely the install that has configured least.
		 */
		const { lorebook, entries } = await makeBook([
			{ name: "Orphan", content: "The Gate stands open." }
		])
		const { promoteEntryAnnotations } = await import("./queue")
		const { EMPTY_VOCABULARY } = await import("./index")
		expect(lorebook.id).toBeGreaterThan(0)

		const report = await promoteEntryAnnotations(
			[entries[0]!.id],
			EMPTY_VOCABULARY,
			null
		)

		expect(report.processed).toBe(1)
		const rows = await annotationsOf(entries[0]!.id)
		expect(rows.length).toBeGreaterThan(0)
		expect(rows[0]!.gazetteerHash).toBe(EMPTY_VOCABULARY.hash)
	}, 60_000)

	test("reports rather than hangs when there is nothing it can index", async () => {
		const { promoteEntryAnnotations } = await import("./queue")
		const { EMPTY_VOCABULARY } = await import("./index")

		const started = Date.now()
		const report = await promoteEntryAnnotations(
			[],
			EMPTY_VOCABULARY,
			null,
			{ timeoutMs: 30_000 }
		)
		expect(Date.now() - started).toBeLessThan(5_000)
		expect(report.requested).toBe(0)
		expect(report.reason).toMatch(/already covered/)
	}, 60_000)
})

/**
 * Plan A23(a): staleness is the text the lane reads, never a clock.
 *
 * A timestamp rule (`annotated_at >= updated_at`) re-annotates on every write,
 * because every write moves `updated_at`: a mark, a reorder or a hidden message
 * costs a model lease and a model call when an entity model is starred, for
 * text that did not change. It misses a write that pins `updated_at`. And its
 * two sides come from two clocks — the database's `now()` and the app's
 * `new Date()`. The embedding lane's rule (A9) has none of these: compare the
 * hash of the text the row would be read from now.
 */
describe("staleness is the text, not the clock", () => {
	async function makeSession(lorebookId: number, userId: number) {
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId, isGroup: false, lorebookId })
			.returning()
		return session!
	}

	/** A message in both worlds: the annotation's foreign key is on `messages`. */
	async function addMessage(
		sessionId: number,
		content: string,
		extra: Partial<typeof schema.sessionMessages.$inferInsert> = {}
	) {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "assistant", content, ...extra })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({ id: legacy!.id, sessionId, role: "assistant" })
		return legacy!
	}

	const messageAnnotationsOf = async (messageId: number) =>
		await testDb
			.select()
			.from(schema.messageAnnotations)
			.where(eq(schema.messageAnnotations.messageId, messageId))

	test("a write that leaves an entry's text alone re-annotates nothing", async () => {
		const { lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." }
		])
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()
		const before = await annotationsOf(entries[0]!.id)
		expect(before.length).toBeGreaterThan(0)

		// A reorder: `updated_at` moves (drizzle's `$onUpdate`), the text does not.
		await testDb
			.update(schema.lorebookEntries)
			.set({ position: 99 })
			.where(eq(schema.lorebookEntries.id, entries[0]!.id))

		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()
		const after = await annotationsOf(entries[0]!.id)
		expect(after.map((r) => r.annotatedAt)).toEqual(
			before.map((r) => r.annotatedAt)
		)
	}, 60_000)

	test("a text change that leaves updated_at where it was is still re-annotated", async () => {
		const { lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." },
			{
				name: "The Hedge Road",
				content: "The old track that runs past Stonefast."
			}
		])
		const { enqueueLorebookAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()
		const hedgeId = entries[1]!.id
		expect(
			(await annotationsOf(hedgeId)).map((r) => r.entityKey)
		).toContain(`entry:${entries[0]!.id}`)

		// A statement that pins `updated_at` — a repair migration's shape. The
		// text moved, so the annotation is not about it any more.
		await testDb
			.update(schema.lorebookEntries)
			.set({
				content: "The old track that runs past nothing at all.",
				updatedAt: sql`${schema.lorebookEntries.updatedAt}`
			})
			.where(eq(schema.lorebookEntries.id, hedgeId))

		enqueueLorebookAnnotation(lorebook.id, "Book")
		await settleAnnotationQueue()
		expect(
			(await annotationsOf(hedgeId)).map((r) => r.entityKey)
		).not.toContain(`entry:${entries[0]!.id}`)
	}, 60_000)

	test("a message whose text did not move is not annotated again", async () => {
		const { user, lorebook } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." }
		])
		const session = await makeSession(lorebook.id, user.id)
		const message = await addMessage(
			session.id,
			"They rode for Stonefast before the snow."
		)
		const { enqueueSessionAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueSessionAnnotation(session.id, lorebook.id, "Session")
		await settleAnnotationQueue()
		const before = await messageAnnotationsOf(message.id)
		expect(before.length).toBeGreaterThan(0)

		// Hiding a message moves its `updated_at` and nothing it says.
		await testDb
			.update(schema.sessionMessages)
			.set({ isHidden: true })
			.where(eq(schema.sessionMessages.id, message.id))

		enqueueSessionAnnotation(session.id, lorebook.id, "Session")
		await settleAnnotationQueue()
		const after = await messageAnnotationsOf(message.id)
		expect(after.map((r) => r.annotatedAt)).toEqual(
			before.map((r) => r.annotatedAt)
		)
	}, 60_000)

	test("a reply still generating is not annotated until it settles", async () => {
		// Its text moves with every chunk the stream persists, so an annotation
		// of it is stale on the next chunk and the lane would take it again —
		// an entity-model call per chunk, none of them kept.
		const { user, lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." }
		])
		const session = await makeSession(lorebook.id, user.id)
		const streaming = await addMessage(session.id, "They rode for Stone", {
			isGenerating: true
		})
		const { enqueueSessionAnnotation, settleAnnotationQueue } =
			await import("./queue")
		enqueueSessionAnnotation(session.id, lorebook.id, "Session")
		await settleAnnotationQueue()
		expect(await messageAnnotationsOf(streaming.id)).toEqual([])

		await testDb
			.update(schema.sessionMessages)
			.set({
				content: "They rode for Stonefast before the snow.",
				isGenerating: false
			})
			.where(eq(schema.sessionMessages.id, streaming.id))
		enqueueSessionAnnotation(session.id, lorebook.id, "Session")
		await settleAnnotationQueue()
		expect(
			(await messageAnnotationsOf(streaming.id)).map((r) => r.entityKey)
		).toContain(`entry:${entries[0]!.id}`)
	}, 60_000)

	test("a text longer than the extractor's cut is annotated once, and the lane goes idle", async () => {
		// The stamped hash covers the whole text and the extractor reads the
		// first `MAX_ANNOTATED_LENGTH` characters. JavaScript cuts UTF-16 units
		// and Postgres cuts characters, so a hash of the cut could never meet
		// the column over a long text of emoji — and the picker would take the
		// row for ever.
		const long = "🐉".repeat(12_000) + " Stonefast past the cut."
		const { user, lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." },
			{ name: "The Long Scroll", content: long }
		])
		const session = await makeSession(lorebook.id, user.id)
		const message = await addMessage(session.id, long)
		const {
			enqueueLorebookAnnotation,
			enqueueSessionAnnotation,
			settleAnnotationQueue
		} = await import("./queue")
		enqueueLorebookAnnotation(lorebook.id, "Book")
		enqueueSessionAnnotation(session.id, lorebook.id, "Session")
		await settleAnnotationQueue()
		const entryRows = await annotationsOf(entries[1]!.id)
		const messageRows = await messageAnnotationsOf(message.id)
		expect(entryRows.length).toBeGreaterThan(0)
		expect(messageRows.length).toBeGreaterThan(0)

		enqueueLorebookAnnotation(lorebook.id, "Book")
		enqueueSessionAnnotation(session.id, lorebook.id, "Session")
		await settleAnnotationQueue()
		expect(
			(await annotationsOf(entries[1]!.id)).map((r) => r.annotatedAt)
		).toEqual(entryRows.map((r) => r.annotatedAt))
		expect(
			(await messageAnnotationsOf(message.id)).map((r) => r.annotatedAt)
		).toEqual(messageRows.map((r) => r.annotatedAt))
	}, 60_000)

	test("the entity arm's read refuses an entry annotation whose text moved", async () => {
		// `readEntryAnnotations` promised the freshness triple and checked two
		// thirds of it: a bounded promotion that left an edited entry behind
		// handed the arm keys the text no longer names.
		const { lorebook, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." },
			{
				name: "The Hedge Road",
				content: "The old track that runs past Stonefast."
			}
		])
		const { annotateLorebook, loadVocabulary, readEntryAnnotations } =
			await import("./index")
		await annotateLorebook(testDb as any, lorebook.id)
		const vocabulary = await loadVocabulary(testDb as any, lorebook.id)
		const hedgeId = entries[1]!.id
		expect(
			(
				await readEntryAnnotations(testDb as any, [hedgeId], vocabulary)
			).get(hedgeId)
		).toContain(`entry:${entries[0]!.id}`)

		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "The old track that runs past nothing at all." })
			.where(eq(schema.lorebookEntries.id, hedgeId))

		const index = await readEntryAnnotations(
			testDb as any,
			[hedgeId],
			vocabulary
		)
		expect(index.has(hedgeId)).toBe(false)
	}, 60_000)
})

describe("the background sweep", () => {
	test("leaves the books of a deleted account alone", async () => {
		const { user, entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." }
		])
		await testDb
			.update(schema.users)
			.set({ isDeleted: true })
			.where(eq(schema.users.id, user.id))

		const { annotationLane, settleAnnotationQueue } = await import(
			"./queue"
		)
		annotationLane.start()
		await settleAnnotationQueue()
		expect(await annotationsOf(entries[0]!.id)).toEqual([])
	}, 60_000)

	test("still reaches a live account's book nobody enqueued", async () => {
		const { entries } = await makeBook([
			{ name: "Stonefast", content: "A keep on the northern ridge." }
		])
		const { annotationLane, settleAnnotationQueue } = await import(
			"./queue"
		)
		annotationLane.start()
		await settleAnnotationQueue()
		expect((await annotationsOf(entries[0]!.id)).length).toBeGreaterThan(0)
	}, 60_000)
})
