/**
 * Attributes phase 4 — locations hold stats (DESIGN-attributes-shapes; owner
 * ruling 2026-09-25 "locations must support stats"). A `core:entry/location`
 * lore entry is an owner: `location` (the entry, durable) under
 * `session_location` (this run's layer, same entry id). Values are the same
 * per-slot, message-anchored rows through the same doors; what a place tracks
 * is the session's vocabulary (genre baseline + picks), refused otherwise;
 * items lying in a place are its `inventory`, moved by the list ops, counted by
 * the item supply, and written back to the entry by `recordToTimeline`.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, getAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-locations-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const BAG = "test:slot/stash@1"
const HP = "test:slot/vigour@1"
const LOCATION = "core:entry/location"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(BAG, {
		shape: "core:stat-shape/list@1",
		label: { en: "Stash" },
		descriptor: "What is held, or lying there.",
		appliesTo: ["cast", "world", "location"]
	})
	defineAttributeSlot(HP, {
		type: "integer",
		label: { en: "Vigour" },
		descriptor: "How much fight is left.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 10
	})
}

let n = 0
/**
 * A session in a world with two places, a character and an item. `slots` is
 * the genre's baseline; `custom` whether the genre lets a session add more.
 */
async function world(opts: { slots?: string[]; custom?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-locations-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [lorebook, elsewhere] = await testDb
		.insert(schema.lorebooks)
		.values([
			{ userId: user.id, name: `World ${suffix}` },
			{ userId: user.id, name: `Elsewhere ${suffix}` }
		])
		.returning()
	const GENRE = `test:genre/locations-${suffix}`
	genre(GENRE, {
		name: { en: "Places" },
		family: "test",
		slots: (opts.slots ?? [BAG, HP]).map((id) => getAttributeSlot(id)!),
		customAttributes: opts.custom ? "allow" : "deny",
		events: {}
	})
	const session = await newSession(user.id, GENRE, lorebook.id, verity.id, suffix)
	let position = 0
	const entry = (lorebookId: number, title: string, typeId: string, fields: Record<string, unknown> = {}) =>
		testDb
			.insert(schema.lorebookEntries)
			.values({ lorebookId, typeId, typeVersion: 1, position: position++, title, content: "…", fields })
			.returning()
			.then((r) => r[0]!)
	const crypt = await entry(lorebook.id, "The Crypt", LOCATION)
	const harbor = await entry(lorebook.id, "Harbor", LOCATION)
	const key = await entry(lorebook.id, "Rusty key", "core:entry/item", { supply: "limited", supplyLimit: 3 })
	const foreignPlace = await entry(elsewhere.id, "Far Tower", LOCATION)
	return { user, verity, lorebook, session, crypt, harbor, key, foreignPlace, GENRE, suffix }
}

async function newSession(userId: number, genreId: string, lorebookId: number, characterId: number, name: string) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `Run ${name}`, genreId, lorebookId })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session.id, characterId })
	return session
}

const db = () => testDb as unknown as Db
const place = (id: number) => ({ kind: "session_location" as const, id })
const castOwner = (id: number) => ({ kind: "session_cast" as const, id })

describe("a location is an owner", () => {
	test("a value written on a place reads back through valueOf and stateFor.locations", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor, valueOf } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await applyChange(db(), ctx, { owner: place(w.crypt.id), slotId: BAG, op: "add", items: ["lantern", { entryId: w.key.id, count: 2 }] })

		expect(await valueOf(db(), { sessionId: w.session.id, owner: place(w.crypt.id), slotId: BAG })).toEqual([
			{ entryId: w.key.id, count: 2 },
			"lantern"
		])
		// Stored on the session layer, by the entry's id.
		const [row] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.ownerKind, "session_location"), eq(schema.attributeValues.ownerId, w.crypt.id)))
		expect(row?.sessionId).toBe(w.session.id)

		const state = await stateFor(db(), w.session.id)
		const crypt = state.locations.byId[String(w.crypt.id)] as Record<string, unknown>
		expect(crypt).toMatchObject({ id: w.crypt.id, key: "the_crypt", name: "The Crypt" })
		expect(crypt.stash).toEqual([{ entryId: w.key.id, count: 2, name: "Rusty key" }, "lantern"])
		// The slug index is the same object.
		expect(state.locations.the_crypt).toBe(crypt)
		// A cast-only slot never lands on a place; the other place is listed, empty.
		expect(crypt.vigour).toBeUndefined()
		expect(state.locations.byId[String(w.harbor.id)]).toMatchObject({ name: "Harbor" })
		expect((state.locations.byId[String(w.harbor.id)] as Record<string, unknown>).stash).toBeUndefined()
	})

	test("a place inherits its entry's durable value, and the session layer wins over it", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "location",
			ownerId: w.harbor.id,
			slotId: BAG,
			value: { v: ["nets"] }
		})
		const read = () => valueOf(db(), { sessionId: w.session.id, owner: place(w.harbor.id), slotId: BAG })
		expect(await read()).toEqual(["nets"])
		await applyChange(db(), { sessionId: w.session.id, updatedBy: "user" }, { owner: place(w.harbor.id), slotId: BAG, op: "add", items: ["crab pot"] })
		expect(await read()).toEqual(["nets", "crab pot"])
	})

	test("a session with no slot a place carries lists no places at all", async () => {
		declareSlots()
		const w = await world({ slots: [HP] })
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db(), w.session.id)
		expect(state.locations).toEqual({ byId: {} })
	})
})

describe("the doors gate a place like any owner", () => {
	test("a slot the session does not track is refused on a place", async () => {
		declareSlots()
		const w = await world({ slots: [HP] })
		const { applyChange, proposeChange } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const change = { owner: place(w.crypt.id), slotId: BAG, op: "add" as const, items: ["lantern"] }
		await expect(applyChange(db(), ctx, change)).rejects.toThrow(/not tracked in this session/)
		await expect(proposeChange(db(), ctx, change)).rejects.toThrow(/not tracked in this session/)
	})

	test("a pick brings a slot in for places, as for everyone (genre allows custom)", async () => {
		declareSlots()
		const w = await world({ slots: [HP], custom: true })
		const { applyChange } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const change = { owner: place(w.crypt.id), slotId: BAG, op: "add" as const, items: ["lantern"] }
		await expect(applyChange(db(), ctx, change)).rejects.toThrow(/not tracked/)
		await testDb.insert(schema.sessionAttributePicks).values({ sessionId: w.session.id, slotId: BAG, enabled: true })
		await applyChange(db(), ctx, change)
	})

	test("a cast-only slot does not apply to a place", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		await expect(
			applyChange(db(), { sessionId: w.session.id, updatedBy: "user" }, { owner: place(w.crypt.id), slotId: HP, value: 5 })
		).rejects.toThrow(/does not apply to session_location/)
	})

	test("a place must be a live location of this session's lorebook", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const add = (id: number) => applyChange(db(), ctx, { owner: place(id), slotId: BAG, op: "add", items: ["x"] })
		await expect(add(w.foreignPlace.id)).rejects.toThrow(/not a location in this session's lorebook/)
		// An item entry is not a place.
		await expect(add(w.key.id)).rejects.toThrow(/not a location in this session's lorebook/)
		await testDb.update(schema.lorebookEntries).set({ archived: true }).where(eq(schema.lorebookEntries.id, w.harbor.id))
		await expect(add(w.harbor.id)).rejects.toThrow(/not a location in this session's lorebook/)
	})
})

describe("items lying in a place", () => {
	test("give: taken from the place, added to a character, through the inventory list ops", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const read = (owner: { kind: "session_location" | "session_cast"; id: number }) =>
			valueOf(db(), { sessionId: w.session.id, owner, slotId: BAG })
		await applyChange(db(), ctx, { owner: place(w.crypt.id), slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 2 }] })
		// Picked up: one fewer in the crypt, one in her pocket.
		await applyChange(db(), ctx, { owner: place(w.crypt.id), slotId: BAG, op: "remove", items: [{ entryId: w.key.id, count: 1 }] })
		await applyChange(db(), ctx, { owner: castOwner(w.verity.id), slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 1 }] })
		// One held is stored bare — the one spelling of a single item.
		expect(await read(place(w.crypt.id))).toEqual([{ entryId: w.key.id }])
		expect(await read(castOwner(w.verity.id))).toEqual([{ entryId: w.key.id }])
		// Dropped back: the place holds two again, she holds none.
		await applyChange(db(), ctx, { owner: castOwner(w.verity.id), slotId: BAG, op: "remove", items: [{ entryId: w.key.id, count: 1 }] })
		await applyChange(db(), ctx, { owner: place(w.crypt.id), slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 1 }] })
		expect(await read(place(w.crypt.id))).toEqual([{ entryId: w.key.id, count: 2 }])
		expect(await read(castOwner(w.verity.id))).toEqual([])
	})

	test("the item supply counts what lies in a place", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await applyChange(db(), ctx, { owner: place(w.harbor.id), slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 2 }] })
		await applyChange(db(), ctx, { owner: castOwner(w.verity.id), slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 1 }] })
		const [key] = await itemSupplyFor(db(), w.session.id, [w.key.id])
		expect(key).toMatchObject({ held: 3, limit: 3, remaining: 0 })
		expect(key!.holders).toEqual(
			expect.arrayContaining([
				{ ownerKind: "session_location", ownerId: w.harbor.id, slotId: BAG, count: 2 },
				{ ownerKind: "session_cast", ownerId: w.verity.id, slotId: BAG, count: 1 }
			])
		)
	})

	test("a keeper names a place by its title", async () => {
		declareSlots()
		const w = await world()
		const { ownerFor } = await import("$lib/server/pipelines/runtime/tools/stateTools")
		const ctx = { sessionId: w.session.id, read: async () => [] } as never
		expect(await ownerFor(ctx, "the crypt")).toEqual(place(w.crypt.id))
		await expect(ownerFor(ctx, "Far Tower")).rejects.toThrow(/nobody called 'Far Tower'/)
	})
})

describe("write-back to the lorebook", () => {
	test("recording files a place's values against its entry, and the next session inherits them", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const { valueOf } = await import("$lib/server/state/resolve")
		await applyChange(db(), { sessionId: w.session.id, updatedBy: "user" }, { owner: place(w.crypt.id), slotId: BAG, op: "add", items: ["lantern"] })

		const report = await recordToTimeline(db(), w.session.id, { reason: "mark" })
		expect(report.owners).toContain(`location:${w.crypt.id}`)
		// Nothing was said of the harbor, so nothing is recorded of it.
		expect(report.owners).not.toContain(`location:${w.harbor.id}`)
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.ownerKind, "location"), eq(schema.attributeValues.ownerId, w.crypt.id)))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ sessionId: null, sourceSessionId: w.session.id, value: { v: ["lantern"] } })

		// A later session in the same world finds the lantern where it was left.
		const next = await newSession(w.user.id, w.GENRE, w.lorebook.id, w.verity.id, `${w.suffix}-next`)
		expect(await valueOf(db(), { sessionId: next.id, owner: place(w.crypt.id), slotId: BAG })).toEqual(["lantern"])
	})
})
