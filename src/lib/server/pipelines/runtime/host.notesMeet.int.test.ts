/**
 * Under Full on the owner's own lorebook a session writes on the `book` route,
 * and its notes meet that write where a row waits in them: a link to a row
 * waiting in the notes lands in the notes (dated by the notes' dating, the
 * line forked by nothing), a history day for a date the notes already hold is
 * filed onto the notes' day, and a session whose scenes end by themselves
 * keeps a history day rule C would refuse on its line in the notes. Driven
 * through the real outlets, Back / Forward and the automatic Apply.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

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

const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
const LINK = {
	key: "tie",
	definitionId: "core:outlet/link-lore-entries"
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-notes-meet-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(
	opts: { ends?: boolean; fork?: boolean; pending?: boolean } = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `notes-meet-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [fork] = opts.fork
		? await db
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: book!.id,
					name: `Fork ${suffix}`,
					forkYear: 4
				})
				.returning()
		: []
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId: book!.id,
			...(fork ? { lorebookBranchId: fork.id } : {}),
			...(opts.pending ? { lineOnFirstWrite: true } : {})
		})
		.returning()
	if (opts.ends) scenesEnd.add(session!.id)
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db as unknown as Db, session!.id)
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	return {
		user,
		book: book!,
		fork,
		session: session!,
		own,
		message: legacy!,
		suffix
	}
}
type World = Awaited<ReturnType<typeof world>>

/** A turn after the fixtures: what a write anchors to, so Back leaves the rows made before it. */
const laterMessage = async (w: World) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: w.session.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: w.session.id, role: "assistant" })
	return legacy!
}

const hostOf = async (w: World, runId = `run-${w.suffix}`) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(
		db as unknown as Db,
		{ sessionId: w.session.id, userId: w.user.id, runId } as any
	)
}

async function room(
	w: World,
	lorebookId: number,
	title: string,
	extra: Record<string, unknown> = {}
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `${title}.`,
			fields: { category: "Rooms" },
			...(lorebookId === w.own.id
				? { sourceMessageId: w.message.id }
				: {}),
			...extra
		})
		.returning()
	return row!
}

async function day(
	w: World,
	lorebookId: number,
	year: number,
	content: string,
	extra: Record<string, unknown> = {}
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: `Year ${year}`,
			content,
			fields: { year, month: null, day: null },
			...(lorebookId === w.own.id
				? { sourceMessageId: w.message.id }
				: {}),
			...extra
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const entriesIn = (lorebookId: number, typeId?: string) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(
			typeId
				? and(
						eq(schema.lorebookEntries.lorebookId, lorebookId),
						eq(schema.lorebookEntries.typeId, typeId)
					)
				: eq(schema.lorebookEntries.lorebookId, lorebookId)
		)
		.orderBy(schema.lorebookEntries.id)
const linksIn = (lorebookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
const sessionRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

const roomIn = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	content: "A room.",
	params: { entryType: LOCATION_TYPE_ID },
	...extra
})
const historyIn = (content: string, fields: Record<string, unknown> = {}) => ({
	content,
	params: { entryType: HISTORY_TYPE_ID },
	fields
})

describe("a link to a row waiting in the notes", () => {
	it("lands in the notes, dated by the notes' dating, forking nothing; Back takes it and Forward puts it back", async () => {
		const w = await world({ pending: true })
		const hall = await room(w, w.book.id, "The Hall")
		const cellar = await room(w, w.book.id, "The Cellar")
		const waiting = await room(w, w.own.id, "Waiting Room")
		await day(w, w.book.id, 3, "Old.")
		const newer = await day(w, w.own.id, 5, "Newer.")
		const h = await hostOf(w)
		const byName: any = await h.commit!(
			{ from: "The Hall", to: "Waiting Room" },
			LINK
		)
		const byId: any = await h.commit!(
			{ from: cellar.id, to: waiting.id },
			LINK
		)
		expect(byName.lorebookId).toBe(w.own.id)
		expect(byId.lorebookId).toBe(w.own.id)
		expect(await linksIn(w.book.id)).toHaveLength(0)
		const links = await linksIn(w.own.id)
		expect(links.map((l) => [l.fromEntryId, l.toEntryId]).sort()).toEqual(
			[
				[hall.id, waiting.id],
				[cellar.id, waiting.id]
			].sort()
		)
		for (const l of links) expect(l.historyEntryId).toBe(newer.id)
		expect(await sessionRow(w.session.id)).toMatchObject({
			lineOnFirstWrite: true,
			lorebookBranchId: null
		})

		const {
			retractStateAnchoredTo,
			restoreRetractedState,
			reviveRetractedState
		} = await import("$lib/server/state/write")
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(
				tx as unknown as Db,
				w.message.id,
				"leaves",
				{ leavingWith: [w.message.id] }
			)
		)
		expect(undone.changed).toBe(true)
		expect(await linksIn(w.own.id)).toHaveLength(0)
		const record = reviveRetractedState(
			JSON.parse(JSON.stringify(undone.taken)),
			w.session.id
		)!
		expect(await restoreRetractedState(db as unknown as Db, record)).toBe(
			true
		)
		expect(await linksIn(w.own.id)).toHaveLength(2)
		expect(await linksIn(w.book.id)).toHaveLength(0)
	})

	it("between two entries of the lorebook is unchanged: a lorebook row, and a pending fork forks", async () => {
		const w = await world({ pending: true })
		const hall = await room(w, w.book.id, "The Hall")
		await room(w, w.book.id, "The Cellar")
		await room(w, w.own.id, "Waiting Room")
		const out: any = await (
			await hostOf(w)
		).commit!({ from: hall.id, to: "The Cellar" }, LINK)
		expect(out.lorebookId).toBe(w.book.id)
		expect(await linksIn(w.book.id)).toHaveLength(1)
		expect(await linksIn(w.own.id)).toHaveLength(0)
		const session = await sessionRow(w.session.id)
		expect(session.lineOnFirstWrite).toBe(false)
		expect(session.lorebookBranchId).not.toBeNull()
	})

	it("a name with one notes row and one lorebook entry links the notes row; two notes rows and one lorebook entry link the lorebook entry", async () => {
		const w = await world()
		const hall = await room(w, w.book.id, "The Hall")
		const twinLore = await room(w, w.book.id, "Twin")
		const twinNotes = await room(w, w.own.id, "Twin")
		const h = await hostOf(w)
		await h.commit!({ from: hall.id, to: "Twin" }, LINK)
		expect((await linksIn(w.own.id)).map((l) => l.toEntryId)).toEqual([
			twinNotes.id
		])
		expect(await linksIn(w.book.id)).toHaveLength(0)

		const cellar = await room(w, w.book.id, "The Cellar")
		const pairLore = await room(w, w.book.id, "Pair")
		await room(w, w.own.id, "Pair")
		await room(w, w.own.id, "Pair")
		const out: any = await h.commit!({ from: cellar.id, to: "Pair" }, LINK)
		expect(out.lorebookId).toBe(w.book.id)
		expect(
			(await linksIn(w.book.id)).map((l) => [l.fromEntryId, l.toEntryId])
		).toEqual([[cellar.id, pairLore.id]])
		expect(twinLore.id).not.toBe(twinNotes.id)
	})
})

describe("create-lore-entry's links", () => {
	it("a new room's link to a waiting room is written in the notes, a link to a lorebook room in the lorebook", async () => {
		const w = await world()
		const hall = await room(w, w.book.id, "The Hall")
		const waiting = await room(w, w.own.id, "Waiting Room")
		const out: any = await (
			await hostOf(w)
		).commit!(
			roomIn("The Attic", {
				links: [
					{ to: "Waiting Room" },
					{ to: hall.id, linkType: "above" }
				]
			}),
			CREATE
		)
		expect(out).toMatchObject({ route: "book", lorebookId: w.book.id })
		expect((await stored(out.id)).lorebookId).toBe(w.book.id)
		expect(out.linkIds).toHaveLength(2)
		expect(
			(await linksIn(w.own.id)).map((l) => [l.fromEntryId, l.toEntryId])
		).toEqual([[out.id, waiting.id]])
		expect(
			(await linksIn(w.book.id)).map((l) => [l.fromEntryId, l.toEntryId])
		).toEqual([[out.id, hall.id]])
	})

	it("a notes match's links carry the notes' dating", async () => {
		const w = await world()
		const hall = await room(w, w.book.id, "The Hall")
		const waiting = await room(w, w.own.id, "Waiting Room")
		await day(w, w.book.id, 3, "Old.")
		const newer = await day(w, w.own.id, 5, "Newer.")
		const out: any = await (
			await hostOf(w)
		).commit!(
			{
				...roomIn("Waiting Room"),
				match: { name: "Waiting Room" },
				links: [{ to: hall.id }]
			},
			CREATE
		)
		expect(out).toMatchObject({
			entryId: waiting.id,
			matched: true,
			route: "own-book",
			lorebookId: w.own.id
		})
		const links = await linksIn(w.own.id)
		expect(links).toHaveLength(1)
		expect(links[0]).toMatchObject({
			fromEntryId: waiting.id,
			toEntryId: hall.id,
			historyEntryId: newer.id
		})
	})

	it("a lorebook match whose only link goes to a notes row forks nothing", async () => {
		const w = await world({ pending: true })
		const vault = await room(w, w.book.id, "The Vault")
		const waiting = await room(w, w.own.id, "Waiting Room")
		const out: any = await (
			await hostOf(w)
		).commit!(
			{
				...roomIn("The Vault"),
				content: "Sealed.",
				match: { name: "The Vault" },
				shown: [vault.id],
				links: [{ to: waiting.id }]
			},
			CREATE
		)
		expect(out).toMatchObject({ entryId: vault.id, matched: true })
		expect(await sessionRow(w.session.id)).toMatchObject({
			lineOnFirstWrite: true,
			lorebookBranchId: null
		})
		expect(
			(await linksIn(w.own.id)).map((l) => [l.fromEntryId, l.toEntryId])
		).toEqual([[vault.id, waiting.id]])
		expect(await linksIn(w.book.id)).toHaveLength(0)
	})
})

describe("where a history day lands on the book route", () => {
	it("a session whose scenes end by themselves, fork pending, no moment: the day is written in the notes, not refused", async () => {
		const w = await world({ ends: true, pending: true })
		const out: any = await (
			await hostOf(w)
		).commit!(
			historyIn("Down we went.", { year: 3, month: 2, day: 9 }),
			CREATE
		)
		expect(out).toMatchObject({ route: "own-book", lorebookId: w.own.id })
		expect(await entriesIn(w.book.id, HISTORY_TYPE_ID)).toHaveLength(0)
		const days = await entriesIn(w.own.id, HISTORY_TYPE_ID)
		expect(days.map((d) => d.id)).toEqual([out.id])
		expect(days[0]!.content).toBe("Down we went.")
		expect(await sessionRow(w.session.id)).toMatchObject({
			lineOnFirstWrite: true,
			lorebookBranchId: null
		})
	})

	describe("fork pending, the story clock at Year 4", () => {
		const pendingAtYear4 = async () => {
			const w = await world({ ends: true, pending: true })
			await db
				.update(schema.sessions)
				.set({ storyClockYear: 4 })
				.where(eq(schema.sessions.id, w.session.id))
			return w
		}
		const branchesOf = (w: World) =>
			db
				.select()
				.from(schema.lorebookBranches)
				.where(eq(schema.lorebookBranches.lorebookId, w.book.id))

		for (const year of [4, 3]) {
			it(`a day dated Year ${year} is written in the notes: no branch, the fork still pending, nothing in the lorebook`, async () => {
				const w = await pendingAtYear4()
				const out: any = await (
					await hostOf(w)
				).commit!(historyIn("Early.", { year }), CREATE)
				expect(out).toMatchObject({
					route: "own-book",
					lorebookId: w.own.id
				})
				expect(await branchesOf(w)).toHaveLength(0)
				expect(await sessionRow(w.session.id)).toMatchObject({
					lineOnFirstWrite: true,
					lorebookBranchId: null
				})
				expect(await entriesIn(w.book.id, HISTORY_TYPE_ID)).toHaveLength(0)
				expect(
					(await entriesIn(w.own.id, HISTORY_TYPE_ID)).map((d) => d.id)
				).toEqual([out.id])
			})
		}

		it("a day dated Year 6 forks the line and lands in the lorebook on the new line, none in the notes", async () => {
			const w = await pendingAtYear4()
			const out: any = await (
				await hostOf(w)
			).commit!(historyIn("Later.", { year: 6 }), CREATE)
			expect(out).toMatchObject({ route: "book", lorebookId: w.book.id })
			const branches = await branchesOf(w)
			expect(branches).toHaveLength(1)
			expect((await sessionRow(w.session.id)).lorebookBranchId).toBe(
				branches[0]!.id
			)
			expect((await stored(out.id)).branchId).toBe(branches[0]!.id)
			expect(await entriesIn(w.own.id, HISTORY_TYPE_ID)).toHaveLength(0)
		})
	})

	it("on a forked line: a day on or before the fork date is the notes', a later day lands on the line", async () => {
		const w = await world({ ends: true, fork: true })
		const h = await hostOf(w)
		const before: any = await h.commit!(
			historyIn("Long ago.", { year: 3 }),
			CREATE
		)
		expect(before).toMatchObject({
			route: "own-book",
			lorebookId: w.own.id
		})
		const onFork: any = await h.commit!(
			historyIn("At the fork.", { year: 4 }),
			CREATE
		)
		expect(onFork).toMatchObject({
			route: "own-book",
			lorebookId: w.own.id
		})
		const after: any = await h.commit!(
			historyIn("Later.", { year: 6 }),
			CREATE
		)
		expect(after).toMatchObject({ route: "book", lorebookId: w.book.id })
		expect((await stored(after.id)).branchId).toBe(w.fork!.id)
		expect(await entriesIn(w.book.id, HISTORY_TYPE_ID)).toHaveLength(1)
		expect(await entriesIn(w.own.id, HISTORY_TYPE_ID)).toHaveLength(2)
	})

	it("the notes' day stays waiting at the next scene close when the line's reading holds a day for that date", async () => {
		const w = await world({ ends: true, fork: true })
		// Main holds Year 3, which the fork (Year 4) shares: the line does not own that day.
		const mainDay = await day(w, w.book.id, 3, "A")
		const notesDay: any = await (
			await hostOf(w)
		).commit!(historyIn("B", { year: 3 }), CREATE)
		expect(notesDay).toMatchObject({
			route: "own-book",
			lorebookId: w.own.id
		})
		const [scene] = await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: w.book.id,
				closedAtMessageId: w.message.id
			})
			.returning()
		const { applyHeldAutomatically } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		const result: any = await applyHeldAutomatically(db as unknown as Db, {
			sessionId: w.session.id,
			automatic: "scene-close",
			sceneId: scene!.id
		})
		expect(result.mergedDays).toEqual([])
		expect(result.heldDays).toHaveLength(1)
		expect(result.heldDays[0]).toMatchObject({ notesEntryId: notesDay.id })
		expect(result.heldDays[0].reason).toMatch(/shares everything up to/)
		expect(
			(await entriesIn(w.own.id, HISTORY_TYPE_ID)).map((d) => d.id)
		).toEqual([notesDay.id])
		expect(
			(await entriesIn(w.book.id, HISTORY_TYPE_ID)).map((d) => d.id)
		).toEqual([mainDay.id])
		expect((await stored(mainDay.id)).content).toBe("A")
	})

	it("a session whose scenes do not end by themselves is still refused a day rule C refuses", async () => {
		const w = await world({ pending: true })
		await expect(
			(await hostOf(w)).commit!(
				historyIn("Down we went.", { year: 3, month: 2, day: 9 }),
				CREATE
			)
		).rejects.toThrow(/with no fork date/)
		expect(await sessionRow(w.session.id)).toMatchObject({
			lineOnFirstWrite: true
		})
		expect(await entriesIn(w.own.id, HISTORY_TYPE_ID)).toHaveLength(0)
	})

	it("a date the notes hold a waiting day for is filed onto that day, in order; scene close merges it into the lorebook's day; Back takes the paragraph out", async () => {
		const w = await world()
		const loreDay = await day(w, w.book.id, 3, "A")
		const notesDay = await day(w, w.own.id, 3, "B")
		const turn = await laterMessage(w)
		const h = await hostOf(w)
		const out: any = await h.commit!(historyIn("C", { year: 3 }), CREATE)
		expect(out).toMatchObject({
			entryId: notesDay.id,
			matched: true,
			route: "own-book",
			lorebookId: w.own.id
		})
		expect((await stored(notesDay.id)).content).toBe("B\n\nC")
		expect((await stored(loreDay.id)).content).toBe("A")
		expect(await entriesIn(w.book.id, HISTORY_TYPE_ID)).toHaveLength(1)
		expect(await entriesIn(w.own.id, HISTORY_TYPE_ID)).toHaveLength(1)

		// Back takes the paragraph out of the notes' day; Forward puts it back.
		const {
			retractStateAnchoredTo,
			restoreRetractedState,
			reviveRetractedState
		} = await import("$lib/server/state/write")
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, turn.id, "leaves", {
				leavingWith: [turn.id]
			})
		)
		expect(undone.changed).toBe(true)
		expect((await stored(notesDay.id)).content).toBe("B")
		const record = reviveRetractedState(
			JSON.parse(JSON.stringify(undone.taken)),
			w.session.id
		)!
		expect(await restoreRetractedState(db as unknown as Db, record)).toBe(
			true
		)
		expect((await stored(notesDay.id)).content).toBe("B\n\nC")

		const [scene] = await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: w.book.id,
				closedAtMessageId: w.message.id
			})
			.returning()
		const { applyHeldAutomatically } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		await applyHeldAutomatically(db as unknown as Db, {
			sessionId: w.session.id,
			automatic: "scene-close",
			sceneId: scene!.id
		})
		const days = await entriesIn(w.book.id, HISTORY_TYPE_ID)
		expect(days).toHaveLength(1)
		expect(days[0]!.id).toBe(loreDay.id)
		const content = days[0]!.content ?? ""
		expect(content.indexOf("A")).toBeGreaterThanOrEqual(0)
		expect(content.indexOf("A")).toBeLessThan(content.indexOf("B"))
		expect(content.indexOf("B")).toBeLessThan(content.indexOf("C"))
	})

	it("with no year, the notes' day newer than the lorebook's newest is the story's day: the write files onto it", async () => {
		const w = await world()
		await day(w, w.book.id, 3, "A")
		const newer = await day(w, w.own.id, 5, "B")
		const out: any = await (await hostOf(w)).commit!(historyIn("C"), CREATE)
		expect(out).toMatchObject({
			entryId: newer.id,
			matched: true,
			route: "own-book",
			lorebookId: w.own.id
		})
		expect((await stored(newer.id)).content).toBe("B\n\nC")
		expect(await entriesIn(w.own.id, HISTORY_TYPE_ID)).toHaveLength(1)
		expect(await entriesIn(w.book.id, HISTORY_TYPE_ID)).toHaveLength(1)
	})
})
