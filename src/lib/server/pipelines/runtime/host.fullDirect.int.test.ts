/**
 * Under Full on a lorebook the session's owner owns, everything a session's
 * pipelines write goes straight into the lorebook: a new entry, place, history
 * day or link, and a change to an entry the lorebook already holds (written in
 * place and imprinted, so a swipe, a regenerate, Back or a delete takes it back
 * and Forward puts it back) — for a session whose scenes end by themselves as
 * for one whose scenes do not; a dated session's change is written as a dated
 * version at its day. A change waits in the session's notes (a held
 * amendment) when the session already holds a change on that entry, stands
 * on a branch (or a line still to be forked) the entry is not on; and
 * always under Review changes and Off, and on a lorebook someone else owns.
 * Driven through the real outlets; the scenes predicate is switched per session
 * (the real one is tested in `host.scenesEndRoute.int.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const scenesEnd = vi.hoisted(() => new Set<number>())
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	scenesEndByThemselves: async (_db: unknown, sessionId: number) => scenesEnd.has(sessionId)
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const CREATE = { key: "file", definitionId: "core:outlet/create-lore-entry" } as any
const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
const LINK = { key: "tie", definitionId: "core:outlet/link-lore-entries" } as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-full-direct-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Mode = "full" | "review" | "off"

/**
 * A user, a lorebook of theirs, and a session on it. `ends`: its scenes end by
 * themselves. `fork`: the session stands on a fork of the lorebook. `pending`:
 * its line is still to be forked. `clock`: a dated session.
 */
async function world(
	opts: {
		ends?: boolean
		mode?: Mode
		fork?: boolean
		pending?: boolean
		clock?: { year: number; month: number; day: number }
	} = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `full-direct-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [fork] = opts.fork
		? await db.insert(schema.lorebookBranches).values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 }).returning()
		: []
	const session = await sessionOn(user.id, book!.id, {
		ends: opts.ends,
		branchId: fork?.id,
		pending: opts.pending,
		clock: opts.clock
	})
	return { user, book: book!, fork, session, suffix }
}
type World = Awaited<ReturnType<typeof world>>

async function sessionOn(
	userId: number,
	lorebookId: number | null,
	opts: {
		ends?: boolean
		branchId?: number
		pending?: boolean
		clock?: { year: number; month: number; day: number }
	} = {}
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			...(lorebookId != null ? { lorebookId } : {}),
			...(opts.branchId ? { lorebookBranchId: opts.branchId } : {}),
			...(opts.pending ? { lineOnFirstWrite: true } : {}),
			...(opts.clock
				? { storyClockYear: opts.clock.year, storyClockMonth: opts.clock.month, storyClockDay: opts.clock.day }
				: {})
		})
		.returning()
	if (opts.ends) scenesEnd.add(session!.id)
	return session!
}

const messageIn = async (sessionId: number) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "…" })
		.returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

const hostFor = async (sessionId: number, userId: number, runId: string, scope: Record<string, unknown> = {}) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as unknown as Db, { sessionId, userId, runId, ...scope } as any)
}
const hostOf = (w: World, runId = `run-${w.suffix}`, scope: Record<string, unknown> = {}) =>
	hostFor(w.session.id, w.user.id, runId, scope)

const ownBookOf = async (sessionId: number) => {
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return ownBookFor(db as unknown as Db, sessionId)
}

async function place(lorebookId: number, title: string, content = `${title}, as written.`, extra: Record<string, unknown> = {}) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content,
			fields: { category: "Rooms" },
			...extra
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!
const entriesIn = (lorebookId: number) =>
	db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, lorebookId)).orderBy(schema.lorebookEntries.id)
const linksIn = (lorebookId: number) =>
	db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
const heldRows = (ownBookId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(and(eq(schema.entryAmendments.lorebookId, ownBookId), isNotNull(schema.entryAmendments.base)))
		.orderBy(schema.entryAmendments.id)
const imprintsOf = (entryId: number) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(and(eq(schema.loreImprints.subjectKind, "entry"), eq(schema.loreImprints.subjectId, entryId)))
const sessionRow = async (id: number) =>
	(await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)))[0]!
const namesRead = async (sessionId: number) =>
	(await (await import("$lib/server/lorebooks/ownBook")).sessionEntriesAsRead(db as unknown as Db, sessionId, "session", null)).map(
		(e) => e.name
	)

const roomIn = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	content: "A room.",
	params: { entryType: LOCATION_TYPE_ID },
	...extra
})

describe("a session's new rows go to the lorebook", () => {
	it.each([true, false])(
		"a new entry, place, history day and link land in the lorebook and nothing in the notes (scenes end by themselves: %s)",
		async (ends) => {
			const w = await world({ ends })
			await messageIn(w.session.id)
			const h = await hostOf(w)
			const cellar: any = await h.commit!(roomIn("The Cellar"), CREATE)
			const hall: any = await h.commit!(roomIn("The Hall"), CREATE)
			const day: any = await h.commit!(
				{ content: "Down we went.", params: { entryType: HISTORY_TYPE_ID }, fields: { year: 3, month: 2, day: 9 } },
				CREATE
			)
			const link: any = await h.commit!({ from: cellar.id, to: hall.id }, LINK)
			const lore = await ownBookOf(w.session.id)
			for (const out of [cellar, hall, day]) expect(out).toMatchObject({ route: "book", lorebookId: w.book.id })
			expect(link.lorebookId).toBe(w.book.id)
			expect((await entriesIn(w.book.id)).map((r) => r.id).sort()).toEqual([cellar.id, hall.id, day.id].sort())
			expect(await entriesIn(lore.id)).toHaveLength(0)
			expect(await linksIn(w.book.id)).toHaveLength(1)
			expect(await linksIn(lore.id)).toHaveLength(0)
		}
	)
})

describe("a change to an entry the lorebook holds is written in place", () => {
	it.each([true, false])(
		"a shown entry is rewritten in place, its name kept, with imprints; update-lore-entry likewise (scenes end by themselves: %s)",
		async (ends) => {
			const w = await world({ ends })
			const mira = await place(w.book.id, "Mira", "A baker.")
			const vault = await place(w.book.id, "The Vault")
			await messageIn(w.session.id)
			const h = await hostOf(w)
			const out: any = await h.commit!(
				{ ...roomIn("Mira the baker"), content: "A baker, now a widow.", match: { name: "Mira" }, shown: [mira.id] },
				CREATE
			)
			expect(out).toMatchObject({ entryId: mira.id, matched: true, written: false, route: "book", lorebookId: w.book.id })
			expect(await stored(mira.id)).toMatchObject({ title: "Mira", content: "A baker, now a widow." })
			expect((await imprintsOf(mira.id)).map((i) => i.field)).toContain("content")

			const upd: any = await h.commit!(
				{ entry: vault.id, name: "The Strongroom", content: "Sealed.", fields: { category: "Vaults" } },
				UPDATE
			)
			expect(upd).toMatchObject({ entryId: vault.id, route: "book", lorebookId: w.book.id })
			expect(await stored(vault.id)).toMatchObject({ title: "The Strongroom", content: "Sealed." })
			expect(((await stored(vault.id)).fields as any).category).toBe("Vaults")
			expect((await imprintsOf(vault.id)).map((i) => i.field)).toEqual(
				expect.arrayContaining([null, "content", "fields.category"].filter((f) => f !== null))
			)
			const lore = await ownBookOf(w.session.id)
			expect(await heldRows(lore.id)).toEqual([])
		}
	)

	it("a swipe, a regenerate, Back and a delete take the turn's rows and changes back, and Forward puts them back", async () => {
		const w = await world()
		const mira = await place(w.book.id, "Mira", "A baker.")
		const m = await messageIn(w.session.id)
		const h = await hostOf(w)
		const room: any = await h.commit!(roomIn("The Cellar"), CREATE)
		await h.commit!({ entry: mira.id, content: "A widow." }, UPDATE)
		const { retractStateAnchoredTo, restoreRetractedState, reviveRetractedState } = await import("$lib/server/state/write")
		const idsMade = async () => (await entriesIn(w.book.id)).map((r) => r.id).filter((id) => id !== mira.id)

		// A swipe and a regenerate are one retraction ("replaced"); a failed re-tell puts the rows back.
		const swiped = await retractStateAnchoredTo(db as unknown as Db, m.id, "replaced")
		expect(swiped.changed).toBe(true)
		expect((await stored(mira.id)).content).toBe("A baker.")
		expect(await idsMade()).toEqual([])
		expect(await restoreRetractedState(db as unknown as Db, swiped.taken)).toBe(true)
		expect((await stored(mira.id)).content).toBe("A widow.")
		expect(await idsMade()).toEqual([room.id])

		// Back and a delete are one retraction ("leaves"); Forward (the record read back from JSON) returns them.
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, m.id, "leaves", { leavingWith: [m.id] })
		)
		expect(undone.changed).toBe(true)
		expect((await stored(mira.id)).content).toBe("A baker.")
		expect(await idsMade()).toEqual([])
		const record = reviveRetractedState(JSON.parse(JSON.stringify(undone.taken)), w.session.id)!
		expect(await restoreRetractedState(db as unknown as Db, record)).toBe(true)
		expect((await stored(mira.id)).content).toBe("A widow.")
		expect(await idsMade()).toEqual([room.id])
	})

	it("after a hand edit of the field the take-back leaves it, and the entry is marked replaced (a kept imprint)", async () => {
		const w = await world()
		const mira = await place(w.book.id, "Mira", "A baker.")
		const m = await messageIn(w.session.id)
		await (await hostOf(w)).commit!({ entry: mira.id, content: "A widow." }, UPDATE)
		await db.update(schema.lorebookEntries).set({ content: "By hand." }).where(eq(schema.lorebookEntries.id, mira.id))
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(db as unknown as Db, m.id, "replaced")
		expect((await stored(mira.id)).content).toBe("By hand.")
		const imprints = await imprintsOf(mira.id)
		expect(imprints.find((i) => i.field === "content")!.status).toBe("kept")
	})
})

describe("Forward never merges", () => {
	it("a history day written another way while Back had taken the turn's: Forward brings both back with their own text, and Loose ends lists the date", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const h = await hostOf(w)
		const date = { year: 3, month: 2, day: 9 }
		const day: any = await h.commit!(
			{ content: "Down we went.", params: { entryType: HISTORY_TYPE_ID }, fields: date },
			CREATE
		)
		expect(day).toMatchObject({ route: "book", lorebookId: w.book.id })
		const { historyEntryDate } = await import("$lib/server/state/reading")
		const dateBeforeBack = historyEntryDate((await entriesIn(w.book.id)).find((r) => r.id === day.id)!.fields)
		expect(dateBeforeBack).toEqual(date)
		const { retractStateAnchoredTo, restoreRetractedState, reviveRetractedState } = await import("$lib/server/state/write")
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, m.id, "leaves", { leavingWith: [m.id] })
		)
		expect(undone.changed).toBe(true)
		expect(await entriesIn(w.book.id)).toEqual([])
		const [byHand] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "By hand",
				content: "Written by hand.",
				fields: date
			})
			.returning()
		const record = reviveRetractedState(JSON.parse(JSON.stringify(undone.taken)), w.session.id)!
		await restoreRetractedState(db as unknown as Db, record)
		const rows = await entriesIn(w.book.id)
		expect(rows.map((r) => r.id).sort()).toEqual([day.id, byHand!.id].sort())
		expect(rows.find((r) => r.id === day.id)!.content).toContain("Down we went.")
		expect(rows.find((r) => r.id === byHand!.id)!.content).toBe("Written by hand.")

		expect(historyEntryDate(rows.find((r) => r.id === day.id)!.fields)).toEqual(dateBeforeBack)
		const { looseEnds } = await import("$lib/client/lorebooks/looseEnds")
		const found = looseEnds({
			items: rows.map((r) => ({
				key: `entry#${r.id}`,
				id: r.id,
				kind: HISTORY_TYPE_ID,
				name: r.title ?? "",
				content: r.content ?? "",
				keys: ["word"],
				pinned: false,
				off: false,
				archived: false,
				machineWritten: false,
				parentKey: null,
				order: r.id,
				position: r.position,
				priority: 1,
				createdAt: 0,
				updatedAt: r.id,
				date: historyEntryDate(r.fields)
			}))
		}).filter((r) => r.chore === "doubled-history-date")
		expect(found).toHaveLength(1)
		expect(found[0]!.alsoEntryIds).toHaveLength(1)
	})
})

describe("what a session whose scenes end by themselves settles", () => {
	it("Back is not refused after a sources write for it, and is for a session whose scenes do not end by themselves", async () => {
		const { assertRetractable } = await import("$lib/server/sessions/settle")
		const ends = await world({ ends: true })
		const m1 = await messageIn(ends.session.id)
		const out: any = await (await hostOf(ends, "run-s1", { readMessageIds: new Set([m1.id]) })).commit!(
			roomIn("The Cellar", { sources: [{ id: m1.id }] }),
			CREATE
		)
		expect(out.route).toBe("book")
		expect((await sessionRow(ends.session.id)).settledMessageId).toBeNull()
		await expect(assertRetractable(db as unknown as Db, m1.id)).resolves.toBeUndefined()

		const chat = await world({ ends: false })
		const m2 = await messageIn(chat.session.id)
		await (await hostOf(chat, "run-s2", { readMessageIds: new Set([m2.id]) })).commit!(
			roomIn("The Cellar", { sources: [{ id: m2.id }] }),
			CREATE
		)
		expect((await sessionRow(chat.session.id)).settledMessageId).toBe(m2.id)
		await expect(assertRetractable(db as unknown as Db, m2.id)).rejects.toThrow()
	})
})

describe("a change that waits", () => {
	it("a branch session's change to an entry on its original's line waits in the branch's notes; the lorebook is unchanged", async () => {
		const w = await world({ fork: true })
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		const out: any = await (await hostOf(w)).commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out).toMatchObject({ entryId: vault.id, route: "own-book", lorebookId: w.book.id })
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
		const held = await heldRows((await ownBookOf(w.session.id)).id)
		expect(held).toHaveLength(1)
		expect(held[0]).toMatchObject({ entryId: vault.id, fields: { content: "Sealed." } })
		expect(await imprintsOf(vault.id)).toEqual([])
	})

	it("a session whose line is still to be forked: a match without links waits, never refused, and forks nothing", async () => {
		const w = await world({ pending: true })
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		const h = await hostOf(w)
		const out: any = await h.commit!(
			{ ...roomIn("The Vault"), content: "Sealed.", match: { name: "The Vault" }, shown: [vault.id] },
			CREATE
		)
		expect(out).toMatchObject({ entryId: vault.id, matched: true, route: "own-book", lorebookId: w.book.id })
		const upd: any = await h.commit!({ entry: vault.id, fields: { category: "Vaults" } }, UPDATE)
		expect(upd).toMatchObject({ entryId: vault.id, route: "own-book", lorebookId: w.book.id })
		expect(await stored(vault.id)).toMatchObject({ content: "The Vault, as written." })
		expect(await heldRows((await ownBookOf(w.session.id)).id)).toHaveLength(2)
		expect(await sessionRow(w.session.id)).toMatchObject({ lineOnFirstWrite: true, lorebookBranchId: null })
	})

	it("a session whose line is still to be forked: a match that names links forks the line, puts the link on it, holds the matched entry's change, never refused", async () => {
		const w = await world({ pending: true })
		const vault = await place(w.book.id, "The Vault")
		const hall = await place(w.book.id, "The Hall")
		await messageIn(w.session.id)
		const h = await hostOf(w)
		const out: any = await h.commit!(
			{
				...roomIn("The Vault"),
				content: "Sealed.",
				match: { name: "The Vault" },
				shown: [vault.id],
				links: [{ to: hall.id }]
			},
			CREATE
		)
		expect(out).toMatchObject({ entryId: vault.id, matched: true })
		const session = await sessionRow(w.session.id)
		expect(session.lineOnFirstWrite).toBe(false)
		expect(session.lorebookBranchId).not.toBeNull()
		const links = await linksIn(w.book.id)
		expect(links).toHaveLength(1)
		expect(links[0]).toMatchObject({ branchId: session.lorebookBranchId })
		expect(await stored(vault.id)).toMatchObject({ content: "The Vault, as written." })
		const held = await heldRows((await ownBookOf(w.session.id)).id)
		expect(held).toHaveLength(1)
		expect(held[0]).toMatchObject({ entryId: vault.id })
	})

	it("a dated session's change to an existing entry is written to the lorebook as a dated version at its day, not held; its new entry goes to the lorebook", async () => {
		const w = await world({ clock: { year: 3, month: 2, day: 5 } })
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		const h = await hostOf(w)
		const out: any = await h.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out).toMatchObject({ entryId: vault.id, route: "book", lorebookId: w.book.id })
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
		expect(await heldRows((await ownBookOf(w.session.id)).id)).toEqual([])
		const [version] = await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, w.book.id))
		expect(version).toMatchObject({ entryId: vault.id, base: null, year: 3, month: 2, day: 5, fields: { content: "Sealed." } })
		const made: any = await h.commit!(roomIn("The Cellar"), CREATE)
		expect(made).toMatchObject({ route: "book", lorebookId: w.book.id })
	})
})

describe("rows that already wait in the notes", () => {
	/** A waiting new entry and a waiting change on another entry, made as the earlier rule made them. */
	async function waiting(w: World) {
		const own = await ownBookOf(w.session.id)
		const m = await messageIn(w.session.id)
		const waitingRoom = await place(own.id, "Waiting Room", "Waits.", { sourceMessageId: m.id })
		const vault = await place(w.book.id, "The Vault")
		await db.insert(schema.entryAmendments).values({
			lorebookId: own.id,
			entryId: vault.id,
			branchId: null,
			year: null,
			month: null,
			day: null,
			fields: { content: "Waiting words." },
			base: { content: { v: "The Vault, as written." } },
			sourceMessageId: m.id
		})
		return { own, waitingRoom, vault }
	}

	it("create-lore-entry that matches a waiting entry's name changes that notes row: no second entry, nothing in the lorebook", async () => {
		const w = await world()
		const { own, waitingRoom } = await waiting(w)
		const h = await hostOf(w)
		const before = (await entriesIn(w.book.id)).length
		const shown: any = await h.commit!(
			{ ...roomIn("Waiting Room"), content: "Waits, rewritten.", match: { name: "Waiting Room" }, shown: [waitingRoom.id] },
			CREATE
		)
		expect(shown).toMatchObject({ entryId: waitingRoom.id, matched: true, route: "own-book", lorebookId: own.id })
		expect((await stored(waitingRoom.id)).content).toBe("Waits, rewritten.")
		const plain: any = await h.commit!(
			{ ...roomIn("Waiting Room"), content: "Waits, again.", match: { name: "Waiting Room" } },
			CREATE
		)
		expect(plain).toMatchObject({ entryId: waitingRoom.id, matched: true, route: "own-book", lorebookId: own.id })
		expect((await stored(waitingRoom.id)).content).toBe("Waits, again.")
		expect((await entriesIn(own.id)).map((r) => r.id)).toEqual([waitingRoom.id])
		expect((await entriesIn(w.book.id)).length).toBe(before)
		expect((await imprintsOf(waitingRoom.id)).length).toBeGreaterThan(0)
	})

	it("a second change to an entry the session already holds a change on is a second held row, applied in order at the next scene close; the lorebook is unchanged", async () => {
		const w = await world()
		const { own, vault } = await waiting(w)
		const h = await hostOf(w)
		const viaUpdate: any = await h.commit!({ entry: vault.id, content: "More waiting words." }, UPDATE)
		expect(viaUpdate).toMatchObject({ entryId: vault.id, route: "own-book", lorebookId: w.book.id })
		const viaMatch: any = await h.commit!(
			{ ...roomIn("The Vault"), content: "Even more.", match: { name: "The Vault" }, shown: [vault.id] },
			CREATE
		)
		expect(viaMatch).toMatchObject({ entryId: vault.id, matched: true, route: "own-book", lorebookId: w.book.id })
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
		expect(await heldRows(own.id)).toHaveLength(3)
		expect(await imprintsOf(vault.id)).toEqual([])
	})

	it("update-lore-entry naming the waiting notes row changes it", async () => {
		const w = await world()
		const { own, waitingRoom } = await waiting(w)
		const out: any = await (await hostOf(w)).commit!({ entry: "Waiting Room", content: "Changed." }, UPDATE)
		expect(out).toMatchObject({ entryId: waitingRoom.id, route: "own-book", lorebookId: own.id })
		expect((await stored(waitingRoom.id)).content).toBe("Changed.")
		const byId: any = await (await hostOf(w, "run-by-id")).commit!({ entry: waitingRoom.id, content: "Changed again." }, UPDATE)
		expect(byId).toMatchObject({ entryId: waitingRoom.id, route: "own-book", lorebookId: own.id })
		expect((await stored(waitingRoom.id)).content).toBe("Changed again.")
	})
})

describe("a second session on the same lorebook", () => {
	it("reads the write at once", async () => {
		const w = await world({ ends: true })
		const other = await sessionOn(w.user.id, w.book.id)
		const mira = await place(w.book.id, "Mira", "A baker.")
		await messageIn(w.session.id)
		const h = await hostOf(w)
		await h.commit!(roomIn("The Cellar"), CREATE)
		await h.commit!({ entry: mira.id, name: "Mira the baker" }, UPDATE)
		const names = await namesRead(other.id)
		expect(names).toEqual(expect.arrayContaining(["The Cellar", "Mira the baker"]))
		expect(names).not.toContain("Mira")
	})
})

describe("what stays in the notes", () => {
	it("a member's session on someone else's lorebook writes in its notes and holds its change", async () => {
		const owner = await world()
		const vault = await place(owner.book.id, "The Vault")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = await createTestUser(db, `full-direct-member-${++n}`)
		await db.insert(schema.userSettings).values({ userId: member.id, loreWriteMode: "full" })
		const session = await sessionOn(member.id, owner.book.id, { ends: true })
		await messageIn(session.id)
		const h = await hostFor(session.id, member.id, `run-member-${n}`)
		const own = await ownBookOf(session.id)
		const room: any = await h.commit!(roomIn("The Cellar"), CREATE)
		expect(room).toMatchObject({ route: "own-book", lorebookId: own.id })
		const out: any = await h.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out).toMatchObject({ entryId: vault.id, route: "own-book", lorebookId: owner.book.id })
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
		expect(await entriesIn(owner.book.id)).toHaveLength(1)
		expect(await heldRows(own.id)).toHaveLength(1)
	})

	it("a session whose notes are its whole lorebook writes and changes them as before", async () => {
		const w = await world()
		const session = await sessionOn(w.user.id, null)
		const own = await ownBookOf(session.id)
		await messageIn(session.id)
		const h = await hostFor(session.id, w.user.id, `run-notes-${n}`)
		const room: any = await h.commit!(roomIn("The Cellar"), CREATE)
		expect(room).toMatchObject({ lorebookId: own.id })
		const out: any = await h.commit!({ entry: room.id, content: "Damp." }, UPDATE)
		expect(out).toMatchObject({ entryId: room.id, lorebookId: own.id })
		expect((await stored(room.id)).content).toBe("Damp.")
		expect((await imprintsOf(room.id)).length).toBeGreaterThan(0)
		expect(await heldRows(own.id)).toEqual([])
	})

	it.each<Mode>(["review", "off"])("under %s, new rows land in the notes and a change to a lorebook entry waits", async (mode) => {
		const w = await world({ mode, ends: true })
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		const own = await ownBookOf(w.session.id)
		const h = await hostOf(w)
		const room: any = await h.commit!(roomIn("The Cellar"), CREATE)
		expect(room).toMatchObject({ route: "own-book", lorebookId: own.id })
		const out: any = await h.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out).toMatchObject({ entryId: vault.id, route: "own-book", lorebookId: w.book.id })
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
		expect(await heldRows(own.id)).toHaveLength(1)
		expect(await entriesIn(w.book.id)).toHaveLength(1)
	})
})
