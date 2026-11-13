/**
 * 🚧 The one seat writer (`sessions/seats.ts`, plan §27 v2 S1).
 *
 * Claims: a seated card carries the cast member it is — found in the attached
 * book (linked or dated), else minted there when the session's owner may
 * write it, else in the own book, else minted in the own book (owner ★B-5,
 * 2026-11-08: the session's book is fixed at start); a deleted card no member has gets none and mints none; an envoy seat has none; a revived seat is
 * given its member; a second card of a seated member is refused with the
 * sentence and nothing is written (`"allow"` seats it); a player seat is never
 * refused and carries its card's member.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { asc } from "drizzle-orm"
import { sessionEvents } from "@serene-pub/sdk"
import {
	announceSeatChanges,
	findSeatMembers,
	reseatOnto,
	sameMemberRefusal,
	seatBookOf,
	seatCast,
	seatPlayer,
	SEAT_REFUSALS,
	setSeatBench,
	settleSeats,
	syncMintedSeatMembers,
	unseat
} from "./seats"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("seats-user") })
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

async function book(userId: number, extraJson?: unknown) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	if (extraJson === "provided") {
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					provided: {
						plugin: "acme",
						slug: "world",
						version: "1",
						uuid: row!.uuid
					}
				}
			})
			.where(eq(schema.lorebooks.id, row!.id))
	}
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	name = ""
) {
	const { member: row } = await insertCastMember(testDb, {
		lorebookId,
		binding: uniq("{{char:x}}"),
		characterId,
		name,
		// The member's own name: what it is read as (the binding's `name` is a library label).
		ownName: name || null
	})
	return row
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

const asDb = (tx: unknown) => tx as Db
const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
	testDb.transaction(async (tx) => fn(asDb(tx)))

async function bindingsOf(lorebookId: number) {
	return testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
}

async function seatsOf(sessionId: number) {
	return testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
}

describe("which member a seated card is", () => {
	test("a card linked in the attached book: that member, nothing minted", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Maren")
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id, position: 2 })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: m.id, minted: false })
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			characterId: c.id,
			castMemberId: m.id,
			position: 2,
			isActive: true
		})
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})

	test("a dated card (a cast amendment names it): the dated card's member", async () => {
		const u = await user()
		const young = await card(u.id, "Maren young")
		const old = await card(u.id, "Maren old")
		const b = await book(u.id)
		const m = await member(b.id, old.id, "Maren")
		await insertDatedCardVersion(testDb, m.id, young.id, 1)
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: young.id })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: m.id, minted: false })
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})

	test("a card that is a member only in the own book (the attached book is someone else's): the own book's", async () => {
		const u = await user()
		const other = await user()
		const c = await card(u.id, "Tess")
		const attached = await book(other.id)
		const s = await session(u.id, attached.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const m = await member(own.id, c.id, "Tess")
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: m.id, minted: false })
		expect(await bindingsOf(attached.id)).toHaveLength(0)
		expect(await bindingsOf(own.id)).toHaveLength(1)
	})

	test("a card that is a member only in the own book, the attached book the owner's: a new member in the attached book first", async () => {
		const u = await user()
		const c = await card(u.id, "Tess")
		const attached = await book(u.id)
		const s = await session(u.id, attached.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const ownMember = await member(own.id, c.id, "Tess")
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r.ok && r.minted).toBe(true)
		expect(r.ok && r.castMemberId).not.toBe(ownMember.id)
		const rows = await bindingsOf(attached.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			id: r.ok ? r.castMemberId : -1,
			characterId: c.id
		})
		expect(await bindingsOf(own.id)).toHaveLength(1)
	})

	test("no member, the owner owns the attached book: minted there, named for the card", async () => {
		const u = await user()
		const c = await card(u.id, "Real Name", { nickname: "Wren" })
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r.ok && r.minted).toBe(true)
		// The name is not made inside the transaction: it waits for the card's sync.
		expect(r.ok && r.mintedMembers).toEqual([
			{ cardId: c.id, lorebookId: b.id }
		])
		const unnamed = await bindingsOf(b.id)
		expect(unnamed).toHaveLength(1)
		expect(unnamed[0]!.name).toBe("")
		await syncMintedSeatMembers(asDb(testDb), r.ok ? r.mintedMembers : [])
		const rows = await bindingsOf(b.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			id: r.ok ? r.castMemberId : -1,
			characterId: c.id,
			name: "Wren"
		})
		// Seating her again finds her.
		const again = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(again).toMatchObject({
			ok: true,
			castMemberId: rows[0]!.id,
			minted: false
		})
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})

	test("no member, a book someone else owns: the member is minted in the own book, nothing in theirs", async () => {
		const owner = await user()
		const other = await user()
		const c = await card(owner.id, "Odo")
		const theirs = await book(other.id)
		const s = await session(owner.id, theirs.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: true, minted: true })
		expect(await bindingsOf(theirs.id)).toHaveLength(0)
		const sb = await inTx((tx) => seatBookOf(tx, s.id))
		expect(sb).toMatchObject({
			attachedId: theirs.id,
			attachedMintable: false,
			ownBookId: own.id
		})
		const inOwn = await bindingsOf(own.id)
		expect(inOwn).toHaveLength(1)
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			characterId: c.id,
			castMemberId: inOwn[0]!.id
		})
	})

	test("no member, a provided book: the member is minted in the own book, even for its owner", async () => {
		const u = await user()
		const c = await card(u.id, "Pia")
		const provided = await book(u.id, "provided")
		const s = await session(u.id, provided.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: true, minted: true })
		expect(await bindingsOf(provided.id)).toHaveLength(0)
		const sb = await inTx((tx) => seatBookOf(tx, s.id))
		expect(sb!.attachedMintable).toBe(false)
		const inOwn = await bindingsOf(own.id)
		expect(inOwn).toHaveLength(1)
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			characterId: c.id,
			castMemberId: inOwn[0]!.id
		})
	})

	test("an attached book the owner may write still takes the member, not the own book", async () => {
		const u = await user()
		const c = await card(u.id, "Rex")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: true, minted: true })
		expect(await bindingsOf(b.id)).toHaveLength(1)
		expect(await bindingsOf(own.id)).toHaveLength(0)
	})

	test("a session whose lorebook is its own book: the member is minted in the own book", async () => {
		const u = await user()
		const c = await card(u.id, "Quin")
		const s = await session(u.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: true, minted: true })
		const sb = await inTx((tx) => seatBookOf(tx, s.id))
		expect(sb).toMatchObject({
			attachedId: null,
			attachedMintable: false,
			ownBookId: own.id
		})
		const inOwn = await bindingsOf(own.id)
		expect(inOwn).toHaveLength(1)
		expect(inOwn[0]!.characterId).toBe(c.id)
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			characterId: c.id,
			castMemberId: inOwn[0]!.id
		})
	})

	test("a session with no own book yet: no member, nothing minted", async () => {
		const u = await user()
		const c = await card(u.id, "Quill")
		const s = await session(u.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: null, minted: false })
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({ characterId: c.id, castMemberId: null })
	})

	test("a departed seat is never minted for", async () => {
		const u = await user()
		const c = await card(u.id, "Gone-by")
		const s = await session(u.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: c.id,
			position: 0,
			removedAt: new Date()
		})
		await inTx((tx) => settleSeats(tx, s.id))
		expect(await bindingsOf(own.id)).toHaveLength(0)
	})

	test("a deleted card no member has: no member, nothing minted", async () => {
		const u = await user()
		const gone = await card(u.id, "Gone", { isDeleted: true })
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: gone.id })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: null, minted: false })
		expect(await bindingsOf(b.id)).toHaveLength(0)
		expect(await bindingsOf(own.id)).toHaveLength(0)
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({ characterId: gone.id, castMemberId: null })
	})

	test("a deleted card, a mintable attached book without it, a member in the own book: the own book's member, nothing minted (★RF-1)", async () => {
		const { resolveSeatMember } = await import("./seats")
		const u = await user()
		const gone = await card(u.id, "Gone", { isDeleted: true })
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const m = await member(own.id, gone.id, "Gone")
		const r = await inTx(async (tx) =>
			resolveSeatMember(tx, (await seatBookOf(tx, s.id))!, gone.id, {
				mint: true
			})
		)
		expect(r).toEqual({ memberId: m.id, minted: false, mintedIn: null })
		expect(await bindingsOf(b.id)).toHaveLength(0)
	})
})

describe("an envoy seat", () => {
	test("has no member and is passed through; reviving puts it back", async () => {
		const u = await user()
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, envoySlug: "mascot", position: 3 })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: null, minted: false })
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			envoySlug: "mascot",
			characterId: null,
			castMemberId: null,
			position: 3
		})
		await testDb
			.update(schema.sessionCharacters)
			.set({
				removedAt: new Date(),
				removedName: "Mascot",
				isActive: false
			})
			.where(eq(schema.sessionCharacters.id, seat!.id))
		const back = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, envoySlug: "mascot", position: 1 })
		)
		expect(back).toMatchObject({ ok: true, seatId: seat!.id })
		const [revived] = await seatsOf(s.id)
		expect(revived).toMatchObject({
			removedAt: null,
			removedName: null,
			isActive: true,
			position: 1
		})
	})

	test("a card and an envoy together is a mistake", async () => {
		const u = await user()
		const s = await session(u.id)
		await expect(
			inTx((tx) =>
				seatCast(tx, {
					sessionId: s.id,
					cardId: 1,
					envoySlug: "mascot"
				})
			)
		).rejects.toThrow(/exactly one/)
	})
})

describe("reviving and keeping", () => {
	test("a soft-removed character seat is revived and given its member", async () => {
		const u = await user()
		const c = await card(u.id, "Lio")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Lio")
		const s = await session(u.id, b.id)
		const [old] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: s.id,
				characterId: c.id,
				position: 5,
				isActive: false,
				removedAt: new Date(),
				removedName: "Lio"
			})
			.returning()
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id, position: 0 })
		)
		expect(r).toMatchObject({
			ok: true,
			seatId: old!.id,
			castMemberId: m.id
		})
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			removedAt: null,
			removedName: null,
			isActive: true,
			position: 0,
			castMemberId: m.id
		})
	})

	test("keep leaves a seat that is there exactly as it is, and seats one that is not", async () => {
		const u = await user()
		const c = await card(u.id, "Kay")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const [old] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: s.id,
				characterId: c.id,
				position: 7,
				removedAt: new Date(),
				removedName: "Kay",
				isActive: false
			})
			.returning()
		const kept = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				cardId: c.id,
				onExisting: "keep",
				position: 0
			})
		)
		expect(kept).toMatchObject({
			ok: true,
			seatId: old!.id,
			castMemberId: null,
			minted: false
		})
		expect(await bindingsOf(b.id)).toHaveLength(0)
		const [still] = await seatsOf(s.id)
		expect(still).toMatchObject({
			position: 7,
			isActive: false,
			removedName: "Kay"
		})

		const fresh = await card(u.id, "Fresh")
		const made = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				cardId: fresh.id,
				onExisting: "keep"
			})
		)
		expect(made.ok && made.castMemberId).not.toBeNull()
	})
})

async function twoCardsOneMember(
	memberName: string,
	seatedCardName: string
) {
	const u = await user()
	const a = await card(u.id, seatedCardName)
	const young = await card(u.id, "Younger card")
	const b = await book(u.id)
	const m = await member(b.id, a.id, memberName)
	await insertDatedCardVersion(testDb, m.id, young.id, 1)
	const s = await session(u.id, b.id)
	const first = await inTx((tx) =>
		seatCast(tx, { sessionId: s.id, cardId: a.id })
	)
	return { u, a, young, b, m, s, first }
}

describe("the merge rule on a new seat", () => {
	test("a second card of a seated member is refused, with the sentence, and nothing is written", async () => {
		const w = await twoCardsOneMember("Captain Maren", "Maren")
		expect(w.first).toMatchObject({ ok: true, castMemberId: w.m.id })
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: w.s.id, cardId: w.young.id })
		)
		expect(r).toEqual({
			ok: false,
			refusal: "Captain Maren is already in this session as Maren.",
			memberId: w.m.id,
			seatedSeatId: w.first.ok ? w.first.seatId : -1
		})
		expect(r.ok === false && r.refusal).toBe(
			SEAT_REFUSALS.sameMember("Captain Maren", "Maren")
		)
		expect(await seatsOf(w.s.id)).toHaveLength(1)
	})

	test("the sentence drops the second name when the two are one ignoring case", async () => {
		const w = await twoCardsOneMember("MAREN", "maren")
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: w.s.id, cardId: w.young.id })
		)
		expect(r).toMatchObject({
			ok: false,
			refusal: "MAREN is already in this session."
		})
	})

	test('"allow" seats it anyway, both carrying the member', async () => {
		const w = await twoCardsOneMember("Maren", "Maren")
		const r = await inTx((tx) =>
			seatCast(tx, {
				sessionId: w.s.id,
				cardId: w.young.id,
				secondCard: "allow"
			})
		)
		expect(r).toMatchObject({ ok: true, castMemberId: w.m.id })
		const seats = await seatsOf(w.s.id)
		expect(seats).toHaveLength(2)
		expect(seats.map((x) => x.castMemberId)).toEqual([w.m.id, w.m.id])
	})

	test("a departed seat of the member does not refuse", async () => {
		const w = await twoCardsOneMember("Maren", "Maren")
		await testDb
			.update(schema.sessionCharacters)
			.set({
				removedAt: new Date(),
				removedName: "Maren",
				isActive: false
			})
			.where(eq(schema.sessionCharacters.sessionId, w.s.id))
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: w.s.id, cardId: w.young.id })
		)
		expect(r).toMatchObject({ ok: true, castMemberId: w.m.id })
	})

	test("re-seating the same card is not a second card", async () => {
		const w = await twoCardsOneMember("Maren", "Maren")
		const again = await inTx((tx) =>
			seatCast(tx, { sessionId: w.s.id, cardId: w.a.id })
		)
		expect(again).toMatchObject({
			ok: true,
			seatId: w.first.ok ? w.first.seatId : -1
		})
	})

	test("settling is fill-only by default: two seats of a member stay seated; only merge: true departs one", async () => {
		const w = await twoCardsOneMember("Maren", "Maren")
		await inTx((tx) =>
			seatCast(tx, {
				sessionId: w.s.id,
				cardId: w.young.id,
				secondCard: "allow"
			})
		)
		const fillOnly = await inTx((tx) => settleSeats(tx, w.s.id))
		expect(fillOnly.merged).toEqual([])
		const stillLive = (await seatsOf(w.s.id)).filter(
			(r) => r.removedAt === null
		)
		expect(stillLive).toHaveLength(2)
		expect(stillLive.every((r) => r.mergedInto === null)).toBe(true)

		const merged = await inTx((tx) =>
			settleSeats(tx, w.s.id, { merge: true })
		)
		expect(merged.merged).toHaveLength(1)
		expect(
			(await seatsOf(w.s.id)).filter((r) => r.removedAt === null)
		).toHaveLength(1)
	})

	test("reviving a merged-away seat clears merged_into", async () => {
		const w = await twoCardsOneMember("Maren", "Maren")
		await inTx((tx) =>
			seatCast(tx, {
				sessionId: w.s.id,
				cardId: w.young.id,
				secondCard: "allow"
			})
		)
		const merged = await inTx((tx) =>
			settleSeats(tx, w.s.id, { merge: true })
		)
		const departedSeatId = merged.merged[0]!.departedSeatId
		const [departed] = (await seatsOf(w.s.id)).filter(
			(r) => r.id === departedSeatId
		)
		expect(departed).toMatchObject({ mergedInto: expect.any(Number) })
		expect(departed!.removedAt).not.toBeNull()

		const revived = await inTx((tx) =>
			seatCast(tx, {
				sessionId: w.s.id,
				cardId: departed!.characterId!,
				secondCard: "allow"
			})
		)
		expect(revived).toMatchObject({ ok: true, seatId: departedSeatId })
		const [after] = (await seatsOf(w.s.id)).filter(
			(r) => r.id === departedSeatId
		)
		expect(after).toMatchObject({ removedAt: null, mergedInto: null })
	})
})

describe("a minted member is named after the commit", () => {
	test("settleSeats reports the members it made; syncMintedSeatMembers names them, once each", async () => {
		const u = await user()
		const c = await card(u.id, "Real Name", { nickname: "Wren" })
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id, deferMember: true })
		)
		const report = await inTx((tx) => settleSeats(tx, s.id))
		expect(report.minted).toBe(1)
		expect(report.mintedMembers).toEqual([
			{ cardId: c.id, lorebookId: b.id }
		])
		expect((await bindingsOf(b.id))[0]!.name).toBe("")
		await syncMintedSeatMembers(asDb(testDb), [
			...report.mintedMembers,
			...report.mintedMembers
		])
		expect((await bindingsOf(b.id))[0]).toMatchObject({
			characterId: c.id,
			name: "Wren"
		})
	})

	test("a failing sync is logged, naming card and book, and the loop goes on", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const d = await card(u.id, "Dara")
		const b = await book(u.id)
		const mc = await member(b.id, c.id, "")
		const md = await member(b.id, d.id, "")
		// The first card's sync throws; the second goes through the real handle.
		let calls = 0
		const flaky = {
			transaction: (fn: never) => {
				if (++calls === 1) return Promise.reject(new Error("boom"))
				return testDb.transaction(fn)
			}
		}
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await syncMintedSeatMembers(asDb(flaky), [
				{ cardId: c.id, lorebookId: b.id },
				{ cardId: d.id, lorebookId: b.id }
			])
			expect(log).toHaveBeenCalledTimes(1)
			expect(String(log.mock.calls[0]![0])).toContain(`card ${c.id}`)
			expect(String(log.mock.calls[0]![0])).toContain(`lorebook ${b.id}`)
		} finally {
			log.mockRestore()
		}
		const rows = await bindingsOf(b.id)
		expect(rows.find((r) => r.id === mc.id)!.name).toBe("")
		expect(rows.find((r) => r.id === md.id)!.name).toBe("Dara")
	})
})

describe("a player seat", () => {
	test("with a card carries its member; card-less carries none", async () => {
		const u = await user()
		const c = await card(u.id, "Persona Pat")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Pat")
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: c.id,
				position: 1,
				userId: u.id
			})
		)
		expect(r).toMatchObject({ castMemberId: m.id, minted: false })
		const [seat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, r.seatId))
		expect(seat).toMatchObject({
			personaId: c.id,
			castMemberId: m.id,
			position: 1,
			userId: u.id
		})

		const bare = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "Stranger",
				userId: u.id
			})
		)
		expect(bare.castMemberId).toBeNull()
		const [row] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, bare.seatId))
		expect(row).toMatchObject({
			personaId: null,
			castMemberId: null,
			seatName: "Stranger"
		})
	})

	test("mints for a live seat, only finds for a departed copy", async () => {
		const u = await user()
		const live = await card(u.id, "Live Lou")
		const gone = await card(u.id, "Gone Gus")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const l = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: live.id })
		)
		expect(l.minted).toBe(true)
		expect(l.castMemberId).not.toBeNull()
		const d = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: gone.id,
				removedAt: new Date(),
				removedName: "Gone Gus",
				onExisting: "insert"
			})
		)
		expect(d).toMatchObject({ castMemberId: null, minted: false })
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})

	test("revive puts a soft-removed seat back and keeps its other columns", async () => {
		const u = await user()
		const c = await card(u.id, "Rae")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Rae")
		const s = await session(u.id, b.id)
		const [old] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: c.id,
				position: 4,
				removedAt: new Date(),
				removedName: "Rae",
				seatName: "Ray"
			})
			.returning()
		const r = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id, position: 0 })
		)
		expect(r.seatId).toBe(old!.id)
		const [seat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, old!.id))
		expect(seat).toMatchObject({
			removedAt: null,
			removedName: null,
			position: 0,
			castMemberId: m.id,
			seatName: "Ray"
		})
	})

	test("is never refused or merged: a player seat and a character seat on one card both carry the member", async () => {
		const u = await user()
		const c = await card(u.id, "Dual")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const first = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		const second = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id })
		)
		expect(first.ok && first.castMemberId).toBe(second.castMemberId)
		const [char] = await seatsOf(s.id)
		expect(char).toMatchObject({ removedAt: null, mergedInto: null })
		const players = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, s.id),
					eq(schema.sessionPersonas.personaId, c.id)
				)
			)
		expect(players).toHaveLength(1)
	})
})

describe("the pre-check and the deferred member", () => {
	test("sameMemberRefusal names two cards of one member, before anything is written, by session or by book", async () => {
		const u = await user()
		const linked = await card(u.id, "Maren")
		const young = await card(u.id, "Younger card")
		const other = await card(u.id, "Other")
		const b = await book(u.id)
		const m = await member(b.id, linked.id, "Captain Maren")
		await insertDatedCardVersion(testDb, m.id, young.id, 1)
		const s = await session(u.id, b.id)
		const sentence = SEAT_REFUSALS.sameMember("Captain Maren", "Maren")

		expect(
			await inTx((tx) =>
				sameMemberRefusal(tx, {
					lorebookId: b.id,
					cardIds: [linked.id, young.id]
				})
			)
		).toBe(sentence)
		expect(
			await inTx((tx) =>
				sameMemberRefusal(tx, {
					sessionId: s.id,
					cardIds: [linked.id, young.id]
				})
			)
		).toBe(sentence)
		// Different people, a card nobody knows, and no book at all: no refusal.
		expect(
			await inTx((tx) =>
				sameMemberRefusal(tx, {
					lorebookId: b.id,
					cardIds: [linked.id, other.id]
				})
			)
		).toBeNull()
		expect(
			await inTx((tx) =>
				sameMemberRefusal(tx, {
					lorebookId: null,
					cardIds: [linked.id, young.id]
				})
			)
		).toBeNull()
		// Find-only: nothing was minted or seated.
		expect(await bindingsOf(b.id)).toHaveLength(1)
		expect(await seatsOf(s.id)).toHaveLength(0)
	})

	test("deferMember writes the seat without its member and refuses nothing; settleSeats then gives it", async () => {
		const u = await user()
		const linked = await card(u.id, "Maren")
		const young = await card(u.id, "Younger card")
		const b = await book(u.id)
		const m = await member(b.id, linked.id, "Maren")
		await insertDatedCardVersion(testDb, m.id, young.id, 1)
		const s = await session(u.id, b.id)
		const first = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				cardId: linked.id,
				deferMember: true
			})
		)
		const second = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				cardId: young.id,
				deferMember: true
			})
		)
		const player = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: linked.id,
				deferMember: true
			})
		)
		expect(first).toMatchObject({
			ok: true,
			castMemberId: null,
			minted: false
		})
		expect(second).toMatchObject({
			ok: true,
			castMemberId: null,
			minted: false
		})
		expect(player).toMatchObject({ castMemberId: null, minted: false })
		expect((await seatsOf(s.id)).map((r) => r.castMemberId)).toEqual([
			null,
			null
		])

		// Fill-only (the default): both seats carry the member and both stay seated.
		const fillOnly = await inTx((tx) => settleSeats(tx, s.id))
		expect(fillOnly.merged).toEqual([])
		expect(
			(await seatsOf(s.id)).filter((r) => r.removedAt === null)
		).toHaveLength(2)

		const report = await inTx((tx) =>
			settleSeats(tx, s.id, { merge: true })
		)
		expect(report.minted).toBe(0)
		// Both character seats now carry the member; the second card's seat departs.
		const seats = await seatsOf(s.id)
		const live = seats.filter((r) => r.removedAt === null)
		expect(live).toHaveLength(1)
		expect(live[0]).toMatchObject({
			characterId: linked.id,
			castMemberId: m.id
		})
		expect(report.merged).toHaveLength(1)
		const [ps] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		expect(ps!.castMemberId).toBe(m.id)
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})
})

describe("findSeatMembers", () => {
	test("the attached book's member wins over the own book's", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		await member(own.id, c.id, "Maren (own)")
		const attachedMember = await member(b.id, c.id, "Maren")
		const found = await inTx(async (tx) =>
			findSeatMembers(tx, (await seatBookOf(tx, s.id))!, [c.id])
		)
		expect(found.get(c.id)).toEqual({
			memberId: attachedMember.id,
			lorebookId: b.id
		})
	})

	test("a card only the own book holds is found there, with that book's id", async () => {
		const u = await user()
		const c = await card(u.id, "Tess")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(asDb(testDb), s.id)
		const m = await member(own.id, c.id, "Tess")
		const found = await inTx(async (tx) =>
			findSeatMembers(tx, (await seatBookOf(tx, s.id))!, [c.id])
		)
		expect(found.get(c.id)).toEqual({ memberId: m.id, lorebookId: own.id })
	})

	test("a card linked nowhere is absent, and nothing is minted", async () => {
		const u = await user()
		const here = await card(u.id, "Here")
		const nowhere = await card(u.id, "Nowhere")
		const b = await book(u.id)
		const m = await member(b.id, here.id, "Here")
		const s = await session(u.id, b.id)
		const found = await inTx(async (tx) =>
			findSeatMembers(tx, (await seatBookOf(tx, s.id))!, [
				here.id,
				nowhere.id,
				here.id
			])
		)
		expect([...found.keys()]).toEqual([here.id])
		expect(found.get(here.id)?.memberId).toBe(m.id)
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})

	test("a dated card (a cast amendment names it) is found", async () => {
		const u = await user()
		const young = await card(u.id, "Maren young")
		const old = await card(u.id, "Maren old")
		const b = await book(u.id)
		const m = await member(b.id, old.id, "Maren")
		await insertDatedCardVersion(testDb, m.id, young.id, 1)
		const s = await session(u.id, b.id)
		const found = await inTx(async (tx) =>
			findSeatMembers(tx, (await seatBookOf(tx, s.id))!, [young.id])
		)
		expect(found.get(young.id)).toEqual({
			memberId: m.id,
			lorebookId: b.id
		})
	})
})

describe("what a seat writer changed (SeatChange)", () => {
	test("seatCast: a new seat and a revived seat are added; one already live, a kept one and an envoy report nothing", async () => {
		const u = await user()
		const c = await card(u.id, "Lio")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Lio")
		const s = await session(u.id, b.id)
		const fresh = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(fresh.ok && fresh.changes).toEqual([
			{
				kind: "character",
				change: "added",
				seatId: (fresh as { seatId: number }).seatId,
				castMemberId: m.id,
				cardId: c.id
			}
		])
		const again = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id, position: 3 })
		)
		expect(again.ok && again.changes).toEqual([])
		const kept = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id, onExisting: "keep" })
		)
		expect(kept.ok && kept.changes).toEqual([])
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		const revived = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(revived.ok && revived.changes).toHaveLength(1)
		const envoy = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, envoySlug: "guide" })
		)
		expect(envoy.ok && envoy.changes).toEqual([])
	})

	test("seatCast by a card-less member: new is added, live is not, revived is", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, "Ada")
		const s = await session(u.id, b.id)
		const first = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		expect(first.ok && first.changes).toMatchObject([
			{ change: "added", castMemberId: m.id, cardId: null }
		])
		const second = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id,
				onExisting: "keep"
			})
		)
		expect(second.ok && second.changes).toEqual([])
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		const third = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		expect(third.ok && third.changes).toHaveLength(1)
	})

	test("seatPlayer: new and revived are added; already live and a retired copy are not", async () => {
		const u = await user()
		const c = await card(u.id, "Pia")
		const b = await book(u.id)
		await member(b.id, c.id, "Pia")
		const s = await session(u.id, b.id)
		const first = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id })
		)
		expect(first.changes).toMatchObject([
			{ kind: "player", change: "added", seatId: first.seatId, cardId: c.id }
		])
		const live = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id, position: 2 })
		)
		expect(live.changes).toEqual([])
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		const revived = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id })
		)
		expect(revived.changes).toHaveLength(1)
		const other = await card(u.id, "Retired")
		const retired = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: other.id,
				onExisting: "insert",
				removedAt: new Date()
			})
		)
		expect(retired.changes).toEqual([])
	})

	const personaSeatsOf = (sessionId: number) =>
		testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, sessionId))

	const lineOf = (
		sessionId: number,
		extra: Partial<typeof schema.sessionMessages.$inferInsert>
	) =>
		testDb
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "assistant", content: "Hello", ...extra })

	test("setSeatBench: benches and brings back a character seat and a player seat; a repeat writes nothing", async () => {
		const u = await user()
		const c = await card(u.id, "Bea")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Bea")
		const s = await session(u.id, b.id)
		const seat = (await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)) as { seatId: number }
		const player = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id })
		)
		for (const [kind, seatId, castMemberId] of [
			["character", seat.seatId, m.id],
			["player", player.seatId, player.castMemberId]
		] as const) {
			const rowOf = async () =>
				(kind === "character"
					? await seatsOf(s.id)
					: await personaSeatsOf(s.id)
				).find((r) => r.id === seatId)!
			const input = { sessionId: s.id, kind, seatId }
			expect(
				await inTx((tx) => setSeatBench(tx, { ...input, benched: true }))
			).toEqual({
				ok: true,
				changes: [
					{
						kind,
						change: "enabled",
						value: false,
						seatId,
						castMemberId,
						cardId: c.id
					}
				]
			})
			expect(await rowOf()).toMatchObject({ isActive: false, removedAt: null })
			expect(
				await inTx((tx) => setSeatBench(tx, { ...input, benched: true }))
			).toEqual({ ok: true, changes: [] })
			const back = await inTx((tx) =>
				setSeatBench(tx, { ...input, benched: false })
			)
			expect(back).toMatchObject({
				ok: true,
				changes: [{ change: "enabled", value: true, seatId }]
			})
			expect(await rowOf()).toMatchObject({ isActive: true })
			expect(
				await inTx((tx) => setSeatBench(tx, { ...input, benched: false }))
			).toEqual({ ok: true, changes: [] })
		}
	})

	test("setSeatBench: refuses an envoy seat, a removed seat and a seat of another session, in words", async () => {
		const u = await user()
		const c = await card(u.id, "Cyd")
		const b = await book(u.id)
		await member(b.id, c.id, "Cyd")
		const s = await session(u.id, b.id)
		const other = await session(u.id, b.id)
		const envoy = (await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, envoySlug: "mascot" })
		)) as { seatId: number }
		const seat = (await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)) as { seatId: number }
		const bench = (sessionId: number, seatId: number) =>
			inTx((tx) =>
				setSeatBench(tx, { sessionId, kind: "character", seatId, benched: true })
			)
		expect(await bench(s.id, envoy.seatId)).toEqual({
			ok: false,
			refusal: "An envoy isn't benched: switch it off instead."
		})
		expect(await bench(other.id, seat.seatId)).toEqual({
			ok: false,
			refusal: "That seat is not in this session."
		})
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.id, seat.seatId))
		expect(await bench(s.id, seat.seatId)).toEqual({
			ok: false,
			refusal:
				"That seat has left this session. Seat them again to bring them back."
		})
		const [row] = (await seatsOf(s.id)).filter((r) => r.id === seat.seatId)
		expect(row).toMatchObject({ isActive: true })
	})

	test("unseat: a live seat is benched, not removed; a benched seat with no lines is removed, once", async () => {
		const u = await user()
		const c = await card(u.id, "Lio")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Lio")
		const s = await session(u.id, b.id)
		const seat = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		const seatId = (seat as { seatId: number }).seatId
		const input = {
			sessionId: s.id,
			kind: "character",
			seatId,
			removedName: "Lio"
		} as const
		expect(await inTx((tx) => unseat(tx, input))).toEqual([
			{
				kind: "character",
				change: "enabled",
				value: false,
				seatId,
				castMemberId: m.id,
				cardId: c.id
			}
		])
		const [benched] = await seatsOf(s.id)
		expect(benched).toMatchObject({ isActive: false, removedAt: null })
		expect(await inTx((tx) => unseat(tx, input))).toEqual([
			{
				kind: "character",
				change: "removed",
				seatId,
				castMemberId: m.id,
				cardId: c.id
			}
		])
		expect(await inTx((tx) => unseat(tx, input))).toEqual([])
		const [row] = await seatsOf(s.id)
		expect(row).toMatchObject({ isActive: false, removedName: "Lio" })
		expect(row!.removedAt).not.toBeNull()
		expect(
			await inTx((tx) => unseat(tx, { ...input, seatId: 999999 }))
		).toEqual([])
		const player = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id })
		)
		const pin = {
			sessionId: s.id,
			kind: "player",
			seatId: player.seatId,
			removedName: null
		} as const
		expect(await inTx((tx) => unseat(tx, pin))).toMatchObject([
			{ kind: "player", change: "enabled", value: false }
		])
		expect(await inTx((tx) => unseat(tx, pin))).toMatchObject([
			{ kind: "player", change: "removed" }
		])
	})

	test("unseat: a benched seat with a line is never removed — carded, card-less character and card-less player seats", async () => {
		const u = await user()
		const c = await card(u.id, "Kit")
		const b = await book(u.id)
		await member(b.id, c.id, "Kit")
		const bare = await member(b.id, null, "Ada")
		const bareLine = await member(b.id, null, "Bo")
		const s = await session(u.id, b.id)
		const carded = (await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)) as { seatId: number }
		const viaMember = (await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: bare.id,
				seatedBy: u.id
			})
		)) as { seatId: number }
		const viaMark = (await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: bareLine.id,
				seatedBy: u.id
			})
		)) as { seatId: number }
		const cardless = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: null, seatName: "Stranger" })
		)
		await lineOf(s.id, { characterId: c.id })
		await lineOf(s.id, { castMemberId: bare.id })
		await lineOf(s.id, {
			metadata: { speaker: `seated-member:${bareLine.id}` }
		})
		await lineOf(s.id, {
			metadata: { speaker: `player-seat:${cardless.seatId}` }
		})
		const cases = [
			["character", carded.seatId, "Kit"],
			["character", viaMember.seatId, "Ada"],
			["character", viaMark.seatId, "Bo"],
			["player", cardless.seatId, "Stranger"]
		] as const
		for (const [kind, seatId, name] of cases) {
			const input = { sessionId: s.id, kind, seatId, removedName: name }
			await inTx((tx) => unseat(tx, input))
			await expect(inTx((tx) => unseat(tx, input))).rejects.toThrow(
				`${name} has lines in this session, so they can be benched but not removed.`
			)
		}
		for (const r of await seatsOf(s.id))
			expect(r).toMatchObject({ isActive: false, removedAt: null })
		for (const r of await personaSeatsOf(s.id))
			expect(r).toMatchObject({ isActive: false, removedAt: null })
	})

	test("seatPlayer: a revive comes back in play; a live benched row comes back with one enabled change", async () => {
		const u = await user()
		const c = await card(u.id, "Rey")
		const b = await book(u.id)
		await member(b.id, c.id, "Rey")
		const named = await member(b.id, null, "Sol")
		const s = await session(u.id, b.id)
		const first = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: c.id })
		)
		const second = await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: null, castMemberId: named.id })
		)
		const gone = { removedAt: new Date(), isActive: false }
		await testDb
			.update(schema.sessionPersonas)
			.set(gone)
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		await inTx((tx) => seatPlayer(tx, { sessionId: s.id, personaId: c.id }))
		await inTx((tx) =>
			seatPlayer(tx, { sessionId: s.id, personaId: null, castMemberId: named.id })
		)
		for (const r of await personaSeatsOf(s.id))
			expect(r).toMatchObject({ isActive: true, removedAt: null })
		for (const [seatId, input] of [
			[first.seatId, { personaId: c.id }],
			[second.seatId, { personaId: null, castMemberId: named.id }]
		] as const) {
			await inTx((tx) =>
				setSeatBench(tx, {
					sessionId: s.id,
					kind: "player",
					seatId,
					benched: true
				})
			)
			const back = await inTx((tx) =>
				seatPlayer(tx, { sessionId: s.id, ...input })
			)
			expect(back.changes).toMatchObject([
				{ kind: "player", change: "enabled", value: true, seatId }
			])
		}
	})

	test("settleSeats: a fill reports nothing; a merge depart is removed", async () => {
		const w = await twoCardsOneMember("Maren", "Maren")
		await inTx((tx) =>
			seatCast(tx, {
				sessionId: w.s.id,
				cardId: w.young.id,
				secondCard: "allow"
			})
		)
		const fill = await inTx((tx) => settleSeats(tx, w.s.id))
		expect(fill.changes).toEqual([])
		const merged = await inTx((tx) =>
			settleSeats(tx, w.s.id, { merge: true })
		)
		expect(merged.changes).toHaveLength(1)
		expect(merged.changes[0]).toMatchObject({
			kind: "character",
			change: "removed",
			seatId: merged.merged[0]!.departedSeatId,
			castMemberId: merged.merged[0]!.castMemberId
		})
	})

	test("reseatOnto: a character seat is removed under the old member then added under the new; a player seat reports nothing", async () => {
		const u = await user()
		const c = await card(u.id, "Lio")
		const p = await card(u.id, "Pia")
		const b = await book(u.id)
		const m1 = await member(b.id, c.id, "Lio")
		const m2 = await member(b.id, null, "Lio copy")
		const pm1 = await member(b.id, p.id, "Pia")
		const pm2 = await member(b.id, null, "Pia copy")
		const s = await session(u.id, b.id)
		const seat = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		await inTx((tx) => seatPlayer(tx, { sessionId: s.id, personaId: p.id }))
		const r = await inTx((tx) =>
			reseatOnto(
				tx,
				s.id,
				new Map([
					[m1.id, m2.id],
					[pm1.id, pm2.id]
				])
			)
		)
		const seatId = (seat as { seatId: number }).seatId
		expect(r.moved).toBe(2)
		expect(r.changes).toEqual([
			{
				kind: "character",
				change: "removed",
				seatId,
				castMemberId: m1.id,
				cardId: c.id
			},
			{
				kind: "character",
				change: "added",
				seatId,
				castMemberId: m2.id,
				cardId: c.id
			}
		])
	})

	test("announceSeatChanges nets an add and a remove of one ref to nothing, and collapses repeats", async () => {
		const u = await user()
		const b = await book(u.id)
		const a = await member(b.id, null, "Ada")
		const z = await member(b.id, null, "Zed")
		const s = await session(u.id, b.id)
		const ofSeat = (castMemberId: number, change: "added" | "removed") =>
			({
				kind: "character",
				change,
				seatId: castMemberId,
				castMemberId,
				cardId: null
			}) as const
		await announceSeatChanges(
			testDb as unknown as Db,
			{ to: () => ({ emit: () => {} }) } as never,
			{ sessionId: s.id, userId: u.id },
			[
				ofSeat(a.id, "added"),
				ofSeat(a.id, "removed"),
				ofSeat(z.id, "added"),
				ofSeat(z.id, "added")
			]
		)
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
		const rows = (
			await testDb
				.select()
				.from(schema.sessionChanges)
				.where(eq(schema.sessionChanges.sessionId, s.id))
				.orderBy(asc(schema.sessionChanges.id))
		).filter(
			(c) =>
				c.event === sessionEvents.memberAdded ||
				c.event === sessionEvents.memberRemoved
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.event).toBe(sessionEvents.memberAdded)
		expect(rows[0]!.payload).toMatchObject({
			ref: `seated-member:${z.id}`,
			change: "added",
			cause: { kind: "settings", userId: u.id }
		})
	})

	test("announceSeatChanges announces a bench as cast-changed enabled, the last value per ref", async () => {
		const u = await user()
		const b = await book(u.id)
		const a = await member(b.id, null, "Ada")
		const s = await session(u.id, b.id)
		const ofSeat = (value: boolean) =>
			({
				kind: "character",
				change: "enabled",
				value,
				seatId: a.id,
				castMemberId: a.id,
				cardId: null
			}) as const
		await announceSeatChanges(
			testDb as unknown as Db,
			{ to: () => ({ emit: () => {} }) } as never,
			{ sessionId: s.id, userId: u.id },
			[ofSeat(false), ofSeat(true), ofSeat(false)]
		)
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
		const rows = (
			await testDb
				.select()
				.from(schema.sessionChanges)
				.where(eq(schema.sessionChanges.sessionId, s.id))
		).filter((c) => c.event === sessionEvents.castChanged)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.payload).toMatchObject({
			ref: `seated-member:${a.id}`,
			change: "enabled",
			value: false,
			cause: { kind: "settings", userId: u.id }
		})
	})
})
