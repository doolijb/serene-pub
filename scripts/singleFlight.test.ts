import { describe, expect, test } from "vitest"

import { createSingleFlight } from "./singleFlight.js"

/**
 * A runner whose runs are held open until the test releases them, so "while a
 * run is in flight" is a state the test controls rather than a race it hopes
 * for. Each run resolves to its own 0-based index, which is what lets a caller
 * assert *which* run it was folded into.
 *
 * `peak` is the claim that actually matters: the docs compile failed with
 * ENOTEMPTY because two of it overlapped over one output directory, and every
 * other assertion here is a consequence of that never being allowed to happen.
 */
function gatedRunner() {
	const gates: (() => void)[] = []
	let live = 0

	const runner = {
		started: 0,
		peak: 0,
		/** Index of the run that should reject; -1 for none. */
		failAt: -1,
		/** Let the nth run that started finish. */
		release(index: number) {
			gates[index]()
		},
		async run(): Promise<number> {
			live += 1
			runner.peak = Math.max(runner.peak, live)
			const index = runner.started
			runner.started += 1
			await new Promise<void>((resolve) => gates.push(resolve))
			live -= 1
			if (index === runner.failAt) throw new Error(`run ${index} failed`)
			return index
		}
	}
	return runner
}

/** Let every already-settled promise deliver its reactions. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("createSingleFlight", () => {
	test("triggers arriving mid-run collapse into exactly one re-run", async () => {
		const runner = gatedRunner()
		const flight = createSingleFlight(runner.run)

		const first = flight()
		await settle()
		expect(runner.started).toBe(1)

		// Three saves land while the first compile is still going.
		const second = flight()
		const third = flight()
		const fourth = flight()
		await settle()
		expect(runner.started).toBe(1)

		runner.release(0)
		expect(await first).toBe(0)
		// One re-run for all three, and not until the first had finished.
		expect(runner.started).toBe(2)

		runner.release(1)
		expect(await second).toBe(1)
		expect(await third).toBe(1)
		expect(await fourth).toBe(1)

		expect(runner.started).toBe(2)
		expect(runner.peak).toBe(1)
	})

	test("a trigger during the re-run queues one more, and no further", async () => {
		const runner = gatedRunner()
		const flight = createSingleFlight(runner.run)

		const first = flight()
		await settle()
		const second = flight()

		runner.release(0)
		await first
		expect(runner.started).toBe(2)

		// Two more saves, now against the re-run.
		const third = flight()
		const fourth = flight()
		runner.release(1)
		expect(await second).toBe(1)
		expect(runner.started).toBe(3)

		runner.release(2)
		expect(await third).toBe(2)
		expect(await fourth).toBe(2)
		expect(runner.started).toBe(3)
		expect(runner.peak).toBe(1)
	})

	test("an idle flight runs every call, one after another", async () => {
		const runner = gatedRunner()
		const flight = createSingleFlight(runner.run)

		const first = flight()
		runner.release(0)
		expect(await first).toBe(0)

		const second = flight()
		runner.release(1)
		expect(await second).toBe(1)

		expect(runner.started).toBe(2)
		expect(runner.peak).toBe(1)
	})

	test("a rejection reaches its own callers and leaves the flight clear", async () => {
		const runner = gatedRunner()
		runner.failAt = 0
		const flight = createSingleFlight(runner.run)

		const first = flight()
		await settle()
		// A save arrives while the doomed compile is still running: a compile
		// that failed on a half-typed link is exactly the one worth redoing.
		const second = flight()

		runner.release(0)
		await expect(first).rejects.toThrow("run 0 failed")
		expect(runner.started).toBe(2)

		runner.release(1)
		expect(await second).toBe(1)

		// Not wedged: a later trigger still starts a run.
		const third = flight()
		runner.release(2)
		expect(await third).toBe(2)
		expect(runner.peak).toBe(1)
	})

	test("a synchronous throw is a rejection, not an escape", async () => {
		const flight = createSingleFlight((() => {
			throw new Error("boom")
		}) as () => Promise<never>)

		await expect(flight()).rejects.toThrow("boom")
		// And the flight is still usable afterwards.
		await expect(flight()).rejects.toThrow("boom")
	})
})
