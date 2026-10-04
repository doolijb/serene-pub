/**
 * The tether between a node's clock and the host's request (`callTether.ts`):
 * aborts flow down — the run's cancel OR the node's timeout — and pulses flow
 * up, on a steady beat while the request is in flight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IN_FLIGHT_PULSE_MS, tether } from "./callTether"

const handlesWith = () => {
	const controller = new AbortController()
	const pulse = vi.fn()
	return { controller, handles: { signal: controller.signal, pulse } }
}

describe("tether — the signal", () => {
	it("aborts when the node's clock runs out", () => {
		const run = new AbortController()
		const { controller, handles } = handlesWith()
		const line = tether(handles, run.signal)
		expect(line.signal?.aborted).toBe(false)
		controller.abort()
		expect(line.signal?.aborted).toBe(true)
	})

	it("aborts when the run is cancelled", () => {
		const run = new AbortController()
		const { handles } = handlesWith()
		const line = tether(handles, run.signal)
		run.abort()
		expect(line.signal?.aborted).toBe(true)
	})

	it("without handles it is the run's own signal, and the pulse does nothing", () => {
		const run = new AbortController()
		const line = tether(undefined, run.signal)
		expect(line.signal).toBe(run.signal)
		expect(() => line.pulse()).not.toThrow()
	})

	it("with neither there is no signal at all", () => {
		expect(tether(undefined, undefined).signal).toBeUndefined()
	})
})

describe("tether — the pulse", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it("beats for as long as the request is in flight, and stops when it settles", async () => {
		const { handles } = handlesWith()
		const line = tether(handles, undefined)
		let finish!: (v: string) => void
		const held = line.hold(
			() => new Promise<string>((resolve) => (finish = resolve))
		)
		expect(handles.pulse).toHaveBeenCalledTimes(1) // on the way out
		await vi.advanceTimersByTimeAsync(IN_FLIGHT_PULSE_MS * 5)
		expect(handles.pulse).toHaveBeenCalledTimes(6)
		finish("done")
		await expect(held).resolves.toBe("done")
		await vi.advanceTimersByTimeAsync(IN_FLIGHT_PULSE_MS * 5)
		expect(handles.pulse).toHaveBeenCalledTimes(6)
	})

	it("stops beating when the request fails, and the failure is the caller's", async () => {
		const { handles } = handlesWith()
		const line = tether(handles, undefined)
		const held = line.hold(async () => {
			await new Promise((r) => setTimeout(r, IN_FLIGHT_PULSE_MS * 2))
			throw new Error("the service refused")
		})
		const settled = expect(held).rejects.toThrow("the service refused")
		await vi.advanceTimersByTimeAsync(IN_FLIGHT_PULSE_MS * 2)
		await settled
		const beats = handles.pulse.mock.calls.length
		await vi.advanceTimersByTimeAsync(IN_FLIGHT_PULSE_MS * 5)
		expect(handles.pulse).toHaveBeenCalledTimes(beats)
	})

	it("a pulse that throws never takes the request down", async () => {
		const line = tether(
			{
				signal: new AbortController().signal,
				pulse: () => {
					throw new Error("clock bookkeeping")
				}
			},
			undefined
		)
		expect(() => line.pulse()).not.toThrow()
		await expect(line.hold(async () => "ok")).resolves.toBe("ok")
	})
})
