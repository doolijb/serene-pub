/**
 * 🚧 The **Timeline** switch, lane timeline-b: `lorebooks:create` takes it, the
 * file carries it (only when off), a flip tells the sessions it governs, and
 * `lorebooks:get` gives the owner the counts for the prompt.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const broadcasts: { sessionId: number; event: string; data: any }[] = []

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

vi.mock("./utils/broadcastHelpers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./utils/broadcastHelpers")>()
	return {
		...actual,
		broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, data: any) => {
			broadcasts.push({ sessionId, event, data })
		}
	}
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lorebooksTimelineB-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

beforeEach(() => {
	broadcasts.length = 0
})

let n = 0
let order = 0
const quiet = (async () => {}) as any
const as = (id: number) => ({ user: { id }, io: {} }) as any

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `lb-timeline-b-${++n}`)
}

async function book(userId: number, values: Partial<typeof schema.lorebooks.$inferInsert> = {}) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Codex ${++n}`, ...values })
		.returning()
	return row!
}

async function stored(id: number) {
	const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, id))
	return row!
}

async function entry(bookId: number, typeId: string, fields: Record<string, unknown> = {}) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: bookId,
			typeId,
			typeVersion: 1,
			position: ++order,
			title: `Entry ${order}`,
			content: "…",
			fields
		})
		.returning()
	return row!
}

describe("lorebooks:create takes the Timeline switch", () => {
	test("absent is on; false is off; true is on", async () => {
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const me = await person()
		const plain = await lorebooksCreateHandler.handler(as(me.id), { name: "Plain" } as any, quiet)
		expect((await stored(plain.lorebook!.id)).timelineEnabled).toBe(true)
		const off = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "Off", timelineEnabled: false } as any,
			quiet
		)
		expect((await stored(off.lorebook!.id)).timelineEnabled).toBe(false)
		const on = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "On", timelineEnabled: true } as any,
			quiet
		)
		expect((await stored(on.lorebook!.id)).timelineEnabled).toBe(true)
	})

	test("a dated book is born on the real calendar, an undated one free-form, a kit copy keeps the kit's", async () => {
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { STORY_CALENDAR_PRESETS } = await import("@serene-pub/sdk")
		const real = STORY_CALENDAR_PRESETS.find((p) => p.id === "real-calendar")!.calendar
		const twelve = STORY_CALENDAR_PRESETS.find((p) => p.id === "twelve-months")!.calendar
		const me = await person()
		const dated = await lorebooksCreateHandler.handler(as(me.id), { name: "Dated" } as any, quiet)
		expect((await stored(dated.lorebook!.id)).storyCalendar).toEqual(real)
		const on = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "On", timelineEnabled: true } as any,
			quiet
		)
		expect((await stored(on.lorebook!.id)).storyCalendar).toEqual(real)
		const off = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "Undated", timelineEnabled: false } as any,
			quiet
		)
		expect((await stored(off.lorebook!.id)).storyCalendar).toBeNull()
		const kit = await book(me.id, { kind: "starter_kit", name: "Kit", storyCalendar: twelve as any })
		const copy = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "From kit", starterKit: { lorebookId: kit.id } } as any,
			quiet
		)
		expect((await stored(copy.lorebook!.id)).storyCalendar).toEqual(twelve)
	})

	test("a value that is not on or off is refused and writes nothing", async () => {
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const me = await person()
		await expect(
			lorebooksCreateHandler.handler(as(me.id), { name: "Bad", timelineEnabled: "false" } as any, quiet)
		).rejects.toThrow("The timeline is on or off.")
		const rows = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.userId, me.id))
		expect(rows).toHaveLength(0)
	})

	test("with a starter kit the value is not read", async () => {
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const me = await person()
		const kit = await book(me.id, { kind: "starter_kit", name: "Kit" })
		const res = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "From kit", starterKit: { lorebookId: kit.id }, timelineEnabled: false } as any,
			quiet
		)
		expect((await stored(res.lorebook!.id)).timelineEnabled).toBe(true)
	})
})

describe("the file carries the switch only when it is off", () => {
	async function exported(id: number, userId: number) {
		const { buildLorebookExportData } = await import("$lib/server/utils/lorebookExportBuilder")
		const { specBookWithGraph } = await buildLorebookExportData(id, userId, {})
		return JSON.parse(JSON.stringify(specBookWithGraph)) as any
	}

	test("a timelined book's file has no key and the same other keys; an off book's has exactly one more", async () => {
		const me = await person()
		const on = await exported((await book(me.id)).id, me.id)
		const off = await exported((await book(me.id, { timelineEnabled: false })).id, me.id)
		expect("timelineEnabled" in (on.extensions?.serenepub ?? {})).toBe(false)
		expect(off.extensions.serenepub.timelineEnabled).toBe(false)
		const onKeys = Object.keys(on.extensions?.serenepub ?? {}).sort()
		const offKeys = Object.keys(off.extensions.serenepub).sort()
		expect(offKeys).toEqual([...onKeys, "timelineEnabled"].sort())
		expect(on.extensions.serenepub.formatVersion).toBe(off.extensions.serenepub.formatVersion)
	})

	test("import round trip: off stays off, on stays on, a file with anything but false is on", async () => {
		const { importLorebookDocument } = await import("./lorebooks")
		const me = await person()
		const offDoc = await exported((await book(me.id, { timelineEnabled: false })).id, me.id)
		const onDoc = await exported((await book(me.id)).id, me.id)
		const backOff = await importLorebookDocument(me.id, JSON.stringify(offDoc))
		expect((await stored(backOff.book.id)).timelineEnabled).toBe(false)
		const backOn = await importLorebookDocument(me.id, JSON.stringify(onDoc))
		expect((await stored(backOn.book.id)).timelineEnabled).toBe(true)
		for (const bad of ["false", 0, null]) {
			// A fresh uuid each time so the file is not read as a re-import.
			const doc = JSON.parse(JSON.stringify(offDoc))
			delete doc.extensions.serenepub.uuid
			doc.extensions.serenepub.timelineEnabled = bad
			const r = await importLorebookDocument(me.id, JSON.stringify(doc))
			expect((await stored(r.book.id)).timelineEnabled, String(bad)).toBe(true)
		}
	})
})

describe("a flip tells the sessions it governs", () => {
	async function setSwitch(
		userId: number,
		id: number,
		extra: { name?: string; timelineEnabled?: boolean }
	) {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const { timelineEnabled, ...book } = extra
		return lorebooksUpdateHandler.handler(
			as(userId),
			{ lorebook: { id, ...book }, ...(timelineEnabled !== undefined ? { timelineEnabled } : {}) } as any,
			quiet
		)
	}

	test("an attached session and a whole-world notes session hear it; none on a rename or the same value", async () => {
		const me = await person()
		const codex = await book(me.id)
		const [attached] = await testDb
			.insert(schema.sessions)
			.values({ userId: me.id, isGroup: false, name: "Attached", lorebookId: codex.id })
			.returning()
		const [elsewhere] = await testDb
			.insert(schema.sessions)
			.values({ userId: me.id, isGroup: false, name: "Elsewhere" })
			.returning()
		const [alone] = await testDb
			.insert(schema.sessions)
			.values({ userId: me.id, isGroup: false, name: "Alone" })
			.returning()
		const whole = await book(me.id, { sessionId: alone!.id })

		await setSwitch(me.id, codex.id, { name: "Renamed" })
		await setSwitch(me.id, codex.id, { timelineEnabled: true })
		expect(broadcasts).toEqual([])

		await setSwitch(me.id, codex.id, { timelineEnabled: false })
		expect(broadcasts.map((b) => b.sessionId)).toEqual([attached!.id])
		expect(broadcasts[0]).toMatchObject({ event: "state:changed", data: { sessionId: attached!.id } })

		broadcasts.length = 0
		await setSwitch(me.id, whole.id, { timelineEnabled: false })
		expect(broadcasts.map((b) => b.sessionId)).toEqual([alone!.id])
		expect(broadcasts.some((b) => b.sessionId === elsewhere!.id)).toBe(false)
	})

	test("a person's save of the switch removes the upgrade pass's mark; a rename leaves it", async () => {
		const me = await person()
		const codex = await book(me.id, {
			timelineEnabled: false,
			extraJson: { timelineOffByPass: "2026-11-14T00:00:00.000Z", kept: 1 }
		} as any)
		const stored = async () =>
			(
				await testDb
					.select({ extraJson: schema.lorebooks.extraJson })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, codex.id))
			)[0]!.extraJson
		await setSwitch(me.id, codex.id, { name: "Renamed again" })
		expect((await stored()).timelineOffByPass).toBeDefined()
		await setSwitch(me.id, codex.id, { timelineEnabled: true })
		expect(await stored()).toEqual({ kept: 1 })
	})
})

describe("lorebooks:get gives the owner the counts for the prompt", () => {
	test("dated changes, history entries (dated or not) and a clock; a shared reader gets none", async () => {
		const { lorebooksGetHandler } = await import("./lorebooks")
		const owner = await person()
		const reader = await person()
		const codex = await book(owner.id)
		await testDb.insert(schema.lorebookShares).values({ lorebookId: codex.id, userId: reader.id })

		const empty = await lorebooksGetHandler.handler(as(owner.id), { id: codex.id }, quiet)
		expect(empty.lorebook!.timelineCounts).toEqual({ datedChanges: 0, historyEntries: 0, presences: 0, beginnings: 0, clockSet: false })

		const place = await entry(codex.id, LOCATION_TYPE_ID)
		await entry(codex.id, HISTORY_TYPE_ID, { year: 3 })
		await entry(codex.id, HISTORY_TYPE_ID, {})
		await testDb.insert(schema.entryAmendments).values([
			{ lorebookId: codex.id, entryId: place.id, year: 2, fields: { name: "Later" } },
			{ lorebookId: codex.id, entryId: place.id, year: null, fields: { name: "Held" }, base: { name: { v: "Was" } }, sourceMessageId: 4 }
		])
		const [m] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: codex.id, binding: "{{char:m-1}}", characterId: null, name: "Raw", description: "Raw." })
			.returning()
		await testDb
			.insert(schema.castAmendments)
			.values({ lorebookBindingId: m!.id, lorebookId: codex.id, year: 3, fields: { name: "Later" } } as any)
		await testDb.insert(schema.lorebookBranches).values({ lorebookId: codex.id, name: "Other", forkYear: 1, storyClockYear: 5 })

		const full = await lorebooksGetHandler.handler(as(owner.id), { id: codex.id }, quiet)
		expect(full.lorebook!.timelineCounts).toEqual({ datedChanges: 2, historyEntries: 2, presences: 0, beginnings: 0, clockSet: true })

		const shared = await lorebooksGetHandler.handler(as(reader.id), { id: codex.id }, quiet)
		expect(shared.lorebook).toBeTruthy()
		expect(shared.lorebook!.timelineCounts).toBeUndefined()
	})
})
