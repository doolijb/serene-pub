/**
 * `loreWriteDateOf` is the one answer every pipeline lore write
 * asks — `dated` (a timeline and a story now), `timeless` (no timeline) or
 * `undatable` (a timeline and no date at all) — and `undatedLoreWriteRefusal`
 * is the backstop for a write that must be dated and arrived without a date.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lore-write-date-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `lore-write-date-${++n}`)
}

type Fields = Record<string, unknown>

async function dated(lorebookId: number, fields: Fields) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: null,
			content: "…",
			fields
		})
		.returning()
	return row!
}

/** An attached lorebook (timeline on unless told) and a session on it. */
async function world(
	opts: {
		timeline?: boolean
		bookClock?: { year: number; month?: number; day?: number }
		clock?: { year: number; month?: number; day?: number }
	} = {}
) {
	const u = await user()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: u.id,
			name: `World ${++n}`,
			timelineEnabled: opts.timeline ?? true,
			storyClockYear: opts.bookClock?.year ?? null,
			storyClockMonth: opts.bookClock?.month ?? null,
			storyClockDay: opts.bookClock?.day ?? null
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: u.id,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId: book!.id,
			storyClockYear: opts.clock?.year ?? null,
			storyClockMonth: opts.clock?.month ?? null,
			storyClockDay: opts.clock?.day ?? null
		})
		.returning()
	return { user: u, book: book!, session: session! }
}

const kindOf = async (sessionId: number) => {
	const { loreWriteDateOf } = await import("$lib/server/state/storyTime")
	return loreWriteDateOf(db(), sessionId)
}

describe("loreWriteDateOf", () => {
	test("a session clock is dated, at the clock's day", async () => {
		const w = await world({ clock: { year: 10, month: 2, day: 5 } })
		const first = await dated(w.book.id, { year: 3 })
		expect(await kindOf(w.session.id)).toEqual({
			kind: "dated",
			date: { year: 10, month: 2, day: 5 },
			hangsOn: first.id
		})
	})

	test("only the lorebook's clock: dated, at that clock's day", async () => {
		const w = await world({ bookClock: { year: 12, month: 4 } })
		expect(await kindOf(w.session.id)).toMatchObject({
			kind: "dated",
			date: { year: 12, month: 4 }
		})
	})

	test("no clock but a dated history entry: dated at the newest history day, hanging on that entry", async () => {
		const w = await world()
		await dated(w.book.id, { year: 3, month: 2 })
		const newest = await dated(w.book.id, { year: 5, month: 1, day: 9 })
		expect(await kindOf(w.session.id)).toEqual({
			kind: "dated",
			date: { year: 5, month: 1, day: 9 },
			hangsOn: newest.id
		})
	})

	test("a clock earlier than the first dated history entry: dated, hanging on nothing (legal)", async () => {
		const w = await world({ clock: { year: 1 } })
		await dated(w.book.id, { year: 5 })
		const got = await kindOf(w.session.id)
		expect(got.kind).toBe("dated")
		expect(got).toMatchObject({ date: { year: 1 }, hangsOn: null })
	})

	test("timeline off, with a stale clock: timeless", async () => {
		const w = await world({ timeline: false, clock: { year: 10, month: 2, day: 5 } })
		await dated(w.book.id, { year: 5 })
		expect(await kindOf(w.session.id)).toEqual({ kind: "timeless" })
	})

	test("timeline on and nothing dated: undatable", async () => {
		const w = await world()
		// An undated World lore entry is not a date.
		await testDb.insert(schema.lorebookEntries).values({
			lorebookId: w.book.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "Tides",
			content: "…",
			fields: {}
		})
		expect(await kindOf(w.session.id)).toEqual({ kind: "undatable" })
	})

	test("a session on its own notes (no attached lorebook) with a dated notes history entry: dated", async () => {
		const u = await user()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: `Run ${++n}` })
			.returning()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(db(), session!.id)
		await testDb.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, own.id)) // the notes state their timeline
		const entry = await dated(own.id, { year: 15, month: 3 })
		expect(await kindOf(session!.id)).toEqual({
			kind: "dated",
			date: { year: 15, month: 3, day: null },
			hangsOn: entry.id
		})
	})
})

describe("undatedLoreWriteRefusal", () => {
	async function refusal(sessionId: number, date: { year: number } | null) {
		const { undatedLoreWriteRefusal } = await import("$lib/server/state/storyTime")
		return undatedLoreWriteRefusal(db(), sessionId, date)
	}

	test("dated and no date came: the sentence", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const w = await world({ clock: { year: 10 } })
		expect(await refusal(w.session.id, null)).toBe(UNDATED_LORE_WRITE_SENTENCE)
	})

	test("dated and a date came: no refusal", async () => {
		const w = await world({ clock: { year: 10 } })
		expect(await refusal(w.session.id, { year: 10 })).toBeNull()
	})

	test("timeless and no date: no refusal", async () => {
		const w = await world({ timeline: false })
		expect(await refusal(w.session.id, null)).toBeNull()
	})

	test("undatable and no date: no refusal", async () => {
		const w = await world()
		expect(await refusal(w.session.id, null)).toBeNull()
	})
})
