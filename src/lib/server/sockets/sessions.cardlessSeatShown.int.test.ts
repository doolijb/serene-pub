/**
 * 🚧 `sessions:get` carries `cardlessSeatShown` (plan §34.2): each seat that
 * holds no card, shown as its cast member by member id; and a card-less
 * character seat's row carries its `ref` and a null `cardId`. Driven through
 * the real handler on PGlite.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cardlessseatshown-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `getseatident-${++n}`)
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}: the card.` })
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	over: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const row = (
		await insertCastMember(testDb, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		} as any)
	).member
	return row!
}

async function session(
	userId: number,
	lorebookId: number,
	over: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			...over
		} as any)
		.returning()
	return row!
}

async function getSession(userId: number, sessionId: number) {
	const { sessionsGetHandler } = await import("./sessions")
	const res: any = await sessionsGetHandler.handler(
		fakeSocket(userId),
		{ id: sessionId } as any,
		noopEmit
	)
	return res.session
}

describe("sessions:get — cardlessSeatShown", () => {
	test("a card-less character seat is shown as its member; its row has ref seated-member:<M> and cardId null", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, {
			ownName: "Nobody",
			ownNickname: "Nob"
		})
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			castMemberId: m.id
		} as any)
		const got = await getSession(u.id, s.id)
		expect(got.cardlessSeatShown).toEqual({
			[m.id]: { name: "Nobody", nickname: "Nob", faceMediaId: null }
		})
		const seat = got.sessionCharacters[0]
		expect(seat.ref).toBe(`seated-member:${m.id}`)
		expect(seat.castMemberId).toBe(m.id)
		expect(seat.cardId).toBeNull()
	})

	test("a card-less player seat is shown too, keyed by its member", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, { ownName: "Wren" })
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			userId: u.id,
			personaId: null,
			castMemberId: m.id
		} as any)
		const got = await getSession(u.id, s.id)
		expect(got.cardlessSeatShown[m.id]).toMatchObject({ name: "Wren" })
	})

	test("a carded seat adds nothing to it", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: c.id,
			castMemberId: m.id
		} as any)
		const got = await getSession(u.id, s.id)
		expect(got.cardlessSeatShown).toEqual({})
	})
})
