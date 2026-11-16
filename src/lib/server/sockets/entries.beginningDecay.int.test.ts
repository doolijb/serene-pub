/**
 * An entry's Beginning (its own year, month and day in `fields`; none is
 * Perpetual) and Decay (`decayRate`, one number from 0 to 1) written through
 * `entries:create` and `entries:update`, and the timeline counts that
 * include the Beginnings.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	TIMELINE_OFF_SENTENCES,
	timelineCountsOf,
	holdsSomethingDated
} from "$lib/server/lorebooks/timeline"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { formatDate } from "$lib/shared/lorebooks/storyDate"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-entriesBeginningDecay-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
const socket = (userId: number) => ({ user: { id: userId } }) as any
const THAW = { months: [{ name: "Thaw", days: 30 }] }

async function world(
	opts: { timelineEnabled?: boolean; calendar?: unknown } = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `entries-beginning-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			name: `Book ${seq}`,
			userId: owner.id,
			timelineEnabled: opts.timelineEnabled ?? true,
			storyCalendar: (opts.calendar ?? null) as any
		})
		.returning()
	return { owner, book: book! }
}

const entryOf = (
	typeId: string,
	lorebookId: number,
	extra: Record<string, unknown> = {}
) => ({
	typeId,
	lorebookId,
	name: `Entry ${++seq}`,
	content: "Text.",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	...extra
})

async function create(userId: number, entry: any) {
	const { createEntryHandler } = await import("./entries")
	return (
		await createEntryHandler.handler(socket(userId), { entry }, () => {})
	).entry as any
}
async function update(
	userId: number,
	typeId: string,
	id: number,
	patch: Record<string, unknown>
) {
	const { updateEntryHandler } = await import("./entries")
	return (
		await updateEntryHandler.handler(
			socket(userId),
			{ entry: { id, typeId, ...patch } } as any,
			() => {}
		)
	).entry as any
}
const stored = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!

describe("Decay", () => {
	test("is held to 0..1, defaults to 0, and a non-number is refused with the sentence", async () => {
		const w = await world()
		const base = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id)
		)
		expect(base.decayRate).toBe(0)
		const high = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id, { decayRate: 1.7 })
		)
		expect(high.decayRate).toBe(1)
		expect((await stored(high.id)).decayRate).toBe(1)
		const low = await update(w.owner.id, WORLD_LORE_TYPE_ID, high.id, {
			decayRate: -0.2
		})
		expect(low.decayRate).toBe(0)
		const half = await update(w.owner.id, WORLD_LORE_TYPE_ID, high.id, {
			decayRate: 0.5
		})
		expect(half.decayRate).toBe(0.5)
		await expect(
			create(
				w.owner.id,
				entryOf(WORLD_LORE_TYPE_ID, w.book.id, { decayRate: "fast" })
			)
		).rejects.toThrow("Decay is a number from 0 to 1.")
		await expect(
			update(w.owner.id, WORLD_LORE_TYPE_ID, high.id, { decayRate: null })
		).rejects.toThrow("Decay is a number from 0 to 1.")
		expect((await stored(high.id)).decayRate).toBe(0.5)
	})

	test("a history entry takes a decay too, and keeps its own date rules", async () => {
		const w = await world()
		const h = await create(
			w.owner.id,
			entryOf(HISTORY_TYPE_ID, w.book.id, { year: 4, decayRate: 0.25 })
		)
		expect(h.decayRate).toBe(0.25)
		expect(h.year).toBe(4)
		await expect(
			create(w.owner.id, entryOf(HISTORY_TYPE_ID, w.book.id, { year: 4 }))
		).rejects.toThrow(/already has a history entry/)
	})
})

describe("Beginning", () => {
	for (const typeId of [
		WORLD_LORE_TYPE_ID,
		LOCATION_TYPE_ID,
		ITEM_TYPE_ID,
		CHARACTER_LORE_TYPE_ID
	]) {
		test(`${typeId}: stored on create, moved and cleared on update`, async () => {
			const w = await world()
			const made = await create(
				w.owner.id,
				entryOf(typeId, w.book.id, { year: 5, month: 2, day: 3 })
			)
			expect(made).toMatchObject({ year: 5, month: 2, day: 3 })
			expect((await stored(made.id)).fields).toMatchObject({
				year: 5,
				month: 2,
				day: 3
			})

			const moved = await update(w.owner.id, typeId, made.id, { year: 6 })
			expect(moved).toMatchObject({ year: 6, month: 2, day: 3 })

			const cleared = await update(w.owner.id, typeId, made.id, {
				year: null,
				month: null,
				day: null
			})
			expect(cleared).toMatchObject({
				year: null,
				month: null,
				day: null
			})
			const fields = (await stored(made.id)).fields as Record<
				string,
				unknown
			>
			expect("year" in fields).toBe(false)

			const perpetual = await create(
				w.owner.id,
				entryOf(typeId, w.book.id)
			)
			expect(perpetual).toMatchObject({
				year: null,
				month: null,
				day: null
			})
			const set = await update(w.owner.id, typeId, perpetual.id, {
				year: 1
			})
			expect(set.year).toBe(1)
		})
	}

	test("a malformed beginning is refused with the sentence", async () => {
		const w = await world()
		await expect(
			create(
				w.owner.id,
				entryOf(WORLD_LORE_TYPE_ID, w.book.id, { month: 2 })
			)
		).rejects.toThrow("A beginning needs a year.")
		await expect(
			create(
				w.owner.id,
				entryOf(WORLD_LORE_TYPE_ID, w.book.id, { year: 2.5 })
			)
		).rejects.toThrow("whole numbers")
		await expect(
			create(
				w.owner.id,
				entryOf(WORLD_LORE_TYPE_ID, w.book.id, { year: 2, day: 3 })
			)
		).rejects.toThrow("A beginning with a day needs a month too.")
	})

	test("a date that does not land in the book's calendar is refused", async () => {
		const w = await world({ calendar: THAW })
		await expect(
			create(
				w.owner.id,
				entryOf(WORLD_LORE_TYPE_ID, w.book.id, {
					year: 2,
					month: 1,
					day: 31
				})
			)
		).rejects.toThrow(/calendar/)
		const ok = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id, {
				year: 2,
				month: 1,
				day: 30
			})
		)
		await expect(
			update(w.owner.id, WORLD_LORE_TYPE_ID, ok.id, { day: 31 })
		).rejects.toThrow(/calendar/)
	})

	test("a day a history entry holds is accepted, and so is a second entry on one day", async () => {
		const w = await world()
		await create(
			w.owner.id,
			entryOf(HISTORY_TYPE_ID, w.book.id, { year: 7, month: 1, day: 1 })
		)
		const a = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id, {
				year: 7,
				month: 1,
				day: 1
			})
		)
		const b = await create(
			w.owner.id,
			entryOf(LOCATION_TYPE_ID, w.book.id, { year: 7, month: 1, day: 1 })
		)
		const c = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id)
		)
		const cMoved = await update(w.owner.id, WORLD_LORE_TYPE_ID, c.id, {
			year: 7,
			month: 1,
			day: 1
		})
		expect([a.year, b.year, cMoved.year]).toEqual([7, 7, 7])
	})

	test("Timeline off: setting is refused with the sentence, clearing and decay are allowed", async () => {
		const w = await world({ timelineEnabled: false })
		await expect(
			create(
				w.owner.id,
				entryOf(WORLD_LORE_TYPE_ID, w.book.id, { year: 3 })
			)
		).rejects.toThrow(TIMELINE_OFF_SENTENCES.dated)
		const made = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id, { decayRate: 0.4 })
		)
		await expect(
			update(w.owner.id, WORLD_LORE_TYPE_ID, made.id, { year: 3 })
		).rejects.toThrow(TIMELINE_OFF_SENTENCES.dated)
		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: { year: 3 } })
			.where(eq(schema.lorebookEntries.id, made.id))
		const cleared = await update(w.owner.id, WORLD_LORE_TYPE_ID, made.id, {
			year: null,
			month: null,
			day: null,
			decayRate: 0.6
		})
		expect(cleared).toMatchObject({ year: null, decayRate: 0.6 })
		// Resending the stored beginning is not a move.
		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: { year: 3 } })
			.where(eq(schema.lorebookEntries.id, made.id))
		expect(
			(await update(w.owner.id, WORLD_LORE_TYPE_ID, made.id, { year: 3 }))
				.year
		).toBe(3)
	})

	test("a beginning later than an existing dated change is refused, naming both dates", async () => {
		const w = await world()
		const made = await create(
			w.owner.id,
			entryOf(WORLD_LORE_TYPE_ID, w.book.id, { year: 2 })
		)
		const { amendmentsCreateHandler } = await import("./amendments")
		await amendmentsCreateHandler.handler(
			socket(w.owner.id),
			{
				lorebookId: w.book.id,
				entryId: made.id,
				year: 3,
				fields: { content: "Later." }
			} as any,
			(() => {}) as any
		)
		await expect(
			update(w.owner.id, WORLD_LORE_TYPE_ID, made.id, { year: 5 })
		).rejects.toThrow(
			`This entry has a change dated ${formatDate({ year: 3, month: null, day: null })}, so it can't begin later, at ${formatDate({ year: 5, month: null, day: null })}. Move or delete that change first.`
		)
		expect((await stored(made.id)).fields).toMatchObject({ year: 2 })
		const ok = await update(w.owner.id, WORLD_LORE_TYPE_ID, made.id, {
			year: 3
		})
		expect(ok.year).toBe(3)
	})

	test("a first beginning past a fork is refused when that line links to the entry", async () => {
		const w = await world()
		const place = await create(w.owner.id, entryOf(WORLD_LORE_TYPE_ID, w.book.id, {}))
		const other = await create(w.owner.id, entryOf(WORLD_LORE_TYPE_ID, w.book.id, {}))
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: "What if", forkedFromBranchId: null, forkYear: 4 })
			.returning()
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: w.book.id,
			branchId: fork!.id,
			fromEntryId: place.id,
			toEntryId: other.id,
			relationshipType: "leads to"
		})
		await expect(
			update(w.owner.id, WORLD_LORE_TYPE_ID, place.id, { year: 6 })
		).rejects.toThrow(/cannot move past/)
		expect((await stored(place.id)).fields?.year ?? null).toBeNull()
		const ok = await update(w.owner.id, WORLD_LORE_TYPE_ID, place.id, { year: 3 })
		expect(ok.year).toBe(3)
	})
})

describe("the timeline counts", () => {
	test("count the Beginnings, and a book whose only dated row is one holds something dated", async () => {
		const w = await world()
		expect(await holdsSomethingDated(testDb as any, w.book.id)).toBe(false)
		await create(w.owner.id, entryOf(WORLD_LORE_TYPE_ID, w.book.id))
		await create(w.owner.id, entryOf(ITEM_TYPE_ID, w.book.id, { year: 1 }))
		expect(await timelineCountsOf(testDb as any, w.book.id)).toMatchObject({
			beginnings: 1,
			historyEntries: 0,
			datedChanges: 0
		})
		expect(await holdsSomethingDated(testDb as any, w.book.id)).toBe(true)
		await create(
			w.owner.id,
			entryOf(HISTORY_TYPE_ID, w.book.id, { year: 2 })
		)
		expect(
			(await timelineCountsOf(testDb as any, w.book.id)).beginnings
		).toBe(1)
	})
})
