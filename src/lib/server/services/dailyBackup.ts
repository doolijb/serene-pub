/**
 * The unattended backup (ruled 2026-09-10: daily, configurable, default on).
 *
 * Until this existed the only automatic backup was `backupBeforeMigrations`,
 * taken in front of a schema change. That protects an upgrade and nothing else:
 * an install that sits on one version for six months has no backup at all, and
 * the failure the whole recovery area exists for — a force-quit leaving PGlite
 * unopenable — does not wait for a version bump.
 *
 * **What this is not.** It is not a retention policy. Nothing is culled, nothing
 * is deleted, and turning it off simply stops new ones being taken (ruled
 * earlier, and restated in `db/backup.ts`). It is also not a scheduler: there is
 * no cron expression and no "at 03:00" to get wrong across a laptop's sleep, a
 * container restart or a timezone. It asks one question every hour — *is the
 * newest backup older than a day?* — which gives the same answer on a machine
 * that was asleep for a week as on one that never stopped, with no state to keep
 * beyond the files already on disk.
 *
 * Registered through `services/register.ts`, so it inherits the one boot-recovery
 * pass and the one shutdown coordinator. It installs no signal handler of its
 * own; see `services/index.ts` for why that rule exists.
 */
import type { RecoveryPaths } from "$lib/server/db/recovery"

/** How often the question is asked. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** How old the newest backup has to be before another is taken. */
export const BACKUP_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Why a check did nothing, or that it did something. Returned rather than only
 * logged so the tests can assert the decision instead of scraping stdout.
 */
export type DailyBackupOutcome =
	| "taken"
	| "fresh"
	| "disabled"
	| "busy"
	| "failed"

export interface DailyBackupDeps {
	/** Injected by tests; defaults to the running instance's data directory. */
	paths?: RecoveryPaths
	/** Injected by tests and by nothing else. */
	db?: MigrationDb
	now?: () => number
	/** How many pipeline runs are in flight. Defaults to the run registry. */
	activeRuns?: () => number
}

/**
 * Take a backup if one is due.
 *
 * Never throws. This is called from boot reconciliation and from a timer, and
 * in both places a thrown error would cost something far more valuable than a
 * backup — a start, or the next twenty-three checks.
 */
export async function maybeTakeDailyBackup(
	deps: DailyBackupDeps = {}
): Promise<DailyBackupOutcome> {
	try {
		const { listBackups, recoveryPaths, backupNow } = await import(
			"$lib/server/db/recovery"
		)
		const { readBackupSettings } = await import("$lib/server/db/backup")

		const paths = deps.paths ?? recoveryPaths()
		const database = deps.db ?? (await import("$lib/server/db")).db
		const settings = await readBackupSettings(database)
		if (!settings.backupDaily) return "disabled"

		const now = deps.now?.() ?? Date.now()
		const [newest] = listBackups(paths)
		if (newest) {
			const at = Date.parse(newest.modifiedAt)
			if (Number.isFinite(at) && now - at < BACKUP_AGE_MS) return "fresh"
		}

		// A dump is a multi-megabyte synchronous read of the data directory. It
		// is not correctness-critical to skip it mid-generation — PGlite's
		// `dumpDataDir` is consistent either way — but it is a visible stall in
		// the middle of somebody's reply, and the check runs again in an hour.
		if ((await activeRunCount(deps)) > 0) return "busy"

		const created = await backupNow({
			label: "daily",
			paths,
			db: deps.db,
			includeUserFiles: settings.backupIncludeUserFiles,
			// Not in `meta.json.recoveryLog[]`. That log is capped and holds
			// the times something moved a data directory around; a line a day
			// would evict every real recovery action inside seven months. See
			// the `record` option in db/recovery.ts.
			record: false
		})
		// One line per backup, and only per backup: an hourly "nothing to do"
		// would bury the log of an app that runs for months.
		console.log(
			`[backup] daily backup taken: ${created.name} ` +
				`(${(created.bytes / 1024 / 1024).toFixed(1)} MB` +
				(created.hasUsers
					? ` + ${(created.usersBytes / 1024 / 1024).toFixed(1)} MB user files`
					: "") +
				")"
		)
		return "taken"
	} catch (error) {
		console.warn(
			`[backup] the daily backup did not run — ${String(
				(error as Error)?.message ?? error
			)}`
		)
		return "failed"
	}
}

/**
 * How many runs are in flight, or 0 if that cannot be answered.
 *
 * Dynamic, and tolerant of the import failing: the run registry is deep in the
 * pipeline runtime, and a backup that refused to happen because a module it
 * only consults would not load would be a strange way to lose data.
 */
async function activeRunCount(deps: DailyBackupDeps): Promise<number> {
	if (deps.activeRuns) return deps.activeRuns()
	try {
		const registry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		return registry.active().length
	} catch {
		return 0
	}
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Boot: check once, then every hour.
 *
 * The boot check is the one that matters most — a machine that is only ever on
 * for an hour a day would never reach a timer tick, and is exactly the install
 * whose backups nobody is watching.
 *
 * **Started, not awaited**, and that is the one thing about this function worth
 * knowing. `reconcileServices()` runs inside the `appReady` promise that
 * `hooks.server.ts` awaits on every request, so anything awaited here is time
 * the instance answers nothing. A dump is proportional to the database — a few
 * hundred milliseconds for a new install, tens of seconds for a large one —
 * and paying that in front of the first request once a day is a bad trade for
 * a backup nobody is waiting on. It cannot reject; see `maybeTakeDailyBackup`.
 */
export async function reconcileOnBoot(): Promise<void> {
	void maybeTakeDailyBackup()
	start()
}

export function start(): void {
	if (timer) return
	timer = setInterval(() => {
		void maybeTakeDailyBackup()
	}, CHECK_INTERVAL_MS)
	// Never the reason a process stays alive.
	timer.unref?.()
}

export function stop(): void {
	if (!timer) return
	clearInterval(timer)
	timer = null
}
