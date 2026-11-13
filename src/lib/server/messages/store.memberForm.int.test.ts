/**
 * ⏳ The speaker stamp in member form (S4 f-emit): with `memberFormSwitch` on,
 * a seat's line carries the seat's member on `cast_member_id` AND its
 * member-form ref on `metadata.speaker` — one rule (`speakerSeatOf`, ★K-2:
 * a persona is its PLAYER seat, never a character seat holding the same
 * card); off, `metadata` is left alone. A patch that moves `characterId` /
 * `personaId` re-stamps both.
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
import { eq } from "drizzle-orm"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertLegacy,
	insertLegacyMany,
	updateLegacy,
	updateLegacyWhere
} from "./store"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-s4emit-stamp-")
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
	memberFormSwitch.on = true
})
afterEach(() => {
	memberFormSwitch.on = was
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `stamp-${++n}`)
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}.` })
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

async function member(lorebookId: number, characterId: number | null) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member"
		} as any)
		.returning()
	return row!
}

async function session(userId: number, lorebookId: number | null) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId
		} as any)
		.returning()
	return row!
}

async function characterSeat(
	sessionId: number,
	characterId: number | null,
	castMemberId: number | null,
	over: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, ...over } as any)
		.returning()
	return row!
}

async function playerSeat(
	sessionId: number,
	userId: number,
	personaId: number | null,
	castMemberId: number | null,
	over: Partial<typeof schema.sessionPersonas.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId, personaId, castMemberId, ...over } as any)
		.returning()
	return row!
}

/** Both worlds' stamp of one message. */
async function stampsOf(id: number) {
	const [legacy] = await testDb
		.select({ m: schema.sessionMessages.castMemberId })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
	const [mirror] = await testDb
		.select({ m: schema.messages.castMemberId })
		.from(schema.messages)
		.where(eq(schema.messages.id, id))
	return { legacy: legacy!.m, mirror: mirror!.m }
}

async function world() {
	const u = await user()
	const c = await card(u.id, "Verity")
	const b = await book(u.id)
	const m = await member(b.id, c.id)
	const s = await session(u.id, b.id)
	return { u, c, b, m, s }
}

const speakerOf = async (id: number) => {
	const [row] = await testDb
		.select({ metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
	return (row!.metadata as { speaker?: string } | null)?.speaker
}

describe("the speaker stamp, member form", () => {
	test("a character line carries castMemberId and metadata.speaker seated-member:M", async () => {
		const { c, m, s } = await world()
		await characterSeat(s.id, c.id, m.id)
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Hello.",
			characterId: c.id,
			metadata: { isGreeting: true }
		})
		expect(row.castMemberId).toBe(m.id)
		expect((row.metadata as any).speaker).toBe(`seated-member:${m.id}`)
		expect((row.metadata as any).isGreeting).toBe(true)
		expect(await speakerOf(row.id)).toBe(`seated-member:${m.id}`)
	})

	test("a persona line of a member who also holds a character seat with the same card is the PLAYER seat's (K-2)", async () => {
		const { u, c, b, m: charMember, s } = await world()
		// one binding per card per book: the player seat's member is card-less here
		const playerMember = await member(b.id, null)
		await characterSeat(s.id, c.id, charMember.id)
		const seat = await playerSeat(s.id, u.id, c.id, playerMember.id)
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "I step in.",
			userId: u.id,
			personaId: c.id
		})
		expect(row.castMemberId).toBe(playerMember.id)
		expect((row.metadata as any).speaker).toBe(`player-seat:${seat.id}`)
	})

	test("a card-less player line keeps player-seat:S and its member", async () => {
		const { u, b, s } = await world()
		const lone = await member(b.id, null)
		const seat = await playerSeat(s.id, u.id, null, lone.id, {
			seatName: "The Delver"
		})
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "I look around.",
			userId: u.id,
			metadata: { speaker: `player-seat:${seat.id}` }
		})
		expect(row.castMemberId).toBe(lone.id)
		expect((row.metadata as any).speaker).toBe(`player-seat:${seat.id}`)
	})

	test("a bulk write stamps each row", async () => {
		const { c, m, s } = await world()
		await characterSeat(s.id, c.id, m.id)
		const rows = await insertLegacyMany(db(), [
			{
				sessionId: s.id,
				role: "assistant",
				content: "a",
				characterId: c.id
			},
			{
				sessionId: s.id,
				role: "assistant",
				content: "b",
				characterId: c.id
			}
		])
		expect(rows.map((r) => (r.metadata as any)?.speaker)).toEqual([
			`seated-member:${m.id}`,
			`seated-member:${m.id}`
		])
	})

	test("narration and a member-less seat get no member-form speaker", async () => {
		const { c, s } = await world()
		await characterSeat(s.id, c.id, null)
		const narration = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Rain.",
			isNarratorResponse: true
		})
		const memberless = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Hi.",
			characterId: c.id
		})
		expect(await speakerOf(narration.id)).toBeUndefined()
		expect(memberless.castMemberId).toBeNull()
		expect(await speakerOf(memberless.id)).toBeUndefined()
	})

	test("switch off: metadata is untouched", async () => {
		memberFormSwitch.on = false
		const { c, m, s } = await world()
		await characterSeat(s.id, c.id, m.id)
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Hello.",
			characterId: c.id
		})
		expect(row.castMemberId).toBe(m.id)
		expect(
			row.metadata == null || (row.metadata as any).speaker === undefined
		).toBe(true)
	})

	test("a patch moving characterId re-stamps the member and metadata.speaker", async () => {
		const { c, b, m, s } = await world()
		const c2 = await card((await user()).id, "Other")
		const m2 = await member(b.id, c2.id)
		await characterSeat(s.id, c.id, m.id)
		await characterSeat(s.id, c2.id, m2.id)
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Hello.",
			characterId: c.id
		})
		expect(await speakerOf(row.id)).toBe(`seated-member:${m.id}`)
		const moved = await updateLegacy(db(), row.id, { characterId: c2.id })
		expect(moved!.castMemberId).toBe(m2.id)
		expect((moved!.metadata as any).speaker).toBe(`seated-member:${m2.id}`)
		expect(await speakerOf(row.id)).toBe(`seated-member:${m2.id}`)
		// moved onto a member-less seat: the stale member-form stamp goes
		const c3 = await card((await user()).id, "Third")
		await characterSeat(s.id, c3.id, null)
		const bare = await updateLegacy(db(), row.id, { characterId: c3.id })
		expect(bare!.castMemberId).toBeNull()
		expect((bare!.metadata as any)?.speaker).toBeUndefined()
	})
})
