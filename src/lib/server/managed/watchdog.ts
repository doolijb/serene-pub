/**
 * The process watchdog: a managed child never outlives Serene Pub (owner
 * ruling, 2026-11-10). ⚠ Not the streaming idle watchdog
 * (`connectionAdapters/idleTimeout.ts`), which times out a quiet reply.
 *
 * The supervisor's own exit hook and the signal handlers in
 * `$lib/server/services` cover a clean stop, SIGINT and SIGTERM. Nothing
 * running *inside* this process can cover a `kill -9`, an out-of-memory kill
 * or a hard crash — and before this file, those left KoboldCPP holding the
 * port and the graphics memory until the next boot's orphan sweep (which on
 * Windows and macOS never ran). The portable alternatives to a sidecar both
 * need a native module: `PR_SET_PDEATHSIG` on Linux, a Job Object on Windows.
 *
 * So beside every managed child a tiny Node script is spawned, detached and
 * unreferenced, with two pids. Once a second it asks whether both are alive.
 * Child gone: it exits. Core gone: it kills the child's tree (`SIGTERM`, then
 * `SIGKILL` after five seconds; `taskkill /T /F` on Windows) and exits. It
 * holds no handle to this process, so this process exiting by any means at all
 * is what it is waiting for.
 *
 * The script is written next to the pid file at spawn time rather than shipped
 * as a build asset: the server bundle carries no loose files, and a string here
 * is one place to read it. `process.execPath` runs it — releases run on plain
 * Node (`node build/index.js`), so that is Node.
 *
 * Known gap: if the core's pid is recycled by another process within a second
 * of its death, the watchdog never notices. Small window, no state at risk.
 */
import { spawn } from "child_process"
import * as fsPromises from "fs/promises"
import * as path from "path"

export const WATCHDOG_FILE_NAME = "serene-pub-watchdog.mjs"

/** The sidecar's source. Standalone: no imports beyond Node's own. */
export const WATCHDOG_SOURCE = `// Written by Serene Pub beside each managed process it starts. It ends the
// process when Serene Pub itself ends, however that happens. Safe to delete
// while nothing is running.
import { spawnSync } from "node:child_process"
const [corePid, childPid] = process.argv.slice(2).map((s) => parseInt(s, 10))
if (!corePid || !childPid) process.exit(2)
const win = process.platform === "win32"
function alive(pid) {
	try { process.kill(pid, 0); return true } catch (e) { return e && e.code === "EPERM" }
}
function kill(pid, signal) {
	if (win) { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); return }
	try { process.kill(-pid, signal) } catch { try { process.kill(pid, signal) } catch {} }
}
let ending = false
setInterval(() => {
	if (!alive(childPid)) process.exit(0)
	if (ending || alive(corePid)) return
	ending = true
	kill(childPid, "SIGTERM")
	setTimeout(() => { if (alive(childPid)) kill(childPid, "SIGKILL"); process.exit(0) }, 5000)
}, 1000)
`

export interface WatchdogSpawn {
	/** The watchdog's own pid, for logs. Null when it could not be started. */
	pid: number | null
}

/**
 * Write the script beside `dir` (idempotent) and start it for `childPid`.
 * Never throws: a watchdog that fails to start is logged, and the fast paths
 * (exit hook, signal handlers) still run — this is the guarantee layer, not
 * the only one.
 */
export async function spawnWatchdog(
	dir: string,
	childPid: number,
	label: string,
	deps: {
		execPath?: string
		corePid?: number
		spawnFn?: typeof spawn
	} = {}
): Promise<WatchdogSpawn> {
	const scriptPath = path.join(dir, WATCHDOG_FILE_NAME)
	try {
		await fsPromises.writeFile(scriptPath, WATCHDOG_SOURCE)
		const child = (deps.spawnFn ?? spawn)(
			deps.execPath ?? process.execPath,
			[scriptPath, String(deps.corePid ?? process.pid), String(childPid)],
			{
				detached: true,
				stdio: "ignore",
				windowsHide: true
			}
		)
		child.on("error", (err) =>
			console.warn(`[${label}] watchdog failed to start:`, err.message)
		)
		child.unref()
		return { pid: child.pid ?? null }
	} catch (err: any) {
		console.warn(`[${label}] watchdog failed to start:`, err?.message ?? err)
		return { pid: null }
	}
}
