/**
 * A session's new entry takes its Beginning and Decay from the layers: the
 * writing step's params over the entry type's defaults. Driven through the
 * real create outlet, on both routes; a match, a person's create and a refused
 * param are the contrast.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0
/** The message the latest `hostOf` made: the turn a write belongs to. */
let lastMessageId = 0

const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
type Clock = { year: number; month: number; day: number }
const DAY: Clock = { year: 10, month: 2, day: 5 }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-entry-defaults-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(
	opts: {
		mode?: "full" | "review"
		clock?: Clock | null
		timeline?: boolean
	} = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `entry-defaults-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			timelineEnabled: opts.timeline ?? true
		})
		.returning()
	const clock = opts.clock === undefined ? DAY : opts.clock
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			...(clock
				? {
						storyClockYear: clock.year,
						storyClockMonth: clock.month,
						storyClockDay: clock.day
					}
				: {})
		})
		.returning()
	return { user, book: book!, session: session!, suffix }
}
type World = Awaited<ReturnType<typeof world>>

async function hostOf(w: World) {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: w.session.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: w.session.id, role: "assistant" })
	lastMessageId = legacy!.id
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(
		db as unknown as Db,
		{
			sessionId: w.session.id,
			userId: w.user.id,
			runId: `run-${++n}`
		} as any
	)
}

const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const rowOf = async (id: number) => {
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	return toEntryRow(await stored(id)) as any
}
const entriesIn = (lorebookId: number) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))

const write = async (
	w: World,
	entryType: string,
	params: Record<string, unknown> = {},
	extra: Record<string, unknown> = {}
) => {
	const host = await hostOf(w)
	return (await host.commit!(
		{
			name: `Thing ${++n}`,
			content: "A thing.",
			params: { entryType, ...params },
			...(entryType === HISTORY_TYPE_ID
				? { fields: { year: 3, month: 2, day: 9 } }
				: {}),
			...extra
		},
		CREATE
	)) as any
}

const BEGAN = { year: 10, month: 2, day: 5 }
const PERPETUAL = { year: null, month: null, day: null }

describe("Full, Timeline on, clock at a date", () => {
	it("an Item begins at the session's date with Decay 0; world lore is perpetual, 0; history is created as before", async () => {
		const w = await world()
		const item = await write(w, ITEM_TYPE_ID)
		expect(item.route).toBe("book")
		expect(await rowOf(item.id)).toMatchObject({ ...BEGAN, decayRate: 0 })
		const lore = await write(w, WORLD_LORE_TYPE_ID)
		expect(await rowOf(lore.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0
		})
		const day = await write(w, HISTORY_TYPE_ID)
		expect(await stored(day.id ?? day.entryId)).toMatchObject({
			typeId: HISTORY_TYPE_ID,
			lorebookId: w.book.id
		})
	})

	it("the step's params win, per field", async () => {
		const w = await world()
		const lore = await write(w, WORLD_LORE_TYPE_ID, {
			defaultBeginning: "began",
			defaultDecayRate: 0.3
		})
		expect(await rowOf(lore.id)).toMatchObject({ ...BEGAN, decayRate: 0.3 })
		const item = await write(w, ITEM_TYPE_ID, {
			defaultBeginning: "perpetual"
		})
		expect(await rowOf(item.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0
		})
		const onlyRate = await write(w, ITEM_TYPE_ID, { defaultDecayRate: 0.6 })
		expect(await rowOf(onlyRate.id)).toMatchObject({
			...BEGAN,
			decayRate: 0.6
		})
	})
})

describe("without a date", () => {
	it("Timeline off: no date, and a step's rate still applies", async () => {
		const w = await world({ timeline: false })
		const item = await write(w, ITEM_TYPE_ID, { defaultDecayRate: 0.4 })
		expect(await rowOf(item.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0.4
		})
	})
	it("Timeline on with no clock and no date at all in the lorebook (undatable): no date", async () => {
		const w = await world({ clock: null })
		const item = await write(w, ITEM_TYPE_ID)
		expect(await rowOf(item.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0
		})
	})
})

describe("Timeline on, no clock, but dated history", () => {
	it("an Item begins at the newest history date; world lore stays perpetual", async () => {
		const w = await world({ clock: null })
		for (const [i, fields] of [
			{ year: 3, month: 2, day: 9 },
			{ year: 7, month: 4, day: 1 }
		].entries())
			await db.insert(schema.lorebookEntries).values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: i + 1,
				title: null,
				content: "…",
				fields
			})
		const item = await write(w, ITEM_TYPE_ID)
		expect(await rowOf(item.id)).toMatchObject({
			year: 7,
			month: 4,
			day: 1,
			decayRate: 0
		})
		const itemTurn = lastMessageId
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, itemTurn, "leaves", {
				leavingWith: [itemTurn]
			})
		)
		expect(undone.changed).toBe(true)
		expect(await entriesIn(w.book.id).then((r) => r.some((e) => e.id === item.id))).toBe(false)
		const lore = await write(w, WORLD_LORE_TYPE_ID)
		expect(await rowOf(lore.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0
		})
	})
})

describe("Review changes, then Apply", () => {
	it("lands in the session's own book with the same values, and keeps them once moved", async () => {
		const w = await world({ mode: "review" })
		const out = await write(w, ITEM_TYPE_ID, { defaultDecayRate: 0.5 })
		expect(out.route).toBe("own-book")
		expect(out.lorebookId).not.toBe(w.book.id)
		expect(await rowOf(out.id)).toMatchObject({ ...BEGAN, decayRate: 0.5 })
		expect(await entriesIn(w.book.id)).toHaveLength(0)

		const { applyOverlayItems } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		await applyOverlayItems(db as unknown as Db, {
			sessionId: w.session.id,
			userId: w.user.id
		})
		const moved = (await entriesIn(w.book.id)).filter(
			(r) => r.typeId === ITEM_TYPE_ID
		)
		expect(moved).toHaveLength(1)
		expect(await rowOf(moved[0]!.id)).toMatchObject({
			...BEGAN,
			decayRate: 0.5
		})
	})
})

describe("untouched paths", () => {
	it("a person's new Item is perpetual, 0", async () => {
		const w = await world()
		const { entryInsert, nextPosition } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		const [row] = await db
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: ITEM_TYPE_ID,
					lorebookId: w.book.id,
					name: "Mine",
					content: "A person's.",
					position: await nextPosition(
						db as any,
						w.book.id,
						ITEM_TYPE_ID
					)
				} as any)
			)
			.returning()
		expect(await rowOf(row!.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0
		})
	})

	it("a match that changes an existing entry leaves its Beginning and Decay", async () => {
		const w = await world()
		const [existing] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				position: 1,
				title: "Mira",
				content: "A baker.",
				fields: {},
				decayRate: 0.2
			})
			.returning()
		const out = await write(
			w,
			WORLD_LORE_TYPE_ID,
			{ defaultBeginning: "began", defaultDecayRate: 0.9 },
			{
				name: "Mira",
				content: "A baker, now a widow.",
				match: { name: "Mira" },
				shown: [existing!.id]
			}
		)
		expect(out).toMatchObject({ entryId: existing!.id, matched: true })
		expect(await rowOf(existing!.id)).toMatchObject({
			...PERPETUAL,
			decayRate: 0.2
		})
	})
})

describe("refusals", () => {
	it("a rate of 2 writes nothing and says the sentence", async () => {
		const w = await world()
		await expect(
			write(w, ITEM_TYPE_ID, { defaultDecayRate: 2 })
		).rejects.toThrow(
			"file: A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living entry."
		)
		expect(await entriesIn(w.book.id)).toHaveLength(0)
	})
	it("a Beginning default other than perpetual or began, and one on history", async () => {
		const w = await world()
		await expect(
			write(w, ITEM_TYPE_ID, { defaultBeginning: "born" })
		).rejects.toThrow(
			"born is not a Beginning default. Say 'perpetual' or 'began', or leave it empty."
		)
		await expect(
			write(w, HISTORY_TYPE_ID, { defaultBeginning: "began" })
		).rejects.toThrow(
			"History entries carry their own date, so defaultBeginning does nothing here. Leave it empty."
		)
		expect(await entriesIn(w.book.id)).toHaveLength(0)
	})
})
