/**
 * 🚧 `core:query/cast-presences@1` at an hour (M0, lane T4, SHAPES L3):
 * where each cast member is from the first `schedule` field on an entry they
 * hold. Weekday and weekend pairs, an hour before the first pair, no schedule
 * -> nobody placed, the unwired hour reads the clock's present hour.
 * Calendar: seven weekdays; days 6 and 7 of a month are the weekend.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { defineRuleset } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const RULESET = "test:ruleset/routines@1"
const GENRE = "test:genre/routines"
const ROUTINE = {
	weekday: [
		[7, "work"],
		[18, "home"]
	],
	weekend: [[9, "market"]]
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-presences-at-hour-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	defineRuleset(RULESET, {
		name: { en: "Routines" },
		attributes: [],
		entryTypes: [{ id: "routine", name: { en: "Routine" }, holders: ["cast"], fields: { routine: { type: "schedule" } }, prose: "Routine: where someone is by the hour." }]
	} as never)
	genreKeeping(GENRE, { name: { en: "Routines" }, family: "test", slots: [], events: {} })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world(clock: { day: number; hour: number } | null = { day: 3, hour: 10 }) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `presences-hour-${++n}`)
	const [wren, mara] = await db
		.insert(schema.characters)
		.values(["Wren", "Mara"].map((name) => ({ userId: user.id, name, description: `${name}.` })))
		.returning()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `Town ${n}`,
			storyCalendar: { months: [{ name: "Thaw", days: 30 }], weekdays: ["a", "b", "c", "d", "e", "f", "g"], firstWeekday: 0 }
		} as never)
		.returning()
	const bindings = await db
		.insert(schema.lorebookBindings)
		.values([wren!, mara!].map((c) => ({ lorebookId: book!.id, characterId: c.id, binding: `{{char:${c.id}}}`, name: c.name })))
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: "Town",
			genreId: GENRE,
			primaryRuleset: RULESET,
			lorebookId: book!.id,
			...(clock ? { storyClockYear: 1, storyClockMonth: 1, storyClockDay: clock.day, storyClockHour: clock.hour, storyClockMinute: 0 } : {})
		})
		.returning()
	await db.insert(schema.sessionCharacters).values([wren!, mara!].map((c) => ({ sessionId: session!.id, characterId: c.id })))
	// Only Wren holds a routine.
	await db.insert(schema.zoneContents).values({
		sessionId: session!.id,
		ownerKind: "session_cast",
		ownerId: wren!.id,
		rulesetId: RULESET,
		zoneType: "carried",
		entries: [{ entryId: null, entryType: "routine", name: "Wren's week", fields: { routine: ROUTINE } }],
		updatedBy: "test"
	})
	return { session: session!, wrenBinding: bindings.find((b) => b.characterId === wren!.id)! }
}

const at = async (sessionId: number, atHour?: { hour: number; minute?: number; day?: "today" | "tomorrow" | "next" }) => {
	const { presencesOnReading } = await import("./presencesOnReading")
	return (await presencesOnReading(db as never, sessionId, atHour)).placements
}

describe("cast-presences at an hour", () => {
	test("unwired: the clock's present hour, today", async () => {
		const w = await world()
		expect(await at(w.session.id)).toEqual([{ bindingId: w.wrenBinding.id, where: "work" }])
	})

	test("an hour before the first pair reads the list's last", async () => {
		const w = await world()
		expect(await at(w.session.id, { hour: 6, day: "today" })).toEqual([{ bindingId: w.wrenBinding.id, where: "home" }])
	})

	test("next: today when the hour is ahead, tomorrow when it is not", async () => {
		const w = await world()
		expect(await at(w.session.id, { hour: 19 })).toEqual([{ bindingId: w.wrenBinding.id, where: "home" }])
		expect(await at(w.session.id, { hour: 9 })).toEqual([{ bindingId: w.wrenBinding.id, where: "work" }])
	})

	test("the weekend reads the last two weekdays", async () => {
		const w = await world({ day: 6, hour: 10 })
		expect(await at(w.session.id)).toEqual([{ bindingId: w.wrenBinding.id, where: "market" }])
		const eve = await world({ day: 5, hour: 10 })
		expect(await at(eve.session.id, { hour: 12, day: "tomorrow" })).toEqual([{ bindingId: eve.wrenBinding.id, where: "market" }])
	})

	test("no clock places nobody", async () => {
		const w = await world(null)
		expect(await at(w.session.id)).toEqual([])
	})

	test("a member holding no schedule is left out (Mara above), and a genre with none gets []", async () => {
		const w = await world()
		const placed = await at(w.session.id)
		expect(placed).toHaveLength(1)
		await db.delete(schema.zoneContents)
		expect(await at(w.session.id)).toEqual([])
	})
})
