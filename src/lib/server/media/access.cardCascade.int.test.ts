/**
 * ★s4-fb-4 (owner 2026-11-10: "Permissions cascade through the cast member if
 * the lorebook is shared, or user is a guest."): a file a cast member draws
 * from its card — a sprite, the face it follows, the likeness image it
 * follows — opens to anyone who may read the member. Nothing else of the card
 * does, and a face or sprite the member owns never opens the card's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-vitest-card-cascade-access-")
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
	return createTestUser(testDb, uniq("card-cascade"))
}
async function file(userId: number) {
	const [row] = await testDb
		.insert(schema.files)
		.values({
			userId,
			kind: "image",
			hash: uniq("card-cascade-file")
		} as any)
		.returning()
	return row!
}

/**
 * A card (owner's) with an avatar, a likeness image, a sprite and a gallery
 * picture; a book shared with `reader`; a member linked to the card in it; a
 * session of the owner's that seats the member with `guest` invited.
 */
async function scene(opts: { retoldFace?: boolean; ownSprite?: boolean } = {}) {
	const owner = await user()
	const reader = await user()
	const guest = await user()
	const stranger = await user()
	const avatar = await file(owner.id)
	const likeness = await file(owner.id)
	const spriteFile = await file(owner.id)
	const gallery = await file(owner.id)
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: owner.id,
			name: uniq("Card"),
			description: "",
			avatarMediaId: avatar.id,
			extensions: {
				serenepub: { likeness: { imageMediaId: likeness.id } }
			}
		} as any)
		.returning()
	await testDb
		.update(schema.files)
		.set({ characterId: card!.id })
		.where(eq(schema.files.id, gallery.id))
	const [set] = await testDb
		.insert(schema.spriteSets)
		.values({ characterId: card!.id, name: "default", isDefault: true })
		.returning()
	await testDb.insert(schema.sprites).values({
		spriteSetId: set!.id,
		label: "joy",
		fileId: spriteFile.id
	} as any)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: uniq("Book") } as any)
		.returning()
	await testDb
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: reader.id } as any)
	const ownFace = opts.retoldFace ? await file(owner.id) : null
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const { member } = await insertCastMember(asDb(), {
		lorebookId: book!.id,
		characterId: card!.id,
		binding: `{{char:${++n}}}`,
		name: uniq("Member"),
		...(ownFace ? { faceMediaId: ownFace.id, retold: { face: true } } : {})
	} as any)
	if (opts.ownSprite) {
		const ownArt = await file(owner.id)
		const [own] = await testDb
			.insert(schema.spriteSets)
			.values({
				castMemberId: member.id,
				name: "default",
				isDefault: true
			})
			.returning()
		await testDb.insert(schema.sprites).values({
			spriteSetId: own!.id,
			label: "calm",
			fileId: ownArt.id
		} as any)
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: uniq("Run") })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: card!.id,
		castMemberId: member.id
	} as any)
	return {
		owner,
		reader,
		guest,
		stranger,
		avatar,
		likeness,
		spriteFile,
		gallery
	}
}

describe("a card's files cascade through the cast member that draws them", () => {
	it("a shared-book reader loads the sprite, the followed face and the followed likeness image", async () => {
		const w = await scene()
		const { canViewMedia } = await import("$lib/server/media/access")
		for (const f of [w.spriteFile, w.avatar, w.likeness])
			expect(await canViewMedia(f, w.reader.id, asDb())).toBe(true)
	})

	it("a session guest of a session that seats the member loads the same three", async () => {
		const w = await scene()
		const { canViewMedia } = await import("$lib/server/media/access")
		for (const f of [w.spriteFile, w.avatar, w.likeness])
			expect(await canViewMedia(f, w.guest.id, asDb())).toBe(true)
	})

	it("a stranger is refused all three", async () => {
		const w = await scene()
		const { canViewMedia } = await import("$lib/server/media/access")
		for (const f of [w.spriteFile, w.avatar, w.likeness])
			expect(await canViewMedia(f, w.stranger.id, asDb())).toBe(false)
	})

	it("an administrator the book is not shared with is refused all three", async () => {
		const w = await scene()
		const admin = await user()
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, admin.id))
		const { canViewMedia } = await import("$lib/server/media/access")
		for (const f of [w.spriteFile, w.avatar, w.likeness])
			expect(await canViewMedia(f, admin.id, asDb())).toBe(false)
	}, 60_000)

	it("a card gallery picture gains nothing for the shared-book reader", async () => {
		const w = await scene()
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(w.gallery, w.reader.id, asDb())).toBe(false)
	})

	it("a member that owns its face does not open the card's avatar", async () => {
		const w = await scene({ retoldFace: true })
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(w.avatar, w.reader.id, asDb())).toBe(false)
	})

	it("a member that draws its own sprites does not open the card's sprite file", async () => {
		const w = await scene({ ownSprite: true })
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(w.spriteFile, w.reader.id, asDb())).toBe(
			false
		)
	})
})
