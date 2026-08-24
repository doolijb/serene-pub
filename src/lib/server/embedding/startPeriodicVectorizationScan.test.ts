/**
 * startPeriodicVectorizationScan() replaces loadSockets.server.ts's old
 * boot-time autoLoadEmbeddingModel() call — it (re-)triggers the queue
 * immediately (the boot-time trigger) and every 15 minutes after, so
 * missing/stale embeddings get picked up even without a reactive
 * create/update trigger or a manual "Start Queue" click (e.g. after a
 * restart with a backlog already present). It deliberately does NOT load
 * the embedding model itself — only startVectorizationQueue() -> runQueue()
 * does that, and only once it actually finds something to embed — so these
 * tests only need to prove the *scan* triggers correctly, not exercise a
 * real embedding load. `db.query.systemSettings.findFirst` is used as the
 * observable proxy for "a tick actually ran."
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

function dbModuleMock(vectorizationEnabled: boolean, findFirstImpl?: any) {
	const findFirst =
		findFirstImpl ?? vi.fn(async () => ({ vectorizationEnabled }))
	return {
		db: {
			query: {
				systemSettings: { findFirst }
			}
		}
	}
}

async function freshImport() {
	vi.resetModules()
	return await import("./vectorizationQueue")
}

describe("startPeriodicVectorizationScan", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.doUnmock("$lib/server/db")
	})

	test("the first tick runs immediately — this is the boot-time trigger, not a separate code path", async () => {
		const mockModule = dbModuleMock(false)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		await vi.waitFor(() =>
			expect(
				mockModule.db.query.systemSettings.findFirst
			).toHaveBeenCalled()
		)
	})

	test("ticks again after the 15-minute interval elapses", async () => {
		const mockModule = dbModuleMock(false)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		await vi.waitFor(() =>
			expect(
				mockModule.db.query.systemSettings.findFirst
			).toHaveBeenCalledTimes(1)
		)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(
			mockModule.db.query.systemSettings.findFirst
		).toHaveBeenCalledTimes(2)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(
			mockModule.db.query.systemSettings.findFirst
		).toHaveBeenCalledTimes(3)
	})

	test("a second call is idempotent — does not create a second timer (no doubled tick rate)", async () => {
		const mockModule = dbModuleMock(false)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		startPeriodicVectorizationScan()
		await vi.waitFor(() =>
			expect(
				mockModule.db.query.systemSettings.findFirst
			).toHaveBeenCalledTimes(1)
		)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		// A second (duplicate) timer would have produced 3 calls here (1
		// immediate + 2 overlapping ticks), not 2.
		expect(
			mockModule.db.query.systemSettings.findFirst
		).toHaveBeenCalledTimes(2)
	})

	test("a tick that throws doesn't prevent future ticks from running", async () => {
		let callCount = 0
		const findFirst = vi.fn(async () => {
			callCount++
			if (callCount === 1) throw new Error("simulated DB hiccup")
			return { vectorizationEnabled: false }
		})
		const mockModule = dbModuleMock(false, findFirst)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		await vi.waitFor(() => expect(findFirst).toHaveBeenCalledTimes(1))

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(findFirst).toHaveBeenCalledTimes(2)
	})
})
