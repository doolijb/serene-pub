/**
 * Round-9 audit fix (MEDIUM): chatMessagesSwipeLeftHandler was the only one
 * of Regenerate/Continue/SwipeRight/SwipeLeft that didn't wrap its mutation
 * in withChatTriggerLock (the per-chat mutex the others already share) — it
 * read the message, then wrote back a whole-row snapshot taken before that
 * read, with no serialization against a concurrent Regenerate/Continue/
 * SwipeRight on the same message. A generation starting in one of those
 * handlers while an unlocked SwipeLeft was mid-flight could have its
 * isGenerating/queueItemId state clobbered back to SwipeLeft's stale
 * pre-read values. Fixed by wrapping SwipeLeft's body in the same
 * withChatTriggerLock(message.chatId, ...) call, matching SwipeRight's
 * structure. This test proves SwipeLeft now actually goes through that
 * shared per-chat lock: a held lock for the chat blocks SwipeLeft's write
 * until released, and the write only lands afterward.
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
		path.join(os.tmpdir(), "serene-pub-swipeleft-lock-int-test-")
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

describe("chatMessages:swipeLeft — generation lock (PGlite integration)", () => {
	test("waits for an in-flight withChatTriggerLock holder on the same chat before writing", async () => {
		const { chatMessagesSwipeLeftHandler } = await import("./chats")
		const { withChatTriggerLock } = await import(
			"$lib/server/utils/chatTriggerLock"
		)

		const user = await makeUser("swipeleft-lock-user")
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({
				chatId: chat.id,
				role: "assistant",
				isNarratorResponse: true,
				content: "b",
				metadata: {
					swipes: { currentIdx: 1, history: ["a", "b"] }
				}
			})
			.returning()

		const order: string[] = []
		let releaseLock: () => void = () => {}
		const lockHeld = new Promise<void>((resolve) => {
			releaseLock = resolve
		})

		// Hold the chat's trigger lock, simulating a concurrent Regenerate/
		// Continue/SwipeRight already in flight for this chat.
		const lockHolder = withChatTriggerLock(chat.id, async () => {
			order.push("lock-holder-start")
			await lockHeld
			order.push("lock-holder-end")
		})

		// SwipeLeft must queue behind the held lock, not run immediately.
		const swipePromise = chatMessagesSwipeLeftHandler.handler(
			fakeSocket(user.id),
			{ id: message.id } as any,
			noopEmit
		).then((res) => {
			order.push("swipe-left-done")
			return res
		})

		// Give any unlocked/immediate execution path a chance to run — if
		// the fix regressed (lock not held), swipeLeft would already have
		// written to the DB by now.
		await new Promise((r) => setTimeout(r, 20))
		const midFlight = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, message.id)
		})
		expect(midFlight?.content).toBe("b") // unchanged — still queued behind the lock

		releaseLock()
		await lockHolder
		await swipePromise

		expect(order).toEqual([
			"lock-holder-start",
			"lock-holder-end",
			"swipe-left-done"
		])

		const after = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, message.id)
		})
		expect(after?.content).toBe("a") // swipe left actually applied, after the lock freed
	})
})
