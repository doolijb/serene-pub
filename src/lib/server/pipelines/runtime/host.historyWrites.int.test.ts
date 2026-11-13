/**
 * 🚧 Pipeline history writes in the core host (hist-B1): a history create
 * files onto the day's one entry; a history update that moves the date runs
 * the socket's date checks in the change's transaction.
 *
 * 🚧 (sense-b4) Under Full, a session whose scenes end by themselves files
 * onto its own book's days; every other session — the cases before the last
 * `describe` — writes straight to the lorebook, as it always did.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

// A switch for one injected fault; every other call is the real function.
const fault = vi.hoisted(() => ({ next: null as Error | null }))
vi.mock("$lib/server/scenes/historyEntryOfDate", async (orig) => {
	const real = await orig<typeof import("$lib/server/scenes/historyEntryOfDate")>()
	return {
		...real,
		historyEntryOfDate: (async (...args: Parameters<typeof real.historyEntryOfDate>) => {
			const e = fault.next
			fault.next = null
			if (e) throw e
			return real.historyEntryOfDate(...args)
		}) as typeof real.historyEntryOfDate
	}
})

// Which sessions meet the rule "scenes end by themselves"; the predicate itself
// is tested in a bootstrapped world elsewhere.
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
const HISTORY = { entryType: HISTORY_TYPE_ID }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-hist-B1-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/**
 * A book, optionally a fork at year 4, and a session reading main or the fork.
 * `own`: the session has no attached lorebook and reads its own book alone —
 * the book a pipeline's change writes through to (a change to an attached
 * lorebook's entry is held, and never re-dates it).
 */
async function world(opts: { fork?: boolean; own?: boolean; scenesEnd?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `hist-b1-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	let [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}` })
		.returning()
	let book: typeof schema.lorebooks.$inferSelect
	if (opts.own) {
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		book = await ownBookFor(db as unknown as Db, session!.id)
	} else {
		;[book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `Book ${suffix}` }).returning()
	}
	const [fork] = opts.fork
		? await db.insert(schema.lorebookBranches).values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 }).returning()
		: []
	const reads = {
		...(opts.own ? {} : { lorebookId: book!.id }),
		...(fork ? { lorebookBranchId: fork.id } : {})
	}
	if (Object.keys(reads).length)
		[session] = await db.update(schema.sessions).set(reads).where(eq(schema.sessions.id, session!.id)).returning()
	if (opts.scenesEnd) scenesEnd.add(session!.id)
	const message = async () => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	const host = async (runId = `run-${suffix}`) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db as unknown as Db, { sessionId: session!.id, userId: user.id, runId })
	}
	return { user, book: book!, fork, session: session!, message, host }
}

async function history(
	bookId: number,
	fields: { year?: number; month?: number | null; day?: number | null },
	extra: { content?: string; branchId?: number | null } = {}
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: bookId,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			content: extra.content ?? "",
			fields,
			branchId: extra.branchId ?? null
		})
		.returning()
	return row!
}

const rows = (bookId: number) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(and(eq(schema.lorebookEntries.lorebookId, bookId), eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)))
const entry = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]
const swipe = async (messageId: number) => {
	const { retractStateAnchoredTo } = await import("$lib/server/state/write")
	return retractStateAnchoredTo(db as unknown as Db, messageId, "replaced")
}
const dayNote = async (date: { year: number; month?: number; day?: number }) => {
	const { formatDate } = await import("$lib/shared/lorebooks/storyDate")
	return `filed onto ${formatDate({ year: date.year, month: date.month ?? null, day: date.day ?? null }, null)}'s entry`
}

describe("create-lore-entry with the history entry type (a session whose scenes do not end by themselves)", () => {
	it("two writes for one date make one row holding both paragraphs", async () => {
		const w = await world()
		await w.message()
		const h = await w.host()
		const date = { year: 3, month: 2, day: 9 }
		const first: any = await h.commit!({ content: "The gate fell.", params: HISTORY, fields: date }, CREATE)
		const second: any = await h.commit!({ content: "The bells rang.", params: HISTORY, fields: date }, CREATE)
		const all = await rows(w.book.id)
		expect(all).toHaveLength(1)
		expect(all[0]!.content).toBe("The gate fell.\n\nThe bells rang.")
		expect(first.id).toBe(all[0]!.id)
		expect(first.matched).toBeUndefined()
		expect(first.notes).toBeUndefined()
		expect(second).toMatchObject({ id: all[0]!.id, entryId: all[0]!.id, matched: true, written: false })
		expect(second.notes).toEqual([await dayNote(date)])
	})

	it("with no fields and no clock it files onto the entry the story's now is on (from history)", async () => {
		const w = await world()
		await w.message()
		const dated = await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "Spring." })
		const res: any = await (await w.host()).commit!({ content: "Rain.", params: HISTORY }, CREATE)
		expect(await rows(w.book.id)).toHaveLength(1)
		expect(res.id).toBe(dated.id)
		expect((await entry(dated.id))!.content).toBe("Spring.\n\nRain.")
	})

	it("with no fields and the session's own clock it makes the clock's day, stamped as a pipeline write", async () => {
		const w = await world()
		const m = await w.message()
		const older = await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "Spring." })
		await db
			.update(schema.sessions)
			.set({ storyClockYear: 8, storyClockMonth: 2, storyClockDay: 3 })
			.where(eq(schema.sessions.id, w.session.id))
		const res: any = await (await w.host()).commit!({ content: "Frost.", params: HISTORY }, CREATE)
		const all = await rows(w.book.id)
		expect(all).toHaveLength(2)
		expect(res.id).not.toBe(older.id)
		const made = (await entry(res.id))!
		expect(made.fields).toMatchObject({ year: 8, month: 2, day: 3 })
		expect(made.content).toBe("Frost.")
		expect(made.provenance).toBe("pipeline")
		// An attached-book write has no turn anchor (`loreWriteTargetFor`: null).
		expect(made.sourceMessageId).toBeNull()
		expect((await entry(older.id))!.content).toBe("Spring.")
		void m
	})

	it("a month or a day without a year is refused, and nothing is written", async () => {
		const w = await world()
		await w.message()
		await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "Spring." })
		await expect(
			(await w.host()).commit!({ content: "Rain.", params: HISTORY, fields: { month: 3 } }, CREATE)
		).rejects.toThrow(/a history date needs a year/)
		expect(await rows(w.book.id)).toHaveLength(1)
	})

	it("a database fault is not worded as a refusal", async () => {
		const w = await world()
		await w.message()
		const { HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		class Fault extends Error {}
		const boom = new Fault("connection lost")
		fault.next = boom
		const got = await (await w.host())
			.commit!({ content: "Rain.", params: HISTORY, fields: { year: 3, month: 1, day: 1 } }, CREATE)
			.catch((e: unknown) => e)
		expect(got).toBe(boom)
		expect(got).not.toBeInstanceOf(HostScopeError)
		expect(await rows(w.book.id)).toHaveLength(0)
	})

	it("a retake takes the paragraph back, and removes a day entry the write made", async () => {
		const w = await world()
		const dated = await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "Spring." })
		const m = await w.message()
		await (await w.host("run-r1")).commit!({ content: "Rain.", params: HISTORY }, CREATE)
		expect((await entry(dated.id))!.content).toBe("Spring.\n\nRain.")
		await swipe(m.id)
		expect((await entry(dated.id))!.content).toBe("Spring.")

		const m2 = await w.message()
		const made: any = await (await w.host("run-r2")).commit!(
			{ content: "Snow.", params: HISTORY, fields: { year: 6, month: 1, day: 1 } },
			CREATE
		)
		expect(await entry(made.id)).toBeDefined()
		await swipe(m2.id)
		expect(await entry(made.id)).toBeUndefined()
		expect((await rows(w.book.id)).map((r) => r.id)).toEqual([dated.id])
	})

	it("on a fork, a date after the fork lands on the branch; one on or before it is refused and leaves no row on main", async () => {
		const w = await world({ fork: true })
		await w.message()
		const h = await w.host()
		const res: any = await h.commit!({ content: "Later.", params: HISTORY, fields: { year: 6, month: 1, day: 1 } }, CREATE)
		expect((await entry(res.id))!.branchId).toBe(w.fork!.id)
		await expect(
			h.commit!({ content: "Earlier.", params: HISTORY, fields: { year: 3, month: 1, day: 1 } }, CREATE)
		).rejects.toThrow(/shares everything up to/)
		const all = await rows(w.book.id)
		expect(all).toHaveLength(1)
		expect(all[0]!.id).toBe(res.id)
	})

	it("a fork refusal creates nothing anywhere in the book", async () => {
		const w = await world({ fork: true })
		await w.message()
		const h = await w.host()
		await expect(
			h.commit!({ content: "On the fork day.", params: HISTORY, fields: { year: 4 } }, CREATE)
		).rejects.toThrow(/shares everything up to/)
		await expect(
			h.commit!({ content: "Before.", params: HISTORY, fields: { year: 2 } }, CREATE)
		).rejects.toThrow(/shares everything up to/)
		expect(await rows(w.book.id)).toHaveLength(0)
	})

	it("with no year and no dated history the session reads, it is refused and nothing changes", async () => {
		const w = await world()
		await w.message()
		const legacy = await history(w.book.id, {}, { content: "Long ago." })
		await expect(
			(await w.host()).commit!({ content: "Now.", params: HISTORY }, CREATE)
		).rejects.toThrow(/history needs a date/)
		const all = await rows(w.book.id)
		expect(all).toHaveLength(1)
		expect(all[0]!.id).toBe(legacy.id)
		expect((await entry(legacy.id))!.content).toBe("Long ago.")
	})
})

describe("update-lore-entry moving a history entry's date", () => {
	it("refuses a re-date onto a taken day", async () => {
		const w = await world({ own: true })
		await w.message()
		await history(w.book.id, { year: 2, month: 1, day: 1 })
		const other = await history(w.book.id, { year: 3, month: 1, day: 1 })
		await expect(
			(await w.host()).commit!({ entry: other.id, fields: { year: 2, month: 1, day: 1 } }, UPDATE)
		).rejects.toThrow(/already has a history entry for/)
		expect((await entry(other.id))!.fields).toMatchObject({ year: 3 })
	})

	it("refuses a branch entry re-dated on or before the fork", async () => {
		const w = await world({ fork: true, own: true })
		await w.message()
		const mine = await history(w.book.id, { year: 6, month: 1, day: 1 }, { branchId: w.fork!.id })
		await expect(
			(await w.host()).commit!({ entry: mine.id, fields: { year: 3, month: 1, day: 1 } }, UPDATE)
		).rejects.toThrow(/shares everything up to/)
		expect((await entry(mine.id))!.fields).toMatchObject({ year: 6 })
	})

	it("refuses a date the book cannot place", async () => {
		const w = await world({ own: true })
		await w.message()
		const e = await history(w.book.id, { year: 2, month: 1, day: 1 })
		await expect(
			(await w.host()).commit!({ entry: e.id, fields: { year: 2, month: null, day: 3 } }, UPDATE)
		).rejects.toThrow(/can't be saved|does not fit this book's calendar/)
		expect((await entry(e.id))!.fields).toMatchObject({ month: 1 })
	})

	it("lets a save resend the stored date on a doubled date and change the content", async () => {
		const w = await world({ own: true })
		await w.message()
		const a = await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "One." })
		await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "Two." })
		await (await w.host()).commit!(
			{ entry: a.id, content: "One, revised.", fields: { year: 5, month: 1, day: 1 } },
			UPDATE
		)
		expect((await entry(a.id))!.content).toBe("One, revised.")
	})

	it("holds a session's change to an attached lorebook's history entry, and refuses to move its date", async () => {
		const w = await world()
		await w.message()
		const e = await history(w.book.id, { year: 2, month: 1, day: 1 }, { content: "One." })
		const h = await w.host()
		await expect(h.commit!({ entry: e.id, fields: { year: 3, month: 1, day: 1 } }, UPDATE)).rejects.toThrow(
			/keeps its date in the lorebook/
		)
		expect(await db.select().from(schema.entryAmendments)).toHaveLength(0)
		// A save that resends the stored date changes only what differs: held, never re-dated.
		await h.commit!({ entry: e.id, content: "One, revised.", fields: { year: 2, month: 1, day: 1 } }, UPDATE)
		expect((await entry(e.id))!.content).toBe("One.")
		const held = await db.select().from(schema.entryAmendments)
		expect(held).toHaveLength(1)
		expect(held[0]!.fields).toEqual({ content: "One, revised." })
	})
})

describe("create-lore-entry with the history entry type (a session whose scenes end by themselves, under Full)", () => {
	const ownDays = async (w: Awaited<ReturnType<typeof world>>) => {
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		return rows((await ownBookFor(db as unknown as Db, w.session.id)).id)
	}

	it("files onto the own book's day: two writes for one date make one row there, and the lorebook is untouched", async () => {
		const w = await world({ scenesEnd: true })
		await w.message()
		const h = await w.host()
		const date = { year: 3, month: 2, day: 9 }
		const first: any = await h.commit!({ content: "The gate fell.", params: HISTORY, fields: date }, CREATE)
		const second: any = await h.commit!({ content: "The bells rang.", params: HISTORY, fields: date }, CREATE)
		const own = await ownDays(w)
		expect(own).toHaveLength(1)
		expect(own[0]!.content).toBe("The gate fell.\n\nThe bells rang.")
		expect(first).toMatchObject({ id: own[0]!.id, route: "own-book", lorebookId: own[0]!.lorebookId })
		expect(second).toMatchObject({ id: own[0]!.id, matched: true, written: false })
		expect(await rows(w.book.id)).toHaveLength(0)
	})

	it("leaves the lorebook's own day for that date as it was, and makes the own book's", async () => {
		const w = await world({ scenesEnd: true })
		await w.message()
		const lore = await history(w.book.id, { year: 3, month: 2, day: 9 }, { content: "Lorebook day." })
		const res: any = await (await w.host()).commit!(
			{ content: "Mine.", params: HISTORY, fields: { year: 3, month: 2, day: 9 } },
			CREATE
		)
		expect(res.id).not.toBe(lore.id)
		expect((await entry(lore.id))!.content).toBe("Lorebook day.")
		expect(await rows(w.book.id)).toHaveLength(1)
		const own = await ownDays(w)
		expect(own.map((r) => r.id)).toEqual([res.id])
		expect(own[0]!.content).toBe("Mine.")
	})

	it("with no fields it counts the own book's days: the newest of the two books", async () => {
		const w = await world({ scenesEnd: true })
		await w.message()
		await history(w.book.id, { year: 5, month: 1, day: 1 }, { content: "Spring." })
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const mine = await history((await ownBookFor(db as unknown as Db, w.session.id)).id, { year: 7, month: 1, day: 1 }, { content: "Summer." })
		const res: any = await (await w.host()).commit!({ content: "Heat.", params: HISTORY }, CREATE)
		expect(res.id).toBe(mine.id)
		expect((await entry(mine.id))!.content).toBe("Summer.\n\nHeat.")
		expect(await rows(w.book.id)).toHaveLength(1)
	})

	it("forks no line: a session riding its parent's line, and a session on a fork, stay where they are", async () => {
		const w = await world({ fork: true, scenesEnd: true })
		await w.message()
		await db.update(schema.sessions).set({ lineOnFirstWrite: true }).where(eq(schema.sessions.id, w.session.id))
		await (await w.host()).commit!(
			{ content: "Later.", params: HISTORY, fields: { year: 6, month: 1, day: 1 } },
			CREATE
		)
		const [s] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(s!.lineOnFirstWrite).toBe(true)
		expect(s!.lorebookBranchId).toBe(w.fork!.id)
		expect(
			await db.select().from(schema.lorebookBranches).where(eq(schema.lorebookBranches.lorebookId, w.book.id))
		).toHaveLength(1)
		expect(await rows(w.book.id)).toHaveLength(0)
		expect(await ownDays(w)).toHaveLength(1)
	})
})
