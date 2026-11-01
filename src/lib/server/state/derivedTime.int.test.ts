/**
 * Derived time (M0, lane T2): day-period follows the session clock and
 * the attached book's periods; time-of-day reads the clock until somebody
 * writes it; a derived slot is never written; an own book starts with its
 * genre's declared calendar.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { defineAttributeSlot, derivations, _clearAttributeSlots } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

// Test genres live in the SDK registry, not in the genre rows `getSessionGenre`
// reads, so the declared-calendar genre is served by a stand-in (as lanes.int.test.ts does).
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (orig) => {
	const real = await orig<typeof import("$lib/server/pipelines/entities/sessionGenres")>()
	return {
		...real,
		getSessionGenre: async (db: unknown, genreId: string) =>
			genreId === "test:genre/declared-calendar"
				? {
						genreId,
						name: "Calendar",
						shape: { calendar: { periods: [{ id: "first-light", label: "First light", from: 4 }] } }
					}
				: real.getSessionGenre(db as never, genreId)
	}
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-derived-time-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const DAY_PERIOD = "core:slot/day-period@1"
const TIME_OF_DAY = "core:slot/time-of-day@1"
const GENRE = "test:genre/derived-time"
const CALENDAR_GENRE = "test:genre/declared-calendar"

function declare() {
	_clearAttributeSlots()
	const declared = [
		defineAttributeSlot(DAY_PERIOD, {
			type: "derived",
			descriptor: "The part of the day.",
			appliesTo: ["world"],
			config: { derivation: derivations.dayPeriod.id }
		}),
		defineAttributeSlot(TIME_OF_DAY, {
			type: "enum",
			descriptor: "Where the clock has got to.",
			appliesTo: ["world"],
			config: { of: ["morning", "day", "dusk", "night"], derivation: derivations.timeOfDay.id },
			default: "morning"
		})
	]
	genreKeeping(GENRE, { name: { en: "Time" }, family: "test", slots: declared, events: {} })
	genreKeeping(CALENDAR_GENRE, {
		name: { en: "Calendar" },
		family: "test",
		slots: declared,
		events: {},
		shape: { calendar: { periods: [{ id: "first-light", label: "First light", from: 4 }] } }
	})
}

let n = 0

async function world(
	hour: number | null,
	periods?: { id: string; label: string; from: number }[],
	genreId = GENRE
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `derived-time-${suffix}`)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			storyCalendar: { months: [{ name: "Thaw", days: 30 }], ...(periods ? { periods } : {}) }
		})
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId,
			lorebookId: lorebook.id,
			storyClockYear: 1,
			storyClockMonth: 1,
			storyClockDay: 1,
			storyClockHour: hour,
			storyClockMinute: hour === null ? null : 0
		})
		.returning()
	return { user, lorebook, session }
}

const owner = (sessionId: number) => ({ kind: "session" as const, id: sessionId })

describe("derived time", () => {
	test("day-period follows the clock and the attached book's periods", async () => {
		declare()
		const { valueOf } = await import("$lib/server/state/resolve")
		const periods = [
			{ id: "first-light", label: "First light", from: 4 },
			{ id: "high-sun", label: "High sun", from: 13 }
		]
		const own = await world(14, periods)
		expect(
			await valueOf(db, { sessionId: own.session.id, owner: owner(own.session.id), slotId: DAY_PERIOD })
		).toBe("high-sun")
		const plain = await world(14)
		expect(
			await valueOf(db, { sessionId: plain.session.id, owner: owner(plain.session.id), slotId: DAY_PERIOD })
		).toBe("day")
	}, 60_000)

	test("time-of-day is derived when unset, and a hand write wins", async () => {
		declare()
		const { valueOf } = await import("$lib/server/state/resolve")
		const w = await world(19)
		const query = { sessionId: w.session.id, owner: owner(w.session.id), slotId: TIME_OF_DAY }
		expect(await valueOf(db, query)).toBe("dusk")
		await db.insert(schema.attributeValues).values({
			ownerKind: "session",
			ownerId: w.session.id,
			slotId: TIME_OF_DAY,
			value: { v: "night" },
			sessionId: w.session.id,
			validFromMessageId: null
		})
		expect(await valueOf(db, query)).toBe("night")
	}, 60_000)

	test("a write to day-period is refused", async () => {
		declare()
		const w = await world(10)
		const { setValue, StateRefusal } = await import("$lib/server/state/write")
		await expect(
			setValue(
				db,
				{ sessionId: w.session.id, updatedBy: "user" },
				{ owner: owner(w.session.id), slotId: DAY_PERIOD, value: "night" }
			)
		).rejects.toBeInstanceOf(StateRefusal)
	}, 60_000)

	test("insertOwnBook for a genre declaring shape.calendar stores its periods", async () => {
		declare()
		const w = await world(10, undefined, CALENDAR_GENRE)
		const { insertOwnBook, OWN_BOOK_CALENDAR } = await import("$lib/server/lorebooks/ownBook")
		const made = await insertOwnBook(db as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		expect(made.storyCalendar).toEqual({
			...OWN_BOOK_CALENDAR,
			periods: [{ id: "first-light", label: "First light", from: 4 }]
		})
		const [row] = await db.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, made.id))
		expect((row.storyCalendar as { periods?: unknown }).periods).toHaveLength(1)
	}, 60_000)
})
