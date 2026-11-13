/**
 * 🚧 (sense-b4) The own-book write route under **Full** on your own lorebook,
 * for a session whose scenes end by themselves: a pipeline's new entry, place,
 * history day or link goes to the session's own book whatever the lorebook's
 * write setting, forks no line, and does not settle by `sources`; the same
 * calls for a session whose scenes do not end by themselves write straight to
 * the lorebook as they always did. The predicate (`scenesEndByThemselves`) is
 * switched per session here; the real one is tested in a bootstrapped world.
 * Driven through the real outlets.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { annexField } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const scenesEnd = vi.hoisted(() => new Set<number>())
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	scenesEndByThemselves: async (_db: unknown, sessionId: number) => scenesEnd.has(sessionId)
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const CREATE = { key: "file", definitionId: "core:outlet/create-lore-entry" } as any
const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
const LINK = { key: "tie", definitionId: "core:outlet/link-lore-entries" } as any
const ANNEX = { key: "set", definitionId: "core:outlet/set-lorebook-annex", definitionVersion: 1 } as any
const ANNEX_OWNER = "acme.fullworld"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-own-book-full-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	process.env.SP_PLUGINS_ENABLED = "1"
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as unknown as Db)
	const manifest = {
		annexFields: [
			annexField({ key: "mood", shape: { type: "string" }, see: ["participant"], scope: "lorebook", act: ["participant"] })
		]
	}
	await db.insert(schema.plugins).values({
		pluginId: ANNEX_OWNER,
		name: ANNEX_OWNER,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${ANNEX_OWNER}`,
		enabled: true,
		manifest
	} as any)
	const { registerPluginAnnex } = await import("$lib/server/plugins/pluginAnnex")
	expect(registerPluginAnnex(manifest, ANNEX_OWNER)).toEqual([])
}, 120_000)

afterAll(async () => {
	const { withdrawPluginAnnex } = await import("$lib/server/plugins/pluginAnnex")
	withdrawPluginAnnex(ANNEX_OWNER)
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** Your own lorebook at Full, and a session reading it; `ends`: its scenes end by themselves. */
async function world(ends: boolean, opts: { fork?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `own-full-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [fork] = opts.fork
		? await db.insert(schema.lorebookBranches).values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 }).returning()
		: []
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			...(fork ? { lorebookBranchId: fork.id, lineOnFirstWrite: true } : {})
		})
		.returning()
	if (ends) scenesEnd.add(session!.id)
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db as unknown as Db, session!.id)
	const messages: number[] = []
	const message = async () => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		messages.push(legacy!.id)
		return legacy!
	}
	const host = async (runId = `run-${suffix}`, scope: Record<string, unknown> = {}) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db as unknown as Db, {
			sessionId: session!.id,
			userId: user.id,
			runId,
			specId: `${ANNEX_OWNER}:spec/world`,
			...scope
		} as any)
	}
	return { suffix, user, book: book!, fork, session: session!, own, message, messages, host }
}

async function place(lorebookId: number, title: string, content = `${title}, as written.`) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content,
			fields: { category: "Rooms" }
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!
const placesIn = (lorebookId: number) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(and(eq(schema.lorebookEntries.lorebookId, lorebookId), eq(schema.lorebookEntries.typeId, LOCATION_TYPE_ID)))
		.orderBy(schema.lorebookEntries.id)
const linksOf = (lorebookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
		.orderBy(schema.narrativeRelationships.id)
const sessionRow = async (id: number) =>
	(await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)))[0]!
const sourcesOf = (subjectId: number) =>
	db.select().from(schema.loreSources).where(eq(schema.loreSources.subjectId, subjectId))
const roomIn = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	content: "A room.",
	params: { entryType: LOCATION_TYPE_ID },
	...extra
})

describe("create-lore-entry of a place under Full", () => {
	it("a session whose scenes end by themselves: the own book takes it, and no line forks", async () => {
		const w = await world(true, { fork: true })
		await w.message()
		const out: any = await (await w.host()).commit!(roomIn("The Cellar"), CREATE)
		expect(out).toMatchObject({ route: "own-book", lorebookId: w.own.id })
		expect((await stored(out.id)).lorebookId).toBe(w.own.id)
		expect(await placesIn(w.book.id)).toHaveLength(0)
		const s = await sessionRow(w.session.id)
		expect(s.lineOnFirstWrite).toBe(true)
		expect(s.lorebookBranchId).toBe(w.fork!.id)
		expect(
			await db.select().from(schema.lorebookBranches).where(eq(schema.lorebookBranches.lorebookId, w.book.id))
		).toHaveLength(1)
	})

	it("a session whose scenes do not end by themselves: the lorebook takes it, as before", async () => {
		const w = await world(false)
		await w.message()
		const out: any = await (await w.host()).commit!(roomIn("The Cellar"), CREATE)
		expect(out).toMatchObject({ route: "book", lorebookId: w.book.id })
		expect((await stored(out.id)).lorebookId).toBe(w.book.id)
		expect(await placesIn(w.own.id)).toHaveLength(0)
	})
})

describe("create-lore-entry with sources under Full", () => {
	it("a session whose scenes end by themselves: lore_sources is recorded, the settle line does not move", async () => {
		const w = await world(true)
		const m = await w.message()
		const out: any = await (await w.host("run-s", { readMessageIds: new Set([m.id]) })).commit!(
			roomIn("The Cellar", { sources: [{ id: m.id }] }),
			CREATE
		)
		const rows = await sourcesOf(out.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ lorebookId: w.own.id, throughMessageId: m.id })
		expect((await sessionRow(w.session.id)).settledMessageId).toBeNull()
	})

	it("a session whose scenes do not end by themselves: the settle line moves, as before", async () => {
		const w = await world(false)
		const m = await w.message()
		const out: any = await (await w.host("run-s", { readMessageIds: new Set([m.id]) })).commit!(
			roomIn("The Cellar", { sources: [{ id: m.id }] }),
			CREATE
		)
		expect(await sourcesOf(out.id)).toHaveLength(1)
		expect((await sessionRow(w.session.id)).settledMessageId).toBe(m.id)
	})
})

describe("update-lore-entry under Full", () => {
	it("a session whose scenes end by themselves: an own-book entry is written in place, and a name both books hold is the own book's", async () => {
		const w = await world(true)
		await w.message()
		const lore = await place(w.book.id, "The Hall", "Lorebook words.")
		const mine = await place(w.own.id, "The Hall", "Own words.")
		const out: any = await (await w.host()).commit!({ entry: "The Hall", content: "Own words, revised." }, UPDATE)
		expect(out).toMatchObject({ entryId: mine.id, route: "own-book", lorebookId: w.own.id })
		expect((await stored(mine.id)).content).toBe("Own words, revised.")
		expect((await stored(lore.id)).content).toBe("Lorebook words.")
	})

	it("a session whose scenes end by themselves: an entry only the lorebook holds is held as an amendment, never written", async () => {
		const w = await world(true)
		await w.message()
		const lore = await place(w.book.id, "The Keep", "Lorebook words.")
		await (await w.host()).commit!({ entry: "The Keep", content: "Changed." }, UPDATE)
		expect((await stored(lore.id)).content).toBe("Lorebook words.")
		expect(await db.select().from(schema.entryAmendments).where(eq(schema.entryAmendments.lorebookId, w.own.id))).toHaveLength(1)
	})

	it("a session whose scenes do not end by themselves: a name both books hold is the lorebook's entry, its change held, as before", async () => {
		const w = await world(false)
		await w.message()
		const lore = await place(w.book.id, "The Hall", "Lorebook words.")
		const mine = await place(w.own.id, "The Hall", "Own words.")
		const out: any = await (await w.host()).commit!({ entry: "The Hall", content: "Changed." }, UPDATE)
		expect(out).toMatchObject({ entryId: lore.id, lorebookId: lore.lorebookId })
		expect((await stored(lore.id)).content).toBe("Lorebook words.")
		expect((await stored(mine.id)).content).toBe("Own words.")
		expect(await db.select().from(schema.entryAmendments).where(eq(schema.entryAmendments.lorebookId, w.own.id))).toHaveLength(1)
	})
})

describe("a toNotes write under Full", () => {
	it("a session whose scenes end by themselves gets the two-book reading: its link reaches a lorebook room", async () => {
		const w = await world(true)
		await w.message()
		const hall = await place(w.book.id, "The Hall")
		const out: any = await (await w.host()).commit!(roomIn("The Cellar", { toNotes: true, links: ["The Hall"] }), CREATE)
		expect(out.lorebookId).toBe(w.own.id)
		const rows = await linksOf(w.own.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ fromEntryId: out.id, toEntryId: hall.id })
	})

	it("a session whose scenes do not end by themselves reads its notes alone, as before", async () => {
		const w = await world(false)
		await w.message()
		await place(w.book.id, "The Hall")
		await expect(
			(await w.host()).commit!(roomIn("The Cellar", { toNotes: true, links: ["The Hall"] }), CREATE)
		).rejects.toThrow()
	})
})

describe("link-lore-entries under Full", () => {
	it("a session whose scenes end by themselves: a link between an own-book room and a lorebook room is the own book's", async () => {
		const w = await world(true, { fork: true })
		await w.message()
		const hall = await place(w.book.id, "The Hall")
		const mine = await place(w.own.id, "My Den")
		const out: any = await (await w.host()).commit!({ from: mine.id, to: "The Hall" }, LINK)
		expect(out).toMatchObject({ fromEntryId: mine.id, lorebookId: w.own.id })
		const rows = await linksOf(w.own.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ fromEntryId: mine.id, toEntryId: hall.id, branchId: null })
		expect(await linksOf(w.book.id)).toHaveLength(0)
		expect((await sessionRow(w.session.id)).lineOnFirstWrite).toBe(true)
	})

	it("a session whose scenes do not end by themselves: two lorebook rooms are linked in the lorebook, as before", async () => {
		const w = await world(false)
		await w.message()
		const a = await place(w.book.id, "A")
		await place(w.book.id, "B")
		const out: any = await (await w.host()).commit!({ from: a.id, to: "B" }, LINK)
		expect(out.lorebookId).toBe(w.book.id)
		expect(await linksOf(w.book.id)).toHaveLength(1)
		expect(await linksOf(w.own.id)).toHaveLength(0)
	})
})

describe("a lorebook annex write under Full", () => {
	const annexOf = async (lorebookId: number) =>
		(((await db.select({ annex: schema.lorebooks.annex }).from(schema.lorebooks).where(eq(schema.lorebooks.id, lorebookId)))[0]!
			.annex ?? {}) as any)[ANNEX_OWNER]

	it.each([true, false])("lands in the lorebook, for a session whose scenes end by themselves: %s", async (ends) => {
		const w = await world(ends)
		await w.message()
		const out: any = await (await w.host()).commit!({ value: { mood: "wary" } }, ANNEX)
		expect(out).toMatchObject({ written: true, lorebookId: w.book.id })
		expect(await annexOf(w.book.id)).toEqual({ mood: "wary" })
		expect(await annexOf(w.own.id)).toBeUndefined()
	})
})
