/**
 * The cast's `storyTime` follows one rule (owner D56, lane tm-1): on a lorebook
 * that keeps no timeline `now`, `calendar` and `sessionStart` are `null`
 * whatever is stored; `sessionStart` is always a key; `timeline: false` only
 * then. And the two `timeline` facts agree: `SessionSettingsV1.timeline` is
 * `false` exactly when the cast's `storyTime.timeline === false`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { resolveSessionSettings } from "$lib/server/sessions/settings"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let userId: number

const THAW = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 }
	],
	yearLabel: "Year"
}

const castNode = { key: "read", definitionId: "core:query/session-cast@1" } as any

/** One session on its own attached book, with what each case stores. */
async function world(opts: {
	timelineEnabled: boolean
	clock: boolean
	stamped: boolean
	history: boolean
}) {
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId,
			name: "Book",
			timelineEnabled: opts.timelineEnabled,
			storyCalendar: THAW
		} as any)
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			lorebookId: book!.id,
			...(opts.clock
				? { storyClockYear: 9, storyClockMonth: 2, storyClockDay: 4 }
				: {})
		} as any)
		.returning()
	const sessionId = session!.id
	if (opts.stamped)
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: "user",
			content: "Hello",
			storyClockYear: 8,
			storyClockMonth: 2,
			storyClockDay: 3
		} as any)
	if (opts.history)
		await db.insert(schema.lorebookEntries).values(
			historyValues([
				{ lorebookId: book!.id, year: 3, keys: "", constant: true, content: "Frost." }
			])
		)
	const cast = (await createHost(db as any, { sessionId }).read!(
		"session_cast",
		{ sessionId },
		castNode
	)) as any
	const settings = (await resolveSessionSettings(db, sessionId))!
	return { storyTime: cast.storyTime, timeline: settings.timeline }
}

beforeAll(async () => {
	db = await createTestDb()
	userId = (await createTestUser(db, "storytime-cast-owner")).id
}, 60_000)

describe("session_cast storyTime: one rule for a timeline that is off", () => {
	it("dated: timeline on, a clock, a calendar, a stamped message", async () => {
		const r = await world({ timelineEnabled: true, clock: true, stamped: true, history: true })
		expect(r.storyTime.now).toMatchObject({ year: 9, month: 2, day: 4 })
		expect(r.storyTime.calendar).toEqual(THAW)
		expect(r.storyTime.sessionStart).toEqual({ year: 8, month: 2, day: 3 })
		expect(r.storyTime.timeline).toBe(true) // was: the key was absent
		expect(r.timeline).toBe(true)
	})

	it("undatable: timeline on, no clock, no dated history, no stamp", async () => {
		const r = await world({ timelineEnabled: true, clock: false, stamped: false, history: false })
		expect(r.storyTime.now).toBeNull()
		expect(r.storyTime.calendar).toEqual(THAW)
		expect("sessionStart" in r.storyTime).toBe(true)
		expect(r.storyTime.sessionStart).toBeNull()
		expect(r.storyTime.timeline).toBe(true) // was: the key was absent
		expect(r.timeline).toBe(true)
	})

	it("timeless: timeline off with a stale clock, a calendar, a stamp and dated history", async () => {
		const r = await world({ timelineEnabled: false, clock: true, stamped: true, history: true })
		expect(r.storyTime.now).toBeNull()
		expect(r.storyTime.calendar).toBeNull()
		expect("sessionStart" in r.storyTime).toBe(true)
		expect(r.storyTime.sessionStart).toBeNull()
		expect(r.storyTime.timeline).toBe(false)
		expect(r.timeline).toBe(false)
	})
})
