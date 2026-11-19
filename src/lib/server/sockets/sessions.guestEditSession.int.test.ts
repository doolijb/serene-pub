/**
 * 🚧 Edit session for a guest (owner ruling G1, 2026-11-16): the participants
 * list alone. The server's half: the owner's pipeline cards are not a guest's
 * (administrators who are guests included), the reads the session page needs
 * still answer, and a guest's Save keeps landing the seats and dropping the
 * session's own fields.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "guest-edit-session-test-secret"
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
		path.join(os.tmpdir(), "serene-pub-vitest-guesteditsession-")
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

const socket = (userId: number, isAdmin = false) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${label}-${++n}`)
}

const card = async (userId: number, name: string) =>
	(
		await testDb
			.insert(schema.characters)
			.values({ userId, name, description: "" })
			.returning()
	)[0]!

/** An owner, a guest who plays, a stranger, and a session with a notes book. */
async function table() {
	const owner = await user("ges-owner")
	const guest = await user("ges-guest")
	const stranger = await user("ges-stranger")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: "Original name",
			scenario: "Original scenario"
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id, isPlayer: true })
	await testDb
		.insert(schema.lorebooks)
		.values({
			userId: owner.id,
			name: `Notes ${++n}`,
			sessionId: session!.id
		} as any)
	return { owner, guest, stranger, sessionId: session!.id }
}

const wire = <T>(res: T): any => JSON.parse(JSON.stringify(res))

async function call(
	module: string,
	name: string,
	sock: any,
	params: unknown
): Promise<any> {
	const m = await import(module)
	return wire(await (m as any)[name].handler(sock, params, () => {}))
}

const SESSIONS = "$lib/server/sockets/sessions"
const PIPELINES = "$lib/server/sockets/sessions.pipelines"

const sessionRow = async (sessionId: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

const seatsOf = async (sessionId: number) =>
	(
		await testDb
			.select({ characterId: schema.sessionCharacters.characterId })
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
	).map((r) => r.characterId)

const tagCount = async (sessionId: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionTags)
			.where(eq(schema.sessionTags.sessionId, sessionId))
	).length

describe("sessions:pipelineCards is the owner's", () => {
	test("a guest, an administrator guest and a stranger get none; the owner gets the list", async () => {
		const t = await table()
		const admin = await user("ges-admin")
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: t.sessionId, userId: admin.id, isPlayer: false })
		const { listSessionPipelineCards } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const params = { sessionId: t.sessionId }

		const guest = await call(PIPELINES, "sessionsPipelineCardsHandler", socket(t.guest.id), params)
		expect(guest).toEqual({ sessionId: t.sessionId, cards: [] })
		const adm = await call(PIPELINES, "sessionsPipelineCardsHandler", socket(admin.id, true), params)
		expect(adm).toEqual({ sessionId: t.sessionId, cards: [] })
		const out = await call(PIPELINES, "sessionsPipelineCardsHandler", socket(t.stranger.id), params)
		expect(out).toEqual({ sessionId: t.sessionId, cards: [] })

		const owner = await call(PIPELINES, "sessionsPipelineCardsHandler", socket(t.owner.id), params)
		expect(owner.cards).toEqual(
			wire(await listSessionPipelineCards(testDb as any, t.sessionId))
		)
		expect(owner.cards.length).toBeGreaterThan(0)
	})
})

describe("the reads the session page needs still answer a guest", () => {
	test("view, genres, story clock, functions, account visibility", async () => {
		const t = await table()
		const params = { sessionId: t.sessionId }
		const g = socket(t.guest.id)

		const view = await call(SESSIONS, "sessionsViewHandler", g, params)
		expect(view.sessionId).toBe(t.sessionId)
		expect(view.error).toBeUndefined()

		const genres = await call(PIPELINES, "sessionsModesHandler", g, {})
		expect(Array.isArray(genres.genres)).toBe(true)
		expect(genres.genres.length).toBeGreaterThan(0)

		const clock = await call(
			"$lib/server/sockets/storyClock",
			"sessionsStoryClock",
			g,
			params
		)
		expect(clock.sessionId).toBe(t.sessionId)
		expect(String(clock.error ?? "")).not.toMatch(/access/i)

		const fns = await call(PIPELINES, "sessionsFunctionsHandler", g, params)
		expect(fns.functions).toEqual([])

		const vis = await call(
			SESSIONS,
			"sessionsAccountVisibilityHandler",
			g,
			params
		)
		expect(vis.isGuest).toBe(true)
		expect(vis.error).toBeUndefined()
	})
})

describe("sessions:update from a guest", () => {
	test("a seat-only Save lands the seat", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest card")
		await call(SESSIONS, "sessionsUpdateHandler", socket(t.guest.id), {
			session: { id: t.sessionId },
			characterIds: [mine.id]
		})
		expect(await seatsOf(t.sessionId)).toContain(mine.id)
	})

	test("a Save with the session's own fields lands the seat and drops the fields; the owner's Save lands", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest card")
		await call(SESSIONS, "sessionsUpdateHandler", socket(t.guest.id), {
			session: {
				id: t.sessionId,
				name: "Guest's name",
				scenario: "Guest's scenario"
			},
			tags: ["guest-tag"],
			characterIds: [mine.id]
		})
		expect(await seatsOf(t.sessionId)).toContain(mine.id)
		const row = await sessionRow(t.sessionId)
		expect(row.name).toBe("Original name")
		expect(row.scenario).toBe("Original scenario")
		expect(await tagCount(t.sessionId)).toBe(0)

		await call(SESSIONS, "sessionsUpdateHandler", socket(t.owner.id), {
			session: { id: t.sessionId, name: "Owner's name" }
		})
		expect((await sessionRow(t.sessionId)).name).toBe("Owner's name")
	})
})

describe("a guest's Save changes nothing it does not own", () => {
	test("every dropped field leaves the session row, the tags and the switches as they were", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest card")
		const stored = async () => {
			// `isGroup` follows the seat count: a seat's effect, not a field.
			const { updatedAt: _u, isGroup: _g, ...rest } = await sessionRow(t.sessionId)
			return wire(rest)
		}
		const before = await stored()
		await call(SESSIONS, "sessionsUpdateHandler", socket(t.guest.id), {
			session: {
				id: t.sessionId,
				name: "Guest's name",
				scenario: "Guest's scenario",
				genreFields: { autoAdvance: true, turnMode: "free" },
				onRevision: "branch",
				storyClockYear: 1999,
				storyClockMonth: 3,
				storyClockDay: 4
			},
			tags: ["guest-tag"],
			playerLabel: "Hero",
			sceneSettings: { summary: "always" },
			guestsBringOwn: false,
			guestsTakeCast: false,
			characterIds: [mine.id]
		})
		expect(await seatsOf(t.sessionId)).toContain(mine.id)
		expect(await stored()).toEqual(before)
		expect(await tagCount(t.sessionId)).toBe(0)
	})

	const positionsOf = async (sessionId: number) => {
		const chars = await testDb
			.select({
				id: schema.sessionCharacters.characterId,
				position: schema.sessionCharacters.position
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
		const pers = await testDb
			.select({
				id: schema.sessionPersonas.personaId,
				position: schema.sessionPersonas.position
			})
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, sessionId))
		const by = (rows: Array<{ id: number | null; position: number | null }>) =>
			Object.fromEntries(rows.map((r) => [r.id, r.position]))
		return { chars: by(chars), pers: by(pers) }
	}

	test("a guest's order for existing seats, characters and personas, moves none; the owner's reorder lands", async () => {
		const t = await table()
		const a = await card(t.owner.id, "Owner A")
		const b = await card(t.owner.id, "Owner B")
		const c = await card(t.guest.id, "Guest C")
		const [pa, pb, pc] = await Promise.all(
			[t.owner.id, t.owner.id, t.guest.id].map(async (uid, i) =>
				(
					await testDb
						.insert(schema.characters)
						.values({
							userId: uid,
							name: `Persona ${i}`,
							description: "",
							isPersona: true
						} as any)
						.returning()
				)[0]!
			)
		)
		const owner = socket(t.owner.id)
		await call(SESSIONS, "sessionsUpdateHandler", owner, {
			session: { id: t.sessionId },
			characterIds: [a.id, b.id],
			personaIds: [pa.id, pb.id]
		})
		// The guest's own cards join at the foot, as an add does.
		await call(SESSIONS, "sessionsUpdateHandler", socket(t.guest.id), {
			session: { id: t.sessionId },
			characterIds: [a.id, b.id, c.id],
			personaIds: [pa.id, pb.id, pc.id]
		})
		const seated = await positionsOf(t.sessionId)
		expect(Object.keys(seated.chars)).toHaveLength(3)
		expect(seated.chars[a.id]).toBeLessThan(seated.chars[b.id])
		expect(seated.chars[b.id]).toBeLessThan(seated.chars[c.id])

		await call(SESSIONS, "sessionsUpdateHandler", socket(t.guest.id), {
			session: { id: t.sessionId },
			characterIds: [c.id, b.id, a.id],
			characterPositions: { [c.id]: 0, [b.id]: 1, [a.id]: 2 },
			personaIds: [pc.id, pb.id, pa.id]
		})
		expect(await positionsOf(t.sessionId)).toEqual(seated)

		await call(SESSIONS, "sessionsUpdateHandler", owner, {
			session: { id: t.sessionId },
			characterIds: [c.id, b.id, a.id],
			characterPositions: { [c.id]: 0, [b.id]: 1, [a.id]: 2 },
			personaIds: [pc.id, pb.id, pa.id]
		})
		const moved = await positionsOf(t.sessionId)
		expect(moved.chars[c.id]).toBeLessThan(moved.chars[b.id])
		expect(moved.chars[b.id]).toBeLessThan(moved.chars[a.id])
		expect(moved.pers[pc.id]).toBeLessThan(moved.pers[pb.id])
		expect(moved.pers[pb.id]).toBeLessThan(moved.pers[pa.id])
	})
})
