/**
 * 🚧 The speaker stamp (plan §27 S2, ★27-7): a message written for a seated
 * speaker carries the seat's cast member on `session_messages.cast_member_id`
 * and its mirror `messages.cast_member_id`, null while the seat has none.
 * One rule in one place — the store's `insertLegacy` / `insertLegacyMany` /
 * `updateLegacy` — against a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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
		path.join(os.tmpdir(), "serene-pub-vitest-s27turns-stamp-")
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

describe("the speaker stamp", () => {
	test("a character line carries the character seat's member, on both tables", async () => {
		const { c, m, s } = await world()
		await characterSeat(s.id, c.id, m.id)
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Hello.",
			characterId: c.id
		})
		expect(row.castMemberId).toBe(m.id)
		expect(await stampsOf(row.id)).toEqual({ legacy: m.id, mirror: m.id })
	})

	test("a persona line carries the player seat's member", async () => {
		const { u, c, m, s } = await world()
		await playerSeat(s.id, u.id, c.id, m.id)
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "I step in.",
			userId: u.id,
			personaId: c.id
		})
		expect(await stampsOf(row.id)).toEqual({ legacy: m.id, mirror: m.id })
	})

	test("a line from a card-less player seat carries that seat's member", async () => {
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
		expect(await stampsOf(row.id)).toEqual({
			legacy: lone.id,
			mirror: lone.id
		})
	})

	test("narration, an envoy's line and a seat with no member stay null", async () => {
		const { c, s } = await world()
		await characterSeat(s.id, c.id, null)
		const narration = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Rain.",
			isNarratorResponse: true
		})
		const envoy = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "The guide speaks.",
			metadata: { speaker: "envoy:guide" }
		})
		const unfilled = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "No member yet.",
			characterId: c.id
		})
		for (const row of [narration, envoy, unfilled])
			expect(await stampsOf(row.id)).toEqual({
				legacy: null,
				mirror: null
			})
	})

	test("a caller-given member is kept, even null", async () => {
		const { c, m, s } = await world()
		await characterSeat(s.id, c.id, m.id)
		const given = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "A copy.",
			characterId: c.id,
			castMemberId: null
		})
		expect(await stampsOf(given.id)).toEqual({ legacy: null, mirror: null })
	})

	test("insertLegacyMany stamps each row by its own speaker", async () => {
		const { u, c, b, m, s } = await world()
		const other = await card(u.id, "Wren")
		const mo = await member(b.id, other.id)
		await characterSeat(s.id, c.id, m.id, { position: 0 })
		await characterSeat(s.id, other.id, mo.id, { position: 1 })
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
				characterId: other.id
			},
			{
				sessionId: s.id,
				role: "assistant",
				content: "c",
				characterId: c.id
			},
			{
				sessionId: s.id,
				role: "assistant",
				content: "n",
				isNarratorResponse: true
			}
		])
		const out = []
		for (const r of rows) out.push(await stampsOf(r.id))
		expect(out).toEqual([
			{ legacy: m.id, mirror: m.id },
			{ legacy: mo.id, mirror: mo.id },
			{ legacy: m.id, mirror: m.id },
			{ legacy: null, mirror: null }
		])
	})

	test("an update that moves the speaker re-stamps, and mirrors", async () => {
		const { u, c, b, m, s } = await world()
		const other = await card(u.id, "Wren")
		const mo = await member(b.id, other.id)
		await characterSeat(s.id, c.id, m.id, { position: 0 })
		await characterSeat(s.id, other.id, mo.id, { position: 1 })
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Hello.",
			characterId: c.id
		})
		expect(await stampsOf(row.id)).toEqual({ legacy: m.id, mirror: m.id })

		const moved = await updateLegacy(db(), row.id, {
			characterId: other.id
		})
		expect(moved?.castMemberId).toBe(mo.id)
		expect(await stampsOf(row.id)).toEqual({ legacy: mo.id, mirror: mo.id })

		// By predicate, too.
		const [again] = await updateLegacyWhere(
			db(),
			eq(schema.sessionMessages.id, row.id),
			{ characterId: c.id }
		)
		expect(again.castMemberId).toBe(m.id)
		expect(await stampsOf(row.id)).toEqual({ legacy: m.id, mirror: m.id })

		// A streaming patch that leaves the speaker alone leaves the stamp.
		await updateLegacy(db(), row.id, { content: "Hello, there." })
		expect(await stampsOf(row.id)).toEqual({ legacy: m.id, mirror: m.id })
	})

	test("inside a transaction it works on the tx", async () => {
		const { c, m, s } = await world()
		await characterSeat(s.id, c.id, m.id)
		const id = await testDb.transaction(async (tx) => {
			const row = await insertLegacy(tx as unknown as Db, {
				sessionId: s.id,
				role: "assistant",
				content: "In a transaction.",
				characterId: c.id
			})
			await updateLegacy(tx as unknown as Db, row.id, {
				content: "Still."
			})
			return row.id
		})
		expect(await stampsOf(id)).toEqual({ legacy: m.id, mirror: m.id })
	})
})

describe("🚧 the speaker stamp reads the bench (owner 2026-11-10)", () => {
	test("a benched seat still answers when it is the only one holding the card", async () => {
		const { u, c, m, s } = await world()
		await playerSeat(s.id, u.id, c.id, m.id, { isActive: false })
		const row = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "A line already spoken.",
			userId: u.id,
			personaId: c.id
		})
		expect(row.castMemberId).toBe(m.id)
	})
})
