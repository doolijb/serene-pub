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
 * real embedding load. Each tick's enabled check is `embeddingsEnabled(db)`
 * (`$lib/server/embedding/target`), which is a `connection_defaults` select
 * for the `text->embedding` star — that `db.select` call is used as the
 * observable proxy for "a tick actually ran."
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

/**
 * A starred embedding connection, or none — what `capabilityDefault`'s
 * `select().from().where().limit()` chain resolves to for the
 * `text->embedding` row. `embeddingsEnabled` reads only `connectionId`, so
 * the rest of the row's shape is unused here.
 */
function dbModuleMock(enabled: boolean, selectImpl?: any) {
	const rows = enabled
		? [{ connectionId: 1, connectionModelId: null, samplingConfigId: null }]
		: []
	const select =
		selectImpl ??
		vi.fn(() => ({
			from: () => ({
				where: () => ({
					limit: async () => rows
				})
			})
		}))
	return {
		db: { select }
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
		await vi.waitFor(() => expect(mockModule.db.select).toHaveBeenCalled())
	})

	test("ticks again after the 15-minute interval elapses", async () => {
		const mockModule = dbModuleMock(false)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		await vi.waitFor(() =>
			expect(mockModule.db.select).toHaveBeenCalledTimes(1)
		)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(mockModule.db.select).toHaveBeenCalledTimes(2)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(mockModule.db.select).toHaveBeenCalledTimes(3)
	})

	test("a second call is idempotent — does not create a second timer (no doubled tick rate)", async () => {
		const mockModule = dbModuleMock(false)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		startPeriodicVectorizationScan()
		await vi.waitFor(() =>
			expect(mockModule.db.select).toHaveBeenCalledTimes(1)
		)

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		// A second (duplicate) timer would have produced 3 calls here (1
		// immediate + 2 overlapping ticks), not 2.
		expect(mockModule.db.select).toHaveBeenCalledTimes(2)
	})

	test("a tick that throws doesn't prevent future ticks from running", async () => {
		let callCount = 0
		const select = vi.fn(() => {
			callCount++
			if (callCount === 1) throw new Error("simulated DB hiccup")
			return {
				from: () => ({
					where: () => ({
						limit: async () => []
					})
				})
			}
		})
		const mockModule = dbModuleMock(false, select)
		vi.doMock("$lib/server/db", () => mockModule)
		const { startPeriodicVectorizationScan } = await freshImport()

		startPeriodicVectorizationScan()
		await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1))

		await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
		expect(select).toHaveBeenCalledTimes(2)
	})
})
