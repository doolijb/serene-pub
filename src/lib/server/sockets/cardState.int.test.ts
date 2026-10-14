/**
 * A character card's own stats (card dowry §B.4, the form's Stats tab).
 *
 * `cardState:*` reads and writes the card layer — owner `card`, `session_id`
 * NULL, no anchor — with no session, picks the card's sheets, and authors a
 * stored slot or sheet under the caller's namespace. Only the card's owner;
 * anyone else reads it as missing. A write tells the owner's tabs
 * (`cardState:changed`) and every session seating the character
 * (`state:changed`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, getAttributeSlot } from "@serene-pub/sdk"
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

/** Every session push, recorded rather than sent. */
const told: { sessionId: number; event: string; data: any }[] = []
vi.mock("./utils/broadcastHelpers", async (importOriginal) => {
	const real = await importOriginal<typeof import("./utils/broadcastHelpers")>()
	return {
		...real,
		broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, data: any) => {
			told.push({ sessionId, event, data })
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-card-state-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A cast stat, declared in code. */
const NERVE = "test:slot/dowry-nerve@1"
/** A place stat: never a card's. */
const LAMPS = "test:slot/dowry-lamps@1"

function declareSlots() {
	if (!getAttributeSlot(NERVE))
		defineAttributeSlot(NERVE, {
			type: "integer",
			label: { en: "Nerve" },
			descriptor: "How steady they are.",
			appliesTo: ["cast"],
			config: { min: 0, max: 10 }
		})
	if (!getAttributeSlot(LAMPS))
		defineAttributeSlot(LAMPS, {
			type: "integer",
			label: { en: "Lamps lit" },
			descriptor: "How many lamps burn here.",
			appliesTo: ["location"]
		})
}

type Emitted = { event: string; data: any }

function caller(user: { id: number; username: string; isAdmin?: boolean }) {
	const out: Emitted[] = []
	const socket = {
		user: { id: user.id, username: user.username, isAdmin: !!user.isAdmin },
		io: { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) }
	} as any
	const emit = (event: string, data: any) => {
		out.push({ event, data })
	}
	return { socket, emit, out }
}

async function call<R = Sockets.CardState.Get.Response>(
	name:
		| "cardStateGet"
		| "cardStateSet"
		| "cardStateSetSheets"
		| "cardStateDeclareSlot"
		| "cardStateUpdateSlot"
		| "cardStateDeclareSheet"
		| "cardStateUpdateSheet",
	user: { id: number; username: string; isAdmin?: boolean },
	params: Record<string, unknown>
) {
	const mod = await import("./cardState")
	const handler = mod[name] as { event: string; handler: (s: any, p: any, e: any) => Promise<unknown> }
	const c = caller(user)
	try {
		const res = await handler.handler(c.socket, params, c.emit)
		return { res: res as R, out: c.out, error: null as string | null }
	} catch (e) {
		const refusal = c.out.find((o) => o.event === `${handler.event}:error`)
		return { res: null, out: c.out, error: (refusal?.data?.error ?? (e as Error).message) as string, refusal: refusal?.data }
	}
}

let n = 0

async function world() {
	declareSlots()
	const suffix = `${++n}-${Math.random().toString(36).slice(2, 7)}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `dowry-owner-${suffix}`)
	const stranger = await createTestUser(testDb, `dowry-stranger-${suffix}`)
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	return { owner, stranger, card: card!, suffix }
}

describe("cardState:get — a card's own stats", () => {
	test("a fresh card carries nothing, and is offered the registry a character may carry", async () => {
		const w = await world()
		const read = await call("cardStateGet", w.owner, { characterId: w.card.id, requestId: "r1" })
		expect(read.error).toBeNull()
		expect(read.res).toMatchObject({ characterId: w.card.id, sheets: [], vocabulary: [], values: {}, requestId: "r1" })
		const slotIds = read.res!.available.slots.map((s) => s.id)
		expect(slotIds).toContain(NERVE)
		// A place stat is not a character's to carry.
		expect(slotIds).not.toContain(LAMPS)
		expect(read.res!.available.slots.find((s) => s.id === NERVE)).toMatchObject({
			label: "Nerve",
			type: "integer",
			origin: "plugin",
			retired: false,
			editable: false
		})
		// The reply is scoped by the card.
		expect(read.out.find((o) => o.event === "cardState:get")?.data.characterId).toBe(w.card.id)
	})

	test("a stranger reads the card as missing, on read and on write", async () => {
		const w = await world()
		const read = await call("cardStateGet", w.stranger, { characterId: w.card.id, requestId: "x" })
		expect(read.error).toBe("Character not found.")
		expect(read.refusal).toMatchObject({ characterId: w.card.id, requestId: "x" })
		const write = await call("cardStateSet", w.stranger, {
			characterId: w.card.id,
			changes: [{ slotId: NERVE, value: 3 }]
		})
		expect(write.error).toBe("Character not found.")
		const sheets = await call("cardStateSetSheets", w.stranger, { characterId: w.card.id, sheetIds: [] })
		expect(sheets.error).toBe("Character not found.")
	})
})

describe("cardState:setSheets — which sheets the card carries", () => {
	test("a picked sheet and its character slots join the card's vocabulary, in order", async () => {
		const w = await world()
		const declared = await call<Sockets.CardState.DeclareSheet.Response>("cardStateDeclareSheet", w.owner, {
			name: `Grit ${w.suffix}`,
			props: { label: { en: "Grit" }, slots: [{ id: LAMPS }, { id: NERVE }] }
		})
		expect(declared.error).toBeNull()
		const sheetId = declared.res!.id
		expect(sheetId).toBe(`dowry-owner-${w.suffix}:sheet/grit-${w.suffix}@1`)
		// Only the slot a character carries is the sheet's, here.
		expect(declared.res).toMatchObject({ origin: "stored", editable: true, slotIds: [NERVE] })

		told.length = 0
		const set = await call("cardStateSetSheets", w.owner, { characterId: w.card.id, sheetIds: [sheetId] })
		expect(set.error).toBeNull()
		expect(set.res!.sheets).toEqual([sheetId])
		expect(set.res!.vocabulary.map((v) => [v.slotId, v.sheetId])).toEqual([[NERVE, sheetId]])
		expect(set.res!.configs[NERVE]).toMatchObject({ min: 0, max: 10 })
		expect(set.out.map((o) => o.event)).toEqual(["cardState:setSheets", "cardState:changed"])
		// Now offered among the sheets a card may pick.
		expect(set.res!.available.sheets.map((s) => s.id)).toContain(sheetId)
	})

	test("an unknown sheet id is refused in the state layer's sentence", async () => {
		const w = await world()
		const set = await call("cardStateSetSheets", w.owner, {
			characterId: w.card.id,
			sheetIds: ["nobody:sheet/nothing@1"]
		})
		expect(set.error).toMatch(/^This pub has no record of nobody:sheet\/nothing@1/)
		const rows = await testDb
			.select()
			.from(schema.ownerSheets)
			.where(and(eq(schema.ownerSheets.ownerKind, "card"), eq(schema.ownerSheets.ownerId, w.card.id)))
		expect(rows).toEqual([])
	})
})

describe("cardState:get — defaults", () => {
	test("a sheet entry's default wins over the declaration's; a slot with neither has none", async () => {
		const w = await world()
		const STEADY = "test:slot/dowry-steady@1"
		if (!getAttributeSlot(STEADY))
			defineAttributeSlot(STEADY, {
				type: "integer",
				label: { en: "Steady" },
				descriptor: "How steady.",
				appliesTo: ["cast"],
				default: 4
			})
		const declared = await call<Sockets.CardState.DeclareSheet.Response>("cardStateDeclareSheet", w.owner, {
			name: `Calm ${w.suffix}`,
			props: { label: { en: "Calm" }, slots: [{ id: STEADY, default: 7 }, { id: NERVE }] }
		})
		expect(declared.error).toBeNull()
		const set = await call("cardStateSetSheets", w.owner, {
			characterId: w.card.id,
			sheetIds: [declared.res!.id]
		})
		expect(set.res!.defaults).toEqual({ [STEADY]: 7 })

		// Loose, the declaration's own default.
		const loose = await world()
		const value = await call("cardStateSet", loose.owner, {
			characterId: loose.card.id,
			changes: [{ slotId: STEADY, config: { max: 9 } }]
		})
		expect(value.error).toBeNull()
		expect(value.res!.defaults).toEqual({ [STEADY]: 4 })
	})
})

describe("cardState:set — starting values and limits", () => {
	test("a value set on the card reads back, a loose slot joins the vocabulary, and the seats' sessions hear it", async () => {
		const w = await world()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.owner.id, isGroup: false, name: `Run ${w.suffix}` })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: w.card.id })

		told.length = 0
		const set = await call("cardStateSet", w.owner, {
			characterId: w.card.id,
			changes: [{ slotId: NERVE, value: 7 }],
			requestId: "w1"
		})
		expect(set.error).toBeNull()
		expect(set.res!.values).toEqual({ [NERVE]: 7 })
		expect(set.res!.vocabulary.map((v) => v.slotId)).toEqual([NERVE])
		expect(set.res!.vocabulary[0]!.sheetId).toBeUndefined()
		expect(set.res!.requestId).toBe("w1")
		expect(set.out.find((o) => o.event === "cardState:changed")?.data).toEqual({ characterId: w.card.id })
		expect(told).toEqual([{ sessionId: session!.id, event: "state:changed", data: { sessionId: session!.id } }])

		// The row is the card's template layer: no session, no anchor.
		const [row] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.ownerKind, "card"), eq(schema.attributeValues.ownerId, w.card.id)))
		expect(row).toMatchObject({ slotId: NERVE, sessionId: null, validFromMessageId: null, updatedBy: "user" })

		const read = await call("cardStateGet", w.owner, { characterId: w.card.id })
		expect(read.res!.values).toEqual({ [NERVE]: 7 })
	})

	test("limits land before the value, all or nothing; a value past them is refused", async () => {
		const w = await world()
		const set = await call("cardStateSet", w.owner, {
			characterId: w.card.id,
			changes: [{ slotId: NERVE, config: { max: 20 }, value: 15 }]
		})
		expect(set.error).toBeNull()
		expect(set.res!.values[NERVE]).toBe(15)
		expect(set.res!.ownConfigs[NERVE]).toEqual({ max: 20 })
		expect(set.res!.configs[NERVE]).toMatchObject({ min: 0, max: 20 })

		// One bad change refuses the whole set.
		const bad = await call("cardStateSet", w.owner, {
			characterId: w.card.id,
			changes: [
				{ slotId: NERVE, config: null },
				{ slotId: NERVE, value: 99 }
			]
		})
		expect(bad.error).toBeTruthy()
		const read = await call("cardStateGet", w.owner, { characterId: w.card.id })
		expect(read.res!.values[NERVE]).toBe(15)
		expect(read.res!.ownConfigs[NERVE]).toEqual({ max: 20 })

		// A cleared value reads as not set.
		const cleared = await call("cardStateSet", w.owner, {
			characterId: w.card.id,
			changes: [{ slotId: NERVE, value: null, config: null }]
		})
		expect(cleared.error).toBeNull()
		expect(cleared.res!.values).toEqual({})
		expect(cleared.res!.vocabulary).toEqual([])
	})

	test("a place stat is not a character's", async () => {
		const w = await world()
		const set = await call("cardStateSet", w.owner, {
			characterId: w.card.id,
			changes: [{ slotId: LAMPS, value: 2 }]
		})
		expect(set.error).toMatch(/does not apply to card/)
	})
})

describe("cardState:declareSlot / updateSlot — authoring from the card", () => {
	test("a slot is declared under the caller's namespace and offered to every card", async () => {
		const w = await world()
		const declared = await call<Sockets.CardState.DeclareSlot.Response>("cardStateDeclareSlot", w.owner, {
			name: "Sanity",
			props: { type: "integer", label: { en: "Sanity" }, descriptor: "How sound their mind is.", appliesTo: ["cast"] },
			requestId: "d1"
		})
		expect(declared.error).toBeNull()
		const id = `dowry-owner-${w.suffix}:slot/sanity@1`
		expect(declared.res).toMatchObject({ id, label: "Sanity", origin: "stored", editable: true, requestId: "d1" })
		const read = await call("cardStateGet", w.owner, { characterId: w.card.id })
		expect(read.res!.available.slots.find((s) => s.id === id)).toMatchObject({ editable: true })

		// Somebody else may not edit it; its author may.
		const theirs = await call("cardStateUpdateSlot", w.stranger, {
			id,
			props: { type: "integer", label: { en: "Mine now" }, descriptor: "…", appliesTo: ["cast"] }
		})
		expect(theirs.error).toMatch(/someone else's/)
		const edited = await call<Sockets.CardState.UpdateSlot.Response>("cardStateUpdateSlot", w.owner, {
			id,
			props: { type: "integer", label: { en: "Clarity" }, descriptor: "How sound their mind is.", appliesTo: ["cast"] }
		})
		expect(edited.error).toBeNull()
		expect(edited.res).toMatchObject({ id, label: "Clarity" })
	})

	test("a reserved owner is refused in the declarations' sentence; a code slot is never edited by hand", async () => {
		const w = await world()
		// The namespace is the account's name as stored, never the socket's copy.
		await testDb.update(schema.users).set({ username: "core" }).where(eq(schema.users.id, w.stranger.id))
		const reserved = await call("cardStateDeclareSlot", { id: w.stranger.id, username: "core" }, {
			name: "Sanity",
			props: { type: "integer", label: { en: "Sanity" }, descriptor: "…", appliesTo: ["cast"] }
		})
		expect(reserved.error).toMatch(/^'core' is a reserved namespace/)

		const code = await call("cardStateUpdateSlot", w.owner, {
			id: NERVE,
			props: { type: "integer", label: { en: "Nerve" }, descriptor: "…", appliesTo: ["cast"] }
		})
		expect(code.error).toBeTruthy()
	})
})
