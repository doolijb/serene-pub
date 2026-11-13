/**
 * ⏳ S4 f-emit: the host-filled `ref` of each seat on `sessions:get`'s
 * `sessionCharacters[]` / `sessionPersonas[]` is the seat's member form once
 * `memberFormSwitch` is on (`hostSeatRefOf`) — `seated-member:<memberId>` for
 * a character seat, `player-seat:<seatId>` for a player seat, carded or not;
 * ⏳ `character:<cardId>` for a member-less character seat — and the card form
 * while it is off.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

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
		path.join(os.tmpdir(), "serene-pub-vitest-s4emit-seatrefs-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let was = false
beforeEach(() => {
	was = memberFormSwitch.on
})
afterEach(() => {
	memberFormSwitch.on = was
})

let n = 0
const socketOf = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `s4emit-seatrefs-${++n}`)
	const card = async (name: string, isPersona = false) =>
		(
			await testDb
				.insert(schema.characters)
				.values({
					userId: owner.id,
					name,
					description: ".",
					isPersona
				} as any)
				.returning()
		)[0]!
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` } as any)
		.returning()
	const member = async (characterId: number | null) =>
		(
			await insertCastMember(
				testDb as any,
				{
					lorebookId: book!.id,
					binding: `{{char:${++n}}}`,
					characterId,
					name: ""
				} as any
			)
		).member!
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId: book!.id
		} as any)
		.returning()
	const hero = await card("Hero")
	const bare = await card("Bare")
	const persona = await card("Me", true)
	const heroMember = await member(hero.id)
	const personaMember = await member(persona.id)
	const lone = await member(null)
	const [heroSeat] = await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: s!.id,
			characterId: hero.id,
			castMemberId: heroMember.id,
			position: 0
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: s!.id,
			characterId: bare.id,
			castMemberId: null,
			position: 1
		} as any)
	const [personaSeat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: s!.id,
			userId: owner.id,
			personaId: persona.id,
			castMemberId: personaMember.id,
			position: 0
		} as any)
		.returning()
	const [loneSeat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: s!.id,
			userId: owner.id,
			personaId: null,
			castMemberId: lone.id,
			seatName: "Delver",
			position: 1
		} as any)
		.returning()
	return {
		owner,
		s: s!,
		hero,
		bare,
		persona,
		heroMember,
		personaMember,
		lone,
		heroSeat: heroSeat!,
		personaSeat: personaSeat!,
		loneSeat: loneSeat!
	}
}

async function seatsOf(w: Awaited<ReturnType<typeof world>>) {
	const { sessionsGetHandler } = await import("./sessions")
	const res: any = await sessionsGetHandler.handler(
		socketOf(w.owner.id),
		{ id: w.s.id } as any,
		() => {}
	)
	return res.session as { sessionCharacters: any[]; sessionPersonas: any[] }
}

describe("sessions:get seat refs", () => {
	test("flip on: member form (a member-less character seat keeps its card form)", async () => {
		memberFormSwitch.on = true
		const w = await world()
		const session = await seatsOf(w)
		const refOfChar = (cardId: number) =>
			session.sessionCharacters.find((c) => c.characterId === cardId)?.ref
		expect(refOfChar(w.hero.id)).toBe(`seated-member:${w.heroMember.id}`)
		expect(refOfChar(w.bare.id)).toBe(`character:${w.bare.id}`)
		const refOfSeat = (id: number) =>
			session.sessionPersonas.find((p) => p.id === id)?.ref
		expect(refOfSeat(w.personaSeat.id)).toBe(
			`player-seat:${w.personaSeat.id}`
		)
		expect(refOfSeat(w.loneSeat.id)).toBe(`player-seat:${w.loneSeat.id}`)
	})

	test("flip off: the card form", async () => {
		memberFormSwitch.on = false
		const w = await world()
		const session = await seatsOf(w)
		const refOfChar = (cardId: number) =>
			session.sessionCharacters.find((c) => c.characterId === cardId)?.ref
		expect(refOfChar(w.hero.id)).toBe(`character:${w.hero.id}`)
		const refOfSeat = (id: number) =>
			session.sessionPersonas.find((p) => p.id === id)?.ref
		expect(refOfSeat(w.personaSeat.id)).toBe(`character:${w.persona.id}`)
		expect(refOfSeat(w.loneSeat.id)).toBe(`player-seat:${w.loneSeat.id}`)
	})
})
