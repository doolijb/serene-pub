/**
 * Round-10 audit fix (MEDIUM): chatsSummarizeHandler ran unguarded, unlike
 * every other LLM-triggering handler in chats.ts (regenerate/continue/
 * swipeRight, all wrapped in withChatTriggerLock) — concurrent
 * chats:summarize requests for the same chat (double-click, multiple tabs)
 * each independently ran the full batch+synthesis LLM pipeline, multiplying
 * cost/latency. Fixed with withChatTriggerLock plus an explicit
 * inFlightSummarizeChatIds in-flight guard that rejects a second concurrent
 * request outright rather than queuing it to run right after the first.
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
		path.join(os.tmpdir(), "serene-pub-summarize-lock-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUserWithLorebookChat(username: string) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Test Lorebook", userId: user.id })
		.returning()
	const [chat] = await testDb
		.insert(schema.chats)
		.values({ isGroup: false, userId: user.id, lorebookId: lorebook.id })
		.returning()
	return { user, chat }
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: false } } as any
}

const noopEmit = () => {}

function summarizeParams(chatId: number): any {
	return {
		chatId,
		messageIds: "all",
		loreType: "world"
	}
}

describe("chats:summarize — concurrent-request guard", () => {
	test("a second concurrent call for the same chat is rejected outright, not queued", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const { user, chat } = await makeUserWithLorebookChat(
			"summarize-lock-concurrent-user"
		)

		const results = await Promise.allSettled([
			chatsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(chat.id),
				noopEmit
			),
			chatsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(chat.id),
				noopEmit
			)
		])

		// Both reject in this test (no LLM connection configured, no
		// messages in the chat) — the point is WHY. Exactly one must reject
		// with the in-flight guard's own message; the other reached the real
		// pipeline and failed for the unrelated "no messages" reason
		// (proving it was never blocked from starting in the first place).
		const messages = results.map((r) =>
			r.status === "rejected" ? String(r.reason?.message ?? r.reason) : null
		)
		const guardRejections = messages.filter((m) =>
			/already running/i.test(m ?? "")
		)
		const pipelineRejections = messages.filter((m) =>
			/no messages found/i.test(m ?? "")
		)
		expect(guardRejections.length).toBe(1)
		expect(pipelineRejections.length).toBe(1)
	})

	test("a sequential call after the first completes is not blocked by a stale guard entry", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const { user, chat } = await makeUserWithLorebookChat(
			"summarize-lock-sequential-user"
		)

		await expect(
			chatsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(chat.id),
				noopEmit
			)
		).rejects.toThrow(/no messages found/i)

		// The guard's `finally` must have cleared the in-flight entry — a
		// second, later call should fail for the same unrelated pipeline
		// reason again, NOT "already running" (which would mean the guard
		// leaked and permanently locked this chat out of summarization).
		await expect(
			chatsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(chat.id),
				noopEmit
			)
		).rejects.toThrow(/no messages found/i)
	})
})
