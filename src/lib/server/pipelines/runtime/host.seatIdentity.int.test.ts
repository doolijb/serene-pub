/**
 * 🚧 The host fills the seat's identity on the `session_cast` read (plan §27,
 * S3 "Host fills, consumers read"): `ref`, `castMemberId` and `cardId` on
 * every seat row. Core keeps emitting the card form of the ref until S4.
 *
 * `ref` is the card form of the seat (`character:<held card>`; a card-less
 * player seat's `player-seat:<id>`), `castMemberId` is the SEAT's stored
 * member, and `cardId` is the member's active card on the timeline.
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
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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
		path.join(os.tmpdir(), "serene-pub-vitest-hostseatidentity-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

// ⏳ (S4) These tests pin the card form — the member-form switch OFF; the same
// paths in member form are `host.seatForm.int.test.ts`'s.
import { memberFormSwitch } from "$lib/server/state/memberForm"
let switchWas = false
beforeEach(() => {
	switchWas = memberFormSwitch.on
	memberFormSwitch.on = false
})
afterEach(() => {
	memberFormSwitch.on = switchWas
})

const db = () => testDb as unknown as Db
const castNode = {
	key: "read",
	definitionId: "core:query/session-cast@1"
} as any
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `hostident-${++n}`)
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name,
			description: `${name}: the card's description.`
		})
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
	const row = (await insertCastMember(testDb, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		} as any)).member
	return row!
}

async function session(
	userId: number,
	lorebookId: number | null,
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

async function seat(
	sessionId: number,
	characterId: number,
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
	over: Partial<typeof schema.sessionPersonas.$inferInsert>
) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId, ...over } as any)
		.returning()
	return row!
}

async function readCast(sessionId: number) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return (await createHost(db(), { sessionId }).read!(
		"session_cast",
		{ sessionId },
		castNode
	)) as any
}

describe("session_cast rows carry the seat's identity", () => {
	test("a character seat, a carded player seat and a card-less player seat", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const p = await card(u.id, "Pia")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const pm = await member(b.id, p.id)
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		const cardedSeat = await playerSeat(s.id, u.id, {
			personaId: p.id,
			castMemberId: pm.id
		})
		const cardless = await playerSeat(s.id, u.id, {
			personaId: null,
			seatName: "Wren",
			position: 1
		})

		const read = await readCast(s.id)
		expect(read.sessionCharacters[0]).toMatchObject({
			ref: `character:${c.id}`,
			castMemberId: m.id,
			cardId: c.id
		})
		const byId = new Map<number, any>(
			read.sessionPersonas.map((r: any) => [r.seatId, r])
		)
		// A carded player seat is its card.
		expect(byId.get(cardedSeat.id)).toMatchObject({
			ref: `character:${p.id}`,
			castMemberId: pm.id,
			cardId: p.id
		})
		// A card-less player seat with no member has no card.
		expect(byId.get(cardless.id)).toMatchObject({
			ref: `player-seat:${cardless.id}`,
			castMemberId: null,
			cardId: null
		})
	})

	test("a card-less player seat that stores a member reads that member's active card", async () => {
		const u = await user()
		const b = await book(u.id)
		const memberless = await member(b.id, null, { ownName: "Wren" })
		const s = await session(u.id, b.id)
		const seatRow = await playerSeat(s.id, u.id, {
			personaId: null,
			seatName: "Wren",
			castMemberId: memberless.id
		})
		const row = (await readCast(s.id)).sessionPersonas[0]
		expect(row).toMatchObject({
			ref: `player-seat:${seatRow.id}`,
			castMemberId: memberless.id,
			cardId: null
		})
		// The same member drawn with a card by then: that card.
		const drawn = await card(u.id, "Wren's card")
		await insertDatedCardVersion(testDb, memberless.id, drawn.id, 1)
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 5 } as any)
			.where((await import("drizzle-orm")).eq(schema.sessions.id, s.id))
		const after = (await readCast(s.id)).sessionPersonas[0]
		expect(after).toMatchObject({
			ref: `player-seat:${seatRow.id}`,
			cardId: drawn.id
		})
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	test("a dated active card that is not the held card: cardId is the dated card, ref stays the held card", async () => {
		const u = await user()
		const held = await card(u.id, "Maren")
		const younger = await card(u.id, "Maren, younger")
		const b = await book(u.id)
		const m = await member(b.id, held.id, { ownName: "Captain Maren" })
		await insertDatedCardVersion(testDb, m.id, younger.id, 1)
		const s = await session(u.id, b.id, { storyClockYear: 5 } as any)
		await seat(s.id, held.id, m.id)
		const row = (await readCast(s.id)).sessionCharacters[0]
		expect(row.character.id).toBe(held.id)
		expect(row).toMatchObject({
			ref: `character:${held.id}`,
			castMemberId: m.id,
			cardId: younger.id
		})
	})

	test("a seat with no member anywhere: no member id, and the card the seat holds", async () => {
		const u = await user()
		const c = await card(u.id, "Alone")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, null)
		const row = (await readCast(s.id)).sessionCharacters[0]
		expect(row).toMatchObject({
			ref: `character:${c.id}`,
			castMemberId: null,
			cardId: c.id
		})
	})

	test("castMemberId is the seat's member, not the attached book's member of that card", async () => {
		const u = await user()
		const c = await card(u.id, "Wren")
		const attached = await book(u.id)
		const attachedMember = await member(attached.id, c.id, {
			ownName: "Wren of the Book"
		})
		const s = await session(u.id, attached.id)
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const own = await insertOwnBook(db(), {
			sessionId: s.id,
			userId: u.id,
			name: null,
			overlayOf: attached.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		const ownMember = await member(own.id, c.id, {
			ownName: "Wren of the Notes"
		})
		expect(ownMember.id).not.toBe(attachedMember.id)
		await seat(s.id, c.id, ownMember.id)
		const row = (await readCast(s.id)).sessionCharacters[0]
		expect(row.castMemberId).toBe(ownMember.id)
		expect(row.castMemberId).not.toBe(attachedMember.id)
	})
})

describe("history rows carry the speaker's cast member (★S3-3)", () => {
	test("a stamped row names its castMemberId; an unstamped row reads as it did", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id)
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		await testDb.insert(schema.sessionMessages).values([
			{ sessionId: s.id, role: "assistant", content: "stamped", characterId: c.id, castMemberId: m.id },
			{ sessionId: s.id, role: "assistant", content: "unstamped", characterId: c.id }
		] as any)
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const rows = (await createHost(db(), { sessionId: s.id }).read!(
			"session_messages",
			{ sessionId: s.id },
			{ key: "history", definitionId: "core:query/session-history", definitionVersion: 1, kind: "query" } as any
		)) as any[]
		const byContent = new Map(rows.map((r) => [r.content, r]))
		expect(byContent.get("stamped")).toMatchObject({ characterId: c.id, castMemberId: m.id })
		expect(byContent.get("unstamped")).not.toHaveProperty("castMemberId")
	})
})
