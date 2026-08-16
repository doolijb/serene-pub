/**
 * Round-12 audit fix (HIGH): triggerNarratorResponseHandler was the only
 * generation-triggering handler (Regenerate/Continue/SwipeLeft/SwipeRight/
 * triggerGenerateMessage all already do) that didn't wrap its check-then-
 * generate sequence in withChatTriggerLock — it read
 * `chat.chatMessages.some(isGenerating)` unlocked, then inserted a new
 * narrator message and called generateResponse. Two near-simultaneous
 * "Trigger Narrator" clicks, or a narrator trigger racing any other
 * generation trigger on the same chat, could both pass the stale check and
 * run concurrent generations. Fixed by wrapping the entire handler body in
 * withChatTriggerLock(params.chatId, ...), mirroring
 * triggerGenerateMessageHandler's shape. This test proves the handler now
 * actually queues behind an already-held lock for the same chat: the
 * narrator message insert doesn't happen until the lock is released.
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

// Isolates this test from needing a full sampling/prompt/context config
// fixture (resolveNarratorPromptConfig -> getUserConfigurations throws
// "Missing required configuration" against a bare test DB with none of
// those seeded) — irrelevant to what's under test here, which is purely
// whether the handler's insert is serialized behind the chat lock.
vi.mock("$lib/server/utils/resolveNarratorPromptConfig", () => ({
	resolveNarratorPromptConfig: async () => null
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-narrator-lock-int-test-")
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

describe("chats:triggerNarratorResponse — generation lock (Round-12 audit fix, PGlite integration)", () => {
	test("waits for an in-flight withChatTriggerLock holder on the same chat before inserting the narrator message", async () => {
		const { triggerNarratorResponseHandler } = await import("./chats")
		const { withChatTriggerLock } = await import(
			"$lib/server/utils/chatTriggerLock"
		)

		const user = await makeUser("narrator-lock-user")
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const order: string[] = []
		let releaseLock: () => void = () => {}
		const lockHeld = new Promise<void>((resolve) => {
			releaseLock = resolve
		})

		// Hold the chat's trigger lock, simulating a concurrent Regenerate/
		// Continue/Swipe/triggerGenerateMessage already in flight for this
		// chat.
		const lockHolder = withChatTriggerLock(chat.id, async () => {
			order.push("lock-holder-start")
			await lockHeld
			order.push("lock-holder-end")
		})

		// triggerNarratorResponse must queue behind the held lock, not run
		// immediately.
		const triggerPromise = triggerNarratorResponseHandler.handler(
			fakeSocket(user.id),
			{ chatId: chat.id } as any,
			noopEmit
		).then((res) => {
			order.push("trigger-done")
			return res
		})

		// Give any unlocked/immediate execution path a chance to run — if the
		// fix regressed (lock not held), the narrator message would already
		// be inserted by now.
		await new Promise((r) => setTimeout(r, 20))
		const midFlightCount = await testDb.query.chatMessages.findMany({
			where: eq(schema.chatMessages.chatId, chat.id)
		})
		expect(midFlightCount.length).toBe(0) // still queued behind the lock

		releaseLock()
		await lockHolder
		await triggerPromise

		expect(order).toEqual([
			"lock-holder-start",
			"lock-holder-end",
			"trigger-done"
		])

		const after = await testDb.query.chatMessages.findMany({
			where: eq(schema.chatMessages.chatId, chat.id)
		})
		expect(after.length).toBe(1) // narrator message inserted, after the lock freed
		expect(after[0].isNarratorResponse).toBe(true)
	})

	test("a second trigger on the same chat sees 'already generating' once the first has inserted its message", async () => {
		const { triggerNarratorResponseHandler } = await import("./chats")

		const user = await makeUser("narrator-lock-guard-user")
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ userId: user.id, isGroup: false })
			.returning()
		// Simulates the first trigger's insert having already landed (the
		// lock serializes the two calls, so by the time the second one runs
		// the isGenerating row from the first is already committed).
		await testDb.insert(schema.chatMessages).values({
			chatId: chat.id,
			role: "assistant",
			isNarratorResponse: true,
			isGenerating: true,
			content: ""
		})

		const res: any = await triggerNarratorResponseHandler.handler(
			fakeSocket(user.id),
			{ chatId: chat.id } as any,
			noopEmit
		)

		expect(res.error).toMatch(/already generating/i)
		const rows = await testDb.query.chatMessages.findMany({
			where: eq(schema.chatMessages.chatId, chat.id)
		})
		expect(rows.length).toBe(1) // no second message inserted
	})
})
