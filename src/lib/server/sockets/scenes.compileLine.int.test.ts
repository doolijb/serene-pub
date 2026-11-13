/**
 * `scenes:compile` reads the line it is asked from (plan A11).
 *
 * - The scenes compiled are the ones the compiling reading's LINE sees:
 *   main's shared scenes and the branch's own, never a sibling line's.
 * - They reach the synthesis in story order — the order their messages were
 *   played in — not in the order the rows happen to have been inserted.
 * - The compile activity records the line and the moment it was asked at, so
 *   a review reopened later saves there, not wherever the reader stands then.
 *   The save below is the review modal's own: an amendment at the activity's
 *   line and moment. Main's entry is untouched.
 * - A run row that cannot be written ends the activity with a plain sentence
 *   rather than leaving it "running" forever.
 * - The press READS its day's unfiled scenes; only Apply (`acted`) files them.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** What the synthesis was handed, per call, as scene ids in order. */
const compiled: number[][] = []
/** Set by the in-progress test: the synthesis waits on it before it answers. */
let holdCompile: Promise<void> | null = null
vi.mock("$lib/server/utils/summarizer", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		compileScenesForEntry: vi.fn(
			async (args: { scenes: { id: number }[] }) => {
				compiled.push(args.scenes.map((s) => s.id))
				if (holdCompile) await holdCompile
				return {
					content: "The compiled history.",
					raw: "The compiled history."
				}
			}
		)
	}
})

/** Set by the by-date refusal tests: rewrites the resolved compile target once. */
let targetOverride: ((real: any) => any) | null = null
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		resolveCapabilityTarget: vi.fn(async (...args: any[]) => {
			const real = await actual.resolveCapabilityTarget(...args)
			const override = targetOverride
			targetOverride = null
			return override ? override(real) : real
		})
	}
})

/** Flipped by the receipt test: the run row's write fails once. */
let failReceipt = false
vi.mock("$lib/server/pipelines/runtime/receipts", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		saveReceipt: vi.fn(async (...args: any[]) => {
			if (failReceipt) {
				failReceipt = false
				throw new Error(
					'insert into "pipeline_runs" failed: connection reset'
				)
			}
			return actual.saveReceipt(...args)
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-compile-line-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await seedTextDefault()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

/** A connection, model and sampling registered for `text->text`, as a compile needs. */
async function seedTextDefault() {
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "compile-line-conn", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "compile-line-sampling" })
		.returning()
	const existing = await testDb.query.systemSettings.findFirst()
	if (!existing) await testDb.insert(schema.systemSettings).values({} as any)
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"line-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}

/**
 * A book with main and two sibling lines off it, one history entry on main
 * dated Year 1, and a scene from a session on each line. Main's two scenes
 * are inserted in the reverse of the order they were played.
 */
async function seedBook(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, username)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Two Roads", userId: owner.id })
		.returning()
	const [branchB] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "The north road" })
		.returning()
	const [branchC] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "The south road" })
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: book.id,
					year: 1,
					content: "The caravan set out."
				} as any
			])
		)
		.returning()

	const session = async (branchId: number | null) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					name: `on ${branchId ?? "main"}`,
					lorebookId: book.id,
					lorebookBranchId: branchId,
					isGroup: false
				} as any)
				.returning()
		)[0]
	const onMain = await session(null)
	const onB = await session(branchB.id)
	const onC = await session(branchC.id)
	const message = async (sessionId: number, content: string) =>
		(
			await testDb
				.insert(schema.sessionMessages)
				.values({ sessionId, role: "user", content } as any)
				.returning()
		)[0]
	// Played in this order: main's first, then B's, then main's second, then C's.
	const m1 = await message(onMain.id, "They left at dawn.")
	const m2 = await message(onB.id, "They took the north road.")
	const m3 = await message(onMain.id, "The rain came.")
	const m4 = await message(onC.id, "They took the south road.")

	const scene = async (
		sessionId: number,
		branchId: number | null,
		messageId: number,
		name: string
	) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: book.id,
					historyEntryId: entry.id,
					sessionId,
					branchId,
					name,
					summary: `${name}.`,
					selectedMessageIds: [messageId]
				})
				.returning()
		)[0]
	// Inserted out of play order: the rain first, the dawn after it.
	const rain = await scene(onMain.id, null, m3.id, "The rain")
	const north = await scene(onB.id, branchB.id, m2.id, "The north road")
	const south = await scene(onC.id, branchC.id, m4.id, "The south road")
	const dawn = await scene(onMain.id, null, m1.id, "Dawn")
	return { owner, book, branchB, branchC, entry, rain, north, south, dawn }
}

async function compileActivity(userId: number, historyEntryId: number) {
	const { activityStore } = await import("$lib/server/utils/activityStore")
	return activityStore
		.getFor(userId, false)
		.find(
			(a) =>
				a.kind === "compile_history_entry" &&
				(a as any).historyEntryId === historyEntryId
		) as any
}

describe("scenes:compile reads the compiling reading's line", () => {
	test("a branch compile reads main's shared scenes and its own, in the order they were played, never a sibling's", async () => {
		const w = await seedBook("compile-line-branch")
		const { sceneCompileHandler } = await import("./scenes")
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{
				historyEntryId: w.entry.id,
				branchId: w.branchB.id,
				moment: { year: 3, month: 2, day: null }
			},
			() => {}
		)

		expect(compiled).toEqual([[w.dawn.id, w.north.id, w.rain.id]])

		const activity = await compileActivity(w.owner.id, w.entry.id)
		expect(activity.status).toBe("review")
		expect(activity.branchId).toBe(w.branchB.id)
		expect(activity.moment).toEqual({ year: 3, month: 2, day: null })
	})

	test("the review saves on the activity's line at its moment, and main's entry is untouched", async () => {
		const w = await seedBook("compile-line-save")
		const { sceneCompileHandler } = await import("./scenes")
		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{
				historyEntryId: w.entry.id,
				branchId: w.branchB.id,
				moment: { year: 3, month: null, day: null }
			},
			() => {}
		)
		const activity = await compileActivity(w.owner.id, w.entry.id)

		// The review modal's save at a moment: an amendment of the changed
		// fields, at the line and moment the ACTIVITY holds.
		const { amendmentsCreateHandler } = await import("./amendments")
		await amendmentsCreateHandler.handler(
			fakeSocket(w.owner.id),
			{
				lorebookId: w.book.id,
				entryId: w.entry.id,
				branchId: activity.branchId,
				year: activity.moment.year,
				month: activity.moment.month ?? null,
				day: activity.moment.day ?? null,
				fields: { content: activity.pendingResult.content }
			} as any,
			() => {}
		)

		const amendments = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.entryId, w.entry.id))
		expect(amendments).toHaveLength(1)
		expect(amendments[0].branchId).toBe(w.branchB.id)
		expect(amendments[0].year).toBe(3)

		const [base] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, w.entry.id))
		expect(base.content).toBe("The caravan set out.")
	})

	test("a main compile reads main's scenes only", async () => {
		const w = await seedBook("compile-line-main")
		const { sceneCompileHandler } = await import("./scenes")
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			() => {}
		)

		expect(compiled).toEqual([[w.dawn.id, w.rain.id]])
		const activity = await compileActivity(w.owner.id, w.entry.id)
		expect(activity.branchId).toBeNull()
		expect(activity.moment).toBeNull()
	})

	test("a line of another book is refused with a sentence, and nothing starts", async () => {
		const w = await seedBook("compile-line-foreign")
		const other = await seedBook("compile-line-foreign-2")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{
					historyEntryId: w.entry.id,
					branchId: other.branchB.id,
					moment: null
				},
				(event, data) => emitted.push([event, data])
			)
		).rejects.toThrow()

		expect(emitted).toContainEqual([
			"scenes:compile:error",
			// The entry rides every refusal, so a second Compile window in
			// the tab is not flipped by this one's (plan B8).
			{
				historyEntryId: w.entry.id,
				error: "That line is not one of this lorebook's."
			}
		])
		expect(await compileActivity(w.owner.id, w.entry.id)).toBeUndefined()
	})

	test("a run row that cannot be written still hands the compiled text to review", async () => {
		const w = await seedBook("compile-line-receipt")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []
		failReceipt = true

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			(event, data) => emitted.push([event, data])
		)

		// The text was paid for; only the record of the run is missing.
		const activity = await compileActivity(w.owner.id, w.entry.id)
		expect(activity.status).toBe("review")
		expect(activity.pendingResult).toEqual({
			content: "The compiled history."
		})
		expect(emitted.map(([event]) => event)).toContain(
			"scenes:compile:complete"
		)
		expect(emitted.map(([event]) => event)).not.toContain(
			"scenes:compile:error"
		)
	})

	test("progress and completion name the reading they were asked at", async () => {
		const w = await seedBook("compile-line-frames")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{
				historyEntryId: w.entry.id,
				branchId: w.branchB.id,
				moment: { year: 3, month: null, day: null }
			},
			(event, data) => emitted.push([event, data])
		)

		const complete = emitted.find(([e]) => e === "scenes:compile:complete")
		expect(complete?.[1]).toMatchObject({
			historyEntryId: w.entry.id,
			branchId: w.branchB.id,
			moment: { year: 3, month: null, day: null }
		})
	})
})

/**
 * A book whose lines are cut: B forks main at Year 5, C forks B at Year 2, so
 * C reads main only up to Year 2. One history entry on main at Year 3, with a
 * scene on each line.
 */
async function seedCutBook(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, username)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Cut Roads", userId: owner.id })
		.returning()
	const [branchB] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "B", forkYear: 5 })
		.returning()
	const [branchC] = await testDb
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: book.id,
			name: "C",
			forkedFromBranchId: branchB.id,
			forkYear: 2
		})
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book.id, year: 3, content: "The ford." } as any
			])
		)
		.returning()
	const scene = async (branchId: number | null, name: string) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: book.id,
					historyEntryId: entry.id,
					branchId,
					name,
					summary: `${name}.`,
					selectedMessageIds: []
				})
				.returning()
		)[0]
	await scene(null, "Main scene")
	await scene(branchB.id, "B scene")
	await scene(branchC.id, "C scene")
	return { owner, book, branchB, branchC, entry }
}

describe("scenes:compile refuses what its reading cannot see", () => {
	test("an entry the line's fork date cuts off is refused, and nothing is compiled", async () => {
		const w = await seedCutBook("compile-line-cut")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []
		compiled.length = 0

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{ historyEntryId: w.entry.id, branchId: w.branchC.id, moment: null },
				(event, data) => emitted.push([event, data])
			)
		).rejects.toThrow()

		expect(compiled).toEqual([])
		expect(emitted).toContainEqual([
			"scenes:compile:error",
			{
				historyEntryId: w.entry.id,
				error: "That history entry is not on the line you are reading."
			}
		])
	})

	test("a moment before the entry's own date is refused: the entry has not happened yet", async () => {
		const w = await seedCutBook("compile-line-early")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []
		compiled.length = 0

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{
					historyEntryId: w.entry.id,
					branchId: null,
					moment: { year: 2, month: null, day: null }
				},
				(event, data) => emitted.push([event, data])
			)
		).rejects.toThrow()

		expect(compiled).toEqual([])
		expect(emitted).toContainEqual([
			"scenes:compile:error",
			{
				historyEntryId: w.entry.id,
				error: "That moment is before this history entry's date, so there is nothing to compile into yet."
			}
		])
	})
})

describe("a compile is one per reading, not one per entry", () => {
	test("a compile running on one line does not refuse a compile on another", async () => {
		const w = await seedBook("compile-line-per-reading-running")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const onB = activityStore.startCompile({
			userId: w.owner.id,
			historyEntryId: w.entry.id,
			historyEntryDate: "Year 1",
			lorebookId: w.book.id,
			lorebookLabel: w.book.name,
			branchId: w.branchB.id,
			moment: null
		})

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: w.branchC.id, moment: null },
			() => {}
		)

		const mine = activityStore
			.getFor(w.owner.id, false)
			.filter(
				(a: any) =>
					a.kind === "compile_history_entry" &&
					a.historyEntryId === w.entry.id
			) as any[]
		expect(mine.find((a) => a.id === onB)?.status).toBe("running")
		expect(
			mine.find((a) => a.branchId === w.branchC.id)?.status
		).toBe("review")
		activityStore.remove(onB)
	})

	test("a compile on another line leaves this line's review standing; the same reading supersedes it", async () => {
		const w = await seedBook("compile-line-per-reading-review")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const compileAt = (branchId: number | null) =>
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{ historyEntryId: w.entry.id, branchId, moment: null },
				() => {}
			)
		const reviews = () =>
			(
				activityStore
					.getFor(w.owner.id, false)
					.filter(
						(a: any) =>
							a.kind === "compile_history_entry" &&
							a.historyEntryId === w.entry.id
					) as any[]
			).map((a) => [a.branchId, a.status])

		const onB = await compileAt(w.branchB.id)
		await compileAt(w.branchC.id)
		expect(reviews()).toEqual(
			expect.arrayContaining([
				[w.branchB.id, "review"],
				[w.branchC.id, "review"]
			])
		)
		expect(reviews()).toHaveLength(2)

		const againOnB = await compileAt(w.branchB.id)
		expect(againOnB.activityId).not.toBe(onB.activityId)
		expect(reviews()).toHaveLength(2)
	})
})

describe("scenes:compile hands the scenes over in the order they were played", () => {
	test("a branched session's scene over copied messages takes the place of the messages it copies", async () => {
		const w = await seedBook("compile-line-branched-session")
		const { sceneCompileHandler } = await import("./scenes")
		const { branchSession } = await import("$lib/server/sessions/branch")
		// A fresh entry, so only this test's scenes are under it.
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: w.book.id, year: 2, content: "" } as any
				])
			)
			.returning()
		const [parent] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.owner.id,
				name: "parent",
				lorebookId: w.book.id,
				isGroup: false
			} as any)
			.returning()
		const say = async (content: string) =>
			(
				await testDb
					.insert(schema.sessionMessages)
					.values({ sessionId: parent.id, role: "user", content } as any)
					.returning()
			)[0]
		const first = await say("They met at the well.")
		const second = await say("They parted at the gate.")
		const fork = await branchSession(testDb as any, {
			sessionId: parent.id,
			fromMessageId: second.id
		})
		const copies = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, fork.id))
		const copyOfFirst = copies.find((m) => m.content === first.content)!
		expect(copyOfFirst.id).toBeGreaterThan(second.id)

		const scene = async (sessionId: number, messageId: number, name: string) =>
			(
				await testDb
					.insert(schema.scenes)
					.values({
						lorebookId: w.book.id,
						historyEntryId: entry.id,
						sessionId,
						branchId: null,
						name,
						summary: `${name}.`,
						selectedMessageIds: [messageId]
					})
					.returning()
			)[0]
		// Written in this order: the parting first, in the parent; then the
		// meeting, captured in the branch over its copy of the first message.
		const parting = await scene(parent.id, second.id, "The parting")
		const meeting = await scene(fork.id, copyOfFirst.id, "The meeting")
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: entry.id, branchId: null, moment: null },
			() => {}
		)

		expect(compiled).toEqual([[meeting.id, parting.id]])
	})
})

/** A day entry (Year 2, Mo. 3, Day 4) and two unfiled scenes: its day's and another's. */
async function seedDay(w: Awaited<ReturnType<typeof seedBook>>) {
	const [dayEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: w.book.id, year: 2, month: 3, day: 4 } as any
			])
		)
		.returning()
	const [onMain] = await testDb
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.lorebookId, w.book.id))
		.limit(1)
	const unfiled = async (name: string, day: number) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: w.book.id,
					historyEntryId: null,
					sessionId: onMain.id,
					branchId: null,
					name,
					summary: `${name}.`,
					openedStoryClockYear: 2,
					openedStoryClockMonth: 3,
					openedStoryClockDay: day
				} as any)
				.returning()
		)[0]
	const sameDay = await unfiled("Same day", 4)
	const otherDay = await unfiled("Other day", 9)
	return { dayEntry, sameDay, otherDay }
}

const filedUnder = async (sceneId: number) =>
	(
		await testDb
			.select({ h: schema.scenes.historyEntryId })
			.from(schema.scenes)
			.where(eq(schema.scenes.id, sceneId))
	)[0].h

describe("scenes:compile reads the unfiled scenes of its entry's day; Apply files them (§0-B)", () => {
	test("the press compiles an unfiled scene of the entry's day without filing it; Apply files it; another day's stays unfiled; a filed one is untouched", async () => {
		const w = await seedBook("compile-files-day")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { dayEntry, sameDay, otherDay } = await seedDay(w)
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: dayEntry.id, branchId: null, moment: null },
			() => {}
		)

		expect(compiled).toEqual([[sameDay.id]])
		expect(await filedUnder(sameDay.id)).toBeNull()
		const activity = await compileActivity(w.owner.id, dayEntry.id)
		expect(activity.sceneIds).toEqual([sameDay.id])

		activityStore.remove(activity.id, "acted")
		await vi.waitFor(async () => {
			expect(await filedUnder(sameDay.id)).toBe(dayEntry.id)
		}, { timeout: 10_000 })
		expect(await filedUnder(otherDay.id)).toBeNull()
		// Already filed under another entry: untouched.
		expect(await filedUnder(w.dawn.id)).toBe(w.entry.id)
		// Compiling one entry made no entry for the other day.
		const entries = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.book.id))
		expect(entries).toHaveLength(2)
	}, 60_000)

	test("Apply files only the scenes the rule still puts under the entry AND the compile read", async () => {
		const w = await seedBook("compile-apply-rule")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { dayEntry, sameDay, otherDay } = await seedDay(w)
		const [stays] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, sameDay.id))
		const moved = await testDb
			.insert(schema.scenes)
			.values({ ...stays, id: undefined, name: "Moved" } as any)
			.returning()
		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: dayEntry.id, branchId: null, moment: null },
			() => {}
		)
		const activity = await compileActivity(w.owner.id, dayEntry.id)
		expect(activity.sceneIds).toEqual([sameDay.id, moved[0].id])
		// Re-dated after the compile read it; and a same-day scene opened after.
		await testDb
			.update(schema.scenes)
			.set({ openedStoryClockDay: 9 })
			.where(eq(schema.scenes.id, moved[0].id))
		const [late] = await testDb
			.insert(schema.scenes)
			.values({ ...stays, id: undefined, name: "Late" } as any)
			.returning()

		activityStore.remove(activity.id, "acted")
		await vi.waitFor(async () => {
			expect(await filedUnder(sameDay.id)).toBe(dayEntry.id)
		}, { timeout: 10_000 })
		expect(await filedUnder(moved[0].id)).toBeNull()
		expect(await filedUnder(late.id)).toBeNull()
		expect(await filedUnder(otherDay.id)).toBeNull()
	}, 60_000)

	test("Apply re-sends the scenes of the book and the history list to the owner, not through the press's emitter, without the unfiled count", async () => {
		const w = await seedBook("compile-apply-relist")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { dayEntry } = await seedDay(w)
		const emits: Array<{ event: string; data: any }> = []
		const emit = (event: string, data: any) => {
			emits.push({ event, data })
		}
		// What reaches a user through `emitToUserRedacted`: Apply sends to the
		// owner through the pressing socket's server, not the press's emitter.
		const ownerEmits: Array<[number, string, any]> = []
		const helpers = await import("$lib/server/sockets/utils/broadcastHelpers")
		const spy = vi
			.spyOn(helpers, "emitToUserRedacted")
			.mockImplementation(async (_io, userId, event, data) => {
				ownerEmits.push([userId, event, data])
			})
		try {
			await sceneCompileHandler.handler(
				{ user: { id: w.owner.id }, io: {} } as any,
				{ historyEntryId: dayEntry.id, branchId: null, moment: null },
				emit
			)
			const activity = await compileActivity(w.owner.id, dayEntry.id)
			emits.length = 0
			ownerEmits.length = 0
			activityStore.remove(activity.id, "acted")

			const resolve = async (event: string) => {
				const out: any[] = []
				for (const [userId, name, data] of ownerEmits)
					if (name === event && userId === w.owner.id)
						out.push(typeof data === "function" ? await data() : data)
				return out
			}
			await vi.waitFor(async () => {
				const scenesList = await resolve("scenes:listByLorebook")
				expect(scenesList.some((p) => p.lorebookId === w.book.id)).toBe(true)
				const lists = await resolve("entries:list")
				expect(lists.length).toBeGreaterThan(0)
				const row = lists[lists.length - 1].entryList.find(
					(r: any) => r.id === dayEntry.id
				)
				expect("unfiledSceneCount" in row).toBe(false)
			}, { timeout: 10_000 })
		} finally {
			spy.mockRestore()
		}
		// The press's own emitter carried none of it.
		expect(emits.map((e) => e.event)).not.toContain("scenes:listByLorebook")
		expect(emits.map((e) => e.event)).not.toContain("entries:list")
	}, 60_000)

	test("a discarded review leaves the scene unfiled", async () => {
		const w = await seedBook("compile-discard-day")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { dayEntry, sameDay } = await seedDay(w)

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: dayEntry.id, branchId: null, moment: null },
			() => {}
		)
		const activity = await compileActivity(w.owner.id, dayEntry.id)
		activityStore.remove(activity.id)
		await new Promise((r) => setTimeout(r, 50))

		expect(await filedUnder(sameDay.id)).toBeNull()
	}, 60_000)

	test("a lost dismiss: a second compile supersedes the review, reads the scene again, and its Apply files it", async () => {
		const w = await seedBook("compile-lost-dismiss")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { dayEntry, sameDay } = await seedDay(w)
		compiled.length = 0
		const press = () =>
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{ historyEntryId: dayEntry.id, branchId: null, moment: null },
				() => {}
			)

		await press()
		const first = await compileActivity(w.owner.id, dayEntry.id)
		await press()
		await new Promise((r) => setTimeout(r, 50))

		expect(compiled).toEqual([[sameDay.id], [sameDay.id]])
		expect(await filedUnder(sameDay.id)).toBeNull()
		const second = await compileActivity(w.owner.id, dayEntry.id)
		expect(second.id).not.toBe(first.id)
		expect(second.sceneIds).toEqual([sameDay.id])

		activityStore.remove(second.id, "acted")
		await vi.waitFor(async () => {
			expect(await filedUnder(sameDay.id)).toBe(dayEntry.id)
		}, { timeout: 10_000 })
	}, 60_000)

	test("an entry with no scenes filed under it but an unfiled scene of its day compiles from that scene's summary", async () => {
		const w = await seedBook("compile-unfiled-only")
		const { sceneCompileHandler } = await import("./scenes")
		const [dayEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: w.book.id, year: 6, month: 1, day: 1 } as any]))
			.returning()
		const [session] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.lorebookId, w.book.id))
			.limit(1)
		const [only] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: w.book.id,
				historyEntryId: null,
				sessionId: session.id,
				branchId: null,
				name: "Only one",
				summary: "Only one.",
				openedStoryClockYear: 6,
				openedStoryClockMonth: 1,
				openedStoryClockDay: 1
			} as any)
			.returning()
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: dayEntry.id, branchId: null, moment: null },
			() => {}
		)

		expect(compiled).toEqual([[only.id]])
	}, 60_000)
})

// ── Compile by date (S-B2, owner 2026-11-04) ────────────────────────────────

const historyEntriesOf = async (lorebookId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	).filter((e) => e.typeId === HISTORY_TYPE_ID)

/** One unfiled scene on main on the given opening day (null year = no story clock). */
async function unfiledOn(
	w: Awaited<ReturnType<typeof seedBook>>,
	name: string,
	day: { year: number; month: number; day: number } | null,
	branchId: number | null = null
) {
	const [session] = await testDb
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.lorebookId, w.book.id))
		.limit(1)
	return (
		await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: w.book.id,
				historyEntryId: null,
				sessionId: session.id,
				branchId,
				name,
				summary: `${name}.`,
				openedStoryClockYear: day?.year ?? null,
				openedStoryClockMonth: day?.month ?? null,
				openedStoryClockDay: day?.day ?? null
			} as any)
			.returning()
	)[0]
}

describe("scenes:compile by date", () => {
	const byDate = (
		w: Awaited<ReturnType<typeof seedBook>>,
		over: Record<string, unknown> = {}
	) => ({
		lorebookId: w.book.id,
		date: { year: 5, month: 2, day: 7 },
		branchId: null,
		moment: null,
		...over
	})

	test("no entry of the day: exactly one is made, on the asked line and dated that day; the run compiles that day's unfiled scenes; the press files nothing; Apply files them", async () => {
		const w = await seedBook("bydate-creates")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const mine = await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const other = await unfiledOn(w, "Other", { year: 5, month: 2, day: 8 })
		const before = (await historyEntriesOf(w.book.id)).length
		compiled.length = 0
		const events: Array<[string, any]> = []

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w) as any,
			(event: string, data: any) => {
				events.push([event, data])
			}
		)

		const after = await historyEntriesOf(w.book.id)
		expect(after).toHaveLength(before + 1)
		const made = after.find((e) => e.id !== w.entry.id)!
		expect(made.branchId).toBeNull()
		expect((made.fields as any).year).toBe(5)
		expect((made.fields as any).month).toBe(2)
		expect((made.fields as any).day).toBe(7)
		expect(compiled).toEqual([[mine.id]])
		expect(await filedUnder(mine.id)).toBeNull()
		// The client holds the new row before the run's frames reach it.
		const names = events.map(([e]) => e)
		expect(names.indexOf("entries:list")).toBeGreaterThanOrEqual(0)
		expect(names.indexOf("entries:list")).toBeLessThan(
			names.indexOf("scenes:compile:progress") === -1
				? names.length
				: names.indexOf("scenes:compile:progress")
		)
		const activity = await compileActivity(w.owner.id, made.id)
		expect(activity.status).toBe("review")
		activityStore.remove(activity.id, "acted")
		await vi.waitFor(async () => {
			expect(await filedUnder(mine.id)).toBe(made.id)
		}, { timeout: 10_000 })
		expect(await filedUnder(other.id)).toBeNull()
	}, 60_000)

	test("an entry of the day exists: none is made and that entry is compiled", async () => {
		const w = await seedBook("bydate-existing")
		const { sceneCompileHandler } = await import("./scenes")
		const { dayEntry, sameDay } = await seedDay(w)
		const before = (await historyEntriesOf(w.book.id)).length
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w, { date: { year: 2, month: 3, day: 4 } }) as any,
			() => {}
		)

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
		expect(compiled).toEqual([[sameDay.id]])
		expect(await compileActivity(w.owner.id, dayEntry.id)).toBeTruthy()
	}, 60_000)

	test("date null compiles the scenes with no story clock", async () => {
		const w = await seedBook("bydate-undated")
		const { sceneCompileHandler } = await import("./scenes")
		const undated = await unfiledOn(w, "Undated", null)
		const before = (await historyEntriesOf(w.book.id)).length
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w, { date: null }) as any,
			() => {}
		)

		// The newest dated entry the line reads takes the undated scenes.
		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
		expect(compiled.flat()).toContain(undated.id)
		expect(await filedUnder(undated.id)).toBeNull()
	}, 60_000)

	test("a by-date compile's activity carries the asked day (null for Undated); an entry ask's carries none", async () => {
		const w = await seedBook("bydate-echo")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		await unfiledOn(w, "Undated", null)
		const lorebookActivities = () =>
			activityStore
				.getFor(w.owner.id, false)
				.filter(
					(a) =>
						a.kind === "compile_history_entry" &&
						(a as any).lorebookId === w.book.id
				) as any[]

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w) as any,
			() => {}
		)
		const dated = lorebookActivities()
		expect(dated).toHaveLength(1)
		expect(dated[0].byDate).toEqual({
			date: { year: 5, month: 2, day: 7 }
		})
		activityStore.remove(dated[0].id)

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w, { date: null }) as any,
			() => {}
		)
		const undated = lorebookActivities()
		expect(undated).toHaveLength(1)
		expect(undated[0].byDate).toEqual({ date: null })
		activityStore.remove(undated[0].id)

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			() => {}
		)
		const byEntry = await compileActivity(w.owner.id, w.entry.id)
		expect(byEntry).toBeTruthy()
		expect("byDate" in byEntry).toBe(false)
		activityStore.remove(byEntry.id)
	}, 60_000)

	test("a by-date ask's requestId rides on its activity's byDate; one that sent none, or a non-string, leaves byDate without it; an entry ask has no byDate", async () => {
		const w = await seedBook("bydate-activity-request-id")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const lorebookActivities = () =>
			activityStore
				.getFor(w.owner.id, false)
				.filter(
					(a) =>
						a.kind === "compile_history_entry" &&
						(a as any).lorebookId === w.book.id
				) as any[]

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w, { requestId: "ask-7" }) as any,
			() => {}
		)
		const withId = lorebookActivities()
		expect(withId).toHaveLength(1)
		expect(withId[0].byDate).toEqual({
			date: { year: 5, month: 2, day: 7 },
			requestId: "ask-7"
		})
		activityStore.remove(withId[0].id)

		for (const over of [{}, { requestId: 12 }]) {
			await sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w, over) as any,
				() => {}
			)
			const bare = lorebookActivities()
			expect(bare).toHaveLength(1)
			expect(bare[0].byDate).toEqual({
				date: { year: 5, month: 2, day: 7 }
			})
			expect("requestId" in bare[0].byDate).toBe(false)
			activityStore.remove(bare[0].id)
		}

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			() => {}
		)
		const byEntry = await compileActivity(w.owner.id, w.entry.id)
		expect("byDate" in byEntry).toBe(false)
		activityStore.remove(byEntry.id)
	}, 60_000)

	test("a refused by-date ask echoes its requestId on scenes:compile:error, with the same sentence; one that sent none carries none", async () => {
		const w = await seedBook("bydate-request-id")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Elsewhere", { year: 5, month: 2, day: 8 })
		const sentence = "No scenes of that day are waiting to be compiled."
		const asRefused = async (over: Record<string, unknown>) => {
			const events: Array<[string, any]> = []
			await expect(
				sceneCompileHandler.handler(
					fakeSocket(w.owner.id),
					byDate(w, over) as any,
					(event: string, data: any) => {
						events.push([event, data])
					}
				)
			).rejects.toThrow(sentence)
			return events
		}

		expect(await asRefused({ requestId: "r-1" })).toEqual([
			["scenes:compile:error", { requestId: "r-1", error: sentence }]
		])
		const bare = await asRefused({})
		expect(bare).toEqual([["scenes:compile:error", { error: sentence }]])
		expect("requestId" in bare[0][1]).toBe(false)
		// A non-string requestId is ignored.
		const odd = await asRefused({ requestId: 7 })
		expect("requestId" in odd[0][1]).toBe(false)
	}, 60_000)

	test("an entry ask's refusal carries no requestId, even if it sent one", async () => {
		const w = await seedBook("entry-no-request-id")
		const other = await seedBook("entry-no-request-id-2")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{
					historyEntryId: w.entry.id,
					branchId: other.branchB.id,
					moment: null,
					requestId: "r-1"
				} as any,
				(event, data) => emitted.push([event, data])
			)
		).rejects.toThrow()

		expect(emitted).toEqual([
			[
				"scenes:compile:error",
				{
					historyEntryId: w.entry.id,
					error: "That line is not one of this lorebook's."
				}
			]
		])
	}, 60_000)

	test("no unfiled scenes of that day: refused, and no entry is made", async () => {
		const w = await seedBook("bydate-none")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Elsewhere", { year: 5, month: 2, day: 8 })
		// A sibling line's scene of the day is not this line's own.
		await unfiledOn(w, "Sibling", { year: 5, month: 2, day: 7 }, w.branchB.id)
		const before = (await historyEntriesOf(w.book.id)).length
		const events: Array<[string, any]> = []

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w) as any,
				(event: string, data: any) => {
					events.push([event, data])
				}
			)
		).rejects.toThrow("No scenes of that day are waiting to be compiled.")

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
		expect(events.map(([e]) => e)).toEqual(["scenes:compile:error"])
	}, 60_000)

	test("a moment before the date is refused, and nothing is made", async () => {
		const w = await seedBook("bydate-moment")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const before = (await historyEntriesOf(w.book.id)).length

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w, { moment: { year: 4, month: null, day: null } }) as any,
				() => {}
			)
		).rejects.toThrow("before this history entry's date")

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
	}, 60_000)

	test("another user's book is refused, and nothing is made", async () => {
		const w = await seedBook("bydate-owner")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, "bydate-stranger")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const before = (await historyEntriesOf(w.book.id)).length

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(stranger.id),
				byDate(w) as any,
				() => {}
			)
		).rejects.toThrow("Lorebook not found or access denied.")

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
	}, 60_000)

	test("no text->text target: refused, and no entry is made", async () => {
		const w = await seedBook("bydate-no-target")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const before = (await historyEntriesOf(w.book.id)).length
		compiled.length = 0
		const events: Array<[string, any]> = []
		targetOverride = () => ({
			ok: false,
			problem: {
				kind: "unset",
				capability: "text->text",
				message: "No model is chosen for text."
			}
		})

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w) as any,
				(event: string, data: any) => {
					events.push([event, data])
				}
			)
		).rejects.toThrow("No model is chosen for text.")

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
		expect(events.map(([e]) => e)).toEqual(["scenes:compile:error"])
		expect(compiled).toEqual([])
	}, 60_000)

	test("a missing sampling: refused, and no entry is made", async () => {
		const w = await seedBook("bydate-no-sampling")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const before = (await historyEntriesOf(w.book.id)).length
		compiled.length = 0
		const events: Array<[string, any]> = []
		targetOverride = (real) => ({ ...real, sampling: null })

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w) as any,
				(event: string, data: any) => {
					events.push([event, data])
				}
			)
		).rejects.toThrow("The Reply loadout has no sampling config")

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
		expect(events.map(([e]) => e)).toEqual(["scenes:compile:error"])
		expect(compiled).toEqual([])
	}, 60_000)

	test("a compile already in progress: refused, and no second entry", async () => {
		const w = await seedBook("bydate-in-progress")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		await unfiledOn(w, "Mine", { year: 5, month: 2, day: 7 })
		const before = (await historyEntriesOf(w.book.id)).length
		compiled.length = 0
		let release!: () => void
		holdCompile = new Promise<void>((resolve) => {
			release = resolve
		})

		const first = sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w) as any,
			() => {}
		)
		let made!: { id: number }
		await vi.waitFor(
			async () => {
				const entries = await historyEntriesOf(w.book.id)
				expect(entries).toHaveLength(before + 1)
				made = entries.find((e) => e.id !== w.entry.id)!
				expect((await compileActivity(w.owner.id, made.id))?.status).toBe(
					"running"
				)
			},
			{ timeout: 10_000 }
		)

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w) as any,
				() => {}
			)
		).rejects.toThrow("already in progress")
		expect(await historyEntriesOf(w.book.id)).toHaveLength(before + 1)

		release()
		await first
		holdCompile = null
		const activity = await compileActivity(w.owner.id, made.id)
		activityStore.remove(activity.id)
	}, 60_000)

	/** A book whose main line has no history entry at all, with one session. */
	async function seedBareBook(username: string) {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, username)
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Bare", userId: owner.id })
			.returning()
		await testDb.insert(schema.sessions).values({
			userId: owner.id,
			name: "on main",
			lorebookId: book.id,
			isGroup: false
		} as any)
		return { owner, book } as unknown as Awaited<
			ReturnType<typeof seedBook>
		>
	}

	test("date null on a line with no dated entry: a moment before Year 1, Mo. 1, Day 1 is refused, and the entry it would have made is not", async () => {
		const w = await seedBareBook("bydate-before-year-one")
		const { sceneCompileHandler } = await import("./scenes")
		await unfiledOn(w, "Undated", null)
		expect(await historyEntriesOf(w.book.id)).toHaveLength(0)
		compiled.length = 0

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				byDate(w, {
					date: null,
					moment: { year: 1, month: null, day: null }
				}) as any,
				() => {}
			)
		).rejects.toThrow("before this history entry's date")

		expect(await historyEntriesOf(w.book.id)).toHaveLength(0)
		expect(compiled).toEqual([])
	}, 60_000)

	test("date null and moment null on a line with no dated entry: the Year 1, Mo. 1, Day 1 entry is made and compiled", async () => {
		const w = await seedBareBook("bydate-year-one-made")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		const undated = await unfiledOn(w, "Undated", null)
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			byDate(w, { date: null }) as any,
			() => {}
		)

		const entries = await historyEntriesOf(w.book.id)
		expect(entries).toHaveLength(1)
		expect((entries[0].fields as any).year).toBe(1)
		expect(compiled).toEqual([[undated.id]])
		activityStore.remove(
			(await compileActivity(w.owner.id, entries[0].id)).id
		)
	}, 60_000)
})

describe("a compile's reply socket never outlives its activity", () => {
	test("a dismissed compile leaves nothing in compileReplyTo", async () => {
		const w = await seedBook("compile-reply-dismissed")
		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		const { dayEntry } = await seedDay(w)

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: dayEntry.id, branchId: null, moment: null },
			() => {}
		)
		const activity = await compileActivity(w.owner.id, dayEntry.id)
		expect(activity.sceneIds?.length).toBeGreaterThan(0)

		// `compileReplyTo` is module-private: its `delete` is the observation,
		// told apart from the store's own maps by the receiver.
		const deleted = vi.spyOn(Map.prototype, "delete")
		try {
			activityStore.remove(activity.id, "dismissed")
			await vi.waitFor(
				() => {
					const own = [
						(activityStore as any).activities,
						(activityStore as any).abortControllers
					]
					const hit = deleted.mock.calls.some(
						([key], i) =>
							key === activity.id &&
							!own.includes(deleted.mock.contexts[i])
					)
					expect(hit).toBe(true)
				},
				{ timeout: 10_000 }
			)
		} finally {
			deleted.mockRestore()
		}
	}, 60_000)
})
