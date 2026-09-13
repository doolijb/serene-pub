/**
 * `state:ledger` and the descriptors `state:get` carries.
 *
 * Two things this file holds. The transcript needs the ROWS, not the resolved
 * answer: which message changed what, in the order the changes landed, plus
 * what each slot read before this session touched it — none of which survives
 * resolution, because resolution's whole job is to answer "what is it now".
 * And a bar cannot be drawn from a value alone, so `state:get` answers with the
 * declarations and the configuration in force for each owner as well.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

// A file that builds a real database before it asserts anything outruns the
// default budget under a contended sweep.
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
		path.join(os.tmpdir(), "serene-pub-vitest-state-ledger-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const MOOD = "core:slot/mood@1"
const WEATHER = "core:slot/weather@1"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(HP, {
		type: "integer",
		label: "Health",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	defineAttributeSlot(MOOD, {
		type: "enum",
		descriptor: "How they are carrying themselves.",
		appliesTo: ["cast"],
		config: { of: ["calm", "wary", "furious"] }
	})
	defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "fog", "storm"] }
	})
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

let n = 0

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-ledger-${suffix}`)
	const stranger = await createTestUser(testDb, `ledger-stranger-${suffix}`)
	const mk = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "…" })
				.returning()
		)[0]
	const verity = await mk(`Verity ${suffix}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Run ${suffix}` })
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
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "assistant", content: "…" })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({ id: legacy.id, sessionId: session.id, role: "assistant" })
		return legacy
	}
	return { user, stranger, verity, lorebook, session, key, message }
}

describe("state:ledger", () => {
	test("a session nobody may see reads as one that does not exist", async () => {
		declareSlots()
		const w = await world()
		const { stateLedger } = await import("./state")
		const errors: string[] = []
		await expect(
			stateLedger.handler(
				fakeSocket(w.stranger.id),
				{ sessionId: w.session.id },
				(event: string, data: any) => {
					if (event.endsWith(":error")) errors.push(data.error)
				}
			)
		).rejects.toThrow(/Session not found/)
		expect(errors[0]).toMatch(/Session not found/)
	})

	test("answers with the rows a message changed, oldest first", async () => {
		declareSlots()
		const w = await world()
		const first = await w.message()
		const { stateSet, stateGive, stateLedger } = await import("./state")
		const socket = fakeSocket(w.user.id)
		await stateSet.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 14
			},
			() => {}
		)
		await stateGive.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				entryId: w.key.id
			},
			() => {}
		)
		const second = await w.message()
		await stateSet.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session", id: w.session.id },
				slotId: WEATHER,
				value: "storm"
			},
			() => {}
		)

		const res = await stateLedger.handler(
			socket,
			{ sessionId: w.session.id },
			() => {}
		)
		expect(
			res.rows.map((r) => ({
				kind: r.kind,
				messageId: r.messageId,
				slotId: r.slotId ?? null,
				value: r.value ?? null,
				entryId: r.entryId ?? null
			}))
		).toEqual([
			{
				kind: "value",
				messageId: first.id,
				slotId: HP,
				value: 14,
				entryId: null
			},
			{
				kind: "possession",
				messageId: first.id,
				slotId: null,
				value: null,
				entryId: w.key.id
			},
			{
				kind: "value",
				messageId: second.id,
				slotId: WEATHER,
				value: "storm",
				entryId: null
			}
		])
		// Names come from the row's owner and the entry, so a ledger line can be
		// read without a second lookup per row.
		expect(res.rows[0].ownerLabel).toBe(w.verity.name)
		expect(res.rows[1].itemName).toBe("A rusty key")
		expect(res.rows[1].quantity).toBe(1)
	})

	test("says what a slot read before the session touched it", async () => {
		declareSlots()
		const w = await world()
		await w.message()
		const { applyChange } = await import("$lib/server/state/write")
		// The world's own answer, at the layer a session inherits from. The
		// anchor is null because a template layer holds from the beginning.
		await applyChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user", messageId: null },
			{
				owner: { kind: "lorebook", id: w.lorebook.id },
				slotId: WEATHER,
				value: "fog"
			}
		)
		const { stateSet, stateLedger } = await import("./state")
		const socket = fakeSocket(w.user.id)
		await stateSet.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session", id: w.session.id },
				slotId: WEATHER,
				value: "storm"
			},
			() => {}
		)
		const res = await stateLedger.handler(
			socket,
			{ sessionId: w.session.id },
			() => {}
		)
		expect(res.baselines).toContainEqual({
			ownerKey: "world",
			slotId: WEATHER,
			value: "fog"
		})
	})

	test("a session that changed nothing has an empty ledger, not an error", async () => {
		declareSlots()
		const w = await world()
		const { stateLedger } = await import("./state")
		const res = await stateLedger.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			() => {}
		)
		expect(res.rows).toEqual([])
		expect(res.baselines).toEqual([])
	})
})

describe("what state:get carries beside the values", () => {
	test("every owner a value can belong to, keyed as the state is", async () => {
		declareSlots()
		const w = await world()
		const { stateGet } = await import("./state")
		const res = await stateGet.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			() => {}
		)
		expect(res.owners).toContainEqual({
			key: "world",
			kind: "session",
			id: w.session.id,
			label: w.session.name,
			configs: expect.any(Object)
		})
		const verity = res.owners.find((o) => o.kind === "session_cast")
		expect(verity).toMatchObject({ id: w.verity.id, label: w.verity.name })
	})

	test("a slot is described once, with the label a person reads", async () => {
		declareSlots()
		const w = await world()
		const { stateGet } = await import("./state")
		const res = await stateGet.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			() => {}
		)
		expect(res.slots).toContainEqual(
			expect.objectContaining({
				slotId: HP,
				key: "hp",
				label: "Health",
				type: "integer",
				appliesTo: ["cast"]
			})
		)
		// The descriptor is model-facing prose; it has no business on a bar.
		expect(
			(res.slots.find((s) => s.slotId === HP) as any).descriptor
		).toBeUndefined()
	})

	test("the configuration each owner carries is the one in force for it", async () => {
		declareSlots()
		const w = await world()
		const { stateConfigure, stateGet } = await import("./state")
		const socket = fakeSocket(w.user.id)
		await stateConfigure.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				config: { max: 40 }
			},
			() => {}
		)
		const res = await stateGet.handler(
			socket,
			{ sessionId: w.session.id },
			() => {}
		)
		const verity = res.owners.find((o) => o.kind === "session_cast")!
		// Merged, not replaced: raising the ceiling must not drop the floor.
		expect(verity.configs[HP]).toMatchObject({ min: 0, max: 40 })
		expect(
			res.owners.find((o) => o.key === "world")!.configs[WEATHER]
		).toMatchObject({ of: ["clear", "fog", "storm"] })
	})

	test("a slot only the world may carry is not offered to a cast member", async () => {
		declareSlots()
		const w = await world()
		const { stateGet } = await import("./state")
		const res = await stateGet.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			() => {}
		)
		const verity = res.owners.find((o) => o.kind === "session_cast")!
		expect(Object.keys(verity.configs)).toContain(MOOD)
		expect(Object.keys(verity.configs)).not.toContain(WEATHER)
	})
})
