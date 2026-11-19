/**
 * 🚧 With the lorebook's timeline off, no history entry reaches a run
 * (owner ruling D55, 2026-11-16): not the lanes, the listing, the keyword
 * scan, the vector gate, entity search nor the tools — and each read whose
 * answer would have held one says so. Switched on again they are back.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { historyValues, worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { getEntry, readSummary, searchEntries } from "$lib/server/pipelines/runtime/tools/coreTools"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "history-timeline-off-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-history-timeline-off-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const db = () => testDb as unknown as Db
const bindings = async () => (await import("$lib/server/pipelines/runtime/bindings")).coreBindings()
const SENTENCE = (n: number) =>
	`${n} history ${n === 1 ? "entry" : "entries"} left out: this lorebook keeps no timeline`

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `hto-${Math.random().toString(36).slice(2, 8)}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Book" } as never)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: "Run", lorebookId: book!.id } as never)
		.returning()
	await testDb.insert(schema.lorebookEntries).values(
		worldLoreValues([{ lorebookId: book!.id, name: "Harbor", keys: "", constant: true, content: "The harbor." }])
	)
	const ids = (
		await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: book!.id, year: 7, keys: "", constant: true, content: "The bridge fell." },
					{ lorebookId: book!.id, year: 8, keys: "", constant: true, content: "The tower burned." }
				])
			)
			.returning()
	).map((r) => r.id)
	const setTimeline = (on: boolean) =>
		testDb.update(schema.lorebooks).set({ timelineEnabled: on }).where(eq(schema.lorebooks.id, book!.id))
	return { sessionId: session!.id, userId: user.id, historyIds: ids, setTimeline }
}
type World = Awaited<ReturnType<typeof world>>

function ctxFor(w: World, over: Record<string, (q?: unknown) => unknown> = {}) {
	const host = createHost(db(), { sessionId: w.sessionId, userId: w.userId })
	const log = vi.fn()
	const read = (t: string, q?: unknown) => (over[t] ? over[t]!(q) : (host as any).read(t, q))
	return { log, ctx: { read, log, countTokens: (s: string) => s.length } as never, read }
}

async function node(w: World, key: string, input: Record<string, unknown> = {}, over = {}) {
	const { ctx, log } = ctxFor(w, over)
	const r = (await (await bindings())[key]!(
		{ scope: { sessionId: w.sessionId }, params: {}, ...input } as never,
		ctx
	)) as any
	expect(r.kind).toBe("ok")
	return { r, log, receipts: log.mock.calls.filter((c) => /left out: this lorebook keeps no timeline/.test(String(c[1]))) }
}

const hitIds = (r: any) => (r.value.hits ?? []).map((h: any) => h.id).filter((id: unknown) => id !== undefined)

describe("the history lane and the keyword scan", () => {
	test("on: both entries; off: none, and the receipt; on again: back", async () => {
		const w = await world()
		const on = await node(w, "core:query/history-entries@1")
		expect(hitIds(on.r).sort()).toEqual([...w.historyIds].sort())
		expect(on.receipts).toEqual([])
		await w.setTimeline(false)
		const off = await node(w, "core:query/history-entries@1")
		expect(hitIds(off.r)).toEqual([])
		expect(off.receipts).toEqual([["info", SENTENCE(2)]])
		const trig = await node(w, "core:query/lorebook-triggers@1")
		expect((trig.r.value.hits ?? []).map((h: any) => h.source)).not.toContain("history")
		expect(trig.receipts).toEqual([["info", SENTENCE(2)]])
		await w.setTimeline(true)
		expect(hitIds((await node(w, "core:query/history-entries@1")).r).sort()).toEqual([...w.historyIds].sort())
	})

	test("the world lane keeps its entry and says nothing", async () => {
		const w = await world()
		await w.setTimeline(false)
		const lane = await node(w, "core:query/world-lore@1")
		expect(hitIds(lane.r).length).toBe(1)
		expect(lane.receipts).toEqual([])
	})
})

describe("the listing", () => {
	test("history is listed with the timeline on, absent and said off, back on again", async () => {
		const w = await world()
		const sources = async () => {
			const x = await node(w, "core:query/lorebook-entries@1")
			return { src: (x.r.value.entries as any[]).map((e) => e.source), receipts: x.receipts }
		}
		expect((await sources()).src.filter((s) => s === "history").length).toBe(2)
		await w.setTimeline(false)
		const off = await sources()
		expect(off.src).toEqual(["worldLore"])
		expect(off.receipts).toEqual([["info", SENTENCE(2)]])
		await w.setTimeline(true)
		expect((await sources()).src.filter((s) => s === "history").length).toBe(2)
	})

	test("asking for world lore alone leaves nothing out, so says nothing", async () => {
		const w = await world()
		await w.setTimeline(false)
		const x = await node(w, "core:query/lorebook-entries@1", { params: { entryTypes: ["core:entry/world-lore"] } })
		expect(x.receipts).toEqual([])
	})
})

describe("vector and entity search", () => {
	test("a history vector hit is withheld and said; on, it is kept", async () => {
		const w = await world()
		const hit = (id: number) => ({ id, source: "historyEntry", score: 0.9, content: "x" })
		const over = {
			embedding_status: () => ({ available: true }),
			vector_search: () => ({
				candidates: w.historyIds.map(hit),
				lists: [w.historyIds.map(hit)]
			})
		}
		const input = { vectors: [[0.1, 0.2]] }
		const on = await node(w, "core:query/vector-search@1", input, over)
		expect(hitIds(on.r).sort()).toEqual([...w.historyIds].sort())
		await w.setTimeline(false)
		const off = await node(w, "core:query/vector-search@1", input, over)
		expect(hitIds(off.r)).toEqual([])
		expect(off.receipts).toEqual([["info", SENTENCE(2)]])
	})

	test("entity search says what its pool would have held", async () => {
		const w = await world()
		await w.setTimeline(false)
		const over = { entity_annotations: () => ({ entries: [], entities: [], messages: [] }) }
		const x = await node(w, "core:query/entity-search@1", {}, over)
		expect(x.receipts).toEqual([["info", SENTENCE(2)]])
	})
})

describe("the tools", () => {
	test("search, get and read_summary: found with the timeline on; off, none of it", async () => {
		const w = await world()
		const toolCtx = () => {
			const host = createHost(db(), { sessionId: w.sessionId })
			return {
				sessionId: w.sessionId,
				currentCharacterId: null,
				read: (t: string, q: unknown) =>
					host.read!(t as never, q as never, { key: "n", definitionId: "core:tool", definitionVersion: 1, kind: "query" } as never)
			} as never
		}
		const id = w.historyIds[0]!
		const on: any = await readSummary.run({ kind: "history" }, toolCtx())
		expect(on.found).toBe(2)
		expect((await getEntry.run({ id }, toolCtx())) as any).toBeTruthy()
		await w.setTimeline(false)
		await expect(readSummary.run({ kind: "history" }, toolCtx())).rejects.toThrow(
			"This lorebook has no timeline, so no history is kept."
		)
		await expect(getEntry.run({ id }, toolCtx())).rejects.toThrow(new RegExp(`no entry ${id}`))
		const found: any = await searchEntries.run({ query: "bridge" }, toolCtx())
		expect(found.entries.length).toBe(0)
		await w.setTimeline(true)
		expect(((await readSummary.run({ kind: "history" }, toolCtx())) as any).found).toBe(2)
	})
})
