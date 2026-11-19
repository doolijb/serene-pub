/**
 * The Timeline rule's readers (`lorebooks/timeline.ts`): with the governing
 * book's switch off, a session reads as the story stands now, writes nothing
 * dated, and its story time does not move; nothing stored is touched, and
 * switching it on again brings every dated reading back.
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
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-timeline-off-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function history(lorebookId: number, year: number) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: null,
			content: "…",
			fields: { year }
		})
		.returning()
	return row!
}

const setBook = (lorebookId: number, timelineEnabled: boolean) =>
	testDb
		.update(schema.lorebooks)
		.set({ timelineEnabled })
		.where(eq(schema.lorebooks.id, lorebookId))

/** An attached book with dated history, a book clock, a fork with a clock, and a session on the fork with a clock. */
async function attached() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `timeline-off-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}`, storyClockYear: 9 })
		.returning()
	await history(book!.id, 3)
	await history(book!.id, 5)
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: book!.id,
			name: `fork ${suffix}`,
			forkYear: 4,
			storyClockYear: 6
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			lorebookBranchId: fork!.id,
			storyClockYear: 7,
			storyClockMonth: 2,
			storyClockDay: 3
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), session!.id)
	await testDb.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, own.id)) // the notes state their timeline
	return { user, book: book!, fork: fork!, session: session!, own }
}

const sessionClock = async (sessionId: number) => {
	const [r] = await testDb
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return [
		r!.storyClockYear,
		r!.storyClockMonth,
		r!.storyClockDay,
		r!.storyClockHour,
		r!.storyClockMinute
	]
}

describe("a session on a book whose timeline is off", () => {
	test("reads with no moment, on its own line and fork cut; stored clocks stay; switching on restores", async () => {
		const { sessionReadingOf, readingOf, writeDatingAt } = await import(
			"$lib/server/state/reading"
		)
		const { storyNowOf, sessionStoryNowOf } = await import(
			"$lib/server/state/storyTime"
		)
		const f = await attached()
		const onReading = (await sessionReadingOf(db(), f.session.id))!
		const onDating = await writeDatingAt(db(), onReading)
		const onNow = await sessionStoryNowOf(db(), f.session.id)
		const onBookNow = await storyNowOf(db(), f.book.id, f.fork.id)
		expect(onReading.moment).toEqual({ year: 7, month: 2, day: 3 })
		expect(onReading.timelineOff).toBe(false)
		expect(onDating).not.toBeNull()
		expect(onNow).not.toBeNull()
		expect(onBookNow).not.toBeNull()

		const clocksBefore = await sessionClock(f.session.id)
		await setBook(f.book.id, false)
		const off = (await sessionReadingOf(db(), f.session.id))!
		expect(off.moment).toBeNull()
		expect(off.timelineOff).toBe(true)
		expect(off.branchId).toBe(f.fork.id)
		expect(off.forkedAt).toEqual({ year: 4, month: null, day: null })
		expect(
			(
				await readingOf(db(), f.book.id, {
					moment: { year: 7, month: 2, day: 3 }
				})
			).moment
		).toBeNull()
		expect(
			(
				await readingOf(db(), f.book.id, {
					moment: { year: 7, month: 2, day: 3 }
				})
			).timelineOff
		).toBe(true)
		expect(await writeDatingAt(db(), off)).toBeNull()
		// A hand-built reading carries no mark; the query covers it.
		expect(
			await writeDatingAt(db(), {
				lorebookId: f.book.id,
				branchId: null,
				moment: null,
				forkedAt: null,
				line: off.line
			})
		).toBeNull()
		expect(await storyNowOf(db(), f.book.id)).toBeNull()
		expect(await storyNowOf(db(), f.book.id, f.fork.id)).toBeNull()
		expect(await sessionStoryNowOf(db(), f.session.id)).toBeNull()

		expect(await sessionClock(f.session.id)).toEqual(clocksBefore)
		const [bookRow] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, f.book.id))
		expect(bookRow!.storyClockYear).toBe(9)

		await testDb.execute(
			(await import("drizzle-orm"))
				.sql`update lorebooks set timeline_enabled = true where id = ${f.book.id}`
		)
		const back = (await sessionReadingOf(db(), f.session.id))!
		expect(back.moment).toEqual(onReading.moment)
		expect(back.timelineOff).toBe(false)
		expect(await writeDatingAt(db(), back)).toEqual(onDating)
		expect(await sessionStoryNowOf(db(), f.session.id)).toEqual(onNow)
		expect(await storyNowOf(db(), f.book.id, f.fork.id)).toEqual(onBookNow)
	})

	test("neither advance moves the clock: each is refused with the clock sentence, and nothing is written", async () => {
		const {
			advanceSessionStoryClock,
			advanceSessionStoryClockTo,
			StoryClockRefusal
		} = await import("$lib/server/state/storyTime")
		const f = await attached()
		await setBook(f.book.id, false)
		const before = await sessionClock(f.session.id)
		const by = advanceSessionStoryClock(db(), f.session.id, 2, "days")
		await expect(by).rejects.toBeInstanceOf(StoryClockRefusal)
		await expect(by).rejects.toThrow(TIMELINE_OFF_SENTENCES.clock)
		const to = advanceSessionStoryClockTo(db(), f.session.id, { hour: 9 })
		await expect(to).rejects.toBeInstanceOf(StoryClockRefusal)
		await expect(to).rejects.toThrow(TIMELINE_OFF_SENTENCES.clock)
		expect(await sessionClock(f.session.id)).toEqual(before)
	})

	test("a session reading its notes alone follows the notes' switch", async () => {
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { sessionStoryNowOf } = await import(
			"$lib/server/state/storyTime"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `timeline-off-notes-${++n}`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `Notes ${n}`,
				storyClockYear: 4
			})
			.returning()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(db(), session!.id)
		await testDb.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, own.id)) // the notes state their timeline
		const on = (await sessionReadingOf(db(), session!.id))!
		expect(on.onOwnBook).toBe(true)
		expect(on.moment).toEqual({ year: 4, month: null, day: null })
		await setBook(own.id, false)
		const off = (await sessionReadingOf(db(), session!.id))!
		expect(off.onOwnBook).toBe(true)
		expect(off.timelineOff).toBe(true)
		expect(off.moment).toBeNull()
		expect(await sessionStoryNowOf(db(), session!.id)).toBeNull()
	})

	test("an attached session follows the attached book's switch, whatever its notes say", async () => {
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const f = await attached()
		// Notes off, book on: the book decides.
		await setBook(f.own.id, false)
		const bookOn = (await sessionReadingOf(db(), f.session.id))!
		expect(bookOn.timelineOff).toBe(false)
		expect(bookOn.moment).toEqual({ year: 7, month: 2, day: 3 })
		// Book off, notes on: the book decides.
		await setBook(f.own.id, true)
		await setBook(f.book.id, false)
		const bookOff = (await sessionReadingOf(db(), f.session.id))!
		expect(bookOff.timelineOff).toBe(true)
		expect(bookOff.moment).toBeNull()
	})
})
