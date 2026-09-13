/**
 * `state:*` end to end.
 *
 * Three things this file is here to hold: a user's edit applies immediately and
 * is validated against the configuration in force for *that* owner; a model's
 * proposal does not apply until somebody decides it; and every write tells the
 * rest of the session, because one edit can move several reads and nobody
 * downstream is allowed a second resolver.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		path.join(os.tmpdir(), "serene-pub-vitest-state-sockets-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const WEATHER = "core:slot/weather@1"

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
	const weather = defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "fog", "storm"] }
	})
	genre(GENRE, {
		name: { en: "Stats" },
		family: "test",
		slots: [hp, weather],
		events: {}
	})
}

/** Every broadcast the handler fanned out, so the last claim can be asserted. */
const broadcasts: { event: string; sessionId: number }[] = []

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: {
			to: () => ({
				emit: (event: string, data: any) =>
					broadcasts.push({
						event,
						sessionId: data?.sessionId
					})
			})
		}
	} as any
}

function capture() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => events.push({ event, data }),
		errorFor: (event: string) =>
			events.find((e) => e.event === `${event}:error`)?.data?.error as
				| string
				| undefined
	}
}

let n = 0

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-socket-${suffix}`)
	const stranger = await createTestUser(testDb, `state-stranger-${suffix}`)
	const mk = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "…" })
				.returning()
		)[0]
	const verity = await mk(`Verity ${suffix}`)
	const marrow = await mk(`Marrow ${suffix}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			genreId: GENRE
		})
		.returning()
	for (const c of [verity, marrow])
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session.id, characterId: c.id })
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
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session.id, role: "assistant", content: "…" })
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy.id, sessionId: session.id, role: "assistant" })
	return {
		user,
		stranger,
		verity,
		marrow,
		lorebook,
		session,
		key,
		message: legacy
	}
}

const castKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_")

describe("reads", () => {
	test("a session nobody may see reads as one that does not exist", async () => {
		declareSlots()
		const w = await world()
		const { stateGet } = await import("./state")
		const cap = capture()
		await expect(
			stateGet.handler(
				fakeSocket(w.stranger.id),
				{ sessionId: w.session.id },
				cap.emit
			)
		).rejects.toThrow(/Session not found/)
		expect(cap.errorFor("state:get")).toMatch(/Session not found/)
	})
})

describe("a user's edit", () => {
	test("applies immediately and comes back resolved", async () => {
		declareSlots()
		const w = await world()
		const { stateSet } = await import("./state")
		const res = await stateSet.handler(
			fakeSocket(w.user.id),
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 14
			},
			() => {}
		)
		expect(res.state.cast[castKey(w.verity.name)]?.hp).toBe(14)
	})

	test("is refused against the configuration in force, in a sentence", async () => {
		declareSlots()
		const w = await world()
		const { stateSet } = await import("./state")
		const cap = capture()
		await expect(
			stateSet.handler(
				fakeSocket(w.user.id),
				{
					sessionId: w.session.id,
					owner: { kind: "session_cast", id: w.verity.id },
					slotId: HP,
					value: 35
				},
				cap.emit
			)
		).rejects.toThrow(/does not go above 20/)
		expect(cap.errorFor("state:set")).toMatch(/does not go above 20/)
	})

	test("a raised cap makes the same write legal", async () => {
		declareSlots()
		const w = await world()
		const { stateConfigure, stateSet } = await import("./state")
		await stateConfigure.handler(
			fakeSocket(w.user.id),
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				config: { max: 40 }
			},
			() => {}
		)
		const res = await stateSet.handler(
			fakeSocket(w.user.id),
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 35
			},
			() => {}
		)
		expect(res.state.cast[castKey(w.verity.name)]?.hp).toBe(35)
	})

	test("tells the rest of the session that something moved", async () => {
		declareSlots()
		const w = await world()
		broadcasts.length = 0
		const { stateSet } = await import("./state")
		await stateSet.handler(
			fakeSocket(w.user.id),
			{
				sessionId: w.session.id,
				owner: { kind: "session", id: w.session.id },
				slotId: WEATHER,
				value: "storm"
			},
			() => {}
		)
		expect(broadcasts).toContainEqual({
			event: "state:changed",
			sessionId: w.session.id
		})
	})
})

describe("possessions", () => {
	test("give, take and transfer move the edge and nothing else", async () => {
		declareSlots()
		const w = await world()
		const { stateGive, stateTake, stateTransfer } = await import("./state")
		const socket = fakeSocket(w.user.id)
		const verity = castKey(w.verity.name)
		const marrow = castKey(w.marrow.name)

		let res = await stateGive.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				entryId: w.key.id,
				quantity: 2
			},
			() => {}
		)
		expect(res.state.possessions[verity]).toEqual([
			{ entryId: w.key.id, name: "A rusty key", quantity: 2 }
		])

		res = await stateTransfer.handler(
			socket,
			{
				sessionId: w.session.id,
				from: { kind: "session_cast", id: w.verity.id },
				to: { kind: "session_cast", id: w.marrow.id },
				entryId: w.key.id
			},
			() => {}
		)
		expect(res.state.possessions[verity]?.[0]?.quantity).toBe(1)
		expect(res.state.possessions[marrow]?.[0]?.quantity).toBe(1)

		res = await stateTake.handler(
			socket,
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.marrow.id },
				entryId: w.key.id
			},
			() => {}
		)
		// Zero is a row, not a deletion — so the owner simply carries nothing.
		expect(res.state.possessions[marrow]).toBeUndefined()
	})
})

describe("the gate", () => {
	test("a proposal is listed, decided once, and applied on accept", async () => {
		declareSlots()
		const w = await world()
		const { proposeChange } = await import("$lib/server/state/write")
		const { stateDecide, stateProposals } = await import("./state")
		const socket = fakeSocket(w.user.id)

		const id = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 6
			}
		)
		const listed = await stateProposals.handler(
			socket,
			{ sessionId: w.session.id },
			() => {}
		)
		expect(listed.proposals.map((p) => p.id)).toContain(id)

		const decided = await stateDecide.handler(
			socket,
			{ proposalId: id, accept: true },
			() => {}
		)
		expect(decided.status).toBe("accepted")
		expect(decided.proposals).toHaveLength(0)
		expect(decided.state.cast[castKey(w.verity.name)]?.hp).toBe(6)
	})

	test("a stranger cannot decide somebody else's proposal", async () => {
		declareSlots()
		const w = await world()
		const { proposeChange } = await import("$lib/server/state/write")
		const { stateDecide } = await import("./state")
		const id = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 6
			}
		)
		const cap = capture()
		await expect(
			stateDecide.handler(
				fakeSocket(w.stranger.id),
				{ proposalId: id, accept: true },
				cap.emit
			)
		).rejects.toThrow(/Session not found/)
	})
})
