import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectionTimeoutService } from "./connectionTimeout"

const HOUR = 60 * 60 * 1000

describe("connection timeout", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.spyOn(console, "log").mockImplementation(() => {})
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("a reset inside the 30 s wait cancels the reconnect announcement", () => {
		const service = new ConnectionTimeoutService()
		const onReconnectAvailable = vi.fn()
		service.startTimeout(() => {}, onReconnectAvailable)
		vi.advanceTimersByTime(HOUR)
		expect(service.isTimedOut()).toBe(true)
		service.reset()
		vi.advanceTimersByTime(30_000)
		expect(onReconnectAvailable).not.toHaveBeenCalled()
		expect(service.canReconnectNow()).toBe(false)
	})

	it("a restart with the callbacks fires them on the next timeout", () => {
		const service = new ConnectionTimeoutService()
		const onTimeout = vi.fn()
		service.startTimeout(onTimeout, () => {})
		vi.advanceTimersByTime(HOUR)
		service.reset()
		service.startTimeout(onTimeout, () => {})
		vi.advanceTimersByTime(HOUR)
		expect(onTimeout).toHaveBeenCalledTimes(2)
		service.stopTimeout()
	})
})
