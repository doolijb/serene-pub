/**
 * Deleting a line that other lines forked from (plan A17).
 *
 * The line's own rows go with it; every line forked from it keeps reading
 * what it read before — through the deleted line's parent, cut at the same
 * date — and every session reading such a line is told its reading moved.
 * The pure rule is `forkPastDeleted` (`lineReading.test.ts`); this is the
 * handler, the server's SQL reads and the announcements.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import type { TestDb } from "$lib/server/utils/testDb"

const heard = vi.hoisted(() => ({
	broadcasts: [] as { sessionId: number; event: string }[],
	settings: [] as { sessionId: number; changed: unknown }[],
	rows: [] as number[]
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("./utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./utils/broadcastHelpers")>()),
	broadcastToSessionUsers: vi.fn(
		async (_io: unknown, sessionId: number, event: string) => {
			heard.broadcasts.push({ sessionId, event })
		}
	)
}))

vi.mock("$lib/server/sessions/rowPush", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/sessions/rowPush")>()),
	broadcastSessionRow: vi.fn((_io: unknown, sessionId: number) => {
		heard.rows.push(sessionId)
	})
}))

vi.mock(
	"$lib/server/pipelines/runtime/sessionEvents",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("$lib/server/pipelines/runtime/sessionEvents")
		>()),
		emitSessionEvent: vi.fn(
			async (
				_db: unknown,
				e: { sessionId: number; payload: { changed: unknown } }
			) => {
				heard.settings.push({
					sessionId: e.sessionId,
					changed: e.payload.changed
				})
			}
		)
	})
)

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-delete-branch-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	heard.broadcasts.length = 0
	heard.settings.length = 0
	heard.rows.length = 0
})

const fakeIo = { tag: "io" }
/** A year-only story date, as a reading's moment carries one. */
const at = (year: number): StoryDate => ({ year, month: null, day: null })
const asUser = (userId: number) => ({ user: { id: userId }, io: fakeIo }) as any
const noopEmit = () => {}

async function book(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `delete-branch-${tag}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Ashfall", userId: user.id })
		.returning()
	const m = await import("./amendments")

	/** Fork a line and answer its id. */
	async function fork(
		name: string,
		from: number | null,
		forkYear: number | null = null
	) {
		const res = await m.amendmentsForkHandler.handler(
			asUser(user.id),
			{
				lorebookId: lorebook.id,
				name,
				forkedFromBranchId: from,
				forkYear
			},
			noopEmit
		)
		return res.branches.find((b) => b.name === name)!.id
	}

	async function entry(title: string, branchId: number | null = null) {
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: lorebook.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				title,
				content: title,
				keys: [title.toLowerCase()],
				position: Math.floor(Math.random() * 1_000_000),
				branchId
			} as any)
			.returning()
		return row
	}

	async function amend(
		entryId: number,
		branchId: number | null,
		year: number
	) {
		const res = await m.amendmentsCreateHandler.handler(
			asUser(user.id),
			{
				lorebookId: lorebook.id,
				entryId,
				branchId,
				year,
				fields: { content: `${branchId ?? "main"}@${year}` }
			},
			noopEmit
		)
		return res.entries.find(
			(a) =>
				a.entryId === entryId &&
				(a.branchId ?? null) === branchId &&
				a.year === year
		)!.id
	}

	let historyPosition = 0
	/** A history entry dated `year`, on `branchId`. */
	async function history(year: number, branchId: number | null = null) {
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: lorebook.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				title: `Year ${year}`,
				content: `What happened in Year ${year}`,
				keys: [],
				position: ++historyPosition,
				fields: { year },
				branchId
			} as any)
			.returning()
		return row
	}

	async function place(title: string) {
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: lorebook.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				title,
				content: title,
				keys: [title.toLowerCase()],
				position: Math.floor(Math.random() * 1_000_000)
			} as any)
			.returning()
		return row
	}

	const SLOT = "test:slot/light@1"
	/** A place's stat, recorded on `branchId` and dated by `historyEntryId`. */
	async function stat(
		placeId: number,
		value: string,
		branchId: number | null,
		historyEntryId: number
	) {
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "location",
			ownerId: placeId,
			slotId: SLOT,
			value: { v: value },
			branchId,
			historyEntryId
		} as any)
	}

	/** The place's stat as the line reads it at the moment. */
	async function statOn(
		placeId: number,
		branchId: number,
		moment: StoryDate | null
	) {
		const { readingOf } = await import("$lib/server/state/reading")
		const { valueOf } = await import("$lib/server/state/resolve")
		const value = await valueOf(testDb as any, {
			owner: { kind: "location", id: placeId } as any,
			slotId: SLOT,
			reading: await readingOf(testDb as any, lorebook.id, {
				branch: branchId,
				moment
			})
		})
		return value ?? null
	}

	/** The history entries a line reads at its head, as `{ title, content, year }`, in list order. */
	async function historyOn(branchId: number) {
		const { lineOfBook, historyEntryDate } = await import(
			"$lib/server/state/reading"
		)
		const { rowReadsOnLine } = await import(
			"$lib/shared/lorebooks/lineReading"
		)
		const line = await lineOfBook(testDb as any, lorebook.id, branchId)
		const rows = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebook.id),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
			.orderBy(schema.lorebookEntries.position)
		return rows
			.filter((r) =>
				rowReadsOnLine(r, line, historyEntryDate(r.fields), null)
			)
			.map((r) => ({
			title: r.title,
			content: r.content,
			year: (r.fields as any)?.year
		}))
	}

	async function sessionOn(branchId: number | null, name: string) {
		const [row] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				name,
				isGroup: false,
				lorebookId: lorebook.id,
				lorebookBranchId: branchId
			})
			.returning()
		return row.id
	}

	/** What the server reads on a line: its entries, and its amendments at the moment. */
	async function readsOn(branchId: number, moment: StoryDate | null) {
		const { lineOfBook } = await import("$lib/server/state/reading")
		const { onLineSql, onLineAtSql } = await import(
			"$lib/server/state/lineSql"
		)
		const line = await lineOfBook(testDb as any, lorebook.id, branchId)
		const entries = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebook.id),
					onLineSql(schema.lorebookEntries.branchId, line)
				)
			)
		const a = schema.entryAmendments
		const amendments = await testDb
			.select({ id: a.id })
			.from(a)
			.where(
				and(
					eq(a.lorebookId, lorebook.id),
					onLineAtSql(
						a.branchId,
						{ year: a.year, month: a.month, day: a.day },
						line,
						moment
					)
				)
			)
		return {
			entries: entries.map((r) => r.id).sort((x, y) => x - y),
			amendments: amendments.map((r) => r.id).sort((x, y) => x - y)
		}
	}

	async function deleteLine(
		id: number,
		emit: (event: string, data: any) => void = noopEmit
	) {
		return m.amendmentsDeleteBranchHandler.handler(
			asUser(user.id),
			{ lorebookId: lorebook.id, id },
			emit
		)
	}

	return {
		user,
		lorebook,
		fork,
		entry,
		amend,
		sessionOn,
		readsOn,
		deleteLine,
		history,
		place,
		stat,
		statOn,
		historyOn
	}
}

describe("deleting a line other lines forked from", () => {
	test("a fork of a fork keeps its past: the deleted line's parent, cut at the earlier date, grandparent chain and all", async () => {
		const b = await book("past")
		// main ─Y9─ A ─Y5─ B ┬─Y7─ C ── (now) G
		//                    └─now─ D
		const a = await b.fork("a", null, 9)
		const gone = await b.fork("b", a, 5)
		const c = await b.fork("c", gone, 7)
		const d = await b.fork("d", gone, null)
		const g = await b.fork("g", c, null)

		const base = await b.entry("Verity")
		const onA = await b.entry("On A", a)
		const onGone = await b.entry("On B", gone)
		await b.entry("On C", c)
		for (const year of [3, 6, 8]) await b.amend(base.id, null, year)
		for (const year of [4, 6]) await b.amend(base.id, a, year)
		const amendedOnGone = await b.amend(base.id, gone, 4)
		await b.amend(base.id, c, 6)

		const moments: (StoryDate | null)[] = [null, { year: 6 }, { year: 4 }]
		const before = new Map<string, Awaited<ReturnType<typeof b.readsOn>>>()
		for (const line of [c, d, g])
			for (const moment of moments) {
				const r = await b.readsOn(line, moment)
				// The deleted line's own rows go with it; everything else stays.
				before.set(`${line}@${JSON.stringify(moment)}`, {
					entries: r.entries.filter((id) => id !== onGone.id),
					amendments: r.amendments.filter(
						(id) => id !== amendedOnGone
					)
				})
			}
		// The chain was read through A before the delete.
		expect(before.get(`${c}@null`)!.entries).toContain(onA.id)

		const after = await b.deleteLine(gone)

		for (const line of [c, d, g])
			for (const moment of moments)
				expect(
					await b.readsOn(line, moment),
					`line ${line} at ${JSON.stringify(moment)}`
				).toEqual(before.get(`${line}@${JSON.stringify(moment)}`))

		const row = (id: number) => after.branches.find((x) => x.id === id)!
		expect(row(c)).toMatchObject({
			forkedFromBranchId: a,
			forkYear: 5,
			forkMonth: null,
			forkDay: null
		})
		expect(row(d)).toMatchObject({ forkedFromBranchId: a, forkYear: 5 })
		expect(row(g)).toMatchObject({ forkedFromBranchId: c, forkYear: null })
	}, 60_000)

	test("sessions on every line forked from it hear that their reading moved; other lines' do not", async () => {
		const b = await book("notify")
		const gone = await b.fork("b", null, 5)
		const c = await b.fork("c", gone, 7)
		const g = await b.fork("g", c, null)
		const sibling = await b.fork("sibling", null, 2)

		const onGone = await b.sessionOn(gone, "on the deleted line")
		const onChild = await b.sessionOn(c, "on its child")
		const onGrandchild = await b.sessionOn(g, "on its grandchild")
		const onSibling = await b.sessionOn(sibling, "on a sibling")
		const onMain = await b.sessionOn(null, "on main")

		await b.deleteLine(gone)

		const told = (event: string) =>
			heard.broadcasts
				.filter((x) => x.event === event)
				.map((x) => x.sessionId)
				.sort((x, y) => x - y)
		expect(told("state:changed")).toEqual(
			[onGone, onChild, onGrandchild].sort((x, y) => x - y)
		)
		expect(told("state:changed")).not.toContain(onSibling)
		expect(told("state:changed")).not.toContain(onMain)
		// Only the deleted line's session changed a setting (its line, to main).
		expect(heard.settings).toEqual([
			{ sessionId: onGone, changed: ["lorebookBranchId"] }
		])
		expect(heard.rows).toEqual([onGone])

		const [still] = await testDb
			.select({ lorebookBranchId: schema.sessions.lorebookBranchId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, onChild))
		expect(still.lorebookBranchId).toBe(c)
	}, 60_000)

	test("a stat a fork recorded, dated by the deleted line's history entry, keeps its date: the history entry stays, on the fork", async () => {
		const b = await book("dated-stat")
		// main has a Year 2 entry; B left main at Y5 and wrote Year 3; C left B
		// at now. A write on C at its head is dated by B's Year 3 entry — the
		// newest one C reads (plan A22).
		const onMain = await b.history(2)
		const gone = await b.fork("b", null, 5)
		const c = await b.fork("c", gone, null)
		const onGone = await b.history(3, gone)
		const crypt = await b.place("The Crypt")
		await b.stat(crypt.id, "dim", null, onMain.id)
		await b.stat(crypt.id, "lit", c, onGone.id)

		const moments = [null, at(1), at(2), at(3)]
		const before = await Promise.all(moments.map((m) => b.statOn(crypt.id, c, m)))
		expect(before).toEqual(["lit", null, "dim", "lit"])
		const historyBefore = await b.historyOn(c)

		const emitted: { event: string; data: any }[] = []
		await b.deleteLine(gone, (event, data) => emitted.push({ event, data }))

		expect(await Promise.all(moments.map((m) => b.statOn(crypt.id, c, m)))).toEqual(before)
		// Open views hear the history list again, the kept entry on its new line.
		const relisted = emitted.find((e) => e.event === "entries:list")
		const list = typeof relisted?.data === "function" ? await relisted.data() : relisted?.data
		expect(list?.typeId).toBe(HISTORY_TYPE_ID)
		expect(list.entryList.find((e: any) => e.id === onGone.id)?.branchId).toBe(c)
		// C reads the same history: the entry its stat hangs from is now C's own.
		expect(await b.historyOn(c)).toEqual(historyBefore)
		const [kept] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, onGone.id))
		expect(kept?.branchId).toBe(c)
	}, 60_000)

	test("a fork's link and scene on the deleted line's history entry stay as they were; an entry nothing on a fork uses goes", async () => {
		const b = await book("dated-link")
		const gone = await b.fork("b", null, 5)
		const c = await b.fork("c", gone, 7)
		const dating = await b.history(3, gone)
		const unused = await b.history(4, gone)
		const north = await b.entry("North")
		const south = await b.entry("South")
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: b.lorebook.id,
				fromEntryId: north.id,
				toEntryId: south.id,
				branchId: c,
				historyEntryId: dating.id,
				relationshipType: "road",
				title: "the old road"
			} as any)
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: b.lorebook.id,
				historyEntryId: dating.id,
				branchId: c,
				name: "C's own scene"
			} as any)
			.returning()

		const { readingOf, rowsOnReading } = await import(
			"$lib/server/state/reading"
		)
		const linksOn = async (year: number) => {
			const reading = await readingOf(testDb as any, b.lorebook.id, {
				branch: c,
				moment: at(year)
			})
			const rows = await testDb
				.select()
				.from(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.lorebookId, b.lorebook.id))
			return (await rowsOnReading(testDb as any, rows, reading)).map(
				(r) => r.id
			)
		}
		const before = [await linksOn(2), await linksOn(4)]
		expect(before).toEqual([[], [link.id]])
		const historyBefore = await b.historyOn(c)

		await b.deleteLine(gone)

		expect([await linksOn(2), await linksOn(4)]).toEqual(before)
		const [linkAfter] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link.id))
		expect(linkAfter.historyEntryId).toBe(dating.id)
		const scenes = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(scenes).toHaveLength(1)
		// The Year 4 entry dates nothing on C: it was the deleted line's, and goes.
		expect(await b.historyOn(c)).toEqual(
			historyBefore.filter((h) => h.year !== 4)
		)
		const gonePast = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, unused.id))
		expect(gonePast).toHaveLength(0)
	}, 60_000)

	test("two forks hanging rows on one history entry: the first keeps it, the other gets its own copy with its rows moved onto it", async () => {
		const b = await book("two-forks")
		const onMain = await b.history(2)
		const gone = await b.fork("b", null, 5)
		const first = await b.fork("first", gone, 7)
		const second = await b.fork("second", gone, null)
		const dating = await b.history(3, gone)
		await b.history(4, gone)
		const crypt = await b.place("The Crypt")
		const north = await b.entry("North")
		await b.stat(crypt.id, "dim", null, onMain.id)
		await b.stat(crypt.id, "lit", first, dating.id)
		await b.stat(crypt.id, "bright", second, dating.id)
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: b.lorebook.id,
				historyEntryId: dating.id,
				branchId: second,
				name: "second's scene"
			} as any)
			.returning()
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: b.lorebook.id,
				fromEntryId: north.id,
				toEntryId: dating.id,
				branchId: second,
				historyEntryId: dating.id,
				relationshipType: "remembers",
				title: ""
			} as any)
			.returning()
		const [amendment] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: b.lorebook.id,
				entryId: dating.id,
				branchId: second,
				year: 3,
				fields: { content: "as the second line tells it" }
			} as any)
			.returning()
		await testDb.insert(schema.lorebookEntryVectors).values({
			entryId: dating.id,
			vectorName: "default",
			chunkIndex: 0,
			model: "test-model",
			dims: 2,
			vector: [0.5, 0.5],
			sourceHash: "hash"
		} as any)

		const moments = [null, at(2), at(3)]
		const statsBefore = {
			first: await Promise.all(moments.map((m) => b.statOn(crypt.id, first, m))),
			second: await Promise.all(moments.map((m) => b.statOn(crypt.id, second, m)))
		}
		expect(statsBefore).toEqual({
			first: ["lit", "dim", "lit"],
			second: ["bright", "dim", "bright"]
		})
		const historyBefore = {
			first: await b.historyOn(first),
			second: await b.historyOn(second)
		}

		await b.deleteLine(gone)

		expect({
			first: await Promise.all(moments.map((m) => b.statOn(crypt.id, first, m))),
			second: await Promise.all(moments.map((m) => b.statOn(crypt.id, second, m)))
		}).toEqual(statsBefore)
		// Each reads the dating entry as before (the Year 4 one, used by
		// neither, goes with the deleted line).
		const without4 = (h: { year: number }[]) => h.filter((x) => x.year !== 4)
		expect(await b.historyOn(first)).toEqual(without4(historyBefore.first))
		expect(await b.historyOn(second)).toEqual(without4(historyBefore.second))

		const [original] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, dating.id))
		expect(original.branchId).toBe(first)
		const copies = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, b.lorebook.id),
					eq(schema.lorebookEntries.branchId, second),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
		expect(copies).toHaveLength(1)
		const copy = copies[0]
		expect(copy).toMatchObject({
			title: original.title,
			content: original.content,
			fields: original.fields,
			position: original.position + 1
		})
		// Everything the second line wrote about the entry now names its copy.
		const [sceneAfter] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(sceneAfter.historyEntryId).toBe(copy.id)
		const [linkAfter] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link.id))
		expect(linkAfter).toMatchObject({
			toEntryId: copy.id,
			historyEntryId: copy.id
		})
		const [amendmentAfter] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, amendment.id))
		expect(amendmentAfter.entryId).toBe(copy.id)
		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.ownerId, crypt.id))
		expect(
			values.map((v) => [v.branchId, v.historyEntryId]).sort()
		).toEqual(
			[
				[null, onMain.id],
				[first, dating.id],
				[second, copy.id]
			].sort()
		)
		// Its search vector comes with it: nothing is embedded twice.
		const vectors = await testDb
			.select()
			.from(schema.lorebookEntryVectors)
			.where(eq(schema.lorebookEntryVectors.entryId, copy.id))
		expect(vectors).toHaveLength(1)
	}, 60_000)

	test("a history entry a fork could not read is not handed to it", async () => {
		const b = await book("unread")
		const gone = await b.fork("b", null, null)
		// C left B at Year 2; B's Year 3 entry was never on C.
		const c = await b.fork("c", gone, 2)
		const later = await b.history(3, gone)
		const crypt = await b.place("The Crypt")
		await b.stat(crypt.id, "lit", c, later.id)
		const historyBefore = await b.historyOn(c)
		expect(historyBefore.map((h) => h.year)).not.toContain(3)

		await b.deleteLine(gone)

		expect(await b.historyOn(c)).toEqual(historyBefore)
	}, 60_000)
})

describe("deleting a line: its places' stats and its sessions", () => {
	const PLACE_KINDS = ["location", "session_location"]
	/** Every stat row a place holds, in the three tables, at both layers. */
	async function placeRows(placeId: number) {
		const count = async (
			table:
				| typeof schema.attributeValues
				| typeof schema.attributeConfigs
				| typeof schema.ownerSheets
		) =>
			(
				await testDb
					.select({ id: table.id, ownerKind: table.ownerKind })
					.from(table as any)
					.where(eq(table.ownerId, placeId))
			).filter((r) => PLACE_KINDS.includes(r.ownerKind)).length
		return {
			values: await count(schema.attributeValues),
			configs: await count(schema.attributeConfigs),
			sheets: await count(schema.ownerSheets)
		}
	}

	test("a place written on the line takes its stats with it, wherever they were recorded; a shared place keeps its own", async () => {
		const b = await book("place-stats")
		const gone = await b.fork("b", null, null)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: b.user.id,
				name: "on main",
				isGroup: false,
				lorebookId: b.lorebook.id
			})
			.returning()
		const sheetId = `test:sheet/delete-line-${b.lorebook.id}@1`
		await testDb
			.insert(schema.attributeSheets)
			.values({ id: sheetId, userId: b.user.id, props: {} })
		const insertPlace = async (
			title: string,
			branchId: number | null,
			anchorEntryId: number | null = null
		) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: b.lorebook.id,
						typeId: LOCATION_TYPE_ID,
						typeVersion: 1,
						title,
						content: title,
						keys: [],
						position: Math.floor(Math.random() * 1_000_000),
						branchId,
						anchorEntryId
					} as any)
					.returning()
			)[0]
		// The tower exists only on the deleted line; its cellar is filed inside
		// it on main, so the anchor cascade takes it too. The harbor is shared.
		const tower = await insertPlace("The Tower", gone)
		const cellar = await insertPlace("The Cellar", null, tower.id)
		const harbor = await insertPlace("The Harbor", null)
		for (const place of [tower, cellar, harbor])
			for (const kind of PLACE_KINDS) {
				const sessionId = kind === "session_location" ? session.id : null
				await testDb.insert(schema.attributeValues).values({
					ownerKind: kind,
					ownerId: place.id,
					slotId: "test:slot/stash@1",
					value: { v: ["rope"] },
					sessionId
				})
				await testDb.insert(schema.attributeConfigs).values({
					ownerKind: kind,
					ownerId: place.id,
					slotId: "test:slot/stash@1",
					config: { max: 9 },
					sessionId
				})
				await testDb
					.insert(schema.ownerSheets)
					.values({ ownerKind: kind, ownerId: place.id, sheetId, sessionId })
			}

		// A change to each place's stat, waiting in the session's review.
		for (const place of [tower, cellar, harbor])
			await testDb.insert(schema.stateProposals).values({
				sessionId: session.id,
				kind: "value",
				payload: {
					owner: { kind: "session_location", id: place.id },
					slotId: "test:slot/stash@1",
					value: ["lamp"]
				}
			})
		const waitingFor = async () =>
			(
				await testDb
					.select({ payload: schema.stateProposals.payload })
					.from(schema.stateProposals)
					.where(eq(schema.stateProposals.sessionId, session.id))
			).map((p) => (p.payload as any).owner.id)

		await b.deleteLine(gone)

		const none = { values: 0, configs: 0, sheets: 0 }
		expect(await placeRows(tower.id)).toEqual(none)
		expect(await placeRows(cellar.id)).toEqual(none)
		expect(await placeRows(harbor.id)).toEqual({
			values: 2,
			configs: 2,
			sheets: 2
		})
		expect(await waitingFor()).toEqual([harbor.id])
	}, 60_000)

	/** A session's line and stored clock. */
	async function sessionRow(id: number) {
		const [row] = await testDb
			.select({
				lorebookBranchId: schema.sessions.lorebookBranchId,
				storyClockYear: schema.sessions.storyClockYear,
				storyClockMonth: schema.sessions.storyClockMonth
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
		return row
	}

	test("sessions on the deleted line move to the line it forked from; a clock up to the fork date stays, one past it goes back to it", async () => {
		const b = await book("sessions-to-parent")
		// main ─Y5─ A ─Y3─ B (deleted). A goes on past Year 3 without B.
		const a = await b.fork("a", null, 5)
		const gone = await b.fork("b", a, 3)
		await b.history(2, a)
		await b.history(4, a)
		const setClock = async (id: number, year: number) =>
			testDb
				.update(schema.sessions)
				.set({ storyClockYear: year })
				.where(eq(schema.sessions.id, id))
		const early = await b.sessionOn(gone, "a clock before the fork")
		await setClock(early, 2)
		const late = await b.sessionOn(gone, "a clock past the fork")
		await setClock(late, 9)
		const following = await b.sessionOn(gone, "following its line")
		const { sessionReadingOf, historyEntryDate } = await import("$lib/server/state/reading")
		const { rowReadsOnLine } = await import("$lib/shared/lorebooks/lineReading")
		/** The history entries the session reads now, by year. */
		const reads = async (sessionId: number) => {
			const r = (await sessionReadingOf(testDb as any, sessionId))!
			const rows = await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.lorebookId, b.lorebook.id),
						eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
					)
				)
			return rows
				.filter((row) => rowReadsOnLine(row, r.line, historyEntryDate(row.fields), r.moment))
				.map((row) => (row.fields as { year: number }).year)
				.sort((x, y) => x - y)
		}
		expect(await reads(late)).toEqual([2])

		await b.deleteLine(gone)

		expect(await sessionRow(early)).toEqual({
			lorebookBranchId: a,
			storyClockYear: 2,
			storyClockMonth: null
		})
		// Year 9 on A would read A's Year 4, which never happened where the
		// session played: it stands at Year 3, where the two lines parted.
		expect(await sessionRow(late)).toEqual({
			lorebookBranchId: a,
			storyClockYear: 3,
			storyClockMonth: null
		})
		expect(await reads(late)).toEqual([2])
		expect(await sessionRow(following)).toEqual({
			lorebookBranchId: a,
			storyClockYear: null,
			storyClockMonth: null
		})
		// Their line moved, and the late one's clock: a setting each, and the row.
		expect(
			[...heard.settings].sort((x, y) => x.sessionId - y.sessionId)
		).toEqual(
			[
				{ sessionId: early, changed: ["lorebookBranchId"] },
				{ sessionId: late, changed: ["lorebookBranchId", "storyClock"] },
				{ sessionId: following, changed: ["lorebookBranchId"] }
			].sort((x, y) => x.sessionId - y.sessionId)
		)
		expect([...heard.rows].sort((x, y) => x - y)).toEqual(
			[early, late, following].sort((x, y) => x - y)
		)
	}, 60_000)

	test("a line forked at now cut nothing: every clock on it stays", async () => {
		const b = await book("sessions-fork-at-now")
		const a = await b.fork("a", null, null)
		const gone = await b.fork("b", a, null)
		const clocked = await b.sessionOn(gone, "far ahead")
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 90 })
			.where(eq(schema.sessions.id, clocked))

		await b.deleteLine(gone)

		expect(await sessionRow(clocked)).toEqual({
			lorebookBranchId: a,
			storyClockYear: 90,
			storyClockMonth: null
		})
		expect(heard.settings).toEqual([
			{ sessionId: clocked, changed: ["lorebookBranchId"] }
		])
	}, 60_000)

	test("a clock the book's calendar cannot place is cleared on the move: the session follows its new line's present", async () => {
		const b = await book("sessions-clock-cleared")
		const a = await b.fork("a", null, null)
		const gone = await b.fork("b", a, null)
		const stray = await b.sessionOn(gone, "a clock past the calendar")
		const fits = await b.sessionOn(gone, "a clock that fits")
		await testDb
			.update(schema.lorebooks)
			.set({
				storyCalendar: {
					months: [
						{ name: "Frost", days: 30 },
						{ name: "Thaw", days: 30 }
					]
				} as any
			})
			.where(eq(schema.lorebooks.id, b.lorebook.id))
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 4, storyClockMonth: 7 })
			.where(eq(schema.sessions.id, stray))
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 4, storyClockMonth: 2 })
			.where(eq(schema.sessions.id, fits))

		await b.deleteLine(gone)

		expect(await sessionRow(stray)).toEqual({
			lorebookBranchId: a,
			storyClockYear: null,
			storyClockMonth: null
		})
		expect(await sessionRow(fits)).toEqual({
			lorebookBranchId: a,
			storyClockYear: 4,
			storyClockMonth: 2
		})
		expect(
			heard.settings.find((s) => s.sessionId === stray)?.changed
		).toEqual(["lorebookBranchId", "storyClock"])
	}, 60_000)
})
