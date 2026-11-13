/**
 * 🚧 A seat is read as the cast member it seats (plan §27 S2): who may see
 * a card, a member's face and a backdrop follows the seat's MEMBER as well as
 * the card the seat holds.
 *
 * Claims: a session's guest may view the card a seated member is linked to,
 * though the seat holds another card (a stranger may not, and the seat's own
 * card reads as before); a seated member's own face is viewable by the
 * session's people wherever the member lives (here, the session's own book),
 * and a face worn by a member no session of theirs seats is not; a backdrop
 * may be a gallery image of the card a seated member is linked to; the
 * conversations person tab lists that card for the guest. And the member's
 * ACTIVE card (a dated card the session's clock has reached) is viewable too,
 * for the card, a backdrop and the person tab.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
vi.mock("$lib/server/sockets/utils/userPush", () => ({ pushToUser: vi.fn() }))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seat-member-access-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1, isAccountsEnabled: true })
		.onConflictDoUpdate({
			target: schema.systemSettings.id,
			set: { isAccountsEnabled: true, messagingEnabled: true }
		})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, uniq("seat-member-access"))
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name: uniq(name), description: "" })
		.returning()
	return row!
}

async function file(userId: number, over: Record<string, unknown> = {}) {
	const [row] = await testDb
		.insert(schema.files)
		.values({
			userId,
			kind: "image",
			hash: uniq("seat-member-file"),
			...over
		} as any)
		.returning()
	return row!
}

/**
 * A session its owner shares with one guest; its seat holds card A while the
 * seat's member lives in the session's own book and is linked to card B (both
 * cards the owner's). `sessions.lorebook_id` stays empty.
 */
async function scenario() {
	const owner = await user()
	const guest = await user()
	const stranger = await user()
	const A = await card(owner.id, "Seat card")
	const B = await card(owner.id, "Member card")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: uniq("Run") })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	const [ownBook] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: owner.id,
			name: uniq("Session notes"),
			sessionId: session!.id
		} as any)
		.returning()
	const member = (await insertCastMember(testDb, {
			lorebookId: ownBook!.id,
			characterId: B.id,
			binding: `{{char:${++n}}}`,
			name: "Member"
		} as any)).member
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: A.id,
		castMemberId: member!.id
	} as any)
	return {
		owner,
		guest,
		stranger,
		A,
		B,
		session: session!,
		ownBook: ownBook!,
		member: member!
	}
}

describe("a seated member's card, face and backdrop", () => {
	it("a guest views the card the seated member is linked to; a stranger does not", async () => {
		const w = await scenario()
		const { canViewCharacter } = await import(
			"$lib/server/utils/sessionAccess"
		)
		expect(await canViewCharacter(w.B.id, w.guest.id)).toBe(true)
		expect(await canViewCharacter(w.B.id, w.stranger.id)).toBe(false)
		// The card the seat holds reads as before.
		expect(await canViewCharacter(w.A.id, w.guest.id)).toBe(true)
		expect(await canViewCharacter(w.A.id, w.stranger.id)).toBe(false)
	})

	it("a player seat's member counts too", async () => {
		const w = await scenario()
		const P = await card(w.owner.id, "Player card")
		const Q = await card(w.owner.id, "Player member card")
		const pm = (await insertCastMember(testDb, {
				lorebookId: w.ownBook.id,
				characterId: Q.id,
				binding: `{{char:${++n}}}`,
				name: "Voice"
			} as any)).member
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: w.session.id,
			personaId: P.id,
			castMemberId: pm!.id
		} as any)
		const { canViewCharacter } = await import(
			"$lib/server/utils/sessionAccess"
		)
		expect(await canViewCharacter(Q.id, w.guest.id)).toBe(true)
		expect(await canViewCharacter(Q.id, w.stranger.id)).toBe(false)
	})

	it("a seated member's own face is viewable by the session's people, any other member's is not", async () => {
		const w = await scenario()
		const { eq } = await import("drizzle-orm")
		// The member lives in a book the session neither attaches nor owns
		// (a seat that outlived a book swap), so only the seat explains it.
		const [strayBook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.owner.id, name: uniq("Stray") } as any)
			.returning()
		const face = await file(w.owner.id)
		// The face is a member version's (the member's own column is frozen).
		const { insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const { member: worn } = await insertCastMember(testDb as unknown as Db, {
			lorebookId: strayBook!.id,
			binding: `{{char:${++n}}}`,
			name: "Worn",
			faceMediaId: face.id
		} as any)
		const C = await card(w.owner.id, "Second seat card")
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: C.id,
			castMemberId: worn.id
		} as any)
		// A member of another book, seated in no session of the guest's.
		const [otherBook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.owner.id, name: uniq("Elsewhere") } as any)
			.returning()
		const elsewhereFace = await file(w.owner.id)
		await insertCastMember(testDb as unknown as Db, {
			lorebookId: otherBook!.id,
			binding: `{{char:${++n}}}`,
			name: "Elsewhere",
			faceMediaId: elsewhereFace.id
		} as any)
		const { canViewMedia } = await import("$lib/server/media/access")
		const asDb = testDb as unknown as Db
		expect(await canViewMedia(face, w.guest.id, asDb)).toBe(true)
		expect(await canViewMedia(face, w.stranger.id, asDb)).toBe(false)
		expect(await canViewMedia(elsewhereFace, w.guest.id, asDb)).toBe(false)
		// Control: the same face, its member no longer seated, is the owner's alone.
		await testDb
			.delete(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.characterId, C.id))
		expect(await canViewMedia(face, w.guest.id, asDb)).toBe(false)
	})

	it("a backdrop may be an image of the card a seated member is linked to", async () => {
		const w = await scenario()
		const pic = await file(w.owner.id, { characterId: w.B.id })
		const unrelated = await card(w.owner.id, "Unseated")
		const stray = await file(w.owner.id, { characterId: unrelated.id })
		const { backdropFileFor, BackdropRefusal } = await import(
			"$lib/server/sessions/backdrop"
		)
		const who = {
			sessionId: w.session.id,
			userId: w.guest.id,
			castImages: true
		}
		expect(
			await backdropFileFor(testDb as unknown as Db, String(pic.id), who)
		).toEqual({
			id: pic.id
		})
		await expect(
			backdropFileFor(testDb as unknown as Db, String(stray.id), who)
		).rejects.toBeInstanceOf(BackdropRefusal)
	})

	it("the person tab lists the member's card for the session's guest", async () => {
		const w = await scenario()
		const store = await import("$lib/server/conversations/store")
		const res = await store.person(testDb as unknown as Db, w.guest.id, {
			userId: w.owner.id
		})
		const ids = res.characters.map((c) => c.id)
		expect(ids).toContain(w.B.id)
		expect(ids).toContain(w.A.id)
		const none = await store.person(
			testDb as unknown as Db,
			w.stranger.id,
			{
				userId: w.owner.id
			}
		)
		expect(none.characters.map((c) => c.id)).not.toContain(w.B.id)
	})
})

// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
// ★acc-1 -> kept: viewing a card also follows a seated member's LINKED card.
describe("a seated member's active card (a dated card) is viewable too", () => {
	/**
	 * A guest of a session whose seat holds card A, the member linked to A and
	 * drawn by card B from year 20, the session's story clock at `clockYear`.
	 */
	async function dated(clockYear: number) {
		const owner = await user()
		const guest = await user()
		const stranger = await user()
		const A = await card(owner.id, "Held card")
		const B = await card(owner.id, "Dated card")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: uniq("Book") } as any)
			.returning()
		const member = (await insertCastMember(testDb, {
				lorebookId: book!.id,
				characterId: A.id,
				binding: `{{char:${++n}}}`,
				name: "Dated member"
			} as any)).member
		await insertDatedCardVersion(testDb, member!.id, B.id, 20)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: uniq("Run"),
				lorebookId: book!.id,
				storyClockYear: clockYear
			} as any)
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session!.id, userId: guest.id })
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: A.id,
			castMemberId: member!.id
		} as any)
		return { owner, guest, stranger, A, B, session: session!, member: member! }
	}

	it("a guest views the dated card once the clock draws it; before that, only the held card", async () => {
		const { canViewCharacter } = await import(
			"$lib/server/utils/sessionAccess"
		)
		const after = await dated(30)
		expect(await canViewCharacter(after.B.id, after.guest.id)).toBe(true)
		expect(await canViewCharacter(after.A.id, after.guest.id)).toBe(true)
		expect(await canViewCharacter(after.B.id, after.stranger.id)).toBe(false)
		const before = await dated(10)
		expect(await canViewCharacter(before.B.id, before.guest.id)).toBe(false)
		expect(await canViewCharacter(before.A.id, before.guest.id)).toBe(true)
	})

	it("the dated card's picture reaches the guest through the card's own ground", async () => {
		const { canViewMedia } = await import("$lib/server/media/access")
		const asDb = testDb as unknown as Db
		const w = await dated(30)
		const pic = await file(w.owner.id, { characterId: w.B.id })
		expect(await canViewMedia(pic, w.guest.id, asDb)).toBe(true)
		expect(await canViewMedia(pic, w.stranger.id, asDb)).toBe(false)
		const early = await dated(10)
		const earlyPic = await file(early.owner.id, { characterId: early.B.id })
		expect(await canViewMedia(earlyPic, early.guest.id, asDb)).toBe(false)
	})

	it("a backdrop may be an image of the dated card", async () => {
		const w = await dated(30)
		const pic = await file(w.owner.id, { characterId: w.B.id })
		const { backdropFileFor, BackdropRefusal } = await import(
			"$lib/server/sessions/backdrop"
		)
		const who = { sessionId: w.session.id, userId: w.guest.id, castImages: true }
		expect(
			await backdropFileFor(testDb as unknown as Db, String(pic.id), who)
		).toEqual({ id: pic.id })
		const early = await dated(10)
		const earlyPic = await file(early.owner.id, { characterId: early.B.id })
		await expect(
			backdropFileFor(testDb as unknown as Db, String(earlyPic.id), {
				sessionId: early.session.id,
				userId: early.guest.id,
				castImages: true
			})
		).rejects.toBeInstanceOf(BackdropRefusal)
	})

	it("the person tab lists the dated card for the session's guest, not before the clock reaches it", async () => {
		const store = await import("$lib/server/conversations/store")
		const w = await dated(30)
		const res = await store.person(testDb as unknown as Db, w.guest.id, {
			userId: w.owner.id
		})
		expect(res.characters.map((c) => c.id)).toContain(w.B.id)
		const none = await store.person(testDb as unknown as Db, w.stranger.id, {
			userId: w.owner.id
		})
		expect(none.characters.map((c) => c.id)).not.toContain(w.B.id)
		const early = await dated(10)
		const e = await store.person(testDb as unknown as Db, early.guest.id, {
			userId: early.owner.id
		})
		expect(e.characters.map((c) => c.id)).not.toContain(early.B.id)
		expect(e.characters.map((c) => c.id)).toContain(early.A.id)
	})
})
