/**
 * The managed-services registry.
 *
 * SP supervises long-lived local processes — the KoboldCPP subprocess, a
 * cloudflared tunnel — and each one had grown its own copy of the same three
 * concerns: recover from an ungraceful previous shutdown, stop cleanly on a
 * signal, and report what it is doing. That duplication had already produced
 * two real problems worth naming, because they are what this exists to fix
 * rather than tidiness:
 *
 * 1. **Three competing signal handlers.** `subprocessManager.ts` and
 *    `db/index.ts` each installed their own SIGINT/SIGTERM handler, and each
 *    called `process.exit()` when done. Whichever finished first killed the
 *    process out from under the others, so "stop cleanly" was a race rather
 *    than a guarantee. One coordinator now waits for all of them.
 * 2. **Boot recovery living wherever it was convenient.** KoboldCPP's orphan
 *    sweep was called from `attachSocketServer()` — a socket concern that has
 *    nothing to do with subprocesses, and which meant the sweep silently
 *    depended on sockets attaching at all. It is a startup task; it now runs
 *    as one.
 *
 * Deliberately thin. This is not a process supervisor and does not try to
 * become one: each service keeps its own spawn logic, its own state and its own
 * failure modes, because a cloudflared tunnel and a KoboldCPP server genuinely
 * do not share those. What is shared is only when they are asked to recover and
 * when they are asked to stop.
 */

export interface ManagedService {
	/** Stable identifier, e.g. "tunnels". Used in logs and as the map key. */
	id: string
	/** Human-readable name for log lines. */
	label: string
	/**
	 * Recover from however the last run ended, and start whatever is configured
	 * to start on its own.
	 *
	 * Runs once, as a startup task. A failure here is logged and does not stop
	 * other services or the app — an instance that cannot restore its tunnel
	 * must still serve sessions.
	 */
	reconcileOnBoot?: () => Promise<void>
	/**
	 * Stop cleanly. Called on SIGINT/SIGTERM before the process exits, and
	 * given a bounded window — see SHUTDOWN_TIMEOUT_MS.
	 */
	shutdown?: () => Promise<void>
}

const services = new Map<string, ManagedService>()

/**
 * Registering twice is a no-op rather than an error: a module can be evaluated
 * more than once under HMR, and a duplicate registration is not a fault worth
 * failing a boot over.
 */
export function registerService(service: ManagedService) {
	if (services.has(service.id)) return
	services.set(service.id, service)
}

export function getRegisteredServices(): ManagedService[] {
	return [...services.values()]
}

/**
 * Test seam — the registry is module state, and tests need a clean one.
 *
 * Also clears the shutdown latch. `shutdownServices` is deliberately
 * once-only in production (a second SIGTERM must not restart a teardown that
 * is already running), which without this would make the first test that
 * shuts down the last one that can.
 */
export function clearRegisteredServices() {
	services.clear()
	shuttingDown = false
}

/**
 * Run every service's boot recovery, in registration order.
 *
 * Sequential, not parallel: these compete for the same CPU and disk during the
 * noisiest moment of startup, and one of them may spawn a process the next
 * would otherwise race. Nothing here is slow enough for the concurrency to be
 * worth the coupling.
 */
export async function reconcileServices(): Promise<void> {
	for (const service of getRegisteredServices()) {
		if (!service.reconcileOnBoot) continue
		try {
			await service.reconcileOnBoot()
		} catch (err) {
			console.warn(`[${service.id}] boot reconciliation failed:`, err)
		}
	}
}

/**
 * How long every service collectively gets to stop before the process exits
 * anyway. A shutdown that hangs is worse than one that is cut short — a
 * container runtime will SIGKILL us shortly after regardless, and that path
 * leaves exactly the orphan `reconcileOnBoot` then has to clean up.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000

let shuttingDown = false

export async function shutdownServices(signal: string): Promise<void> {
	if (shuttingDown) return
	shuttingDown = true

	const withShutdown = getRegisteredServices().filter((s) => s.shutdown)
	if (withShutdown.length === 0) return

	console.log(
		`Received ${signal} — stopping ${withShutdown.length} managed service(s)…`
	)

	// Sequential, in REVERSE registration order. Teardown has dependencies that
	// startup does not: the database registers first so it closes last, because
	// other services write to it on their way out (the tunnel marks its row
	// stopped) and a closed database turns that into a failed write. The shared
	// deadline below still bounds the whole sequence.
	await Promise.race([
		(async () => {
			for (const service of [...withShutdown].reverse()) {
				try {
					await service.shutdown!()
				} catch (err) {
					console.error(`[${service.id}] error while stopping:`, err)
				}
			}
		})(),
		new Promise<void>((resolve) =>
			setTimeout(() => {
				console.warn(
					`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s — exiting anyway.`
				)
				resolve()
			}, SHUTDOWN_TIMEOUT_MS)
		)
	])
}

let handlersInstalled = false

/**
 * One coordinator for the whole process, installed once.
 *
 * Individual services must NOT install their own SIGINT/SIGTERM handlers. Node
 * runs every listener for a signal, so a service that exits the process in its
 * own handler cuts short every other service's teardown — which is precisely
 * the race this replaces.
 */
export function installShutdownHandlers() {
	if (handlersInstalled) return
	handlersInstalled = true
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			void shutdownServices(signal).finally(() => process.exit(0))
		})
	}
}
