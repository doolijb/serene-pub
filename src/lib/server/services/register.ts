import { registerService } from "./index"

/**
 * Where the concrete managed services are declared.
 *
 * Split from `index.ts` so the registry itself stays importable by anything
 * without dragging in a subprocess manager and its database dependencies. This
 * module is imported once, by the `services` startup task.
 *
 * Each service adapts an existing manager rather than replacing it. That is
 * deliberate: `subprocessManager.ts` in particular carries hard-won behaviour
 * around PID files, adopting an already-running instance and distinguishing an
 * external process from one we spawned. None of that is generic, none of it
 * belongs in a registry, and rewriting it to fit an abstraction would trade
 * working code for symmetry.
 */
export async function registerCoreServices() {
	// Registered FIRST, so it shuts down LAST — teardown runs in reverse
	// registration order. Everything else may still write to the database on
	// its way out (the tunnel marks its row stopped), so closing the database
	// before them would turn a clean shutdown into a series of failed writes.
	const dbModule = await import("$lib/server/db")
	registerService({
		id: "database",
		label: "Database",
		shutdown: () => dbModule.closeDatabase()
	})

	const tunnels = await import("$lib/server/tunnels/supervisor")
	registerService({
		id: "tunnels",
		label: "Tunnel",
		// TTL reconciliation, then auto-start, then the periodic sweep (26 §4).
		reconcileOnBoot: () => tunnels.reconcileOnBoot(),
		shutdown: async () => {
			tunnels.stopTtlSweep()
			await tunnels.stop()
		}
	})

	const mediaBackfill = await import("$lib/server/media/backfill")
	registerService({
		id: "media",
		label: "Media",
		// Thumbnails missing after an upgrade (the 0166 data upgrade
		// deliberately generates none inline) or after a failed inline encode.
		// Originals serve until this finishes, so it is never on a critical
		// path.
		reconcileOnBoot: () => mediaBackfill.backfillOnBoot(),
		shutdown: async () => {}
	})

	const koboldcpp = await import("$lib/server/koboldcpp/subprocessManager")
	registerService({
		id: "koboldcpp",
		label: "KoboldCPP",
		// Sweeps a subprocess orphaned by a `kill -9` or a crash. This used to
		// be called from attachSocketServer(), which meant a sweep for a model
		// runner depended on the socket server attaching.
		reconcileOnBoot: () => koboldcpp.checkForOrphanOnBoot(),
		shutdown: () => koboldcpp.stop()
	})
}
