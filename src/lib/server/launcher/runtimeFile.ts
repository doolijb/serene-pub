/**
 * The runtime file — `<dataDir>/runtime.json` (CONTRACT §C2).
 *
 * The rendezvous between this server and the launcher: which process is
 * serving, on which port, and the per-start token the control routes
 * (`controlRoutes.ts`) demand. Written by the production server only, once
 * the HTTP server is listening and before the startup tasks finish, so the
 * launcher can watch a long first boot. Removed on exit, but only when the
 * file still names this process — a second server that overwrote it owns it.
 *
 * The token lives on `globalThis`, not in module state, so the writer (called
 * from the build wrapper through hooks) and the control routes always agree
 * on one value even if this module were ever evaluated twice.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const RUNTIME_FILE_NAME = "runtime.json"

export interface RuntimeRecord {
	schema: 1
	pid: number
	port: number
	host: string
	controlUrl: string
	openUrl: string
	version: string
	isPrerelease: boolean
	token: string
	startedAt: string
	dataDir: string
	installRoot: string | null
	launcherVersion: string | null
	channel: string | null
}

interface ProcessIdentity {
	token: string
	startedAt: string
}

const IDENTITY_KEY = "__SERENE_PUB_LAUNCHER_IDENTITY__"

/** This process's token and start time, made once per process. */
export function processIdentity(): ProcessIdentity {
	const g = globalThis as Record<string, unknown>
	let identity = g[IDENTITY_KEY] as ProcessIdentity | undefined
	if (!identity) {
		identity = {
			token: crypto.randomBytes(32).toString("hex"),
			startedAt: new Date().toISOString()
		}
		g[IDENTITY_KEY] = identity
	}
	return identity
}

const LOOPBACK_BINDS = new Set(["", "0.0.0.0", "::", "localhost", "::1", "[::1]"])

/**
 * The host the launcher talks to (§C2): loopback whenever the bind includes
 * it, else the bound host itself — in which case the control routes will
 * refuse, and the launcher falls back to pid liveness.
 */
export function controlHostFor(boundHost: string | undefined | null): string {
	const h = (boundHost ?? "").trim()
	if (LOOPBACK_BINDS.has(h) || h.startsWith("127.")) return "127.0.0.1"
	return h.includes(":") && !h.startsWith("[") ? `[${h}]` : h
}

export function buildRuntimeRecord(opts: {
	pid: number
	port: number
	host: string | undefined | null
	version: string
	isPrerelease: boolean
	dataDir: string
	env?: NodeJS.ProcessEnv
	identity?: ProcessIdentity
}): RuntimeRecord {
	const env = opts.env ?? process.env
	const identity = opts.identity ?? processIdentity()
	const host = (opts.host ?? "").trim() || "0.0.0.0"
	const value = (k: string) => env[k]?.trim() || null
	return {
		schema: 1,
		pid: opts.pid,
		port: opts.port,
		host,
		controlUrl: `http://${controlHostFor(opts.host)}:${opts.port}`,
		openUrl: `http://localhost:${opts.port}`,
		version: opts.version,
		isPrerelease: opts.isPrerelease,
		token: identity.token,
		startedAt: identity.startedAt,
		dataDir: path.resolve(opts.dataDir),
		installRoot: value("SERENE_PUB_INSTALL_ROOT")
			? path.resolve(value("SERENE_PUB_INSTALL_ROOT")!)
			: null,
		launcherVersion: value("SERENE_PUB_LAUNCHER_VERSION"),
		channel: value("SERENE_PUB_UPDATE_CHANNEL")
	}
}

/**
 * Write atomically: a temp file named for this pid, mode 0600 from creation
 * (the token is a credential), then a rename over the old file.
 */
export function writeRuntimeFile(dataDir: string, record: RuntimeRecord): string {
	fs.mkdirSync(dataDir, { recursive: true })
	const target = path.join(dataDir, RUNTIME_FILE_NAME)
	const tmp = path.join(dataDir, `${RUNTIME_FILE_NAME}.${record.pid}.tmp`)
	const fd = fs.openSync(tmp, "w", 0o600)
	try {
		fs.writeFileSync(fd, JSON.stringify(record, null, "\t") + "\n")
		fs.fsyncSync(fd)
	} finally {
		fs.closeSync(fd)
	}
	// An existing temp file of the same name keeps its old mode on open.
	fs.chmodSync(tmp, 0o600)
	fs.renameSync(tmp, target)
	return target
}

/** Remove the file only when it names `pid`. Synchronous: runs on `exit`. */
export function removeRuntimeFileIfOwn(dataDir: string, pid: number): boolean {
	const target = path.join(dataDir, RUNTIME_FILE_NAME)
	try {
		const parsed = JSON.parse(fs.readFileSync(target, "utf8"))
		if (parsed?.pid !== pid) return false
		fs.unlinkSync(target)
		return true
	} catch {
		return false
	}
}

let installed = false

/**
 * Called once the HTTP server is listening (production only — see
 * `hooks.server.ts`). Writes the file and arranges its removal on exit. A
 * failure is logged and swallowed: a missing runtime file costs the launcher
 * its attach, never the server its life.
 */
export function publishRuntimeFile(opts: {
	address: { port: number } | string | null
	host: string | undefined
	version: string
	isPrerelease: boolean
	dataDir: string
}): void {
	if (installed) return
	if (!opts.address || typeof opts.address === "string") {
		// A unix-socket listener (SOCKET_PATH) has no port for a launcher.
		return
	}
	installed = true
	try {
		const record = buildRuntimeRecord({
			pid: process.pid,
			port: opts.address.port,
			host: opts.host,
			version: opts.version,
			isPrerelease: opts.isPrerelease,
			dataDir: opts.dataDir
		})
		const file = writeRuntimeFile(record.dataDir, record)
		process.on("exit", () => {
			removeRuntimeFileIfOwn(record.dataDir, record.pid)
		})
		console.log(`[launcher] Runtime file written: ${file}`)
	} catch (err) {
		console.warn("[launcher] Could not write the runtime file:", err)
	}
}
