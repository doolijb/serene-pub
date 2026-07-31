/**
 * Round-10 audit fix (LOW): chatsSummarizeHandler/chatsSetLorebookHandler
 * reimplemented chat ownership inline instead of using the shared
 * checkChatAccess helper (utils/chatAccess.ts), whose own comment warns
 * against ad-hoc reimplementations — this is how a prior guest-lockout bug
 * happened. Effect is equivalent today (owner-only for both handlers), so
 * this is a maintainability alignment — verified here as a behavior
 * regression guard: a non-owner, non-guest user must still be rejected.
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
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-summarize-chataccess-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeChatWithOwner(ownerUsername: string) {
	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: ownerUsername })
		.returning()
	const [chat] = await testDb
		.insert(schema.chats)
		.values({ isGroup: false, userId: owner.id })
		.returning()
	return { owner, chat }
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: false } } as any
}

const noopEmit = () => {}

describe("chats:summarize — ownership check", () => {
	test("a non-owner, non-guest user is rejected", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const { owner, chat } = await makeChatWithOwner(
			"chataccess-summarize-owner"
		)
		const [stranger] = await testDb
			.insert(schema.users)
			.values({ username: "chataccess-summarize-stranger" })
			.returning()

		await expect(
			chatsSummarizeHandler.handler(
				fakeSocket(stranger.id),
				{ chatId: chat.id, messageIds: "all", loreType: "world" } as any,
				noopEmit
			)
		).rejects.toThrow(/not found or access denied/i)
	})
})

describe("chats:setLorebook — ownership check", () => {
	test("a non-owner, non-guest user is rejected", async () => {
		const { chatsSetLorebookHandler } = await import("./summarize")
		const { owner, chat } = await makeChatWithOwner(
			"chataccess-setlorebook-owner"
		)
		const [stranger] = await testDb
			.insert(schema.users)
			.values({ username: "chataccess-setlorebook-stranger" })
			.returning()

		await expect(
			chatsSetLorebookHandler.handler(
				fakeSocket(stranger.id),
				{ chatId: chat.id, lorebookId: null } as any,
				noopEmit
			)
		).rejects.toThrow(/not found or access denied/i)
	})

	test("the owner can attach a lorebook they own", async () => {
		const { chatsSetLorebookHandler } = await import("./summarize")
		const { owner, chat } = await makeChatWithOwner(
			"chataccess-setlorebook-happy-owner"
		)
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Lorebook", userId: owner.id })
			.returning()

		const res = await chatsSetLorebookHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id, lorebookId: lorebook.id } as any,
			noopEmit
		)
		expect(res.chat.lorebookId).toBe(lorebook.id)
	})
})
