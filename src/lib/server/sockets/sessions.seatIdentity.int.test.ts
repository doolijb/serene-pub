/**
 * 🚧 `sessions:get` seat rows carry the seat's identity (plan §27, S3 "Host
 * fills, consumers read"): `ref`, `castMemberId` and `cardId`, as the
 * pipelines' `session_cast` read fills them (`host.seatIdentity.int.test.ts`).
 * Driven through the real handler on PGlite.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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
		path.join(os.tmpdir(), "serene-pub-vitest-getseatidentity-")
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

describe("sessions:get — seat rows carry ref, castMemberId and cardId", () => {
	test("a character seat, a carded player seat and a card-less player seat", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const p = await card(u.id, "Pia")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const pm = await member(b.id, p.id)
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: c.id,
			castMemberId: m.id
		} as any)
		const [cardedSeat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				userId: u.id,
				personaId: p.id,
				castMemberId: pm.id
			} as any)
			.returning()
		const [cardless] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				userId: u.id,
				personaId: null,
				seatName: "Wren",
				position: 1
			} as any)
			.returning()

		const got = await getSession(u.id, s.id)
		// ⏳ The seat's ref (`hostSeatRefOf`): member form once the flip is on.
		const { memberFormOn } = await import("$lib/server/state/memberForm")
		expect(got.sessionCharacters[0]).toMatchObject({
			ref: memberFormOn() ? `seated-member:${m.id}` : `character:${c.id}`,
			castMemberId: m.id,
			cardId: c.id
		})
		const byId = new Map<number, any>(
			got.sessionPersonas.map((r: any) => [r.id, r])
		)
		expect(byId.get(cardedSeat!.id)).toMatchObject({
			ref: memberFormOn() ? `player-seat:${cardedSeat!.id}` : `character:${p.id}`,
			castMemberId: pm.id,
			cardId: p.id
		})
		expect(byId.get(cardless!.id)).toMatchObject({
			ref: `player-seat:${cardless!.id}`,
			castMemberId: null,
			cardId: null
		})
	})

	test("a card-less player seat that stores a member, and a dated card for that member", async () => {
		const u = await user()
		const b = await book(u.id)
		const memberless = await member(b.id, null, { ownName: "Wren" })
		const s = await session(u.id, b.id)
		const [seatRow] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				userId: u.id,
				personaId: null,
				seatName: "Wren",
				castMemberId: memberless.id
			} as any)
			.returning()
		const before = (await getSession(u.id, s.id)).sessionPersonas[0]
		expect(before).toMatchObject({
			ref: `player-seat:${seatRow!.id}`,
			castMemberId: memberless.id,
			cardId: null
		})
		const drawn = await card(u.id, "Wren's card")
		await insertDatedCardVersion(testDb, memberless.id, drawn.id, 1)
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 5 } as any)
			.where((await import("drizzle-orm")).eq(schema.sessions.id, s.id))
		const after = (await getSession(u.id, s.id)).sessionPersonas[0]
		expect(after).toMatchObject({
			ref: `player-seat:${seatRow!.id}`,
			cardId: drawn.id
		})
	})

	test("a dated active card that is not the held card: cardId is the dated card, ref stays the held card", async () => {
		const u = await user()
		const held = await card(u.id, "Maren")
		const younger = await card(u.id, "Maren, younger")
		const b = await book(u.id)
		const m = await member(b.id, held.id, { ownName: "Captain Maren" })
		await insertDatedCardVersion(testDb, m.id, younger.id, 1)
		const s = await session(u.id, b.id, { storyClockYear: 5 } as any)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: held.id,
			castMemberId: m.id
		} as any)
		const row = (await getSession(u.id, s.id)).sessionCharacters[0]
		expect(row.character.id).toBe(held.id)
		const { memberFormOn } = await import("$lib/server/state/memberForm")
		expect(row).toMatchObject({
			ref: memberFormOn() ? `seated-member:${m.id}` : `character:${held.id}`,
			castMemberId: m.id,
			cardId: younger.id
		})
	})

	test("a seat with no member anywhere: no member id, and the card the seat holds", async () => {
		const u = await user()
		const c = await card(u.id, "Alone")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id } as any)
		const row = (await getSession(u.id, s.id)).sessionCharacters[0]
		expect(row).toMatchObject({
			ref: `character:${c.id}`,
			castMemberId: null,
			cardId: c.id
		})
	})
})
