/**
 * Who may read and who may edit a cast member's own art: the book's owner
 * (both), a share recipient (read), a session guest whose session seats the
 * member (read), a member of a session whose own notes the book is (both), an
 * administrator (read unless told not; never edit), a stranger (neither).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
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

	test("a member of the session whose own notes hold the member reads and edits", async () => {
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
		expect(
			await canReadCastMember(db(), member.id, guest.id)
		).not.toBeNull()
		expect(
			await canEditCastMember(db(), member.id, guest.id)
		).toMatchObject({
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
