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

// The real resolver, behind a spy one test can make fail once.
vi.mock("$lib/server/state/resolve", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/state/resolve")>()
	return { ...real, stateFor: vi.fn(real.stateFor) }
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

/**
 * An io whose every user room holds one socket that wants everything.
 *
 * `state:changed` is a GATED event, so `emitRedacted` asks `hasInterest` before
 * it delivers and a room it cannot walk is a room with no interest in it. The
 * room name doubles as the socket id here, which is enough for the gate's
 * lookups and keeps this a fixture rather than a second implementation.
 *
 * The declared key is BARE, which means every scope: `state:changed` is scoped
 * per session now, and a fixture pinned to one session id would answer for one
 * of these tests and go silent on the next.
 */
function interestedIo() {
	const wanting = (id: string) => ({
		id,
		user: { id: Number(id.slice("user_".length)) },
		interest: new Set(["state:changed"])
	})
	return {
		to: () => ({
			emit: (event: string, data: any) =>
				broadcasts.push({
					event,
					sessionId: data?.sessionId
				})
		}),
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) =>
						room.startsWith("user_")
							? new Set([room])
							: undefined
				}
			},
			sockets: {
				get: (id: string) => wanting(id),
				// `broadcastToSessionUsers` asks whether ANY connected socket
				// wants the event before it reads the session's roster — it
				// cannot know whose rooms to walk until it has. This fixture's
				// premise is that one of them wants everything.
				values: () => [wanting("user_0")]
			}
		}
	}
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: interestedIo()
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
		expect(res.state?.cast[castKey(w.verity.name)]?.hp).toBe(14)
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
		expect(res.state?.cast[castKey(w.verity.name)]?.hp).toBe(35)
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

describe("the retired possession sockets (phase 3b)", () => {
	test("state:give, state:take and state:transfer have no handler and no gate entry", async () => {
		const mod = await import("./state")
		const registered: string[] = []
		mod.registerStateHandlers({} as any, () => {}, (_s, handler) => {
			registered.push(handler.event)
		})
		for (const event of ["state:give", "state:take", "state:transfer"]) {
			expect(registered).not.toContain(event)
			expect(Object.values(mod).some((h: any) => h?.event === event)).toBe(false)
		}
		// Still a real registrar: the writes that remain are there.
		expect(registered).toContain("state:set")
		const { GATED_EVENTS } = await import("$lib/shared/sockets/interest")
		for (const event of ["state:give", "state:take", "state:transfer"])
			expect(GATED_EVENTS.has(event)).toBe(false)
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

describe("R-15 · staleness and order over the wire (U5f)", () => {
	test("an accept whose slot moved comes back superseded, with the slot named, and the row listed collapsed", async () => {
		declareSlots()
		const w = await world()
		const { applyChange, proposeChange } = await import(
			"$lib/server/state/write"
		)
		const { stateDecide, stateProposals } = await import("./state")
		const socket = fakeSocket(w.user.id)
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }

		const id = await proposeChange(
			db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner: verity, slotId: HP, value: 6 }
		)
		// The person edits the same bar before deciding: the slot moved.
		await applyChange(
			db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: verity, slotId: HP, value: 12 }
		)

		const decided = await stateDecide.handler(
			socket,
			{ proposalId: id, accept: true },
			() => {}
		)
		expect(decided.status).toBe("superseded")
		expect(decided.movedSlots).toEqual(["hp"])
		// Nothing applied: the edit stands, and the state carries its version.
		expect(decided.state.cast[castKey(w.verity.name)]?.hp).toBe(12)
		expect(decided.state.version).toBe(1)
		// The row is still listed — collapsed, for the widget to say why.
		const row = decided.proposals.find((p) => p.id === id)
		expect(row?.status).toBe("superseded")
		expect(row?.baseVersion).toBe(0)
		const listed = await stateProposals.handler(
			socket,
			{ sessionId: w.session.id },
			() => {}
		)
		expect(listed.proposals.find((p) => p.id === id)?.status).toBe(
			"superseded"
		)
	}, 60_000)

	test("an accept whose slot is untouched since the base is the rebase — applied as before", async () => {
		declareSlots()
		const w = await world()
		const { applyChange, proposeChange } = await import(
			"$lib/server/state/write"
		)
		const { stateDecide } = await import("./state")
		const socket = fakeSocket(w.user.id)
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const marrow = { kind: "session_cast" as const, id: w.marrow.id }

		const id = await proposeChange(
			db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner: verity, slotId: HP, value: 6 }
		)
		// A different slot moves.
		await applyChange(
			db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: marrow, slotId: HP, value: 4 }
		)
		const decided = await stateDecide.handler(
			socket,
			{ proposalId: id, accept: true },
			() => {}
		)
		expect(decided.status).toBe("accepted")
		expect(decided.movedSlots).toBeUndefined()
		expect(decided.state.cast[castKey(w.verity.name)]?.hp).toBe(6)
		expect(decided.state.version).toBe(2)
		expect(decided.proposals.find((p) => p.id === id)).toBeUndefined()
	}, 60_000)
})

// ── K1: a reply names the write it answers ──────────────────────────────────

describe("a write's reply and refusal carry the writer's requestId, unchanged", () => {
	test("on the reply", async () => {
		declareSlots()
		const w = await world()
		const { stateSet } = await import("./state")
		const cap = capture()
		await stateSet.handler(
			fakeSocket(w.user.id),
			{
				sessionId: w.session.id,
				owner: { kind: "session", id: w.session.id },
				slotId: WEATHER,
				value: "fog",
				requestId: "set-abc-1"
			},
			cap.emit
		)
		expect(cap.events.find((e) => e.event === "state:set")?.data).toMatchObject({
			sessionId: w.session.id,
			requestId: "set-abc-1"
		})
	}, 60_000)

	test("on a refusal in words, and on one nobody put into words", async () => {
		declareSlots()
		const w = await world()
		const { stateSet } = await import("./state")
		const refused = capture()
		await expect(
			stateSet.handler(
				fakeSocket(w.user.id),
				{
					sessionId: w.session.id,
					owner: { kind: "session_cast", id: w.verity.id },
					slotId: HP,
					value: 35,
					requestId: "set-abc-2"
				},
				refused.emit
			)
		).rejects.toThrow(/does not go above 20/)
		expect(refused.events.filter((e) => e.event === "state:set:error").map((e) => e.data)).toEqual([
			{ error: expect.stringMatching(/does not go above 20/), requestId: "set-abc-2" }
		])

		// A failure with no sentence of its own (here: no user on the socket)
		// still answers the writer by its id — once.
		const broken = capture()
		await expect(
			stateSet.handler(
				{ user: undefined, io: interestedIo() } as any,
				{
					sessionId: w.session.id,
					owner: { kind: "session", id: w.session.id },
					slotId: WEATHER,
					value: "fog",
					requestId: "set-abc-3"
				},
				broken.emit
			)
		).rejects.toThrow()
		expect(broken.events.filter((e) => e.event === "state:set:error").map((e) => e.data)).toEqual([
			{ error: "An error occurred while processing your request.", requestId: "set-abc-3" }
		])
	}, 60_000)

	/**
	 * The reply went out, then telling the session's other tabs failed. The
	 * write landed: it is not refused by id, and the handler does not throw —
	 * a throw is what makes `register()` send its id-less refusal to every
	 * tab of the user, which a store files as a store-wide error.
	 */
	test("a failure after the reply went out is never reported as a refusal of the write", async () => {
		declareSlots()
		const w = await world()
		const { stateSet } = await import("./state")
		const cap = capture()
		const io = interestedIo()
		const socket = {
			user: { id: w.user.id },
			io: {
				...io,
				to: () => ({
					emit: () => {
						throw new Error("the broadcast fell over")
					}
				})
			}
		} as any
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const res = await stateSet.handler(
				socket,
				{
					sessionId: w.session.id,
					owner: { kind: "session", id: w.session.id },
					slotId: WEATHER,
					value: "storm",
					requestId: "set-abc-5"
				},
				cap.emit
			)
			expect(res.sessionId).toBe(w.session.id)
			expect(logged).toHaveBeenCalled()
		} finally {
			logged.mockRestore()
		}
		expect(cap.events.filter((e) => e.event === "state:set:error")).toEqual([])
		expect(cap.events.filter((e) => e.event === "state:set").map((e) => e.data.requestId)).toEqual([
			"set-abc-5"
		])
	}, 60_000)

	/**
	 * The write committed, then re-reading the state for its reply failed.
	 * It landed, so it is answered by its id without the state, and the
	 * session is told something moved — never refused.
	 */
	test("a write that landed is answered, never refused, when re-reading it fails", async () => {
		declareSlots()
		const w = await world()
		broadcasts.length = 0
		const { stateSet } = await import("./state")
		const { stateFor } = await import("$lib/server/state/resolve")
		vi.mocked(stateFor).mockRejectedValueOnce(new Error("the re-read fell over"))
		const cap = capture()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const res = await stateSet.handler(
				fakeSocket(w.user.id),
				{
					sessionId: w.session.id,
					owner: { kind: "session", id: w.session.id },
					slotId: WEATHER,
					value: "storm",
					requestId: "set-abc-6"
				},
				cap.emit
			)
			expect(res).toEqual({ sessionId: w.session.id })
			expect(logged).toHaveBeenCalled()
		} finally {
			logged.mockRestore()
		}
		expect(cap.events.filter((e) => e.event === "state:set:error")).toEqual([])
		expect(cap.events.filter((e) => e.event === "state:set").map((e) => e.data)).toEqual([
			{ sessionId: w.session.id, requestId: "set-abc-6" }
		])
		expect(broadcasts).toContainEqual({ event: "state:changed", sessionId: w.session.id })
		expect((await stateFor(testDb as any, w.session.id)).world.weather).toBe("storm")
	}, 60_000)

	test("a refusal about a session names it, so another tab can tell it is not about its own", async () => {
		declareSlots()
		const w = await world()
		const { stateGet, stateSet } = await import("./state")
		const read = capture()
		await expect(
			stateGet.handler(fakeSocket(w.stranger.id), { sessionId: w.session.id }, read.emit)
		).rejects.toThrow(/Session not found/)
		expect(read.events.find((e) => e.event === "state:get:error")?.data).toEqual({
			error: "Session not found.",
			sessionId: w.session.id
		})
		const write = capture()
		await expect(
			stateSet.handler(
				fakeSocket(w.stranger.id),
				{
					sessionId: w.session.id,
					owner: { kind: "session", id: w.session.id },
					slotId: WEATHER,
					value: "fog",
					requestId: "set-abc-4"
				},
				write.emit
			)
		).rejects.toThrow(/Session not found/)
		expect(write.events.find((e) => e.event === "state:set:error")?.data).toEqual({
			error: "Session not found.",
			sessionId: w.session.id,
			requestId: "set-abc-4"
		})
	}, 60_000)
})

// ── what a surface is told of a slot ────────────────────────────────────────

describe("a slot's descriptor says what the session's vocabulary says of it", () => {
	test("retired, required and the sheet that named it reach the read — each only when it holds", async () => {
		declareSlots()
		const w = await world()
		const { defineAttributeSheet, defineStoredAttributeSlot, retireAttributeSlot, getAttributeSlot } =
			await import("@serene-pub/sdk")
		const dread = `somebody${n}:slot/dread@1`
		defineStoredAttributeSlot(
			dread,
			{
				type: "integer",
				descriptor: "How frightened they are.",
				appliesTo: ["cast"],
				config: { min: 0, max: 10 }
			},
			{ userId: w.user.id }
		)
		retireAttributeSlot(dread)
		const sheetId = `test:sheet/vitals-${n}@1`
		const sheet = defineAttributeSheet(sheetId as never, {
			label: { en: "Vitals" },
			slots: [{ id: HP, required: true }]
		})
		const genreId = `test:genre/sheeted-${n}`
		genre(genreId, {
			name: { en: "Sheeted" },
			family: "test",
			slots: [getAttributeSlot(WEATHER)!, getAttributeSlot(dread)!],
			sheets: [sheet],
			events: {}
		})
		const { eq } = await import("drizzle-orm")
		await testDb.update(schema.sessions).set({ genreId }).where(eq(schema.sessions.id, w.session.id))

		const { stateGet } = await import("./state")
		const res = await stateGet.handler(fakeSocket(w.user.id), { sessionId: w.session.id }, () => {})
		const of = (id: string) => res.slots.find((s) => s.slotId === id)
		expect(of(HP)).toMatchObject({ required: true, sheetId })
		expect(of(HP)).not.toHaveProperty("retired")
		expect(of(dread)).toMatchObject({ retired: true })
		expect(of(dread)).not.toHaveProperty("required")
		expect(of(WEATHER)).not.toHaveProperty("retired")
		expect(of(WEATHER)).not.toHaveProperty("required")
		expect(of(WEATHER)).not.toHaveProperty("sheetId")
		// Phase 2: what the value IS rides the read — the field always, the
		// catalogue shape when the slot names one (these declare `type` alone).
		expect(of(HP)).toMatchObject({ field: { type: "integer" } })
		expect(of(HP)).not.toHaveProperty("shape")
		expect(of(WEATHER)?.field?.type).toBe("enum")
	}, 60_000)

	test("a slot shaped from the catalogue carries its shape id and field to the read", async () => {
		declareSlots()
		const w = await world()
		await import("@serene-pub/core-catalog")
		const { defineAttributeSlot: define, getAttributeSlot } = await import("@serene-pub/sdk")
		const clock = `test:slot/clock-${n}@1`
		define(clock, {
			shape: "core:stat-shape/story-time@1",
			descriptor: "Where the story clock stands.",
			appliesTo: ["world"]
		})
		const genreId = `test:genre/clocked-${n}`
		genre(genreId, { name: { en: "Clocked" }, family: "test", slots: [getAttributeSlot(clock)!], events: {} })
		const { eq } = await import("drizzle-orm")
		await testDb.update(schema.sessions).set({ genreId }).where(eq(schema.sessions.id, w.session.id))
		const { stateGet } = await import("./state")
		const res = await stateGet.handler(fakeSocket(w.user.id), { sessionId: w.session.id }, () => {})
		expect(res.slots.find((s) => s.slotId === clock)).toMatchObject({
			type: "text",
			shape: "core:stat-shape/story-time@1",
			field: { type: "string", format: "story-time" }
		})
	}, 60_000)
})

// Attributes phase 4 (2026-09-26): a location lore entry holds state. The read
// lists each place of the world as an owner keyed `location:<slug>`, a write
// names it like any session-layer owner, and the ledger names its rows.
describe("places", () => {
	const STASH = "test:slot/place-stash@1"
	const PLACES = "test:genre/stats-places"

	test("a location is an owner the read lists, a write reaches, and the ledger names", async () => {
		_clearAttributeSlots()
		const stash = defineAttributeSlot(STASH, {
			shape: "core:stat-shape/list@1",
			label: { en: "Stash" },
			descriptor: "What is lying there.",
			appliesTo: ["world", "location"]
		})
		genre(PLACES, { name: { en: "Places" }, family: "test", slots: [stash], events: {} })
		const w = await world()
		await testDb.update(schema.sessions).set({ genreId: PLACES }).where(eq(schema.sessions.id, w.session.id))
		const [crypt] = await testDb
			.insert(schema.lorebookEntries)
			.values({ lorebookId: w.lorebook.id, typeId: "core:entry/location", typeVersion: 1, position: 1, title: "The Crypt", content: "…" })
			.returning()
		const { stateGet, stateSet, stateLedger } = await import("./state")
		const socket = fakeSocket(w.user.id)

		const res = await stateSet.handler(
			socket,
			{ sessionId: w.session.id, owner: { kind: "session_location", id: crypt.id }, slotId: STASH, value: ["lantern"] },
			() => {}
		)
		const places = (res.state as unknown as { locations: { byId: Record<string, Record<string, unknown>> } }).locations
		expect(places.byId[String(crypt.id)]?.["place-stash"]).toEqual(["lantern"])

		const read = await stateGet.handler(socket, { sessionId: w.session.id }, () => {})
		const owner = read.owners.find((o) => o.kind === "session_location")
		expect(owner).toMatchObject({ key: "location:the_crypt", id: crypt.id, label: "The Crypt" })
		expect(Object.keys(owner!.configs)).toEqual([STASH])

		const ledger = await stateLedger.handler(socket, { sessionId: w.session.id }, () => {})
		expect(ledger.rows.find((r) => r.slotId === STASH)).toMatchObject({ ownerKey: "location:the_crypt", ownerLabel: "The Crypt" })
	})
})
