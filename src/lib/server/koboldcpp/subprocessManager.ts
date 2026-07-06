import { spawn, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { db } from "$lib/server/db"

export type SubprocessStatus = "stopped" | "starting" | "running" | "crashed" | "stopping"

export interface SubprocessStatusEvent {
	status: SubprocessStatus
	pid: number | null
	startedAt: string | null
	lastError: string | null
	restartCount: number
}

interface SubprocessState {
	process: ChildProcess | null
	status: SubprocessStatus
	pid: number | null
	startedAt: Date | null
	lastError: string | null
	restartCount: number
}

const state: SubprocessState = {
	process: null,
	status: "stopped",
	pid: null,
	startedAt: null,
	lastError: null,
	restartCount: 0
}

let emitStatusFn: ((s: SubprocessStatusEvent) => void) | null = null
let healthInterval: ReturnType<typeof setInterval> | null = null

export function setEmitter(fn: (s: SubprocessStatusEvent) => void) {
	emitStatusFn = fn
}

function snapshot(): SubprocessStatusEvent {
	return {
		status: state.status,
		pid: state.pid,
		startedAt: state.startedAt?.toISOString() ?? null,
		lastError: state.lastError,
		restartCount: state.restartCount
	}
}

function emitStatus() {
	emitStatusFn?.(snapshot())
}

export function getStatus(): SubprocessStatusEvent {
	return snapshot()
}

export function isRunning(): boolean {
	return state.status === "running"
}

async function waitForReady(port: number, timeoutMs = 60000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const resp = await fetch(`http://localhost:${port}/api/extra/version`, {
				signal: AbortSignal.timeout(2000)
			})
			if (resp.ok) return
		} catch {}
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error("KoboldCPP did not become ready within 60 seconds")
}

function startHealthCheck(port: number) {
	stopHealthCheck()
	healthInterval = setInterval(async () => {
		if (state.status !== "running") return
		try {
			const resp = await fetch(`http://localhost:${port}/api/extra/version`, {
				signal: AbortSignal.timeout(5000)
			})
			if (!resp.ok) throw new Error("non-ok")
		} catch {
			if (state.status === "running") {
				state.status = "crashed"
				state.lastError = "Health check failed — process may have crashed"
				state.process = null
				state.pid = null
				emitStatus()
			}
		}
	}, 30_000)
}

function stopHealthCheck() {
	if (healthInterval) {
		clearInterval(healthInterval)
		healthInterval = null
	}
}

export async function start(): Promise<void> {
	if (state.status === "running" || state.status === "starting") return

	const settings = await db.query.koboldCppSettings.findFirst()
	if (!settings?.koboldCppManagerEnabled || settings?.koboldCppManagedMode !== "managed") {
		throw new Error("Managed mode is not enabled")
	}

	const { koboldCppManagedBinaryDir: binaryDir, koboldCppManagedBinaryVariant: binaryVariant } =
		settings
	if (!binaryDir || !binaryVariant) throw new Error("Binary not configured")

	const binaryPath = path.join(binaryDir, binaryVariant)

	try {
		await fsPromises.access(binaryPath, fs.constants.F_OK)
	} catch {
		throw new Error(`Binary not found at ${binaryPath}`)
	}

	if (process.platform !== "win32") {
		await fsPromises.chmod(binaryPath, 0o755)
	}

	const port = settings.koboldCppManagedPort ?? 5001
	const password = settings.koboldCppManagedAdminPassword ?? "serene"

	// If KoboldCPP is already reachable (e.g. left over from a previous server session),
	// adopt it rather than spawning a second instance on the same port.
	try {
		const ping = await fetch(`http://localhost:${port}/api/extra/version`, {
			signal: AbortSignal.timeout(2000)
		})
		if (ping.ok) {
			console.log(`[KoboldCPP] Port ${port} already active — adopting existing instance`)
			state.status = "running"
			state.startedAt = new Date()
			state.lastError = null
			emitStatus()
			startHealthCheck(port)
			return
		}
	} catch {
		// Port is free, proceed with spawn
	}

	state.status = "starting"
	state.lastError = null
	emitStatus()

	const args = ["--host", "0.0.0.0", "--port", String(port), "--admin", "--adminpassword", password, "--nomodel"]

	const proc = spawn(binaryPath, args, {
		stdio: ["ignore", "pipe", "pipe"],
		detached: false
	})

	state.process = proc
	state.pid = proc.pid ?? null
	state.startedAt = new Date()
	state.restartCount++

	proc.stdout?.on("data", (chunk: Buffer) => {
		console.log("[KoboldCPP]", chunk.toString().trimEnd())
	})
	proc.stderr?.on("data", (chunk: Buffer) => {
		console.error("[KoboldCPP stderr]", chunk.toString().trimEnd())
	})

	proc.on("error", (err) => {
		state.status = "crashed"
		state.lastError = err.message
		state.process = null
		state.pid = null
		stopHealthCheck()
		emitStatus()
	})

	proc.on("exit", (code, signal) => {
		stopHealthCheck()
		if (state.status !== "stopping") {
			state.status = "crashed"
			state.lastError = `Exited — code ${code ?? "?"} signal ${signal ?? "none"}`
		} else {
			state.status = "stopped"
		}
		state.process = null
		state.pid = null
		emitStatus()
	})

	try {
		await waitForReady(port)
	} catch (err: any) {
		// Process may still be starting — kill and propagate
		proc.kill("SIGKILL")
		state.status = "crashed"
		state.lastError = err.message
		state.process = null
		state.pid = null
		emitStatus()
		throw err
	}

	state.status = "running"
	emitStatus()
	startHealthCheck(port)
}

export async function stop(): Promise<void> {
	if (!state.process) {
		state.status = "stopped"
		state.pid = null
		emitStatus()
		return
	}

	state.status = "stopping"
	emitStatus()
	stopHealthCheck()

	const proc = state.process
	state.process = null

	await new Promise<void>((resolve) => {
		const forceKill = setTimeout(() => {
			proc.kill("SIGKILL")
			resolve()
		}, 10_000)

		proc.once("exit", () => {
			clearTimeout(forceKill)
			state.status = "stopped"
			state.pid = null
			emitStatus()
			resolve()
		})

		proc.kill("SIGTERM")
	})
}
