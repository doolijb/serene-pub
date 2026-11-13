/**
 * 🚧 When a session's line forks for a pipeline's lore write.
 *
 * A session whose scenes do **not** end by themselves writes straight to the
 * lorebook, and forks inside the write's transaction, after its checks
 * (`forkedLoreLine`): a write the transaction refuses forks nothing and leaves
 * `line_on_first_write` set; the first write that lands forks the line, and its
 * rows stand on the new line. (First describe; the predicate answers false.)
 *
 * A session whose scenes end by themselves (sense-b4) writes its new entry or
 * link to its own book and forks nothing; the line forks when an Apply moves
 * them to the lorebook, and what moved carries the new line. (Second describe;
 * the predicate is switched on per session, the real one is tested in
 * `host.scenesEndRoute.int.test.ts`.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	entryInsert,
	WORLD_LORE_TYPE_ID
} from "$lib/server/utils/lorebookEntries"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const scenesEnd = vi.hoisted(() => new Set<number>())
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	scenesEndByThemselves: async (_db: unknown, sessionId: number) =>
		scenesEnd.has(sessionId)
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }
const LINK = { key: "link", definitionId: "core:outlet/link-lore-entries" }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-host-fork-timing-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A book with a Fork and a session riding it (it forks its own line on its first write). */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `host-fork-timing-${suffix}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: `Ashfall ${suffix}`, userId: user.id })
		.returning()
	const [fork] = await db
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: book!.id,
			lorebookBranchId: fork!.id,
			lineOnFirstWrite: true
		})
		.returning()
	const [aerie] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: book!.id,
				name: "Aerie",
				content: "A nest.",
				position: 1
			} as any)
		)
		.returning({ id: schema.lorebookEntries.id })
	return { book: book!, fork: fork!, session: session!, aerie: aerie! }
}

const host = async (sessionId: number) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, { sessionId })
}
const sessionOf = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!
const linesOf = (bookId: number) =>
	db
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))

describe("a session whose scenes do not end by themselves: a pipeline's lore write forks the line inside its transaction", () => {
	it("(scenes do not end by themselves) a refused entry write (a link to nothing) forks nothing", async () => {
		const w = await world()
		const h = await host(w.session.id)
		await expect(
			h.commit!(
				{
					name: "Watchtower",
					content: "A tower.",
					links: ["Nowhere At All"]
				},
				SAVE as any
			)
		).rejects.toThrow()
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
		const made = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.title, "Watchtower"))
		expect(made).toHaveLength(0)
	})

	it("(scenes do not end by themselves) a refused link (an end that is not there) forks nothing", async () => {
		const w = await world()
		const h = await host(w.session.id)
		await expect(
			h.commit!({ from: "Aerie", to: "Nowhere At All" }, LINK as any)
		).rejects.toThrow()
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
	})

	it("(scenes do not end by themselves) the first accepted entry write forks the line, and the entry and its link stand on the new line", async () => {
		const w = await world()
		const h = await host(w.session.id)
		const res = (await h.commit!(
			{ name: "Watchtower", content: "A tower.", links: ["Aerie"] },
			SAVE as any
		)) as { id: number; linkIds: number[] }
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(2)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, res.id))
		expect(row!.branchId).toBe(after.lorebookBranchId)
		const [link] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, res.linkIds[0]!))
		expect(link!.branchId).toBe(after.lorebookBranchId)
	})

	it("(scenes do not end by themselves) the first accepted link write forks the line, and the link stands on the new line", async () => {
		const w = await world()
		const [hall] = await db
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: w.book.id,
					name: "Hall",
					content: "A hall.",
					position: 2
				} as any)
			)
			.returning({ id: schema.lorebookEntries.id })
		const h = await host(w.session.id)
		const res = (await h.commit!(
			{ from: "Aerie", to: hall!.id },
			LINK as any
		)) as {
			id: number
		}
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.fork.id)
		const [link] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, res.id))
		expect(link!.branchId).toBe(after.lorebookBranchId)
	})
})

describe("a session whose scenes end by themselves: its own book takes the write, an Apply forks the line", () => {
	/** `world()` with the predicate on, a message to anchor to, and the lorebook's owner at Full. */
	async function meeting() {
		const w = await world()
		scenesEnd.add(w.session.id)
		await db
			.insert(schema.userSettings)
			.values({ userId: w.book.userId, loreWriteMode: "full" })
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(
			db as any,
			{ sessionId: w.session.id, role: "user", content: "We go." } as any
		)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(db as any, w.session.id)
		const hostFor = async () => {
			const { createHost } = await import(
				"$lib/server/pipelines/runtime/host"
			)
			return createHost(
				db as any,
				{
					sessionId: w.session.id,
					userId: w.book.userId,
					runId: "r"
				} as any
			)
		}
		return { ...w, own, hostFor }
	}
	const stays = async (w: Awaited<ReturnType<typeof meeting>>) => {
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
	}

	it("the first accepted entry write forks nothing: the entry and its link sit in the own book with no line", async () => {
		const w = await meeting()
		const res = (await (
			await w.hostFor()
		).commit!(
			{ name: "Watchtower", content: "A tower.", links: ["Aerie"] },
			SAVE as any
		)) as { id: number; linkIds: number[]; route: string }
		expect(res.route).toBe("own-book")
		await stays(w)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, res.id))
		expect(row).toMatchObject({ lorebookId: w.own.id, branchId: null })
		const [link] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, res.linkIds[0]!))
		expect(link).toMatchObject({ lorebookId: w.own.id, branchId: null })
	})

	it("the first link write forks nothing: the link sits in the own book with no line", async () => {
		const w = await meeting()
		const [den] = await db
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: w.own.id,
					name: "Den",
					content: "A den.",
					position: 1
				} as any)
			)
			.returning({ id: schema.lorebookEntries.id })
		const res = (await (
			await w.hostFor()
		).commit!({ from: den!.id, to: "Aerie" }, LINK as any)) as {
			id: number
		}
		await stays(w)
		const [link] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, res.id))
		expect(link).toMatchObject({ lorebookId: w.own.id, branchId: null })
	})

	it("then an Apply forks the line, and what it moved carries the new line", async () => {
		const w = await meeting()
		const res = (await (
			await w.hostFor()
		).commit!(
			{ name: "Watchtower", content: "A tower.", links: ["Aerie"] },
			SAVE as any
		)) as { id: number; linkIds: number[] }
		await stays(w)
		const { applyOverlayItems } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		const done = await applyOverlayItems(db as any, {
			sessionId: w.session.id,
			userId: w.book.userId
		})
		expect(done.applied).toContain(res.id)
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(2)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, res.id))
		expect(row).toMatchObject({
			lorebookId: w.book.id,
			branchId: after.lorebookBranchId
		})
		const links = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, w.book.id))
		expect(links).toHaveLength(1)
		expect(links[0]!.branchId).toBe(after.lorebookBranchId)
	})
})
