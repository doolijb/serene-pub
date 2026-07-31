/**
 * Round-4 audit fixes, chat pipeline lane:
 *  - 1a: chatMessageHandler ("chatMessage" event) used to fetch a message
 *      by id with no checkChatAccess call — unlike every sibling handler in
 *      this file — letting any authenticated user read any chat message on
 *      the instance by guessing/incrementing ids.
 *  - 1b: chatsCreateHandler/chatsUpdateHandler used to accept an
 *      unvalidated lorebookId (and, on update, userId) straight from the
 *      client payload, letting a user attach another user's private
 *      lorebook to their own chat, or reassign the chat's owner.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-chats-msg-scoping-int-test-")
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
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

async function makeChat(userId: number, extra: Record<string, unknown> = {}) {
	const [chat] = await testDb
		.insert(schema.chats)
		.values({ userId, isGroup: false, ...extra })
		.returning()
	return chat
}

async function makeLorebook(userId: number, name = "Test Book") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

describe("chatMessage — access control (PGlite integration)", () => {
	test("rejects fetching a message from a chat the caller has no access to", async () => {
		const { chatMessageHandler } = await import("./chats")
		const owner = await makeUser("chatmsg-owner")
		const attacker = await makeUser("chatmsg-attacker")
		const chat = await makeChat(owner.id)
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({ chatId: chat.id, role: "user", content: "secret content" })
			.returning()

		await expect(
			chatMessageHandler.handler(
				fakeSocket(attacker.id),
				{ id: message.id },
				noopEmit
			)
		).rejects.toThrow()
	})

	test("the chat owner can still fetch their own message by id", async () => {
		const { chatMessageHandler } = await import("./chats")
		const owner = await makeUser("chatmsg-owner-2")
		const chat = await makeChat(owner.id)
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({ chatId: chat.id, role: "user", content: "hello" })
			.returning()

		const res = await chatMessageHandler.handler(
			fakeSocket(owner.id),
			{ id: message.id },
			noopEmit
		)

		expect(res.chatMessage?.id).toBe(message.id)
		expect(res.chatMessage?.content).toBe("hello")
	})
})

describe("chats:create — lorebookId scoping (PGlite integration)", () => {
	test("rejects a lorebookId the caller doesn't own", async () => {
		const { chatsCreateHandler } = await import("./chats")
		const owner = await makeUser("chatcreate-owner")
		const attacker = await makeUser("chatcreate-attacker")
		const foreignLorebook = await makeLorebook(owner.id, "Owner's Book")

		await expect(
			chatsCreateHandler.handler(
				fakeSocket(attacker.id),
				{ chat: { lorebookId: foreignLorebook.id } } as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a lorebookId the caller owns", async () => {
		const { chatsCreateHandler } = await import("./chats")
		const owner = await makeUser("chatcreate-owner-2")
		const ownLorebook = await makeLorebook(owner.id, "My Book")

		const res = await chatsCreateHandler.handler(
			fakeSocket(owner.id),
			{ chat: { lorebookId: ownLorebook.id } } as any,
			noopEmit
		)

		expect((res as any).chat?.lorebookId ?? (res as any).lorebookId).toBe(
			ownLorebook.id
		)
	})
})

describe("chats:update — allowlist + lorebookId scoping (PGlite integration)", () => {
	test("ignores a foreign userId and rejects a foreign lorebookId", async () => {
		const { chatsUpdateHandler } = await import("./chats")
		const owner = await makeUser("chatupdate-owner")
		const attacker = await makeUser("chatupdate-attacker")
		const chat = await makeChat(owner.id)
		const foreignLorebook = await makeLorebook(attacker.id, "Attacker's Book")

		await expect(
			chatsUpdateHandler.handler(
				fakeSocket(owner.id),
				{
					chat: {
						id: chat.id,
						lorebookId: foreignLorebook.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow()

		// userId reassignment: no ownership gate exists to reject this
		// (the caller legitimately owns the chat), so it must be silently
		// ignored by the allowlist instead.
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				chat: {
					id: chat.id,
					name: "Renamed",
					userId: attacker.id
				} as any
			},
			noopEmit
		)
		const reloaded = await testDb.query.chats.findFirst({
			where: eq(schema.chats.id, chat.id)
		})
		expect(reloaded!.userId).toBe(owner.id)
		expect(reloaded!.name).toBe("Renamed")
	})

	test("applies allowlisted fields including an owned lorebookId", async () => {
		const { chatsUpdateHandler } = await import("./chats")
		const owner = await makeUser("chatupdate-owner-2")
		const chat = await makeChat(owner.id)
		const ownLorebook = await makeLorebook(owner.id, "Own Book")

		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				chat: {
					id: chat.id,
					name: "New Name",
					scenario: "A scenario",
					lorebookId: ownLorebook.id
				} as any
			},
			noopEmit
		)

		const reloaded = await testDb.query.chats.findFirst({
			where: eq(schema.chats.id, chat.id)
		})
		expect(reloaded!.name).toBe("New Name")
		expect(reloaded!.scenario).toBe("A scenario")
		expect(reloaded!.lorebookId).toBe(ownLorebook.id)
	})
})
