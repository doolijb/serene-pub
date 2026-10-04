/**
 * A start that lands while a stopped run is still finishing its item.
 *
 * The embedding star's consequence stops the queue, clears what the new model
 * cannot use, and starts it again (`applyEmbeddingStarChange`). `stop()` does
 * not wait: a run with an `embed()` in flight is still running when the start
 * arrives. The start has to re-arm that run — clear the stop — or the loop
 * leaves after the item it is on, and nothing indexes again until the
 * 15-minute sweep.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))

afterEach(() => {
	vi.restoreAllMocks()
})

describe("startVectorizationQueue", () => {
	it("re-arms a run that was told to stop and has not finished yet", async () => {
		const { embeddingLane, stopVectorization, startVectorizationQueue } =
			await import("./vectorizationQueue")
		// A run with an item in flight: running, and nothing ends it here.
		vi.spyOn(embeddingLane, "isRunning").mockReturnValue(true)
		const start = vi
			.spyOn(embeddingLane, "start")
			.mockImplementation(() => {})

		stopVectorization()
		await startVectorizationQueue()

		expect(start).toHaveBeenCalledTimes(1)
	})

	it("keeps a running run's progress and failure counts", async () => {
		const { embeddingLane, startVectorizationQueue } = await import(
			"./vectorizationQueue"
		)
		vi.spyOn(embeddingLane, "isRunning").mockReturnValue(true)
		vi.spyOn(embeddingLane, "start").mockImplementation(() => {})
		const reset = vi.spyOn(embeddingLane, "resetCompleted")
		const forget = vi.spyOn(embeddingLane, "clearFailureTracking")

		// The periodic sweep asks for a start every tick; a run already going
		// must not lose its backoff state or its count to it.
		await startVectorizationQueue({ startFromBeginning: true })

		expect(reset).not.toHaveBeenCalled()
		expect(forget).not.toHaveBeenCalled()
	})
})
