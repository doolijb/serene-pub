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
	genre(GENRE, {
		name: { en: "Stats" },
		family: "test",
		slots: [hp],
		events: {}
	})
}

let n = 0

async function world() {
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
			genreId: GENRE
		})
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })
	await testDb
		.insert(schema.sessionLorebooks)
		.values({ sessionId: session.id, lorebookId: lorebook.id })
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
					{
						owner: { kind: "session_cast", id: w.verity.id },
						entryId: w.key.id,
						delta: 1
					}
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
		const w = await world()
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(testDb as unknown as Db, w.session.id)
		expect(state.slots).toEqual([
			{ id: HP, key: "hp", type: "integer", appliesTo: ["cast"] }
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

	test("give_item and take_item are one edge each, signed", async () => {
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
			{
				owner: { kind: "session_cast", id: w.verity.id },
				entryId: w.key.id,
				delta: 2
			},
			{
				owner: { kind: "session_cast", id: w.verity.id },
				entryId: w.key.id,
				delta: -1
			}
		])
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
		expect(out.value.changes.some((c: any) => c.entryId === w.key.id)).toBe(true)
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
					{ owner: verity, entryId: w.key.id, delta: 1 }
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
