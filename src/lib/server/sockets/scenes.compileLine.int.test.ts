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
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
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
vi.mock("$lib/server/utils/summarizer", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		compileScenesForEntry: vi.fn(
			async (args: { scenes: { id: number }[] }) => {
				compiled.push(args.scenes.map((s) => s.id))
				return {
					content: "The compiled history.",
					raw: "The compiled history."
				}
			}
		)
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
