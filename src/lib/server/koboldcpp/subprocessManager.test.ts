import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { spawn } from "child_process"
import { EventEmitter } from "events"
import * as fs from "fs"
import * as fsPromises from "fs/promises"

// Minimal db mock — doStart()'s gating check is the only thing these tests
// exercise, and it only ever touches db.query.koboldCppSettings.findFirst().
// update() is also mocked for the password-regeneration test below (Round-7
// audit fix): a missing koboldCppManagedAdminPassword must be regenerated
// and persisted, not silently fall back to a shared literal.
const findFirstMock = vi.fn()
const updateSetMock = vi.fn()
vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			koboldCppSettings: {
				findFirst: () => findFirstMock()
			}
		},
		update: () => ({
			set: (values: any) => {
				updateSetMock(values)
				return { where: async () => {} }
			}
		})
	}
}))

vi.mock("child_process", () => ({
	spawn: vi.fn()
}))

const pingKoboldCPPMock = vi.fn().mockResolvedValue(false)
vi.mock("./kcppHttp", () => ({
	pingKoboldCPP: (...args: any[]) => pingKoboldCPPMock(...args)
}))

vi.mock("fs/promises", async () => {
	const actual =
		await vi.importActual<typeof import("fs/promises")>("fs/promises")
	return {
		...actual,
		readFile: vi.fn(),
		writeFile: vi.fn().mockResolvedValue(undefined),
		unlink: vi.fn().mockResolvedValue(undefined),
		access: vi.fn().mockResolvedValue(undefined),
		chmod: vi.fn().mockResolvedValue(undefined)
	}
})

const readFileSyncMock = vi.fn()
vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actual,
		default: actual,
		readFileSync: (...args: any[]) => readFileSyncMock(...args)
	}
})

import {
	start,
	stop,
	checkForOrphanOnBoot,
	getStatus,
	isExternal,
	isRunning
} from "./subprocessManager"

/** A fake ChildProcess: enough of the shape doStart()/stop() actually touch
 * (stdout/stderr streams, pid, exitCode, killed, .on()/.once(), .kill()) to
 * drive the real spawn path without a real subprocess. */
function makeFakeChild(pid = 12345) {
	const child: any = new EventEmitter()
	child.pid = pid
	child.exitCode = null
	child.killed = false
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.kill = vi.fn((signal?: string) => {
		child.killed = true
		child.exitCode = 0
		child.emit("exit", 0, signal ?? null)
		return true
	})
	return child
}

const REAL_SETTINGS_BASE = {
	koboldCppManagerEnabled: true,
	koboldCppManagedMode: "managed" as const,
	koboldCppManagedBinaryDir: "/opt/koboldcpp",
	koboldCppManagedBinaryVariant: "koboldcpp-linux",
	koboldCppManagedPort: 5001,
	koboldCppManagedAdminPassword: "pw",
	koboldCppManagedSubprocessTimeoutSecs: 0
}

// Several tests below use vi.spyOn(process, "kill"/"readFileSync") — restore
// those (not the vi.mock() module factories above, which aren't affected by
// this) after every test so a spy from one test never leaks into the next.
afterEach(() => {
	vi.restoreAllMocks()
})

describe("subprocessManager.start — managed-mode gating", () => {
	beforeEach(() => {
		findFirstMock.mockReset()
		vi.mocked(spawn).mockClear()
	})

	test("refuses to start when the manager isn't enabled at all", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: false,
			koboldCppManagedMode: "managed"
		})
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test('refuses to start when mode is "external" even if the manager is enabled', async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: "external"
		})
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("refuses to start when mode is unset (null)", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: null
		})
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("refuses to start when there's no settings row at all", async () => {
		findFirstMock.mockResolvedValue(undefined)
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("a properly enabled + managed config passes this gate (fails later, on binary configuration, instead)", async () => {
		// Positive control: confirms the gate isn't over-matching (e.g.
		// accidentally rejecting every config regardless of these two
		// fields) — a valid combination should get past THIS check and fail
		// on the next one (no binary configured) instead.
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: "managed",
			koboldCppManagedBinaryDir: null,
			koboldCppManagedBinaryVariant: null
		})
		await expect(start()).rejects.toThrow("Binary not configured")
		expect(spawn).not.toHaveBeenCalled()
	})
})

/** Each test below gets a fully fresh module instance — this module keeps
 * top-level mutable state (the spawned process, pid, status) that isn't
 * exported for reset, and these tests (unlike the gating tests above)
 * actually drive it into "running"/"stopped" states that must not leak
 * between tests. */
// The module registers process-level "exit"/SIGINT/SIGTERM handlers as a
// side effect of being imported (see subprocessManager.ts's top-level
// process.on(...) calls). Re-importing it fresh per test would otherwise
// pile up a new set of these on the real, shared `process` object every
// single time — never cleaned up, eventually tripping Node's own
// MaxListenersExceededWarning and leaking into whatever test file runs
// next in this worker. Snapshot before import and strip whatever this
// particular import just added once the module reference is captured.
async function freshImport() {
	const proc = process as any
	const before: Record<string, any[]> = {
		exit: proc.listeners("exit"),
		SIGINT: proc.listeners("SIGINT"),
		SIGTERM: proc.listeners("SIGTERM")
	}
	vi.resetModules()
	const mod = await import("./subprocessManager")
	for (const event of ["exit", "SIGINT", "SIGTERM"]) {
		for (const listener of proc.listeners(event)) {
			if (!before[event].includes(listener)) {
				proc.removeListener(event, listener)
			}
		}
	}
	return mod
}

describe("subprocessManager — adopting an already-running instance", () => {
	beforeEach(() => {
		findFirstMock.mockReset()
		pingKoboldCPPMock.mockReset()
		vi.mocked(spawn).mockClear()
		vi.mocked(fsPromises.readFile).mockReset()
		readFileSyncMock.mockReset()
	})

	test("start() adopts a verified-owned process from a previous session without spawning a new one", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockResolvedValue(true) // already responding
		vi.mocked(fsPromises.readFile).mockResolvedValue("9999")
		readFileSyncMock.mockReturnValue("koboldcpp-linux --host 127.0.0.1")
		vi.spyOn(process, "kill").mockImplementation(() => true as any) // pid 9999 "alive"

		await sm.start()

		expect(spawn).not.toHaveBeenCalled()
		expect(sm.isRunning()).toBe(true)
		expect(sm.isExternal()).toBe(false)
		expect(sm.getStatus().pid).toBe(9999)
	})

	test("start() adopts an already-running instance as external when it can't verify ownership", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockResolvedValue(true)
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)

		await sm.start()

		expect(spawn).not.toHaveBeenCalled()
		expect(sm.isRunning()).toBe(true)
		expect(sm.isExternal()).toBe(true)
		expect(sm.getStatus().pid).toBeNull()
	})
})

describe("subprocessManager.checkForOrphanOnBoot", () => {
	beforeEach(() => {
		findFirstMock.mockReset()
		pingKoboldCPPMock.mockReset()
		vi.mocked(fsPromises.readFile).mockReset()
	})

	test("does nothing when the manager isn't in managed mode", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: "external"
		})
		await sm.checkForOrphanOnBoot()
		expect(pingKoboldCPPMock).not.toHaveBeenCalled()
		expect(sm.isRunning()).toBe(false)
	})

	test("does nothing when the manager is disabled entirely", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: false,
			koboldCppManagedMode: "managed"
		})
		await sm.checkForOrphanOnBoot()
		expect(pingKoboldCPPMock).not.toHaveBeenCalled()
	})

	// The startup module re-runs its tasks on every dev re-evaluation, and this
	// check is one of them. Re-adopting a process that is already tracked
	// re-stamped `startedAt` — the card's uptime jumped back to zero on a
	// process minutes old — and restarted the health check for no change.
	test("is a no-op for a process this evaluation already tracks", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockResolvedValue(true)
		vi.mocked(fsPromises.readFile).mockResolvedValue("9999")
		readFileSyncMock.mockReturnValue("koboldcpp-linux --host 127.0.0.1")
		vi.spyOn(process, "kill").mockImplementation(() => true as any)

		await sm.start()
		const before = sm.getStatus()
		await new Promise((r) => setTimeout(r, 5))
		await sm.checkForOrphanOnBoot()

		expect(sm.getStatus().startedAt).toBe(before.startedAt)
		expect(sm.getStatus().pid).toBe(9999)
		expect(sm.isRunning()).toBe(true)
	})

	test("adopts an instance that's already responding, so status is accurate immediately at boot", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockResolvedValue(true)
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		await sm.checkForOrphanOnBoot()
		expect(sm.isRunning()).toBe(true)
	})

	test("silently no-ops when nothing is responding and there's no stale pidfile to clean up", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockResolvedValue(false)
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		await expect(sm.checkForOrphanOnBoot()).resolves.toBeUndefined()
		expect(sm.isRunning()).toBe(false)
	})

	test("never throws even if settings lookup itself fails", async () => {
		const sm = await freshImport()
		findFirstMock.mockRejectedValue(new Error("db unavailable"))
		await expect(sm.checkForOrphanOnBoot()).resolves.toBeUndefined()
	})
})

describe("subprocessManager.stop", () => {
	beforeEach(() => {
		findFirstMock.mockReset()
		pingKoboldCPPMock.mockReset()
		vi.mocked(fsPromises.readFile).mockReset()
	})

	test("is a no-op when nothing is tracked as running", async () => {
		const sm = await freshImport()
		await expect(sm.stop()).resolves.toBeUndefined()
		expect(sm.getStatus().status).toBe("stopped")
	})

	test("refuses to stop an adopted-but-unverified external instance", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockResolvedValue(true)
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		await sm.start()
		expect(sm.isExternal()).toBe(true)

		await expect(sm.stop()).rejects.toThrow(/wasn't started by/)
	})

	test("terminates a process this session actually spawned", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // doStart()'s adopt check: nothing there yet
			.mockResolvedValueOnce(true) // waitForReady: subprocess came up
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		) // killStaleOrphan: nothing to clean
		const child = makeFakeChild(54321)
		vi.mocked(spawn).mockReturnValue(child as any)
		// stop() signals the process GROUP directly via the real process.kill
		// (not child.kill()) and waits for the child's own "exit" event —
		// simulate a well-behaved process that dies promptly on SIGTERM,
		// rather than waiting out the real 10s force-kill fallback.
		const killSpy = vi
			.spyOn(process, "kill")
			.mockImplementation((pid: any, signal?: any) => {
				if (Math.abs(pid) === child.pid) {
					queueMicrotask(() => child.emit("exit", 0, signal))
				}
				return true
			})

		await sm.start()
		expect(sm.isRunning()).toBe(true)

		await sm.stop()
		expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM")
		expect(sm.getStatus().status).toBe("stopped")
	})
})

describe("subprocessManager.start — admin password fallback (Round-7 audit fix)", () => {
	beforeEach(() => {
		findFirstMock.mockReset()
		pingKoboldCPPMock.mockReset()
		vi.mocked(fsPromises.readFile).mockReset()
		vi.mocked(spawn).mockClear()
		updateSetMock.mockClear()
	})

	test('generates and persists a fresh password instead of falling back to the literal "serene"', async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({
			...REAL_SETTINGS_BASE,
			koboldCppManagedAdminPassword: null
		})
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // doStart()'s adopt check: nothing there yet
			.mockResolvedValueOnce(true) // waitForReady: subprocess came up
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		const child = makeFakeChild(54322)
		vi.mocked(spawn).mockReturnValue(child as any)
		vi.spyOn(process, "kill").mockImplementation(() => true as any)

		await sm.start()

		// A password was generated and persisted back to the settings row —
		// not silently left unset for the next restart to fall back again.
		expect(updateSetMock).toHaveBeenCalledTimes(1)
		const persistedPassword =
			updateSetMock.mock.calls[0][0].koboldCppManagedAdminPassword
		expect(persistedPassword).toMatch(/^[0-9a-f]{32}$/)
		expect(persistedPassword).not.toBe("serene")

		// The same freshly generated password is what the subprocess was
		// actually spawned with.
		const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
		const pwIndex = spawnArgs.indexOf("--adminpassword")
		expect(pwIndex).toBeGreaterThanOrEqual(0)
		expect(spawnArgs[pwIndex + 1]).toBe(persistedPassword)
	})

	test("does not regenerate or persist a password when one is already set", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true)
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		const child = makeFakeChild(54323)
		vi.mocked(spawn).mockReturnValue(child as any)
		vi.spyOn(process, "kill").mockImplementation(() => true as any)

		await sm.start()

		expect(updateSetMock).not.toHaveBeenCalled()
		const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
		const pwIndex = spawnArgs.indexOf("--adminpassword")
		expect(spawnArgs[pwIndex + 1]).toBe(
			REAL_SETTINGS_BASE.koboldCppManagedAdminPassword
		)
	})

	// Bugfix: without --jinja, koboldcpp renders /v1/chat/completions through
	// its own generic built-in formatter instead of the loaded model's real
	// chat template (which it already auto-extracts from the GGUF on every
	// load) — silently disabling any model-specific template behavior (eg.
	// Gemma 4's enable_thinking token), regardless of what this app sends in
	// the request body. Note this alone isn't sufficient for it to persist
	// past the first model load — see modelManager.test.ts's companion test,
	// since koboldcpp's own admin reload_config resets it back out unless
	// it's also in the .kcpps file.
	test("spawns koboldcpp with --jinja so it renders the model's real chat template", async () => {
		const sm = await freshImport()
		findFirstMock.mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true)
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		const child = makeFakeChild(54324)
		vi.mocked(spawn).mockReturnValue(child as any)
		vi.spyOn(process, "kill").mockImplementation(() => true as any)

		await sm.start()

		const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
		expect(spawnArgs).toContain("--jinja")
	})
})

/**
 * The first "Download & Start" that never started (owner report 2026-10-05):
 * the auto-start exec'ed a binary whose download stream was not yet closed,
 * and Node THREW `spawn ETXTBSY` synchronously — after status had been set to
 * "starting" and with nothing to catch it. Status stayed "starting" with no
 * process and no lastError, every later start() returned early on it, and only
 * a manual Stop (which resets a process-less state) recovered.
 */
describe("subprocessManager.start — a spawn that fails", () => {
	const textBusy = () =>
		Object.assign(new Error("spawn ETXTBSY"), {
			code: "ETXTBSY",
			errno: -26,
			syscall: "spawn"
		})

	beforeEach(() => {
		findFirstMock.mockReset().mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockReset().mockResolvedValue(false)
		vi.mocked(fsPromises.readFile).mockReset()
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		vi.mocked(spawn).mockReset()
		// Every failure path below signals a process GROUP by pid. These pids
		// are fake; the real process.kill must never see them.
		vi.spyOn(process, "kill").mockImplementation(() => true as any)
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.mocked(spawn).mockReset()
	})

	test("an ETXTBSY that never clears ends crashed with lastError set, and the next start() spawns", async () => {
		const sm = await freshImport()
		vi.mocked(spawn).mockImplementation(() => {
			throw textBusy()
		})

		await expect(sm.start()).rejects.toThrow("spawn ETXTBSY")

		// The first try plus three retries, then failStart — not "starting".
		expect(spawn).toHaveBeenCalledTimes(4)
		expect(sm.getStatus()).toMatchObject({
			status: "crashed",
			lastError: "spawn ETXTBSY",
			pid: null
		})

		const child = makeFakeChild(54330)
		vi.mocked(spawn)
			.mockReset()
			.mockReturnValue(child as any)
		pingKoboldCPPMock
			.mockReset()
			.mockResolvedValueOnce(false) // adopt check: nothing there
			.mockResolvedValueOnce(true) // waitForReady: came up

		await sm.start()

		expect(spawn).toHaveBeenCalledTimes(1)
		expect(sm.isRunning()).toBe(true)
		expect(sm.getStatus().lastError).toBeNull()
	})

	test("an ETXTBSY that clears on the retry starts normally", async () => {
		const sm = await freshImport()
		const child = makeFakeChild(54331)
		vi.mocked(spawn)
			.mockImplementationOnce(() => {
				throw textBusy()
			})
			.mockReturnValueOnce(child as any)
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // adopt check
			.mockResolvedValueOnce(true) // waitForReady

		await sm.start()

		expect(spawn).toHaveBeenCalledTimes(2)
		expect(sm.isRunning()).toBe(true)
		expect(sm.getStatus().pid).toBe(54331)
	})

	test("any other synchronous spawn error fails at once, without a retry", async () => {
		const sm = await freshImport()
		vi.mocked(spawn).mockImplementation(() => {
			throw Object.assign(new Error("spawn ENOEXEC"), { code: "ENOEXEC" })
		})

		await expect(sm.start()).rejects.toThrow("spawn ENOEXEC")

		expect(spawn).toHaveBeenCalledTimes(1)
		expect(sm.getStatus()).toMatchObject({
			status: "crashed",
			lastError: "spawn ENOEXEC"
		})
	})

	test("Stop pressed during an ETXTBSY retry wins: nothing is spawned after it", async () => {
		const sm = await freshImport()
		vi.mocked(spawn).mockImplementation(() => {
			throw textBusy()
		})

		const starting = sm.start()
		starting.catch(() => {})
		// Let doStart reach its first retry wait.
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
		await sm.stop()

		await expect(starting).rejects.toThrow(/cancelled/)
		expect(spawn).toHaveBeenCalledTimes(1)
		expect(sm.getStatus().status).toBe("stopped")
	})

	test('a stale "starting" with no process and nothing in flight respawns instead of returning', async () => {
		const sm = await freshImport()
		// What the uncaught throw left behind: "starting", no handle, no pid.
		const bag = (globalThis as any).__SERENE_PUB_KCPP_SUBPROCESS__
		bag.state.status = "starting"
		const child = makeFakeChild(54332)
		vi.mocked(spawn).mockReturnValue(child as any)
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // adopt check
			.mockResolvedValueOnce(true) // waitForReady

		await sm.start()

		expect(spawn).toHaveBeenCalledTimes(1)
		expect(sm.isRunning()).toBe(true)
	})

	test("an async spawn error (EACCES) fails the wait promptly, not at the ten-minute timeout", async () => {
		const sm = await freshImport()
		vi.useFakeTimers()
		// Node's shape for EACCES/ENOENT: spawn returns a child with no pid and
		// emits "error" on the next tick. The child never gets an exitCode.
		const child = makeFakeChild()
		child.pid = undefined
		vi.mocked(spawn).mockImplementation(() => {
			process.nextTick(() =>
				child.emit(
					"error",
					Object.assign(
						new Error(
							"spawn /opt/koboldcpp/koboldcpp-linux EACCES"
						),
						{ code: "EACCES" }
					)
				)
			)
			return child as any
		})

		let settled = false
		const starting = sm.start()
		starting.catch(() => {}).finally(() => (settled = true))
		// One poll interval — the old liveness check kept waiting for 10 min.
		await vi.advanceTimersByTimeAsync(2_500)

		expect(settled).toBe(true)
		await expect(starting).rejects.toThrow(/EACCES/)
		expect(sm.getStatus()).toMatchObject({
			status: "crashed",
			lastError: "spawn /opt/koboldcpp/koboldcpp-linux EACCES"
		})
	})
})

describe("subprocessManager.suspendHealthCheck — counted, not a flag", () => {
	beforeEach(() => {
		findFirstMock.mockReset().mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockReset()
		vi.mocked(fsPromises.readFile).mockReset()
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		vi.mocked(spawn).mockReset()
		vi.spyOn(process, "kill").mockImplementation(() => true as any)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("one of two concurrent loads finishing does not resume the health check under the other", async () => {
		const sm = await freshImport()
		vi.useFakeTimers()
		vi.mocked(spawn).mockReturnValue(makeFakeChild(54333) as any)
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // adopt check
			.mockResolvedValueOnce(true) // waitForReady
		await sm.start()
		expect(sm.isRunning()).toBe(true)
		// Every health-check ping from here on fails, as during a long load.
		pingKoboldCPPMock.mockResolvedValue(false)

		sm.suspendHealthCheck() // preflight A
		sm.suspendHealthCheck() // preflight B
		sm.resumeHealthCheck() // A's load is done; B's is not
		await vi.advanceTimersByTimeAsync(4 * 30_000)
		expect(sm.isRunning()).toBe(true)

		sm.resumeHealthCheck() // B's load is done
		await vi.advanceTimersByTimeAsync(3 * 30_000)
		expect(sm.getStatus().status).toBe("crashed")
	})
})

describe("subprocessManager — a Stop is a stop, and residency goes with the process", () => {
	beforeEach(() => {
		findFirstMock.mockReset().mockResolvedValue({ ...REAL_SETTINGS_BASE })
		pingKoboldCPPMock.mockReset().mockResolvedValue(false)
		vi.mocked(fsPromises.readFile).mockReset()
		vi.mocked(fsPromises.readFile).mockRejectedValue(
			new Error("no pidfile")
		)
		vi.mocked(spawn).mockReset()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	/** A child that dies promptly when its process group is signalled. */
	function killableChild(pid: number) {
		const child = makeFakeChild(pid)
		vi.spyOn(process, "kill").mockImplementation(
			(target: any, signal?: any) => {
				if (Math.abs(target) === pid && child.exitCode === null) {
					child.exitCode = 0
					queueMicrotask(() => child.emit("exit", null, signal))
				}
				return true
			}
		)
		return child
	}

	/** Pretend a model was loaded, the way modelManager records one. */
	function seedSignature() {
		;(globalThis as any).__SERENE_PUB_KCPP_MODELS__.loadedSignature = {
			resident: { text: { file: "/m/a.gguf" } },
			rawConfigJson: "{}"
		}
	}

	test("Stop while the start is still waiting for the port ends as stopped, with no error", async () => {
		const sm = await freshImport()
		vi.useFakeTimers()
		const child = killableChild(54401)
		vi.mocked(spawn).mockReturnValue(child as any)

		const starting = sm.start()
		starting.catch(() => {})
		// Spawned and polling a port that never answers.
		await vi.advanceTimersByTimeAsync(100)
		expect(sm.getStatus().status).toBe("starting")

		const stopping = sm.stop()
		await vi.advanceTimersByTimeAsync(5_000)
		await stopping
		await expect(starting).rejects.toThrow(/cancelled/)

		expect(sm.getStatus()).toMatchObject({
			status: "stopped",
			lastError: null
		})
	})

	test("a stop forgets what was loaded", async () => {
		const sm = await freshImport()
		const { getLoadedSignature } = await import("./modelManager")
		const child = killableChild(54402)
		vi.mocked(spawn).mockReturnValue(child as any)
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // adopt check
			.mockResolvedValueOnce(true) // waitForReady
		await sm.start()
		seedSignature()
		expect(getLoadedSignature()).not.toBeNull()

		await sm.stop()
		expect(getLoadedSignature()).toBeNull()
	})

	test("a crash forgets what was loaded", async () => {
		const sm = await freshImport()
		const { getLoadedSignature } = await import("./modelManager")
		const child = makeFakeChild(54403)
		vi.mocked(spawn).mockReturnValue(child as any)
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // adopt check
			.mockResolvedValueOnce(true) // waitForReady
		await sm.start()
		seedSignature()

		child.exitCode = 1
		child.emit("exit", 1, null)
		expect(sm.getStatus().status).toBe("crashed")
		expect(getLoadedSignature()).toBeNull()
	})

	test("a fresh start forgets what the previous process held", async () => {
		const sm = await freshImport()
		const { getLoadedSignature } = await import("./modelManager")
		seedSignature()
		vi.spyOn(process, "kill").mockImplementation(() => true as any)
		vi.mocked(spawn).mockReturnValue(makeFakeChild(54404) as any)
		pingKoboldCPPMock
			.mockResolvedValueOnce(false) // adopt check
			.mockResolvedValueOnce(true) // waitForReady
		await sm.start()
		expect(getLoadedSignature()).toBeNull()
	})
})
