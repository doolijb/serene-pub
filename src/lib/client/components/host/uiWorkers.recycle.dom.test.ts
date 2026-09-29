/**
 * Recycling a worker (C6, P5, `uiWorkers.ts`): a worker keeps every module
 * URL it imported for its life, so once it has imported `RECYCLE_AFTER`
 * distinct modules a mount asking for one more gets a fresh worker. The old
 * one is never terminated under a live mount — it goes when its last mount is
 * released — and a release of the old worker's mounts is never counted
 * against the fresh one. `Worker` is stood in for.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { RECYCLE_AFTER, acquireWorker, releaseWorker, terminateAllWorkers } from "./uiWorkers"

const started: FakeWorker[] = []
class FakeWorker {
	terminated = 0
	onmessage: unknown = null
	onerror: unknown = null
	constructor() {
		started.push(this)
	}
	postMessage() {}
	terminate() {
		this.terminated++
	}
}
const entry = (n: number) => `/authored-ui/authored.aaaaaaaaaa/${n}.js`

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal("Worker", FakeWorker)
})
afterEach(() => {
	terminateAllWorkers()
	started.length = 0
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe("recycling an owner's worker", () => {
	test("twenty is the number", () => {
		expect(RECYCLE_AFTER).toBe(20)
	})

	test(`the same module mounted again and again never recycles`, () => {
		for (let i = 0; i < RECYCLE_AFTER * 3; i++) {
			const w = acquireWorker("authored.aaaaaaaaaa", entry(1))
			releaseWorker("authored.aaaaaaaaaa", w)
		}
		expect(started).toHaveLength(1)
	})

	test("a fresh worker for the module after the twentieth; the old one goes with its last live mount", () => {
		const owner = "authored.aaaaaaaaaa"
		const old: Worker[] = []
		// Two mounts live on the old worker across the whole run.
		old.push(acquireWorker(owner, entry(0)), acquireWorker(owner, entry(0)))
		for (let n = 1; n < RECYCLE_AFTER; n++) releaseWorker(owner, acquireWorker(owner, entry(n)))
		expect(started).toHaveLength(1)

		const fresh = acquireWorker(owner, entry(RECYCLE_AFTER))
		expect(started).toHaveLength(2)
		expect(fresh).not.toBe(old[0])
		// Two mounts still run on it: not terminated.
		vi.advanceTimersByTime(10_000)
		expect(started[0]!.terminated).toBe(0)

		// Releasing the old worker's mounts counts against the old worker only.
		releaseWorker(owner, old[0])
		expect(started[0]!.terminated).toBe(0)
		releaseWorker(owner, old[1])
		expect(started[0]!.terminated).toBe(1)
		vi.advanceTimersByTime(10_000)
		expect(started[1]!.terminated).toBe(0)
		// A late extra release of the old one is nothing to the fresh one.
		releaseWorker(owner, old[1])
		vi.advanceTimersByTime(10_000)
		expect(started[1]!.terminated).toBe(0)
		// The fresh one lingers after its own last release, as always.
		releaseWorker(owner, fresh)
		vi.advanceTimersByTime(2_000)
		expect(started[1]!.terminated).toBe(1)
	})

	test("a worker with nothing running on it is terminated at once when recycled", () => {
		const owner = "authored.aaaaaaaaaa"
		for (let n = 0; n < RECYCLE_AFTER; n++) releaseWorker(owner, acquireWorker(owner, entry(n)))
		// All released: lingering. The next new module recycles it now.
		acquireWorker(owner, entry(RECYCLE_AFTER))
		expect(started[0]!.terminated).toBe(1)
		expect(started).toHaveLength(2)
	})

	test("leaving the page takes a recycled worker still running a mount, too", () => {
		const owner = "authored.aaaaaaaaaa"
		acquireWorker(owner, entry(0))
		for (let n = 1; n < RECYCLE_AFTER; n++) releaseWorker(owner, acquireWorker(owner, entry(n)))
		acquireWorker(owner, entry(RECYCLE_AFTER))
		terminateAllWorkers()
		expect(started.map((w) => w.terminated)).toEqual([1, 1])
	})
})
