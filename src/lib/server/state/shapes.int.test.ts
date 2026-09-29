/**
 * Attributes phase 2 — stat shapes through the one write gate
 * (DESIGN-attributes-shapes): each catalogue shape validates, stores in the
 * SAME `attribute_values` rows, resolves, and carries its shape in the
 * session's vocabulary. A list's lore references are stored as ids and read
 * back named.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	attributeSlots,
	defineAttributeSlot,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
// Core's catalogue: declaring a shape registers it, and a slot naming one
// needs it registered first.
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-shapes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const BAG = "test:slot/bag@1"
const CLOCK = "test:slot/clock@1"
const WEATHER = "test:slot/weather@1"
const RATIO = "test:slot/ratio@1"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(BAG, {
		shape: "core:stat-shape/list@1",
		descriptor: "What the party carries.",
		appliesTo: ["world"],
		config: { maxItems: 4 }
	})
	defineAttributeSlot(CLOCK, {
		shape: "core:stat-shape/story-time@1",
		descriptor: "Where the story clock stands.",
		appliesTo: ["world"]
	})
	defineAttributeSlot(WEATHER, {
		shape: "core:stat-shape/choice@1",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "rain"] }
	})
	defineAttributeSlot(RATIO, {
		shape: { type: "number", min: 0, max: 1 },
		descriptor: "How close the hunt is.",
		appliesTo: ["world"],
		default: 0
	})
}

let n = 0
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-shapes-${suffix}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const GENRE = `test:genre/shapes-${suffix}`
	genre(GENRE, { name: { en: "Shapes" }, family: "test", slots: attributeSlots(), events: {} })
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE })
		.returning()
	await testDb
		// The real shape: the lorebook is the session row's own binding.
		.update(schema.sessions)
		.set({ lorebookId: lorebook.id })
		.where(eq(schema.sessions.id, session.id))
	const [sword] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: lorebook.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 0,
			title: "The Sword",
			content: "Notched."
		})
		.returning()
	return { user, session, sword }
}

const db = () => testDb as unknown as Db
const worldOwner = (sessionId: number) => ({ kind: "session" as const, id: sessionId })

async function storedValues(sessionId: number, slotId: string) {
	const rows = await testDb
		.select({ value: schema.attributeValues.value })
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, sessionId),
				eq(schema.attributeValues.slotId, slotId)
			)
		)
		.orderBy(schema.attributeValues.id)
	return rows.map((r) => r.value.v)
}

describe("stat shapes through the one write gate", () => {
	test("the vocabulary carries each slot's shape and field", async () => {
		declareSlots()
		const w = await world()
		const { vocabularyFor } = await import("$lib/server/state/resolve")
		const vocab = await vocabularyFor(db(), w.session.id)
		const by = Object.fromEntries(vocab.slots.map((s) => [s.id, s]))
		expect(by[BAG]).toMatchObject({
			type: "list",
			shape: "core:stat-shape/list@1",
			field: { type: "list", item: { type: "string" } }
		})
		expect(by[CLOCK]).toMatchObject({
			type: "text",
			shape: "core:stat-shape/story-time@1",
			field: { type: "string", format: "story-time" }
		})
		expect(by[WEATHER]).toMatchObject({ type: "enum", shape: "core:stat-shape/choice@1" })
		// An inline field names no catalogue shape, and still carries its field.
		expect(by[RATIO].shape).toBeUndefined()
		expect(by[RATIO].field).toEqual({ type: "number", min: 0, max: 1 })
	}, 60_000)

	test("a list stores lore references as ids and resolves them named", async () => {
		declareSlots()
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		await setValue(
			db(),
			{ sessionId: w.session.id, updatedBy: "user" },
			{
				owner: worldOwner(w.session.id),
				slotId: BAG,
				// A name a read filled in, written back as the widget saw it.
				value: ["rope", { entryId: w.sword.id, name: "Stale title" }, "lamp"]
			}
		)
		expect(await storedValues(w.session.id, BAG)).toEqual([
			["rope", { entryId: w.sword.id }, "lamp"]
		])
		const state = await stateFor(db(), w.session.id)
		expect(state.world.test_bag).toEqual([
			"rope",
			{ entryId: w.sword.id, name: "The Sword" },
			"lamp"
		])
		// The bare key reads the same, named, value.
		expect(state.world.bag).toEqual(state.world.test_bag)
	}, 60_000)

	test("list ops add and remove a lore reference by its entry; the limit refuses", async () => {
		declareSlots()
		const w = await world()
		const { setValue, StateRefusal } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const owner = worldOwner(w.session.id)
		await setValue(db(), ctx, { owner, slotId: BAG, op: "add", items: ["rope", { entryId: w.sword.id }] })
		await setValue(db(), ctx, { owner, slotId: BAG, op: "add", items: [{ entryId: w.sword.id, name: "x" }] })
		expect(await valueOf(db(), { sessionId: w.session.id, owner, slotId: BAG })).toEqual([
			"rope",
			{ entryId: w.sword.id }
		])
		await setValue(db(), ctx, { owner, slotId: BAG, op: "remove", items: [{ entryId: w.sword.id }] })
		expect(await valueOf(db(), { sessionId: w.session.id, owner, slotId: BAG })).toEqual(["rope"])
		await expect(
			setValue(db(), ctx, { owner, slotId: BAG, value: ["a", "b", "c", "d", "e"] })
		).rejects.toThrow(StateRefusal)
	}, 60_000)

	test("a story time takes the canonical line and refuses anything else", async () => {
		declareSlots()
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const owner = worldOwner(w.session.id)
		await setValue(db(), ctx, { owner, slotId: CLOCK, value: "412-03-05 22:30" })
		await expect(
			setValue(db(), ctx, { owner, slotId: CLOCK, value: "yesterday" })
		).rejects.toThrow(/story time/)
		expect(await storedValues(w.session.id, CLOCK)).toEqual(["412-03-05 22:30"])
	}, 60_000)

	test("a choice holds to its set; a `number` field keeps its fraction through a delta", async () => {
		declareSlots()
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const owner = worldOwner(w.session.id)
		await setValue(db(), ctx, { owner, slotId: WEATHER, value: "rain" })
		await expect(
			setValue(db(), ctx, { owner, slotId: WEATHER, value: "hail" })
		).rejects.toThrow(/one of clear, rain/)
		await setValue(db(), ctx, { owner, slotId: RATIO, op: "add", value: 0.25 })
		await setValue(db(), ctx, { owner, slotId: RATIO, op: "add", value: 0.5 })
		expect(await valueOf(db(), { sessionId: w.session.id, owner, slotId: RATIO })).toBe(0.75)
		await expect(
			setValue(db(), ctx, { owner, slotId: RATIO, op: "add", value: 0.5 })
		).rejects.toThrow(/above 1/)
	}, 60_000)
})
