/**
 * The page's UI workers are counted (unit M, `uiWorkers.ts`): one per owner,
 * started by its first mount, shared by every later one, and let go a moment
 * after its last mount goes — a layout move that remounts inside that moment
 * keeps it. A worker nothing mounted needs does not outlive the moment;
 * leaving the session page takes every one at once. `Worker` is stood in for.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { acquireWorker, releaseWorker, terminateAllWorkers } from "./uiWorkers"

const started: FakeWorker[] = []
class FakeWorker {
	name: string
	terminated = 0
	onmessage: unknown = null
	onerror: unknown = null
	constructor(_url: string | URL, opts?: { name?: string }) {
		this.name = opts?.name ?? ""
		started.push(this)
	}
	postMessage() {}
	terminate() {
		this.terminated++
	}
}
const live = () => started.filter((w) => w.terminated === 0).map((w) => w.name)

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

describe("the page's UI workers, counted", () => {
	test("one per owner, shared by every mount of it", () => {
		const a = acquireWorker("core")
		const b = acquireWorker("core")
		const c = acquireWorker("acme")
		expect(a).toBe(b)
		expect(c).not.toBe(a)
		expect(live()).toEqual(["sp-ui:core", "sp-ui:acme"])
		for (const o of ["core", "core", "acme"]) releaseWorker(o)
	})

	test("kept while any mount holds it; let go a moment after the last goes", () => {
		acquireWorker("core")
		acquireWorker("core")
		releaseWorker("core")
		vi.advanceTimersByTime(10_000)
		expect(live()).toEqual(["sp-ui:core"])
		releaseWorker("core")
		expect(live()).toEqual(["sp-ui:core"])
		vi.advanceTimersByTime(2_000)
		expect(live()).toEqual([])
		// Gone for good: the next mount starts a fresh one.
		acquireWorker("core")
		expect(started).toHaveLength(2)
		expect(live()).toEqual(["sp-ui:core"])
		releaseWorker("core")
	})

	test("a remount inside the moment keeps the same worker", () => {
		const first = acquireWorker("core")
		releaseWorker("core")
		vi.advanceTimersByTime(1_000)
		expect(acquireWorker("core")).toBe(first)
		vi.advanceTimersByTime(10_000)
		expect(started).toHaveLength(1)
		expect(live()).toEqual(["sp-ui:core"])
		releaseWorker("core")
	})

	test("an extra release neither goes below none nor lets a later mount's worker go", () => {
		acquireWorker("core")
		releaseWorker("core")
		releaseWorker("core")
		vi.advanceTimersByTime(2_000)
		expect(live()).toEqual([])
		acquireWorker("core")
		releaseWorker("acme")
		vi.advanceTimersByTime(10_000)
		expect(live()).toEqual(["sp-ui:core"])
		releaseWorker("core")
	})

	test("one owner's last mount going never takes another's worker", () => {
		acquireWorker("core")
		acquireWorker("acme")
		releaseWorker("acme")
		vi.advanceTimersByTime(2_000)
		expect(live()).toEqual(["sp-ui:core"])
		releaseWorker("core")
	})

	test("leaving the session page takes every worker at once, and a late release after it is nothing", () => {
		acquireWorker("core")
		acquireWorker("acme")
		terminateAllWorkers()
		expect(live()).toEqual([])
		releaseWorker("core")
		vi.advanceTimersByTime(10_000)
		expect(started.map((w) => w.terminated)).toEqual([1, 1])
	})
})
