/**
 * The calendar invariants hold everywhere (plan lorebooks consolidation A18).
 *
 * "Once a calendar is declared, the preflight list cannot refill": every
 * dated row is checked at the door, and the calendar is declared only over
 * dates it can place. Four holes, each pinned here:
 *
 *  - (a) a story-time stat is a dated row: the preflight lists it, and a
 *    write the book's calendar cannot place is refused;
 *  - (b) a date is part of the entry, never of an amendment (owner ruling,
 *    2026-09-30): an amendment naming a date part is refused;
 *  - (c) an import declares the file's calendar only over dates it can place
 *    — the file's own history, and on an overwrite the clocks of the
 *    sessions already reading the book — and says so when it cannot;
 *  - (d) a calendar change and a dated write never interleave: each checks
 *    and writes in one transaction under the book's lock.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import type { StoryCalendar } from "$lib/shared/lorebooks/storyDate"
import { defineAttributeSlot, genre } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
// A session's settings save tells the session's other readers; nobody is
// connected here.
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (orig) => ({
	...(await orig<any>()),
	broadcastToSessionUsers: vi.fn(async () => {})
}))
vi.mock("$lib/server/sessions/rowPush", async (orig) => ({
	...(await orig<any>()),
	broadcastSessionRow: vi.fn(() => {})
}))
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (orig) => ({
	...(await orig<any>()),
	emitSessionEvent: vi.fn(async () => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-calendar-invariants-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const born = defineAttributeSlot(BORN, {
		shape: "core:stat-shape/story-time@1",
		descriptor: "When they were born.",
		appliesTo: ["cast", "world", "location"]
	})
	genre(GENRE, { name: { en: "Born" }, family: "test", slots: [born], events: {} })
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const BORN = "test:slot/born@1"
const GENRE = "test:genre/calendar-invariants"

/** Three months: Thaw 30, Bloom 31, Ember 28. */
const THAW: StoryCalendar = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	weekdays: ["Moonday", "Ashday", "Restday"],
	firstWeekday: 0,
	yearLabel: "Year"
}

const socketOf = (userId: number) =>
	({
		user: { id: userId },
		io: { to: () => ({ emit() {} }) },
		emit() {},
		join() {},
		rooms: new Set()
	}) as any
const noop = () => {}

let n = 0
async function book(calendar: StoryCalendar | null = null) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `calendar-invariants-${++n}`)
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Ashfall ${n}`, userId: user.id, storyCalendar: calendar })
		.returning()
	return { user, book: row! }
}

async function history(
	userId: number,
	lorebookId: number,
	date: { year: number; month?: number | null; day?: number | null }
) {
	const { createEntryHandler } = await import("./entries")
	const { entry } = (await createEntryHandler.handler(
		socketOf(userId),
		{
			entry: {
				lorebookId,
				typeId: HISTORY_TYPE_ID,
				content: "Something happened.",
				year: date.year,
				month: date.month ?? null,
				day: date.day ?? null
			} as any
		},
		noop
	)) as any
	return entry
}

async function stranded(userId: number, lorebookId: number, calendar: StoryCalendar) {
	const { lorebookCheckCalendarHandler } = await import("./lorebookStoryTime")
	const check = (await lorebookCheckCalendarHandler.handler(
		socketOf(userId),
		{ lorebookId, calendar },
		noop
	)) as any
	return check.stranded as { key: string; label: string; problem: string }[]
}

describe("(b) a date is part of the entry, never of an amendment", () => {
	test("amendments:create refuses an amendment naming a date part, and files one naming none", async () => {
		const { user, book: b } = await book()
		const entry = await history(user.id, b.id, { year: 3, month: 1 })
		const { amendmentsCreateHandler } = await import("./amendments")
		const create = (fields: Record<string, unknown>) =>
			amendmentsCreateHandler.handler(
				socketOf(user.id),
				{ lorebookId: b.id, entryId: entry.id, year: 5, fields } as any,
				noop
			)
		await expect(create({ year: 4, content: "Moved." })).rejects.toThrow(
			/can't change when an entry happened/
		)
		await expect(create({ day: 2 })).rejects.toThrow(/can't change when an entry happened/)
		await create({ content: "Later." })
		const rows = await testDb
			.select({ fields: schema.entryAmendments.fields })
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.entryId, entry.id))
		expect(rows.map((r) => r.fields)).toEqual([{ content: "Later." }])
	})

	test("amendments:update refuses fields naming a date part, and leaves the amendment as it was", async () => {
		const { user, book: b } = await book()
		const entry = await history(user.id, b.id, { year: 3 })
		const { amendmentsCreateHandler, amendmentsUpdateHandler } = await import("./amendments")
		await amendmentsCreateHandler.handler(
			socketOf(user.id),
			{ lorebookId: b.id, entryId: entry.id, year: 5, fields: { content: "Later." } } as any,
			noop
		)
		const [row] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.entryId, entry.id))
		await expect(
			amendmentsUpdateHandler.handler(
				socketOf(user.id),
				{
					lorebookId: b.id,
					subject: "entry",
					id: row!.id,
					fields: { month: 2, content: "Later." }
				} as any,
				noop
			)
		).rejects.toThrow(/can't change when an entry happened/)
		const [after] = await testDb
			.select({ fields: schema.entryAmendments.fields })
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, row!.id))
		expect(after!.fields).toEqual({ content: "Later." })
	})
})

describe("(a) a story-time stat is a dated row", () => {
	test("the preflight lists the book's, a member's, a place's and a session's story-time stats; never a card's", async () => {
		const { user, book: b } = await book()
		const [member] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: b.id, binding: "{{char:1}}", name: "Maren" })
			.returning()
		const [place] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: b.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: 0,
				title: "The Harbour",
				content: ""
			})
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Run", lorebookId: b.id })
			.returning()
		const value = (ownerKind: string, ownerId: number, v: string, sessionId: number | null = null) =>
			testDb
				.insert(schema.attributeValues)
				.values({ ownerKind, ownerId, slotId: BORN, value: { v }, sessionId })
				.returning()
				.then((r) => r[0]!.id)
		const ids = {
			book: await value("lorebook", b.id, "3-04-01"),
			member: await value("cast_member", member!.id, "3-02-32"),
			place: await value("location", place!.id, "3-03-29"),
			session: await value("session", session!.id, "3-01-31 10:00", session!.id),
			fits: await value("cast_member", member!.id, "3-03-28"),
			// A card is shared between books: its layer belongs to none of them.
			card: await value("card", member!.id, "3-09-01")
		}

		const keys = (await stranded(user.id, b.id, THAW)).map((s) => s.key)
		expect(keys).toEqual(
			expect.arrayContaining([
				`stat:${ids.book}`,
				`stat:${ids.member}`,
				`stat:${ids.place}`,
				`stat:${ids.session}`
			])
		)
		expect(keys).not.toContain(`stat:${ids.fits}`)
		expect(keys).not.toContain(`stat:${ids.card}`)

		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		await expect(
			lorebookSetCalendarHandler.handler(socketOf(user.id), { lorebookId: b.id, calendar: THAW }, noop)
		).rejects.toThrow(/4 dated rows do not fit/)
	})

	test("once declared, a story-time stat the calendar cannot place is refused at the write", async () => {
		const { user, book: b } = await book(THAW)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Run", lorebookId: b.id })
			.returning()
		const { setValue } = await import("$lib/server/state/write")
		const ctx = { sessionId: session!.id, updatedBy: "user" as const }
		const owner = { kind: "session" as const, id: session!.id }
		await expect(
			setValue(testDb as any, ctx, { owner, slotId: BORN, value: "3-03-29" })
		).rejects.toThrow(/does not fit this book's calendar/)
		await setValue(testDb as any, ctx, { owner, slotId: BORN, value: "3-03-28" })
		const rows = await testDb
			.select({ value: schema.attributeValues.value })
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, session!.id))
		expect(rows.map((r) => r.value.v)).toEqual(["3-03-28"])
	})
})

describe("(a) a story time reaches a book only through a door that checks it", () => {
	test("recording a session onto the timeline files no story time the book's calendar cannot place", async () => {
		const { user, book: b } = await book(THAW)
		await testDb.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
		const [verity] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Verity", description: "…" })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Run", genreId: GENRE, lorebookId: b.id })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: verity!.id })
		const [member] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: b.id, characterId: verity!.id, binding: "{{char:1}}", name: "Verity" })
			.returning()
		// The card's own layer: shared between books, so no calendar checks it.
		await testDb
			.insert(schema.attributeValues)
			.values({ ownerKind: "card", ownerId: verity!.id, slotId: BORN, value: { v: "3-05-01" } })

		const { recordToTimeline } = await import("$lib/server/state/durable")
		const report = await recordToTimeline(testDb as any, session!.id, { reason: "delete" })

		expect(report.refused.join(" ")).toMatch(/does not fit this book's calendar: There is no month 5/)
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "cast_member"),
					eq(schema.attributeValues.ownerId, member!.id)
				)
			)
		expect(rows).toEqual([])
		expect(await stranded(user.id, b.id, THAW)).toEqual([])
	})

	async function readingFreeForm() {
		const { user, book: free } = await book()
		const [cal] = await testDb
			.insert(schema.lorebooks)
			.values({ name: `Calendared ${n}`, userId: user.id, storyCalendar: THAW })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Wanderer", lorebookId: free.id })
			.returning()
		// Placed in the free-form book, where month 5 is a month.
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			testDb as any,
			{ sessionId: session!.id, updatedBy: "user" },
			{ owner: { kind: "session", id: session!.id }, slotId: BORN, value: "3-05-01" }
		)
		return { user, free, cal: cal!, session: session! }
	}

	const lorebookOf = async (sessionId: number) =>
		(
			await testDb
				.select({ lorebookId: schema.sessions.lorebookId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
		)[0]!.lorebookId

	test("a session whose story-time stats the new book's calendar cannot place is refused the switch, and stays", async () => {
		const { user, free, cal, session } = await readingFreeForm()
		const { sessionsUpdateHandler } = await import("./sessions")
		await expect(
			sessionsUpdateHandler.handler(
				socketOf(user.id),
				{ session: { id: session.id, lorebookId: cal.id } } as any,
				noop
			)
		).rejects.toThrow(
			/calendar can't place a date this session holds: The stat .* in the session “Wanderer” \(There is no month 5/
		)
		expect(await lorebookOf(session.id)).toBe(free.id)
		expect(await stranded(user.id, cal.id, THAW)).toEqual([])
	})

	test("attaching the book from the lorebook side is refused the same way, in words", async () => {
		const { user, free, cal, session } = await readingFreeForm()
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const said: { event: string; data: any }[] = []
		await expect(
			sessionsSetLorebookHandler.handler(
				socketOf(user.id),
				{ sessionId: session.id, lorebookId: cal.id },
				(event: string, data: any) => void said.push({ event, data })
			)
		).rejects.toThrow(/calendar can't place a date this session holds/)
		expect(said.find((s) => s.event === "sessions:setLorebook:error")?.data.error).toMatch(
			/There is no month 5/
		)
		expect(await lorebookOf(session.id)).toBe(free.id)
		expect(await stranded(user.id, cal.id, THAW)).toEqual([])
	})
})

const FIXTURE = JSON.parse(
	readFileSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"fixtures/lorebook-0.5.3-export.json"
		),
		"utf-8"
	)
)
/** The 0.5.3 fixture with a story time: its history is dated 1203-4-12 and 1204. */
const fileWith = (storyTime: unknown, name?: string) => {
	const file = JSON.parse(JSON.stringify(FIXTURE))
	file.extensions.serenepub.storyTime = storyTime
	if (name) {
		file.name = name
		file.extensions.serenepub.uuid = undefined
	}
	return file
}

async function importFile(userId: number, file: object) {
	const { lorebookImportHandler } = await import("./lorebooks")
	return (await lorebookImportHandler.handler(
		socketOf(userId),
		{ lorebookJson: JSON.stringify(file) },
		noop
	)) as any
}

describe("(c) an import declares the file's calendar only over dates it can place", () => {
	test("a file whose history the calendar cannot place comes in free-form, and the reply says why", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "calendar-import-history")
		const res = await importFile(
			user.id,
			fileWith({ calendar: THAW, clock: { year: 1204, month: 1, day: 3 } }, "Stranded history")
		)
		expect(res.status).toBe("created")
		const [row] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, res.lorebook.id))
		expect(row!.storyCalendar).toBeNull()
		// The clock still lands free-form, so it stays.
		expect([row!.storyClockYear, row!.storyClockMonth, row!.storyClockDay]).toEqual([1204, 1, 3])
		expect((res.warnings ?? []).join(" ")).toMatch(/calendar was left out.*1 date/i)
	})

	test("a file whose history the calendar places keeps it", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "calendar-import-fits")
		const file = fileWith({ calendar: THAW, clock: null }, "Fits")
		for (const e of file.entries)
			if (e.extensions?.serenepub?.month === 4) e.extensions.serenepub.month = 3
		const res = await importFile(user.id, file)
		const [row] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, res.lorebook.id))
		expect(row!.storyCalendar).toEqual(THAW)
		expect((res.warnings ?? []).join(" ")).not.toMatch(/calendar/i)
	})

	test("a file whose calendar cannot be read comes in free-form, and the reply says so", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "calendar-import-malformed")
		const res = await importFile(user.id, fileWith({ calendar: { months: [] }, clock: null }, "Malformed"))
		const [row] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, res.lorebook.id))
		expect(row!.storyCalendar).toBeNull()
		expect((res.warnings ?? []).join(" ")).toMatch(/calendar could not be read/i)
	})

	test("an overwrite leaves the calendar out when a session reading the book stands on a date it cannot place", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { lorebookImportResolveHandler } = await import("./lorebooks")
		const user = await createTestUser(testDb, "calendar-overwrite-session")
		const plain = fileWith({ calendar: null, clock: null }, "Overwritten")
		// One uuid across both files: the second is this book again.
		plain.extensions.serenepub.uuid = "4b1d3c2e-5f60-4a71-8b92-a3c4d5e6f708"
		for (const e of plain.entries)
			if (e.extensions?.serenepub?.month === 4) e.extensions.serenepub.month = 3
		const created = await importFile(user.id, plain)
		const bookId = created.lorebook.id
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: "Late in Ember",
				lorebookId: bookId,
				storyClockYear: 1204,
				storyClockMonth: 3,
				storyClockDay: 30
			} as any)
			.returning()

		const withCalendar = JSON.parse(JSON.stringify(plain))
		withCalendar.extensions.serenepub.storyTime = { calendar: THAW, clock: null }
		const conflict = await importFile(user.id, withCalendar)
		expect(conflict.status).toBe("conflict")
		const res = (await lorebookImportResolveHandler.handler(
			socketOf(user.id),
			{ action: "overwrite", heldImportId: conflict.conflict.heldImportId, existingId: bookId },
			noop
		)) as any

		const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, bookId))
		expect(row!.storyCalendar).toBeNull()
		const [kept] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session!.id))
		expect([kept!.storyClockYear, kept!.storyClockMonth, kept!.storyClockDay]).toEqual([1204, 3, 30])
		expect((res.warnings ?? []).join(" ")).toMatch(/Late in Ember/)
	})
})

describe("(d) a calendar change and a dated write never interleave", () => {
	test("racing a dated write against the calendar that cannot place it never leaves the date stranded", async () => {
		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		const { datedRowsOf } = await import("$lib/server/state/storyTime")
		const { datesThatDoNotLand } = await import("$lib/shared/lorebooks/storyDate")
		const strandedAfter: number[] = []
		for (let round = 0; round < 6; round++) {
			const { user, book: b } = await book()
			await Promise.allSettled([
				history(user.id, b.id, { year: 3, month: 3, day: 30 }),
				lorebookSetCalendarHandler.handler(
					socketOf(user.id),
					{ lorebookId: b.id, calendar: THAW },
					noop
				)
			])
			const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, b.id))
			if (row!.storyCalendar)
				strandedAfter.push(
					datesThatDoNotLand(await datedRowsOf(testDb as any, b.id), THAW).length
				)
		}
		expect(strandedAfter.every((count) => count === 0), JSON.stringify(strandedAfter)).toBe(true)
	})

	test("racing the next entry in sequence against the calendar never leaves the new date stranded", async () => {
		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		const { iterateNextEntryHandler } = await import("./entries")
		const { datedRowsOf } = await import("$lib/server/state/storyTime")
		const { datesThatDoNotLand } = await import("$lib/shared/lorebooks/storyDate")
		const strandedAfter: string[][] = []
		for (let round = 0; round < 6; round++) {
			const { user, book: b } = await book()
			// Free-form, the next date is 3-3-29; under the calendar Ember
			// has 28 days, so there it is 4-1-1.
			const from = await history(user.id, b.id, { year: 3, month: 3, day: 28 })
			await Promise.allSettled([
				iterateNextEntryHandler.handler(
					socketOf(user.id),
					{ id: from.id, typeId: HISTORY_TYPE_ID } as any,
					noop
				),
				lorebookSetCalendarHandler.handler(
					socketOf(user.id),
					{ lorebookId: b.id, calendar: THAW },
					noop
				)
			])
			const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, b.id))
			if (row!.storyCalendar)
				strandedAfter.push(
					datesThatDoNotLand(await datedRowsOf(testDb as any, b.id), THAW).map((s) => s.problem)
				)
		}
		expect(strandedAfter.every((s) => s.length === 0), JSON.stringify(strandedAfter)).toBe(true)
	})

	test("a calendar declared while a session's clock is being set never leaves the clock stranded", async () => {
		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		const { sessionsUpdateHandler } = await import("./sessions")
		const storyTime = await import("$lib/server/state/storyTime")
		const { datesThatDoNotLand } = await import("$lib/shared/lorebooks/storyDate")
		const { user, book: b } = await book()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Clocked", lorebookId: b.id })
			.returning()
		// The calendar is declared right after the clock's check reads the
		// book's calendar, and before the clock is written: the read waits
		// while the test (outside any transaction) declares it.
		const original = storyTime.bookCalendarOf
		let readDone!: () => void
		const read = new Promise<void>((r) => (readDone = r))
		let proceed!: () => void
		const resume = new Promise<void>((r) => (proceed = r))
		let armed = true
		const spy = vi.spyOn(storyTime, "bookCalendarOf").mockImplementation(async (handle, id) => {
			const calendar = await original(handle, id)
			if (armed && id === b.id) {
				armed = false
				readDone()
				await resume
			}
			return calendar
		})
		let declared: Promise<unknown> | undefined
		try {
			const saving = sessionsUpdateHandler
				.handler(
					socketOf(user.id),
					{
						session: { id: session!.id, storyClockYear: 3, storyClockMonth: 3, storyClockDay: 29 }
					} as any,
					noop
				)
				.catch((e: Error) => e)
			await Promise.race([read, saving])
			declared = lorebookSetCalendarHandler
				.handler(socketOf(user.id), { lorebookId: b.id, calendar: THAW }, noop)
				.catch((e: Error) => e)
			await new Promise((r) => setTimeout(r, 300))
			proceed()
			await saving
			await declared
		} finally {
			spy.mockRestore()
		}
		expect(armed, "the clock's check read the calendar").toBe(false)
		const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, b.id))
		const left = row!.storyCalendar
			? datesThatDoNotLand(await storyTime.datedRowsOf(testDb as any, b.id), THAW).map((x) => x.problem)
			: []
		expect(left).toEqual([])
	})
})
