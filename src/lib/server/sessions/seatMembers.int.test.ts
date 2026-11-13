/**
 * ⏳ The `seat-members` boot pass (`sessions/seatMembers.ts`, plan §27 v2 S1).
 *
 * Claims: seats written without members (the attic's shape) get the member
 * their card is — by the card, never by a number that happens to match; two
 * live character seats of one member become one (the linked card's survives,
 * the other departs as a removal does and names the survivor in `merged_into`,
 * its messages untouched); a player seat and a character seat on one card
 * both carry the member and do not merge; a departed card-less seat and an
 * envoy seat are left; a deleted card no member has is minted for, card-less,
 * where a book may take the member; a second run changes nothing; the fast
 * path is two queries; one session's failure rolls back that session alone.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	ensureCardVersion,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { seatMembers } from "./seatMembers"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const failing = vi.hoisted(() => ({ sessionId: -1 }))

vi.mock("$lib/server/sessions/seats", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/sessions/seats")>()
	return {
		...actual,
		// The real settle runs, then a chosen session throws: its writes must not survive.
		settleSeats: async (
			tx: Db,
			sessionId: number,
			opts?: { merge?: boolean }
		) => {
			const report = await actual.settleSeats(tx, sessionId, opts)
			if (sessionId === failing.sessionId) throw new Error("boom")
			return report
		}
	}
})

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatMembers-")
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

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("seat-members-user") })
		.returning()
	return row!
}
async function card(
	userId: number,
	name: string,
	extra: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "", ...extra })
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
/** A dated card: a cast version of the member whose parent is the card's version. */
async function datedCard(memberId: number, lorebookId: number, cardId: number) {
	const parent = await ensureCardVersion(asDb(), cardId)
	await insertCharacterVersions(asDb(), [
		{
			castMemberId: memberId,
			lorebookId,
			parentVersionId: parent!.id,
			follows: ["name", "nickname"],
			nodeState: "active",
			nodeVisibility: "normal",
			year: 1,
			writtenBy: "user:0"
		}
	])
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
/** An attic-shaped seat: a card, no member. */
async function atticSeat(
	sessionId: number,
	characterId: number | null,
	extra: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, ...extra })
		.returning()
	return row!
}
const seatsOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(schema.sessionCharacters.id)
const playersOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(schema.sessionPersonas.id)
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

/** Delete a session (its seats cascade) so a seat nothing can explain stops being a candidate for later tests. */
const retire = (sessionId: number) =>
	testDb.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))

const ZEROS = {
	sessions: 0,
	filled: 0,
	minted: 0,
	merged: 0,
	unexplained: 0,
	failed: 0
}

describe("the pass", () => {
	test("a database with nothing to do: zeros, and nothing written", async () => {
		const before = await everything()
		expect(await seatMembers(asDb())).toEqual(ZEROS)
		expect(await everything()).toEqual(before)
	})

	test("a card whose id equals another person's member id still gets its own member", async () => {
		const u = await user()
		const b = await book(u.id)
		const decoyCard = await card(u.id, "Decoy")
		// Both id sequences are moved to one number, so the decoy member and the
		// next card are given the same id; a seat that took "its card's id" for
		// "its member's id" would land on the wrong person.
		const [{ top }] = (
			await testDb.execute(
				sql`select greatest((select max(id) from characters), (select max(id) from lorebook_bindings))::int as top`
			)
		).rows as { top: number }[]
		const shared = top + 5
		await testDb.execute(
			sql`select setval(pg_get_serial_sequence('lorebook_bindings', 'id'), ${shared - 1})`
		)
		await testDb.execute(
			sql`select setval(pg_get_serial_sequence('characters', 'id'), ${shared - 1})`
		)
		const decoy = await member(b.id, decoyCard.id, "Decoy")
		const twin = await card(u.id, "Twin")
		expect(twin.id).toBe(decoy.id)
		const realMember = await member(b.id, twin.id, "Twin")
		expect(realMember.id).not.toBe(twin.id)
		const s = await session(u.id, b.id)
		await atticSeat(s.id, twin.id)
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: s.id, personaId: twin.id })

		const report = await seatMembers(asDb())
		expect(report).toMatchObject({
			sessions: 1,
			filled: 2,
			minted: 0,
			merged: 0,
			failed: 0
		})
		const [seat] = await seatsOf(s.id)
		expect(seat!.castMemberId).toBe(realMember.id)
		expect(seat!.castMemberId).not.toBe(decoy.id)
		expect((await playersOf(s.id))[0]!.castMemberId).toBe(realMember.id)
	})

	test("a card with no member gets one minted; a departed card is found for, never minted for", async () => {
		const u = await user()
		const b = await book(u.id)
		const known = await card(u.id, "Known")
		const m = await member(b.id, known.id, "Known")
		const fresh = await card(u.id, "Fresh")
		const departedNoMember = await card(u.id, "Left Unknown")
		const s = await session(u.id, b.id)
		const gone = new Date()
		const liveFresh = await atticSeat(s.id, fresh.id)
		const departedKnown = await atticSeat(s.id, known.id, {
			removedAt: gone,
			removedName: "Known",
			isActive: false
		})
		const departedUnknown = await atticSeat(s.id, departedNoMember.id, {
			removedAt: gone,
			removedName: "Left Unknown",
			isActive: false
		})

		const report = await seatMembers(asDb())
		expect(report).toMatchObject({
			sessions: 1,
			filled: 2,
			minted: 1,
			merged: 0,
			unexplained: 0
		})
		const rows = await seatsOf(s.id)
		const byId = new Map(rows.map((r) => [r.id, r]))
		const minted = byId.get(liveFresh.id)!.castMemberId
		expect(minted).not.toBeNull()
		const [mintedRow] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, minted!))
		expect(mintedRow).toMatchObject({
			lorebookId: b.id,
			characterId: fresh.id,
			name: "Fresh"
		})
		expect(byId.get(departedKnown.id)!.castMemberId).toBe(m.id)
		expect(byId.get(departedUnknown.id)!.castMemberId).toBeNull()
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(
					eq(schema.lorebookBindings.characterId, departedNoMember.id)
				)
		).toHaveLength(0)
		// A departed seat never makes its session a candidate: the second boot reads nothing.
		const again = await seatMembers(asDb())
		expect(again).toMatchObject({
			sessions: 0,
			filled: 0,
			minted: 0,
			merged: 0,
			unexplained: 0,
			failed: 0
		})
		await retire(s.id)
	})

	test("two live seats of one member become one: the linked card's survives, the other departs", async () => {
		const u = await user()
		const b = await book(u.id)
		const linked = await card(u.id, "Maren")
		const dated = await card(u.id, "Maren, younger", { nickname: "Mari" })
		const m = await member(b.id, linked.id, "Maren")
		await datedCard(m.id, b.id, dated.id)
		const other = await card(u.id, "Someone else")
		const s = await session(u.id, b.id)
		// The dated card's seat is first, active and lowest in position: only the link outranks it.
		const datedSeat = await atticSeat(s.id, dated.id, {
			position: 0,
			isActive: true
		})
		const linkedSeat = await atticSeat(s.id, linked.id, {
			position: 3,
			isActive: false
		})
		const otherSeat = await atticSeat(s.id, other.id, { position: 1 })
		const [line] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: s.id,
				role: "assistant",
				content: "Hello",
				characterId: dated.id
			})
			.returning()

		const report = await seatMembers(asDb())
		expect(report).toMatchObject({
			sessions: 1,
			minted: 1,
			merged: 1,
			unexplained: 0,
			failed: 0
		})
		const rows = new Map((await seatsOf(s.id)).map((r) => [r.id, r]))
		expect(rows.get(linkedSeat.id)).toMatchObject({
			castMemberId: m.id,
			removedAt: null,
			isActive: false,
			mergedInto: null
		})
		const departed = rows.get(datedSeat.id)!
		expect(departed).toMatchObject({
			castMemberId: m.id,
			removedName: "Mari",
			isActive: false,
			mergedInto: linkedSeat.id
		})
		expect(departed.removedAt).toBeInstanceOf(Date)
		expect(rows.get(otherSeat.id)).toMatchObject({
			removedAt: null,
			mergedInto: null
		})
		expect(rows.get(otherSeat.id)!.castMemberId).not.toBe(m.id)
		// Lines are S4's: untouched.
		const [after] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, line!.id))
		expect(after).toEqual(line)
	})

	test("with no link among them: the active seat, then the lowest position, then the lowest id", async () => {
		const u = await user()
		const b = await book(u.id)
		const home = await card(u.id, "Home card")
		const m = await member(b.id, home.id, "Wren")
		const a = await card(u.id, "A")
		const c = await card(u.id, "C")
		const d = await card(u.id, "D")
		for (const x of [a, c, d]) await datedCard(m.id, b.id, x.id)
		const s = await session(u.id, b.id)
		const seatA = await atticSeat(s.id, a.id, {
			position: 2,
			isActive: false
		})
		const seatC = await atticSeat(s.id, c.id, {
			position: 5,
			isActive: true
		})
		const seatD = await atticSeat(s.id, d.id, {
			position: 5,
			isActive: true
		})
		const report = await seatMembers(asDb())
		expect(report.merged).toBe(2)
		const rows = new Map((await seatsOf(s.id)).map((r) => [r.id, r]))
		expect(rows.get(seatC.id)).toMatchObject({
			removedAt: null,
			mergedInto: null
		})
		expect(rows.get(seatA.id)).toMatchObject({
			isActive: false,
			mergedInto: seatC.id
		})
		expect(rows.get(seatA.id)!.removedAt).not.toBeNull()
		expect(rows.get(seatD.id)).toMatchObject({ mergedInto: seatC.id })
	})

	test("a player seat and a character seat on one card both carry the member, and do not merge", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Dual")
		const m = await member(b.id, c.id, "Dual")
		const s = await session(u.id, b.id)
		const seat = await atticSeat(s.id, c.id)
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: s.id, personaId: c.id })
		const report = await seatMembers(asDb())
		expect(report).toMatchObject({ sessions: 1, filled: 2, merged: 0 })
		expect((await seatsOf(s.id))[0]).toMatchObject({
			id: seat.id,
			castMemberId: m.id,
			removedAt: null,
			mergedInto: null
		})
		expect((await playersOf(s.id))[0]).toMatchObject({
			castMemberId: m.id,
			removedAt: null
		})
	})

	test("a departed card-less seat and an envoy seat are left untouched; a deleted card no member has gets a card-less member in the attached book", async () => {
		const u = await user()
		const b = await book(u.id)
		const deleted = await card(u.id, "Deleted", { isDeleted: true })
		const s = await session(u.id, b.id)
		const lost = await atticSeat(s.id, null, {
			removedAt: new Date(),
			removedName: "Lost Soul",
			isActive: false
		})
		const unexplained = await atticSeat(s.id, deleted.id)
		const mascot = await atticSeat(s.id, null, { envoySlug: "mascot" })
		// A live card beside them, so settling mints a linked member too.
		const live = await card(u.id, "Live")
		await atticSeat(s.id, live.id)
		const before = new Map((await seatsOf(s.id)).map((r) => [r.id, r]))

		const report = await seatMembers(asDb())
		expect(report).toMatchObject({
			sessions: 1,
			filled: 2,
			minted: 2,
			merged: 0,
			unexplained: 0,
			failed: 0
		})
		const after = new Map((await seatsOf(s.id)).map((r) => [r.id, r]))
		for (const id of [lost.id, mascot.id])
			expect(after.get(id)).toEqual(before.get(id))
		// The deleted card's seat now holds a card-less member named for the card.
		const filledSeat = after.get(unexplained.id)!
		expect(filledSeat.castMemberId).not.toBeNull()
		const [minted] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, filledSeat.castMemberId!))
		expect(minted).toMatchObject({
			characterId: null,
			name: "Deleted",
			lorebookId: b.id
		})
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.characterId, deleted.id))
		).toHaveLength(0)
		await retire(s.id)
	})

	test("a live seat whose card is only a member's dated card is a candidate and gets that member; a second run changes nothing", async () => {
		const u = await user()
		const b = await book(u.id)
		const linked = await card(u.id, "Maren")
		// Deleted, so only the dated-card leg can make the session a candidate.
		const dated = await card(u.id, "Maren, younger", { isDeleted: true })
		const m = await member(b.id, linked.id, "Maren")
		await datedCard(m.id, b.id, dated.id)
		const s = await session(u.id, b.id)
		const seat = await atticSeat(s.id, dated.id)

		const first = await seatMembers(asDb())
		expect(first).toMatchObject({ sessions: 1, minted: 0, failed: 0 })
		const [row] = (await seatsOf(s.id)).filter((r) => r.id === seat.id)
		expect(row!.castMemberId).toBe(m.id)
		const settled = await everything()
		expect(await seatMembers(asDb())).toEqual(ZEROS)
		expect(await everything()).toEqual(settled)
		await retire(s.id)
	})

	test("a session whose lorebook is its own book gets a member for every live carded seat; a second run changes nothing", async () => {
		const u = await user()
		const s = await session(u.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(), s.id)
		const hero = await card(u.id, "Hero")
		const guide = await card(u.id, "Guide")
		const gone = await card(u.id, "Gone", { isDeleted: true })
		const seatA = await atticSeat(s.id, hero.id)
		await atticSeat(s.id, gone.id)
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: s.id, personaId: guide.id })

		const first = await seatMembers(asDb())
		expect(first).toMatchObject({
			sessions: 1,
			filled: 3,
			minted: 3,
			merged: 0,
			failed: 0
		})
		const mintedIn = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, own.id))
		// The deleted card's member is card-less: found by the seat and its name.
		expect(
			mintedIn
				.filter((m) => m.name !== "Gone")
				.map((m) => m.characterId)
				.sort()
		).toEqual([hero.id, guide.id].sort())
		const goneMember = mintedIn.find((m) => m.name === "Gone")!
		expect(goneMember.characterId).toBeNull()
		expect((await seatsOf(s.id))[1]!.castMemberId).toBe(goneMember.id)
		const [heroSeat] = (await seatsOf(s.id)).filter(
			(r) => r.id === seatA.id
		)
		expect(heroSeat!.castMemberId).toBe(
			mintedIn.find((m) => m.characterId === hero.id)!.id
		)
		expect((await playersOf(s.id))[0]!.castMemberId).toBe(
			mintedIn.find((m) => m.characterId === guide.id)!.id
		)
		// Every seat holds a member now; nothing is a candidate again.
		const settled = await everything()
		expect(await seatMembers(asDb())).toEqual(ZEROS)
		expect(await everything()).toEqual(settled)
		await retire(s.id)
	})

	test("a second run changes nothing", async () => {
		// One session settles (a merge, a mint, a fill) beside one whose deleted card no book knows: step 1 mints it a card-less member, once.
		const u = await user()
		const b = await book(u.id)
		const linked = await card(u.id, "Maren")
		const dated = await card(u.id, "Maren, younger")
		const m = await member(b.id, linked.id, "Maren")
		await datedCard(m.id, b.id, dated.id)
		const fresh = await card(u.id, "Fresh")
		const deleted = await card(u.id, "Deleted", { isDeleted: true })
		const s = await session(u.id, b.id)
		await atticSeat(s.id, dated.id)
		await atticSeat(s.id, linked.id)
		await atticSeat(s.id, fresh.id)
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: s.id, personaId: linked.id })
		const t = await session(u.id, b.id)
		await atticSeat(t.id, deleted.id)

		const first = await seatMembers(asDb())
		expect(first).toEqual({
			sessions: 2,
			filled: 5,
			minted: 2,
			merged: 1,
			unexplained: 0,
			failed: 0
		})
		const settled = await everything()
		// Every seat holds a member: the second run reads nothing and changes nothing.
		const second = await seatMembers(asDb())
		expect(second).toEqual(ZEROS)
		expect(await everything()).toEqual(settled)
		expect(await seatMembers(asDb())).toEqual(ZEROS)
		expect(await everything()).toEqual(settled)
		await retire(t.id)
		await retire(s.id)
	})

	test("an attached book that may mint and a deleted card that only the own book knows: a candidate once, filled with the own-book member; a second boot changes nothing", async () => {
		const u = await user()
		const attached = await book(u.id)
		const s = await session(u.id, attached.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(), s.id)
		const gone = await card(u.id, "Gone", { isDeleted: true })
		const ownMember = await member(own.id, gone.id, "Gone")
		const seat = await atticSeat(s.id, gone.id)

		const first = await seatMembers(asDb())
		expect(first).toMatchObject({
			sessions: 1,
			filled: 1,
			minted: 0,
			failed: 0
		})
		expect(
			(await seatsOf(s.id)).find((r) => r.id === seat.id)!.castMemberId
		).toBe(ownMember.id)
		const settled = await everything()
		const second = await seatMembers(asDb())
		expect(second).toEqual(ZEROS)
		expect(second.sessions).toBe(0)
		expect(await everything()).toEqual(settled)
		await retire(s.id)
	})

	test("the same shape with a live card is a candidate once: minted in the attached book; a second run changes nothing", async () => {
		const u = await user()
		const attached = await book(u.id)
		const s = await session(u.id, attached.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(), s.id)
		const live = await card(u.id, "Live")
		await member(own.id, live.id, "Live")
		const seat = await atticSeat(s.id, live.id)

		const first = await seatMembers(asDb())
		expect(first).toMatchObject({
			sessions: 1,
			filled: 1,
			minted: 1,
			failed: 0
		})
		const mintedIn = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, attached.id))
		expect(mintedIn).toHaveLength(1)
		expect(
			(await seatsOf(s.id)).find((r) => r.id === seat.id)!.castMemberId
		).toBe(mintedIn[0]!.id)
		const settled = await everything()
		expect(await seatMembers(asDb())).toEqual(ZEROS)
		expect(await everything()).toEqual(settled)
		await retire(s.id)
	})

	test("one session's failure rolls back that session alone, is counted, and the pass says so", async () => {
		const u = await user()
		const b = await book(u.id)
		const c1 = await card(u.id, "Fail Fran")
		const c2 = await card(u.id, "Win Wes")
		const m1 = await member(b.id, c1.id, "Fran")
		const m2 = await member(b.id, c2.id, "Wes")
		const failS = await session(u.id, b.id)
		const winS = await session(u.id, b.id)
		await atticSeat(failS.id, c1.id)
		await atticSeat(winS.id, c2.id)
		failing.sessionId = failS.id
		const errors = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(seatMembers(asDb())).rejects.toThrow(/1 session/)
			expect(errors).toHaveBeenCalledWith(
				expect.stringContaining(`session ${failS.id}`),
				expect.anything()
			)
		} finally {
			errors.mockRestore()
			failing.sessionId = -1
		}
		expect((await seatsOf(failS.id))[0]!.castMemberId).toBeNull()
		expect((await seatsOf(winS.id))[0]!.castMemberId).toBe(m2.id)
		// The next pass has nothing in the way.
		const report = await seatMembers(asDb())
		expect(report).toMatchObject({ failed: 0, filled: 1 })
		expect((await seatsOf(failS.id))[0]!.castMemberId).toBe(m1.id)
	})
})
