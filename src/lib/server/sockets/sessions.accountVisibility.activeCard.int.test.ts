/**
 * `sessions:accountVisibility` lists the card a seated member is DRAWN with
 * (plan §27 S2b). Owner ruling 2026-11-05: "Everything in session is cast ->
 * active card" — a seat exposes its member's active card on the session's
 * reading (a dated card the story clock has reached), once, for a character
 * seat and a player seat alike; before the date it is not exposed.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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
		getCryptoSecretKey: () => "account-visibility-active-card-secret"
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-visibility-active-card-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noEmit = () => {}
let n = 0

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `visibility-active-${++n}`)
}

async function card(userId: number, name: string, isPersona = false) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name: `${name} ${++n}`, description: "", isPersona })
		.returning()
	return row!
}

/**
 * The owner's seats hold cards A (character) and P (player), each seat's
 * member linked to it; a cast amendment from year 20 draws the character
 * seat's member with the guest's card B and the player seat's with the
 * guest's card Q. The story clock stands at `clockYear`.
 */
async function scenario(clockYear: number) {
	const owner = await user()
	const guest = await user()
	const A = await card(owner.id, "Held")
	const P = await card(owner.id, "Held voice", true)
	const B = await card(guest.id, "Dated")
	const Q = await card(guest.id, "Dated voice", true)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` } as any)
		.returning()
	const mk = async (cardId: number) =>
		(
			await insertCastMember(testDb, {
				lorebookId: book!.id,
				characterId: cardId,
				binding: `{{char:${++n}}}`,
				name: `m${n}`
			} as any)
		).member
	const mA = await mk(A.id)
	const mP = await mk(P.id)
	for (const [m, c] of [
		[mA, B],
		[mP, Q]
	] as const)
		await insertDatedCardVersion(testDb, m.id, c.id, 20)
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${++n}`,
			lorebookId: book!.id,
			storyClockYear: clockYear
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: s!.id, userId: guest.id, isPlayer: true })
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: s!.id,
		characterId: A.id,
		castMemberId: mA.id,
		position: 0
	} as any)
	await testDb.insert(schema.sessionPersonas).values({
		sessionId: s!.id,
		personaId: P.id,
		castMemberId: mP.id
	} as any)
	return { owner, guest, A, P, B, Q, session: s! }
}

describe("sessions:accountVisibility follows the seated member's active card", () => {
	test("a dated card the clock has reached is exposed once, character and player seat", async () => {
		const w = await scenario(30)
		const { sessionsAccountVisibilityHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res = await sessionsAccountVisibilityHandler.handler(
			socket(w.guest.id),
			{ sessionId: w.session.id } as any,
			noEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.exposed.characters.map((c) => c.id)).toEqual([w.B.id])
		expect(res.exposed.personas.map((c) => c.id)).toEqual([w.Q.id])
		// The owner's own cards: the seats still hold them, and the members are linked to them.
		const ownerRes = await sessionsAccountVisibilityHandler.handler(
			socket(w.owner.id),
			{ sessionId: w.session.id } as any,
			noEmit
		)
		expect(ownerRes.exposed.characters.map((c) => c.id)).toEqual([w.A.id])
		expect(ownerRes.exposed.personas.map((c) => c.id)).toEqual([w.P.id])
	})

	test("before the date the dated card is not exposed", async () => {
		const w = await scenario(10)
		const { sessionsAccountVisibilityHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res = await sessionsAccountVisibilityHandler.handler(
			socket(w.guest.id),
			{ sessionId: w.session.id } as any,
			noEmit
		)
		expect(res.exposed.characters).toEqual([])
		expect(res.exposed.personas).toEqual([])
	})
})
