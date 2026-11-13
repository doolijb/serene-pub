/**
 * 🚧 Card-less seats (`sessions/seats.ts`, plan §34.2, S4): `seatCast` and
 * `seatPlayer` by `castMemberId`, ★6's mint (`mintCardless`), the merge rule
 * over card-less seats, `sameMemberRefusal` with member ids, and
 * `bookCastToSeat` naming members.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	sameMemberRefusal,
	seatCast,
	seatOf,
	seatPlayer,
	SEAT_REFUSALS,
	settleSeats
} from "./seats"
import { bookCastToSeat } from "./seatBookCast"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seats-cardless-")
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

async function ownBookOf(sessionId: number) {
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return ownBookFor(asDb(testDb), sessionId)
}

const seatWhere = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))

describe("seatCast by castMemberId", () => {
	test("a card-less member of the own book is seated: no card, the member, the seater; seatOf finds it", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, null, "Nobody")
		const r = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id,
				position: 3
			})
		)
		expect(r).toMatchObject({
			ok: true,
			castMemberId: m.id,
			minted: false,
			mintedMembers: []
		})
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			characterId: null,
			envoySlug: null,
			castMemberId: m.id,
			seatedByUserId: u.id,
			position: 3
		})
		const found = await inTx((tx) =>
			seatOf(tx, s.id, `seated-member:${m.id}`)
		)
		expect(found).toMatchObject({
			kind: "character",
			seatId: seat!.id,
			castMemberId: m.id,
			cardId: null,
			actingUserId: u.id
		})
	})

	test("removed then seated again: the same row is revived", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, null, "Nobody")
		const first = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		await testDb
			.update(schema.sessionCharacters)
			.set({
				removedAt: new Date(),
				removedName: "Nobody",
				isActive: false
			})
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		const other = await user()
		const again = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: other.id
			})
		)
		expect(first.ok && again.ok && again.seatId === first.seatId).toBe(true)
		const rows = await seatsOf(s.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			removedAt: null,
			removedName: null,
			isActive: true,
			seatedByUserId: other.id
		})
	})

	test("a live seat of the member: refused in words by default, kept with onExisting keep, returned with secondCard allow", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, null, "Nobody")
		const first = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		const refused = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		expect(refused).toMatchObject({
			ok: false,
			refusal: SEAT_REFUSALS.sameMember("Nobody", "Nobody")
		})
		for (const extra of [
			{ onExisting: "keep" as const },
			{ secondCard: "allow" as const }
		]) {
			const r = await inTx((tx) =>
				seatCast(tx, {
					sessionId: s.id,
					castMemberId: m.id,
					seatedBy: u.id,
					...extra
				})
			)
			expect(r.ok && first.ok && r.seatId === first.seatId).toBe(true)
		}
		expect(await seatsOf(s.id)).toHaveLength(1)
	})

	test("a member of an unrelated book is refused with the outside sentence; nothing is written", async () => {
		const u = await user()
		const s = await session(u.id)
		const elsewhere = await book(u.id)
		const m = await member(elsewhere.id, null, "Stranger")
		const r = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		expect(r).toMatchObject({
			ok: false,
			refusal: SEAT_REFUSALS.outsideBooks("Stranger")
		})
		expect(r.ok === false && r.refusal).toBe(
			"Stranger isn't in this session's lorebook. Seat someone from its cast instead."
		)
		expect(await seatsOf(s.id)).toHaveLength(0)
	})

	test("an overlay row is refused with the overlay sentence; a missing member with the gone one", async () => {
		const u = await user()
		const attached = await book(u.id)
		const base = await member(attached.id, null, "Maren")
		const s = await session(u.id, attached.id)
		const own = await ownBookOf(s.id)
		const { member: overlay } = await insertCastMember(testDb, {
			lorebookId: own.id,
			overlayOf: base.id,
			binding: uniq("{{char:o}}"),
			characterId: null,
			name: ""
		})
		const r = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: overlay.id,
				seatedBy: u.id
			})
		)
		expect(r).toMatchObject({
			ok: false,
			refusal: SEAT_REFUSALS.overlayRow("Maren")
		})
		const gone = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: 2_000_000_000,
				seatedBy: u.id
			})
		)
		expect(gone).toMatchObject({
			ok: false,
			refusal: SEAT_REFUSALS.memberGone()
		})
		expect(await seatsOf(s.id)).toHaveLength(0)
	})

	test("no seater: throws", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, null, "Nobody")
		await expect(
			inTx((tx) => seatCast(tx, { sessionId: s.id, castMemberId: m.id }))
		).rejects.toThrow(/seatedBy/)
		await expect(
			inTx((tx) =>
				seatCast(tx, {
					sessionId: s.id,
					castMemberId: m.id,
					seatedBy: null
				})
			)
		).rejects.toThrow(/seatedBy/)
		await expect(
			inTx((tx) =>
				seatCast(tx, {
					sessionId: s.id,
					cardId: 1,
					castMemberId: m.id,
					seatedBy: u.id
				})
			)
		).rejects.toThrow(/exactly one/)
	})

	test("a member with a linked card: character_id is that card", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Maren")
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		expect(r).toMatchObject({ ok: true, castMemberId: m.id })
		const [seat] = await seatsOf(s.id)
		expect(seat).toMatchObject({
			characterId: c.id,
			castMemberId: m.id,
			seatedByUserId: u.id
		})
		// The same member again, by card: the same-member rule still applies
		// (the same card revives; a card-less seat of the member refuses a card).
		const again = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(again.ok && again.seatId === seat!.id).toBe(true)
	})

	test("a card seat of a member who has a card-less live seat is refused", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Maren")
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			envoySlug: null,
			castMemberId: m.id,
			seatedByUserId: u.id
		})
		const r = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: c.id })
		)
		expect(r).toMatchObject({ ok: false })
		const viaMember = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		expect(viaMember).toMatchObject({ ok: false })
		expect(await seatsOf(s.id)).toHaveLength(1)
	})

	test("envoy seats are untouched", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, null, "Nobody")
		const env = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, envoySlug: "acme:envoy" })
		)
		await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				castMemberId: m.id,
				seatedBy: u.id
			})
		)
		const rows = await seatsOf(s.id)
		expect(rows).toHaveLength(2)
		const envoyRow = rows.find((r) => r.envoySlug === "acme:envoy")
		expect(envoyRow).toMatchObject({
			characterId: null,
			castMemberId: null
		})
		expect(env.ok && envoyRow!.id === env.seatId).toBe(true)
		const again = await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, envoySlug: "acme:envoy" })
		)
		expect(again.ok && again.seatId === envoyRow!.id).toBe(true)
	})
})

describe("settleSeats merges card-less seats", () => {
	test("a card-less seat and a carded seat of one member: the one holding the linked card survives", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Maren")
		const s = await session(u.id, b.id)
		const [cardless] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: s.id,
				characterId: null,
				envoySlug: null,
				castMemberId: m.id,
				seatedByUserId: u.id
			})
			.returning()
		const [carded] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: s.id,
				characterId: c.id,
				castMemberId: m.id,
				seatedByUserId: u.id
			})
			.returning()
		const report = await inTx((tx) =>
			settleSeats(tx, s.id, { merge: true })
		)
		expect(report.merged).toEqual([
			{
				departedSeatId: cardless!.id,
				survivorSeatId: carded!.id,
				castMemberId: m.id
			}
		])
		const rows = await seatWhere(s.id)
		const gone = rows.find((r) => r.id === cardless!.id)!
		expect(gone.removedAt).not.toBeNull()
		expect(gone.mergedInto).toBe(carded!.id)
		expect(gone.removedName).toBe("Maren")
		expect(rows.find((r) => r.id === carded!.id)!.removedAt).toBeNull()
		// A second boot changes nothing.
		const second = await inTx((tx) =>
			settleSeats(tx, s.id, { merge: true })
		)
		expect(second.merged).toEqual([])
	})

	test("two card-less rows of one member: the lowest id survives, the other departs merged into it", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, "Nobody")
		const s = await session(u.id, b.id)
		const make = () =>
			testDb
				.insert(schema.sessionCharacters)
				.values({
					sessionId: s.id,
					characterId: null,
					envoySlug: null,
					castMemberId: m.id,
					seatedByUserId: u.id
				})
				.returning()
				.then((r) => r[0]!)
		const a = await make()
		const bb = await make()
		const report = await inTx((tx) =>
			settleSeats(tx, s.id, { merge: true })
		)
		expect(report.merged).toEqual([
			{
				departedSeatId: bb.id,
				survivorSeatId: a.id,
				castMemberId: m.id
			}
		])
		const rows = await seatWhere(s.id)
		expect(rows.find((r) => r.id === bb.id)).toMatchObject({
			mergedInto: a.id,
			removedName: "Nobody",
			isActive: false
		})
		// Without merge nothing departs.
		const c2 = await make()
		const fillOnly = await inTx((tx) => settleSeats(tx, s.id))
		expect(fillOnly.merged).toEqual([])
		expect(
			(await seatWhere(s.id)).find((r) => r.id === c2.id)!.removedAt
		).toBeNull()
	})
})

describe("sameMemberRefusal with castMemberIds", () => {
	test("a card whose member is also listed by id is refused; a different member is not", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Maren")
		const other = await member(b.id, null, "Other")
		const s = await session(u.id, b.id)
		const refused = await inTx((tx) =>
			sameMemberRefusal(tx, {
				lorebookId: b.id,
				cardIds: [c.id],
				castMemberIds: [m.id]
			})
		)
		expect(refused).toBe(SEAT_REFUSALS.sameMember("Maren", "Maren"))
		const fine = await inTx((tx) =>
			sameMemberRefusal(tx, {
				sessionId: s.id,
				cardIds: [c.id],
				castMemberIds: [other.id]
			})
		)
		expect(fine).toBeNull()
	})
})

describe("seatPlayer by castMemberId and the ★6 mint", () => {
	test("a card-less member: persona_id null, the member set; a revive reuses the row", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, null, "Nobody")
		const first = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				castMemberId: m.id,
				userId: u.id
			})
		)
		expect(first.castMemberId).toBe(m.id)
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		const again = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				castMemberId: m.id,
				userId: u.id
			})
		)
		expect(again.seatId).toBe(first.seatId)
		const rows = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			personaId: null,
			castMemberId: m.id,
			removedAt: null
		})
	})

	test("a linked member seats its card as the persona; an outside member throws its sentence", async () => {
		const u = await user()
		const c = await card(u.id, "Ann", { isPersona: true })
		const b = await book(u.id)
		const m = await member(b.id, c.id, "Ann")
		const s = await session(u.id, b.id)
		const r = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				castMemberId: m.id
			})
		)
		const [row] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, r.seatId))
		expect(row).toMatchObject({ personaId: c.id, castMemberId: m.id })
		await expect(
			inTx((tx) =>
				seatPlayer(tx, {
					sessionId: s.id,
					personaId: c.id + 1,
					castMemberId: m.id
				})
			)
		).rejects.toThrow(/different cards/)
		const elsewhere = await book(u.id)
		const stranger = await member(elsewhere.id, null, "Stranger")
		await expect(
			inTx((tx) =>
				seatPlayer(tx, {
					sessionId: s.id,
					personaId: null,
					castMemberId: stranger.id
				})
			)
		).rejects.toThrow(SEAT_REFUSALS.outsideBooks("Stranger"))
	})

	test("mintCardless with a seat name: one new card-less member in the own book, stored on the seat; a re-seat mints another", async () => {
		const u = await user()
		const s = await session(u.id)
		const own = await ownBookOf(s.id)
		const first = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "Ann",
				mintCardless: true,
				userId: u.id
			})
		)
		const members1 = await bindingsOf(own.id)
		expect(members1).toHaveLength(1)
		expect(members1[0]).toMatchObject({
			name: "Ann",
			characterId: null,
			overlayOf: null
		})
		expect(first).toMatchObject({
			castMemberId: members1[0]!.id,
			minted: true,
			mintedMembers: []
		})
		const [seat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, first.seatId))
		expect(seat).toMatchObject({
			personaId: null,
			castMemberId: members1[0]!.id,
			seatName: "Ann"
		})
		const second = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "Ann",
				mintCardless: true,
				userId: u.id
			})
		)
		expect(second.castMemberId).not.toBe(first.castMemberId)
		expect(await bindingsOf(own.id)).toHaveLength(2)
		// No seat name, a persona card, or a departed copy: nothing is minted.
		await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "  ",
				mintCardless: true
			})
		)
		await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "Bo",
				mintCardless: true,
				removedAt: new Date()
			})
		)
		expect(await bindingsOf(own.id)).toHaveLength(2)
	})
})

describe("bookCastToSeat names members", () => {
	test("card-less members come back; a persona-active member and an excluded one are skipped; overlay rows never", async () => {
		const u = await user()
		const carded = await card(u.id, "Maren")
		const player = await card(u.id, "Player", { isPersona: true })
		const skipCard = await card(u.id, "Skip")
		const b = await book(u.id)
		const a = await member(b.id, carded.id, "Maren")
		const none = await member(b.id, null, "Nobody")
		await member(b.id, player.id, "Player")
		await member(b.id, skipCard.id, "Skip")
		const named = await member(b.id, null, "Named")
		await insertCastMember(testDb, {
			lorebookId: b.id,
			overlayOf: a.id,
			binding: uniq("{{char:o}}"),
			characterId: null,
			name: ""
		})
		const got = await bookCastToSeat(asDb(testDb), {
			lorebookId: b.id,
			userId: u.id,
			isAdmin: false,
			exclude: new Set([skipCard.id]),
			excludeMembers: new Set([named.id])
		})
		expect(got).toEqual([
			{ castMemberId: a.id, cardId: carded.id },
			{ castMemberId: none.id, cardId: null }
		])
	})

	test("a provided book returns all its members, card-less and unmarked ones too", async () => {
		const u = await user()
		const [plugin] = await testDb
			.insert(schema.plugins)
			.values({
				pluginId: uniq("acme.cardless"),
				name: "x",
				version: "0.1.0",
				bundleSource: "",
				bundleHash: "x",
				enabled: true,
				manifest: {},
				adminDenied: []
			} as never)
			.returning()
		const b = await book(u.id)
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					provided: {
						plugin: plugin!.pluginId,
						slug: "world",
						version: "0.1.0",
						sha256: "x",
						uuid: b.uuid,
						entries: {}
					}
				}
			})
			.where(eq(schema.lorebooks.id, b.id))
		const plain = await card(u.id, "Plain")
		const m1 = await member(b.id, plain.id, "Plain")
		const m2 = await member(b.id, null, "Nobody")
		const got = await bookCastToSeat(asDb(testDb), {
			lorebookId: b.id,
			userId: u.id,
			isAdmin: true,
			exclude: new Set()
		})
		expect(got).toEqual([
			{ castMemberId: m1.id, cardId: plain.id },
			{ castMemberId: m2.id, cardId: null }
		])
	})
})
