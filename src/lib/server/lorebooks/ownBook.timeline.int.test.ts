/**
 * 🚧 A session's notes copy their lorebook's **Timeline** switch when they are
 * made (`insertOwnBook`) and when a branch copies its parent's notes
 * (`copyOwnBookToBranch`); with no lorebook the notes take the column default.
 * Apply into a book with no timeline: a dated held change and a notes' history
 * day wait with a reason; undated work moves as before.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-ownBookTimeline-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const RULES = "core:ruleset/freeform@1"
let n = 0

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `own-timeline-${++n}`)
}

async function lorebook(userId: number, timelineEnabled: boolean) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}`, timelineEnabled })
		.returning()
	return row!
}

async function session(userId: number, lorebookId: number | null = null) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `Run ${++n}`, lorebookId })
		.returning()
	return row!
}

const notesOf = (sessionId: number, userId: number, overlayOf: number | null) =>
	import("./ownBook").then(({ insertOwnBook }) =>
		insertOwnBook(db(), {
			sessionId,
			userId,
			name: null,
			overlayOf,
			primaryRuleset: RULES,
			rulesetVersion: null
		})
	)

describe("notes copy the switch", () => {
	test("made over an off book they are off, over an on book on, over none the default (on)", async () => {
		const me = await person()
		const off = await lorebook(me.id, false)
		const on = await lorebook(me.id, true)
		expect((await notesOf((await session(me.id, off.id)).id, me.id, off.id)).timelineEnabled).toBe(false)
		expect((await notesOf((await session(me.id, on.id)).id, me.id, on.id)).timelineEnabled).toBe(true)
		expect((await notesOf((await session(me.id)).id, me.id, null)).timelineEnabled).toBe(true)
	})

	test("a branch's notes copy an off parent's value", async () => {
		const me = await person()
		const parent = await session(me.id)
		const parentNotes = await notesOf(parent.id, me.id, null)
		await testDb
			.update(schema.lorebooks)
			.set({ timelineEnabled: false })
			.where(eq(schema.lorebooks.id, parentNotes.id))
		const child = await session(me.id)
		const { copyOwnBookToBranch } = await import("./ownBook")
		const out = await testDb.transaction((tx) =>
			copyOwnBookToBranch(tx as unknown as Db, {
				sessionId: parent.id,
				created: {
					id: child.id,
					name: child.name,
					userId: me.id,
					lorebookId: null,
					primaryRuleset: RULES,
					rulesetVersion: null
				},
				forkMessageId: 0,
				remap: new Map()
			})
		)
		const [made] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, out.lorebookId))
		expect(made!.timelineEnabled).toBe(false)
	})
})

describe("Apply into a book with no timeline", () => {
	async function world(timelineEnabled: boolean) {
		const me = await person()
		const book = await lorebook(me.id, timelineEnabled)
		const [vault] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Vault",
				content: "Locked.",
				fields: { category: "Rooms" }
			})
			.returning()
		const s = await session(me.id, book.id)
		const notes = await notesOf(s.id, me.id, book.id)
		const [msg] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: s.id, role: "assistant", content: "…" })
			.returning()
		await testDb.insert(schema.messages).values({ id: msg!.id, sessionId: s.id, role: "assistant" })
		const held = async (year: number | null, category: string) =>
			(
				await testDb
					.insert(schema.entryAmendments)
					.values({
						lorebookId: notes.id,
						entryId: vault!.id,
						year,
						fields: { category },
						base: { category: { v: "Rooms" } },
						sourceMessageId: msg!.id
					})
					.returning()
			)[0]!
		return { me, book, vault: vault!, session: s, notes, msg: msg!, held }
	}

	const apply = (w: Awaited<ReturnType<typeof world>>) =>
		import("./ownBook").then(({ applyOverlayItems }) =>
			applyOverlayItems(db(), { sessionId: w.session.id, userId: w.me.id })
		)

	test("off: a dated held change waits with the reason in the list and in Apply; nothing is applied or dropped", async () => {
		const { overlayItemsOf } = await import("./ownBook")
		const w = await world(false)
		const dated = await w.held(2, "Cellars")
		const items = await overlayItemsOf(db(), w.session.id)
		const item = items.find((i) => i.kind === "entry-change" && i.amendmentId === dated.id)
		expect(item).toMatchObject({ conflict: TIMELINE_OFF_SENTENCES.dated })
		const done = await apply(w)
		expect(done.appliedChanges).toEqual([])
		expect(done.dropped).toEqual([])
		expect(done.stillHeld).toEqual([{ amendmentId: dated.id, reason: TIMELINE_OFF_SENTENCES.dated }])
		const [still] = await testDb.select().from(schema.entryAmendments).where(eq(schema.entryAmendments.id, dated.id))
		expect(still).toBeTruthy()
	})

	test("off: an undated held change is applied as before", async () => {
		const w = await world(false)
		const undated = await w.held(null, "Cellars")
		const done = await apply(w)
		expect(done.appliedChanges).toEqual([undated.id])
		const [vault] = await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, w.vault.id))
		expect((vault!.fields as any).category).toBe("Cellars")
	})

	test("on: the dated held change has no reason and is applied", async () => {
		const { overlayItemsOf } = await import("./ownBook")
		const w = await world(true)
		const dated = await w.held(2, "Cellars")
		const items = await overlayItemsOf(db(), w.session.id)
		expect(items.find((i) => i.kind === "entry-change" && i.amendmentId === dated.id)).toMatchObject({ conflict: null })
		const done = await apply(w)
		expect(done.appliedChanges).toEqual([dated.id])
		expect(done.stillHeld).toEqual([])
	})

	async function notesDay(w: Awaited<ReturnType<typeof world>>, fields: Record<string, unknown>) {
		const [day] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.notes.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: null,
				content: "The bell rang.",
				fields,
				sourceMessageId: w.msg.id
			})
			.returning()
		const [place] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.notes.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "Bell Tower",
				content: "Tall.",
				fields: { category: "Rooms" },
				sourceMessageId: w.msg.id
			})
			.returning()
		return { day: day!, place: place! }
	}

	test("off: a notes' history day, dated or not, waits in the reply; other entries move", async () => {
		const w = await world(false)
		const dated = await notesDay(w, { year: 4 })
		const undatedDay = (await notesDay(w, {})).day
		const done = await apply(w)
		expect(done.mergedDays).toEqual([])
		expect(done.heldDays).toEqual(
			expect.arrayContaining([
				{ notesEntryId: dated.day.id, reason: TIMELINE_OFF_SENTENCES.history },
				{ notesEntryId: undatedDay.id, reason: TIMELINE_OFF_SENTENCES.history }
			])
		)
		expect(done.heldDays).toHaveLength(2)
		expect(done.applied).toContain(dated.place.id)
		const inNotes = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.notes.id))
		expect(inNotes.map((r) => r.id)).toEqual(expect.arrayContaining([dated.day.id, undatedDay.id]))
		const moved = await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, dated.place.id))
		expect(moved[0]!.lorebookId).toBe(w.book.id)
	})

	test("on: the same history day moves into the lorebook", async () => {
		const w = await world(true)
		const dated = await notesDay(w, { year: 4 })
		const done = await apply(w)
		expect(done.heldDays).toEqual([])
		expect(done.applied).toEqual(expect.arrayContaining([dated.day.id, dated.place.id]))
	})
})
