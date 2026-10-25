/**
 * 🚧 **Attribute carries** (RF fix 2, item 3, 2026-10-23): one holder's
 * switch for one of the rules' attributes. Off, the attribute is not shown
 * (the holder's sheet configs leave it out), not read (their bag holds no
 * key, the rules' owner view has no stat) and not written (a write is
 * refused); what it held comes back when it is on again. An attribute the
 * rules mark `required` cannot be switched off. Also the free text kind
 * (item 2): a text slot, its default read into the bag, read by the rules as
 * a sentence of its own.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineRuleset, genre, getRuleset, rulesetAttributeSlotId } from "@serene-pub/sdk"
import { qualifiedSlotKey } from "./keys"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const RULESET = "test:ruleset/carry-int@1"
const GENRE = "test:genre/carry-int"
const NERVE = rulesetAttributeSlotId(RULESET, "nerve")
const VOW = rulesetAttributeSlotId(RULESET, "vow")
const HEART = rulesetAttributeSlotId(RULESET, "heart")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-carry-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	defineRuleset(RULESET, {
		name: { en: "Carry" },
		attributes: [
			{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 5 }, start: 3, carriedBy: ["cast"], prose: "Nerve: courage held in reserve." },
			{ id: "vow", name: { en: "Vow" }, kind: "text", start: "To see the sea once", carriedBy: ["cast"], prose: "Vow: what someone has sworn to do." },
			{ id: "heart", name: { en: "Heart" }, kind: "number", start: 2, carriedBy: ["cast"], required: true, prose: "Heart: what keeps someone going." }
		]
	})
	genreKeeping(GENRE, { name: { en: "Carry" }, family: "test", slots: [], events: {} })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `carry-int-${++n}`)
	const chars = await db
		.insert(schema.characters)
		.values(["Wren", "Mara"].map((name) => ({ userId: user.id, name, description: `${name}.` })))
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: "Pier", genreId: GENRE, primaryRuleset: RULESET, rigour: "mechanics" })
		.returning()
	await db.insert(schema.sessionCharacters).values(chars.map((c) => ({ sessionId: session!.id, characterId: c.id })))
	const [wren, mara] = chars as [(typeof chars)[0], (typeof chars)[0]]
	return { user, session: session!, wren, mara }
}

describe("attribute carries", () => {
	test("off: not shown, not read, not written — and back on, what it held comes back", async () => {
		const { stateFor } = await import("./resolve")
		const { setValue, StateRefusal } = await import("./write")
		const { setAttributeCarry, carryableAttributes } = await import("./carries")
		const w = await world()
		const wren = { kind: "session_cast" as const, id: w.wren.id }
		const plays = [RULESET]
		expect([...carryableAttributes(plays).keys()].sort()).toEqual([HEART, NERVE, VOW].sort())

		await setValue(db as any, { sessionId: w.session.id, updatedBy: "user" }, { owner: wren, slotId: NERVE, value: 1 })
		let state = await stateFor(db as any, w.session.id)
		expect(state.cast.byId[String(w.wren.id)]![qualifiedSlotKey(NERVE)]).toBe(1)
		expect(state.notCarried).toBeUndefined()

		expect(await setAttributeCarry(db as any, { sessionId: w.session.id, owner: wren, slotId: NERVE, carries: false, plays, by: "user:1" })).toEqual({ ok: true })
		state = await stateFor(db as any, w.session.id)
		const bag = state.cast.byId[String(w.wren.id)]!
		expect(qualifiedSlotKey(NERVE) in bag).toBe(false)
		expect(state.notCarried).toEqual({ [String(w.wren.id)]: [NERVE] })
		expect(Object.keys(state.configs?.[String(w.wren.id)] ?? {})).not.toContain(NERVE)
		// Mara still carries it.
		expect(state.cast.byId[String(w.mara.id)]![qualifiedSlotKey(NERVE)]).toBe(3)

		// Not read by the rules either.
		const { ownerViews } = await import("$lib/server/rulesets/read")
		const views = await ownerViews(db as any, state, getRuleset(RULESET)!, [{ key: `character:${w.wren.id}`, owner: wren, facet: "cast" }])
		expect(views[0]!.stats.map((s) => s.slotId).sort()).toEqual([HEART, VOW].sort())
		// 🚧 Item 2: the free text attribute is read as a sentence of its own.
		expect(views[0]!.stats.find((s) => s.slotId === VOW)).toMatchObject({ prose: true, value: "To see the sea once" })
		const { proseSentence } = await import("$lib/server/rulesets/engine")
		expect(proseSentence(views[0]!.stats.find((s) => s.slotId === VOW)!.value)).toBe("To see the sea once.")

		// Not written.
		await expect(setValue(db as any, { sessionId: w.session.id, updatedBy: "user" }, { owner: wren, slotId: NERVE, value: 2 })).rejects.toBeInstanceOf(StateRefusal)

		// Back on: the value it held.
		await setAttributeCarry(db as any, { sessionId: w.session.id, owner: wren, slotId: NERVE, carries: true, plays, by: "user:1" })
		state = await stateFor(db as any, w.session.id)
		expect(state.cast.byId[String(w.wren.id)]![qualifiedSlotKey(NERVE)]).toBe(1)
		expect(state.notCarried).toBeUndefined()
	})

	test("a required attribute is never switched off; an owner kind it is never carried by is refused", async () => {
		const { setAttributeCarry } = await import("./carries")
		const { stateFor } = await import("./resolve")
		const w = await world()
		const wren = { kind: "session_cast" as const, id: w.wren.id }
		const plays = [RULESET]
		expect(await setAttributeCarry(db as any, { sessionId: w.session.id, owner: wren, slotId: HEART, carries: false, plays, by: "user:1" })).toEqual({ refused: "Everyone carries Heart: the rules require it." })
		expect(await setAttributeCarry(db as any, { sessionId: w.session.id, owner: { kind: "session", id: w.session.id }, slotId: NERVE, carries: false, plays, by: "user:1" })).toEqual({ refused: "Nerve is never carried there." })
		expect(await setAttributeCarry(db as any, { sessionId: w.session.id, owner: wren, slotId: "core:slot/mood@1", carries: false, plays, by: "user:1" })).toEqual({ refused: "That is not an attribute these rules give anyone to carry." })
		// A stray row saying no to a required attribute is not believed.
		await db.insert(schema.attributeCarries).values({ sessionId: w.session.id, ownerKind: "session_cast", ownerId: w.wren.id, slotId: HEART, carries: false })
		const state = await stateFor(db as any, w.session.id)
		expect(state.cast.byId[String(w.wren.id)]![qualifiedSlotKey(HEART)]).toBe(2)
		expect(state.notCarried).toBeUndefined()
	})

	test("a session's carries go with it", async () => {
		const { setAttributeCarry, carryRowsOf } = await import("./carries")
		const w = await world()
		await setAttributeCarry(db as any, { sessionId: w.session.id, owner: { kind: "session_cast", id: w.mara.id }, slotId: VOW, carries: false, plays: [RULESET], by: "user:1" })
		expect((await carryRowsOf(db as any, w.session.id)).get(String(w.mara.id))?.get(VOW)).toBe(false)
		const { eq } = await import("drizzle-orm")
		await db.delete(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect((await carryRowsOf(db as any, w.session.id)).size).toBe(0)
	})
})
