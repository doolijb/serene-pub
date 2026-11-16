/**
 * 🚧 A clock moved back past the session's own dated writes: the query
 * (`datedWritesPassed`), the one decider (`clockMoveBackNotice`) and the
 * Branch move (`moveClockBackOnBranch`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { clockMoveBackSentence } from "$lib/server/sessions/revision"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-clock-move-back-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	// The Branch move runs `core:spec/builtin-branch`: boot publishes it.
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const H = () => db as unknown as Db
const NOW = { year: 10, month: 4, day: 1 }
const BACK = { year: 10, month: 2, day: 1 }
const LATER = { year: 10, month: 3, day: 1 }

async function world(
	opts: { clock?: typeof NOW | null; timeline?: boolean } = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `clock-move-back-${suffix}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			...(opts.timeline === false ? { timelineEnabled: false } : {})
		})
		.returning()
	const clock = opts.clock === undefined ? NOW : opts.clock
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Crawl ${suffix}`,
			lorebookId: book!.id,
			...(clock
				? {
						storyClockYear: clock.year,
						storyClockMonth: clock.month,
						storyClockDay: clock.day
					}
				: {})
		})
		.returning()
	return { user, book: book!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

async function message(sessionId: number) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return await insertLegacy(
		db as any,
		{ sessionId, role: "assistant", content: "…" } as any
	)
}

async function place(w: World) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: w.book.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: `Hall ${n}`,
			content: "As written.",
			fields: { category: "Rooms" }
		})
		.returning()
	return row!
}

/** A dated version `sessionId` wrote (its imprint) at `date`. */
async function versionBy(
	w: World,
	sessionId: number,
	date: { year: number; month: number; day: number },
	content = "Later."
) {
	const entry = await place(w)
	const [v] = await db
		.insert(schema.entryAmendments)
		.values({
			lorebookId: w.book.id,
			entryId: entry.id,
			...date,
			fields: { content }
		})
		.returning()
	await db.insert(schema.loreImprints).values({
		sessionId,
		lorebookId: w.book.id,
		subjectKind: "version",
		subjectId: v!.id
	})
	return { entry, version: v! }
}

const notice = (
	w: World,
	move: Parameters<typeof import("./clockMoveBack").clockMoveBackNotice>[2]
) =>
	import("./clockMoveBack").then((m) =>
		m.clockMoveBackNotice(H(), w.session.id, move)
	)

describe("clockMoveBackNotice", () => {
	it("is null for a move back past nothing, a forward move, no clock, a Timeline off", async () => {
		const w = await world()
		expect(await notice(w, { to: BACK })).toBeNull()
		await versionBy(w, w.session.id, LATER)
		expect(
			await notice(w, { to: { year: 10, month: 5, day: 1 } })
		).toBeNull()
		expect(await notice(w, { to: NOW })).toBeNull()
		expect(await notice(w, { to: LATER })).toBeNull()

		const bare = await world({ clock: null })
		expect(await notice(bare, { to: BACK })).toBeNull()

		const off = await world({ timeline: false })
		await versionBy(off, off.session.id, LATER)
		expect(await notice(off, { to: BACK })).toBeNull()
	})

	it("names the mode, the count, the latest date and the sentence; Branch says the other", async () => {
		const w = await world()
		await versionBy(w, w.session.id, LATER)
		const got = await notice(w, { to: BACK })
		expect(got).toMatchObject({ mode: "overwrite", count: 1 })
		expect(got!.sentence).toBe(
			clockMoveBackSentence(
				"overwrite",
				1,
				got!.latestLabel,
				got!.toLabel
			)
		)
		expect(got!.sentence).toBe(
			`This moves the story back before 1 thing this session has written, the latest dated ${got!.latestLabel}. They stay in the lorebook and read again from their dates.`
		)
		await versionBy(w, w.session.id, { year: 10, month: 3, day: 9 })
		expect((await notice(w, { to: BACK }))!.count).toBe(2)

		await db
			.update(schema.sessions)
			.set({ onRevision: "branch" })
			.where(eq(schema.sessions.id, w.session.id))
		const branch = await notice(w, { to: BACK })
		expect(branch!.mode).toBe("branch")
		expect(branch!.sentence).toBe(
			`This branches the session here and moves the branch's story back to ${branch!.toLabel}. What this session has written dated after that stays on the line it leaves.`
		)
	})

	it("judges a step back and a follow the same way", async () => {
		const w = await world()
		await versionBy(w, w.session.id, LATER)
		expect(await notice(w, { by: -2, unit: "months" })).toMatchObject({
			count: 1
		})
		expect(await notice(w, { by: -1, unit: "days" })).toBeNull()
		expect(await notice(w, { by: 1, unit: "months" })).toBeNull()
		// The line's present is the book's; the book has none beyond the session's own clock history, so a follow passes nothing it was not already at.
		await db
			.update(schema.lorebooks)
			.set({ storyClockYear: 10, storyClockMonth: 2, storyClockDay: 1 })
			.where(eq(schema.lorebooks.id, w.book.id))
		expect(await notice(w, { follow: true })).toMatchObject({ count: 1 })
	})

	it("counts only this session's writes; a cast version and a scene of the session count; an undated tie does not", async () => {
		const w = await world()
		const other = (
			await db
				.insert(schema.sessions)
				.values({
					userId: w.user.id,
					isGroup: false,
					name: "Other",
					lorebookId: w.book.id
				})
				.returning()
		)[0]!
		await versionBy(w, other.id, LATER)
		expect(await notice(w, { to: BACK })).toBeNull()

		const [member] = await db
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: w.book.id,
				binding: "orrin",
				name: "Ser Orrin"
			})
			.returning()
		await db.insert(schema.characterVersions).values({
			castMemberId: member!.id,
			nodeState: "active",
			nodeVisibility: "normal",
			lorebookId: w.book.id,
			sourceSessionId: w.session.id,
			year: 10,
			month: 3,
			day: 5,
			atHour: 9,
			writeOrder: 1
		} as any)
		expect(await notice(w, { to: BACK })).toMatchObject({ count: 1 })

		await db.insert(schema.scenes).values({
			sessionId: w.session.id,
			lorebookId: w.book.id,
			openedStoryClockYear: 10,
			openedStoryClockMonth: 3,
			openedStoryClockDay: 7
		} as any)
		expect(await notice(w, { to: BACK })).toMatchObject({ count: 2 })

		// A scene opened with no year is undated.
		await db
			.insert(schema.scenes)
			.values({ sessionId: w.session.id, lorebookId: w.book.id } as any)
		// A tie with no history entry is undated.
		const a = await place(w)
		const b = await place(w)
		const [tie] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.book.id,
				fromEntryId: a.id,
				toEntryId: b.id,
				relationshipType: "ally"
			} as any)
			.returning()
		await db.insert(schema.loreImprints).values({
			sessionId: w.session.id,
			lorebookId: w.book.id,
			subjectKind: "relationship",
			subjectId: tie!.id
		})
		expect(await notice(w, { to: BACK })).toMatchObject({ count: 2 })

		// A tie filed under a dated history entry counts.
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: null,
				content: "A day.",
				fields: { year: 10, month: 3, day: 2 }
			})
			.returning()
		const [dated] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.book.id,
				fromEntryId: a.id,
				toEntryId: b.id,
				relationshipType: "ally",
				historyEntryId: day!.id
			} as any)
			.returning()
		await db.insert(schema.loreImprints).values({
			sessionId: w.session.id,
			lorebookId: w.book.id,
			subjectKind: "relationship",
			subjectId: dated!.id
		})
		expect(await notice(w, { to: BACK })).toMatchObject({ count: 3 })
	})
})

describe("moveClockBackOnBranch", () => {
	it("branches at the newest message and sets the branch's clock; the parent and its line stay", async () => {
		const w = await world()
		await message(w.session.id)
		const { entry } = await versionBy(
			w,
			w.session.id,
			LATER,
			"Sealed later."
		)
		const { moveClockBackOnBranch } = await import("./clockMoveBack")
		const moved = await moveClockBackOnBranch(H(), {
			sessionId: w.session.id,
			userId: w.user.id,
			to: BACK
		})
		expect(moved.ok).toBe(true)
		if (!moved.ok) return
		expect(moved.sessionId).not.toBe(w.session.id)

		const [child] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, moved.sessionId))
		expect([
			child!.storyClockYear,
			child!.storyClockMonth,
			child!.storyClockDay
		]).toEqual([10, 2, 1])
		const [parent] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect([
			parent!.storyClockYear,
			parent!.storyClockMonth,
			parent!.storyClockDay
		]).toEqual([10, 4, 1])
		expect(parent!.lorebookBranchId).toBeNull()

		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { entryOverlaysFor, entryAt } = await import(
			"$lib/server/state/entriesOnReading"
		)
		const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
		const [stored] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))
		const read = async (sessionId: number) => {
			const reading = (await sessionReadingOf(H(), sessionId))!
			const overlays = await entryOverlaysFor(H(), w.book.id, reading, [
				entry.id
			])
			return entryAt(toEntryRow(stored!), overlays, reading).content
		}
		expect(await read(moved.sessionId)).toBe("As written.")
		expect(await read(w.session.id)).toBe("Sealed later.")

		// The first dated write on the branch forks the line at the date moved to.
		const { ensureSessionLine } = await import(
			"$lib/server/lorebooks/sessionLine"
		)
		const lineId = await db.transaction(async (tx) =>
			ensureSessionLine(tx as unknown as Db, moved.sessionId)
		)
		expect(lineId).not.toBeNull()
		const [line] = await db
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, lineId!))
		expect([line!.forkYear, line!.forkMonth, line!.forkDay]).toEqual([
			10, 2, 1
		])
		// The old line still has the later version.
		expect(await read(w.session.id)).toBe("Sealed later.")
	})

	it("refuses with a sentence when the session has no messages", async () => {
		const w = await world()
		const { moveClockBackOnBranch } = await import("./clockMoveBack")
		const { NO_MESSAGE_TO_BRANCH_AT } = await import("./revision")
		expect(
			await moveClockBackOnBranch(H(), {
				sessionId: w.session.id,
				userId: w.user.id,
				to: BACK
			})
		).toEqual({
			ok: false,
			error: NO_MESSAGE_TO_BRANCH_AT
		})
	})
})

describe("Overwrite", () => {
	it("a plain clock set back leaves the later version, which reads again once the clock passes its date", async () => {
		const w = await world()
		const { entry } = await versionBy(
			w,
			w.session.id,
			LATER,
			"Sealed later."
		)
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { entryOverlaysFor, entryAt } = await import(
			"$lib/server/state/entriesOnReading"
		)
		const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
		const [stored] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))
		const read = async () => {
			const reading = (await sessionReadingOf(H(), w.session.id))!
			const overlays = await entryOverlaysFor(H(), w.book.id, reading, [
				entry.id
			])
			return entryAt(toEntryRow(stored!), overlays, reading).content
		}
		const setClock = (c: typeof NOW) =>
			db
				.update(schema.sessions)
				.set({
					storyClockYear: c.year,
					storyClockMonth: c.month,
					storyClockDay: c.day
				})
				.where(eq(schema.sessions.id, w.session.id))
		expect(await read()).toBe("Sealed later.")
		await setClock(BACK)
		expect(await read()).toBe("As written.")
		expect(
			await db
				.select()
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.entryId, entry.id))
		).toHaveLength(1)
		await setClock(NOW)
		expect(await read()).toBe("Sealed later.")
	})
})
