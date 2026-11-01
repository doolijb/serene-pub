/**
 * `registerCoreServices` registers the `spokenRetention` service (speech build
 * L1), and its boot/shutdown hooks start and stop the hourly sweep timer.
 * Every heavy module register.ts imports is stubbed; only the registration
 * and the spokenRetention hooks are real.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

const stub = vi.hoisted(() => () => new Proxy({}, { get: (_t: unknown, k: string | symbol) => (k === 'then' ? undefined : () => undefined) }))
vi.mock("$lib/server/db", () => stub())
vi.mock("$lib/server/plugins", () => stub())
vi.mock("$lib/server/tunnels/supervisor", () => stub())
vi.mock("./dailyBackup", () => stub())
vi.mock("$lib/server/sockets/localOnnxModels", () => stub())
vi.mock("$lib/server/notifications/service", () => stub())
vi.mock("$lib/server/attachments/tray", () => stub())
vi.mock("$lib/server/pipelines/routines/tick", () => stub())
vi.mock("$lib/server/koboldcpp/subprocessManager", () => stub())

afterEach(async () => {
	const m = await import("$lib/server/media/spokenRetention")
	m.stopSpokenRetention()
	vi.useRealTimers()
})

describe("services registry", () => {
	test("spokenRetention is registered; reconcileOnBoot starts one timer, shutdown stops it", async () => {
		const reg = await import("./index")
		const { registerCoreServices } = await import("./register")
		reg.clearRegisteredServices()
		await registerCoreServices()
		const svc = reg.getRegisteredServices().find((x) => x.id === "spokenRetention")
		expect(svc).toBeTruthy()
		vi.useFakeTimers()
		await svc!.reconcileOnBoot?.()
		expect(vi.getTimerCount()).toBe(1)
		await svc!.shutdown?.()
		expect(vi.getTimerCount()).toBe(0)
		reg.clearRegisteredServices()
	})
})
