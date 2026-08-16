/**
 * ensureChatMessageEmbedded() is the inline, awaited counterpart to the
 * background queue's pickChatMessage() — called right after a generated
 * message is persisted (generateResponse.ts) so a round-robin chain's next
 * turn can find it as a RAG candidate without waiting for the queue to
 * cycle back to it. It reuses needsEmbedding() and writeEmbeddingIfFresh()
 * directly rather than reimplementing staleness/safe-write logic, and adds
 * a timeout + cooldown specifically because this call sits inside
 * llmQueue's single global lane (see the doc comment above
 * INLINE_EMBED_TIMEOUT_MS in vectorizationQueue.ts) — a hang here would
 * otherwise stall every queued chat generation server-wide, not just this
 * one chat's turn.
 *
 * inlineEmbedDisabledUntil and the embed/isModelReady/getLoadedModelId
 * mocks below are all shared, module-level mutable state — any test that
 * changes them (a timeout test setting the cooldown, the "not ready" test
 * flipping isModelReady) MUST leave it clean afterward, or a later test's
 * behavior silently depends on run/declaration order instead of its own
 * setup. The top-level beforeEach/afterEach exist specifically to make
 * every test order-independent.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let embedMock: ReturnType<typeof vi.fn>
let isModelReadyMock: ReturnType<typeof vi.fn>
let getLoadedModelIdMock: ReturnType<typeof vi.fn>

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("./index", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./index")>()
	embedMock = vi.fn(async () => [0.1, 0.2, 0.3])
	isModelReadyMock = vi.fn(() => true)
	getLoadedModelIdMock = vi.fn(() => "test-model")
	return {
		...actual,
		embed: embedMock,
		isModelReady: isModelReadyMock,
		getLoadedModelId: getLoadedModelIdMock
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-ensure-chat-message-embedded-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	// Force the "./index" mock factory to run now (it's lazy, triggered by
	// the first actual import) so embedMock/isModelReadyMock/
	// getLoadedModelIdMock are already defined before the first beforeEach.
	await import("./vectorizationQueue")
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	// Known-good defaults before every test, regardless of what a previous
	// test did to these mocks (mockReset clears both call history AND any
	// custom implementation/rejection a prior test installed).
	embedMock.mockReset().mockImplementation(async () => [0.1, 0.2, 0.3])
	isModelReadyMock.mockReset().mockReturnValue(true)
	getLoadedModelIdMock.mockReset().mockReturnValue("test-model")
})

afterEach(async () => {
	// inlineEmbedDisabledUntil is module-level state in vectorizationQueue.ts
	// — a timeout test setting it would otherwise leak into every test that
	// runs after it, regardless of file order.
	const { clearInlineEmbedCooldown } = await import("./vectorizationQueue")
	clearInlineEmbedCooldown()
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeChat(userId: number) {
	const [chat] = await testDb
		.insert(schema.chats)
		.values({ userId, isGroup: false })
		.returning()
	return chat
}

async function makeChatMessage(
	chatId: number,
	overrides: Partial<typeof schema.chatMessages.$inferInsert> = {}
) {
	const [msg] = await testDb
		.insert(schema.chatMessages)
		.values({
			chatId,
			role: "assistant",
			content: "Hello world",
			...overrides
		})
		.returning()
	return msg
}

describe("ensureChatMessageEmbedded (PGlite integration)", () => {
	test("embeds and persists a message that has no embedding yet", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-fresh-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, { content: "needs embedding" })

		await ensureChatMessageEmbedded(msg.id)

		expect(embedMock).toHaveBeenCalledTimes(1)
		const updated = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, msg.id)
		})
		expect(updated?.embedding).toEqual([0.1, 0.2, 0.3])
		expect(updated?.embeddingModel).toBe("test-model")
		expect(updated?.vectorizedAt).not.toBeNull()
	})

	test("skips entirely — no embed() call, row untouched — when the embedding is already current", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-already-fresh-user")
		const chat = await makeChat(user.id)
		// updatedAt and vectorizedAt are both explicitly set to the exact same
		// JS Date value (not left to insert-time DB defaults) — needsEmbedding()
		// treats a row as stale when updatedAt > vectorizedAt, and comparing a
		// server-evaluated CURRENT_TIMESTAMP default against a client-computed
		// Date would leave the "already fresh" precondition at the mercy of
		// clock/latency timing instead of being deterministic.
		const now = new Date()
		const msg = await makeChatMessage(chat.id, {
			content: "already embedded",
			embedding: [0.9, 0.9, 0.9],
			embeddingModel: "test-model",
			updatedAt: now,
			vectorizedAt: now
		})

		await ensureChatMessageEmbedded(msg.id)

		expect(embedMock).not.toHaveBeenCalled()
		const row = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, msg.id)
		})
		expect(row?.embedding).toEqual([0.9, 0.9, 0.9])
	})

	test("re-embeds when the existing embedding belongs to a different model", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-stale-model-user")
		const chat = await makeChat(user.id)
		const now = new Date()
		const msg = await makeChatMessage(chat.id, {
			content: "old model embedding",
			embedding: [0.5, 0.5, 0.5],
			embeddingModel: "old-model",
			updatedAt: now,
			vectorizedAt: now
		})

		await ensureChatMessageEmbedded(msg.id)

		expect(embedMock).toHaveBeenCalledTimes(1)
		const row = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, msg.id)
		})
		expect(row?.embedding).toEqual([0.1, 0.2, 0.3])
		expect(row?.embeddingModel).toBe("test-model")
	})

	test("re-embeds when content changed after the last vectorization", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-content-changed-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, {
			content: "original content",
			embedding: [0.3, 0.3, 0.3],
			embeddingModel: "test-model",
			vectorizedAt: new Date(Date.now() - 60_000) // vectorized a minute ago
		})
		// Edit after vectorization — $onUpdate bumps updatedAt to "now", well
		// past the minute-old vectorizedAt above, so this isn't sensitive to
		// small clock/latency skew the way comparing near-simultaneous
		// timestamps would be.
		await testDb
			.update(schema.chatMessages)
			.set({ content: "edited content" })
			.where(eq(schema.chatMessages.id, msg.id))

		await ensureChatMessageEmbedded(msg.id)

		expect(embedMock).toHaveBeenCalledTimes(1)
		expect(embedMock).toHaveBeenCalledWith("edited content")
	})

	test("no-ops — no embed() call, row untouched — when the model isn't ready", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		isModelReadyMock.mockReturnValue(false)
		const user = await makeUser("ensure-embed-not-ready-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, { content: "cold model" })

		await ensureChatMessageEmbedded(msg.id)

		expect(embedMock).not.toHaveBeenCalled()
		const row = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, msg.id)
		})
		expect(row?.embedding).toBeNull()
	})

	test("a stale/conflicting write is rejected — edited while embed() was in flight — same guarantee as writeEmbeddingIfFresh", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-race-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, {
			content: "will be edited mid-embed"
		})

		// Drive the "edit lands while embed() is in flight" race by making the
		// mock itself perform the edit before resolving.
		embedMock.mockImplementationOnce(async () => {
			await testDb
				.update(schema.chatMessages)
				.set({ content: "edited while embedding was in flight" })
				.where(eq(schema.chatMessages.id, msg.id))
			return [0.7, 0.7, 0.7]
		})

		await ensureChatMessageEmbedded(msg.id)

		const row = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, msg.id)
		})
		// The stale vector must never land — writeEmbeddingIfFresh's optimistic
		// concurrency guard drops it because updatedAt no longer matches what
		// was captured before embed() ran.
		expect(row?.embedding).toBeNull()
		expect(row?.content).toBe("edited while embedding was in flight")
	})
})

describe("ensureChatMessageEmbedded — timeout and cooldown (PGlite integration)", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("times out and rejects — doesn't hang the caller — when embed() never resolves", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-timeout-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, { content: "will hang" })
		embedMock.mockImplementation(() => new Promise(() => {})) // never settles

		const resultPromise = ensureChatMessageEmbedded(msg.id)
		// Attach a handler immediately — the timeout rejection has to propagate
		// through withTimeout's Promise.race/.finally and this function's own
		// await before reaching the assertion below; advanceTimersByTimeAsync
		// firing the timer and that propagation fully settling aren't the same
		// microtask, and Node's unhandled-rejection check can trip on that gap
		// even though the rejection below still fires as expected.
		const swallowed = resultPromise.catch(() => {})
		await vi.waitFor(() => expect(embedMock).toHaveBeenCalled())
		await vi.advanceTimersByTimeAsync(10_000)
		await swallowed

		await expect(resultPromise).rejects.toThrow("Inline embed timed out")
	})

	test("after a timeout, a second call within the cooldown window no-ops immediately, then retries once the cooldown elapses", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-cooldown-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, { content: "first call hangs" })
		embedMock.mockImplementation(() => new Promise(() => {}))

		const firstCall = ensureChatMessageEmbedded(msg.id)
		// See the identical comment in the "times out and rejects" test above.
		const swallowed = firstCall.catch(() => {})
		await vi.waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
		await vi.advanceTimersByTimeAsync(10_000)
		await swallowed
		await expect(firstCall).rejects.toThrow("Inline embed timed out")

		// Still within the 60s cooldown — must not attempt embed() again.
		await ensureChatMessageEmbedded(msg.id)
		expect(embedMock).toHaveBeenCalledTimes(1)

		// After the cooldown elapses, it tries again (self-healing).
		await vi.advanceTimersByTimeAsync(60_000)
		embedMock.mockImplementation(async () => [0.2, 0.2, 0.2])
		await ensureChatMessageEmbedded(msg.id)
		expect(embedMock).toHaveBeenCalledTimes(2)
	})

	test("a normal (non-timeout) embed() rejection does NOT trigger the cooldown", async () => {
		const { ensureChatMessageEmbedded } = await import("./vectorizationQueue")
		const user = await makeUser("ensure-embed-normal-error-user")
		const chat = await makeChat(user.id)
		const msg = await makeChatMessage(chat.id, {
			content: "will fail to embed"
		})
		embedMock.mockRejectedValue(new Error("simulated auth failure"))

		await expect(ensureChatMessageEmbedded(msg.id)).rejects.toThrow(
			"simulated auth failure"
		)
		// If a normal error incorrectly triggered the cooldown, this second call
		// would no-op instead of attempting embed() again.
		await expect(ensureChatMessageEmbedded(msg.id)).rejects.toThrow(
			"simulated auth failure"
		)

		expect(embedMock).toHaveBeenCalledTimes(2)
	})
})
