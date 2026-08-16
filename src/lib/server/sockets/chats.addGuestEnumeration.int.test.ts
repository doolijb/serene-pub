/**
 * E2: chats:addGuest used to return distinct error messages for "that user
 * doesn't exist" vs "already a guest" vs success — letting any chat owner
 * (ownership-gated, not admin-gated) binary-search valid user IDs on a
 * multi-account instance. Both failure cases now share one generic message.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-addguest-enum-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}

const noopEmit = () => {}

describe("chats:addGuest — error message enumeration (PGlite integration)", () => {
	test("a nonexistent user and an already-added guest return identical error text", async () => {
		const { chatsAddGuestHandler } = await import("./chats")

		const owner = await makeUser("addguest-enum-owner")
		const guest = await makeUser("addguest-enum-guest")
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ userId: owner.id, isGroup: true })
			.returning()

		// First add the guest for real, so we have a genuine "already a
		// guest" case to compare against.
		await testDb.insert(schema.chatGuests).values({
			chatId: chat.id,
			userId: guest.id,
			isPlayer: true
		})

		const alreadyGuestRes = await chatsAddGuestHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id, guestUserId: guest.id } as any,
			noopEmit
		)

		const nonexistentRes = await chatsAddGuestHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id, guestUserId: 999_999_999 } as any,
			noopEmit
		)

		expect(alreadyGuestRes.success).toBe(false)
		expect(nonexistentRes.success).toBe(false)
		expect(alreadyGuestRes.error).toBe(nonexistentRes.error)
	})

	test("the ownership check still gives its own distinct message (doesn't leak anything about other users)", async () => {
		const { chatsAddGuestHandler } = await import("./chats")

		const owner = await makeUser("addguest-enum-owner-2")
		const nonOwner = await makeUser("addguest-enum-nonowner")
		const target = await makeUser("addguest-enum-target")
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ userId: owner.id, isGroup: true })
			.returning()

		const res = await chatsAddGuestHandler.handler(
			fakeSocket(nonOwner.id),
			{ chatId: chat.id, guestUserId: target.id } as any,
			noopEmit
		)

		expect(res.success).toBe(false)
		expect(res.error).toMatch(/only chat owners/i)
	})
})
