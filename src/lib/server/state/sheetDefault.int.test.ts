/**
 * F2 — a sheet entry's `default` is part of the chain. What a sheet says a
 * slot "starts at" (SDK `SheetSlotEntry.default`, "this sheet's deviation
 * from the declaration's own default") is the answer below every owner layer
 * and above the declaration's own default, for every owner kind: a seat
 * (session_cast → cast_member → card), the world (session → lorebook) and a
 * place (session_location → location). Mirrors `configFor`, where the sheet's
 * `config` is the furthest layer and the declaration is under it.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSheet,
	defineAttributeSlot,
	genre,
	getAttributeSlot,
	_clearAttributeSheets,
	_clearAttributeSlots
} from "@serene-pub/sdk"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-sheetdefault-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "test:slot/grit@1"
const MOOD = "test:slot/temper@1"
const WEATHER = "test:slot/skies@1"
const DUST = "test:slot/dust@1"
const LOCATION = "core:entry/location"

function declareSlots() {
	_clearAttributeSlots()
	_clearAttributeSheets()
	defineAttributeSlot(HP, {
		type: "integer",
		label: { en: "Grit" },
		descriptor: "How much fight is left.",
		appliesTo: ["cast"],
		config: { min: 0, max: 40 },
		default: 10
	})
	defineAttributeSlot(MOOD, {
		type: "text",
		label: { en: "Temper" },
		descriptor: "How they are taking it.",
		appliesTo: ["cast"],
		default: "calm"
	})
	defineAttributeSlot(WEATHER, {
		type: "text",
		label: { en: "Skies" },
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		default: "clear"
	})
	defineAttributeSlot(DUST, {
		type: "integer",
		label: { en: "Dust" },
		descriptor: "How long since anyone swept.",
		appliesTo: ["location"],
		config: { min: 0, max: 10 },
		default: 1
	})
}

let n = 0
/** A session whose genre carries one sheet: HP 25, weather rain, dust 7; MOOD named with no default. */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-sheetdefault-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const sheet = defineAttributeSheet(`test:sheet/grim-${suffix}@1`, {
		label: { en: "Grim" },
		slots: [
			{ id: HP, default: 25 },
			{ id: MOOD },
			{ id: WEATHER, default: "rain" },
			{ id: DUST, default: 7 }
		]
	})
	const GENRE = `test:genre/sheetdefault-${suffix}`
	genre(GENRE, {
		name: { en: "Grim" },
		family: "test",
		sheets: [sheet],
		slots: [HP, MOOD, WEATHER, DUST].map((id) => getAttributeSlot(id)!),
		customAttributes: "deny",
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE, lorebookId: lorebook.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session.id, characterId: verity.id })
	const [crypt] = await testDb
		.insert(schema.lorebookEntries)
		.values({ lorebookId: lorebook.id, typeId: LOCATION, typeVersion: 1, position: 0, title: "The Crypt", content: "…", fields: {} })
		.returning()
	return { user, verity, lorebook, session, crypt }
}

const db = () => testDb as unknown as Db
const seat = (id: number) => ({ kind: "session_cast" as const, id })
const place = (id: number) => ({ kind: "session_location" as const, id })

describe("a sheet entry's default", () => {
	test("shows when nothing is set, for a seat, the world and a place", async () => {
		declareSlots()
		const w = await world()
		const { stateFor, valueOf } = await import("$lib/server/state/resolve")
		const s = w.session.id
		expect(await valueOf(db(), { sessionId: s, owner: seat(w.verity.id), slotId: HP })).toBe(25)
		expect(await valueOf(db(), { sessionId: s, owner: { kind: "session", id: s }, slotId: WEATHER })).toBe("rain")
		expect(await valueOf(db(), { sessionId: s, owner: place(w.crypt.id), slotId: DUST })).toBe(7)

		const state = await stateFor(db(), s)
		expect(state.world.skies).toBe("rain")
		expect((state.cast.byId[String(w.verity.id)] as Record<string, unknown>).grit).toBe(25)
		expect((state.locations.byId[String(w.crypt.id)] as Record<string, unknown>).dust).toBe(7)
	})

	test("the slot's own default is used only when the sheet names the slot without one", async () => {
		declareSlots()
		const w = await world()
		const { stateFor, valueOf } = await import("$lib/server/state/resolve")
		expect(await valueOf(db(), { sessionId: w.session.id, owner: seat(w.verity.id), slotId: MOOD })).toBe("calm")
		const state = await stateFor(db(), w.session.id)
		expect((state.cast.byId[String(w.verity.id)] as Record<string, unknown>).temper).toBe("calm")
		// Outside a session there is no sheet in force: the declaration answers.
		expect(await valueOf(db(), { owner: { kind: "card", id: w.verity.id }, slotId: HP })).toBe(10)
	})

	test("is overridden by a value written at ANY layer above it", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor, valueOf } = await import("$lib/server/state/resolve")
		const s = w.session.id
		const read = (owner: Parameters<typeof valueOf>[1]["owner"], slotId: string) =>
			valueOf(db(), { sessionId: s, owner, slotId })

		// Template layers: the card, the lorebook, the location entry.
		await testDb.insert(schema.attributeValues).values([
			{ ownerKind: "card", ownerId: w.verity.id, slotId: HP, value: { v: 30 }, updatedBy: "user" },
			{ ownerKind: "lorebook", ownerId: w.lorebook.id, slotId: WEATHER, value: { v: "fog" }, updatedBy: "user" },
			{ ownerKind: "location", ownerId: w.crypt.id, slotId: DUST, value: { v: 3 }, updatedBy: "user" }
		])
		expect(await read(seat(w.verity.id), HP)).toBe(30)
		expect(await read({ kind: "session", id: s }, WEATHER)).toBe("fog")
		expect(await read(place(w.crypt.id), DUST)).toBe(3)

		// The session layer over those.
		const ctx = { sessionId: s, updatedBy: "user" }
		await applyChange(db(), ctx, { owner: seat(w.verity.id), slotId: HP, op: "set", value: 5 })
		await applyChange(db(), ctx, { owner: place(w.crypt.id), slotId: DUST, op: "set", value: 0 })
		expect(await read(seat(w.verity.id), HP)).toBe(5)
		// A zero is a value, not an absence: the sheet's 7 must not come back.
		expect(await read(place(w.crypt.id), DUST)).toBe(0)

		const state = await stateFor(db(), s)
		expect((state.cast.byId[String(w.verity.id)] as Record<string, unknown>).grit).toBe(5)
		expect(state.world.skies).toBe("fog")
		expect((state.locations.byId[String(w.crypt.id)] as Record<string, unknown>).dust).toBe(0)
	})
})
