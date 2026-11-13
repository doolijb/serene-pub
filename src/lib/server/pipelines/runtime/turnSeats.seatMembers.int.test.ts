/**
 * 🚧 The turn files read the seat (plan §27 S2, lane s27-S2-turns): two seats
 * on one member rotate as two seats, a turn plan's speaker facts match the
 * member's own names, and a portrayal asked about `seated-member:<id>` is
 * answered as its seat's card.
 *
 * `loadAdapterSession` (dispatch.ts) is not exported, so its seat fill is
 * covered through `connections/stops.seatMembers.int.test.ts` and the
 * dispatch suites, not here.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormOn } from "$lib/server/state/memberForm"

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
		path.join(os.tmpdir(), "serene-pub-vitest-s27turns-seats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `s27turns-seats-${++n}`)
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}.` } as any)
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

async function session(userId: number, lorebookId: number) {
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

async function seat(
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	position: number
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, position } as any)
		.returning()
	return row!
}

async function seatRows(sessionId: number) {
	return testDb.query.sessionCharacters.findMany({
		where: (cc, { eq }) => eq(cc.sessionId, sessionId),
		with: { character: true },
		orderBy: (cc, { asc }) => [asc(cc.position), asc(cc.id)]
	}) as Promise<any[]>
}

describe("two seats on one member", () => {
	test("rotate as two seats, in position order, each under the member's name", async () => {
		const { seatCardsAsRead } = await import(
			"$lib/server/pipelines/prompt/seatCards"
		)
		const { rotationSeats, roundRobinSpeaker } = await import(
			"$lib/server/pipelines/runtime/speakerRotation"
		)
		const u = await user()
		const a = await card(u.id, "Verity")
		const b = await card(u.id, "Verity, younger")
		const bk = await book(u.id)
		const m = await member(bk.id, a.id, { ownName: "Vee" })
		const s = await session(u.id, bk.id)
		await seat(s.id, a.id, m.id, 0)
		await seat(s.id, b.id, m.id, 1)

		const filled = await seatCardsAsRead(db(), s.id, await seatRows(s.id))
		const seats = rotationSeats({
			sessionCharacters: filled.map((cc) => ({
				enabled: cc.isActive,
				position: cc.position,
				removedAt: cc.removedAt,
				character: cc.character
			}))
		})
		expect(seats.map((x) => x.characterId)).toEqual([a.id, b.id])
		expect(seats.map((x) => x.name)).toEqual(["Vee", "Vee"])

		const said = (characterId: number) => ({
			role: "assistant",
			characterId
		})
		expect(roundRobinSpeaker(seats, [])).toBe(a.id)
		expect(roundRobinSpeaker(seats, [said(a.id)])).toBe(b.id)
		expect(roundRobinSpeaker(seats, [said(a.id), said(b.id)])).toBeNull()
	})
})

describe("storedTurnPlan", () => {
	test("matches a speaker fact naming the member's own name; a seat with no member still answers to its card's", async () => {
		const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
		const u = await user()
		const a = await card(u.id, "Verity")
		const loner = await card(u.id, "Loner")
		const bk = await book(u.id)
		const m = await member(bk.id, a.id, { ownName: "Vee" })
		const s = await session(u.id, bk.id)
		await seat(s.id, a.id, m.id, 0)
		await seat(s.id, loner.id, null, 1)

		const plan = await storedTurnPlan(db(), s.id, {
			plan: { speakers: [{ name: "Vee" }, { name: "loner" }] }
		})
		// ⏳ Card form until the flip; once on, a seated character is its member's form, a member-less seat keeps its card's.
		expect(plan?.turns).toEqual([
			memberFormOn() ? `seated-member:${m.id}` : `character:${a.id}`,
			`character:${loner.id}`
		])
	})

	test("a wait named seated-member:<id> is stored as the seat's own form (card form until the flip, then player-seat:<seatId>)", async () => {
		const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
		const u = await user()
		const npc = await card(u.id, "Keeper")
		const persona = await card(u.id, "Elara")
		const bk = await book(u.id)
		const npcMember = await member(bk.id, npc.id)
		const personaMember = await member(bk.id, persona.id)
		const s = await session(u.id, bk.id)
		await seat(s.id, npc.id, npcMember.id, 0)
		const [personaSeat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: persona.id,
				castMemberId: personaMember.id,
				userId: u.id
			} as any)
			.returning()

		const plan = await storedTurnPlan(db(), s.id, {
			plan: { speakers: [{ name: "Keeper" }] },
			waits: [`seated-member:${personaMember.id}`, "seated-member:999999"]
		})
		expect(plan?.waits).toEqual([
			memberFormOn()
				? `player-seat:${personaSeat!.id}`
				: `character:${persona.id}`
		])
	})
})

describe("resolvePortrayals", () => {
	test("answers a seated-member ref as its card's portrayal, without throwing", async () => {
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const u = await user()
		const npc = await card(u.id, "Keeper")
		const persona = await card(u.id, "Elara")
		const bk = await book(u.id)
		const npcMember = await member(bk.id, npc.id)
		const personaMember = await member(bk.id, persona.id)
		const s = await session(u.id, bk.id)
		await seat(s.id, npc.id, npcMember.id, 0)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: persona.id,
			castMemberId: personaMember.id,
			userId: u.id
		} as any)

		const refs = [
			`seated-member:${npcMember.id}`,
			`seated-member:${personaMember.id}`,
			"seated-member:999999",
			`character:${npc.id}`
		] as never[]
		const out = (await resolvePortrayals(db(), {
			sessionId: s.id,
			runOwnerUserId: u.id,
			refs
		})) as Record<string, unknown>
		expect(out[`seated-member:${npcMember.id}`]).toEqual({ by: "ai" })
		expect(out[`seated-member:${npcMember.id}`]).toEqual(
			out[`character:${npc.id}`]
		)
		expect(out[`seated-member:${personaMember.id}`]).toEqual({
			by: "person",
			userId: String(u.id)
		})
		expect(out["seated-member:999999"]).toEqual({ by: "none" })
	})

	test("answers only the refs asked, not the card form they were translated to", async () => {
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const u = await user()
		const npc = await card(u.id, "Keeper")
		const persona = await card(u.id, "Elara")
		const bk = await book(u.id)
		const npcMember = await member(bk.id, npc.id)
		const personaMember = await member(bk.id, persona.id)
		const s = await session(u.id, bk.id)
		await seat(s.id, npc.id, npcMember.id, 0)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: persona.id,
			castMemberId: personaMember.id,
			userId: u.id
		} as any)

		const out = (await resolvePortrayals(db(), {
			sessionId: s.id,
			runOwnerUserId: u.id,
			refs: [
				`seated-member:${npcMember.id}`,
				`seated-member:${personaMember.id}`
			] as never[]
		})) as Record<string, unknown>
		expect(Object.keys(out).sort()).toEqual(
			[
				`seated-member:${npcMember.id}`,
				`seated-member:${personaMember.id}`
			].sort()
		)
		expect(out[`seated-member:${npcMember.id}`]).toEqual({ by: "ai" })
	})
})
