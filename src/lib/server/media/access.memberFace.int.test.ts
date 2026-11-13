/**
 * A cast member's face is its versions' (`character_versions.face_media_id`):
 * a face written through the member form is viewable by a book's readers and
 * by the people of a session that seats the member (character and player
 * seats); a file worn by no version is not, and a followed face is the
 * card's, never the member's.
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
		path.join(os.tmpdir(), "serene-pub-vitest-member-face-access-")
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
	return createTestUser(testDb, uniq("member-face"))
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
			hash: uniq("member-face-file")
		} as any)
		.returning()
	return row!
}

/** A session shared with a guest, and a book of the owner's the session does not attach. */
async function scenario() {
	const owner = await user()
	const guest = await user()
	const stranger = await user()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: uniq("Run") })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: uniq("Stray book") } as any)
		.returning()
	return { owner, guest, stranger, session: session!, book: book! }
}

/** A card-less member whose face is its base version's own. */
async function memberWearing(bookId: number, faceId: number | null) {
	const { insertCastMember } = await import("$lib/server/characters/versions")
	return (
		await insertCastMember(asDb(), {
			lorebookId: bookId,
			binding: `{{char:${++n}}}`,
			name: uniq("Member"),
			...(faceId != null ? { faceMediaId: faceId } : {})
		} as any)
	).member
}

describe("the face a member wears is its version's", () => {
	it("a character seat: the session's people view it, a stranger and a file no version wears do not", async () => {
		const w = await scenario()
		const worn = await file(w.owner.id)
		const unworn = await file(w.owner.id)
		const member = await memberWearing(w.book.id, worn.id)
		const seatCard = await card(w.owner.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: seatCard.id,
			castMemberId: member.id
		} as any)
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(worn, w.guest.id, asDb())).toBe(true)
		expect(await canViewMedia(worn, w.stranger.id, asDb())).toBe(false)
		expect(await canViewMedia(unworn, w.guest.id, asDb())).toBe(false)
	})

	it("a player seat: the session's people view the member's face", async () => {
		const w = await scenario()
		const worn = await file(w.owner.id)
		const member = await memberWearing(w.book.id, worn.id)
		const persona = await card(w.owner.id)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: w.session.id,
			personaId: persona.id,
			castMemberId: member.id
		} as any)
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(worn, w.guest.id, asDb())).toBe(true)
		expect(await canViewMedia(worn, w.stranger.id, asDb())).toBe(false)
	})

	it("a book's readers view the face its member wears; the frozen column is not read", async () => {
		const w = await scenario()
		const worn = await file(w.owner.id)
		const frozenOnly = await file(w.owner.id)
		const member = await memberWearing(w.book.id, worn.id)
		await testDb
			.update(schema.lorebookBindings)
			.set({ faceMediaId: frozenOnly.id })
			.where(eq(schema.lorebookBindings.id, member.id))
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: w.book.id, userId: w.guest.id } as any)
			.onConflictDoNothing()
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(worn, w.guest.id, asDb())).toBe(true)
		expect(await canViewMedia(worn, w.stranger.id, asDb())).toBe(false)
		expect(await canViewMedia(frozenOnly, w.guest.id, asDb())).toBe(false)
	})
})
