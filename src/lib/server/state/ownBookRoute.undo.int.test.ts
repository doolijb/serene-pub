/**
 * 🚧 **A turn owns what it wrote — on the own-book route.** A session that
 * reads an attached lorebook it may not write (your own lorebook under Review,
 * or a member's session on someone else's) writes into its own book: a new
 * entry, a new history day, a paragraph onto an earlier turn's day, links whose
 * ends may be the lorebook's entries. One turn's writes, driven through the
 * real outlets, go by every road a turn leaves (a swipe, a regenerate, Back, a
 * delete) and come back by Forward and by a failed re-tell, whole, ids and
 * text exact; an earlier turn's rows stay.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db

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
		path.join(os.tmpdir(), "serene-pub-vitest-own-book-route-undo-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Kind = "review" | "member"

async function world(kind: Kind) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `own-undo-${suffix}`)
	const who =
		kind === "review"
			? owner
			: await createTestUser(db, `own-undo-member-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: owner.id, loreWriteMode: "review" })
	if (kind === "member")
		await db
			.insert(schema.userSettings)
			.values({ userId: who.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: who.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(asDb(), session!.id)
	const room = async (title: string) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++n,
					title,
					content: `${title}, as written.`,
					fields: { category: "Rooms" }
				})
				.returning()
		)[0]!
	const docks = await room("The Docks")
	const quay = await room("The Quay")
	const message = async () => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db.insert(schema.messages).values({
			id: legacy!.id,
			sessionId: session!.id,
			role: "assistant"
		})
		return legacy!
	}
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = (runId: string) =>
		createHost(asDb(), {
			sessionId: session!.id,
			userId: who.id,
			runId
		})
	const day = (runId: string, content: string, date: number) =>
		host(runId).commit!(
			{
				name: "Day",
				content,
				params: { entryType: HISTORY_TYPE_ID },
				fields: { year: 3, month: 2, day: date }
			},
			CREATE
		) as Promise<any>
	const roomIn = (runId: string, name: string) =>
		host(runId).commit!(
			{
				name,
				content: "A room.",
				params: { entryType: LOCATION_TYPE_ID }
			},
			CREATE
		) as Promise<any>
	const tie = (runId: string, from: number | string, to: number | string) =>
		host(runId).commit!({ from, to }, LINK) as Promise<any>

	/**
	 * What the own book and the session's imprints hold, row for row (an
	 * entry's `updatedAt` is the clock of the last touch, so it is not compared).
	 */
	const snapshot = async () => ({
		entries: (
			await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, own.id))
				.orderBy(asc(schema.lorebookEntries.id))
		).map(({ updatedAt: _touched, ...row }) => row),
		links: await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, own.id))
			.orderBy(asc(schema.narrativeRelationships.id)),
		imprints: await db
			.select()
			.from(schema.loreImprints)
			.where(eq(schema.loreImprints.sessionId, session!.id))
			.orderBy(asc(schema.loreImprints.id)),
		bookLinks: await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, book!.id)),
		bookEntries: await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, book!.id))
			.orderBy(asc(schema.lorebookEntries.id))
	})

	// Turn 1: an own-book room, a day, and a link of its own.
	const m1 = await message()
	const den = await roomIn("t1", "The Den")
	const dayOne = await day("t1", "A.", 4)
	await tie("t1", den.id, docks.id)
	const afterOne = await snapshot()

	// Turn 2: one of every kind.
	const m2 = await message()
	const cellar = await roomIn("t2", "The Cellar")
	const newDay = await day("t2", "C.", 9)
	const paragraph = await day("t2", "B.", 4)
	const mixed = await tie("t2", cellar.id, docks.id)
	const both = await tie("t2", docks.id, quay.id)
	const afterTwo = await snapshot()
	return {
		kind,
		session: session!,
		own,
		docks,
		quay,
		m1,
		m2,
		den,
		dayOne,
		cellar,
		newDay,
		paragraph,
		mixed,
		both,
		afterOne,
		afterTwo,
		snapshot
	}
}

describe.each<Kind>(["review", "member"])(
	"a turn owns what it wrote on the own-book route · %s",
	(kind) => {
		it("the world holds what turn 2 wrote, anchored to it", async () => {
			const w = await world(kind)
			expect(w.paragraph.id).toBe(w.dayOne.id)
			expect(w.newDay.id).not.toBe(w.dayOne.id)
			const day = w.afterTwo.entries.find((e) => e.id === w.dayOne.id)!
			expect(day.content).toBe("A.\n\nB.")
			expect(
				w.afterTwo.entries.find((e) => e.id === w.cellar.id)!
					.sourceMessageId
			).toBe(w.m2.id)
			expect(
				w.afterTwo.entries.find((e) => e.id === w.newDay.id)!
					.sourceMessageId
			).toBe(w.m2.id)
			expect(w.afterTwo.links.map((l) => l.id)).toEqual([
				...w.afterOne.links.map((l) => l.id),
				w.mixed.id,
				w.both.id
			])
			// Links on the lorebook's own entries filed in the own book.
			expect(w.afterTwo.bookLinks).toEqual([])
			const added = w.afterTwo.imprints.slice(w.afterOne.imprints.length)
			expect(added.every((i) => i.messageId === w.m2.id)).toBe(true)
			expect(
				added.filter((i) => i.subjectKind === "relationship")
			).toHaveLength(2)
		})

		it("a swipe takes exactly turn 2's writes; a failed re-tell puts every one back", async () => {
			const w = await world(kind)
			const { retractStateAnchoredTo, restoreRetractedState } =
				await import("./write")
			const taken = await retractStateAnchoredTo(
				asDb(),
				w.m2.id,
				"replaced"
			)
			expect(taken.changed).toBe(true)
			expect(await w.snapshot()).toEqual(w.afterOne)
			expect(await restoreRetractedState(asDb(), taken.taken)).toBe(true)
			expect(await w.snapshot()).toEqual(w.afterTwo)
		})

		it("a regenerate (the retake's delete of the turn's rows) takes exactly turn 2's writes", async () => {
			const w = await world(kind)
			const { deleteLegacyWhere } = await import(
				"$lib/server/messages/store"
			)
			await db.transaction(async (tx) =>
				deleteLegacyWhere(
					tx as unknown as Db,
					inArray(schema.sessionMessages.id, [w.m2.id])
				)
			)
			expect(await w.snapshot()).toEqual(w.afterOne)
		})

		it("a delete takes exactly turn 2's writes, then turn 1's", async () => {
			const w = await world(kind)
			const { deleteLegacy } = await import("$lib/server/messages/store")
			await db.transaction(async (tx) =>
				deleteLegacy(tx as unknown as Db, w.m2.id)
			)
			expect(await w.snapshot()).toEqual(w.afterOne)
			await db.transaction(async (tx) =>
				deleteLegacy(tx as unknown as Db, w.m1.id)
			)
			const empty = await w.snapshot()
			expect(empty.entries).toEqual([])
			expect(empty.links).toEqual([])
			expect(empty.imprints).toEqual([])
		})

		it("Back takes exactly turn 2's writes; Forward (the record read back from JSON) puts every one back, the paragraph's text exact", async () => {
			const w = await world(kind)
			const {
				retractStateAnchoredTo,
				reviveRetractedState,
				restoreRetractedState
			} = await import("./write")
			const undone = await db.transaction(async (tx) =>
				retractStateAnchoredTo(tx as unknown as Db, w.m2.id, "leaves", {
					leavingWith: [w.m2.id]
				})
			)
			expect(undone.changed).toBe(true)
			expect(await w.snapshot()).toEqual(w.afterOne)
			expect(
				(await w.snapshot()).entries.find((e) => e.id === w.dayOne.id)!
					.content
			).toBe("A.")
			const record = reviveRetractedState(
				JSON.parse(JSON.stringify(undone.taken)),
				w.session.id
			)!
			expect(await restoreRetractedState(asDb(), record)).toBe(true)
			const back = await w.snapshot()
			expect(back).toEqual(w.afterTwo)
			expect(
				back.entries.find((e) => e.id === w.dayOne.id)!.content
			).toBe("A.\n\nB.")
		})
	}
)

/**
 * A press-started run (an `action`-family run with no turn message) anchors its
 * own-book rows to the session's newest message: an entry and a day by
 * `source_message_id`, a link by its made-row imprint. What it takes with that
 * message is pinned here; a paragraph a press appends is not imprinted.
 */
describe.each<Kind>(["review", "member"])(
	"a press-started run on the own-book route · %s",
	(kind) => {
		async function pressed(kind: Kind) {
			const { withRunFamily } = await import("$lib/server/utils/llmQueue")
			const w = await world(kind)
			const [{ userId }] = await db
				.select({ userId: schema.sessions.userId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, w.session.id))
			const { createHost } = await import(
				"$lib/server/pipelines/runtime/host"
			)
			const host = createHost(asDb(), {
				sessionId: w.session.id,
				userId,
				runId: "press"
			})
			const press = <T>(f: () => Promise<T>) => withRunFamily("action", f)
			const room: any = await press(async () =>
				host.commit!(
					{
						name: "PressRoom",
						content: "x",
						params: { entryType: LOCATION_TYPE_ID }
					},
					CREATE
				)
			)
			const dayWrite = (date: number, content: string) =>
				press(
					async () =>
						host.commit!(
							{
								name: "Day",
								content,
								params: { entryType: HISTORY_TYPE_ID },
								fields: { year: 3, month: 2, day: date }
							},
							CREATE
						) as Promise<any>
				)
			const newDay = await dayWrite(17, "Q.")
			const paragraph = await dayWrite(4, "P.")
			const link: any = await press(async () =>
				host.commit!({ from: room.id, to: w.docks.id }, LINK)
			)
			return { w, room, newDay, paragraph, link }
		}

		it("anchors an entry and a new day by source message, a link by its imprint at the newest message, a paragraph by nothing", async () => {
			const { w, room, newDay, paragraph, link } = await pressed(kind)
			const s = await w.snapshot()
			const at = (id: number) =>
				s.entries.find((e) => e.id === id)!.sourceMessageId
			expect(at(room.id)).toBe(w.m2.id)
			expect(at(newDay.id)).toBe(w.m2.id)
			expect(paragraph.id).toBe(w.dayOne.id)
			expect(s.entries.find((e) => e.id === w.dayOne.id)!.content).toBe(
				"A.\n\nB.\n\nP."
			)
			const mine = s.imprints.filter((i) => i.runId === "press")
			expect(
				mine.map((i) => [
					i.messageId,
					i.subjectKind,
					i.subjectId,
					i.field
				])
			).toEqual([[w.m2.id, "relationship", link.id, null]])
		})

		it("Back of the newest message takes the press's entry, new day and link with the turn's", async () => {
			const { w, room, newDay, link } = await pressed(kind)
			const { retractStateAnchoredTo } = await import("./write")
			const undone = await db.transaction(async (tx) =>
				retractStateAnchoredTo(tx as unknown as Db, w.m2.id, "leaves", {
					leavingWith: [w.m2.id]
				})
			)
			expect(undone.changed).toBe(true)
			const s = await w.snapshot()
			expect(s.entries.some((e) => e.id === room.id)).toBe(false)
			expect(s.entries.some((e) => e.id === newDay.id)).toBe(false)
			expect(s.links.some((l) => l.id === link.id)).toBe(false)
			expect(s.links.map((l) => l.id)).toEqual(
				w.afterOne.links.map((l) => l.id)
			)
			// Today: turn 2's imprint of the day's text reverts it for the notes, and the
			// press's unimprinted paragraph goes with it.
			expect(s.entries.find((e) => e.id === w.dayOne.id)!.content).toBe(
				"A."
			)
		})

		it("a swipe of a message that came after the press leaves the press's rows standing", async () => {
			const { w, room, newDay, link } = await pressed(kind)
			const m3 = await (async () => {
				const [legacy] = await db
					.insert(schema.sessionMessages)
					.values({
						sessionId: w.session.id,
						role: "assistant",
						content: "…"
					})
					.returning()
				await db.insert(schema.messages).values({
					id: legacy!.id,
					sessionId: w.session.id,
					role: "assistant"
				})
				return legacy!
			})()
			const { retractStateAnchoredTo } = await import("./write")
			const taken = await retractStateAnchoredTo(
				asDb(),
				m3.id,
				"replaced"
			)
			expect(taken.changed).toBe(false)
			const s = await w.snapshot()
			expect(s.entries.some((e) => e.id === room.id)).toBe(true)
			expect(s.entries.some((e) => e.id === newDay.id)).toBe(true)
			expect(s.links.some((l) => l.id === link.id)).toBe(true)
		})
	}
)
