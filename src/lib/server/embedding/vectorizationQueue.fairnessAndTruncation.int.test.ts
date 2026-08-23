/**
 * Round-9 audit fixes (both MEDIUM):
 *  - pickNextItem used to fully drain priorityQueue[0] before any other
 *    group got a single item processed — one large group (eg. a freshly
 *    bulk-imported lorebook) could starve every other user's group until it
 *    finished completely. Fixed to round-robin: pick one item from the
 *    front group, then rotate it to the back, so N groups interleave one
 *    item at a time instead of one group hogging the queue.
 *  - Every non-message embed() call site (lore entries, narrative nodes/
 *    relationships, character/persona descriptions) fed an unbounded text
 *    column straight into the embedding model with no length cap — chat
 *    messages already had one (MAX_CHAT_MESSAGE_LENGTH, enforced before
 *    insert). truncateForEmbedding() is the shared safety net now wrapping
 *    every one of those call sites.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let getLoadedModelIdMock: ReturnType<typeof vi.fn>

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("./index", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./index")>()
	// Defaults to "no model loaded" so any background runQueue() triggered
	// synchronously by enqueueLorebookGroup() below is a harmless no-op
	// (pickNextItem's own currentModel guard returns null immediately) —
	// only the test's own direct pickNextItem() calls flip this to a real
	// model id, keeping the round-robin sequence deterministic.
	getLoadedModelIdMock = vi.fn(() => null)
	return { ...actual, getLoadedModelId: getLoadedModelIdMock }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vectorization-fairness-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

describe("pickNextItem — round-robin fairness across priority groups (PGlite integration)", () => {
	test("interleaves items across 2 groups instead of draining one before the other", async () => {
		const { pickNextItem, enqueueLorebookGroup } = await import(
			"./vectorizationQueue"
		)

		const user = await makeUser("fairness-user")
		const [lorebookA] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Lorebook A", userId: user.id })
			.returning()
		const [lorebookB] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Lorebook B", userId: user.id })
			.returning()
		// One never-embedded world lore entry each — needsEmbedding() stays
		// true for both across every pick below, since nothing here ever
		// calls item.process() to actually write a vector back.
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebookA.id,
			name: "A entry",
			content: "content a"
		})
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebookB.id,
			name: "B entry",
			content: "content b"
		})

		// getLoadedModelIdMock still returns null here, so these enqueue
		// calls' own background runQueue() trigger is a no-op.
		enqueueLorebookGroup(lorebookA.id, "Lorebook A", user.username)
		enqueueLorebookGroup(lorebookB.id, "Lorebook B", user.username)

		getLoadedModelIdMock.mockReturnValue("test-model")

		const picks: (number | undefined)[] = []
		for (let i = 0; i < 4; i++) {
			const item = await pickNextItem()
			picks.push(item?.lorebookId)
		}

		expect(picks.every((p) => p !== undefined)).toBe(true)
		// The old drain-first behavior would return the SAME lorebookId all
		// 4 times (group 1 never gets marked exhausted, since process() is
		// never called) — round-robin must alternate instead.
		expect(picks[0]).not.toBe(picks[1])
		expect(picks[1]).not.toBe(picks[2])
		expect(picks[0]).toBe(picks[2])
		expect(picks[1]).toBe(picks[3])
	})
})

describe("truncateForEmbedding — embedding input length cap", () => {
	test("leaves text under the limit unchanged", async () => {
		const { truncateForEmbedding, MAX_EMBED_INPUT_LENGTH } = await import(
			"./vectorizationQueue"
		)
		const text = "a".repeat(MAX_EMBED_INPUT_LENGTH - 1)
		expect(truncateForEmbedding(text)).toBe(text)
	})

	test("leaves text exactly at the limit unchanged", async () => {
		const { truncateForEmbedding, MAX_EMBED_INPUT_LENGTH } = await import(
			"./vectorizationQueue"
		)
		const text = "a".repeat(MAX_EMBED_INPUT_LENGTH)
		expect(truncateForEmbedding(text)).toBe(text)
		expect(truncateForEmbedding(text).length).toBe(MAX_EMBED_INPUT_LENGTH)
	})

	test("truncates text over the limit down to exactly the limit", async () => {
		const { truncateForEmbedding, MAX_EMBED_INPUT_LENGTH } = await import(
			"./vectorizationQueue"
		)
		const text = "a".repeat(MAX_EMBED_INPUT_LENGTH + 5000)
		const result = truncateForEmbedding(text)
		expect(result.length).toBe(MAX_EMBED_INPUT_LENGTH)
		expect(result).toBe("a".repeat(MAX_EMBED_INPUT_LENGTH))
	})
})
