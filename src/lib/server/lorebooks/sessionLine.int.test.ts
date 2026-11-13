/**
 * 🚧 `ensureSessionLine`: a branch session riding its parent's line forks the
 * attached book a line of its own on its first write to it (plan §32 §5a),
 * and the two existing book-write paths — `bookWritePlace` (a value) and
 * `loreWriteTargetFor` — each fork it once.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-line-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const WEATHER = "core:slot/weather@1"
const GENRE = "test:genre/session-line"

function declareSlots() {
	_clearAttributeSlots()
	const weather = defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "storm", "fog"] }
	})
	genreKeeping(GENRE, {
		name: { en: "Session line" },
		family: "test",
		slots: [weather],
		events: {}
	})
}

let n = 0

/** A book with a Fork, and a branch session riding the Fork that forks its own on first write. */
async function world(
	opts: {
		name?: string | null
		flag?: boolean
		attached?: boolean
		bookOwnedBySession?: boolean
		clock?: { year: number; month?: number; day?: number } | null
	} = {}
) {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `session-line-${suffix}`)
	const other = await createTestUser(testDb, `session-line-other-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: opts.bookOwnedBySession === false ? other.id : user.id,
			name: `World ${suffix}`
		})
		.returning()
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 })
		.returning()
	const clock =
		opts.clock === undefined ? { year: 7, month: 2, day: 3 } : opts.clock
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: opts.name === undefined ? `Run ${suffix}` : opts.name,
			genreId: GENRE,
			lorebookId: opts.attached === false ? null : book!.id,
			lorebookBranchId: opts.attached === false ? null : fork!.id,
			lineOnFirstWrite: opts.flag ?? true,
			storyClockYear: clock?.year ?? null,
			storyClockMonth: clock?.month ?? null,
			storyClockDay: clock?.day ?? null
		})
		.returning()
	return { user, book: book!, fork: fork!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

const ensure = async (sessionId: number) => {
	const { ensureSessionLine } = await import("./sessionLine")
	return ensureSessionLine(testDb as unknown as Db, sessionId)
}

const linesOf = (bookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))

const sessionOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

describe("ensureSessionLine", () => {
	test("a session without the flag changes nothing and answers its line", async () => {
		const w = await world({ flag: false })
		expect(await ensure(w.session.id)).toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
		const main = await world({ flag: false })
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: null })
			.where(eq(schema.sessions.id, main.session.id))
		expect(await ensure(main.session.id)).toBeNull()
	})

	test("an unknown session answers null", async () => {
		expect(await ensure(987654321)).toBeNull()
	})

	test("the flag with an attached book forks a line from the current line at the session's day, named after the session", async () => {
		const w = await world({ name: "  The long night  " })
		const line = await ensure(w.session.id)
		expect(line).not.toBeNull()
		expect(line).not.toBe(w.fork.id)
		const [made] = (await linesOf(w.book.id)).filter((b) => b.id === line)
		expect(made).toMatchObject({
			name: "The long night",
			forkedFromBranchId: w.fork.id,
			forkYear: 7,
			forkMonth: 2,
			forkDay: 3
		})
		const after = await sessionOf(w.session.id)
		expect(after.lorebookBranchId).toBe(line)
		expect(after.lineOnFirstWrite).toBe(false)
	})

	test("a fork at now (no clock, no present) stores no date", async () => {
		const w = await world({ clock: null })
		const line = await ensure(w.session.id)
		const [made] = (await linesOf(w.book.id)).filter((b) => b.id === line)
		expect(made).toMatchObject({
			forkedFromBranchId: w.fork.id,
			forkYear: null,
			forkMonth: null,
			forkDay: null
		})
	})

	test("a second call forks nothing and answers the new line", async () => {
		const w = await world()
		const first = await ensure(w.session.id)
		expect(await ensure(w.session.id)).toBe(first)
		expect(await linesOf(w.book.id)).toHaveLength(2)
	})

	test("a name clash in the book gets (2), then (3)", async () => {
		const a = await world({ name: "Dusk" })
		await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: a.book.id, name: "Dusk" })
		const line = await ensure(a.session.id)
		const names = (await linesOf(a.book.id)).map((b) => b.name)
		expect(names).toContain("Dusk (2)")
		// A second branch session on the same book, same name.
		const [again] = await testDb
			.insert(schema.sessions)
			.values({
				userId: a.user.id,
				isGroup: false,
				name: "Dusk",
				genreId: GENRE,
				lorebookId: a.book.id,
				lorebookBranchId: line,
				lineOnFirstWrite: true
			})
			.returning()
		await ensure(again!.id)
		expect((await linesOf(a.book.id)).map((b) => b.name)).toContain(
			"Dusk (3)"
		)
	})

	test("a session named main, or blank, or very long gets a legal, unique name", async () => {
		const m = await world({ name: "main" })
		await ensure(m.session.id)
		expect((await linesOf(m.book.id)).map((b) => b.name)).toContain(
			"main (2)"
		)
		const blank = await world({ name: "   " })
		await ensure(blank.session.id)
		expect((await linesOf(blank.book.id)).map((b) => b.name)).toContain(
			`Session ${blank.session.id}`
		)
		const unnamed = await world({ name: null })
		await ensure(unnamed.session.id)
		expect((await linesOf(unnamed.book.id)).map((b) => b.name)).toContain(
			`Session ${unnamed.session.id}`
		)
		const longName = "L".repeat(75)
		const long = await world({ name: longName })
		await testDb.insert(schema.lorebookBranches).values({
			lorebookId: long.book.id,
			name: longName.slice(0, 60)
		})
		await ensure(long.session.id)
		const names = (await linesOf(long.book.id)).map((b) => b.name)
		expect(names).toContain("L".repeat(56) + " (2)")
		expect(Math.max(...names.map((x) => x.length))).toBeLessThanOrEqual(60)
	})

	test("no attached book: nothing is made, the flag stays", async () => {
		const w = await world({ attached: false })
		expect(await ensure(w.session.id)).toBeNull()
		expect(await linesOf(w.book.id)).toHaveLength(1)
		expect((await sessionOf(w.session.id)).lineOnFirstWrite).toBe(true)
	})
})

describe("the existing book-write paths fork the line once", () => {
	const ctxOf = (w: World) => ({
		sessionId: w.session.id,
		updatedBy: `user:${w.user.id}`,
		userId: w.user.id
	})
	const change = (bookId: number, value: string) => ({
		owner: { kind: "lorebook" as const, id: bookId },
		slotId: WEATHER,
		value
	})

	test("bookWritePlace, through a real value write to the attached book", async () => {
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		const id = await setValue(
			testDb as unknown as Db,
			ctxOf(w),
			change(w.book.id, "storm")
		)
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.fork.id)
		const [row] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, id))
		expect(row!.branchId).toBe(after.lorebookBranchId)
		expect(await linesOf(w.book.id)).toHaveLength(2)

		await setValue(
			testDb as unknown as Db,
			ctxOf(w),
			change(w.book.id, "fog")
		)
		expect(await linesOf(w.book.id)).toHaveLength(2)
	})

	test("an own-book write forks nothing", async () => {
		// A book someone else owns: the session keeps its world values in its own notes.
		const w = await world({ bookOwnedBySession: false })
		const { ownBookFor } = await import("./ownBook")
		const own = await ownBookFor(testDb as unknown as Db, w.session.id)
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			testDb as unknown as Db,
			ctxOf(w),
			change(own.id, "storm")
		)
		expect(await linesOf(w.book.id)).toHaveLength(1)
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.fork.id)
	})

	test("loreWriteTargetFor on route book forks it once", async () => {
		const w = await world()
		const { loreWriteTargetFor } = await import("./ownBook")
		const target = await loreWriteTargetFor(
			testDb as unknown as Db,
			w.session.id
		)
		expect(target.route).toBe("book")
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.fork.id)
		await loreWriteTargetFor(testDb as unknown as Db, w.session.id)
		expect(await linesOf(w.book.id)).toHaveLength(2)
	})

	test("loreWriteTargetFor on route own-book (a book someone else owns) forks nothing", async () => {
		const w = await world({ bookOwnedBySession: false })
		const { loreWriteTargetFor } = await import("./ownBook")
		const target = await loreWriteTargetFor(
			testDb as unknown as Db,
			w.session.id
		)
		expect(target.route).toBe("own-book")
		expect(await linesOf(w.book.id)).toHaveLength(1)
		expect((await sessionOf(w.session.id)).lineOnFirstWrite).toBe(true)
	})
})

describe("the first write carries the session's uncompiled scenes", () => {
	const scenesOf = (ids: number[]) =>
		testDb
			.select({ id: schema.scenes.id, branchId: schema.scenes.branchId })
			.from(schema.scenes)
			.where(inArray(schema.scenes.id, ids))
	const branchOf = async (id: number) => (await scenesOf([id]))[0]!.branchId
	const firstWrite = async (w: World) => {
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			testDb as unknown as Db,
			{
				sessionId: w.session.id,
				updatedBy: `user:${w.user.id}`,
				userId: w.user.id
			},
			{
				owner: { kind: "lorebook" as const, id: w.book.id },
				slotId: WEATHER,
				value: "storm"
			}
		)
	}

	test("only its own uncompiled scenes on the line it rode move onto the new line", async () => {
		const w = await world()
		const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
		const [history] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: 0,
				title: "Year 5",
				content: "",
				branchId: w.fork.id
			})
			.returning()
		const [otherSession] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: "Another",
				genreId: GENRE,
				lorebookId: w.book.id,
				lorebookBranchId: w.fork.id
			})
			.returning()
		const scene = async (
			sessionId: number,
			branchId: number | null,
			historyEntryId: number | null = null
		) =>
			(
				await testDb
					.insert(schema.scenes)
					.values({
						lorebookId: w.book.id,
						sessionId,
						branchId,
						historyEntryId,
						channel: "main"
					})
					.returning({ id: schema.scenes.id })
			)[0]!.id
		const own = await scene(w.session.id, w.fork.id)
		const compiled = await scene(w.session.id, w.fork.id, history!.id)
		const theirs = await scene(otherSession!.id, w.fork.id)
		const onMain = await scene(w.session.id, null)
		// The session's uncompiled scene in a second book, on the same branch
		// id value as the line the session rides: another book's scene stays put.
		const [secondBook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Second book" })
			.returning()
		const elsewhere = (
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: secondBook!.id,
					sessionId: w.session.id,
					branchId: w.fork.id,
					channel: "main"
				})
				.returning({ id: schema.scenes.id })
		)[0]!.id

		await firstWrite(w)
		const line = (await sessionOf(w.session.id)).lorebookBranchId
		expect(line).not.toBe(w.fork.id)
		expect(await branchOf(own)).toBe(line)
		expect(await branchOf(compiled)).toBe(w.fork.id)
		expect(await branchOf(theirs)).toBe(w.fork.id)
		expect(await branchOf(onMain)).toBeNull()
		expect(await branchOf(elsewhere)).toBe(w.fork.id)
	})

	test("capturing a scene forks nothing; the first write carries it", async () => {
		const w = await world()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const boundary = await insertLegacy(testDb as never, {
			sessionId: w.session.id,
			role: "user",
			channel: "main",
			content: "We arrive.",
			userId: w.user.id
		})
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const opened = await openScene(testDb as unknown as Db, {
			sessionId: w.session.id,
			userId: w.user.id,
			atMessageId: boundary.id
		})
		expect((await sessionOf(w.session.id)).lineOnFirstWrite).toBe(true)
		expect(await branchOf(opened.scene.id)).toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)

		await firstWrite(w)
		const line = (await sessionOf(w.session.id)).lorebookBranchId
		expect(line).not.toBe(w.fork.id)
		expect(await branchOf(opened.scene.id)).toBe(line)
	})
})

describe("sessionLoreWrite reads the line and forks nothing", () => {
	test("answers the line as it stands, a refused call and an allowed one both fork nothing", async () => {
		const w = await world()
		const { sessionLoreWrite } = await import("$lib/server/messages/writes")
		const db = testDb as unknown as Db
		const ask = { sessionId: w.session.id, lorebookId: w.book.id }

		await expect(
			sessionLoreWrite(db, { ...ask, userId: w.user.id + 100_000 })
		).rejects.toThrow()
		const write = await sessionLoreWrite(db, { ...ask, userId: w.user.id })
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.fork.id)
		expect(write.branchId).toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
	})
})
