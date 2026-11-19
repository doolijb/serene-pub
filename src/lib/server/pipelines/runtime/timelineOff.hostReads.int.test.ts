/**
 * Owner D56, 2026-11-16: with the timeline off every story-time value a run
 * reads is null, whatever is stored. Two reads through the host:
 *  - `stat_trail` (the points keep their order; each anchor's date is null);
 *  - `lorebook_entries` (a row's stored Beginning is null; history is left out).
 * With the timeline on both read as stored.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { createHost } from "./host"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-timeline-off-reads-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const HP = "core:slot/hp@1"
const GENRE = "test:genre/timeline-off-reads"
let n = 0

function declareSlots() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 100 },
		default: 20
	})
	genreKeeping(GENRE, {
		name: { en: "Timeline off reads" },
		family: "test",
		slots: [hp],
		customAttributes: "allow",
		events: {}
	})
}

/** A book with a cast binding, dated hp points, a world entry that began in year 4, and a session with STALE clock year 9. */
async function world(timelineEnabled: boolean) {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `tl-off-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}`, timelineEnabled })
		.returning()
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook!.id,
			characterId: verity!.id,
			binding: `{{char:${verity!.id}}}`,
			name: verity!.name
		})
		.returning()
	const history = async (year: number) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook!.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					position: ++n,
					title: null,
					content: "…",
					fields: { year }
				})
				.returning()
		)[0]!
	// Written out of order on purpose: the order is the year, then the id.
	const y7 = await history(7)
	const y3 = await history(3)
	for (const [v, h] of [
		[30, y7],
		[10, y3]
	] as const)
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: binding!.id,
			slotId: HP,
			value: { v },
			sessionId: null,
			updatedBy: "user",
			historyEntryId: h.id
		})
	await testDb.insert(schema.lorebookEntries).values(
		entryInsert({
			typeId: WORLD_LORE_TYPE_ID,
			lorebookId: lorebook!.id,
			name: "The Old Wall",
			content: "Built long ago.",
			year: 4,
			month: 2,
			day: 1,
			position: ++n
		} as any) as any
	)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			lorebookId: lorebook!.id,
			storyClockYear: 9
		})
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: verity!.id })
	const read = (table: string, q: Record<string, unknown>) =>
		createHost(testDb as any, { sessionId: session!.id }).read!(table, q, {
			key: "r",
			definitionId: "core:query/x@1"
		} as any) as Promise<any>
	return { binding, session: session!, read, lorebook: lorebook! }
}

const trailQuery = (b: { binding: { id: number } }) => ({
	owner: { kind: "cast_member", id: b.binding.id },
	slotId: "hp",
	mode: "timeline"
})
const loreQuery = (sessionId: number) => ({
	sessionId,
	currentCharacterId: null,
	enabled: true,
	archived: false,
	entryTypes: [WORLD_LORE_TYPE_ID, HISTORY_TYPE_ID]
})

describe("stat_trail on the host path", () => {
	test("timeline on: the points carry their dates", async () => {
		const w = await world(true)
		const trail = await w.read("stat_trail", trailQuery(w))
		expect(trail.points.map((p: any) => p.value)).toEqual([10, 30])
		expect(trail.points.map((p: any) => p.anchor.date?.year)).toEqual([3, 7])
	})

	test("timeline off, stale stored dates: same points, same order, dates null", async () => {
		const w = await world(false)
		const trail = await w.read("stat_trail", trailQuery(w))
		expect(trail.points.map((p: any) => p.value)).toEqual([10, 30])
		expect(trail.points.map((p: any) => p.anchor.date)).toEqual([null, null])
	})
})

/** Statements that ask a lorebook for its own switch (`bookTimelineSql`): the one a granted read spends. */
async function countSwitchReads<T>(fn: () => Promise<T>): Promise<{ result: T; asked: number }> {
	const client = (testDb as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client
	const original = client.query.bind(client)
	let asked = 0
	client.query = (...args: unknown[]) => {
		if (typeof args[0] === "string" && args[0].includes("ov.timeline_enabled")) asked++
		return original(...args)
	}
	try {
		return { result: await fn(), asked }
	} finally {
		client.query = original
	}
}

describe("stat_trail on a granted lorebook (a lorebook-scoped run, no session)", () => {
	const granted = (w: Awaited<ReturnType<typeof world>>) => (q: Record<string, unknown>) =>
		createHost(testDb as any, { lorebookId: w.lorebook.id }).read!("stat_trail", q, {
			key: "r",
			definitionId: "core:query/x@1"
		} as any) as Promise<any>

	test("timeline off: the points keep their order and every date is null, whatever is stored", async () => {
		const w = await world(false)
		const trail = await granted(w)(trailQuery(w))
		expect(trail.points.map((p: any) => p.value)).toEqual([10, 30])
		expect(trail.points.map((p: any) => p.anchor.date)).toEqual([null, null])
	})

	test("timeline on: stored dates", async () => {
		const w = await world(true)
		const trail = await granted(w)(trailQuery(w))
		expect(trail.points.map((p: any) => p.anchor.date?.year)).toEqual([3, 7])
	})

	test("the switch is asked once on a granted read, and not at all on a session's own book", async () => {
		const w = await world(false)
		const g = await countSwitchReads(() => granted(w)(trailQuery(w)))
		expect(g.asked).toBe(1)
		const s = await countSwitchReads(() => w.read("stat_trail", trailQuery(w)))
		expect(s.asked).toBe(0)
	})
})

describe("lorebook_entries on the host path", () => {
	test("timeline on: a world entry's Beginning is read; history is listed", async () => {
		const w = await world(true)
		const rows = await w.read("lorebook_entries", loreQuery(w.session.id))
		const wall = rows.find((r: any) => r.name === "The Old Wall" || r.title === "The Old Wall")
		expect(wall).toBeTruthy()
		expect([wall.year, wall.month, wall.day]).toEqual([4, 2, 1])
		expect(rows.some((r: any) => r.source === "history")).toBe(true)
	})

	test("timeline off, stale stored Beginning: year, month and day are null; history is left out", async () => {
		const w = await world(false)
		const [stored] = await testDb
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.lorebook.id))
			.limit(50)
		expect(stored).toBeTruthy()
		const rows = await w.read("lorebook_entries", loreQuery(w.session.id))
		const wall = rows.find((r: any) => r.name === "The Old Wall" || r.title === "The Old Wall")
		expect(wall).toBeTruthy()
		expect([wall.year, wall.month, wall.day]).toEqual([null, null, null])
		expect(rows.some((r: any) => r.source === "history")).toBe(false)
	})
})
