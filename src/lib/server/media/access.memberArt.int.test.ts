/**
 * A cast member's own art — a sprite in a set of the member's, a picture in its
 * gallery (`cast_member_files`) — opens for whoever can read the member's book,
 * for the people of a session reading that book, and for the people of a
 * session that seats the member; a stranger, and a file only a CARD's sprite set
 * holds, do not get it through this rule.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-vitest-member-art-access-")
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
const asDb = () => testDb as unknown as Db

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, uniq("member-art"))
}
async function card(userId: number) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name: uniq("Card"), description: "" })
		.returning()
	return row!
}
async function file(userId: number) {
	const [row] = await testDb
		.insert(schema.files)
		.values({
			userId,
			kind: "image",
			hash: uniq("member-art-file")
		} as any)
		.returning()
	return row!
}

/** An owner's book, a second user who owns the art, and the people around it. */
async function scenario() {
	const owner = await user()
	const artOwner = await user()
	const guest = await user()
	const reader = await user()
	const seatedGuest = await user()
	const stranger = await user()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: uniq("Book") } as any)
		.returning()
	await testDb
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: guest.id } as any)
	// A session that reads the book.
	const [reading] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			name: uniq("Reading"),
			lorebookId: book!.id
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: reading!.id, userId: reader.id })
	// A session that does not read the book but seats its member (below).
	const [seating] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: uniq("Seating") })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: seating!.id, userId: seatedGuest.id })
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const member = (
		await insertCastMember(asDb(), {
			lorebookId: book!.id,
			binding: `{{char:${++n}}}`,
			name: uniq("Member")
		} as any)
	).member
	return {
		owner,
		artOwner,
		guest,
		reader,
		seatedGuest,
		stranger,
		book: book!,
		reading: reading!,
		seating: seating!,
		member
	}
}

async function memberSprite(memberId: number, fileId: number) {
	const [set] = await testDb
		.insert(schema.spriteSets)
		.values({ castMemberId: memberId, name: uniq("set"), isDefault: true })
		.returning()
	await testDb
		.insert(schema.sprites)
		.values({ spriteSetId: set!.id, label: "joy", fileId })
}

describe("a member's own art opens for the people of its book", () => {
	it("a sprite and a gallery picture: a read share and a reading session open them; a stranger does not", async () => {
		const w = await scenario()
		const sprite = await file(w.artOwner.id)
		const gallery = await file(w.artOwner.id)
		await memberSprite(w.member.id, sprite.id)
		await testDb
			.insert(schema.castMemberFiles)
			.values({ castMemberId: w.member.id, fileId: gallery.id })
		const { canViewMedia } = await import("$lib/server/media/access")
		for (const f of [sprite, gallery]) {
			expect(await canViewMedia(f, w.guest.id, asDb())).toBe(true)
			expect(await canViewMedia(f, w.reader.id, asDb())).toBe(true)
			expect(await canViewMedia(f, w.stranger.id, asDb())).toBe(false)
		}
	})

	it("a session that seats the member opens them, in either seat table", async () => {
		const w = await scenario()
		const sprite = await file(w.artOwner.id)
		const gallery = await file(w.artOwner.id)
		await memberSprite(w.member.id, sprite.id)
		await testDb
			.insert(schema.castMemberFiles)
			.values({ castMemberId: w.member.id, fileId: gallery.id })
		const seatCard = await card(w.owner.id)
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(sprite, w.seatedGuest.id, asDb())).toBe(false)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: w.seating.id,
			characterId: seatCard.id,
			castMemberId: w.member.id
		} as any)
		expect(await canViewMedia(sprite, w.seatedGuest.id, asDb())).toBe(true)
		expect(await canViewMedia(gallery, w.seatedGuest.id, asDb())).toBe(true)
		expect(await canViewMedia(gallery, w.stranger.id, asDb())).toBe(false)

		// A player seat does the same.
		const w2 = await scenario()
		const art = await file(w2.artOwner.id)
		await memberSprite(w2.member.id, art.id)
		const persona = await card(w2.owner.id)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: w2.seating.id,
			personaId: persona.id,
			castMemberId: w2.member.id
		} as any)
		expect(await canViewMedia(art, w2.seatedGuest.id, asDb())).toBe(true)
		expect(await canViewMedia(art, w2.stranger.id, asDb())).toBe(false)
	})

	it("a file only a card's sprite set holds is not opened through the book", async () => {
		const w = await scenario()
		const cardArt = await file(w.artOwner.id)
		const theCard = await card(w.owner.id)
		const [set] = await testDb
			.insert(schema.spriteSets)
			.values({
				characterId: theCard.id,
				name: uniq("card-set"),
				isDefault: true
			})
			.returning()
		await testDb
			.insert(schema.sprites)
			.values({ spriteSetId: set!.id, label: "joy", fileId: cardArt.id })
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(cardArt, w.guest.id, asDb())).toBe(false)
		expect(await canViewMedia(cardArt, w.reader.id, asDb())).toBe(false)
	})
})
