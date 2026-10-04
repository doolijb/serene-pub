/**
 * The managed-services registry (see index.ts for why it exists).
 *
 * The behaviour worth pinning is failure isolation in both directions: one
 * service that cannot recover must not stop the others from recovering, and one
 * that hangs on shutdown must not hold the process open past the deadline.
 * Both were possible before, when each manager owned its own signal handler and
 * whichever finished first called process.exit().
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	clearRegisteredServices,
	getRegisteredServices,
	reconcileServices,
	registerService,
	requestShutdown,
	shutdownServices
} from "./index"

afterEach(() => {
	clearRegisteredServices()
	vi.useRealTimers()
})

describe("registration", () => {
	test("keeps registration order and ignores a duplicate id", () => {
		registerService({ id: "a", label: "A" })
		registerService({ id: "b", label: "B" })
		// A module can be evaluated twice under HMR; that is not a fault.
		registerService({ id: "a", label: "A again" })

		expect(getRegisteredServices().map((s) => s.id)).toEqual(["a", "b"])
		expect(getRegisteredServices()[0].label).toBe("A")
	})
})

describe("reconcileServices", () => {
	test("runs every service in registration order", async () => {
		const order: string[] = []
		registerService({
			id: "first",
			label: "First",
			reconcileOnBoot: async () => {
				order.push("first")
			}
		})
		registerService({
			id: "second",
			label: "Second",
			reconcileOnBoot: async () => {
				order.push("second")
			}
		})

		await reconcileServices()
		expect(order).toEqual(["first", "second"])
	})

	test("one service failing to recover does not stop the others", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const ran: string[] = []
		registerService({
			id: "broken",
			label: "Broken",
			reconcileOnBoot: async () => {
				throw new Error("cannot recover")
			}
		})
		registerService({
			id: "fine",
			label: "Fine",
			reconcileOnBoot: async () => {
				ran.push("fine")
			}
		})

		// An instance that cannot restore its tunnel must still serve sessions.
		await expect(reconcileServices()).resolves.toBeUndefined()
		expect(ran).toEqual(["fine"])
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
	})

	test("a service with no reconcileOnBoot is simply skipped", async () => {
		registerService({ id: "inert", label: "Inert" })
		await expect(reconcileServices()).resolves.toBeUndefined()
	})
})

describe("shutdownServices", () => {
	test("stops services in reverse registration order", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const order: string[] = []
		// The database registers first precisely so it closes last: other
		// services write to it on their way out.
		registerService({
			id: "database",
			label: "Database",
			shutdown: async () => {
				order.push("database")
			}
		})
		registerService({
			id: "tunnels",
			label: "Tunnel",
			shutdown: async () => {
				order.push("tunnels")
			}
		})

		await shutdownServices("SIGTERM")
		expect(order).toEqual(["tunnels", "database"])
		log.mockRestore()
	})

	test("stops every service, and a thrown error does not skip the rest", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const err = vi.spyOn(console, "error").mockImplementation(() => {})
		const stopped: string[] = []
		registerService({
			id: "angry",
			label: "Angry",
			shutdown: async () => {
				throw new Error("refused to stop")
			}
		})
		registerService({
			id: "polite",
			label: "Polite",
			shutdown: async () => {
				stopped.push("polite")
			}
		})

		await shutdownServices("SIGTERM")
		expect(stopped).toEqual(["polite"])
		expect(err).toHaveBeenCalled()
		log.mockRestore()
		err.mockRestore()
	})

	test("is once-only, so a second signal cannot restart a teardown in flight", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const shutdown = vi.fn(async () => {})
		registerService({ id: "once", label: "Once", shutdown })

		await shutdownServices("SIGINT")
		await shutdownServices("SIGINT")

		expect(shutdown).toHaveBeenCalledTimes(1)
		log.mockRestore()
	})

	test("returns at the deadline rather than waiting on a service that hangs", async () => {
		vi.useFakeTimers()
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		let released = false
		registerService({
			id: "hung",
			label: "Hung",
			// Never resolves — a container runtime will SIGKILL us shortly
			// after regardless, and that path leaves the orphan that boot
			// reconciliation then has to clean up.
			shutdown: () => new Promise<void>(() => {})
		})

		const pending = shutdownServices("SIGTERM").then(() => {
			released = true
		})
		await vi.advanceTimersByTimeAsync(10_000)
		await pending

		expect(released).toBe(true)
		expect(warn).toHaveBeenCalled()
		log.mockRestore()
		warn.mockRestore()
	})
})

describe("requestShutdown", () => {
	test("stops every service, then exits with the code asked for", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const order: string[] = []
		registerService({
			id: "database",
			label: "Database",
			shutdown: async () => {
				order.push("database")
			}
		})
		const exit = vi.fn((code: number) => {
			order.push(`exit ${code}`)
		})

		await requestShutdown({ reason: "update", exitCode: 75, exit })
		expect(order).toEqual(["database", "exit 75"])
		log.mockRestore()
	})

	test("exits at once when nothing is registered (the services task never ran)", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const exit = vi.fn()
		await requestShutdown({ reason: "launcher", exitCode: 0, exit })
		expect(exit).toHaveBeenCalledWith(0)
		log.mockRestore()
	})

	test("joins a teardown already running instead of cutting it short", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		let finish!: () => void
		const stopped: string[] = []
		registerService({
			id: "slow",
			label: "Slow",
			shutdown: () =>
				new Promise<void>((resolve) => {
					finish = () => {
						stopped.push("slow")
						resolve()
					}
				})
		})
		const exit = vi.fn()
		const signal = shutdownServices("SIGTERM")
		const asked = requestShutdown({ reason: "launcher", exitCode: 0, exit })
		await Promise.resolve()
		expect(exit).not.toHaveBeenCalled()
		finish()
		await signal
		await asked
		expect(stopped).toEqual(["slow"])
		expect(exit).toHaveBeenCalledTimes(1)
		log.mockRestore()
	})

	test("a second request does not exit twice or run the teardown again", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const shutdown = vi.fn(async () => {})
		registerService({ id: "once", label: "Once", shutdown })
		const exit = vi.fn()
		await Promise.all([
			requestShutdown({ reason: "launcher", exitCode: 0, exit }),
			requestShutdown({ reason: "update", exitCode: 75, exit })
		])
		expect(shutdown).toHaveBeenCalledTimes(1)
		expect(exit).toHaveBeenCalledTimes(1)
		expect(exit).toHaveBeenCalledWith(0)
		log.mockRestore()
	})
})
