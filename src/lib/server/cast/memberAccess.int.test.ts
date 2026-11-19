/**
 * Who may read and who may edit a cast member's own art: the book's owner
 * (both), a share recipient (read), a session guest whose session seats the
 * member (read), the owner of the card a seated notes member is linked to (both:
 * a guest manages the card they brought, and nothing else of the notes), an
 * administrator (read unless told not; never edit), a stranger (neither).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { canEditCastMember, canReadCastMember } from "./memberAccess"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-memberAccess-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function user(label: string, isAdmin = false) {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: `${label}-${++n}`, isAdmin })
		.returning()
	return u!
}

async function memberIn(userId: number, sessionId?: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}`, sessionId: sessionId ?? null })
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book!.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		})
		.returning()
	return { book: book!, member: member! }
}

describe("canReadCastMember / canEditCastMember", () => {
	test("the book's owner reads and edits; the answer names the book and its owner", async () => {
		const owner = await user("owner")
		const { book, member } = await memberIn(owner.id)
		expect(await canReadCastMember(db(), member.id, owner.id)).toEqual({
			id: member.id,
			lorebookId: book.id
		})
		expect(await canEditCastMember(db(), member.id, owner.id)).toEqual({
			id: member.id,
			lorebookId: book.id,
			bookOwnerId: owner.id
		})
	})

	test("a share recipient reads, never edits", async () => {
		const owner = await user("owner")
		const friend = await user("friend")
		const { book, member } = await memberIn(owner.id)
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: book.id, userId: friend.id })
		expect(
			await canReadCastMember(db(), member.id, friend.id)
		).not.toBeNull()
		expect(await canEditCastMember(db(), member.id, friend.id)).toBeNull()
	})

	test("a guest of a session that seats the member reads, never edits", async () => {
		const owner = await user("owner")
		const guest = await user("guest")
		const { book, member } = await memberIn(owner.id)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, lorebookId: book.id })
			.returning()
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Verity", description: "" })
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session!.id, userId: guest.id })
		expect(await canReadCastMember(db(), member.id, guest.id)).toBeNull()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: card!.id,
			castMemberId: member.id,
			position: 0
		})
		expect(
			await canReadCastMember(db(), member.id, guest.id)
		).not.toBeNull()
		expect(await canEditCastMember(db(), member.id, guest.id)).toBeNull()
	})

	test("a guest has no access to the session's notes (G2): an unseated member neither read nor edited, a seated one read only; the owner reads and edits", async () => {
		const owner = await user("owner")
		const guest = await user("guest")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false })
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session!.id, userId: guest.id })
		const { member } = await memberIn(owner.id, session!.id)
		expect(await canReadCastMember(db(), member.id, guest.id)).toBeNull()
		expect(await canEditCastMember(db(), member.id, guest.id)).toBeNull()
		expect(await canReadCastMember(db(), member.id, owner.id)).not.toBeNull()
		expect(await canEditCastMember(db(), member.id, owner.id)).toMatchObject({
			bookOwnerId: owner.id
		})
		// Seated in the session: what play shows, read only.
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Verity", description: "" })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: card!.id,
			castMemberId: member.id,
			position: 0
		})
		expect(await canReadCastMember(db(), member.id, guest.id)).not.toBeNull()
		expect(await canEditCastMember(db(), member.id, guest.id)).toBeNull()
	})

	test("a guest manages the card they brought: its seated notes member, nothing else of the notes", async () => {
		const owner = await user("owner")
		const guest = await user("guest")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false })
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session!.id, userId: guest.id })
		const mine = await memberIn(owner.id, session!.id)
		const another = async (name: string) => {
			const [member] = await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: mine.book.id, binding: `{{char:${++n}}}`, name })
				.returning()
			return { book: mine.book, member: member! }
		}
		const ownersCard = await another("Theirs")
		const cardless = await another("Nobody")
		const [guestCard] = await testDb
			.insert(schema.characters)
			.values({ userId: guest.id, name: "Mine", description: "" })
			.returning()
		const [ownerCard] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Theirs", description: "" })
			.returning()
		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: guestCard!.id })
			.where(eq(schema.lorebookBindings.id, mine.member.id))
		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: ownerCard!.id })
			.where(eq(schema.lorebookBindings.id, ownersCard.member.id))
		// Unseated: the card's link alone opens nothing.
		expect(await canEditCastMember(db(), mine.member.id, guest.id)).toBeNull()
		// The guest's card seated by the guest; the owner's card and a card-less
		// member (the seat rule gives read only, never edit) seated too.
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session!.id,
			personaId: guestCard!.id,
			castMemberId: mine.member.id,
			position: 0
		})
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: session!.id,
				characterId: ownerCard!.id,
				castMemberId: ownersCard.member.id,
				position: 1
			},
			{ sessionId: session!.id, castMemberId: cardless.member.id, position: 2 }
		])
		expect(await canEditCastMember(db(), mine.member.id, guest.id)).toEqual({
			id: mine.member.id,
			lorebookId: mine.book.id,
			bookOwnerId: owner.id
		})
		expect(await canReadCastMember(db(), mine.member.id, guest.id)).not.toBeNull()
		for (const other of [ownersCard, cardless]) {
			expect(await canEditCastMember(db(), other.member.id, guest.id)).toBeNull()
			expect(await canReadCastMember(db(), other.member.id, guest.id)).not.toBeNull()
		}
		// Someone not in the session does not manage it, and the owner is unchanged.
		const stranger = await user("stranger")
		expect(await canEditCastMember(db(), mine.member.id, stranger.id)).toBeNull()
		expect(await canEditCastMember(db(), mine.member.id, owner.id)).toMatchObject({
			bookOwnerId: owner.id
		})
	})

	test("a stranger neither reads nor edits; a missing member answers null", async () => {
		const owner = await user("owner")
		const stranger = await user("stranger")
		const { member } = await memberIn(owner.id)
		expect(await canReadCastMember(db(), member.id, stranger.id)).toBeNull()
		expect(await canEditCastMember(db(), member.id, stranger.id)).toBeNull()
		expect(await canReadCastMember(db(), 987654, owner.id)).toBeNull()
		expect(await canEditCastMember(db(), 987654, owner.id)).toBeNull()
	})

	test("an administrator reads unless isAdmin is false; never edits", async () => {
		const owner = await user("owner")
		const admin = await user("admin", true)
		const { member } = await memberIn(owner.id)
		expect(
			await canReadCastMember(db(), member.id, admin.id)
		).not.toBeNull()
		expect(
			await canReadCastMember(db(), member.id, admin.id, {
				isAdmin: false
			})
		).toBeNull()
		expect(await canEditCastMember(db(), member.id, admin.id)).toBeNull()
	})
})
