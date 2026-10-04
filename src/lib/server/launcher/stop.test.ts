/**
 * A stop at any point in a boot ends in `requestShutdown` — promptly when
 * startup failed partway, after it finishes when it is running, and after a
 * bounded wait when it never settles.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { stopAfterStartup, type StopDeps } from "./stop"

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

function deps(appReady: Promise<void> | null, over: Partial<StopDeps> = {}) {
	const requestShutdown = vi.fn(async (_o: { reason: string; exitCode: number }) => {})
	const d: StopDeps = {
		loadStartup: async () => (appReady ? { appReady } : null),
		requestShutdown,
		maxStartupWaitMs: 60_000,
		...over
	}
	return { d, requestShutdown }
}

describe("stopAfterStartup", () => {
	test("startup that failed partway: stops at once", async () => {
		const failed = Promise.reject(new Error("db setup failed"))
		failed.catch(() => {})
		const { d, requestShutdown } = deps(failed)
		await stopAfterStartup({ reason: "SIGTERM", exitCode: 0 }, d)
		expect(requestShutdown).toHaveBeenCalledWith({ reason: "SIGTERM", exitCode: 0 })
	})

	test("no boot was ever started: stops at once", async () => {
		const { d, requestShutdown } = deps(null)
		await stopAfterStartup({ reason: "launcher", exitCode: 0 }, d)
		expect(requestShutdown).toHaveBeenCalledTimes(1)
	})

	test("startup still running: waits for it, then stops", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		let finish!: () => void
		const running = new Promise<void>((r) => (finish = r))
		const { d, requestShutdown } = deps(running)
		const stopping = stopAfterStartup({ reason: "launcher", exitCode: 0 }, d)
		await new Promise((r) => setTimeout(r, 10))
		expect(requestShutdown).not.toHaveBeenCalled()
		finish()
		await stopping
		expect(requestShutdown).toHaveBeenCalledTimes(1)
	})

	test("startup that never settles: stops after the bounded wait", async () => {
		vi.useFakeTimers()
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const { d, requestShutdown } = deps(new Promise<void>(() => {}), { maxStartupWaitMs: 5_000 })
		const stopping = stopAfterStartup({ reason: "SIGTERM", exitCode: 0 }, d)
		await vi.advanceTimersByTimeAsync(4_999)
		expect(requestShutdown).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await stopping
		expect(requestShutdown).toHaveBeenCalledTimes(1)
	})

	test("a startup module that cannot load does not block the stop", async () => {
		const { d, requestShutdown } = deps(null, {
			loadStartup: async () => {
				throw new Error("chunk failed")
			}
		})
		await stopAfterStartup({ reason: "launcher", exitCode: 0 }, d)
		expect(requestShutdown).toHaveBeenCalledTimes(1)
	})
})
