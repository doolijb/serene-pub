/**
 * The pipeline's share of stats and states.
 *
 * `core:task/set-state@1` defaults to **propose**, and that default is the
 * design rather than a convenience: a spec that wires a model's output straight
 * into this node produces pending lines rather than silent changes, and a genre
 * that wants the other behaviour has to say so. The three tools never apply at
 * all. `core:query/session-state@1` is what puts the resolved state where a
 * template can read it.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
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
		path.join(os.tmpdir(), "serene-pub-vitest-state-nodes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const INVENTORY = "core:slot/inventory@1"

/**
 * ⚠ A session resolves the slots ITS GENRE brings, so the sessions below carry
 * this id — a declaration alone does not put a stat on every session in the
 * process, which is what keeps a standard chat free of bars.
 */
const GENRE = "test:genre/stats"

function declareSlots() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	// Phase 3b: an item moving is an add/remove on this list stat.
	const inventory = defineAttributeSlot(INVENTORY, {
		shape: "core:stat-shape/list@1",
		descriptor: "What they carry.",
		appliesTo: ["cast", "world"]
	})
	genre(GENRE, {
		name: { en: "Stats" },
		family: "test",
		slots: [hp, inventory],
		events: {}
	})
	// A genre that does not carry inventory, for the refusal.
	genre(BARE_GENRE, { name: { en: "Bare" }, family: "test", slots: [hp], events: {} })
}

const BARE_GENRE = "test:genre/stats-bare"
const inventoryAdd = (ownerId: number, entryId: number, count: number) => ({
	owner: { kind: "session_cast", id: ownerId },
	slotId: INVENTORY,
	op: "add",
	items: [{ entryId, count }]
})

let n = 0

async function world(genreId = GENRE) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-node-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: `Verity ${suffix}`,
			description: "…"
		})
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId
		})
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })
	await testDb
		// The real shape: the lorebook is the session row's own binding.
		.update(schema.sessions)
		.set({ lorebookId: lorebook.id })
		.where(eq(schema.sessions.id, session.id))
	const [key] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: lorebook.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 0,
			title: "A rusty key",
			content: "Green with age."
		})
		.returning()
	// ⚠ The message is VERITY'S, and that is load-bearing under the turn lock
	// (R9): a change to a cast member anchors to that character's own latest
	// reply. A message with no speaker would leave her anchor null — which is
	// the legitimate before-her-first-reply case, tested in `write.int.test.ts`
	// — and nothing here would be filed against a message at all.
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			characterId: verity.id,
			content: "…"
		})
		.returning()
	await testDb.insert(schema.messages).values({
		id: legacy.id,
		sessionId: session.id,
		characterId: verity.id,
		role: "assistant"
	})
	return { user, verity, lorebook, session, key, message: legacy }
}

const node = async (id: string, runId = "abc") => {
	const { stateBindings } = await import("./bindings.state")
	return stateBindings({ runId })[id]!
}

const castKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_")

describe("core:task/set-state@1", () => {
	test("proposes by default — nothing is applied", async () => {
		declareSlots()
		const w = await world()
		const setState = await node("core:task/set-state@1")
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				changes: [
					{
						owner: { kind: "session_cast", id: w.verity.id },
						slotId: HP,
						value: 14
					}
				]
			},
			{} as any
		)
		expect(out.value.applied).toHaveLength(0)
		expect(out.value.proposed).toHaveLength(1)

		const { valueOf } = await import("$lib/server/state/resolve")
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP
			})
		).toBe(20)
	})

	test("applies when told to, stamped with the run", async () => {
		declareSlots()
		const w = await world()
		const setState = await node("core:task/set-state@1", "run-7")
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				changes: [
					{
						owner: { kind: "session_cast", id: w.verity.id },
						slotId: HP,
						value: 14
					},
					inventoryAdd(w.verity.id, w.key.id, 1)
				]
			},
			{} as any
		)
		expect(out.value.proposed).toHaveLength(0)
		expect(out.value.applied).toHaveLength(2)

		const [written] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, out.value.applied[0]))
		expect(written.updatedBy).toBe("run:run-7")
		expect(written.validFromMessageId).toBe(w.message.id)
	})

	test("a refused change is a result, not the end of the turn", async () => {
		declareSlots()
		const w = await world()
		const setState = await node("core:task/set-state@1")
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				changes: [
					{
						owner: { kind: "session_cast", id: w.verity.id },
						slotId: HP,
						value: 99
					},
					{
						owner: { kind: "session_cast", id: w.verity.id },
						slotId: HP,
						value: 11
					}
				]
			},
			{} as any
		)
		expect(out.value.applied).toHaveLength(1)
		expect(out.value.main.refused[0]).toMatch(/does not go above 20/)
	})

	test("refuses to HOLD a change nothing could ever accept", async () => {
		// The gate exists for the writer with no authority, and a gate that
		// holds a change no accept could apply is a gate reporting nonsense as
		// a decision. Live, from a Rest: stamina 90 on a slot that stops at 10,
		// and every one of them drawn with Accept and Reject beside it.
		declareSlots()
		const w = await world()
		const setState = await node("core:task/set-state@1")
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				changes: [
					{
						owner: { kind: "session_cast", id: w.verity.id },
						slotId: HP,
						value: 90
					},
					{
						owner: { kind: "session_cast", id: w.verity.id },
						slotId: HP,
						value: 9
					}
				]
			},
			{} as any
		)
		expect(out.value.proposed).toHaveLength(1)
		expect(out.value.main.refused[0]).toMatch(/does not go above 20/)

		const held = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(held).toHaveLength(1)
		expect((held[0]!.payload as any).value).toBe(9)
	})

	test("halts rather than guessing when no session was wired", async () => {
		declareSlots()
		const setState = await node("core:task/set-state@1")
		const out: any = await setState({ changes: [] }, {} as any)
		expect(out.kind).toBe("halt")
	})
})

describe("core:query/session-state@1", () => {
	test("publishes the resolved state on both ports", async () => {
		declareSlots()
		const w = await world()
		const { stateFor } = await import("$lib/server/state/resolve")
		const query = await node("core:query/session-state@1")
		const out: any = await query({ scope: { sessionId: w.session.id } }, {
			read: async (table: string, q: any) => {
				expect(table).toBe("session_state")
				return await stateFor(testDb as unknown as Db, q.sessionId)
			}
		} as any)
		expect(out.value.main).toEqual(out.value.state)
		expect(out.value.state.cast[castKey(w.verity.name)]).toBeTruthy()
	})

	test("publishes the vocabulary, not only the values in it", async () => {
		// A slot with no default has no VALUE until somebody sets it, so a
		// reader given only the keys that have values cannot see the whole of
		// what a session tracks — and a state-keeper shown that list can never
		// name the slot nobody has set yet.
		declareSlots()
		const w = await world(BARE_GENRE)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(testDb as unknown as Db, w.session.id)
		expect(state.slots).toEqual([
			// `field` since phase 2 (stat shapes): the slot's value as a FieldDecl.
			{ id: HP, key: "hp", type: "integer", field: { type: "integer" }, appliesTo: ["cast"] }
		])
	})

	test("what it publishes is what a template reads as `state`", async () => {
		declareSlots()
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 14
			}
		)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(testDb as unknown as Db, w.session.id)

		const { buildTemplateContext } = await import(
			"$lib/server/pipelines/prompt/templateContext"
		)
		const context = await buildTemplateContext({
			characters: [],
			personas: [],
			characterNames: [],
			personaNames: [],
			charName: w.verity.name,
			personaName: "Rell",
			state
		})
		expect(context.state?.cast[castKey(w.verity.name)]?.hp).toBe(14)
	})

	test("a context nobody supplied state to has none", async () => {
		const { buildTemplateContext } = await import(
			"$lib/server/pipelines/prompt/templateContext"
		)
		const context = await buildTemplateContext({
			characters: [],
			personas: [],
			characterNames: [],
			personaNames: [],
			charName: "Ash",
			personaName: "Rell"
		})
		expect("state" in context).toBe(false)
	})
})

describe("the three tools", () => {
	/** A tool context with the two doors a state tool needs and nothing else. */
	const toolCtx = (
		w: Awaited<ReturnType<typeof world>>,
		proposals: any[]
	) => ({
		sessionId: w.session.id,
		read: async () => [
			{ character: { id: w.verity.id, name: w.verity.name } }
		],
		propose: async (change: unknown) => {
			proposals.push(change)
			const { proposeChange } = await import("$lib/server/state/write")
			return await proposeChange(
				testDb as unknown as Db,
				{ sessionId: w.session.id, updatedBy: "run:abc" },
				change as never
			)
		}
	})

	test("set_state asks, and says so in the future tense", async () => {
		declareSlots()
		const w = await world()
		const proposals: any[] = []
		const { setState } = await import("./tools/stateTools")
		const result: any = await setState.run(
			{ owner: w.verity.name, slot: "hp", value: 14 },
			toolCtx(w, proposals) as any
		)
		expect(result.status).toBe("proposed")
		expect(result.message).toMatch(/waiting for the player/)
		expect(proposals[0]).toEqual({
			owner: { kind: "session_cast", id: w.verity.id },
			slotId: HP,
			value: 14
		})
		const { valueOf } = await import("$lib/server/state/resolve")
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP
			})
		).toBe(20)
	})

	test("give_item and take_item are an inventory add and remove, counted", async () => {
		declareSlots()
		const w = await world()
		const proposals: any[] = []
		const { giveItem, takeItem } = await import("./tools/stateTools")
		await giveItem.run(
			{ owner: w.verity.name, entry_id: w.key.id, quantity: 2 },
			toolCtx(w, proposals) as any
		)
		await takeItem.run(
			{ owner: w.verity.name, entry_id: w.key.id },
			toolCtx(w, proposals) as any
		)
		expect(proposals).toEqual([
			inventoryAdd(w.verity.id, w.key.id, 2),
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: INVENTORY,
				op: "remove",
				items: [{ entryId: w.key.id, count: 1 }]
			}
		])
		// Through the real gate: proposed, accepted, counted.
		const { proposeChange, decideProposal } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const db = testDb as unknown as Db
		const ctx = { sessionId: w.session.id, updatedBy: "run:tool" }
		for (const p of proposals) await decideProposal(db, await proposeChange(db, ctx, p), true)
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: INVENTORY
			})
			// One held is stored bare (phase 4).
		).toEqual([{ entryId: w.key.id }])
	})

	test("a name nobody in the scene answers to is refused by name", async () => {
		declareSlots()
		const w = await world()
		const { setState } = await import("./tools/stateTools")
		await expect(
			setState.run(
				{ owner: "Brannoc", slot: "hp", value: 1 },
				toolCtx(w, []) as any
			)
		).rejects.toThrow(/nobody called 'Brannoc'/)
	})

	test("all three are advertised beside the four reads", async () => {
		const { CORE_TOOLS } = await import("./tools/coreTools")
		expect(CORE_TOOLS.map((t) => t.name)).toEqual([
			"search_entries",
			"get_entry",
			"grep_transcript",
			"read_summary",
			"set_state",
			"give_item",
			"take_item"
		])
	})
})

/**
 * R-15 *Staleness and order* at the nodes (plans/30 U5f): the state query
 * publishes `version`; `resolve-state-changes` passes `base` through onto
 * every change; `set-state` in `apply` mode refuses a delta whose slot moved
 * past its base onto the `refused` port and applies the rest, and in
 * `propose` mode stamps the base on the proposal.
 */
describe("R-15 · staleness and order at the nodes (U5f)", () => {
	test("session-state publishes the version on its own port", async () => {
		declareSlots()
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: { kind: "session_cast", id: w.verity.id }, slotId: HP, value: 14 }
		)
		const query = await node("core:query/session-state@1")
		const out: any = await query({ scope: { sessionId: w.session.id } }, {
			read: async (_t: string, q: any) =>
				await stateFor(testDb as unknown as Db, q.sessionId)
		} as any)
		expect(out.value.version).toBe(1)
		expect(out.value.state.version).toBe(1)
	}, 60_000)

	test("resolve-state-changes carries base onto every change it resolves", async () => {
		declareSlots()
		const w = await world()
		const resolve = await node("core:query/resolve-state-changes@1")
		const out: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				base: 7,
				changes: [
					{ owner: w.verity.name, slot: "hp", value: "3" },
					{ owner: w.verity.name, entryId: w.key.id, delta: 1 }
				]
			},
			{
				// The cast, as the host publishes it for `ownerFor`.
				read: async () => [
					{ character: { id: w.verity.id, name: w.verity.name } }
				]
			} as any
		)
		expect(out.value.refused).toEqual([])
		expect(out.value.changes).toHaveLength(2)
		expect(out.value.changes.every((c: any) => c.base === 7)).toBe(true)
		expect(out.value.changes).toContainEqual({ ...inventoryAdd(w.verity.id, w.key.id, 1), base: 7 })
		// No base wired: none is invented.
		const bare: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				changes: [{ owner: w.verity.name, slot: "hp", value: "4" }]
			},
			{
				read: async () => [
					{ character: { id: w.verity.id, name: w.verity.name } }
				]
			} as any
		)
		expect(bare.value.changes[0].base).toBeUndefined()
	}, 60_000)

	test("apply with a base behind: a moved slot lands on refused with the versions, untouched slots apply; propose stamps the base", async () => {
		declareSlots()
		const w = await world()
		const { applyChange } = await import("$lib/server/state/write")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }
		await applyChange(db, user, { owner: verity, slotId: HP, value: 19 }) // v1 — what the run read
		await applyChange(db, user, { owner: verity, slotId: HP, value: 18 }) // v2 — hp moved since

		const setState = await node("core:task/set-state@1", "run-9")
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				base: 1,
				changes: [
					{ owner: verity, slotId: HP, value: 5 },
					inventoryAdd(w.verity.id, w.key.id, 1)
				]
			},
			{} as any
		)
		expect(out.value.applied).toHaveLength(1)
		expect(out.value.refused).toEqual([
			"hp changed since this run read it (v1 → v2); resolve-state-changes must rebase on the next turn"
		])
		expect(out.value.main.refused).toEqual(out.value.refused)
		// A change carrying its own base keeps it over the node's.
		const own: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				base: 1,
				changes: [{ owner: verity, slotId: HP, value: 5, base: 3 }]
			},
			{} as any
		)
		expect(own.value.applied).toHaveLength(1)
		expect(own.value.refused).toEqual([])

		// Propose: the base rides the row.
		const proposed: any = await setState(
			{
				scope: { sessionId: w.session.id },
				base: 2,
				changes: [{ owner: verity, slotId: HP, value: 7 }]
			},
			{} as any
		)
		expect(proposed.value.proposed).toHaveLength(1)
		const [row] = await testDb
			.select({ baseVersion: schema.stateProposals.baseVersion })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, proposed.value.proposed[0]))
		expect(row!.baseVersion).toBe(2)
	}, 60_000)
})

/**
 * Phase 3b: the keeper's item arm resolves onto the inventory stat, and item
 * supply is checked only where a genre wired `core:query/item-supply@1`'s
 * answer onto the resolver (Adventure does) — core itself never enforces it.
 */
describe("the item arm and item supply (phase 3b)", () => {
	const castRead = (w: Awaited<ReturnType<typeof world>>) =>
		({
			read: async () => [{ character: { id: w.verity.id, name: w.verity.name } }]
		}) as any

	async function items(w: Awaited<ReturnType<typeof world>>) {
		const entry = async (title: string, fields: Record<string, unknown>, position: number) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: w.lorebook.id,
						typeId: "core:entry/item",
						typeVersion: 1,
						position,
						title,
						content: "…",
						fields
					})
					.returning()
			)[0]!
		return {
			crown: await entry("The Crown", { supply: "unique" }, 10),
			arrows: await entry("Arrows", { supply: "limited", supplyLimit: 3 }, 11)
		}
	}

	test("a supply check refuses an over-limit grant, and a take frees what it held", async () => {
		declareSlots()
		const w = await world()
		const { crown, arrows } = await items(w)
		const db = testDb as unknown as Db
		const { applyChange } = await import("$lib/server/state/write")
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		// The crown is already in Verity's pack; two of three arrows are held.
		await applyChange(db, { sessionId: w.session.id, updatedBy: "user" }, {
			owner: { kind: "session", id: w.session.id },
			slotId: INVENTORY,
			value: [{ entryId: crown.id }, { entryId: arrows.id, count: 2 }]
		})
		const supply = await itemSupplyFor(db, w.session.id)
		const resolve = await node("core:query/resolve-state-changes@1")
		const out: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				supply,
				changes: [
					{ owner: w.verity.name, entryId: crown.id, delta: 1 },
					{ owner: w.verity.name, entryId: arrows.id, delta: 2 },
					{ owner: w.verity.name, entryId: arrows.id, delta: 1 }
				]
			},
			castRead(w)
		)
		expect(out.value.refused).toEqual([
			"The Crown is unique and is already held, so it cannot be handed out again.",
			"only 1 of Arrows is left (of 3), so 2 cannot be handed out."
		])
		expect(out.value.changes).toEqual([inventoryAdd(w.verity.id, arrows.id, 1)])

		// The world gives the crown up in the same turn it hands it on: the
		// take is counted first, whatever order the model wrote them in.
		const handed: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				supply: await itemSupplyFor(db, w.session.id),
				changes: [
					{ owner: w.verity.name, entryId: crown.id, delta: 1 },
					{ owner: "world", entryId: crown.id, delta: -1 }
				]
			},
			castRead(w)
		)
		expect(handed.value.refused).toEqual([])
		expect(handed.value.changes.map((c: any) => [c.owner.kind, c.op])).toEqual([
			["session", "remove"],
			["session_cast", "add"]
		])

		// Unwired, nothing is checked: core never enforces supply.
		const unwired: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				changes: [{ owner: w.verity.name, entryId: crown.id, delta: 1 }]
			},
			castRead(w)
		)
		expect(unwired.value.refused).toEqual([])
		expect(unwired.value.changes).toHaveLength(1)
	})

	test("a session that does not track inventory refuses the item line by name", async () => {
		declareSlots()
		const w = await world(BARE_GENRE)
		const resolve = await node("core:query/resolve-state-changes@1")
		const out: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				changes: [
					{ owner: w.verity.name, entryId: w.key.id, delta: 1 },
					{ owner: w.verity.name, slot: "hp", value: "12" }
				]
			},
			castRead(w)
		)
		expect(out.value.refused).toEqual([expect.stringMatching(/is not tracked in this session/)])
		expect(out.value.changes).toHaveLength(1)
		expect(out.value.changes[0].slotId).toBe(HP)
	})
})

/**
 * 2026-09-27 (owner ruling): the keeper's item arm is `inventory`, the stat it
 * resolves onto (was `possessions`; no alias — owner: "keep it clean"). The
 * arm's NAME never reaches `resolve-state-changes` — the keeper's `path` joins
 * `values` and the item arm into one list first — so the shipped path is what
 * has to say `inventory`.
 */
describe("the keeper's inventory arm (2026-09-27)", () => {
	const castRead = (w: Awaited<ReturnType<typeof world>>) =>
		({
			read: async () => [{ character: { id: w.verity.id, name: w.verity.name } }]
		}) as any

	const KEEPERS: Array<[slug: string, nodeKey: string]> = [
		["core:spec/adventure-respond", "keeperWrite"],
		["core:spec/lair-respond", "keep.played.keeperWrite"]
	]
	const shippedPath = async (slug: string, nodeKey: string) => {
		const { coreAnnouncement } = await import("@serene-pub/core-catalog")
		const doc = (coreAnnouncement().document as any).pipelines.find((p: any) => p.id === slug)
		const preset = doc.presets.find((p: any) => p.default)
		return preset.values.find((v: any) => v.nodeKey === nodeKey)?.value?.path as string
	}

	/** Answer → shipped path → resolver → set-state apply → the held list. */
	async function applyAnswer(
		w: Awaited<ReturnType<typeof world>>,
		answer: Record<string, unknown>,
		path: string
	) {
		const { selectJsonPaths } = await import("./bindings")
		const { items } = selectJsonPaths(answer, path)
		const resolve = await node("core:query/resolve-state-changes@1")
		const resolved: any = await resolve(
			{ scope: { sessionId: w.session.id }, changes: items },
			castRead(w)
		)
		expect(resolved.value.refused).toEqual([])
		const setState = await node("core:task/set-state@1")
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				changes: resolved.value.changes
			},
			{} as any
		)
		const { valueOf } = await import("$lib/server/state/resolve")
		return {
			changes: resolved.value.changes,
			applied: out.value.applied,
			held: await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: INVENTORY
			})
		}
	}

	test("every shipped keeper selects `values,inventory`, and its inventory arm applies", async () => {
		declareSlots()
		for (const [slug, nodeKey] of KEEPERS)
			expect(await shippedPath(slug, nodeKey), slug).toBe("values,inventory")
		const w = await world()
		const got = await applyAnswer(
			w,
			{
				values: [{ owner: w.verity.name, slot: "hp", value: "12" }],
				inventory: [{ owner: w.verity.name, entryId: w.key.id, delta: 2 }]
			},
			await shippedPath("core:spec/adventure-respond", "keeperWrite")
		)
		expect(got.changes).toHaveLength(2)
		expect(got.changes[1]).toEqual(inventoryAdd(w.verity.id, w.key.id, 2))
		expect(got.applied).toHaveLength(2)
		expect(got.held).toEqual([{ entryId: w.key.id, count: 2 }])
	})

	test("the retired name is not read: an answer written with `possessions` moves nothing", async () => {
		const { selectJsonPaths } = await import("./bindings")
		const line = { owner: "Verity", entryId: 1, delta: 1 }
		expect(selectJsonPaths({ values: [], possessions: [line] }, "values,inventory").items).toEqual([])
		expect(selectJsonPaths({ values: [], inventory: [line] }, "values,inventory").items).toEqual([line])
	})
})
