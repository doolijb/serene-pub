/**
 * Process-tree primitives the supervisor and its watchdog share, written once
 * per platform.
 *
 * Why a tree and not a pid: a managed binary is rarely one process. The
 * KoboldCPP release is a PyInstaller one-file build whose bootstrap process
 * extracts itself and spawns the real worker; killing the bootstrap alone
 * leaves the worker holding the port and the graphics memory. On Linux and
 * macOS the child is spawned `detached: true`, so it leads its own process
 * group and a negative pid reaches every member. Windows has no process
 * groups a signal can reach (`process.kill(-pid)` throws there), so the tree
 * goes through `taskkill /T`.
 *
 * Why an ownership check: the pid file beside a binary names the process a
 * previous Serene Pub started. Before that pid is killed as a stale orphan it
 * must still be *that* process — pids are recycled. Until 2026-11-10 this read
 * `/proc/<pid>/cmdline` and failed closed everywhere else, which on Windows
 * and macOS meant a stale orphan was never cleared and the app's own process
 * was taken for a stranger after every restart.
 */
import { execFile, spawnSync } from "child_process"
import * as path from "path"
import { promisify } from "util"

const execFileP = promisify(execFile)

/** `process.kill(pid, 0)`: alive (or alive but not ours to signal). */
export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err: any) {
		return err?.code === "EPERM"
	}
}

export type TreeSignal = "SIGTERM" | "SIGKILL"

/**
 * Signal a whole process tree. POSIX: the process group (falls back to the
 * pid alone when the group is gone). Windows: `taskkill /T`, forced — there
 * is no graceful variant a console-less Python worker would honour.
 */
export async function killTree(
	pid: number,
	signal: TreeSignal,
	platform: NodeJS.Platform = process.platform
): Promise<void> {
	if (platform === "win32") {
		try {
			await execFileP("taskkill", ["/PID", String(pid), "/T", "/F"], {
				windowsHide: true
			})
		} catch {
			/* already gone, or not ours — nothing else to do */
		}
		return
	}
	try {
		process.kill(-pid, signal)
	} catch {
		try {
			process.kill(pid, signal)
		} catch {
			/* already gone */
		}
	}
}

/** Synchronous `killTree` for `process.on("exit")`, where nothing can await. */
export function killTreeSync(
	pid: number,
	platform: NodeJS.Platform = process.platform
): void {
	if (platform === "win32") {
		spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
			windowsHide: true,
			stdio: "ignore"
		})
		return
	}
	try {
		process.kill(-pid, "SIGKILL")
	} catch {
		try {
			process.kill(pid, "SIGKILL")
		} catch {
			/* already gone */
		}
	}
}

/** The command line, or executable name, the platform reports for `pid`. */
export async function commandOf(
	pid: number,
	platform: NodeJS.Platform = process.platform
): Promise<string | null> {
	try {
		if (platform === "linux") {
			const { readFile } = await import("fs/promises")
			return await readFile(`/proc/${pid}/cmdline`, "utf8")
		}
		if (platform === "win32") {
			const { stdout } = await execFileP(
				"tasklist",
				["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
				{ windowsHide: true }
			)
			// `"koboldcpp.exe","1234","Console","1","1,234 K"` — or an
			// "INFO: No tasks are running…" line when the pid is gone.
			const match = /^"([^"]+)"/.exec(stdout.trim())
			return match ? match[1] : null
		}
		const { stdout } = await execFileP("ps", ["-o", "command=", "-p", String(pid)])
		return stdout.trim() || null
	} catch {
		return null
	}
}

/**
 * Does `pid` run `binaryPath`? Matches on the binary's basename, which is
 * what every platform's report carries. Fails closed: an unreadable or
 * unknown process is never "ours", so it is never killed on a guess.
 */
export async function pidRunsBinary(
	pid: number,
	binaryPath: string,
	platform: NodeJS.Platform = process.platform
): Promise<boolean> {
	const command = await commandOf(pid, platform)
	if (!command) return false
	const base = (platform === "win32" ? path.win32 : path.posix).basename(binaryPath)
	return command.toLowerCase().includes(base.toLowerCase())
}
