/**
 * Attributes phase 3a — items (DESIGN-attributes-shapes; owner rulings
 * 2026-09-25/26). A list item referencing a lore entry carries a held count
 * (`{ entryId, count }`); the write doors refuse a reference to an entry the
 * session's lorebook does not hold; `itemSupplyFor` answers remaining supply
 * (limit − Σ held across the session's owners) for a genre pipeline to
 * enforce — the host never does; the prompt's state block and the ledger
 * name references by title with their count.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	attributeSlots,
	defineAttributeSlot,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-items-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const BAG = "test:slot/pack@1"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(BAG, {
		shape: "core:stat-shape/list@1",
		label: { en: "Pack" },
		descriptor: "What they carry.",
		appliesTo: ["cast", "world"]
	})
}

let n = 0
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-items-${suffix}`)
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
	const GENRE = `test:genre/items-${suffix}`
	genre(GENRE, { name: { en: "Items" }, family: "test", slots: attributeSlots(), events: {} })
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE })
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })
	await testDb
		// The real shape: the lorebook is the session row's own binding.
		.update(schema.sessions)
		.set({ lorebookId: lorebook.id })
		.where(eq(schema.sessions.id, session.id))
	let position = 0
	const entry = (lorebookId: number, title: string, typeId: string, fields: Record<string, unknown> = {}) =>
		testDb
			.insert(schema.lorebookEntries)
			.values({ lorebookId, typeId, typeVersion: 1, position: position++, title, content: "…", fields })
			.returning()
			.then((r) => r[0]!)
	const key = await entry(lorebook.id, "Rusty key", "core:entry/item", {
		supply: "limited",
		supplyLimit: 3
	})
	const crown = await entry(lorebook.id, "The Crown", "core:entry/item", { supply: "unique" })
	const coin = await entry(lorebook.id, "Coin", "core:entry/item", { supply: "unlimited" })
	const foreign = await entry(elsewhere.id, "Foreign blade", "core:entry/item")
	return { user, verity, session, key, crown, coin, foreign }
}

const db = () => testDb as unknown as Db
const worldOwner = (id: number) => ({ kind: "session" as const, id })
const castOwner = (id: number) => ({ kind: "session_cast" as const, id })

describe("held counts through the write gate", () => {
	test("a counted reference is stored with its count and read back named", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor, valueOf } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const owner = castOwner(w.verity.id)
		await applyChange(db(), ctx, { owner, slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 2 }] })
		await applyChange(db(), ctx, { owner, slotId: BAG, op: "add", items: ["rope", { entryId: w.key.id, count: 1 }] })
		expect(await valueOf(db(), { sessionId: w.session.id, owner, slotId: BAG })).toEqual([
			{ entryId: w.key.id, count: 3 },
			"rope"
		])
		const state = await stateFor(db(), w.session.id)
		const member = state.cast.byId[String(w.verity.id)] as Record<string, unknown>
		expect(member.pack).toEqual([{ entryId: w.key.id, count: 3, name: "Rusty key" }, "rope"])
		await applyChange(db(), ctx, { owner, slotId: BAG, op: "remove", items: [{ entryId: w.key.id, count: 2 }] })
		// Down to one: stored bare, the one spelling of a single item (phase 4).
		expect(await valueOf(db(), { sessionId: w.session.id, owner, slotId: BAG })).toEqual([
			{ entryId: w.key.id },
			"rope"
		])
	})

	test("a count below one is refused", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		await expect(
			applyChange(
				db(),
				{ sessionId: w.session.id, updatedBy: "user" },
				{ owner: worldOwner(w.session.id), slotId: BAG, value: [{ entryId: w.key.id, count: 0 }] }
			)
		).rejects.toThrow(/count of at least 1/)
	})
})

describe("a reference must be to the session's own lorebook", () => {
	test("applyChange and proposeChange refuse another lorebook's entry, and a missing one", async () => {
		declareSlots()
		const w = await world()
		const { applyChange, proposeChange, StateRefusal } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const owner = worldOwner(w.session.id)
		await expect(
			applyChange(db(), ctx, { owner, slotId: BAG, value: [{ entryId: w.foreign.id }] })
		).rejects.toThrow(/not in this session's lorebook/)
		await expect(
			proposeChange(db(), ctx, { owner, slotId: BAG, op: "add", items: [{ entryId: w.foreign.id, count: 1 }] })
		).rejects.toThrow(StateRefusal)
		await expect(
			applyChange(db(), ctx, { owner, slotId: BAG, op: "add", items: [{ entryId: 987654 }] })
		).rejects.toThrow(/does not exist/)
		// Nothing landed.
		const rows = await testDb.select().from(schema.attributeValues)
		expect(rows.filter((r) => r.sessionId === w.session.id)).toEqual([])
		// Its own lorebook's entry is fine, and removing a reference is never
		// refused — an entry since moved or deleted must still be removable.
		await applyChange(db(), ctx, { owner, slotId: BAG, value: [{ entryId: w.key.id }] })
		await applyChange(db(), ctx, { owner, slotId: BAG, op: "remove", items: [{ entryId: w.foreign.id }] })
	})

	test("state:set refuses it at the socket door", async () => {
		declareSlots()
		const w = await world()
		const { stateSet } = await import("$lib/server/sockets/state")
		const emitted: Array<[string, unknown]> = []
		const socket = { user: { id: w.user.id }, io: { to: () => ({ emit: () => {} }) } } as any
		await stateSet
			.handler(
				socket,
				{ sessionId: w.session.id, owner: worldOwner(w.session.id), slotId: BAG, value: [{ entryId: w.foreign.id }] } as any,
				(event: string, data: unknown) => emitted.push([event, data])
			)
			.catch(() => {})
		const refusal = emitted.find(([event]) => event === "state:set:error")
		expect(String((refusal?.[1] as { error?: string })?.error)).toMatch(/not in this session's lorebook/)
		const rows = await testDb.select().from(schema.attributeValues)
		expect(rows.filter((r) => r.sessionId === w.session.id)).toEqual([])
	})
})

describe("item supply — answered, never enforced", () => {
	test("remaining = limit − Σ held across the world and the cast", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await applyChange(db(), ctx, {
			owner: castOwner(w.verity.id),
			slotId: BAG,
			value: [{ entryId: w.key.id, count: 2 }, { entryId: w.crown.id }]
		})
		await applyChange(db(), ctx, {
			owner: worldOwner(w.session.id),
			slotId: BAG,
			value: [{ entryId: w.key.id }, { entryId: w.coin.id, count: 40 }]
		})
		// Over-held is not refused by the host: the pipeline decides.
		await applyChange(db(), ctx, {
			owner: worldOwner(w.session.id),
			slotId: BAG,
			op: "add",
			items: [{ entryId: w.crown.id, count: 1 }]
		})
		const supply = await itemSupplyFor(db(), w.session.id)
		const by = Object.fromEntries(supply.map((s) => [s.entryId, s]))
		expect(by[w.key.id]).toMatchObject({ name: "Rusty key", supply: "limited", limit: 3, held: 3, remaining: 0 })
		expect(by[w.crown.id]).toMatchObject({ supply: "unique", limit: 1, held: 2, remaining: 0 })
		expect(by[w.coin.id]).toMatchObject({ supply: "unlimited", limit: null, held: 40, remaining: null })
		expect(by[w.key.id].holders).toEqual(
			expect.arrayContaining([
				{ ownerKind: "session_cast", ownerId: w.verity.id, slotId: BAG, count: 2 },
				{ ownerKind: "session", ownerId: w.session.id, slotId: BAG, count: 1 }
			])
		)
		// Another lorebook's item is not this session's to answer for.
		expect(by[w.foreign.id]).toBeUndefined()
		const asked = await itemSupplyFor(db(), w.session.id, [w.coin.id, w.foreign.id])
		expect(asked.map((s) => s.entryId)).toEqual([w.coin.id])
	})

	test("core:query/item-supply@1 publishes it for a pipeline", async () => {
		declareSlots()
		const w = await world()
		const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
		const query = stateBindings({ runId: "items" })["core:query/item-supply@1"]!
		const out: any = await query(
			{ scope: { sessionId: w.session.id }, entryIds: [w.key.id] } as any,
			{ read: async () => null } as any
		)
		expect(out.value.supply).toEqual(out.value.main)
		expect(out.value.supply).toEqual([
			expect.objectContaining({ entryId: w.key.id, supply: "limited", limit: 3, held: 0, remaining: 3 })
		])
	})
})

describe("references as a prompt and a ledger read them", () => {
	test("the state block says 'Rusty key ×2', never an object", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		const { stateSummary, slotGuide } = await import("$lib/server/pipelines/prompt/adventureContext")
		await applyChange(
			db(),
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: castOwner(w.verity.id), slotId: BAG, value: [{ entryId: w.key.id, count: 2 }, "rope"] }
		)
		const state = await stateFor(db(), w.session.id)
		const summary = stateSummary(state as any, [w.verity.name])
		expect(summary).toContain(`${w.verity.name}: pack Rusty key ×2, rope.`)
		expect(summary).not.toMatch(/object Object|entryId/)
		expect(slotGuide(state as any)).toMatch(/- pack: a list of items/)
	})

	test("a ledger line names a reference by its title and count", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const { stateLedger } = await import("$lib/server/sockets/state")
		const { ledgerLines } = await import("$lib/shared/state/ledgerLines")
		await applyChange(
			db(),
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: worldOwner(w.session.id), slotId: BAG, value: [{ entryId: w.key.id, count: 2 }] }
		)
		const socket = { user: { id: w.user.id }, io: { to: () => ({ emit: () => {} }) } } as any
		const res: any = await stateLedger.handler(socket, { sessionId: w.session.id } as any, () => {})
		const lines = ledgerLines(res.rows, res.baselines)
		expect(lines.map((l) => l.text)).toContain("Pack → Rusty key ×2")
	})
})
