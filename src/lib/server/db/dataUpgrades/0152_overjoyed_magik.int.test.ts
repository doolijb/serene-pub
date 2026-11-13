/**
 * The benched-seats upgrade: a removed seat that has lines becomes a benched
 * one (`is_active = false`, `removed_at = NULL`, `removed_name` kept); a merge
 * victim, an envoy, a row with neither card nor member, a row with no lines
 * and a row whose member a live seat already holds stay removed; of two
 * removed rows of one member only the newer converts; a live row is never
 * touched; and after it the seat-members pass merges nothing and a second
 * boot changes nothing. On the real schema.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatMembers } from "$lib/server/sessions/seatMembers"
import { run } from "./0152_overjoyed_magik"

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
		path.join(os.tmpdir(), "serene-pub-vitest-benchedSeats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = () => testDb as unknown as Db
const upgrade = () =>
	testDb.transaction(async (tx) => run(tx as unknown as MigrationTx))

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("benched-user") })
		.returning()
	return row!
}
async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return row!
}
async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return row!
}
async function member(
	lorebookId: number,
	characterId: number | null,
	name = ""
) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: uniq("{{char:x}}"), characterId, name })
		.returning()
	return row!
}
async function session(userId: number, lorebookId?: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: lorebookId ?? null
		})
		.returning()
	return row!
}
const gone = () => new Date("2026-01-01T00:00:00Z")
async function characterSeat(
	sessionId: number,
	extra: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, ...extra })
		.returning()
	return row!
}
async function playerSeat(
	sessionId: number,
	extra: Partial<typeof schema.sessionPersonas.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, ...extra })
		.returning()
	return row!
}
async function line(
	sessionId: number,
	extra: Partial<typeof schema.sessionMessages.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "Hello", ...extra })
		.returning()
	return row!
}
const characterRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.id, id))
	)[0]!
const playerRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, id))
	)[0]!
const retire = (sessionId: number) =>
	testDb.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
const everything = async () => ({
	characters: await testDb
		.select()
		.from(schema.sessionCharacters)
		.orderBy(schema.sessionCharacters.id),
	players: await testDb
		.select()
		.from(schema.sessionPersonas)
		.orderBy(schema.sessionPersonas.id),
	bindings: await testDb
		.select()
		.from(schema.lorebookBindings)
		.orderBy(schema.lorebookBindings.id)
})

describe("what becomes benched", () => {
	test("a removed carded character seat with a line", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const s = await session(u.id)
		const seat = await characterSeat(s.id, {
			characterId: c.id,
			removedAt: gone(),
			removedName: "Maren",
			isActive: true
		})
		await line(s.id, { characterId: c.id })
		await upgrade()
		expect(await characterRow(seat.id)).toMatchObject({
			isActive: false,
			removedAt: null,
			removedName: "Maren"
		})
		await retire(s.id)
	})

	test("a removed card-less character seat (a member, no card) with a line", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, "Wren")
		const s = await session(u.id, b.id)
		const seat = await characterSeat(s.id, {
			castMemberId: m.id,
			removedAt: gone(),
			removedName: "Wren"
		})
		await line(s.id, { castMemberId: m.id })
		await upgrade()
		expect(await characterRow(seat.id)).toMatchObject({
			isActive: false,
			removedAt: null,
			removedName: "Wren"
		})
		await retire(s.id)
	})

	test("a removed carded player seat with a line", async () => {
		const u = await user()
		const c = await card(u.id, "Hero")
		const s = await session(u.id)
		const seat = await playerSeat(s.id, {
			personaId: c.id,
			userId: u.id,
			removedAt: gone(),
			removedName: "Hero"
		})
		await line(s.id, { personaId: c.id, role: "user" })
		await upgrade()
		expect(await playerRow(seat.id)).toMatchObject({
			isActive: false,
			removedAt: null,
			removedName: "Hero"
		})
		await retire(s.id)
	})

	test("a removed card-less player seat with a player-seat line", async () => {
		const u = await user()
		const s = await session(u.id)
		const seat = await playerSeat(s.id, {
			seatName: "Kestrel",
			userId: u.id,
			removedAt: gone(),
			removedName: "Kestrel"
		})
		await line(s.id, {
			role: "user",
			metadata: { speaker: `player-seat:${seat.id}` } as never
		})
		await upgrade()
		expect(await playerRow(seat.id)).toMatchObject({
			isActive: false,
			removedAt: null,
			removedName: "Kestrel"
		})
		await retire(s.id)
	})
})

describe("what stays removed", () => {
	test("a merge victim", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const s = await session(u.id)
		const survivor = await characterSeat(s.id, { characterId: c.id })
		const victim = await characterSeat(s.id, {
			removedAt: gone(),
			mergedInto: survivor.id
		})
		await line(s.id, { characterId: c.id })
		await upgrade()
		expect((await characterRow(victim.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("an envoy", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, "Mascot")
		const s = await session(u.id, b.id)
		const envoy = await characterSeat(s.id, {
			envoySlug: "mascot",
			castMemberId: m.id,
			removedAt: gone()
		})
		await line(s.id, { castMemberId: m.id })
		await upgrade()
		expect((await characterRow(envoy.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("a character row with neither card nor member", async () => {
		const u = await user()
		const s = await session(u.id)
		const bare = await characterSeat(s.id, { removedAt: gone() })
		await line(s.id)
		await upgrade()
		expect((await characterRow(bare.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("a removed row with no lines, character and player", async () => {
		const u = await user()
		const c = await card(u.id, "Quiet")
		const p = await card(u.id, "Silent")
		const s = await session(u.id)
		const quiet = await characterSeat(s.id, {
			characterId: c.id,
			removedAt: gone()
		})
		const silent = await playerSeat(s.id, {
			personaId: p.id,
			removedAt: gone()
		})
		await upgrade()
		expect((await characterRow(quiet.id)).removedAt).not.toBeNull()
		expect((await playerRow(silent.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("a row whose member a live character seat holds", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, "Wren")
		const s = await session(u.id, b.id)
		await characterSeat(s.id, { castMemberId: m.id })
		const old = await characterSeat(s.id, {
			castMemberId: m.id,
			removedAt: gone()
		})
		await line(s.id, { castMemberId: m.id })
		await upgrade()
		expect((await characterRow(old.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("a carded row whose card's linked member a live seat holds (the row has no member)", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Maren")
		const s = await session(u.id, b.id)
		await playerSeat(s.id, { castMemberId: m.id, userId: u.id })
		const old = await characterSeat(s.id, {
			characterId: c.id,
			removedAt: gone()
		})
		await line(s.id, { characterId: c.id })
		await upgrade()
		expect((await characterRow(old.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("a live carded seat with no member stored holds the member its card resolves to", async () => {
		const u = await user()
		const liveCard = await card(u.id, "Isolde")
		const oldCard = await card(u.id, "Isolde, younger")
		const b = await book(u.id)
		const m = await member(b.id, null, "Isolde")
		// Both cards are drawn by a dated cast version of the one member.
		for (const [i, cardId] of [liveCard.id, oldCard.id].entries()) {
			const [parent] = await testDb
				.insert(schema.characterVersions)
				.values({ cardId, number: 1, writeOrder: 1 })
				.returning()
			await testDb.insert(schema.characterVersions).values({
				castMemberId: m.id,
				parentVersionId: parent!.id,
				lorebookId: b.id,
				writeOrder: 2,
				// the base version is unique per member; the second card's is dated
				year: i === 0 ? null : 100,
				nodeState: "active",
				nodeVisibility: "normal"
			})
		}
		const s = await session(u.id, b.id)
		const live = await characterSeat(s.id, { characterId: liveCard.id })
		expect(live.castMemberId).toBeNull()
		const old = await characterSeat(s.id, {
			characterId: oldCard.id,
			removedAt: gone()
		})
		await line(s.id, { characterId: oldCard.id })
		await upgrade()
		expect((await characterRow(old.id)).removedAt).not.toBeNull()
		expect((await characterRow(live.id)).removedAt).toBeNull()
		await retire(s.id)
	}, 60_000)

	test("two removed rows of one member: only the newer converts", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, "Wren")
		const s = await session(u.id, b.id)
		const older = await characterSeat(s.id, {
			castMemberId: m.id,
			removedAt: gone()
		})
		const newer = await characterSeat(s.id, {
			castMemberId: m.id,
			removedAt: gone()
		})
		await line(s.id, { castMemberId: m.id })
		await upgrade()
		expect(await characterRow(newer.id)).toMatchObject({
			isActive: false,
			removedAt: null
		})
		expect((await characterRow(older.id)).removedAt).not.toBeNull()
		await retire(s.id)
	})

	test("a live row is untouched", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const p = await card(u.id, "Hero")
		const s = await session(u.id)
		const live = await characterSeat(s.id, {
			characterId: c.id,
			isActive: true
		})
		const benched = await characterSeat(s.id, {
			characterId: p.id,
			isActive: false
		})
		const liveP = await playerSeat(s.id, { personaId: p.id })
		await line(s.id, { characterId: c.id })
		const before = [
			await characterRow(live.id),
			await characterRow(benched.id),
			await playerRow(liveP.id)
		]
		await upgrade()
		expect([
			await characterRow(live.id),
			await characterRow(benched.id),
			await playerRow(liveP.id)
		]).toEqual(before)
		await retire(s.id)
	})
})

describe("second boot", () => {
	test("the seat-members pass merges nothing after it, and nothing changes again", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const d = await card(u.id, "Hero")
		const e = await card(u.id, "Linked")
		const b = await book(u.id)
		const wren = await member(b.id, null, "Wren")
		const linked = await member(b.id, e.id, "Linked")
		const silent = await member(b.id, null, "Silent")
		const s = await session(u.id, b.id)
		// Converts: carded character, card-less character, carded player, card-less player.
		const carded = await characterSeat(s.id, {
			characterId: c.id,
			removedAt: gone(),
			removedName: "Maren"
		})
		const cardless = await characterSeat(s.id, {
			castMemberId: wren.id,
			removedAt: gone(),
			removedName: "Wren"
		})
		const hero = await playerSeat(s.id, {
			personaId: d.id,
			userId: u.id,
			removedAt: gone(),
			removedName: "Hero"
		})
		const kestrel = await playerSeat(s.id, {
			seatName: "Kestrel",
			userId: u.id,
			removedAt: gone(),
			removedName: "Kestrel"
		})
		// Stays removed: a held member, a row with no lines.
		await characterSeat(s.id, { castMemberId: linked.id })
		const held = await characterSeat(s.id, {
			characterId: e.id,
			removedAt: gone()
		})
		const quiet = await characterSeat(s.id, {
			castMemberId: silent.id,
			removedAt: gone()
		})
		await line(s.id, { characterId: c.id })
		await line(s.id, { castMemberId: wren.id })
		await line(s.id, { personaId: d.id, role: "user" })
		await line(s.id, {
			role: "user",
			metadata: { speaker: `player-seat:${kestrel.id}` } as never
		})
		await line(s.id, { characterId: e.id })

		await upgrade()
		expect(await characterRow(carded.id)).toMatchObject({
			isActive: false,
			removedAt: null
		})
		expect(await characterRow(cardless.id)).toMatchObject({
			isActive: false,
			removedAt: null
		})
		expect((await playerRow(hero.id)).removedAt).toBeNull()
		expect((await playerRow(kestrel.id)).removedAt).toBeNull()
		expect((await characterRow(held.id)).removedAt).not.toBeNull()
		expect((await characterRow(quiet.id)).removedAt).not.toBeNull()

		const first = await seatMembers(asDb())
		expect(first.merged).toBe(0)
		const afterFirst = await everything()
		const second = await seatMembers(asDb())
		expect(second.merged).toBe(0)
		expect(await everything()).toEqual(afterFirst)

		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		await upgrade()
		const logged = log.mock.calls.filter((c) =>
			String(c[0]).includes("[upgrade 0152]")
		)
		log.mockRestore()
		expect(logged).toEqual([])
		expect(await everything()).toEqual(afterFirst)
		await retire(s.id)
	})
})
