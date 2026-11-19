/**
 * `canActOnMessage`: a line's seat is resolved within the line's own kind,
 * departed seats included. A person's line stays its person's after the seat
 * moves to the AI-played group; an AI line is never judged by a player seat.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacyMany } from "$lib/server/messages/store"
import { insertCastMember } from "$lib/server/characters/versions"
import { seatCast } from "$lib/server/sessions/seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {}),
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-perm-ownkind-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db
const gone = new Date("2026-01-01T00:00:00Z")

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `ownkind-${label}-${++n}`))!
}

async function can(messageId: number, userId: number, verb?: "change" | "rerun") {
	const { canActOnMessage } = await import("$lib/server/messages/permissions")
	return canActOnMessage(db(), messageId, userId, verb)
}

async function table() {
	const owner = await user("owner")
	const g = await user("g")
	const x = await user("x")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` })
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${++n}`,
			lorebookId: book!.id
		})
		.returning()
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId: s!.id, userId: g.id, isPlayer: true },
		{ sessionId: s!.id, userId: x.id, isPlayer: true }
	])
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), s!.id)
	return { owner, g, x, sessionId: s!.id, ownBookId: own.id }
}
type T = Awaited<ReturnType<typeof table>>

async function memberOf(t: T, characterId: number | null) {
	const { member } = await insertCastMember(testDb, {
		lorebookId: t.ownBookId,
		binding: `{{char:ownkind-${++n}}}`,
		characterId,
		name: "M",
		ownName: "M"
	})
	return member
}

async function seatCharacter(t: T, memberId: number, seatedBy: number) {
	const seated = await testDb.transaction(async (tx) =>
		seatCast(tx as unknown as Db, {
			sessionId: t.sessionId,
			castMemberId: memberId,
			seatedBy
		})
	)
	if (!seated.ok) throw new Error("not seated")
}

async function guestCard(t: T) {
	const [c] = await testDb
		.insert(schema.characters)
		.values({ userId: t.g.id, name: `Gcard ${++n}`, description: "" })
		.returning()
	return c!
}

/** The guest's carded player seat with a stamped and an unstamped line. */
async function carded(t: T) {
	const c = await guestCard(t)
	const [pseat] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: t.sessionId, personaId: c.id, userId: t.g.id })
		.returning()
	const [stamped, bare] = await insertLegacyMany(testDb, [
		{
			sessionId: t.sessionId,
			userId: t.g.id,
			characterId: null,
			personaId: c.id,
			role: "user",
			content: "Stamped.",
			metadata: { speaker: `player-seat:${pseat!.id}` }
		},
		{
			sessionId: t.sessionId,
			userId: t.g.id,
			characterId: null,
			personaId: c.id,
			role: "user",
			content: "Unstamped.",
			metadata: {}
		}
	])
	return { c, pseat: pseat!, stamped: stamped!, bare: bare! }
}

async function moveCarded(t: T, c: { id: number }, pseatId: number) {
	await testDb
		.update(schema.sessionPersonas)
		.set({ removedAt: gone })
		.where(
			(await import("drizzle-orm")).eq(schema.sessionPersonas.id, pseatId)
		)
	const member = await memberOf(t, c.id)
	await seatCharacter(t, member.id, t.g.id)
	return member
}

describe("after a person's player seat moves to a character seat of the same card", () => {
	test("the guest's earlier person lines stay the guest's: change and rerun", async () => {
		const t = await table()
		const { c, pseat, stamped, bare } = await carded(t)
		await moveCarded(t, c, pseat.id)
		for (const line of [stamped, bare])
			for (const verb of ["change", "rerun"] as const) {
				expect(await can(line.id, t.g.id, verb)).toBe(true)
				expect(await can(line.id, t.owner.id, verb)).toBe(false)
				expect(await can(line.id, t.x.id, verb)).toBe(false)
			}
	})

	test("a new AI line of the character seat: the owner and the seat's actor may, a third member may not", async () => {
		const t = await table()
		const { c, pseat } = await carded(t)
		await moveCarded(t, c, pseat.id)
		const [ai] = await insertLegacyMany(testDb, [
			{
				sessionId: t.sessionId,
				userId: t.owner.id,
				characterId: c.id,
				personaId: null,
				role: "assistant",
				content: "AI line.",
				metadata: {}
			}
		])
		expect(await can(ai!.id, t.owner.id)).toBe(true)
		expect(await can(ai!.id, t.g.id)).toBe(true)
		expect(await can(ai!.id, t.x.id)).toBe(false)
	})
})

describe("a card-less member's seat moves", () => {
	test("earlier person lines stay the player's; a new seated-member line is the owner's, not the guest's", async () => {
		const t = await table()
		const member = await memberOf(t, null)
		const [pseat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				castMemberId: member.id,
				userId: t.g.id,
				seatName: "Gee"
			})
			.returning()
		const [person] = await insertLegacyMany(testDb, [
			{
				sessionId: t.sessionId,
				userId: t.g.id,
				characterId: null,
				personaId: null,
				role: "user",
				content: "Typed.",
				metadata: { speaker: `player-seat:${pseat!.id}` }
			}
		])
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: gone })
			.where(
				(await import("drizzle-orm")).eq(
					schema.sessionPersonas.id,
					pseat!.id
				)
			)
		await seatCharacter(t, member.id, t.owner.id)
		const [ai] = await insertLegacyMany(testDb, [
			{
				sessionId: t.sessionId,
				userId: t.owner.id,
				characterId: null,
				personaId: null,
				role: "assistant",
				content: "Seated.",
				metadata: { speaker: `seated-member:${member.id}` }
			}
		])
		expect(await can(person!.id, t.g.id)).toBe(true)
		expect(await can(person!.id, t.owner.id)).toBe(false)
		expect(await can(ai!.id, t.owner.id)).toBe(true)
		expect(await can(ai!.id, t.g.id)).toBe(false)
	})
})

describe("★K-2: one card held by a live player seat and a live character seat", () => {
	test("a person line is the guest's; an AI line the owner's and not the guest's", async () => {
		const t = await table()
		const { c, stamped, bare } = await carded(t)
		const member = await memberOf(t, c.id)
		await seatCharacter(t, member.id, t.owner.id)
		const [ai] = await insertLegacyMany(testDb, [
			{
				sessionId: t.sessionId,
				userId: t.owner.id,
				characterId: c.id,
				personaId: null,
				role: "assistant",
				content: "AI.",
				metadata: {}
			}
		])
		for (const line of [stamped, bare]) {
			expect(await can(line.id, t.g.id)).toBe(true)
			expect(await can(line.id, t.owner.id)).toBe(false)
		}
		expect(await can(ai!.id, t.owner.id)).toBe(true)
		// The guest owns the card, so the card-owner fallback is not reached:
		// the seat's actor (the owner) decides.
		expect(await can(ai!.id, t.g.id)).toBe(false)
	})

	test("an unstamped person line is the player's person's, not the character seat's seater's", async () => {
		const t = await table()
		const { c, bare } = await carded(t)
		const member = await memberOf(t, c.id)
		await seatCharacter(t, member.id, t.owner.id)
		expect(await can(bare.id, t.g.id)).toBe(true)
		expect(await can(bare.id, t.owner.id)).toBe(false)
	})
})
