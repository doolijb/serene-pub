/**
 * A3 fix: sessionMessages:regenerate/continue/swipeRight now wrap their body
 * in withSessionTriggerLock (same per-session mutex sessions:triggerGenerateMessage
 * already used) AND re-check, fresh, inside the lock, whether anything else
 * in the session is already generating — mirroring
 * triggerGenerateMessageHandler's own in-lock "hasGeneratingMessages" check.
 * Before this fix, none of the three had any freshness guard at all: they
 * unconditionally set isGenerating and called generateResponse, so wrapping
 * them in the lock alone (without also adding the guard) would only have
 * serialized two overlapping generations into two sequential ones — not
 * prevented the second one from happening. This test seeds a session with an
 * in-flight generation (a stuck/crashed-server-restart scenario is the most
 * realistic way this state occurs in practice, since the lock itself
 * prevents any live caller from leaving two messages simultaneously
 * generating) and asserts the guard rejects a regenerate attempt against it
 * without mutating the target message or invoking generateResponse.
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

const generateResponseMock = vi.fn(async (..._args: any[]) => true)

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/utils/generateResponse", () => ({
	generateResponse: (...args: any[]) => generateResponseMock(...args)
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-generation-guard-int-test-")
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

describe("sessionMessages:regenerate — generation guard (PGlite integration)", () => {
	test("rejects when another message in the same session is already generating, without mutating the target or calling generateResponse", async () => {
		generateResponseMock.mockClear()
		const { sessionMessagesRegenerateHandler } = await import("./sessions")

		const user = await makeUser("regen-guard-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		// The "already generating" message — simulates a stuck/in-flight
		// generation elsewhere in the same session.
		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "assistant",
			isNarratorResponse: true,
			content: "",
			isGenerating: true,
			generationStage: "generating"
		})

		// The target of this regenerate call — a separate message.
		const [target] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				isNarratorResponse: true,
				content: "Original content",
				isGenerating: false
			})
			.returning()

		const res = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(user.id),
			{ id: target.id } as any,
			noopEmit
		)

		expect(res.error).toMatch(/already generating/i)
		expect(res.sessionMessage).toBeUndefined()
		expect(generateResponseMock).not.toHaveBeenCalled()

		const after = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, target.id)
		})
		expect(after?.content).toBe("Original content")
		expect(after?.isGenerating).toBe(false)
	})

	test("proceeds normally when nothing else in the session is generating", async () => {
		generateResponseMock.mockClear()
		const { sessionMessagesRegenerateHandler } = await import("./sessions")

		const user = await makeUser("regen-guard-clear-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const [target] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				isNarratorResponse: true,
				content: "Original content",
				isGenerating: false
			})
			.returning()

		const res = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(user.id),
			{ id: target.id } as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(generateResponseMock).toHaveBeenCalledTimes(1)

		const after = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, target.id)
		})
		expect(after?.isGenerating).toBe(true)
	})
})
