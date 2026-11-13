/**
 * 🚧 World-scope writes (M0, lane T3, SHAPES F1): a slot that declares
 * `scope: 'world'` keeps its values on the book. A write from a session —
 * `set-state@1` or the socket — is re-owned onto the book the session reads
 * (`worldOwnerOf`); a session-scope slot stays on the session's layer; a
 * player's seat holds nothing that lives on the world.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-world-scope-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const SHOP_SHUT = "core:slot/shop-shut@1"
const TIRED = "core:slot/tired@1"
const AGE = "test:slot/age@1"
const LAMPS = "test:slot/lamps@1"
const GENRE = "test:genre/world-scope"

function declareSlots() {
	_clearAttributeSlots()
	const shut = defineAttributeSlot(SHOP_SHUT, {
		type: "boolean",
		descriptor: "Whether the shop is shut.",
		appliesTo: ["world"],
		scope: "world",
		default: false
	})
	const tired = defineAttributeSlot(TIRED, {
		type: "boolean",
		descriptor: "Whether the world is tired.",
		appliesTo: ["world"],
		scope: "session",
		default: false
	})
	const age = defineAttributeSlot(AGE, {
		type: "integer",
		descriptor: "How old a character is.",
		appliesTo: ["cast"],
		scope: "world"
	})
	const lamps = defineAttributeSlot(LAMPS, {
		type: "integer",
		descriptor: "How many lamps a place has lit.",
		appliesTo: ["location"],
		scope: "world"
	})
	genreKeeping(GENRE, { name: { en: "World scope" }, family: "test", slots: [shut, tired, age, lamps], events: {} })
}

let n = 0

async function world() {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `world-scope-${suffix}`)
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE, lorebookId: book!.id })
		.returning()
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
		.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: "full" } })
	return { user, book: book!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

const setState = async () => {
	const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
	return stateBindings({ runId: "run-world-scope" })["core:task/set-state@1"]!
}

const socketOf = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

const bookRows = async (w: World, slotId: string) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "lorebook"), eq(schema.attributeValues.ownerId, w.book.id), eq(schema.attributeValues.slotId, slotId)))

const sessionRows = async (w: World, slotId: string) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "session"), eq(schema.attributeValues.ownerId, w.session.id), eq(schema.attributeValues.slotId, slotId)))

const read = async (w: World, slotId: string) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as unknown as Db, { sessionId: w.session.id, owner: { kind: "session", id: w.session.id }, slotId })
}

describe("a world-scope slot is written to the book", () => {
	test("set-state of a world-scope flag lands on the lorebook owner and reads true for the session", async () => {
		const w = await world()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		const owner = await worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "session", id: w.session.id }, w.user.id)
		expect(owner).toEqual({ kind: "lorebook", id: w.book.id })
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [{ owner, slotId: SHOP_SHUT, value: true }] },
			{} as any
		)
		expect(out.value.refused ?? []).toEqual([])
		expect(await bookRows(w, SHOP_SHUT)).toHaveLength(1)
		expect(await sessionRows(w, SHOP_SHUT)).toHaveLength(0)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})

	test("a session-scope slot stays on the session layer", async () => {
		const w = await world()
		const owner = { kind: "session" as const, id: w.session.id }
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [{ owner, slotId: TIRED, value: true }] },
			{} as any
		)
		expect(out.value.refused ?? []).toEqual([])
		expect(await sessionRows(w, TIRED)).toHaveLength(1)
		expect(await bookRows(w, TIRED)).toHaveLength(0)
	})

	test("the socket write routes the same way", async () => {
		const w = await world()
		const { stateSet } = await import("$lib/server/sockets/state")
		await stateSet.handler(
			socketOf(w.user.id),
			{ sessionId: w.session.id, owner: { kind: "session", id: w.session.id }, slotId: SHOP_SHUT, value: true } as any,
			() => {}
		)
		expect(await bookRows(w, SHOP_SHUT)).toHaveLength(1)
		expect(await sessionRows(w, SHOP_SHUT)).toHaveLength(0)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})
})

describe("what has nowhere to go on the world is refused", () => {
	test("a seat write of a world-scope slot refuses with the sentence", async () => {
		const w = await world()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		await expect(worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "player_seat", id: 1 }, w.user.id)).rejects.toThrow(
			"A player's seat holds nothing that lives on the world."
		)
	})

	test("a character outside the cast refuses, and nothing is minted for them", async () => {
		const w = await world()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		await expect(worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "session_cast", id: 999_999 }, w.user.id)).rejects.toThrow(
			"that character is not in this session's cast."
		)
		expect(await bindingsOf(w.book.id)).toHaveLength(0)
		expect(await bindingsOf((await ownBookIdOf(w.session.id)) ?? -1)).toHaveLength(0)
	})

	test("a card-less player seat keeps the refusal", async () => {
		const w = await world()
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: w.session.id, personaId: null, seatName: "Nobody", userId: w.user.id } as any)
			.returning()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		await expect(worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "player_seat", id: seat!.id }, w.user.id)).rejects.toThrow(
			"A player's seat holds nothing that lives on the world."
		)
	})
})

// ---- A character the attached book does not hold: their row is the session's own book's ----

const bindingsOf = async (lorebookId: number) =>
	await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.lorebookId, lorebookId))

const ownBookIdOf = async (sessionId: number) =>
	(await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId)).limit(1))[0]?.id

const valuesOf = async (lorebookId: number) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "lorebook"), eq(schema.attributeValues.ownerId, lorebookId)))

const castValuesOf = async (memberId: number, slotId: string) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "cast_member"), eq(schema.attributeValues.ownerId, memberId), eq(schema.attributeValues.slotId, slotId)))

const allValuesOnBook = async (lorebookId: number) => {
	const members = (await bindingsOf(lorebookId)).map((m) => m.id)
	let count = 0
	for (const id of members)
		count += (await testDb.select().from(schema.attributeValues).where(and(eq(schema.attributeValues.ownerKind, "cast_member"), eq(schema.attributeValues.ownerId, id)))).length
	return count + (await valuesOf(lorebookId)).length
}

async function card(userId: number, name: string, persona = false) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name: `${name} ${++n}`, description: "", uuid: crypto.randomUUID(), isPersona: persona } as any)
		.returning()
	return row!
}

/** A member's session on a book the admin provides (a genuine `extraJson.provided` mark). */
async function memberOnProvidedBook() {
	declareSlots()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const admin = await createTestUser(testDb, `world-scope-admin-${++n}`)
	const user = await createTestUser(testDb, `world-scope-member-${n}`)
	const uuid = crypto.randomUUID()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: admin.id,
			name: `Provided ${n}`,
			uuid,
			extraJson: { provided: { plugin: `acme.world${n}`, slug: "world", version: "0.1.0", sha256: "x", uuid, entries: {} } }
		} as any)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${n}`, genreId: GENRE, lorebookId: book!.id })
		.returning()
	return { user, admin, book: book!, session: session! }
}

async function seatPersona(w: World, name = "Player") {
	const persona = await card(w.user.id, name, true)
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: w.session.id, personaId: persona.id, userId: w.user.id } as any)
		.returning()
	return { persona, seat: seat! }
}

async function seatCharacter(w: World, name = "Seated") {
	const character = await card(w.user.id, name)
	await testDb.insert(schema.sessionCharacters).values({ sessionId: w.session.id, characterId: character.id, isActive: true } as any)
	return character
}

async function writeAge(w: World, owner: { kind: any; id: number }, value: number) {
	const { worldOwnerOf } = await import("$lib/server/state/worldScope")
	const filed = await worldOwnerOf(testDb as unknown as Db, w.session.id, owner, null)
	const out: any = await (await setState())(
		{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [{ owner: filed, slotId: AGE, value }] },
		{} as any
	)
	expect(out.value.refused ?? []).toEqual([])
	return filed
}

const readAge = async (w: World, characterId: number) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as unknown as Db, { sessionId: w.session.id, owner: { kind: "session_cast", id: characterId }, slotId: AGE })
}

describe("a world-scope attribute of a character the attached book does not hold", () => {
	test("a persona's seat on a provided book lands on the own book's member and reads back", async () => {
		const w = await memberOnProvidedBook()
		const { persona, seat } = await seatPersona(w)
		const before = { bindings: (await bindingsOf(w.book.id)).length, values: await allValuesOnBook(w.book.id) }
		const filed = await writeAge(w, { kind: "player_seat", id: seat.id }, 24)
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		const rows = await bindingsOf(own!)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.characterId).toBe(persona.id)
		expect(filed).toEqual({ kind: "cast_member", id: rows[0]!.id })
		expect(await castValuesOf(rows[0]!.id, AGE)).toHaveLength(1)
		expect(await readAge(w, persona.id)).toBe(24)
		expect({ bindings: (await bindingsOf(w.book.id)).length, values: await allValuesOnBook(w.book.id) }).toEqual(before)
	})

	test("a seated character the provided book does not hold is filed the same way", async () => {
		const w = await memberOnProvidedBook()
		const hero = await seatCharacter(w)
		const before = { bindings: (await bindingsOf(w.book.id)).length, values: await allValuesOnBook(w.book.id) }
		const filed = await writeAge(w, { kind: "session_cast", id: hero.id }, 31)
		const rows = await bindingsOf((await ownBookIdOf(w.session.id))!)
		expect(rows.map((r) => r.characterId)).toEqual([hero.id])
		expect(filed).toEqual({ kind: "cast_member", id: rows[0]!.id })
		expect(await readAge(w, hero.id)).toBe(31)
		expect({ bindings: (await bindingsOf(w.book.id)).length, values: await allValuesOnBook(w.book.id) }).toEqual(before)
	})

	test("a character the attached book does hold is written on that book's member, as before", async () => {
		const w = await world()
		const hero = await seatCharacter(w)
		const { resolveOrCreateBindingRow } = await import("$lib/server/utils/characterBindingSync")
		const member = await resolveOrCreateBindingRow({ lorebookId: w.book.id, characterId: hero.id }, testDb as unknown as Db)
		const filed = await writeAge(w, { kind: "session_cast", id: hero.id }, 40)
		expect(filed).toEqual({ kind: "cast_member", id: member!.id })
		expect(await castValuesOf(member!.id, AGE)).toHaveLength(1)
		expect(await readAge(w, hero.id)).toBe(40)
		const own = await ownBookIdOf(w.session.id)
		expect(own == null ? [] : await bindingsOf(own)).toHaveLength(0)
	})

	test("a second write updates the same row and never mints a second member", async () => {
		const w = await memberOnProvidedBook()
		const { persona, seat } = await seatPersona(w)
		await writeAge(w, { kind: "player_seat", id: seat.id }, 24)
		await writeAge(w, { kind: "player_seat", id: seat.id }, 25)
		const rows = await bindingsOf((await ownBookIdOf(w.session.id))!)
		expect(rows).toHaveLength(1)
		expect(await readAge(w, persona.id)).toBe(25)
		// setValue is an append, always: the highest anchor is in force and the first write stays as evidence, so two values on one member row.
		expect(await castValuesOf(rows[0]!.id, AGE)).toHaveLength(2)
	})

	test("the socket write files it the same way", async () => {
		const w = await memberOnProvidedBook()
		const { persona } = await seatPersona(w)
		const { stateSet } = await import("$lib/server/sockets/state")
		await stateSet.handler(
			socketOf(w.user.id),
			{ sessionId: w.session.id, owner: { kind: "session_cast", id: persona.id }, slotId: AGE, value: 19 } as any,
			() => {}
		)
		expect(await bindingsOf(w.book.id)).toHaveLength(0)
		expect(await bindingsOf((await ownBookIdOf(w.session.id))!)).toHaveLength(1)
		expect(await readAge(w, persona.id)).toBe(19)
	})

	test("a session with no attached book files it on the own book's member", async () => {
		const w = await world()
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, w.session.id))
		const { persona } = await seatPersona(w)
		await writeAge(w, { kind: "session_cast", id: persona.id }, 33)
		const rows = await bindingsOf((await ownBookIdOf(w.session.id))!)
		expect(rows.map((r) => r.characterId)).toEqual([persona.id])
		expect(await readAge(w, persona.id)).toBe(33)
	})
})

// ---- m3b-V2 (★M3b-W-1/2/3, owner 2026-11-05): a session that can't write its book keeps world values in its own notes ----

/** A run's set-state apply of one change, the output left whole so a test can read `applied` / `proposed` / `refused`. */
async function applyOne(w: World, owner: { kind: any; id: number }, slotId: string, value: unknown) {
	const out: any = await (await setState())(
		{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [{ owner, slotId, value }] },
		{} as any
	)
	return out.value as { applied: unknown[]; proposed: unknown[]; refused?: string[] }
}

const proposalsOf = async (sessionId: number) =>
	await testDb.select().from(schema.stateProposals).where(eq(schema.stateProposals.sessionId, sessionId))

const setMode = async (userId: number, mode: "full" | "review" | "off") =>
	await testDb
		.insert(schema.userSettings)
		.values({ userId, loreWriteMode: mode })
		.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: mode } })

const worldOwner = async (sessionId: number, owner: { kind: any; id: number }, userId: number | null) => {
	const { worldOwnerOf } = await import("$lib/server/state/worldScope")
	return await worldOwnerOf(testDb as unknown as Db, sessionId, owner, userId)
}

describe("a session that can't write its book keeps world values in its own notes", () => {
	test("one of the provided book's own people: the notes' value wins and the provided book is never written", async () => {
		const w = await memberOnProvidedBook()
		const keeper = await card(w.admin.id, "Keeper")
		const { resolveOrCreateBindingRow } = await import("$lib/server/utils/characterBindingSync")
		const held = await resolveOrCreateBindingRow({ lorebookId: w.book.id, characterId: keeper.id }, testDb as unknown as Db)
		await testDb.insert(schema.attributeValues).values({ ownerKind: "cast_member", ownerId: held!.id, slotId: AGE, value: { v: 40 }, sessionId: null } as any)
		await testDb.insert(schema.sessionCharacters).values({ sessionId: w.session.id, characterId: keeper.id, isActive: true } as any)
		const before = { bindings: (await bindingsOf(w.book.id)).length, values: await allValuesOnBook(w.book.id) }
		expect(before).toEqual({ bindings: 1, values: 1 })
		expect(await readAge(w, keeper.id)).toBe(40)

		const filed = await writeAge(w, { kind: "session_cast", id: keeper.id }, 41)
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		const rows = await bindingsOf(own!)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.characterId).toBe(keeper.id)
		expect(filed).toEqual({ kind: "cast_member", id: rows[0]!.id })
		expect(await readAge(w, keeper.id)).toBe(41)

		const filedAgain = await writeAge(w, { kind: "session_cast", id: keeper.id }, 42)
		expect(filedAgain).toEqual({ kind: "cast_member", id: rows[0]!.id })
		expect(await bindingsOf(own!)).toHaveLength(1)
		expect(await readAge(w, keeper.id)).toBe(42)

		expect({ bindings: (await bindingsOf(w.book.id)).length, values: await allValuesOnBook(w.book.id) }).toEqual(before)
		expect(await castValuesOf(held!.id, AGE)).toHaveLength(1)
	})

	test("a world (session) value is filed on the own book's lorebook row, never the provided book's", async () => {
		const w = await memberOnProvidedBook()
		const filed = await worldOwner(w.session.id, { kind: "session", id: w.session.id }, null)
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		expect(filed).toEqual({ kind: "lorebook", id: own })
		const before = (await valuesOf(w.book.id)).length
		const out = await applyOne(w, filed, SHOP_SHUT, true)
		expect(out.refused ?? []).toEqual([])
		expect(await valuesOf(own!)).toHaveLength(1)
		expect((await valuesOf(w.book.id)).length).toBe(before)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})

	test("the notes' value wins over the provided book's own value of the same world slot", async () => {
		const w = await memberOnProvidedBook()
		await testDb.insert(schema.attributeValues).values({ ownerKind: "lorebook", ownerId: w.book.id, slotId: SHOP_SHUT, value: { v: false }, sessionId: null } as any)
		expect(await read(w, SHOP_SHUT)).toBe(false)
		const filed = await worldOwner(w.session.id, { kind: "session", id: w.session.id }, null)
		await applyOne(w, filed, SHOP_SHUT, true)
		expect(await read(w, SHOP_SHUT)).toBe(true)
		expect(await valuesOf(w.book.id)).toHaveLength(1)
	})

	test("a pipeline write with no person behind it lands in the notes", async () => {
		const w = await memberOnProvidedBook()
		const { persona } = await seatPersona(w)
		const filed: any = await worldOwner(w.session.id, { kind: "session_cast", id: persona.id }, null)
		const own = await ownBookIdOf(w.session.id)
		expect(filed.kind).toBe("cast_member")
		expect((await bindingsOf(own!)).map((r) => r.id)).toEqual([filed.id])
	})
})

describe("the owner's own book keeps world values on the book, under its mode", () => {
	test("under Review a run's write of a held character's age is proposed, not applied", async () => {
		const w = await world()
		const hero = await seatCharacter(w)
		const { resolveOrCreateBindingRow } = await import("$lib/server/utils/characterBindingSync")
		const member = await resolveOrCreateBindingRow({ lorebookId: w.book.id, characterId: hero.id }, testDb as unknown as Db)
		await setMode(w.user.id, "review")
		const filed = await worldOwner(w.session.id, { kind: "session_cast", id: hero.id }, null)
		expect(filed).toEqual({ kind: "cast_member", id: member!.id })
		const out = await applyOne(w, filed, AGE, 40)
		expect(out.proposed.length).toBeGreaterThan(0)
		expect(out.applied).toEqual([])
		expect((await proposalsOf(w.session.id)).length).toBeGreaterThan(0)
		expect(await castValuesOf(member!.id, AGE)).toHaveLength(0)
	})
})

describe("the own book is exempt from the write mode", () => {
	test("a member's session on the provided book applies under the admin's Review and Off, no proposal", async () => {
		const w = await memberOnProvidedBook()
		const { persona } = await seatPersona(w)
		await setMode(w.admin.id, "review")
		const filed: any = await worldOwner(w.session.id, { kind: "session_cast", id: persona.id }, null)
		const own = await ownBookIdOf(w.session.id)
		expect((await bindingsOf(own!)).map((r) => r.id)).toEqual([filed.id])
		const underReview = await applyOne(w, filed, AGE, 20)
		expect(underReview.refused ?? []).toEqual([])
		expect(underReview.applied.length).toBeGreaterThan(0)
		expect(underReview.proposed).toEqual([])
		expect(await castValuesOf(filed.id, AGE)).toHaveLength(1)
		expect(await proposalsOf(w.session.id)).toHaveLength(0)

		await setMode(w.admin.id, "off")
		const underOff = await applyOne(w, filed, AGE, 21)
		expect(underOff.refused ?? []).toEqual([])
		expect(underOff.applied.length).toBeGreaterThan(0)
		expect(underOff.proposed).toEqual([])
		expect(await castValuesOf(filed.id, AGE)).toHaveLength(2)
		expect(await readAge(w, persona.id)).toBe(21)
		expect(await proposalsOf(w.session.id)).toHaveLength(0)
	})

	test("on the owner's own book under Review, a seated character the book does not hold applies on the own book's row", async () => {
		const w = await world()
		const hero = await seatCharacter(w)
		await setMode(w.user.id, "review")
		const filed: any = await worldOwner(w.session.id, { kind: "session_cast", id: hero.id }, null)
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		expect((await bindingsOf(own!)).map((r) => r.id)).toEqual([filed.id])
		const out = await applyOne(w, filed, AGE, 50)
		expect(out.refused ?? []).toEqual([])
		expect(out.applied.length).toBeGreaterThan(0)
		expect(out.proposed).toEqual([])
		expect(await castValuesOf(filed.id, AGE)).toHaveLength(1)
		expect(await proposalsOf(w.session.id)).toHaveLength(0)
	})
})

describe("a guest's refused write creates nothing", () => {
	test("the guest is refused before any own-book row is made, by the function and by the socket", async () => {
		const w = await memberOnProvidedBook()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `world-scope-guest-${++n}`)
		await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: guest.id } as any)
		const persona = await card(guest.id, "Guest persona", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: w.session.id, personaId: persona.id, userId: guest.id } as any)

		await expect(worldOwner(w.session.id, { kind: "session_cast", id: persona.id }, guest.id)).rejects.toThrow("not your lorebook")
		const nothingMade = async () => {
			const own = await ownBookIdOf(w.session.id)
			if (own != null) {
				expect(await bindingsOf(own)).toHaveLength(0)
				expect(await allValuesOnBook(own)).toBe(0)
			}
			expect(await bindingsOf(w.book.id)).toHaveLength(0)
			const stray = await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.characterId, persona.id))
			expect(stray).toHaveLength(0)
		}
		await nothingMade()

		const { stateSet } = await import("$lib/server/sockets/state")
		// The handler emits `state:set:error` and rethrows the refusal.
		await expect(
			stateSet.handler(
				socketOf(guest.id),
				{ sessionId: w.session.id, owner: { kind: "session_cast", id: persona.id }, slotId: AGE, value: 30 } as any,
				() => {}
			)
		).rejects.toThrow("not your lorebook")
		await nothingMade()
	})
})

describe("a session with no book keeps world values in its own notes", () => {
	test("a world (session) value lands on the own book's lorebook row, from a run and from the owner's socket", async () => {
		const w = await world()
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, w.session.id))
		const filed = await worldOwner(w.session.id, { kind: "session", id: w.session.id }, null)
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		expect(filed).toEqual({ kind: "lorebook", id: own })
		const out = await applyOne(w, filed, SHOP_SHUT, true)
		expect(out.refused ?? []).toEqual([])
		expect(await valuesOf(own!)).toHaveLength(1)
		expect(await read(w, SHOP_SHUT)).toBe(true)

		const second = await world()
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, second.session.id))
		const { stateSet } = await import("$lib/server/sockets/state")
		await stateSet.handler(
			socketOf(second.user.id),
			{ sessionId: second.session.id, owner: { kind: "session", id: second.session.id }, slotId: SHOP_SHUT, value: true } as any,
			() => {}
		)
		const ownSecond = await ownBookIdOf(second.session.id)
		expect(ownSecond).toBeDefined()
		expect(await valuesOf(ownSecond!)).toHaveLength(1)
		expect(await read(second, SHOP_SHUT)).toBe(true)
	})
})

// ---- m3b-V2 scope findings: the own book's writer is checked before anything makes or touches it; its `lorebook` row is admitted only where the session keeps its values there ----

/** A member's session on a provided book with a guest of it who has a persona seated; no own book yet. */
async function memberSessionWithGuest() {
	const w = await memberOnProvidedBook()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const guest = await createTestUser(testDb, `world-scope-guest-${++n}`)
	await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: guest.id } as any)
	const persona = await card(guest.id, "Guest persona", true)
	await testDb.insert(schema.sessionPersonas).values({ sessionId: w.session.id, personaId: persona.id, userId: guest.id } as any)
	await testDb.delete(schema.lorebooks).where(eq(schema.lorebooks.sessionId, w.session.id))
	expect(await ownBookIdOf(w.session.id)).toBeUndefined()
	return { ...w, guest, persona }
}

describe("a guest's refused world write makes no own book", () => {
	test("none is made by the function or the socket; a run on the same session does make it", async () => {
		const w = await memberSessionWithGuest()
		const session = { kind: "session" as const, id: w.session.id }
		const cast = { kind: "session_cast" as const, id: w.persona.id }
		await expect(worldOwner(w.session.id, session, w.guest.id)).rejects.toThrow("not your lorebook")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()
		await expect(worldOwner(w.session.id, cast, w.guest.id)).rejects.toThrow("not your lorebook")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()

		const { stateSet } = await import("$lib/server/sockets/state")
		// Moved 2026-11-05 (lane ed, plan §25): the socket now stops a guest on the world, a place or a card they don't own
		// at the hand-edit decider (`state/handEdits.ts`), before the writer check the function above still pins.
		await expect(
			stateSet.handler(socketOf(w.guest.id), { sessionId: w.session.id, owner: session, slotId: SHOP_SHUT, value: true } as any, () => {})
		).rejects.toThrow("The world, its places and the people nobody plays are the session owner's to change.")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()
		await expect(
			stateSet.handler(socketOf(w.guest.id), { sessionId: w.session.id, owner: cast, slotId: AGE, value: 30 } as any, () => {})
		).rejects.toThrow("not your lorebook")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()

		const filed = await worldOwner(w.session.id, session, null)
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		expect(filed).toEqual({ kind: "lorebook", id: own })
		const out = await applyOne(w, filed, SHOP_SHUT, true)
		expect(out.refused ?? []).toEqual([])
		expect(await valuesOf(own!)).toHaveLength(1)
	})
})

describe("a guest's refused world write leaves an existing own book untouched", () => {
	test("overlay_of keeps its stale value, so ownBookFor never ran", async () => {
		const w = await memberSessionWithGuest()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(testDb as unknown as Db, w.session.id)
		await testDb.update(schema.lorebooks).set({ overlayOf: null }).where(eq(schema.lorebooks.id, own.id))
		const overlayOfNow = async () =>
			(await testDb.select({ overlayOf: schema.lorebooks.overlayOf }).from(schema.lorebooks).where(eq(schema.lorebooks.id, own.id)))[0]!.overlayOf
		expect(await overlayOfNow()).toBeNull()

		await expect(worldOwner(w.session.id, { kind: "session", id: w.session.id }, w.guest.id)).rejects.toThrow("not your lorebook")
		expect(await overlayOfNow()).toBeNull()
		await expect(worldOwner(w.session.id, { kind: "session_cast", id: w.persona.id }, w.guest.id)).rejects.toThrow("not your lorebook")
		expect(await overlayOfNow()).toBeNull()
		expect(await bindingsOf(own.id)).toHaveLength(0)

		// The owner's own write resyncs it, as ownBookFor always did.
		await worldOwner(w.session.id, { kind: "session", id: w.session.id }, w.user.id)
		expect(await overlayOfNow()).toBe(w.book.id)
	})
})

describe("the own book's lorebook row is the session's only where it keeps its values there", () => {
	test("the owner's own book: its own row is refused, the attached book's passes", async () => {
		const w = await world()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const { assertSessionOwner } = await import("$lib/server/state/write")
		const own = await ownBookFor(testDb as unknown as Db, w.session.id)
		const db = testDb as unknown as Db
		await expect(assertSessionOwner(db, w.session.id, { kind: "lorebook", id: own.id }, w.user.id)).rejects.toThrow("not this session's lorebook")
		await expect(assertSessionOwner(db, w.session.id, { kind: "lorebook", id: w.book.id }, w.user.id)).resolves.toBeUndefined()

		const { stateSet } = await import("$lib/server/sockets/state")
		await expect(
			stateSet.handler(
				socketOf(w.user.id),
				{ sessionId: w.session.id, owner: { kind: "lorebook", id: own.id }, slotId: SHOP_SHUT, value: true } as any,
				() => {}
			)
		).rejects.toThrow("not this session's lorebook")
		expect(await valuesOf(own.id)).toHaveLength(0)
	})

	test("a member's session on a provided book: the own book's row passes for the session's owner", async () => {
		const w = await memberOnProvidedBook()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const { assertSessionOwner } = await import("$lib/server/state/write")
		const own = await ownBookFor(testDb as unknown as Db, w.session.id)
		const db = testDb as unknown as Db
		await expect(assertSessionOwner(db, w.session.id, { kind: "lorebook", id: own.id }, w.user.id)).resolves.toBeUndefined()
		await expect(assertSessionOwner(db, w.session.id, { kind: "lorebook", id: own.id }, null)).resolves.toBeUndefined()
	})
})

// ---- ★pl-1 (owner 2026-11-05: "In the notes' overlay, like the rules' place fields."): a place's world value, where the session can't write its book ----

/** A place of a book, one the session sees (a plain location entry). */
async function placeIn(lorebookId: number, title: string) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({ lorebookId, typeId: LOCATION_TYPE_ID, typeVersion: 1, position: ++n, title: `${title} ${n}`, content: "…", fields: {} } as any)
		.returning()
	return row!
}

const placeOwner = (id: number) => ({ kind: "session_location" as const, id })

/** The notes' overlay of places' values (`extra_json.ruleFed.placeValues`), or undefined when there are none. */
const overlayPlaces = async (sessionId: number) => {
	const [notes] = await testDb.select({ extraJson: schema.lorebooks.extraJson }).from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId)).limit(1)
	return ((notes?.extraJson as any)?.ruleFed?.placeValues ?? undefined) as Record<string, Record<string, unknown>> | undefined
}

/** Every `attribute_values` row that names the place, on either of its layers. */
const placeRows = async (entryId: number) =>
	(await testDb.select().from(schema.attributeValues).where(eq(schema.attributeValues.ownerId, entryId))).filter(
		(r) => r.ownerKind === "location" || r.ownerKind === "session_location"
	)

const entriesOf = async (lorebookId: number) =>
	await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, lorebookId))

const lampsAt = async (w: { session: { id: number } }, entryId: number) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as unknown as Db, { sessionId: w.session.id, owner: placeOwner(entryId), slotId: LAMPS })
}

const lampsInState = async (w: { session: { id: number } }, entryId: number) => {
	const { stateFor } = await import("$lib/server/state/resolve")
	const state = await stateFor(testDb as unknown as Db, w.session.id)
	return (state.locations.byId[String(entryId)] as Record<string, unknown> | undefined)?.lamps
}

/** A message the session can anchor a write to. */
async function postMessage(sessionId: number) {
	const [legacy] = await testDb.insert(schema.sessionMessages).values({ sessionId, role: "assistant", content: "…" }).returning()
	await testDb.insert(schema.messages).values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

describe("a place of the attached book keeps its world value in the notes' overlay", () => {
	test("a member's session: a run writes the overlay, the book is the fallback, a second write updates it, the book gains nothing", async () => {
		const w = await memberOnProvidedBook()
		const x = await placeIn(w.book.id, "Lantern Hall")
		await testDb.insert(schema.attributeValues).values({ ownerKind: "location", ownerId: x.id, slotId: LAMPS, value: { v: 3 }, sessionId: null } as any)
		// Before any write the book's value is read.
		expect(await lampsAt(w, x.id)).toBe(3)
		expect(await lampsInState(w, x.id)).toBe(3)
		const before = {
			rows: (await placeRows(x.id)).length,
			entries: (await entriesOf(w.book.id)).length,
			bindings: (await bindingsOf(w.book.id)).length,
			values: await allValuesOnBook(w.book.id)
		}

		const filed = await worldOwner(w.session.id, placeOwner(x.id), null)
		expect(filed).toEqual({ kind: "location", id: x.id })
		const out = await applyOne(w, filed, LAMPS, 5)
		expect(out.refused ?? []).toEqual([])
		expect(out.applied.length).toBeGreaterThan(0)
		expect(out.proposed).toEqual([])
		const own = await ownBookIdOf(w.session.id)
		expect(own).toBeDefined()
		expect(await overlayPlaces(w.session.id)).toEqual({ [String(x.id)]: { [LAMPS]: 5 } })
		expect(await lampsAt(w, x.id)).toBe(5)
		expect(await lampsInState(w, x.id)).toBe(5)

		// A second write, by the session's owner, over the socket.
		const { stateSet } = await import("$lib/server/sockets/state")
		await stateSet.handler(socketOf(w.user.id), { sessionId: w.session.id, owner: placeOwner(x.id), slotId: LAMPS, value: 7 } as any, () => {})
		expect(await overlayPlaces(w.session.id)).toEqual({ [String(x.id)]: { [LAMPS]: 7 } })
		expect(await lampsAt(w, x.id)).toBe(7)
		expect(await lampsInState(w, x.id)).toBe(7)

		// An add reads the overlay's value, not the book's.
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(testDb as unknown as Db, { sessionId: w.session.id, updatedBy: "user", userId: w.user.id }, { owner: filed, slotId: LAMPS, op: "add", value: 2 } as any)
		expect(await lampsAt(w, x.id)).toBe(9)

		expect({
			rows: (await placeRows(x.id)).length,
			entries: (await entriesOf(w.book.id)).length,
			bindings: (await bindingsOf(w.book.id)).length,
			values: await allValuesOnBook(w.book.id)
		}).toEqual(before)
		// No copied place in the notes either.
		expect((await entriesOf(own!)).length).toBe(0)
	})

	test("under the book owner's Review and Off the place write still applies to the overlay, no proposal", async () => {
		const w = await memberOnProvidedBook()
		const x = await placeIn(w.book.id, "Lantern Hall")
		const filed = await worldOwner(w.session.id, placeOwner(x.id), null)
		await setMode(w.admin.id, "review")
		const underReview = await applyOne(w, filed, LAMPS, 4)
		expect(underReview.refused ?? []).toEqual([])
		expect(underReview.applied.length).toBeGreaterThan(0)
		expect(underReview.proposed).toEqual([])
		expect(await lampsAt(w, x.id)).toBe(4)
		await setMode(w.admin.id, "off")
		const underOff = await applyOne(w, filed, LAMPS, 6)
		expect(underOff.refused ?? []).toEqual([])
		expect(underOff.applied.length).toBeGreaterThan(0)
		expect(underOff.proposed).toEqual([])
		expect(await lampsAt(w, x.id)).toBe(6)
		expect(await overlayPlaces(w.session.id)).toEqual({ [String(x.id)]: { [LAMPS]: 6 } })
		expect(await proposalsOf(w.session.id)).toHaveLength(0)
		expect(await placeRows(x.id)).toHaveLength(0)
	})

	test("Back takes the value with its message and Forward brings it back", async () => {
		const w = await memberOnProvidedBook()
		const x = await placeIn(w.book.id, "Lantern Hall")
		await testDb.insert(schema.attributeValues).values({ ownerKind: "location", ownerId: x.id, slotId: LAMPS, value: { v: 3 }, sessionId: null } as any)
		const message = await postMessage(w.session.id)
		const filed = await worldOwner(w.session.id, placeOwner(x.id), null)
		const out = await applyOne(w, filed, LAMPS, 5)
		expect(out.refused ?? []).toEqual([])
		expect(await lampsAt(w, x.id)).toBe(5)

		const { retractStateAnchoredTo, restoreRetractedState } = await import("$lib/server/state/write")
		const back = await retractStateAnchoredTo(testDb as unknown as Db, message.id, "leaves")
		expect(back.changed).toBe(true)
		expect(await lampsAt(w, x.id)).toBe(3)
		expect((await overlayPlaces(w.session.id))?.[String(x.id)]?.[LAMPS]).toBeUndefined()

		await restoreRetractedState(testDb as unknown as Db, back.taken)
		expect(await lampsAt(w, x.id)).toBe(5)
		expect((await overlayPlaces(w.session.id))?.[String(x.id)]?.[LAMPS]).toBe(5)
		expect(await placeRows(x.id)).toHaveLength(1)
	})

	test("the owner's own book is unchanged: the value lands on the book's row and the overlay holds none", async () => {
		const w = await world()
		const x = await placeIn(w.book.id, "Lantern Hall")
		const filed = await worldOwner(w.session.id, placeOwner(x.id), null)
		expect(filed).toEqual({ kind: "location", id: x.id })
		const out = await applyOne(w, filed, LAMPS, 5)
		expect(out.refused ?? []).toEqual([])
		const rows = await placeRows(x.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ ownerKind: "location", ownerId: x.id, slotId: LAMPS, sessionId: null, value: { v: 5 } })
		expect(await overlayPlaces(w.session.id)).toBeUndefined()
		expect(await lampsAt(w, x.id)).toBe(5)
	})
})

describe("a guest's refused place write makes nothing", () => {
	test("none of the own book, the overlay or a value row is made, by the function or the socket", async () => {
		const w = await memberSessionWithGuest()
		const x = await placeIn(w.book.id, "Lantern Hall")
		await expect(worldOwner(w.session.id, placeOwner(x.id), w.guest.id)).rejects.toThrow("not your lorebook")
		const { stateSet } = await import("$lib/server/sockets/state")
		// Moved 2026-11-05 (lane ed, plan §25): the socket now stops a guest on the world, a place or a card they don't own
		// at the hand-edit decider (`state/handEdits.ts`), before the writer check the function above still pins.
		await expect(
			stateSet.handler(socketOf(w.guest.id), { sessionId: w.session.id, owner: placeOwner(x.id), slotId: LAMPS, value: 2 } as any, () => {})
		).rejects.toThrow("The world, its places and the people nobody plays are the session owner's to change.")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()
		expect(await overlayPlaces(w.session.id)).toBeUndefined()
		expect(await placeRows(x.id)).toHaveLength(0)
	})

	test("with no attached book, a guest's world write on an explicit place or a card makes no own book", async () => {
		const w = await memberSessionWithGuest()
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, w.session.id))
		const elsewhere = await testDb.insert(schema.lorebooks).values({ userId: w.admin.id, name: `Elsewhere ${++n}` }).returning()
		const x = await placeIn(elsewhere[0]!.id, "Far Hall")
		const hosts = await card(w.user.id, "Host's card")
		const { stateSet } = await import("$lib/server/sockets/state")
		await expect(worldOwner(w.session.id, { kind: "location", id: x.id }, w.guest.id)).rejects.toThrow("not your lorebook")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()
		// Moved 2026-11-05 (lane ed, plan §25): the socket now stops a guest on the world, a place or a card they don't own
		// at the hand-edit decider (`state/handEdits.ts`), before the writer check the function above still pins.
		await expect(
			stateSet.handler(socketOf(w.guest.id), { sessionId: w.session.id, owner: { kind: "location", id: x.id }, slotId: LAMPS, value: 2 } as any, () => {})
		).rejects.toThrow("The world, its places and the people nobody plays are the session owner's to change.")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()
		await expect(
			stateSet.handler(socketOf(w.guest.id), { sessionId: w.session.id, owner: { kind: "card", id: hosts.id }, slotId: AGE, value: 2 } as any, () => {})
		).rejects.toThrow("Card stats are edited in the card editor.")
		expect(await ownBookIdOf(w.session.id)).toBeUndefined()
		expect(await placeRows(x.id)).toHaveLength(0)
	})
})

// ---- ★pl2-2 (owner 2026-11-05: "tie the notes' rows to the turn like session values"): the notes' book-layer rows ----

/** A message the session can anchor a write to, spoken by a character (a reply) when one is named. */
async function postMessageBy(sessionId: number, characterId: number | null) {
	const [legacy] = await testDb.insert(schema.sessionMessages).values({ sessionId, role: "assistant", content: "…" }).returning()
	await testDb.insert(schema.messages).values({ id: legacy!.id, sessionId, role: "assistant", characterId } as any)
	return legacy!
}

/** Back, as `rewindTurn` takes a message's state: the retraction, keeping what it took for Forward. */
async function backOf(messageId: number) {
	const { retractStateAnchoredTo } = await import("$lib/server/state/write")
	return await retractStateAnchoredTo(testDb as unknown as Db, messageId, "leaves")
}

describe("the session's own notes are tied to the turn like a session value (★pl2-2)", () => {
	test("a member's session: a world value in the notes goes with Back and comes back with Forward", async () => {
		const w = await memberOnProvidedBook()
		const filed = await worldOwner(w.session.id, { kind: "session", id: w.session.id }, null)
		const own = await ownBookIdOf(w.session.id)
		expect(filed).toEqual({ kind: "lorebook", id: own })
		expect((await applyOne(w, filed, SHOP_SHUT, false)).refused ?? []).toEqual([])
		const message = await postMessage(w.session.id)
		expect((await applyOne(w, filed, SHOP_SHUT, true)).refused ?? []).toEqual([])
		const rows = await valuesOf(own!)
		expect(rows.map((r) => [r.validFromMessageId, r.sessionId])).toEqual(
			expect.arrayContaining([[message.id, null]])
		)
		expect(await read(w, SHOP_SHUT)).toBe(true)

		const { restoreRetractedState } = await import("$lib/server/state/write")
		const back = await backOf(message.id)
		expect(back.changed).toBe(true)
		expect(await read(w, SHOP_SHUT)).toBe(false)

		await restoreRetractedState(testDb as unknown as Db, back.taken)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})

	test("the same for a person's value in the notes, anchored to that character's latest message, not the newest", async () => {
		const w = await memberOnProvidedBook()
		const hero = await seatCharacter(w)
		const filed = await writeAge(w, { kind: "session_cast", id: hero.id }, 31)
		expect(filed.kind).toBe("cast_member")
		const before = await castValuesOf(filed.id, AGE)
		expect(before.map((r) => r.validFromMessageId)).toEqual([null])

		const reply = await postMessageBy(w.session.id, hero.id)
		const later = await postMessageBy(w.session.id, null)
		await writeAge(w, { kind: "session_cast", id: hero.id }, 32)
		const rows = await castValuesOf(filed.id, AGE)
		expect(rows.map((r) => r.validFromMessageId).sort()).toEqual([null, reply.id].sort())
		expect(rows.every((r) => r.sessionId === null)).toBe(true)
		expect(await readAge(w, hero.id)).toBe(32)

		const { restoreRetractedState } = await import("$lib/server/state/write")
		const back = await backOf(reply.id)
		expect(back.changed).toBe(true)
		expect(await readAge(w, hero.id)).toBe(31)
		await restoreRetractedState(testDb as unknown as Db, back.taken)
		expect(await readAge(w, hero.id)).toBe(32)
		expect(later.id).toBeGreaterThan(reply.id)
	})

	test("a real book's author-layer write is still never anchored: Back leaves it", async () => {
		const w = await world()
		const message = await postMessage(w.session.id)
		const filed = await worldOwner(w.session.id, { kind: "session", id: w.session.id }, null)
		expect(filed).toEqual({ kind: "lorebook", id: w.book.id })
		expect((await applyOne(w, filed, SHOP_SHUT, true)).refused ?? []).toEqual([])
		const rows = await bookRows(w, SHOP_SHUT)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.validFromMessageId).toBeNull()

		await backOf(message.id)
		expect(await bookRows(w, SHOP_SHUT)).toHaveLength(1)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})

	test("a value on a place in the session's own book is anchored to the newest message; Back takes it and Forward brings it back", async () => {
		const w = await memberOnProvidedBook()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(testDb as unknown as Db, w.session.id)
		const x = await placeIn(own.id, "Notes Hall")
		expect((await applyOne(w, { kind: "location", id: x.id }, LAMPS, 2)).refused ?? []).toEqual([])
		const message = await postMessageBy(w.session.id, null)
		const out = await applyOne(w, { kind: "location", id: x.id }, LAMPS, 4)
		expect(out.refused ?? []).toEqual([])
		const rows = (await placeRows(x.id)).filter((r) => r.ownerKind === "location")
		expect(rows.map((r) => r.validFromMessageId).sort()).toEqual([null, message.id].sort())
		expect(await lampsInState(w, x.id)).toBe(4)

		const { restoreRetractedState } = await import("$lib/server/state/write")
		const back = await backOf(message.id)
		expect(back.changed).toBe(true)
		expect(await lampsInState(w, x.id)).toBe(2)
		await restoreRetractedState(testDb as unknown as Db, back.taken)
		expect(await lampsInState(w, x.id)).toBe(4)
	})

	test("a held change on a person in the notes is filed under that character's reply, and an accept writes it there", async () => {
		const w = await memberOnProvidedBook()
		const hero = await seatCharacter(w)
		const filed = await writeAge(w, { kind: "session_cast", id: hero.id }, 31)
		const reply = await postMessageBy(w.session.id, hero.id)
		await postMessageBy(w.session.id, null)

		const { decideProposal, proposeChange } = await import("$lib/server/state/write")
		const id = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: `run:${crypto.randomUUID()}` },
			{ owner: filed, slotId: AGE, value: 40 }
		)
		const [held] = (await proposalsOf(w.session.id)).filter((p) => p.id === id)
		expect(held!.messageId).toBe(reply.id)
		expect(await readAge(w, hero.id)).toBe(31)

		const outcome = await decideProposal(testDb as unknown as Db, id, true)
		expect(outcome.status).toBe("accepted")
		expect(await readAge(w, hero.id)).toBe(40)
		const [written] = (await castValuesOf(filed.id, AGE)).filter((r) => r.id === outcome.appliedId)
		expect(written!.validFromMessageId).toBe(reply.id)
	})

	test("the same held change is refused as sealed once the character has spoken again", async () => {
		const w = await memberOnProvidedBook()
		const hero = await seatCharacter(w)
		const filed = await writeAge(w, { kind: "session_cast", id: hero.id }, 31)
		await postMessageBy(w.session.id, hero.id)
		await postMessageBy(w.session.id, null)

		const { decideProposal, proposeChange, StateRefusal } = await import("$lib/server/state/write")
		const id = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: `run:${crypto.randomUUID()}` },
			{ owner: filed, slotId: AGE, value: 40 }
		)
		await postMessageBy(w.session.id, hero.id)

		const decided = decideProposal(testDb as unknown as Db, id, true)
		await expect(decided).rejects.toBeInstanceOf(StateRefusal)
		await expect(decided).rejects.toThrow(/sealed/)
		expect(await readAge(w, hero.id)).toBe(31)
	})
})
