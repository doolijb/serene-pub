/**
 * 🚧 Acting rights follow the seater (owner 2026-11-05, "The person who seated
 * it"; plan §33.4): `seatCast` writes `seated_by_user_id`, `seatActorOf` answers
 * who acts for a seat, and the message-permission reader and the hand-edit
 * judge agree with it.
 *
 * Claims: a seat written with `seatedBy` keeps it, without one it takes the
 * card's owner, a revive with it overwrites and without it keeps; after a
 * dated card change moves a member's active card to another person's card the
 * seater still acts and the new card's owner does not; a seat whose seater is
 * unset falls back to the active card's owner; and a player-role guest who
 * seated a character nobody plays reads as its owner in the hand-edit judge.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineRuleset, rulesetAttributeSlotId } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacyMany } from "$lib/server/messages/store"
import {
	ensureCardVersion,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { seatActorOf, seatCast, seatOf } from "./seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {}),
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

const R = "test:ruleset/acting-rights@1"
defineRuleset(R, {
	name: { en: "Acting rights" },
	attributes: [
		{ id: "free", name: { en: "Free" }, kind: "number", prose: "Anyone's." }
	]
})
const FREE = rulesetAttributeSlotId(R, "free")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cv-time-acting-rights-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db
const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
	testDb.transaction(async (tx) => fn(tx as unknown as Db))

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `acting-${label}-${++n}`))!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "…" })
		.returning()
	return row!
}

describe("seatCast writes the seater", () => {
	test("with seatedBy it is written; without it the card's owner; a revive with it overwrites, without it keeps", async () => {
		const owner = await user("owner")
		const maker = await user("maker")
		const guest = await user("guest")
		const other = await user("other")
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: true, name: `Run ${++n}` })
			.returning()
		const given = await card(maker.id, "Given")
		const bare = await card(maker.id, "Bare")

		await inTx((tx) =>
			seatCast(tx, {
				sessionId: s!.id,
				cardId: given.id,
				seatedBy: guest.id
			})
		)
		await inTx((tx) => seatCast(tx, { sessionId: s!.id, cardId: bare.id }))
		const rows = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, s!.id))
		const by = (cardId: number) =>
			rows.find((r) => r.characterId === cardId)!.seatedByUserId
		expect(by(given.id)).toBe(guest.id)
		expect(by(bare.id)).toBe(maker.id)

		const seatedBy = async (cardId: number) =>
			(
				await testDb
					.select()
					.from(schema.sessionCharacters)
					.where(eq(schema.sessionCharacters.sessionId, s!.id))
			).find((r) => r.characterId === cardId)!.seatedByUserId

		// A revive with a seater overwrites…
		await inTx((tx) =>
			seatCast(tx, {
				sessionId: s!.id,
				cardId: given.id,
				seatedBy: other.id
			})
		)
		expect(await seatedBy(given.id)).toBe(other.id)
		// …without one, it keeps the row's own.
		await inTx((tx) => seatCast(tx, { sessionId: s!.id, cardId: given.id }))
		expect(await seatedBy(given.id)).toBe(other.id)
		// A null seater is filled from the card's owner on a revive that names none.
		await testDb
			.update(schema.sessionCharacters)
			.set({ seatedByUserId: null })
			.where(eq(schema.sessionCharacters.sessionId, s!.id))
		await inTx((tx) => seatCast(tx, { sessionId: s!.id, cardId: given.id }))
		expect(await seatedBy(given.id)).toBe(maker.id)
		// "keep" writes nothing.
		await inTx((tx) =>
			seatCast(tx, {
				sessionId: s!.id,
				cardId: given.id,
				seatedBy: guest.id,
				onExisting: "keep"
			})
		)
		expect(await seatedBy(given.id)).toBe(maker.id)
	})
})

/** O's session on a book O owns; G and X are guests; G's card C is seated by G. */
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
			lorebookId: book!.id,
			storyClockYear: 30,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		.returning()
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId: s!.id, userId: g.id, isPlayer: true },
		{ sessionId: s!.id, userId: x.id, isPlayer: true }
	])
	const c = await card(g.id, "Cee")
	const c2 = await card(x.id, "Cee Two")
	const seated = await inTx((tx) =>
		seatCast(tx, { sessionId: s!.id, cardId: c.id, seatedBy: g.id })
	)
	if (!seated.ok || seated.castMemberId == null)
		throw new Error("the seat has no member")
	const [line] = await insertLegacyMany(testDb, [
		{
			sessionId: s!.id,
			userId: owner.id,
			characterId: c.id,
			personaId: null,
			role: "assistant",
			content: "Said by C."
		}
	])
	return {
		owner,
		g,
		x,
		book: book!,
		session: s!,
		c,
		c2,
		memberId: seated.castMemberId,
		line: line!
	}
}

/** A dated cast version in force whose parent is a card version of `cardId`. */
async function changeCardOnMember(
	t: Awaited<ReturnType<typeof table>>,
	cardId: number
) {
	await inTx(async (tx) => {
		const parent = await ensureCardVersion(tx, cardId)
		await insertCharacterVersions(tx, [
			{
				castMemberId: t.memberId,
				lorebookId: t.book.id,
				parentVersionId: parent!.id,
				year: 20,
				follows: ["name"],
				nodeState: "active",
				nodeVisibility: "normal"
			}
		])
	})
}

describe("acting rights after a dated card change", () => {
	test("the seater still acts; the new active card's owner does not", async () => {
		const t = await table()
		await changeCardOnMember(t, t.c2.id)
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		expect(
			(await memberAsRead(db(), t.memberId, { sessionId: t.session.id }))
				?.activeCardId
		).toBe(t.c2.id)

		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(db(), t.line.id, t.g.id)).toBe(true)
		expect(await canActOnMessage(db(), t.line.id, t.x.id)).toBe(false)
		const seat = await seatOf(db(), t.session.id, `character:${t.c.id}`)
		expect(seat).toMatchObject({ kind: "character", actingUserId: t.g.id })
		expect(await seatActorOf(db(), t.session.id, seat!)).toBe(t.g.id)
	})

	test("a seat whose seater is unset falls back to the active card's owner", async () => {
		const t = await table()
		await changeCardOnMember(t, t.c2.id)
		await testDb
			.update(schema.sessionCharacters)
			.set({ seatedByUserId: null })
			.where(eq(schema.sessionCharacters.sessionId, t.session.id))
		const seat = await seatOf(db(), t.session.id, `character:${t.c.id}`)
		expect(seat!.actingUserId).toBeNull()
		expect(await seatActorOf(db(), t.session.id, seat!)).toBe(t.x.id)
		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(db(), t.line.id, t.x.id)).toBe(true)
		expect(await canActOnMessage(db(), t.line.id, t.g.id)).toBe(false)
	})

	test("a seat with no member and no seater falls back to its own card's owner", async () => {
		const t = await table()
		const seat = await seatOf(db(), t.session.id, `character:${t.c.id}`)
		expect(
			await seatActorOf(db(), t.session.id, {
				...seat!,
				castMemberId: null,
				actingUserId: null
			})
		).toBe(t.g.id)
	})
})

describe("the hand-edit judge follows the seater for a character nobody plays", () => {
	test("the guest who seated it reads 'own'; another player-role guest 'other'", async () => {
		const owner = await user("hand-owner")
		const g = await user("hand-g")
		const h = await user("hand-h")
		const npc = await card(owner.id, "Gideon")
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: true,
				name: `Hands ${++n}`,
				genreId: "core:genre/dungeon-crawler",
				primaryRuleset: R,
				genreFields: { playerSheetLatitude: "all-own" }
			})
			.returning()
		await testDb.insert(schema.sessionGuests).values([
			{ sessionId: s!.id, userId: g.id, isPlayer: true },
			{ sessionId: s!.id, userId: h.id, isPlayer: true }
		])
		await inTx((tx) =>
			seatCast(tx, { sessionId: s!.id, cardId: npc.id, seatedBy: g.id })
		)
		const { handEditRefusal } = await import("$lib/server/state/handEdits")
		const ask = (userId: number) =>
			handEditRefusal(db(), {
				sessionId: s!.id,
				userId,
				owner: { kind: "session_cast", id: npc.id },
				slotId: FREE,
				act: "set"
			})
		expect(await ask(g.id)).toBeNull()
		expect((await ask(h.id))?.cause).toBe("not-theirs")
		// The card's owner is the session's owner, who may always change it.
		expect(await ask(owner.id)).toBeNull()
	})
})
