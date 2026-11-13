/**
 * 🚧 The seat doors announce through the one seat writer (`announceSeatChanges`):
 * through the real handlers, each door fires exactly one `member-added` /
 * `member-removed` per changed seat, with the member-form ref, and none when
 * nothing changed (a reorder, a re-save). Seats arrive as the writer's changes,
 * not as a snapshot diff of the door.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import { sessionEvents } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "seat-events-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatevents-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const recorder = () => {
	const emitted: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		emitted.push({
			event,
			data: typeof data === "function" ? undefined : data
		})
	}
	return { emitted, emit }
}

async function owner() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `seat-events-owner-${++n}`)
}

async function ownBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return book!
}

/** A card with its member in the book. */
async function carded(userId: number, lorebookId: number, name: string) {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	const { member } = await insertCastMember(
		testDb as any,
		{
			lorebookId,
			characterId: card!.id,
			binding: `{{char:${++n}}}`,
			name,
			ownName: name
		} as any
	)
	return { card: card!, member }
}

async function cardless(lorebookId: number, name: string) {
	const { member } = await insertCastMember(
		testDb as any,
		{
			lorebookId,
			characterId: null,
			binding: `{{char:${++n}}}`,
			name
		} as any
	)
	return member
}

async function make(userId: number, lorebookId: number) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emit } = recorder()
	const res = (await sessionsCreateHandler.handler(
		socket(userId),
		{
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			session: { name: "S", lorebookId }
		} as any,
		emit
	)) as any
	return res.session.id as number
}

async function update(userId: number, body: Record<string, unknown>) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emit } = recorder()
	await sessionsUpdateHandler.handler(socket(userId), body as any, emit)
}

/** What a door did to the ledger of a session: the member and cast events it fired. */
async function fired(sessionId: number, door: () => Promise<unknown>) {
	const ledger = async () => {
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
		return testDb
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
			.orderBy(asc(schema.sessionChanges.id))
	}
	const before = new Set((await ledger()).map((c) => c.id))
	await door()
	const rows = (await ledger()).filter((c) => !before.has(c.id))
	return {
		members: rows
			.filter(
				(c) =>
					c.event === sessionEvents.memberAdded ||
					c.event === sessionEvents.memberRemoved
			)
			.map((c) => {
				const p = c.payload as { ref: string; change: string }
				return `${c.event}:${p.ref}`
			}),
		enabled: rows
			.filter(
				(c) =>
					c.event === sessionEvents.castChanged &&
					(c.payload as { change?: string }).change === "enabled"
			)
			.map((c) => {
				const p = c.payload as { ref: string; value: boolean }
				return `${p.ref}:${p.value}`
			}),
		positions: rows.filter(
			(c) =>
				c.event === sessionEvents.castChanged &&
				(c.payload as { change?: string }).change === "position"
		)
	}
}

const added = (ref: string) => [`${sessionEvents.memberAdded}:${ref}`]
const removed = (ref: string) => [`${sessionEvents.memberRemoved}:${ref}`]

const playerSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))

describe("sessions:update", () => {
	test("a carded character seat: one member-added, none on a re-save, one member-removed", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const a = await carded(u.id, b.id, "Ada")
		const sessionId = await make(u.id, b.id)
		const ref = `seated-member:${a.member.id}`
		const body = { session: { id: sessionId }, characterIds: [a.card.id] }
		expect(
			(await fired(sessionId, () => update(u.id, body))).members
		).toEqual(added(ref))
		expect(
			(await fired(sessionId, () => update(u.id, body))).members
		).toEqual([])
		// Removing a live seat benches it: no member leaves the roster.
		const benched = await fired(sessionId, () =>
			update(u.id, {
				session: { id: sessionId },
				characterIds: []
			})
		)
		expect(benched.members).toEqual([])
		expect(benched.enabled).toEqual([`${ref}:false`])
		// Removing the benched seat (no lines) takes the member off.
		expect(
			(
				await fired(sessionId, () =>
					update(u.id, {
						session: { id: sessionId },
						characterIds: []
					})
				)
			).members
		).toEqual(removed(ref))
	})

	test("a card-less character seat (castMemberIds): one added, none on a re-save, one removed", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const m = await cardless(b.id, "Wren")
		const sessionId = await make(u.id, b.id)
		const ref = `seated-member:${m.id}`
		const body = { session: { id: sessionId }, castMemberIds: [m.id] }
		expect(
			(await fired(sessionId, () => update(u.id, body))).members
		).toEqual(added(ref))
		expect(
			(await fired(sessionId, () => update(u.id, body))).members
		).toEqual([])
		// Removing a live seat benches it: no member leaves the roster.
		const benched = await fired(sessionId, () =>
			update(u.id, {
				session: { id: sessionId },
				castMemberIds: []
			})
		)
		expect(benched.members).toEqual([])
		expect(benched.enabled).toEqual([`${ref}:false`])
		// Removing the benched seat (no lines) takes the member off.
		expect(
			(
				await fired(sessionId, () =>
					update(u.id, {
						session: { id: sessionId },
						castMemberIds: []
					})
				)
			).members
		).toEqual(removed(ref))
	})

	test("a persona player seat: one added as player-seat:<id>, none on a re-save, one removed", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const p = await carded(u.id, b.id, "Pia")
		const sessionId = await make(u.id, b.id)
		const body = { session: { id: sessionId }, personaIds: [p.card.id] }
		const first = await fired(sessionId, () => update(u.id, body))
		const [seat] = await playerSeats(sessionId)
		const ref = `player-seat:${seat!.id}`
		expect(first.members).toEqual(added(ref))
		expect(
			(await fired(sessionId, () => update(u.id, body))).members
		).toEqual([])
		// Removing a live seat benches it: no member leaves the roster.
		const benched = await fired(sessionId, () =>
			update(u.id, { session: { id: sessionId }, personaIds: [] })
		)
		expect(benched.members).toEqual([])
		expect(benched.enabled).toEqual([`${ref}:false`])
		// Removing the benched seat (no lines) takes the member off.
		expect(
			(
				await fired(sessionId, () =>
					update(u.id, { session: { id: sessionId }, personaIds: [] })
				)
			).members
		).toEqual(removed(ref))
	})

	test("a card-less player seat (seatName, playerSeatChanges): one added, a rename none, one removed", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const first = await fired(sessionId, () =>
			update(u.id, { session: { id: sessionId }, seatName: "Hero" })
		)
		const [seat] = await playerSeats(sessionId)
		const ref = `player-seat:${seat!.id}`
		expect(first.members).toEqual(added(ref))
		expect(
			(
				await fired(sessionId, () =>
					update(u.id, {
						session: { id: sessionId },
						seatName: "Hera"
					})
				)
			).members
		).toEqual([])
		expect(
			(
				await fired(sessionId, () =>
					update(u.id, {
						session: { id: sessionId },
						playerSeatChanges: [
							{ playerSeatId: seat!.id, seatName: "Hero II" }
						]
					})
				)
			).members
		).toEqual([])
		// Removing a live seat benches it: no member leaves the roster.
		const benched = await fired(sessionId, () =>
			update(u.id, {
				session: { id: sessionId },
				playerSeatChanges: [{ playerSeatId: seat!.id, remove: true }]
			})
		)
		expect(benched.members).toEqual([])
		expect(benched.enabled).toEqual([`${ref}:false`])
		// Removing the benched seat (no lines) takes the member off.
		expect(
			(
				await fired(sessionId, () =>
					update(u.id, {
						session: { id: sessionId },
						playerSeatChanges: [
							{ playerSeatId: seat!.id, remove: true }
						]
					})
				)
			).members
		).toEqual(removed(ref))
	})

	test("a reorder fires no member event, and still its cast-changed position", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const a = await carded(u.id, b.id, "Ada")
		const c = await carded(u.id, b.id, "Cy")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [a.card.id, c.card.id]
		})
		const r = await fired(sessionId, () =>
			update(u.id, {
				session: { id: sessionId },
				characterIds: [c.card.id, a.card.id]
			})
		)
		expect(r.members).toEqual([])
		expect(r.positions.length).toBeGreaterThan(0)
	})
})

describe("sessions:addPersona", () => {
	test("one member-added player-seat:<id>; refused as already seated, none", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const p = await carded(u.id, b.id, "Pia")
		const sessionId = await make(u.id, b.id)
		const { sessionsAddPersonaHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const add = async () => {
			const { emit } = recorder()
			return sessionsAddPersonaHandler.handler(
				socket(u.id),
				{ sessionId, personaId: p.card.id } as any,
				emit
			)
		}
		const first = await fired(sessionId, add)
		const [seat] = await playerSeats(sessionId)
		expect(first.members).toEqual(added(`player-seat:${seat!.id}`))
		expect((await fired(sessionId, add)).members).toEqual([])
	})
})

describe("sessions:reassignRemovedParticipant", () => {
	test("a removed card replaced by another card: one member-added for the new seat", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const a = await carded(u.id, b.id, "Ada")
		const c = await carded(u.id, b.id, "Cy")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [a.card.id]
		})
		// Benched first, then removed (a benched seat has no lines).
		await update(u.id, { session: { id: sessionId }, characterIds: [] })
		await update(u.id, { session: { id: sessionId }, characterIds: [] })
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const r = await fired(sessionId, async () => {
			const { emit } = recorder()
			return sessionsReassignRemovedParticipantHandler.handler(
				socket(u.id),
				{
					sessionId,
					type: "character",
					oldId: a.card.id,
					newId: c.card.id
				} as any,
				emit
			)
		})
		expect(r.members).toEqual(added(`seated-member:${c.member.id}`))
	})
})

describe("sessions:setCastSeatEnabled", () => {
	async function bench(
		userId: number,
		sessionId: number,
		key: { characterId?: number; castMemberId?: number },
		enabled: boolean
	) {
		const { sessionsSetCastSeatEnabledHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const { emit } = recorder()
		return (await sessionsSetCastSeatEnabledHandler.handler(
			socket(userId),
			{ sessionId, enabled, ...key } as any,
			emit
		)) as any
	}
	const benches = async (sessionId: number, door: () => Promise<unknown>) => {
		const ledger = async () => {
			await (
				await import("$lib/server/pipelines/runtime/sessionEvents")
			).settleSessionEvents()
			return testDb
				.select()
				.from(schema.sessionChanges)
				.where(eq(schema.sessionChanges.sessionId, sessionId))
		}
		const before = new Set((await ledger()).map((c) => c.id))
		await door()
		return (await ledger())
			.filter(
				(c) =>
					!before.has(c.id) &&
					c.event === sessionEvents.castChanged &&
					(c.payload as { change?: string }).change === "enabled"
			)
			.map((c) => {
				const p = c.payload as { ref: string; value: boolean }
				return `${p.ref}:${p.value}`
			})
	}
	const seatRow = async (sessionId: number) =>
		(
			await testDb
				.select()
				.from(schema.sessionCharacters)
				.where(eq(schema.sessionCharacters.sessionId, sessionId))
		)[0]!

	test("a card-less seat benches and unbenches by castMemberId; a repeat press fires nothing", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const m = await cardless(b.id, "Ghost")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [],
			castMemberIds: [m.id]
		})
		const ref = `seated-member:${m.id}`
		expect((await seatRow(sessionId)).characterId).toBeNull()
		expect(
			await benches(sessionId, () =>
				bench(u.id, sessionId, { castMemberId: m.id }, false)
			)
		).toEqual([`${ref}:false`])
		expect((await seatRow(sessionId)).isActive).toBe(false)
		expect(
			await benches(sessionId, () =>
				bench(u.id, sessionId, { castMemberId: m.id }, false)
			)
		).toEqual([])
		expect(
			await benches(sessionId, () =>
				bench(u.id, sessionId, { castMemberId: m.id }, true)
			)
		).toEqual([`${ref}:true`])
		expect((await seatRow(sessionId)).isActive).toBe(true)
	})

	test("a guest who neither owns the session nor seated the member is refused", async () => {
		const u = await owner()
		const g = await owner()
		const b = await ownBook(u.id)
		const m = await cardless(b.id, "Wisp")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [],
			castMemberIds: [m.id]
		})
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId, userId: g.id } as any)
		const res = await bench(g.id, sessionId, { castMemberId: m.id }, false)
		expect(res.error).toBe(
			"Only the session owner or the person who seated this cast member can change this."
		)
		expect((await seatRow(sessionId)).isActive).toBe(true)
	})

	test("neither or both keys is refused", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		for (const key of [{}, { characterId: 1, castMemberId: 2 }]) {
			const res = await bench(u.id, sessionId, key, false)
			expect(res.error).toBe("Name one seat: a character, a cast member or a player seat.")
		}
	})

	test("a carded seat still benches by characterId", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const a = await carded(u.id, b.id, "Cora")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [a.card.id]
		})
		expect(
			await benches(sessionId, () =>
				bench(u.id, sessionId, { characterId: a.card.id }, false)
			)
		).toEqual([`seated-member:${a.member.id}:false`])
		expect((await seatRow(sessionId)).isActive).toBe(false)
	})
})
