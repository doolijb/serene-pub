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

	// After the database, so it stops before the database closes: a plugin's
	// `shutdown` callback is recorded in the invocation log and may write its
	// own rows. Its callbacks are bounded well inside the shared deadline
	// (plugins/lifecycle.ts), so a hung plugin cannot cost the others theirs.
	const plugins = await import("$lib/server/plugins")
	registerService({
		id: "plugins",
		label: "Plugins",
		shutdown: () => plugins.shutdownPluginsGracefully()
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

	// No media service any more, and its absence is the point (0182). Boot used
	// to drain a thumbnail backfill here, because uploads encoded inline and
	// anything that failed inline needed retrying. Derivation is lazy now — the
	// first request that wants a thumbnail makes it — so encoding at boot is
	// exactly what the ruling forbids. The one job left, re-cutting thumbnails
	// that a raised THUMB_MAX_EDGE made stale, is `sweepThumbnails()` in
	// media/backfill.ts and is invoked deliberately.

	// Anywhere after the database, which is all that matters: teardown runs in
	// reverse, so this stops its timer while the database it dumps is still
	// open rather than after it closed.
	const dailyBackup = await import("./dailyBackup")
	registerService({
		id: "dailyBackup",
		label: "Daily backup",
		// Checks once now and hourly thereafter (ruled 2026-09-10). Never
		// throws: `maybeTakeDailyBackup` answers an outcome, not an exception,
		// precisely so a boot cannot be lost to a backup.
		reconcileOnBoot: () => dailyBackup.reconcileOnBoot(),
		shutdown: async () => dailyBackup.stop()
	})

	// A `downloading` row in `local_models` is per-process state written to a
	// durable column: this process's download map is empty at boot, so a row
	// still saying `downloading` belongs to a run that ended. Nothing else can
	// tell the difference later, which is why it is settled here.
	const onnxDownloads = await import("$lib/server/sockets/localOnnxModels")
	registerService({
		id: "localOnnxModels",
		label: "Local ONNX models",
		reconcileOnBoot: () => onnxDownloads.reconcileOnnxDownloadsOnBoot()
	})

	// Open notification rows can outlive their facts: a restart drops every
	// in-memory park they point at. Lapses those, runs each producer's
	// re-check against stored state, and prunes (notifications/service.ts).
	const notifications = await import("$lib/server/notifications/service")
	registerService({
		id: "notifications",
		label: "Notifications",
		reconcileOnBoot: () => notifications.reconcileNotificationsOnBoot()
	})

	// The composer tray (PLAN-composer-attachments §3.1): expire unsent tray
	// items after a day and drop uploads a dead process left behind — at boot,
	// then hourly.
	const tray = await import("$lib/server/attachments/tray")
	registerService({
		id: "trayItems",
		label: "Attachment tray",
		reconcileOnBoot: () => tray.startTraySweep(),
		shutdown: () => tray.stopTraySweep()
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
