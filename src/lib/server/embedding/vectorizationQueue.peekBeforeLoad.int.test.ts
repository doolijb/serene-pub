/**
 * runQueue() used to call loadConfiguredEmbeddingModel() unconditionally
 * whenever the model wasn't already loaded, *before* ever checking whether
 * there was anything to embed — so a periodic scan tick (every 15 minutes,
 * see startPeriodicVectorizationScan()) with a genuinely empty queue still
 * paid the full model-load cost, then immediately found nothing to do and
 * went idle again, only to have the TTL unload it and repeat forever. Fixed
 * to peek via getConfiguredModelId() + pickNextItem(modelIdOverride) — the
 * *configured* (not yet loaded) model's identity — before ever loading.
 *
 * Exercises the real production path end-to-end (real PGlite DB via
 * createTestDb(), real getConfiguredEmbeddingTarget()/
 * loadConfiguredEmbeddingModel()/activateApiEmbedding()/embed()), mocking
 * only the external `openai` client — same approach as
 * loadConfiguredEmbeddingModel.test.ts — so "current" rows are established
 * by actually running a real embed cycle, not by hand-writing an
 * embeddingModel string that only has to agree with itself.
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

const testEmbedCreate = vi.fn(async () => ({
	data: [{ embedding: Array(8).fill(0.1) }]
}))

vi.mock("openai", () => ({
	OpenAI: class {
		embeddings = { create: testEmbedCreate }
	}
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	const schema = await import("$lib/server/db/schema")
	// getConfiguredEmbeddingTarget() reads both `db` and `schema` off this
	// module (`await import("$lib/server/db")` twice, separately) — the
	// mock needs to answer both, unlike vectorizationQueue.ts's own static
	// `import * as schema from "$lib/server/db/schema"`, a different path.
	return { db, schema }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-peek-before-load-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	// Singleton tables (id=1, matching getConfiguredEmbeddingTarget()'s
	// hardcoded `where eq(id, 1)`) — no migration seeds them, so every test
	// in this file shares one row and updates it to whatever config it
	// needs. id must be explicit: createTestDb()'s sequence-resync (see
	// testDb.ts) sets systemSettings' identity sequence's current value to
	// 1 even for a still-empty table, so — per Postgres's 2-arg setval
	// semantics (marks the value as already consumed) — the first default-
	// generated insert would otherwise land on id 2, not 1.
	await testDb.insert(schema.systemSettings).values({
		id: 1,
		vectorizationEnabled: true,
		// Value is unused in API mode (only its truthiness gates the initial
		// check) but must be non-empty regardless of mode — matches
		// loadConfiguredEmbeddingModel.test.ts's API-mode fixture.
		embeddingModelName: "api::placeholder::placeholder"
	})
	await testDb.insert(schema.vectorizationConfigs).values({
		id: 1,
		embeddingModelTtlMinutes: 5,
		mode: "api",
		apiBaseUrl: "https://api.example.com",
		apiModel: "model-a"
	})
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function setApiModel(apiModel: string) {
	await testDb
		.update(schema.vectorizationConfigs)
		.set({ apiModel })
		.where(eq(schema.vectorizationConfigs.id, 1))
}

async function makeStaleLoreEntry(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `${name} Book`, userId })
		.returning()
	const [entry] = await testDb
		.insert(schema.worldLoreEntries)
		.values({ lorebookId: lorebook.id, name, content: `${name} content` })
		.returning()
	return entry
}

async function runOneCycle() {
	const { startVectorizationQueue, isVectorizationRunning } = await import(
		"./vectorizationQueue"
	)
	await startVectorizationQueue()
	// runQueue()'s synchronous prefix (isRunning = true) has already run by
	// the time startVectorizationQueue() resolves (it calls runQueue()
	// without awaiting it) — asserting this here, in every call site, is
	// what proves the loop body (and therefore the peek) actually ran this
	// cycle rather than startVectorizationQueue() no-op'ing on a stuck
	// isRunning guard from a previous test. pickNextItem() itself can't be
	// spied on directly — runQueue() calls it as a same-module direct
	// reference, which vi.mock/vi.spyOn can't intercept (see
	// loadConfiguredEmbeddingModel.test.ts's header comment for the same
	// limitation on index.ts) — so this is the closest available proof that
	// the cycle actually executed rather than returning instantly.
	expect(isVectorizationRunning()).toBe(true)
	const { vi: vitestVi } = await import("vitest")
	await vitestVi.waitFor(() => expect(isVectorizationRunning()).toBe(false), {
		timeout: 5000
	})
}

describe("runQueue() — peek before load", () => {
	test("real work exists: loads exactly once and embeds the stale row", async () => {
		const { unloadEmbeddingModel } = await import("./index")
		unloadEmbeddingModel()
		testEmbedCreate.mockClear()
		await setApiModel("model-a")

		const user = await makeUser("peek-realwork-user")
		const entry = await makeStaleLoreEntry(user.id, "Real Work Entry")

		await runOneCycle()

		// 1 activation ping (activateApiEmbedding's validation call) + 1 real
		// embed call for the one stale row — exactly 2, not more (proves the
		// queue doesn't loop back and load again once the row is current).
		expect(testEmbedCreate).toHaveBeenCalledTimes(2)

		const after = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		expect(after?.embedding).not.toBeNull()
		expect(after?.vectorizedAt).not.toBeNull()
	})

	test("nothing to do: the model is never loaded", async () => {
		const { unloadEmbeddingModel, getLoadedModelId } = await import(
			"./index"
		)
		await setApiModel("model-a")

		const user = await makeUser("peek-nothing-user")
		const entry = await makeStaleLoreEntry(user.id, "Nothing To Do Entry")

		// Establish "current" first — a real cycle, not a hand-written row —
		// then simulate the TTL-driven unload the bug report describes.
		unloadEmbeddingModel()
		testEmbedCreate.mockClear()
		await runOneCycle()
		expect(testEmbedCreate).toHaveBeenCalledTimes(2)
		unloadEmbeddingModel()
		expect(getLoadedModelId()).toBeNull()

		testEmbedCreate.mockClear()
		await runOneCycle()

		// The fix: nothing pending, so no load attempt at all.
		expect(testEmbedCreate).not.toHaveBeenCalled()
		expect(getLoadedModelId()).toBeNull()

		// Distinguishes "correctly declined to load" from "runQueue broke
		// and did nothing" — the staleness check itself still ran, using
		// the pre-load candidate id, and correctly found nothing.
		const stillCurrent = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		expect(stillCurrent?.vectorizedAt).not.toBeNull()
	})

	test("model switch: a row current under model A is re-embedded once the configured model changes to B", async () => {
		const { unloadEmbeddingModel } = await import("./index")

		const user = await makeUser("peek-modelswitch-user")
		const entry = await makeStaleLoreEntry(user.id, "Model Switch Entry")

		await setApiModel("model-a")
		unloadEmbeddingModel()
		testEmbedCreate.mockClear()
		await runOneCycle()
		expect(testEmbedCreate).toHaveBeenCalledTimes(2)

		const afterA = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		expect(afterA?.embeddingModel).toContain("model-a")

		// Switch the configured model — the row is now stale under B even
		// though nothing about the row itself changed. This is the one test
		// that actually exercises pickNextItem(modelIdOverride) with a
		// candidate that differs from every stored embeddingModel value.
		await setApiModel("model-b")
		unloadEmbeddingModel()
		testEmbedCreate.mockClear()

		await runOneCycle()

		// Not an exact count here (unlike cycle A above): switching the
		// configured model makes every row embedded under the old one stale
		// globally, including the earlier tests' own rows in this shared
		// test DB (pickWorldLoreEntry's global sweep has no lorebookId
		// filter) — a real reflection of production behavior (a model
		// switch really does invalidate everything, not just this row), not
		// a test-isolation bug to paper over. At least one activation + one
		// embed for this row is the real claim; the row-level checks below
		// are what actually prove it.
		expect(testEmbedCreate.mock.calls.length).toBeGreaterThanOrEqual(2)
		const afterB = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		expect(afterB?.embeddingModel).toContain("model-b")
		expect(afterB?.embeddingModel).not.toBe(afterA?.embeddingModel)
	})
})
