/**
 * `core:event/schedule-tick@1` is emitted: hourly, on the hour's grid, only to
 * a subscribed listener, through the event registry — and never again once
 * stopped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SCHEDULED_WORK_PATH } from "@serene-pub/sdk"
import { PluginEventRegistry } from "./eventHost"
import type { SandboxManager } from "./SandboxManager"
import {
	SCHEDULE_TICK_EVENT,
	SCHEDULE_TICK_INTERVAL_MS,
	startScheduleTick
} from "./scheduleTick"

const HOUR = 60 * 60 * 1000

/** A manager that records what each subscriber was called with. */
function recordingManager() {
	const calls: Array<{ pluginId: string; hook: string; input: any; opts: any }> = []
	const mgr = {
		callHook: async (pluginId: string, hook: string, input: unknown, opts: unknown) => {
			calls.push({ pluginId, hook, input, opts })
			return { ok: true, value: {} }
		}
	} as unknown as SandboxManager
	return { mgr, calls }
}

describe("the schedule tick", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-10-02T13:20:00.000Z"))
	})
	afterEach(() => vi.useRealTimers())

	it("is the event the SDK sends scheduled work to, hourly", () => {
		expect(SCHEDULE_TICK_EVENT).toBe(SCHEDULED_WORK_PATH.instead)
		expect(SCHEDULE_TICK_EVENT).toBe("core:event/schedule-tick@1")
		expect(SCHEDULE_TICK_INTERVAL_MS).toBe(HOUR)
	})

	it("delivers on the hour to a subscriber, through the registry", async () => {
		const registry = new PluginEventRegistry()
		registry.replace([
			{ pluginId: "acme.nightly", event: SCHEDULE_TICK_EVENT, hookName: "onTick", timeoutMs: 250, index: 0 }
		])
		const { mgr, calls } = recordingManager()
		const stop = startScheduleTick({
			subscribers: () => registry.subscribers(SCHEDULE_TICK_EVENT).length,
			notify: (payload, nowMs) => registry.notify(mgr, SCHEDULE_TICK_EVENT, payload, { nowMs })
		})

		await vi.advanceTimersByTimeAsync(39 * 60 * 1000)
		expect(calls).toHaveLength(0)
		await vi.advanceTimersByTimeAsync(60 * 1000)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({
			pluginId: "acme.nightly",
			hook: "onTick",
			input: {
				event: SCHEDULE_TICK_EVENT,
				payload: { cadence: "hourly", scheduledFor: "2026-10-02T14:00:00.000Z", scope: "pub" }
			},
			opts: { kind: "event", nowMs: Date.parse("2026-10-02T14:00:00.000Z") }
		})

		await vi.advanceTimersByTimeAsync(HOUR)
		expect(calls.map((c) => c.input.payload.scheduledFor)).toEqual([
			"2026-10-02T14:00:00.000Z",
			"2026-10-02T15:00:00.000Z"
		])

		stop()
		await vi.advanceTimersByTimeAsync(3 * HOUR)
		expect(calls).toHaveLength(2)
	})

	it("emits nothing while nobody subscribes", async () => {
		const notify = vi.fn(async () => {})
		const stop = startScheduleTick({ subscribers: () => 0, notify })
		await vi.advanceTimersByTimeAsync(5 * HOUR)
		expect(notify).not.toHaveBeenCalled()
		stop()
	})

	it("a failing delivery does not stop the next tick", async () => {
		const notify = vi.fn(async () => {
			throw new Error("boom")
		})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const stop = startScheduleTick({ subscribers: () => 1, notify, intervalMs: 1000 })
		await vi.advanceTimersByTimeAsync(3000)
		// Due at 0 (now is on the grid), 1, 2 and 3 seconds.
		expect(notify).toHaveBeenCalledTimes(4)
		stop()
		warn.mockRestore()
	})
})
