/**
 * ⏳ The `deleted-card-members` boot pass (`cast/deletedCardMembers.ts`, ★RF-1
 * at startup, owner 2026-11-10).
 *
 * Claims: run with the boot passes around it in `startupTasks` order, a cast
 * member still linked to a soft-deleted card becomes card-less, holds the
 * card's words as its own and follows nothing; attic-shaped data (a member
 * with no versions yet and a seat with no member) ends with exactly one member,
 * seated; a seat holding the member keeps it and reads the card's words; a
 * member of a live card, a card-less member and a member a card delete already
 * made card-less are untouched; a second boot selects nothing and writes
 * nothing.
 *
 * Does not import `$lib/server/startup` (it starts `appReady` at module scope):
 * `boot()` calls the passes in its order.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { makeMemberCardless } from "$lib/server/cast/cardless"
import { ownBookOf } from "$lib/server/lorebooks/ownBook"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { deletedCardMembers } from "./deletedCardMembers"

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
		path.join(os.tmpdir(), "serene-pub-vitest-deletedCardMembers-")
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

const ZEROS = { cards: 0, members: 0, failed: 0 }

/** The boot passes around this one, in `startupTasks` order. */
async function boot() {
	const db = asDb()
	const { ensureOwnBooks, purgeKeptOwnBooks } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	await ensureOwnBooks(db)
	await purgeKeptOwnBooks(db)
	const { seatMembers } = await import("$lib/server/sessions/seatMembers")
	await seatMembers(db)
	const { liftCharacterVersions } = await import(
		"$lib/server/characters/versionsLift"
	)
	await liftCharacterVersions(db)
	const report = await deletedCardMembers(db)
	const { seatKeys } = await import("$lib/server/sessions/seatKeys")
	await seatKeys(db)
	return report
}

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("deleted-card-user") })
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
async function session(userId: number, lorebookId: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run"), lorebookId })
		.returning()
	return row!
}
const softDelete = (cardId: number) =>
	testDb
		.update(schema.characters)
		.set({ isDeleted: true })
		.where(eq(schema.characters.id, cardId))
/** A card with its v1, the way cards are made today. */
async function card(userId: number, name: string) {
	const { card: row } = await insertCard(asDb(), {
		userId,
		name,
		description: `${name} keeps bees.`
	})
	return row
}
async function member(
	lorebookId: number,
	characterId: number | null,
	name: string
) {
	const { member: row } = await insertCastMember(asDb(), {
		lorebookId,
		binding: uniq("{{char:x}}"),
		characterId,
		name,
		ownName: name
	})
	return row
}
const bindingOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, id))
	)[0]!
const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(schema.characterVersions.id)
const readOf = async (memberId: number) =>
	(await membersAsRead(asDb(), [memberId])).get(memberId)!
const everything = async () => ({
	bindings: await testDb
		.select()
		.from(schema.lorebookBindings)
		.orderBy(schema.lorebookBindings.id),
	versions: await testDb
		.select()
		.from(schema.characterVersions)
		.orderBy(schema.characterVersions.id),
	characters: await testDb
		.select()
		.from(schema.sessionCharacters)
		.orderBy(schema.sessionCharacters.id),
	players: await testDb
		.select()
		.from(schema.sessionPersonas)
		.orderBy(schema.sessionPersonas.id),
	books: await testDb
		.select()
		.from(schema.lorebooks)
		.orderBy(schema.lorebooks.id),
	gallery: await testDb
		.select()
		.from(schema.castMemberFiles)
		.orderBy(schema.castMemberFiles.id)
})

/** Card-less, the card's words as its own, following nothing. */
async function expectCardsWords(
	memberId: number,
	cardRow: { name: string; description: string | null }
) {
	expect((await bindingOf(memberId)).characterId).toBeNull()
	const read = await readOf(memberId)
	expect(read.description).toBe(cardRow.description)
	const versions = await versionsOf(memberId)
	expect(versions.length).toBeGreaterThan(0)
	for (const v of versions) {
		expect(v.follows).toEqual([])
		expect(v.parentVersionId).toBeNull()
	}
}

async function expectSecondBootChangesNothing() {
	const settled = await everything()
	expect(await boot()).toEqual(ZEROS)
	expect(await everything()).toEqual(settled)
}

describe("deleted-card-members boot pass", () => {
	test("attic-shaped: a member with no versions linked to a deleted card, a seat with no member → one card-less member, seated", async () => {
		const u = await user()
		const b = await book(u.id)
		// As the attic writes them: a card with no version, deleted; a member
		// linked to it with no version; a seat of the card with no member.
		const [cardRow] = await testDb
			.insert(schema.characters)
			.values({
				userId: u.id,
				name: uniq("Ilse"),
				description: "Ilse keeps bees.",
				isDeleted: true
			})
			.returning()
		const [m] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: b.id,
				binding: uniq("{{char:x}}"),
				characterId: cardRow!.id,
				name: cardRow!.name
			})
			.returning()
		expect(await versionsOf(m!.id)).toEqual([])
		const s = await session(u.id, b.id)
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: cardRow!.id })

		const report = await boot()
		expect(report).toEqual({ cards: 1, members: 1, failed: 0 })

		// The own book exists (`own-books`) and holds no second member.
		const own = await ownBookOf(asDb(), s.id)
		expect(own).not.toBeNull()
		const books = [b.id, own!.id]
		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(inArray(schema.lorebookBindings.lorebookId, books))
		expect(members.map((r) => r.id)).toEqual([m!.id])
		await expectCardsWords(m!.id, cardRow!)
		const [seat] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		expect(seat!.castMemberId).toBe(m!.id)
		expect(seat!.removedAt).toBeNull()

		await expectSecondBootChangesNothing()
	})

	test("a seated member of a deleted card becomes card-less in every book, the seat keeps it and reads the card's words", async () => {
		const u = await user()
		const other = await user()
		const b = await book(u.id)
		const theirs = await book(other.id)
		const cardRow = await card(u.id, uniq("Maren"))
		const m = await member(b.id, cardRow.id, cardRow.name)
		const elsewhere = await member(theirs.id, cardRow.id, cardRow.name)
		expect((await versionsOf(m.id)).some((v) => v.follows.length > 0)).toBe(
			true
		)
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: cardRow.id,
			castMemberId: m.id
		})
		await softDelete(cardRow.id)
		// Before: linked, reading the deleted card.
		expect((await bindingOf(m.id)).characterId).toBe(cardRow.id)
		expect((await readOf(m.id)).description).toBe(cardRow.description)

		const report = await boot()
		expect(report).toEqual({ cards: 1, members: 2, failed: 0 })
		await expectCardsWords(m.id, cardRow)
		await expectCardsWords(elsewhere.id, cardRow)
		const [seat] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		expect(seat!.castMemberId).toBe(m.id)
		expect(seat!.removedAt).toBeNull()
		expect((await readOf(seat!.castMemberId!)).description).toBe(
			cardRow.description
		)

		await expectSecondBootChangesNothing()
		expect(await deletedCardMembers(asDb())).toEqual(ZEROS)
	})

	test("untouched: a live card's member, a card-less member, and a member a card delete already made card-less", async () => {
		const u = await user()
		const b = await book(u.id)
		const live = await card(u.id, uniq("Oda"))
		const liveMember = await member(b.id, live.id, live.name)
		const cardless = await member(b.id, null, uniq("Pell"))
		const gone = await card(u.id, uniq("Rook"))
		const handled = await member(b.id, gone.id, gone.name)
		// As a card delete leaves it today (lanes s4-rul-c / s4-rul-d).
		await testDb.transaction(async (tx) => {
			await makeMemberCardless(tx as unknown as Db, handled.id, {
				cause: "card-delete"
			})
		})
		await softDelete(gone.id)
		const ids = [liveMember.id, cardless.id, handled.id]
		const snap = async () => ({
			bindings: await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.id, ids))
				.orderBy(schema.lorebookBindings.id),
			versions: await testDb
				.select()
				.from(schema.characterVersions)
				.where(inArray(schema.characterVersions.castMemberId, ids))
				.orderBy(schema.characterVersions.id)
		})
		const before = await snap()

		expect(await boot()).toEqual(ZEROS)
		expect(await snap()).toEqual(before)
		expect((await bindingOf(liveMember.id)).characterId).toBe(live.id)
	})
})
