/**
 * Compiling forks the session first (owner 2026-11-10): a waiting scene of a
 * session still riding its parent's line (`line_on_first_write`) is moved onto
 * that session's own line, and the compile reads only what is left.
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
		path.join(os.tmpdir(), "serene-pub-scenes-compile-forks-riding-int-test-")
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


const SENTENCE =
	"The scenes waiting here belong to a branch session, which compiles them on its own line."

async function seedWorld(username: string, year = 5) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, username)
	const mkBook = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebooks)
				.values({ name, userId: owner.id })
				.returning()
		)[0]
	const book = await mkBook("Riding")
	const other = await mkBook("Elsewhere")
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book.id, year, month: 2, day: 7 } as any
			])
		)
		.returning()
	const session = async (
		name: string,
		over: Record<string, unknown> = {}
	) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					name,
					lorebookId: book.id,
					lorebookBranchId: null,
					isGroup: false,
					...over
				} as any)
				.returning()
		)[0]
	const normal = await session("normal")
	const riding = await session("riding", { lineOnFirstWrite: true })
	const scene = async (sessionId: number, name: string) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: book.id,
					historyEntryId: null,
					sessionId,
					branchId: null,
					name,
					summary: `${name}.`,
					openedStoryClockYear: year,
					openedStoryClockMonth: 2,
					openedStoryClockDay: 7
				} as any)
				.returning()
		)[0]
	return { owner, book, other, entry, normal, riding, session, scene }
}

const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]
const sceneRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, id))
	)[0]
const historyEntriesOf = async (lorebookId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	).filter((e) => e.typeId === HISTORY_TYPE_ID)

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

describe("scenes:compile forks a riding branch session first", () => {
	test("entry ask: the riding session gets its own line and its scene; the compile reads only the normal scene", async () => {
		const w = await seedWorld("forks-entry")
		const { sceneCompileHandler } = await import("./scenes")
		const mine = await w.scene(w.normal.id, "Normal")
		const theirs = await w.scene(w.riding.id, "Riding")
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			() => {}
		)

		const forked = await sessionRow(w.riding.id)
		expect(forked.lineOnFirstWrite).toBe(false)
		expect(forked.lorebookBranchId).not.toBeNull()
		expect((await sceneRow(theirs.id)).branchId).toBe(forked.lorebookBranchId)
		expect((await sceneRow(mine.id)).branchId).toBeNull()
		expect(compiled).toEqual([[mine.id]])
		const activity = await compileActivity(w.owner.id, w.entry.id)
		expect(activity.sceneIds).toEqual([mine.id])
	}, 60_000)

	test("entry ask with only riding scenes: refused with the branch-session sentence; the fork still commits", async () => {
		const w = await seedWorld("forks-only-riding")
		const { sceneCompileHandler } = await import("./scenes")
		const theirs = await w.scene(w.riding.id, "Riding")
		compiled.length = 0

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{ historyEntryId: w.entry.id, branchId: null, moment: null },
				() => {}
			)
		).rejects.toThrow(SENTENCE)

		const forked = await sessionRow(w.riding.id)
		expect(forked.lineOnFirstWrite).toBe(false)
		expect(forked.lorebookBranchId).not.toBeNull()
		expect((await sceneRow(theirs.id)).branchId).toBe(forked.lorebookBranchId)
		expect(compiled).toEqual([])
	}, 60_000)

	test("by-date ask with only a riding scene: the sentence, no entry made, the fork committed", async () => {
		const w = await seedWorld("forks-bydate")
		const { sceneCompileHandler } = await import("./scenes")
		const theirs = await w.scene(w.riding.id, "Riding")
		const before = (await historyEntriesOf(w.book.id)).length
		// A day with no entry yet, so a made entry would show.
		await testDb
			.update(schema.scenes)
			.set({ openedStoryClockDay: 9 })
			.where(eq(schema.scenes.id, theirs.id))

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{
					lorebookId: w.book.id,
					date: { year: 5, month: 2, day: 9 },
					branchId: null,
					moment: null
				} as any,
				() => {}
			)
		).rejects.toThrow(SENTENCE)

		expect(await historyEntriesOf(w.book.id)).toHaveLength(before)
		const forked = await sessionRow(w.riding.id)
		expect(forked.lineOnFirstWrite).toBe(false)
		expect((await sceneRow(theirs.id)).branchId).toBe(forked.lorebookBranchId)
	}, 60_000)

	test("a riding session attached to another book is not forked; its scene compiles as before", async () => {
		const w = await seedWorld("forks-other-book")
		const { sceneCompileHandler } = await import("./scenes")
		const stray = await w.session("stray", {
			lineOnFirstWrite: true,
			lorebookId: w.other.id
		})
		const theirs = await w.scene(stray.id, "Stray")
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			() => {}
		)

		const row = await sessionRow(stray.id)
		expect(row.lineOnFirstWrite).toBe(true)
		expect(row.lorebookBranchId).toBeNull()
		expect(compiled).toEqual([[theirs.id]])
	}, 60_000)
})
