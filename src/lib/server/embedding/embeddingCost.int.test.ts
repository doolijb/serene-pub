/**
 * What a write costs in embed calls — counted, not inferred (plan A9 + A10).
 *
 * Paid embedding services are meant to be used; what must not happen is paying
 * twice for the same text. So every case here drains the embedding queue's own
 * picker and counts the `embed()` calls it makes:
 *
 *  · **A9 — staleness is the embedded text, not `updated_at`.** A mark, an
 *    archive, a drag reorder, a keys or fields edit, the siblings `iterateNext`
 *    shifts, and a graph build's `graphed` flag all move `updated_at` and none
 *    of them changes what the default space embeds — so none of them may cost a
 *    call. A content or title edit must still cost exactly one.
 *  · **A10 — the star.** Unstarring and re-starring the same model keeps the
 *    index; a different model clears it and re-embeds. Deleting the starred
 *    connection (or its starred model) stops the queue and unloads the model.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import {
	DEFAULT_VECTOR_NAME,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	mergeFields
} from "$lib/server/utils/lorebookEntries"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	// `...actual`: `connections.ts` reaches modules that read other exports of
	// `$lib/server/db` at module scope.
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/** Every text handed to the embedding model, in order. */
const embedded: string[] = []
/** What the backend reports as loaded — the write guard compares against it. */
let loaded: string | null = "test-model"
const unloads: string[] = []
/** Runs once, inside the next `embed()` — a write landing while one is in flight. */
let duringNextEmbed: (() => Promise<void>) | null = null
vi.mock("$lib/server/embedding/index", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		embed: async (text: string) => {
			embedded.push(text)
			const during = duringNextEmbed
			duringNextEmbed = null
			if (during) await during()
			return [1, 0, 0]
		},
		getLoadedModelId: () => loaded,
		// As the real one does: nothing is resident afterwards.
		unloadEmbeddingModel: (reason?: string) => {
			loaded = null
			unloads.push(reason ?? "(no reason)")
		}
	}
})

/**
 * The queue's control verbs, recorded; the pickers stay real.
 *
 * `startVectorizationQueue` is recorded instead of run, so no background pass
 * embeds behind a count — the test drains the picker itself.
 */
/** An Ollama host that deletes whatever it is asked to — `ollama:deleteModel`. */
vi.mock("ollama", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		Ollama: class {
			async delete() {
				return { status: "success" }
			}
		}
	}
})

const queueCalls: string[] = []
vi.mock("$lib/server/embedding/vectorizationQueue", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		stopVectorization: () => {
			queueCalls.push("stop")
			actual.stopVectorization()
		},
		startVectorizationQueue: async (opts?: any) => {
			queueCalls.push(
				`start:${opts?.startFromBeginning ? "beginning" : "resume"}`
			)
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-embedding-cost-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// `connections:*` answer with `systemSettings:get`, which needs the row.
	await testDb.insert(schema.systemSettings).values({ id: 1 } as any)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noop = () => {}
const userSocket = (id: number) => ({ user: { id } }) as any
const adminSocket = { user: { id: 1, isAdmin: true } } as any

/**
 * Run the queue's picker to exhaustion under `model` and return what it
 * embedded, as `source:id`. Bounded, so a write guard that never lands fails
 * the test instead of hanging it.
 */
async function drain(model: string): Promise<string[]> {
	const { pickNextItem } = await import("./vectorizationQueue")
	loaded = model
	const done: string[] = []
	for (let i = 0; i < 100; i++) {
		const item = await pickNextItem(model)
		if (!item) return done
		await item.process()
		done.push(`${item.ref.source}:${item.ref.id}`)
	}
	throw new Error(`the queue never ran dry: ${done.join(", ")}`)
}

async function makeBook(userId: number, name: string) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return book
}

async function defaultVector(entryId: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookEntryVectors)
		.where(
			and(
				eq(schema.lorebookEntryVectors.entryId, entryId),
				eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME),
				eq(schema.lorebookEntryVectors.chunkIndex, 0)
			)
		)
	return row
}

describe("A9 — an entry write costs an embed only when the embedded text moved", () => {
	let userId: number
	let bookId: number
	let a: number
	let b: number
	let c: number
	let h1: number
	let h2: number

	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		userId = (await createTestUser(testDb, "embedding-cost-user")).id
		bookId = (await makeBook(userId, "Embedding Cost Book")).id
		const lore = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{ lorebookId: bookId, name: "Alder", content: "A tree." },
					{ lorebookId: bookId, name: "Birch", content: "Another." },
					{ lorebookId: bookId, name: "Cedar", content: "A third." }
				] as any)
			)
			.returning()
		;[a, b, c] = lore.map((r) => r.id)
		const history = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: bookId, content: "Year one.", year: 1 },
					{ lorebookId: bookId, content: "Year two.", year: 2 }
				] as any)
			)
			.returning()
		;[h1, h2] = history.map((r) => r.id)

		// Everything embedded once, as a starting point.
		expect((await drain("test-model")).length).toBe(5)
		embedded.length = 0
	}, 60_000)

	it("a mark — off or pinned — costs nothing", async () => {
		const { entrySetMarksHandler } = await import(
			"$lib/server/sockets/entries"
		)
		await entrySetMarksHandler.handler(
			userSocket(userId),
			{ entryId: a, pinned: true },
			noop
		)
		await entrySetMarksHandler.handler(
			userSocket(userId),
			{ entryId: b, off: true },
			noop
		)
		expect(await drain("test-model")).toEqual([])
		expect(embedded).toEqual([])
	}, 60_000)

	it("archiving costs nothing", async () => {
		const { updateEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		await updateEntryHandler.handler(
			userSocket(userId),
			{
				entry: {
					id: c,
					typeId: WORLD_LORE_TYPE_ID,
					archived: true
				} as any
			},
			noop
		)
		expect(await drain("test-model")).toEqual([])
	}, 60_000)

	it("a drag reorder costs nothing", async () => {
		const { updateEntryPositionsHandler } = await import(
			"$lib/server/sockets/entries"
		)
		await updateEntryPositionsHandler.handler(
			userSocket(userId),
			{
				lorebookId: bookId,
				typeId: WORLD_LORE_TYPE_ID,
				positions: [
					{ id: c, position: 1 },
					{ id: a, position: 2 },
					{ id: b, position: 3 }
				]
			},
			noop
		)
		expect(await drain("test-model")).toEqual([])
	}, 60_000)

	it("a keys edit costs nothing — also when the save re-sends the unchanged title and content", async () => {
		const { updateEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		await updateEntryHandler.handler(
			userSocket(userId),
			{
				entry: {
					id: a,
					typeId: WORLD_LORE_TYPE_ID,
					keys: ["alder", "tree"]
				} as any
			},
			noop
		)
		// The editor's whole-form save: the embedded half named, unchanged.
		await updateEntryHandler.handler(
			userSocket(userId),
			{
				entry: {
					id: b,
					typeId: WORLD_LORE_TYPE_ID,
					name: "Birch",
					content: "Another.",
					keys: ["birch"]
				} as any
			},
			noop
		)
		expect(await drain("test-model")).toEqual([])
		expect(await defaultVector(b)).toBeDefined()
	}, 60_000)

	it("a graph build's graphed flag costs nothing", async () => {
		// The exact statement narrativeGraph.ts issues when a build reads a
		// history entry.
		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: mergeFields({ graphed: true }) })
			.where(eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID))
		expect(await drain("test-model")).toEqual([])
	}, 60_000)

	it("iterateNext embeds the new entry and never the siblings it shifted", async () => {
		const { iterateNextEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		const { entry } = await iterateNextEntryHandler.handler(
			userSocket(userId),
			{ id: h1, typeId: HISTORY_TYPE_ID },
			noop
		)
		// h2 moved one position along; only the new row is new text.
		expect(await drain("test-model")).toEqual([`historyEntry:${entry.id}`])
	}, 60_000)

	it("a content edit costs exactly one embed, of the new text", async () => {
		const { updateEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		await updateEntryHandler.handler(
			userSocket(userId),
			{
				entry: {
					id: h2,
					typeId: HISTORY_TYPE_ID,
					content: "Year two, rewritten."
				} as any
			},
			noop
		)
		embedded.length = 0
		expect(await drain("test-model")).toEqual([`historyEntry:${h2}`])
		expect(embedded).toEqual(["Year two, rewritten."])
	}, 60_000)

	it("a title edit costs exactly one embed, of the title and the content", async () => {
		const { updateEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		await updateEntryHandler.handler(
			userSocket(userId),
			{
				entry: {
					id: a,
					typeId: WORLD_LORE_TYPE_ID,
					name: "Alder, old"
				} as any
			},
			noop
		)
		embedded.length = 0
		expect(await drain("test-model")).toEqual([`worldLore:${a}`])
		expect(embedded).toEqual(["Alder, old\nA tree."])
	}, 60_000)

	it("a content change that bypasses updated_at is still caught", async () => {
		// A raw statement pinning `updated_at` — a repair, a token rewrite — is
		// exactly what a timestamp rule cannot see.
		await testDb
			.update(schema.lorebookEntries)
			.set({
				content: "Changed without a timestamp.",
				updatedAt: sql`${schema.lorebookEntries.updatedAt}`
			})
			.where(eq(schema.lorebookEntries.id, c))
		expect(await drain("test-model")).toEqual([`worldLore:${c}`])
	}, 60_000)

	it("a keys save of an imported entry whose text has edge whitespace costs nothing, and keeps the text as stored", async () => {
		// An import stores the card's text verbatim; the editor trims what it
		// saves. Writing the trimmed copy back would change the embedded text —
		// and pay for an embedding — on a save that only added a key.
		const [imported] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId: bookId,
						name: "Imported ",
						content: "Body from a card.\n"
					}
				] as any)
			)
			.returning()
		expect(await drain("test-model")).toEqual([`worldLore:${imported.id}`])

		const { updateEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		// The form re-sending the text as it holds it, then as it shows it.
		for (const [name, content, keys] of [
			["Imported ", "Body from a card.\n", ["card"]],
			["Imported", "Body from a card.", ["card", "import"]]
		] as const)
			await updateEntryHandler.handler(
				userSocket(userId),
				{
					entry: {
						id: imported.id,
						typeId: WORLD_LORE_TYPE_ID,
						name,
						content,
						keys: [...keys]
					} as any
				},
				noop
			)

		expect(await drain("test-model")).toEqual([])
		const [stored] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, imported.id))
		expect(stored.title).toBe("Imported ")
		expect(stored.content).toBe("Body from a card.\n")
		expect(stored.keys).toEqual(["card", "import"])
	}, 60_000)

	it("an edit that changes the words still trims, and costs one embed", async () => {
		const { updateEntryHandler } = await import(
			"$lib/server/sockets/entries"
		)
		const [row] = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.title, "Imported "))
		embedded.length = 0
		await updateEntryHandler.handler(
			userSocket(userId),
			{
				entry: {
					id: row.id,
					typeId: WORLD_LORE_TYPE_ID,
					name: "Imported ",
					content: "  A new body.\n"
				} as any
			},
			noop
		)
		expect(await drain("test-model")).toEqual([`worldLore:${row.id}`])
		// The unchanged title keeps its spelling; the changed content is trimmed.
		expect(embedded).toEqual(["Imported \nA new body."])
	}, 60_000)
})

const MODEL_A = "text-embedding-3-small"
const MODEL_B = "text-embedding-3-large"

async function makeEmbeddingConnection(
	name: string,
	model: string,
	baseUrl = "http://localhost:1234/v1"
) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name,
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			baseUrl,
			extraJson: {},
			capabilities: { resolved: { "text->embedding": 1 } }
		} as any)
		.returning()
	const [row] = await testDb
		.insert(schema.connectionModels)
		.values({ connectionId: conn.id, model, name: model })
		.returning()
	return { id: conn.id, modelId: row.id }
}

async function star(id: number | null, modelId?: number) {
	const { connectionsSetDefault } = await import(
		"$lib/server/sockets/connections"
	)
	await connectionsSetDefault.handler(
		adminSocket,
		{
			capability: "text->embedding",
			id,
			...(id == null ? {} : { modelId })
		} as any,
		noop
	)
}

async function starredModelId(): Promise<string> {
	const { currentEmbeddingModelId } = await import("./reindex")
	const id = await currentEmbeddingModelId(testDb as any)
	if (!id) throw new Error("nothing is starred")
	return id
}

const entryCount = async () =>
	Number(
		(
			await testDb
				.select({ n: sql<number>`count(*)` })
				.from(schema.lorebookEntries)
		)[0].n
	)
const vectorCount = async () =>
	Number(
		(
			await testDb
				.select({ n: sql<number>`count(*)` })
				.from(schema.lorebookEntryVectors)
		)[0].n
	)

describe("A10 — the embedding star, counted in embeds", () => {
	let a: { id: number; modelId: number }

	it("the first star embeds every entry once", async () => {
		a = await makeEmbeddingConnection("Small", MODEL_A)
		await star(a.id, a.modelId)
		const modelA = await starredModelId()
		expect((await drain(modelA)).length).toBe(await entryCount())
	}, 60_000)

	it("unstar then re-star of the same model keeps the index: no clear, no embeds", async () => {
		const before = await vectorCount()
		await star(null)
		queueCalls.length = 0
		unloads.length = 0

		await star(a.id, a.modelId)

		expect(await vectorCount()).toBe(before)
		// The queue comes back on, and it resumes rather than starting over.
		expect(queueCalls).toEqual(["stop", "start:resume"])
		expect(await drain(await starredModelId())).toEqual([])
	}, 60_000)

	it("a different model clears the index and re-embeds every entry", async () => {
		const b = await makeEmbeddingConnection("Large", MODEL_B)
		queueCalls.length = 0
		unloads.length = 0

		await star(b.id, b.modelId)

		expect(queueCalls).toEqual(["stop", "start:beginning"])
		expect(unloads.length).toBe(1)
		expect(await vectorCount()).toBe(0)
		expect((await drain(await starredModelId())).length).toBe(
			await entryCount()
		)
	}, 60_000)

	it("deleting the starred connection stops the queue and unloads the model, and keeps the vectors", async () => {
		const c = await makeEmbeddingConnection("Doomed", MODEL_A)
		await star(c.id, c.modelId)
		await drain(await starredModelId())
		const before = await vectorCount()
		queueCalls.length = 0
		unloads.length = 0

		const { connectionsDelete } = await import(
			"$lib/server/sockets/connections"
		)
		await connectionsDelete.handler(adminSocket, { id: c.id } as any, noop)

		expect(queueCalls).toEqual(["stop"])
		expect(unloads.length).toBe(1)
		expect(await vectorCount()).toBe(before)
	}, 60_000)

	it("deleting the starred model does the same", async () => {
		const d = await makeEmbeddingConnection("Model gone", MODEL_A)
		await star(d.id, d.modelId)
		queueCalls.length = 0
		unloads.length = 0

		const { connectionsDeleteModel } = await import(
			"$lib/server/sockets/connections"
		)
		await connectionsDeleteModel.handler(
			adminSocket,
			{ id: d.id, modelId: d.modelId },
			noop
		)

		expect(queueCalls).toEqual(["stop"])
		expect(unloads.length).toBe(1)
	}, 60_000)

	it("deleting a connection that holds no embedding star leaves the queue alone", async () => {
		const e = await makeEmbeddingConnection("Starred", MODEL_A)
		await star(e.id, e.modelId)
		const other = await makeEmbeddingConnection("Unstarred", MODEL_B)
		queueCalls.length = 0
		unloads.length = 0

		const { connectionsDelete } = await import(
			"$lib/server/sockets/connections"
		)
		await connectionsDelete.handler(
			adminSocket,
			{ id: other.id } as any,
			noop
		)

		expect(queueCalls).toEqual([])
		expect(unloads).toEqual([])
	}, 60_000)
})

describe("A10 — every door that moves the star runs its consequence", () => {
	/** A row carrying a vector in a COLUMN store, under `model`. */
	async function embeddedCharacter(model: string) {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `doors-${model.length}-${Date.now()}`)
		const [row] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Verity",
				description: "…",
				embedding: [1, 0, 0],
				embeddingModel: model
			} as any)
			.returning()
		// Embedded from the text it holds, as the queue writes one.
		await testDb.execute(
			sql`UPDATE characters SET embedding_source_hash = embed_text_hash, vectorized_at = updated_at + interval '1 minute' WHERE id = ${row.id}`
		)
		return row.id
	}
	const characterModel = async (id: number) =>
		(
			await testDb
				.select({ model: schema.characters.embeddingModel })
				.from(schema.characters)
				.where(eq(schema.characters.id, id))
		)[0]?.model ?? null
	const entryModels = async () =>
		(
			await testDb
				.selectDistinct({ model: schema.lorebookEntryVectors.model })
				.from(schema.lorebookEntryVectors)
		).map((r) => r.model)

	async function editConnection(connection: Record<string, unknown>) {
		const { connectionsUpdate } = await import(
			"$lib/server/sockets/connections"
		)
		await connectionsUpdate.handler(adminSocket, { connection } as any, noop)
	}
	async function reindexCost(target?: { connectionId: number; modelId: number }) {
		const { vectorizationReindexCost } = await import(
			"$lib/server/sockets/vectorization"
		)
		return vectorizationReindexCost.handler(
			adminSocket,
			(target ? { target } : {}) as any,
			noop
		)
	}
	const reset = () => {
		queueCalls.length = 0
		unloads.length = 0
		embedded.length = 0
	}

	let spelled: { id: number; modelId: number }
	let character: number

	beforeAll(async () => {
		spelled = await makeEmbeddingConnection(
			"Hosted",
			MODEL_A,
			"https://api.example.com/v1"
		)
		await star(spelled.id, spelled.modelId)
		await drain(await starredModelId())
		character = await embeddedCharacter(await starredModelId())
	}, 60_000)

	it("a trailing slash, a capital or a written-out default port on the starred address re-embeds nothing", async () => {
		const before = await vectorCount()
		reset()

		await editConnection({
			id: spelled.id,
			baseUrl: "https://API.example.com:443/v1/"
		})

		const now = await starredModelId()
		// The model moved to the new spelling, so the queue is stopped, the
		// model reloaded under it, and the queue resumed — never restarted.
		expect(queueCalls).toEqual(["stop", "start:resume"])
		expect(unloads.length).toBe(1)
		// Every vector kept, and stamped with the identity now in force, in
		// the row store and the column stores alike.
		expect(await vectorCount()).toBe(before)
		expect(await entryModels()).toEqual([now])
		expect(await characterModel(character)).toBe(now)
		expect(await drain(now)).toEqual([])
		expect(embedded).toEqual([])
	}, 60_000)

	it("starring a second connection naming the same address and model re-embeds nothing, and the confirmation says so", async () => {
		const twin = await makeEmbeddingConnection(
			"Hosted again",
			MODEL_A,
			"https://api.example.com/v1"
		)
		const cost = await reindexCost({
			connectionId: twin.id,
			modelId: twin.modelId
		})
		expect(cost.rows).toBe(0)
		expect(cost.target).toEqual({
			connectionId: twin.id,
			modelId: twin.modelId
		})
		const before = await vectorCount()
		reset()

		await star(twin.id, twin.modelId)

		expect(await vectorCount()).toBe(before)
		expect(await drain(await starredModelId())).toEqual([])
		expect(embedded).toEqual([])
		spelled = twin
	}, 60_000)

	it("an edit that moves neither the address nor the model leaves the queue alone", async () => {
		reset()
		await editConnection({ id: spelled.id, name: "Hosted, renamed" })
		expect(queueCalls).toEqual([])
		expect(unloads).toEqual([])
	}, 60_000)

	it("the confirmation prices an edit of the starred connection before it is saved", async () => {
		const target = { connectionId: spelled.id, modelId: spelled.modelId }
		const everything = (await vectorCount()) + 1 // every entry, and the character
		// A respelling of the same address keeps every vector: no dialog.
		const respelled = await reindexCost({
			...target,
			edit: { baseUrl: "https://API.example.com:443/v1/" }
		} as any)
		expect(respelled.rows).toBe(0)
		expect(respelled.target).toEqual({
			...target,
			edit: { baseUrl: "https://API.example.com:443/v1/" }
		})
		// Another host, or another model identifier, is a switch.
		expect(
			(
				await reindexCost({
					...target,
					edit: { baseUrl: "https://elsewhere.example.com/v1" }
				} as any)
			).rows
		).toBe(everything)
		expect(
			(
				await reindexCost({
					...target,
					edit: { model: "text-embedding-3-small-v2" }
				} as any)
			).rows
		).toBe(everything)
		// Nothing was saved by asking.
		expect(await drain(await starredModelId())).toEqual([])
	}, 60_000)

	it("the server, not the screen, decides whether an edit touches the star", async () => {
		// A screen that has not loaded the defaults yet cannot tell whether the
		// connection it edits is the starred one, so it asks about every edit
		// of an address or an identifier — naming the connection, and the model
		// only when it renames one. The answer is priced against the star as
		// the server holds it.
		const everything = (await vectorCount()) + 1
		const elsewhere = { baseUrl: "https://elsewhere.example.com/v1" }
		const stranger = await makeEmbeddingConnection(
			"Unstarred",
			MODEL_B,
			"http://localhost:4321/v1"
		)
		const [sibling] = await testDb
			.insert(schema.connectionModels)
			.values({
				connectionId: spelled.id,
				model: "text-embedding-3-large",
				name: "text-embedding-3-large"
			})
			.returning()

		// An address edit of the starred connection, with no model named.
		const moved = await reindexCost({
			connectionId: spelled.id,
			edit: elsewhere
		} as any)
		expect(moved.rows).toBe(everything)
		expect(moved.target).toEqual({ connectionId: spelled.id, edit: elsewhere })
		// Of a connection that holds no star: nothing moves.
		expect(
			(await reindexCost({ connectionId: stranger.id, edit: elsewhere } as any))
				.rows
		).toBe(0)
		// Renaming a model the star is not on, on the starred connection.
		expect(
			(
				await reindexCost({
					connectionId: spelled.id,
					modelId: sibling!.id,
					edit: { model: "text-embedding-3-large-v2" }
				} as any)
			).rows
		).toBe(0)
		// Renaming the starred one.
		expect(
			(
				await reindexCost({
					connectionId: spelled.id,
					modelId: spelled.modelId,
					edit: { model: "text-embedding-3-small-v2" }
				} as any)
			).rows
		).toBe(everything)
	}, 60_000)

	it("after an unstar, the confirmation prices a different model and not the one the index was built with", async () => {
		const built = await starredModelId()
		const other = await makeEmbeddingConnection(
			"Local",
			MODEL_B,
			"http://localhost:1234/v1"
		)
		await star(null)
		expect(await reindexCost({ connectionId: spelled.id, modelId: spelled.modelId })).toMatchObject({ rows: 0 })
		const switching = await reindexCost({
			connectionId: other.id,
			modelId: other.modelId
		})
		// Every entry vector and the character: all made by `built`.
		expect(switching.rows).toBe((await vectorCount()) + 1)
		expect(switching.byKind).toEqual({
			characters: 1,
			lorebookEntries: await vectorCount()
		})
		// The untargeted question is unchanged: every stored vector.
		expect((await reindexCost()).rows).toBe(switching.rows)
		await star(spelled.id, spelled.modelId)
		expect(await starredModelId()).toBe(built)
	}, 60_000)

	it("moving the starred address to another host re-indexes, exactly as a switch does", async () => {
		reset()
		await editConnection({
			id: spelled.id,
			baseUrl: "https://elsewhere.example.com/v1"
		})
		expect(queueCalls).toEqual(["stop", "start:beginning"])
		expect(unloads.length).toBe(1)
		expect(await vectorCount()).toBe(0)
		expect(await characterModel(character)).toBeNull()
		// Every entry, and the character beside them.
		expect((await drain(await starredModelId())).length).toBe(
			(await entryCount()) + 1
		)
	}, 60_000)

	it("renaming the starred model's identifier re-indexes too", async () => {
		reset()
		const { connectionsUpdateModel } = await import(
			"$lib/server/sockets/connections"
		)
		await connectionsUpdateModel.handler(
			adminSocket,
			{
				id: spelled.id,
				modelId: spelled.modelId,
				model: { model: "text-embedding-3-small-v2" }
			} as any,
			noop
		)
		expect(await starredModelId()).toMatch(/::text-embedding-3-small-v2$/)
		expect(queueCalls).toEqual(["stop", "start:beginning"])
		expect(unloads.length).toBe(1)
		expect(await vectorCount()).toBe(0)
		// Every entry, and the character beside them.
		expect((await drain(await starredModelId())).length).toBe(
			(await entryCount()) + 1
		)
	}, 60_000)

	it("Admin → Defaults moving the star runs the same consequence", async () => {
		const elsewhere = await makeEmbeddingConnection("Admin pick", MODEL_B)
		reset()
		const { connectionDefaultsSet } = await import(
			"$lib/server/sockets/connectionDefaults"
		)
		await connectionDefaultsSet.handler(
			adminSocket,
			{
				capability: "text->embedding",
				half: "connection",
				id: elsewhere.id,
				modelId: elsewhere.modelId
			} as any,
			noop
		)
		expect(queueCalls).toEqual(["stop", "start:beginning"])
		expect(unloads.length).toBe(1)
		expect(await vectorCount()).toBe(0)
		// Every entry, and the character beside them.
		expect((await drain(await starredModelId())).length).toBe(
			(await entryCount()) + 1
		)
	}, 60_000)

	it("a switch while an embed is in flight: the finished embed is not written under the old model", async () => {
		const old = await starredModelId()
		// Nothing else waiting, so the pick below is the new entry.
		await drain(old)
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId: (
							await testDb
								.select({ id: schema.lorebooks.id })
								.from(schema.lorebooks)
								.limit(1)
						)[0].id,
						name: "In flight",
						content: "Picked just before the switch."
					}
				] as any)
			)
			.returning()
		const next = await makeEmbeddingConnection("Next", MODEL_A)
		const { pickNextItem } = await import("./vectorizationQueue")
		loaded = old
		const item = await pickNextItem(old)
		expect(item?.ref.id).toBe(entry.id)
		duringNextEmbed = () => star(next.id, next.modelId)

		await item!.process()

		expect(await defaultVector(entry.id)).toBeUndefined()
		expect(await entryModels()).not.toContain(old)
	}, 60_000)

	it("deleting the starred model from its Ollama host stops the queue and unloads the model, and keeps the vectors", async () => {
		const [host] = await testDb
			.insert(schema.connections)
			.values({
				name: "Ollama here",
				type: CONNECTION_TYPE.OLLAMA,
				baseUrl: "http://localhost:11434",
				extraJson: {},
				capabilities: { resolved: { "text->embedding": 1 } }
			} as any)
			.returning()
		const [model] = await testDb
			.insert(schema.connectionModels)
			.values({
				connectionId: host.id,
				model: "nomic-embed-text",
				name: "nomic-embed-text",
				modality: "embeddings"
			} as any)
			.returning()
		await star(host.id, model.id)
		await drain(await starredModelId())
		const before = await vectorCount()
		reset()

		const { ollamaDeleteModelHandler } = await import(
			"$lib/server/sockets/ollama"
		)
		await ollamaDeleteModelHandler.handler(
			adminSocket,
			{ connectionId: host.id, modelName: "nomic-embed-text" } as any,
			noop
		)

		const { currentEmbeddingModelId } = await import("./reindex")
		expect(await currentEmbeddingModelId(testDb as any)).toBeNull()
		expect(queueCalls).toEqual(["stop"])
		expect(unloads.length).toBe(1)
		expect(await vectorCount()).toBe(before)
	}, 60_000)
})
