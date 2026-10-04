/**
 * Stopping cleanly at any point in a boot — for the launcher's
 * `POST /api/launcher/shutdown` and for SIGINT/SIGTERM/SIGHUP.
 *
 * The managed services' own signal handlers are installed by the `services`
 * startup task, i.e. only once startup has finished. Before that — during a
 * long migration, or after a startup that failed partway — a signal reaches
 * only adapter-node, which closes the listener and waits for an event loop
 * that PGlite and timers keep alive: the process never exits. This
 * waits for startup to settle (so a migration is not cut in half, which
 * PGlite's WAL may not survive), bounded, and then stops through
 * `requestShutdown`, which always ends in `process.exit`.
 */

type StartupModule = { appReady: Promise<void> }

let startupRequested = false

/**
 * Called by whatever is about to import `$lib/server/startup` (which begins
 * the boot). A stop before that has no boot to wait for — and importing the
 * module just to wait on it would start one.
 */
export function noteStartupRequested(): void {
	startupRequested = true
}

export interface StopDeps {
	/** The startup module, or null when no boot was ever started. */
	loadStartup: () => Promise<StartupModule | null>
	requestShutdown: (opts: { reason: string; exitCode: number }) => Promise<void>
	/** How long to let a running startup finish before stopping anyway. */
	maxStartupWaitMs: number
}

/** Five minutes: a large upgrade's migrations fit; a hung boot does not hold Quit forever. */
export const MAX_STARTUP_WAIT_MS = 5 * 60_000

const defaultDeps: StopDeps = {
	loadStartup: async () => (startupRequested ? import("$lib/server/startup") : null),
	requestShutdown: async (opts) => {
		const { requestShutdown } = await import("$lib/server/services")
		await requestShutdown(opts)
	},
	maxStartupWaitMs: MAX_STARTUP_WAIT_MS
}

export async function stopAfterStartup(
	opts: { reason: string; exitCode: number },
	deps: StopDeps = defaultDeps
): Promise<void> {
	try {
		const startup = await deps.loadStartup()
		if (!startup) throw new Error("no boot")
		let settled = false
		const done = startup.appReady.then(
			() => {
				settled = true
			},
			() => {
				settled = true
			}
		)
		await Promise.resolve()
		if (!settled)
			console.log(`[shutdown] Stop requested (${opts.reason}) during startup — stopping once startup finishes.`)
		let timer: ReturnType<typeof setTimeout> | undefined
		await Promise.race([
			done,
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					console.warn(
						`[shutdown] Startup did not finish within ${Math.round(deps.maxStartupWaitMs / 1000)}s — stopping anyway.`
					)
					resolve()
				}, deps.maxStartupWaitMs)
			})
		])
		clearTimeout(timer)
	} catch {
		// No boot was started, or it could not be loaded: nothing is open.
	}
	await deps.requestShutdown(opts)
}

let installed = false
let signalled = false

/**
 * SIGINT, SIGTERM and SIGHUP stop the process even before the services task
 * has installed its own handlers. A second signal while the first is still
 * waiting exits at once — someone pressing Ctrl+C twice means it.
 * Production only (called from the listening hook).
 */
export function installEarlySignalHandlers(
	deps: StopDeps = defaultDeps,
	exit: (code: number) => void = (code) => process.exit(code)
): void {
	if (installed) return
	installed = true
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			if (signalled) {
				exit(0)
				return
			}
			signalled = true
			void stopAfterStartup({ reason: signal, exitCode: 0 }, deps)
		})
	}
}
