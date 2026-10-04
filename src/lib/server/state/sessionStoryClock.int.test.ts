/**
 * The session story clock (DESIGN-story-time P3, owner ruling 2026-09-28).
 *
 * A session has its OWN story now, stored on the session
 * (`sessions.story_clock_*`) — the same five columns the book and each line
 * carry. It is what the session's reading stands at: the prompt's current
 * date, `age`, and the durable stats it inherits.
 *
 *  1. Attaching a book stores NO clock: the session follows its line's
 *     present (the line's clock, else its newest history entry) — today's
 *     behaviour (owner 2026-09-28). The first set or step starts FROM that
 *     present; a create or save may name a clock outright.
 *  2. Setting it never moves the book's present.
 *  3. `advance(n, unit)` moves it by the book's calendar, or by the
 *     smallest-part rule in a free-form book …
 *  4. … and is refused with a sentence when the result does not land.
 *  5. The prompt's `currentDate` reads it.
 *  6. Two sessions on one book keep different nows.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-session-story-clock-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const THAW = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	yearLabel: "Year"
}

let n = 0
const db = () => testDb as unknown as Db

async function book(opts: { calendar?: unknown; clock?: { year: number; month?: number; day?: number } } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `session-story-clock-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			storyCalendar: (opts.calendar ?? null) as any,
			storyClockYear: opts.clock?.year ?? null,
			storyClockMonth: opts.clock?.month ?? null,
			storyClockDay: opts.clock?.day ?? null
		})
		.returning()
	const dated = async (fields: Record<string, unknown>) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					position: ++n,
					title: null,
					content: "…",
					fields
				})
				.returning()
		)[0]
	return { user, verity, lorebook, dated }
}
type Book = Awaited<ReturnType<typeof book>>

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) }
	}) as any
const noEmit = () => {}

async function create(b: Book, session: Record<string, unknown> = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const created: any = await sessionsCreateHandler.handler(
		fakeSocket(b.user.id),
		{ session: { name: `Run ${++n}`, lorebookId: b.lorebook.id, ...session }, characterIds: [b.verity.id] } as any,
		noEmit
	)
	return created.session.id as number
}

async function update(b: Book, session: Record<string, unknown>) {
	const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
	return sessionsUpdateHandler.handler(fakeSocket(b.user.id), { session } as any, noEmit)
}

const clockRow = async (sessionId: number) => {
	const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return {
		year: row.storyClockYear,
		month: row.storyClockMonth,
		day: row.storyClockDay,
		hour: row.storyClockHour,
		minute: row.storyClockMinute
	}
}

const bookNow = async (b: Book) => {
	const { storyNowOf } = await import("$lib/server/state/storyTime")
	return storyNowOf(db(), b.lorebook.id)
}

const sessionNow = async (sessionId: number) => {
	const { sessionLinks } = await import("$lib/server/state/resolve")
	return (await sessionLinks(db(), sessionId)).storyDate
}

describe("1 · where the clock starts", () => {
	test("attaching a book stores no clock: the session follows the line's present — its newest entry", async () => {
		const b = await book()
		await b.dated({ year: 3, month: 2 })
		await b.dated({ year: 5, month: 1, day: 9 })
		const s = await create(b)
		expect((await clockRow(s)).year).toBeNull()
		expect(await sessionNow(s)).toEqual({ year: 5, month: 1, day: 9 })
		// The first step starts FROM that present, and only then is a clock stored.
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		expect((await advanceSessionStoryClock(db(), s, 2, "days")).clock).toEqual({ year: 5, month: 1, day: 11 })
		expect(await clockRow(s)).toMatchObject({ year: 5, month: 1, day: 11 })
	})

	test("… or the line's stored clock, when it has one", async () => {
		const b = await book({ clock: { year: 12, month: 4 } })
		await b.dated({ year: 5 })
		const s = await create(b)
		expect((await clockRow(s)).year).toBeNull()
		expect(await sessionNow(s)).toEqual({ year: 12, month: 4 })
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		expect((await advanceSessionStoryClock(db(), s, 1, "months")).clock).toEqual({ year: 12, month: 5 })
	})

	test("a clock named on the create is stored outright", async () => {
		const b = await book()
		await b.dated({ year: 5 })
		const s = await create(b, { storyClockYear: 2, storyClockMonth: 7 })
		expect(await clockRow(s)).toMatchObject({ year: 2, month: 7, day: null })
	})

	test("a book with no present leaves the clock unset: it follows the line", async () => {
		const b = await book()
		const s = await create(b)
		expect((await clockRow(s)).year).toBeNull()
		await b.dated({ year: 9 })
		expect(await sessionNow(s)).toEqual({ year: 9 })
	})

	test("attaching a book to a session that had none follows it too; switching books clears a clock", async () => {
		const b = await book()
		await b.dated({ year: 6 })
		const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(b.user.id),
			{ session: { name: "Bookless" }, characterIds: [b.verity.id] } as any,
			noEmit
		)
		const s = created.session.id as number
		expect((await clockRow(s)).year).toBeNull()
		await update(b, { id: s, lorebookId: b.lorebook.id })
		expect((await clockRow(s)).year).toBeNull()
		expect(await sessionNow(s)).toEqual({ year: 6 })
		// A clock is a date on THIS book's calendar: switching books drops it.
		await update(b, { id: s, storyClockYear: 40 })
		expect((await clockRow(s)).year).toBe(40)
		const other = await book()
		await testDb.update(schema.lorebooks).set({ userId: b.user.id }).where(eq(schema.lorebooks.id, other.lorebook.id))
		await update(b, { id: s, lorebookId: other.lorebook.id })
		expect((await clockRow(s)).year).toBeNull()
	})
})

describe("2 · setting it never moves the book", () => {
	test("the settings save sets the session's story clock; the book's present stays", async () => {
		const b = await book({ calendar: THAW })
		await b.dated({ year: 5, month: 1, day: 3 })
		const s = await create(b)
		await update(b, { id: s, storyClockYear: 40, storyClockMonth: 2, storyClockDay: 1, storyClockHour: 7, storyClockMinute: 15 })
		expect(await clockRow(s)).toEqual({ year: 40, month: 2, day: 1, hour: 7, minute: 15 })
		expect(await bookNow(b)).toMatchObject({ year: 5, month: 1, day: 3, from: "history" })
		const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, b.lorebook.id))
		expect(row.storyClockYear).toBeNull()
	})

	test("a clock that does not land in the book's calendar is refused", async () => {
		const b = await book({ calendar: THAW })
		await b.dated({ year: 5, month: 1, day: 3 })
		const s = await create(b)
		await expect(update(b, { id: s, storyClockYear: 5, storyClockMonth: 3, storyClockDay: 31 })).rejects.toThrow(
			/Ember has 28 days/
		)
	})

	test("clearing it follows the line's present again", async () => {
		const b = await book()
		await b.dated({ year: 5 })
		const s = await create(b, { storyClockYear: 2 })
		await update(b, { id: s, storyClockYear: null })
		expect((await clockRow(s)).year).toBeNull()
		expect(await sessionNow(s)).toEqual({ year: 5 })
	})
})

describe("3–4 · advance", () => {
	test("by the book's calendar: days carry through month ends", async () => {
		const b = await book({ calendar: THAW })
		await b.dated({ year: 5, month: 1, day: 29 })
		const s = await create(b)
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		const r = await advanceSessionStoryClock(db(), s, 3, "days")
		expect(r.clock).toEqual({ year: 5, month: 2, day: 2 })
		expect(r.label).toBe("2 Bloom, Year 5")
		expect(await clockRow(s)).toMatchObject({ year: 5, month: 2, day: 2 })
		// The book did not move.
		expect(await bookNow(b)).toMatchObject({ year: 5, month: 1, day: 29, from: "history" })
	})

	test("free-form: the smallest-part rule — nothing rolls over", async () => {
		const b = await book()
		await b.dated({ year: 5, month: 1, day: 29 })
		const s = await create(b)
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		expect((await advanceSessionStoryClock(db(), s, 5, "days")).clock).toEqual({ year: 5, month: 1, day: 34 })
		expect((await advanceSessionStoryClock(db(), s, 26, "hours")).clock).toEqual({
			year: 5,
			month: 1,
			day: 35,
			hour: 2,
			minute: 0
		})
	})

	test("a session with no clock of its own starts from its line's present", async () => {
		const b = await book()
		const s = await create(b)
		await b.dated({ year: 8, month: 3 })
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		expect((await advanceSessionStoryClock(db(), s, 1, "years")).clock).toEqual({ year: 9, month: 3 })
	})

	test("refused with a sentence when the result does not land, and nothing is written", async () => {
		const b = await book({ calendar: THAW })
		await b.dated({ year: 5, month: 2, day: 31 })
		const s = await create(b)
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		await expect(advanceSessionStoryClock(db(), s, 1, "months")).rejects.toThrow(/Ember has 28 days/)
		// Nothing written: still no clock of its own, still following the line.
		expect((await clockRow(s)).year).toBeNull()
		expect(await sessionNow(s)).toEqual({ year: 5, month: 2, day: 31 })
		// The same refusal once it has a clock of its own leaves that clock where it was.
		await update(b, { id: s, storyClockYear: 5, storyClockMonth: 2, storyClockDay: 31 })
		await expect(advanceSessionStoryClock(db(), s, 1, "months")).rejects.toThrow(/Ember has 28 days/)
		expect(await clockRow(s)).toMatchObject({ year: 5, month: 2, day: 31 })
	})

	test("two advances at once both land: read, stepped and written under one lock", async () => {
		const b = await book()
		await b.dated({ year: 5, month: 1, day: 10 })
		const s = await create(b)
		await update(b, { id: s, storyClockYear: 5, storyClockMonth: 1, storyClockDay: 10 })
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		// Read apart from the write, both stepped from day 10 and the second
		// wrote over the first: two days forward landed one.
		await Promise.all([
			advanceSessionStoryClock(db(), s, 1, "days"),
			advanceSessionStoryClock(db(), s, 1, "days")
		])
		expect(await clockRow(s)).toMatchObject({ year: 5, month: 1, day: 12 })
	})

	test("refused with no book and with no present to start from", async () => {
		const b = await book()
		const s = await create(b)
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		await expect(advanceSessionStoryClock(db(), s, 1, "days")).rejects.toThrow(/no present/)
	})

	test("the pipeline outlet advances it, and halts on a refusal", async () => {
		const b = await book({ calendar: THAW })
		await b.dated({ year: 5, month: 1, day: 30 })
		const s = await create(b)
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db(), { sessionId: s, userId: b.user.id, specId: "test:spec/clock", runId: "run-clock" } as any)
		const node = { key: "tick", definitionId: "core:outlet/advance-story-clock", definitionVersion: 1 } as any
		const out: any = await host.commit!({ params: { by: 90, unit: "minutes" } }, node)
		expect(out.clock).toEqual({ year: 5, month: 1, day: 30, hour: 1, minute: 30 })
		// A wired `by` wins over the parameter.
		const next: any = await host.commit!({ by: 23, params: { by: 1, unit: "hours" } }, node)
		expect(next.clock).toEqual({ year: 5, month: 2, day: 1, hour: 0, minute: 30 })
		await expect(host.commit!({ params: { by: 0, unit: "days" } }, node)).rejects.toThrow(/whole number other than zero/)
		await expect(host.commit!({ params: { by: 1, unit: "fortnights" } }, node)).rejects.toThrow(/one of minutes/)
	})

	test("the outlet's advance says the session moved: a session-updated naming the clock", async () => {
		const b = await book()
		await b.dated({ year: 5, month: 1, day: 30 })
		const s = await create(b)
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db(), { sessionId: s, userId: b.user.id, specId: "test:spec/clock", runId: "run-clock-event" } as any)
		const node = { key: "tick", definitionId: "core:outlet/advance-story-clock", definitionVersion: 1 } as any
		await host.commit!({ params: { by: 1, unit: "days" } }, node)
		const changes = await testDb
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, s))
		const updated = changes.filter((c) => c.event === "core:event/session-updated@1")
		expect(updated).toHaveLength(1)
		expect(updated[0].runId).toBe("run-clock-event")
		expect((updated[0].payload as any).changed).toEqual(["storyClock"])
		expect((updated[0].payload as any).cause).toMatchObject({ kind: "run" })
	})
})

describe("5 · the prompt's current date", () => {
	test("session_cast's story time is the session story clock, and assemble renders it", async () => {
		const b = await book()
		await b.dated({ year: 5, month: 1, day: 9 })
		const s = await create(b, { storyClockYear: 7, storyClockMonth: 2, storyClockDay: 3, storyClockHour: 21, storyClockMinute: 5 })
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const node = { key: "read", definitionId: "core:query/session-cast@1" } as any
		const read: any = await createHost(db(), { sessionId: s }).read!("session_cast", { sessionId: s }, node)
		expect(read.storyTime.now).toMatchObject({ year: 7, month: 2, day: 3, hour: 21, minute: 5, from: "session" })
		const { allocate, render } = await import("$lib/server/pipelines/prompt/assemble")
		const { CORE_TEMPLATE_ENGINE } = await import("$lib/server/pipelines/prompt/renderers")
		const r = await render({
			allocation: allocate([], { budgetTotal: 100 }),
			engine: CORE_TEMPLATE_ENGINE,
			messages: [{ id: 1, role: "user", content: "hello" }],
			template: "[{{{currentDate}}}]",
			templateContext: { storyTime: read.storyTime }
		} as any)
		expect(r.rendered).toBe("[The current date in the story is 7-02-03 21:05.]")
	})
})

describe("6 · two sessions on one book", () => {
	test("keep different nows, and neither moves the book", async () => {
		const b = await book()
		await b.dated({ year: 5 })
		const a = await create(b)
		const c = await create(b)
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		await advanceSessionStoryClock(db(), a, 10, "years")
		await update(b, { id: c, storyClockYear: -300 })
		expect(await sessionNow(a)).toEqual({ year: 15 })
		expect(await sessionNow(c)).toEqual({ year: -300 })
		expect(await bookNow(b)).toMatchObject({ year: 5, from: "history" })
	})
})
