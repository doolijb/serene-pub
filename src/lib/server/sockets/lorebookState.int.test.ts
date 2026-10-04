/**
 * A place's stats, set in the lorebook before play (plan places-graph L4;
 * owner answer Q5, 2026-09-29: "put the key in the crypt").
 *
 * `lorebookState:get` / `lorebookState:set` read and write the DURABLE layer
 * of a place (owner kind `location`, `session_id` NULL) with no session: what
 * every session on the book inherits until it changes the value itself. The
 * write stands where the editor reads — its line (`branch_id`) and a date the
 * SERVER picks (`history_entry_id`: the history entry dated the moment, else
 * the date of the value it changes) — and only the book's owner may make it
 * (B0's book-owner rule, `assertBookOwner`). Which value holds is story date,
 * never write order (L4 review).
 *
 * Limited as ruled: the core inventory, and the stats the book already
 * records for places. Nothing else is offered, and a write naming anything
 * else is refused.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, getAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import {
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID
} from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lorebook-state-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const INVENTORY = "core:slot/inventory@1"
/** A place stat no genre carries: offered only once the book records it for a place. */
const LAMPS = "test:slot/l4-lamps@1"
/** A place stat the book never records: never offered. */
const DRAUGHT = "test:slot/l4-draught@1"
/** A cast stat: never a place's. */
const NERVE = "test:slot/l4-nerve@1"

function declareSlots() {
	if (!getAttributeSlot(LAMPS))
		defineAttributeSlot(LAMPS, {
			type: "integer",
			label: { en: "Lamps lit" },
			descriptor: "How many lamps burn here.",
			appliesTo: ["location"],
			config: { min: 0, max: 6 }
		})
	if (!getAttributeSlot(DRAUGHT))
		defineAttributeSlot(DRAUGHT, {
			type: "integer",
			label: { en: "Draught" },
			descriptor: "How cold the air moves.",
			appliesTo: ["location"]
		})
	if (!getAttributeSlot(NERVE))
		defineAttributeSlot(NERVE, {
			type: "integer",
			label: { en: "Nerve" },
			descriptor: "How steady they are.",
			appliesTo: ["cast"]
		})
}

type Emitted = { event: string; data: any }

function caller(userId: number) {
	const out: Emitted[] = []
	const socket = {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) }
	} as any
	const emit = (event: string, data: any) => {
		out.push({ event, data })
	}
	return { socket, emit, out }
}

let n = 0

async function world() {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `l4-owner-${suffix}`)
	const guest = await createTestUser(testDb, `l4-guest-${suffix}`)
	const [book, elsewhere] = await testDb
		.insert(schema.lorebooks)
		.values([
			{ userId: user.id, name: `Keep ${suffix}` },
			{ userId: user.id, name: `Elsewhere ${suffix}` }
		])
		.returning()
	let position = 0
	const entry = async (
		lorebookId: number,
		title: string | null,
		typeId: string,
		over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({ lorebookId, typeId, typeVersion: 1, position: position++, title, content: "…", ...over })
				.returning()
		)[0]!
	const crypt = await entry(book!.id, "The Crypt", LOCATION_TYPE_ID)
	const harbor = await entry(book!.id, "Harbor", LOCATION_TYPE_ID)
	const key = await entry(book!.id, "Rusty key", ITEM_TYPE_ID)
	const farKey = await entry(elsewhere!.id, "Far key", ITEM_TYPE_ID)
	const farPlace = await entry(elsewhere!.id, "Far Tower", LOCATION_TYPE_ID)
	const y3 = await entry(book!.id, null, HISTORY_TYPE_ID, { fields: { year: 3 } })
	const y7 = await entry(book!.id, null, HISTORY_TYPE_ID, { fields: { year: 7 } })
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}` })
		.returning()
	const [farFork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: elsewhere!.id, name: `Far fork ${suffix}` })
		.returning()
	const GENRE = `test:genre/l4-${suffix}`
	genre(GENRE, {
		name: { en: "Rooms" },
		family: "test",
		slots: [getAttributeSlot(INVENTORY)!],
		customAttributes: "deny",
		events: {}
	})
	const session = async () =>
		(
			await testDb
				.insert(schema.sessions)
				.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE, lorebookId: book!.id })
				.returning()
		)[0]!
	return { user, guest, book: book!, elsewhere: elsewhere!, crypt, harbor, key, farKey, farPlace, y3, y7, fork: fork!, farFork: farFork!, session }
}

type World = Awaited<ReturnType<typeof world>>

const at = (w: World, placeId: number, over: Record<string, unknown> = {}) => ({
	lorebookId: w.book.id,
	owner: { kind: "location" as const, id: placeId },
	branchId: null,
	moment: null,
	...over
})

async function get(userId: number, params: Record<string, unknown>) {
	const { lorebookStateGet } = await import("./lorebookState")
	const c = caller(userId)
	try {
		const res = await lorebookStateGet.handler(c.socket, params as any, c.emit)
		return { res: res as Sockets.LorebookState.Get.Response, out: c.out, error: null as string | null }
	} catch (e) {
		const refusal = c.out.find((o) => o.event === "lorebookState:get:error")
		return { res: null, out: c.out, error: refusal?.data?.error ?? (e as Error).message }
	}
}

async function set(userId: number, params: Record<string, unknown>) {
	const { lorebookStateSet } = await import("./lorebookState")
	const c = caller(userId)
	try {
		const res = await lorebookStateSet.handler(c.socket, params as any, c.emit)
		return { res: res as Sockets.LorebookState.Set.Response, out: c.out, error: null as string | null }
	} catch (e) {
		const refusal = c.out.find((o) => o.event === "lorebookState:set:error")
		return { res: null, out: c.out, error: refusal?.data?.error ?? (e as Error).message }
	}
}

const placeRows = (placeId: number) =>
	testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "location"), eq(schema.attributeValues.ownerId, placeId)))

const db = () => testDb as unknown as Db

describe("lorebookState:get — a place's stats, as the book holds them", () => {
	test("offers the inventory, and only the place stats the book records", async () => {
		const w = await world()
		let read = await get(w.user.id, at(w, w.crypt.id))
		expect(read.error).toBeNull()
		expect(read.res!.slots.map((s) => s.slotId)).toEqual([INVENTORY])
		expect(read.res!.values).toEqual({})
		expect(read.res!.slots[0]).toMatchObject({ label: "Inventory", type: "list", appliesTo: expect.arrayContaining(["location"]) })

		// The book records Lamps for another place: now it is a place stat of
		// this book, and the crypt is offered it too. Draught and Nerve never.
		await testDb.insert(schema.attributeValues).values({ ownerKind: "location", ownerId: w.harbor.id, slotId: LAMPS, value: { v: 2 } })
		read = await get(w.user.id, at(w, w.crypt.id))
		expect(read.res!.slots.map((s) => s.slotId)).toEqual([INVENTORY, LAMPS])
		expect(read.res!.configs[LAMPS]).toMatchObject({ min: 0, max: 6 })
		// The reply names what it answers, so a tab can match it.
		expect(read.out.find((o) => o.event === "lorebookState:get")?.data).toMatchObject({
			lorebookId: w.book.id,
			owner: { kind: "location", id: w.crypt.id }
		})
	})

	test("only the book's owner reads it; a place of another book is not this book's", async () => {
		const w = await world()
		expect((await get(w.guest.id, at(w, w.crypt.id))).error).toBe("Lorebook not found.")
		expect((await get(w.user.id, at(w, w.farPlace.id))).error).toMatch(/not a place of this lorebook/)
		// An item is not a place.
		expect((await get(w.user.id, at(w, w.key.id))).error).toMatch(/not a place of this lorebook/)
		// Only a place's stats are set here (🚧 L4).
		expect((await get(w.user.id, { ...at(w, w.crypt.id), owner: { kind: "lorebook", id: w.book.id } })).error).toMatch(
			/Only a place's stats/
		)
	})
})

describe("lorebookState:set — put the key in the crypt", () => {
	test("writes the durable layer, and every session on the book reads it until it changes it", async () => {
		const w = await world()
		const s1 = await w.session()
		const s2 = await w.session()
		const wrote = await set(w.user.id, {
			...at(w, w.crypt.id),
			slotId: INVENTORY,
			value: [{ entryId: w.key.id }],
			requestId: "r1"
		})
		expect(wrote.error).toBeNull()
		// The reply is the fresh read, named, with the writer's request id.
		expect(wrote.res!.values[INVENTORY]).toEqual([{ entryId: w.key.id, name: "Rusty key" }])
		expect(wrote.out.find((o) => o.event === "lorebookState:set")?.data.requestId).toBe("r1")

		const [row] = await placeRows(w.crypt.id)
		expect(row).toMatchObject({
			ownerKind: "location",
			slotId: INVENTORY,
			sessionId: null,
			validFromMessageId: null,
			branchId: null,
			historyEntryId: null,
			updatedBy: "user"
		})
		expect(row!.value).toEqual({ v: [{ entryId: w.key.id }] })

		const { valueOf } = await import("$lib/server/state/resolve")
		const inPlay = (sessionId: number) =>
			valueOf(db(), { sessionId, owner: { kind: "session_location", id: w.crypt.id }, slotId: INVENTORY })
		expect(await inPlay(s1.id)).toEqual([{ entryId: w.key.id }])
		expect(await inPlay(s2.id)).toEqual([{ entryId: w.key.id }])

		// A session that takes the key has its own layer; the other still
		// finds it where the book put it.
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(
			db(),
			{ sessionId: s1.id, updatedBy: "user" },
			{ owner: { kind: "session_location", id: w.crypt.id }, slotId: INVENTORY, op: "remove", items: [{ entryId: w.key.id }] }
		)
		expect(await inPlay(s1.id)).toEqual([])
		expect(await inPlay(s2.id)).toEqual([{ entryId: w.key.id }])
		// And the book's own value did not move.
		expect((await get(w.user.id, at(w, w.crypt.id))).res!.values[INVENTORY]).toEqual([
			{ entryId: w.key.id, name: "Rusty key" }
		])
	})

	test("null clears the book's value, so it reads as not set", async () => {
		const w = await world()
		await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern"] })
		const cleared = await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: null })
		expect(cleared.error).toBeNull()
		expect(cleared.res!.values).toEqual({})
	})

	test("only the book's owner writes it (B0), and nothing lands for anyone else", async () => {
		const w = await world()
		const refused = await set(w.guest.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["gold"] })
		expect(refused.error).toBe("Lorebook not found.")
		expect(await placeRows(w.crypt.id)).toEqual([])

		// The state layer holds the same rule on its own, whoever calls it.
		const { setPlaceStat } = await import("$lib/server/state/placeStats")
		await expect(
			setPlaceStat(db(), {
				lorebookId: w.book.id,
				placeId: w.crypt.id,
				slotId: INVENTORY,
				value: ["gold"],
				branchId: null,
				moment: null,
				userId: w.guest.id
			})
		).rejects.toThrow(/not your lorebook/)
		expect(await placeRows(w.crypt.id)).toEqual([])
	})

	test("refuses a stat the book does not keep for places, a cast stat, and a value out of bounds", async () => {
		const w = await world()
		const put = (slotId: string, value: unknown) =>
			set(w.user.id, { ...at(w, w.crypt.id), slotId, value })
		expect((await put(DRAUGHT, 2)).error).toMatch(/not a stat this lorebook keeps for places/)
		expect((await put(NERVE, 2)).error).toMatch(/not a stat this lorebook keeps for places/)
		await testDb.insert(schema.attributeValues).values({ ownerKind: "location", ownerId: w.harbor.id, slotId: LAMPS, value: { v: 2 } })
		expect((await put(LAMPS, 9)).error).toBeTruthy()
		expect((await put(LAMPS, 4)).error).toBeNull()
		expect(await placeRows(w.crypt.id)).toHaveLength(1)
	})

	test("an item from another book, or an archived one, cannot lie here", async () => {
		const w = await world()
		const put = (value: unknown) =>
			set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value })
		expect((await put([{ entryId: w.farKey.id }])).error).toMatch(/not in this lorebook/)
		await testDb.update(schema.lorebookEntries).set({ archived: true }).where(eq(schema.lorebookEntries.id, w.key.id))
		expect((await put([{ entryId: w.key.id }])).error).toMatch(/archived/)
		expect(await placeRows(w.crypt.id)).toEqual([])
	})

	test("an archived place takes nothing", async () => {
		const w = await world()
		await testDb.update(schema.lorebookEntries).set({ archived: true }).where(eq(schema.lorebookEntries.id, w.crypt.id))
		const refused = await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["x"] })
		expect(refused.error).toMatch(/not a place of this lorebook/)
	})
})

describe("the line and the moment, as the place editor reads them", () => {
	test("a value set on a branch stays on that branch", async () => {
		const w = await world()
		const wrote = await set(w.user.id, {
			...at(w, w.crypt.id, { branchId: w.fork.id }),
			slotId: INVENTORY,
			value: ["a silver bell"]
		})
		expect(wrote.error).toBeNull()
		expect(wrote.res!.branchId).toBe(w.fork.id)
		const [row] = await placeRows(w.crypt.id)
		expect(row!.branchId).toBe(w.fork.id)
		expect((await get(w.user.id, at(w, w.crypt.id, { branchId: w.fork.id }))).res!.values[INVENTORY]).toEqual(["a silver bell"])
		// Main never sees the branch's row.
		expect((await get(w.user.id, at(w, w.crypt.id))).res!.values).toEqual({})
		// Another book's branch is not a line of this one.
		const foreign = await set(w.user.id, {
			...at(w, w.crypt.id, { branchId: w.farFork.id }),
			slotId: INVENTORY,
			value: ["x"]
		})
		expect(foreign.error).toMatch(/not a branch of lorebook/)
	})

	test("at a moment, the value is dated by that history entry, and reads from then on", async () => {
		const w = await world()
		const wrote = await set(w.user.id, {
			...at(w, w.crypt.id, { moment: { year: 7, month: null, day: null } }),
			slotId: INVENTORY,
			value: ["a snuffed candle"]
		})
		expect(wrote.error).toBeNull()
		expect(wrote.res!.writeDatedBy).toEqual({ historyEntryId: w.y7.id, date: { year: 7, month: null, day: null } })
		expect(wrote.res!.heldSince).toEqual({ [INVENTORY]: { year: 7, month: null, day: null } })
		const [row] = await placeRows(w.crypt.id)
		expect(row!.historyEntryId).toBe(w.y7.id)
		const readAt = async (year: number | null) =>
			(await get(w.user.id, at(w, w.crypt.id, { moment: year === null ? null : { year, month: null, day: null } }))).res!
				.values[INVENTORY]
		expect(await readAt(3)).toBeUndefined()
		expect(await readAt(7)).toEqual(["a snuffed candle"])
		expect(await readAt(null)).toEqual(["a snuffed candle"])
	})

	test("the server dates a write — a date the caller sends is not read", async () => {
		const w = await world()
		// A branch's own Year 5, and nothing on main dated Year 5.
		const [branchY5] = await testDb
			.insert(schema.lorebookEntries)
			.values({ lorebookId: w.book.id, typeId: HISTORY_TYPE_ID, typeVersion: 1, position: 99, content: "…", fields: { year: 5 }, branchId: w.fork.id })
			.returning()
		const y5 = { moment: { year: 5, month: null, day: null } }
		// At now, "dated Year 7" by the caller: undated all the same.
		expect((await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["x"], historyEntryId: w.y7.id })).error).toBeNull()
		// On main at Year 5, the branch's Year 5 is not a date main has: undated.
		const onMain = await set(w.user.id, { ...at(w, w.crypt.id, y5), slotId: INVENTORY, value: ["y"] })
		expect(onMain.res!.writeDatedBy).toBeNull()
		// On the branch, it is.
		const onBranch = await set(w.user.id, { ...at(w, w.crypt.id, { ...y5, branchId: w.fork.id }), slotId: INVENTORY, value: ["z"] })
		expect(onBranch.res!.writeDatedBy?.historyEntryId).toBe(branchY5!.id)
		const rows = (await placeRows(w.crypt.id)).sort((a, b) => a.id - b.id)
		expect(rows.map((r) => [r.branchId, r.historyEntryId])).toEqual([
			[null, null],
			[null, null],
			[w.fork.id, branchY5!.id]
		])
	})
})

describe("which value holds when — story date, never write order (L4 review)", () => {
	const Y = (year: number) => ({ moment: { year, month: null, day: null } })

	test("a change holds from its date on, whenever it was written; at now it keeps the value's date", async () => {
		const w = await world()
		const late = await w.session()
		const early = (
			await testDb
				.insert(schema.sessions)
				.values({ userId: w.user.id, isGroup: false, name: "At Year 3", genreId: late.genreId, lorebookId: w.book.id, storyClockYear: 3 })
				.returning()
		)[0]!
		const readAt = async (year: number | null) =>
			(await get(w.user.id, at(w, w.crypt.id, year === null ? {} : Y(year)))).res!.values[INVENTORY]
		const put = async (over: Record<string, unknown>, value: unknown) => {
			const readValue = (await get(w.user.id, at(w, w.crypt.id, over))).res!.values[INVENTORY] ?? null
			const wrote = await set(w.user.id, { ...at(w, w.crypt.id, over), slotId: INVENTORY, value, readValue })
			expect(wrote.error).toBeNull()
			return wrote.res!
		}
		const key = { entryId: w.key.id }
		const named = { entryId: w.key.id, name: "Rusty key" }

		// 1. The key, at now: undated, from the start.
		await put({}, [key])
		// 2. As of Year 7, the lamp: dated Year 7.
		await put(Y(7), [key, "brass lamp"])
		expect([await readAt(3), await readAt(7), await readAt(null)]).toEqual([[named], [named, "brass lamp"], [named, "brass lamp"]])

		// 3. At now, a candle. By write order it was undated and won
		// everywhere — the Year 7 lamp showed at Year 3. It keeps the date of
		// the value it changes (Year 7), so it holds from Year 7 on.
		const candle = await put({}, [key, "brass lamp", "candle"])
		expect(candle.heldSince[INVENTORY]).toEqual({ year: 7, month: null, day: null })
		expect(await readAt(3)).toEqual([named])
		expect(await readAt(7)).toEqual([named, "brass lamp", "candle"])
		expect(await readAt(null)).toEqual([named, "brass lamp", "candle"])

		// 4. As of Year 3, a coin: dated Year 3. By write order it hid Year 7
		// and now; the later-dated value still holds from its date.
		await put(Y(3), [key, "coin"])
		expect(await readAt(3)).toEqual([named, "coin"])
		expect(await readAt(7)).toEqual([named, "brass lamp", "candle"])
		expect(await readAt(null)).toEqual([named, "brass lamp", "candle"])

		// 5. At Year 5, which nothing is dated: the value in force there is
		// Year 3's, and the change keeps that date.
		const rope = await put(Y(5), [key, "coin", "rope"])
		expect(rope.writeDatedBy).toBeNull()
		expect(await readAt(3)).toEqual([named, "coin", "rope"])
		expect(await readAt(7)).toEqual([named, "brass lamp", "candle"])

		// Sessions inherit by the same rule, at their story clock.
		const { valueOf } = await import("$lib/server/state/resolve")
		const inPlay = (sessionId: number) =>
			valueOf(db(), { sessionId, owner: { kind: "session_location", id: w.crypt.id }, slotId: INVENTORY })
		expect(await inPlay(early.id)).toEqual([key, "coin", "rope"])
		expect(await inPlay(late.id)).toEqual([key, "brass lamp", "candle"])

		expect((await placeRows(w.crypt.id)).map((r) => r.historyEntryId).sort()).toEqual(
			[null, w.y7.id, w.y7.id, w.y3.id, w.y3.id].sort()
		)
	})

	test("a write made from a value that has moved since is refused, and nothing lands", async () => {
		const w = await world()
		const first = await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern"], readValue: null })
		expect(first.error).toBeNull()
		// Another tab adds a lamp…
		await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern", "lamp"], readValue: ["lantern"] })
		// …and this one, still showing ["lantern"], adds gold.
		const stale = await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern", "gold"], readValue: ["lantern"] })
		expect(stale.error).toMatch(/Inventory changed since this was read, so nothing was saved/)
		expect((await get(w.user.id, at(w, w.crypt.id))).res!.values[INVENTORY]).toEqual(["lantern", "lamp"])
		expect(await placeRows(w.crypt.id)).toHaveLength(2)
		// A lore reference's read-in name does not count as a change.
		await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: [{ entryId: w.key.id, count: 2 }] })
		const byName = await set(w.user.id, {
			...at(w, w.crypt.id),
			slotId: INVENTORY,
			value: [],
			readValue: [{ entryId: w.key.id, count: 2, name: "Rusty key" }]
		})
		expect(byName.error).toBeNull()
	})

	test("two writes made from the same read at once: one lands, the other is refused (plan A22)", async () => {
		const w = await world()
		expect((await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern"], readValue: null })).error).toBeNull()
		// Two tabs, both showing ["lantern"], save at the same moment.
		const [a, b] = await Promise.all([
			set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern", "lamp"], readValue: ["lantern"] }),
			set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern", "gold"], readValue: ["lantern"] })
		])
		expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1)
		expect([a.error, b.error].find((e) => e !== null)).toMatch(/changed since this was read, so nothing was saved/)
		expect(await placeRows(w.crypt.id)).toHaveLength(2)
	})
})

describe("what a place's inventory holds (L4 review)", () => {
	test("never a place — itself included — or a history entry", async () => {
		const w = await world()
		const put = (value: unknown) => set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value })
		expect((await put([{ entryId: w.harbor.id }])).error).toMatch(/'Harbor' is a place, so it cannot lie in one/)
		expect((await put([{ entryId: w.crypt.id }])).error).toMatch(/'The Crypt' is a place/)
		expect((await put([{ entryId: w.y3.id }])).error).toMatch(/is a history entry/)
		expect(await placeRows(w.crypt.id)).toEqual([])
	})

	test("nothing bigger than a stat of a place holds", async () => {
		const w = await world()
		const { PLACE_STAT_MAX_CHARS, PLACE_STAT_MAX_ITEMS } = await import("$lib/server/state/placeStats")
		const put = (value: unknown) => set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value })
		const many = Array.from({ length: PLACE_STAT_MAX_ITEMS + 1 }, (_, i) => `item ${i}`)
		expect((await put(many)).error).toMatch(/too much for Inventory/)
		expect((await put(["x".repeat(PLACE_STAT_MAX_CHARS)])).error).toMatch(/too much for Inventory/)
		expect(await placeRows(w.crypt.id)).toEqual([])
		expect((await put(many.slice(0, PLACE_STAT_MAX_ITEMS))).error).toBeNull()
	})
})

describe("deleting the book (B0's open item; L4 review)", () => {
	test("takes the book's stats with it — its places', its world's and its cast's — on every line", async () => {
		const w = await world()
		const other = await world()
		await set(w.user.id, { ...at(w, w.crypt.id), slotId: INVENTORY, value: ["lantern"] })
		await set(w.user.id, { ...at(w, w.crypt.id, { branchId: w.fork.id }), slotId: INVENTORY, value: ["bell"] })
		const s = await w.session()
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: w.book.id, binding: "{{char:1}}", name: "Maren" })
			.returning()
		await testDb.insert(schema.attributeValues).values([
			{ ownerKind: "lorebook", ownerId: w.book.id, slotId: LAMPS, value: { v: 1 } },
			{ ownerKind: "cast_member", ownerId: binding!.id, slotId: NERVE, value: { v: 2 } },
			{ ownerKind: "session_location", ownerId: w.crypt.id, slotId: INVENTORY, value: { v: [] }, sessionId: s.id }
		])
		await set(other.user.id, { ...at(other, other.crypt.id), slotId: INVENTORY, value: ["kept"] })

		const { lorebooksDeleteHandler } = await import("./lorebooks")
		const c = caller(w.user.id)
		await lorebooksDeleteHandler.handler(c.socket, { id: w.book.id }, c.emit)

		const left = await testDb.select().from(schema.attributeValues)
		const ofBook = left.filter(
			(r) =>
				(r.ownerKind === "lorebook" && r.ownerId === w.book.id) ||
				(r.ownerKind === "cast_member" && r.ownerId === binding!.id) ||
				((r.ownerKind === "location" || r.ownerKind === "session_location") && r.ownerId === w.crypt.id)
		)
		expect(ofBook).toEqual([])
		// Another book's place keeps its stats.
		expect((await placeRows(other.crypt.id)).map((r) => r.value)).toEqual([{ v: ["kept"] }])
	})
})

describe("a failure the handler did not word (plan A24 leftover)", () => {
	/** A lorebook id past `integer`: the ownership read itself fails, as a query. */
	const PAST_INTEGER = 99_999_999_999

	test("a read whose query fails is answered in a sentence that names the request", async () => {
		const w = await world()
		const c = caller(w.user.id)
		const { lorebookStateGet } = await import("./lorebookState")
		await expect(
			lorebookStateGet.handler(
				c.socket,
				{ ...at(w, w.crypt.id), lorebookId: PAST_INTEGER, requestId: "r-read" } as any,
				c.emit
			)
		).rejects.toThrow()
		const refusals = c.out.filter((o) => o.event === "lorebookState:get:error")
		expect(refusals).toEqual([
			{
				event: "lorebookState:get:error",
				data: { lorebookId: PAST_INTEGER, requestId: "r-read", error: "This place's stats could not be read." }
			}
		])
	})

	test("a write whose query fails is answered in a sentence that names the request, once", async () => {
		const w = await world()
		const c = caller(w.user.id)
		const { lorebookStateSet } = await import("./lorebookState")
		await expect(
			lorebookStateSet.handler(
				c.socket,
				{ ...at(w, w.crypt.id), lorebookId: PAST_INTEGER, requestId: "r-write", slotId: INVENTORY, value: ["gold"] } as any,
				c.emit
			)
		).rejects.toThrow()
		expect(c.out.filter((o) => o.event === "lorebookState:set:error")).toEqual([
			{
				event: "lorebookState:set:error",
				data: { lorebookId: PAST_INTEGER, requestId: "r-write", error: "The stat could not be saved." }
			}
		])
	})

	test("a refusal the handler words still reaches the tab once, naming the request", async () => {
		const w = await world()
		const c = caller(w.guest.id)
		const { lorebookStateGet } = await import("./lorebookState")
		await expect(
			lorebookStateGet.handler(c.socket, { ...at(w, w.crypt.id), requestId: "r-guest" } as any, c.emit)
		).rejects.toThrow("Lorebook not found.")
		expect(c.out.filter((o) => o.event === "lorebookState:get:error")).toEqual([
			{
				event: "lorebookState:get:error",
				data: { lorebookId: w.book.id, requestId: "r-guest", error: "Lorebook not found." }
			}
		])
	})

	test("a write that landed and could not be read back still tells the book's sessions", async () => {
		const w = await world()
		const s1 = await w.session()
		const c = caller(w.user.id)
		const stats = await import("$lib/server/state/placeStats")
		const real = stats.placeStatsFor
		const spy = vi.spyOn(stats, "placeStatsFor").mockImplementation(async (...args: Parameters<typeof real>) => {
			if (args[0] === (testDb as unknown)) throw new Error("connection reset")
			return real(...args)
		})
		const helpers = await import("./utils/broadcastHelpers")
		const told: Array<{ sessionId: number; event: string }> = []
		const broadcast = vi
			.spyOn(helpers, "broadcastToSessionUsers")
			.mockImplementation(async (_io, sessionId, event) => {
				told.push({ sessionId, event })
			})
		try {
			const { lorebookStateSet } = await import("./lorebookState")
			await expect(
				lorebookStateSet.handler(
					c.socket,
					{ ...at(w, w.crypt.id), requestId: "r-told", slotId: INVENTORY, value: ["gold"] } as any,
					c.emit
				)
			).rejects.toThrow()
		} finally {
			spy.mockRestore()
			broadcast.mockRestore()
		}
		// The value is on the book: a session that has not changed it reads it now.
		expect(told).toEqual([{ sessionId: s1.id, event: "state:changed" }])
	})

	test("a write that landed and could not be read back says it was saved", async () => {
		const w = await world()
		const c = caller(w.user.id)
		const stats = await import("$lib/server/state/placeStats")
		const real = stats.placeStatsFor
		// The write reads the place inside its own transaction; the read after
		// it — the reply's, on the outer handle — is the one that fails.
		const spy = vi.spyOn(stats, "placeStatsFor").mockImplementation(async (...args: Parameters<typeof real>) => {
			if (args[0] === (testDb as unknown)) throw new Error("connection reset")
			return real(...args)
		})
		try {
			const { lorebookStateSet } = await import("./lorebookState")
			await expect(
				lorebookStateSet.handler(
					c.socket,
					{ ...at(w, w.crypt.id), requestId: "r-landed", slotId: INVENTORY, value: ["gold"] } as any,
					c.emit
				)
			).rejects.toThrow()
		} finally {
			spy.mockRestore()
		}
		expect(await placeRows(w.crypt.id)).toHaveLength(1)
		expect(c.out.filter((o) => o.event === "lorebookState:set:error")).toEqual([
			{
				event: "lorebookState:set:error",
				data: {
					lorebookId: w.book.id,
					requestId: "r-landed",
					error: "The stat was saved, but this place's stats could not be read back. Reopen the place to see them."
				}
			}
		])
	})
})
