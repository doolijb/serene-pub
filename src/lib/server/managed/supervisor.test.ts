import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { spawn } from "child_process"
import * as fs from "fs"
import * as net from "net"
import * as os from "os"
import * as path from "path"
import {
	createSupervisor,
	type Supervisor,
	type SupervisorSpec,
	type SupervisorStatusEvent
} from "./supervisor"
import { spawnWatchdog, WATCHDOG_FILE_NAME } from "./watchdog"

// A REAL child process, no mocks: the factory's whole job is process
// handling, and the fakes in subprocessManager.test.ts cannot show that a
// signal reaches a group or that a pid file names a live process.
const SCRIPT = `#!/usr/bin/env node
const http = require("http")
const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf("--port") + 1])
const sleep = Number(process.env.FAKE_SLEEP_MS || 0)
if (argv.includes("--ignore-term")) process.on("SIGTERM", () => {})
const server = http.createServer((req, res) => {
	res.statusCode = req.url === "/health" ? 200 : 404
	res.end("ok")
})
setTimeout(() => server.listen(port, "127.0.0.1"), sleep)
`

let root: string
const supervisors: Supervisor[] = []
const strayPids: number[] = []
let seq = 0

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-supervisor-"))
})

afterEach(async () => {
	for (const s of supervisors.splice(0)) {
		try {
			await s.stop()
		} catch {}
	}
	for (const pid of strayPids.splice(0)) {
		try {
			process.kill(-pid, "SIGKILL")
		} catch {}
	}
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer()
		srv.once("error", reject)
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address() as net.AddressInfo
			srv.close(() => resolve(port))
		})
	})
}

async function pingHealth(baseUrl: string, timeoutMs: number) {
	try {
		const r = await fetch(`${baseUrl}/health`, {
			signal: AbortSignal.timeout(timeoutMs)
		})
		return r.ok
	} catch {
		return false
	}
}

async function makeEnv(extraArgs: string[] = []) {
	const dir = fs.mkdtempSync(path.join(root, "bin-"))
	const bin = path.join(dir, "fakesvc")
	fs.writeFileSync(bin, SCRIPT)
	fs.chmodSync(bin, 0o755)
	const port = await freePort()
	const id = `test-${process.pid}-${++seq}`
	const pidFile = path.join(dir, ".fake.pid")
	const spec: SupervisorSpec = {
		id,
		label: "Fake",
		binaryPath: async () => bin,
		args: async () => ["--port", String(port), ...extraArgs],
		port: async () => port,
		ping: pingHealth,
		pidFileName: ".fake.pid"
	}
	return { dir, bin, port, id, pidFile, spec }
}

function make(spec: SupervisorSpec): Supervisor {
	const s = createSupervisor(spec)
	supervisors.push(s)
	return s
}

const T = 20_000

describe.skipIf(process.platform !== "linux")("createSupervisor", () => {
	test(
		"start reaches running, writes the pid file and emits status",
		async () => {
			const env = await makeEnv()
			const sup = make(env.spec)
			const seen: SupervisorStatusEvent[] = []
			sup.registerEmitter(1, (e) => seen.push(e))

			await sup.start()

			const st = sup.getStatus()
			expect(st.status).toBe("running")
			expect(st.pid).toBeGreaterThan(0)
			expect(sup.isRunning()).toBe(true)
			expect(fs.readFileSync(env.pidFile, "utf8")).toBe(String(st.pid))
			expect(seen.map((e) => e.status)).toEqual(["starting", "running"])
			expect(await pingHealth(`http://127.0.0.1:${env.port}`, 2000)).toBe(true)
		},
		T
	)

	test(
		"concurrent start() calls spawn once",
		async () => {
			const env = await makeEnv()
			const sup = make(env.spec)
			await Promise.all([sup.start(), sup.start()])
			expect(sup.getStatus().restartCount).toBe(1)
			expect(sup.getStatus().status).toBe("running")
		},
		T
	)

	test(
		"stop ends the process, removes the pid file and settles stopped",
		async () => {
			const env = await makeEnv()
			const sup = make(env.spec)
			await sup.start()
			const pid = sup.getStatus().pid!

			await sup.stop()

			expect(sup.getStatus().status).toBe("stopped")
			expect(sup.getStatus().pid).toBeNull()
			expect(fs.existsSync(env.pidFile)).toBe(false)
			expect(() => process.kill(pid, 0)).toThrow()
		},
		T
	)

	test(
		"stop escalates to SIGKILL when SIGTERM is ignored",
		async () => {
			const env = await makeEnv(["--ignore-term"])
			const sup = make({ ...env.spec, stopGraceMs: 400 })
			await sup.start()
			const pid = sup.getStatus().pid!

			const t0 = Date.now()
			await sup.stop()

			expect(Date.now() - t0).toBeGreaterThanOrEqual(350)
			expect(sup.getStatus().status).toBe("stopped")
			await new Promise((r) => setTimeout(r, 200))
			expect(() => process.kill(pid, 0)).toThrow()
		},
		T
	)

	test(
		"the boot sweep kills our own process from a previous session and clears its pid file",
		async () => {
			const env = await makeEnv()
			const child = spawn(env.bin, ["--port", String(env.port)], {
				detached: true,
				stdio: "ignore"
			})
			child.unref()
			strayPids.push(child.pid!)
			fs.writeFileSync(env.pidFile, String(child.pid))
			await waitFor(() => pingHealth(`http://127.0.0.1:${env.port}`, 500))

			const sup = make(env.spec)
			await sup.checkForOrphanOnBoot()

			// Nothing adopted: the sweep only reaps.
			expect(sup.getStatus().status).toBe("stopped")
			expect(sup.getStatus().pid).toBeNull()
			expect(() => process.kill(child.pid!, 0)).toThrow()
			expect(fs.existsSync(env.pidFile)).toBe(false)
		},
		T
	)

	test(
		"start() replaces our own leftover process instead of adopting it",
		async () => {
			const env = await makeEnv()
			const child = spawn(env.bin, ["--port", String(env.port)], {
				detached: true,
				stdio: "ignore"
			})
			child.unref()
			strayPids.push(child.pid!)
			fs.writeFileSync(env.pidFile, String(child.pid))
			await waitFor(() => pingHealth(`http://127.0.0.1:${env.port}`, 500))

			const sup = make(env.spec)
			await sup.start()

			expect(sup.getStatus().status).toBe("running")
			expect(sup.getStatus().pid).not.toBe(child.pid)
			expect(() => process.kill(child.pid!, 0)).toThrow()
		},
		T
	)

	test(
		"start() refuses a port held by a process that is not ours, in words",
		async () => {
			const env = await makeEnv()
			const child = spawn(env.bin, ["--port", String(env.port)], {
				detached: true,
				stdio: "ignore"
			})
			child.unref()
			strayPids.push(child.pid!)
			await waitFor(() => pingHealth(`http://127.0.0.1:${env.port}`, 500))

			const sup = make(env.spec)
			await expect(sup.start()).rejects.toThrow(
				`Port ${env.port} is already in use by a program Serene Pub didn't start`
			)

			expect(sup.getStatus().status).toBe("crashed")
			expect(sup.getStatus().lastError).toMatch(/Stop it, or change the port/)
			// The stranger is untouched.
			expect(() => process.kill(child.pid!, 0)).not.toThrow()
		},
		T
	)

	test(
		"a pid file naming a recycled pid that runs something else is left alone",
		async () => {
			const env = await makeEnv()
			// A live process that is not our binary.
			const other = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"], {
				detached: true,
				stdio: "ignore"
			})
			other.unref()
			strayPids.push(other.pid!)
			fs.writeFileSync(env.pidFile, String(other.pid))

			const sup = make(env.spec)
			await sup.checkForOrphanOnBoot()

			expect(() => process.kill(other.pid!, 0)).not.toThrow()
			// The file stays too: it was not ours to clear on a guess.
			expect(fs.existsSync(env.pidFile)).toBe(true)
		},
		T
	)

	test(
		"a watchdog is written beside the pid file and ends the child when core dies",
		async () => {
			const env = await makeEnv()
			const sup = make(env.spec)
			await sup.start()
			const pid = sup.getStatus().pid!
			expect(fs.existsSync(path.join(env.dir, WATCHDOG_FILE_NAME))).toBe(true)

			// Stand in for core: a process the watchdog takes for us.
			const fakeCore = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"], {
				stdio: "ignore"
			})
			strayPids.push(fakeCore.pid!)
			const dog = await spawnWatchdog(env.dir, pid, "Fake", {
				corePid: fakeCore.pid!
			})
			expect(dog.pid).toBeGreaterThan(0)
			strayPids.push(dog.pid!)
			await new Promise((r) => setTimeout(r, 1200))
			expect(() => process.kill(pid, 0)).not.toThrow()

			fakeCore.kill("SIGKILL")
			await waitFor(async () => {
				try {
					process.kill(pid, 0)
					return false
				} catch {
					return true
				}
			})
			// The watchdog leaves once its work is done.
			await waitFor(async () => {
				try {
					process.kill(dog.pid!, 0)
					return false
				} catch {
					return true
				}
			})
			// The supervisor saw its child die out from under it.
			await waitFor(async () => sup.getStatus().status === "crashed")
		},
		T
	)

	test(
		"a stale starting with no process respawns on start()",
		async () => {
			const env = await makeEnv()
			const sup = make(env.spec)
			const bag = (globalThis as any)[
				`__SERENE_PUB_SUPERVISOR_${env.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}__`
			]
			bag.state.status = "starting"

			await sup.start()

			expect(sup.getStatus().status).toBe("running")
			expect(sup.getStatus().pid).toBeGreaterThan(0)
		},
		T
	)

	test(
		"supervisors with different ids keep independent state",
		async () => {
			const a = await makeEnv()
			const b = await makeEnv()
			const supA = make(a.spec)
			const supB = make(b.spec)

			await supA.start()

			expect(supA.getStatus().status).toBe("running")
			expect(supB.getStatus().status).toBe("stopped")
			expect(supB.getStatus().pid).toBeNull()
			await supB.start()
			expect(supA.getStatus().pid).not.toBe(supB.getStatus().pid)
			await supA.stop()
			expect(supB.getStatus().status).toBe("running")
		},
		T
	)
})

async function waitFor(fn: () => Promise<boolean>, ms = 10_000) {
	const end = Date.now() + ms
	while (Date.now() < end) {
		if (await fn()) return
		await new Promise((r) => setTimeout(r, 100))
	}
	throw new Error("waitFor timed out")
}
