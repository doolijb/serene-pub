import * as schema from "./schema"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as dbConfig from "./drizzle.config"
import { compareVersions } from "$lib/shared/utils/releaseChannel"
import type { MigrationConfig } from "drizzle-orm/migrator"
import fs from "fs"
import crypto from "crypto"
import { building, dev } from "$app/environment"
import { drizzle } from "drizzle-orm/pglite"
import {
	checkDatabaseLock,
	createLockHeartbeat,
	describeLockHolder,
	readMetaFile,
	writeMetaFile
} from "./lock.js"
import type { DbLock, LockState } from "./lock.js"
import { closeBootPass, openBootPass } from "./devBootPass"
import {
	classifyDatabaseOpenFailure,
	isDatabaseUnopenableError
} from "./errors"
import {
	readShutdownMarker,
	writeShutdownMarker,
	type ShutdownMarker
} from "./shutdownMarker"

interface MetaFile {
	version: string
	lock?: DbLock
	cryptoSecretKey?: string
	/** How the previous run ended. See ./shutdownMarker. */
	lastShutdown?: ShutdownMarker
}

// Move meta.json handling to the beginning
const metaPath = dbConfig.dataDir + "/meta.json"

/**
 * True when this process created meta.json, i.e. there was no prior Serene Pub
 * install here.
 *
 * Load-bearing for data upgrades: a fresh database is created at the current
 * schema with no legacy content, so every upgrade would be a no-op at best and
 * a misfire at worst. Cannot be inferred from the version afterwards — a fresh
 * file is written as "0.0.0", which is indistinguishable from a genuine old
 * install once written.
 */
const isFreshInstall = !fs.existsSync(metaPath)

/**
 * The same question, asked again by `reopenDatabase()`.
 *
 * A "start fresh" recovery moves `serene-pub.db` aside and leaves `meta.json`
 * exactly where it was, so `isFreshInstall` above — which is about meta.json —
 * says "no" while the database about to be created is as new as a database
 * gets. Every decision below that reads `isFreshInstall` actually wants to know
 * about the *database*: whether to dump one before migrating it, whether legacy
 * content exists to upgrade, and whether the seed rows have ever been written.
 * On the first boot the two are the same value, which is why this is a separate
 * variable and not a changed meaning for the existing one.
 */
let treatAsFreshInstall = isFreshInstall

// Ensure meta.json exists
if (isFreshInstall) {
	fs.writeFileSync(
		metaPath,
		JSON.stringify(
			{
				version: "0.0.0",
				cryptoSecretKey: crypto.randomUUID()
			},
			null,
			2
		)
	)
}

// Read meta.json with error handling
let meta: MetaFile
try {
	meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
	// Ensure cryptoSecretKey exists in existing meta.json
	if (!meta.cryptoSecretKey) {
		meta.cryptoSecretKey = crypto.randomUUID()
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
	}
} catch (error) {
	console.warn(
		`Warning: Invalid meta.json detected, recreating. Error: ${error}`
	)
	// Recreate meta.json if it's corrupted
	meta = {
		version: "0.0.0",
		cryptoSecretKey: crypto.randomUUID()
	}
	fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
}

// Database lock functions
//
// The protocol itself — what a lock records, when one has gone stale, how long
// to wait — lives in ./lock.js, which `scripts/check-db-lock.js` imports too.
// Both write the same `meta.lock`, and they used to disagree about it.
const lockHeartbeat = createLockHeartbeat({
	metaPath,
	dataDir: dbConfig.dataDir,
	label: "app"
})

/**
 * The lock as it stood **before** this process took it.
 *
 * Kept because reading it again later would only ever find our own lock, while
 * the question a failed open has to answer is about the lock we *found*: a
 * directory another live process already has open traps exactly like a damaged
 * one. See `classifyDatabaseOpenFailure` in ./errors.
 */
let observedLockState: LockState | null = null

/**
 * How the previous run ended, read before this one writes anything.
 *
 * The only surviving evidence of a SIGKILL, an OOM stop or a pulled plug —
 * none of which run any code at the time. See ./shutdownMarker.
 */
let previousShutdown: ShutdownMarker = "unknown"

/** Whether this run got as far as marking itself in progress. */
let openRecorded = false

/**
 * Whether an *earlier* evaluation of this module, in this same process, is
 * still partway through starting the database — and, as a side effect, this
 * evaluation's claim on that pass.
 *
 * Claimed here at module scope rather than inside `acquireDatabaseLock()`
 * because the window opens the moment this module starts evaluating, not the
 * moment it gets around to reading the lock. Everything from here to that
 * `await` is synchronous, so no other evaluation can slip between the two.
 *
 * Dev only, and the reason is not caution: production evaluates this module
 * exactly once, so there is no second pass to detect and `openBootPass()` is
 * never called. `dev` is a build-time constant, so the whole thing — the
 * refusal below included — is dropped from the production bundle. See
 * ./devBootPass.
 */
const overlappingBootPass = !building && dev && openBootPass()

/**
 * What a refused second startup pass says — on the console, and in the
 * rejection `dbReady` hands every awaiter.
 *
 * It names a restart because a restart is the only fix there is: the outgoing
 * pass still holds the PGlite client this process opened, nothing disposes it,
 * and this evaluation therefore has no route to a working database however long
 * it waits. Refusing is what turns that into a sentence instead of duplicate-key
 * violations from two interleaved seed passes.
 */
const DEV_DOUBLE_BOOT_REFUSAL =
	"[db] Refusing a second database startup pass in this process.\n" +
	"`vite dev` re-executed src/lib/server/db/index.ts while the previous " +
	"evaluation was still starting the database. Two passes migrating and " +
	"seeding one database at once produce duplicate-key violations, a GET / " +
	"that never clears and a socket server that never attaches — so this pass " +
	"has opened, locked, migrated and seeded nothing.\n" +
	"The pass already running still holds the data directory and is unharmed. " +
	"Restart the dev server. See src/lib/server/db/devBootPass.ts."

/**
 * Refuse to open the database while another live process holds it, then take
 * the lock for ourselves.
 *
 * The version this replaces slept once, for the expiry of the lock it first
 * saw, and then rechecked a single time. A shutting-down process refreshes its
 * lock every nine seconds, so that one recheck reliably landed on a lock that
 * had just been renewed and the incoming process exited — "it waits the correct
 * amount of time but still thinks the db is locked", as reported.
 *
 * Two things fix it, and the first is the one that matters: a lock now records
 * the process that took it, so a lock whose owner is provably gone is stale on
 * the first read with no wait at all, which removes the restart case rather
 * than shortening it. Where waiting is still right — somebody really is running
 * — `checkDatabaseLock` polls to a bounded deadline instead of guessing once.
 */
async function acquireDatabaseLock(): Promise<void> {
	const result = await checkDatabaseLock({ metaPath })
	observedLockState = result.evaluation.state

	if (!result.ok) {
		console.error(result.message)
		process.exit(1)
	}

	const { state, reason } = result.evaluation
	if (state === "stale" && reason === "owner-gone") {
		console.log(
			`Reclaiming a database lock left behind by ${describeLockHolder(result.evaluation)} — that process is gone.`
		)
	} else if (state === "self") {
		// Vite re-executed this module in place: same process, so the lock we
		// are looking at is our own and cannot be a reason to refuse ourselves.
		//
		// Only a reload that arrives AFTER the first pass settled gets this
		// far. One that lands while that pass is still starting is refused
		// before the lock is read at all, because no lock can see it — see
		// ./devBootPass and `overlappingBootPass` above.
		//
		// ⚠ The previous instance of this module is still holding the PGlite
		// client it opened, and PGlite refuses a second open of one directory
		// in one process — so the queries that follow may fail with
		// `RuntimeError: Aborted()` until the dev server is restarted. That is
		// a separate problem (nothing disposes the outgoing instance) which
		// this check used to hide by exiting the process instead, and it is
		// named here so it is recognisable rather than mysterious.
		console.log(
			"Database lock is this process's own (dev module re-execution) — continuing. " +
				"If queries then fail to open the database, restart the dev server."
		)
	} else if (state === "unreadable") {
		console.warn(
			`Warning: could not read ${metaPath} while checking the database lock (${result.evaluation.reason}). Continuing.`
		)
	} else if (result.polls > 1) {
		// Only when we actually had to come back for a second look. Anything
		// shorter is a lock that was already gone, and saying we waited for it
		// would be a fiction.
		console.log(
			`Database lock released after ${(result.waitedMs / 1000).toFixed(1)}s. Continuing...`
		)
	}

	lockHeartbeat.start()
}

/**
 * Let go of the data directory: stop the heartbeat, drop the lock, close PGlite.
 *
 * Exported for the integration suites, which point `SERENE_PUB_DATA_DIR` at a
 * temp directory, load this module for real, and then delete that directory.
 * Without this they were deleting it out from under a live database and a
 * running timer — see `dataDirPresent` in ./lock.js. Stopping the writer first is the
 * deterministic fix; the guard above is what keeps a stray tick harmless.
 *
 * Safe to call twice, and safe to call on a database that never opened.
 */
export async function closeDatabase(): Promise<void> {
	lockHeartbeat.stop()
	const client = (
		db as unknown as { $client?: { close?: () => Promise<void> } }
	).$client
	try {
		await client?.close?.()
	} catch {
		// Already closed, or never opened. Either way there is nothing to hold,
		// and nothing that would justify calling this a clean shutdown.
		return
	}

	// Only once PGlite has actually let go, and only if this run ever claimed
	// the directory: writing "clean" after a boot that could not open it would
	// erase the very evidence of the kill that broke it.
	if (!openRecorded) return
	openRecorded = false
	const written = writeShutdownMarker(metaPath, "clean")
	if (!written.ok) {
		console.warn(
			`Warning: could not record a clean shutdown in meta.json — ${written.reason}.`
		)
	}
}

// Last-resort, synchronous: 'exit' handlers cannot await, so this only stops
// the lock-refresh timer and releases the lock (both synchronous). The real
// teardown is `closeDatabase()`, registered as the "database" managed service
// (see $lib/server/services/register).
process.on("exit", () => lockHeartbeat.stop())

// This module used to own SIGINT/SIGTERM handlers that called
// `process.exit(0)` immediately. Node runs every listener for a signal, and
// this module is imported before almost anything else — so that exit fired
// first and cut short every other listener's cleanup. The managed KoboldCPP
// subprocess had a graceful-shutdown path that, in production, almost certainly
// never got to run. The services registry now owns signal handling and waits
// for each service in turn.

// Everything below is skipped while BUILDING.
//
// This module opens PGlite, takes a lock, migrates and seeds at module scope —
// and SSR compilation imports it, so `npm run build` was doing all of that
// against the developer's REAL data directory. If their dev server happened to
// be running, the build died outright:
//
//     Using PGlite database at: ~/.local/share/SerenePub/data/serene-pub.db
//     Database remains locked after waiting. Exiting application.
//
// A build must never touch user data. It only needs this module to TYPE-CHECK
// and bundle; nothing evaluates a query at build time. `building` is
// SvelteKit's own signal for exactly this, and is false at runtime, so the
// server still initialises normally when it actually starts.
if (overlappingBootPass) {
	// Said here, first, rather than left to `dbReady`'s rejection alone: every
	// line below assumes this evaluation owns the data directory, and the
	// developer watching the terminal is the one who has to act on it.
	//
	// The lock is deliberately NOT taken. The pass already running holds it and
	// is refreshing it; a second heartbeat on the same `meta.lock` would mean
	// whichever of the two stops first clears a lock the other still believes
	// it holds.
	console.error(DEV_DOUBLE_BOOT_REFUSAL)
} else if (!building) {
	// Refuse to start alongside a live holder, then hold it ourselves.
	await acquireDatabaseLock()

	// Read here, above `drizzle()`, because opening the database is what
	// overwrites it — and printed unconditionally, because "was I force-quit?"
	// is the first question a boot after a crash has to answer and the only
	// place it can be answered is a marker the previous run left behind.
	previousShutdown = readShutdownMarker(metaPath)
	console.log(`[db] previous shutdown: ${previousShutdown}`)
}

// During a build this points at a throwaway in-memory database rather than the
// user's data directory. Keeps the exact same type (so nothing downstream
// changes) while guaranteeing the build cannot open, lock or migrate real data.
//
// A refused dev pass gets the same treatment, for the same reason one step
// removed: the outgoing pass has this directory open in this process, and a
// second PGlite on it is exactly the `RuntimeError: Aborted()` named in
// `acquireDatabaseLock()` above. `dbReady` rejects either way, so nothing ever
// queries this handle — pointing it at memory is what keeps a refusal from
// touching the data directory at all.
export let db = drizzle(
	building || overlappingBootPass ? "memory://" : dbConfig.dbPath,
	{ schema }
)
export { schema }

// Re-exported from the shared module so the migration gate and the update
// notifier can never disagree about what "newer" means. They previously had
// separate implementations, and the other one ignored pre-release suffixes
// entirely — see $lib/shared/utils/releaseChannel.
export { compareVersions }

/**
 * Get the crypto secret key from meta.json, creating one if it doesn't exist
 */
export function getCryptoSecretKey(): string {
	try {
		const currentMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		if (!currentMeta.cryptoSecretKey) {
			currentMeta.cryptoSecretKey = crypto.randomUUID()
			fs.writeFileSync(metaPath, JSON.stringify(currentMeta, null, 2))
		}
		return currentMeta.cryptoSecretKey
	} catch (error) {
		console.warn(
			`Warning: Error reading meta.json for crypto key. Error: ${error}`
		)
		// Recreate meta.json if it's corrupted
		const newMeta = {
			version: "0.0.0",
			cryptoSecretKey: crypto.randomUUID()
		}
		fs.writeFileSync(metaPath, JSON.stringify(newMeta, null, 2))
		return newMeta.cryptoSecretKey
	}
}

/**
 * The Serene Pub version this data directory was last opened by, captured
 * before anything writes to meta.json.
 */
const previousVersion: string | null = isFreshInstall
	? null
	: (meta.version ?? null)

async function runMigrations() {
	// A backup first, and a failed one aborts the upgrade rather than warning.
	// This data directory is the only copy the user has — no managed Postgres
	// behind it, no PITR — so migrating unprotected is the exact situation the
	// backup exists to prevent. Skipped entirely on a fresh install and when
	// nothing is actually pending, so it costs an unchanged instance nothing.
	const { backupBeforeMigrations } = await import("./backup")
	await backupBeforeMigrations(db, {
		dataDir: dbConfig.dataDir,
		migrationsFolder: dbConfig.migrationsDir,
		label: previousVersion ?? "unknown",
		isFreshInstall: treatAsFreshInstall
	})

	const { runMigrationsWithUpgrades } = await import("./dataUpgrades")
	const { upgradesRun } = await runMigrationsWithUpgrades(db, {
		migrationsFolder: dbConfig.migrationsDir,
		// Data upgrades transform content an older version left behind. There
		// is none on a fresh install, so they are skipped outright rather than
		// each being asked to detect emptiness.
		skipUpgrades: treatAsFreshInstall
	})
	console.log(
		`Migrations applied.` +
			(upgradesRun.length
				? ` Data upgrades run: ${upgradesRun.join(", ")}.`
				: "")
	)
}

/**
 * Open the database, and say something useful when it will not open.
 *
 * `drizzle()` above is synchronous — it constructs the PGlite client and hands
 * it straight back, so the actual open is a promise on that client and the
 * failure of the open surfaces there rather than at the call site. Nothing used
 * to await it. A data directory left damaged by a force-quit therefore rejected
 * a promise nobody was holding: an unhandled rejection during boot, followed by
 * `RuntimeError: Aborted()` on every request for the life of the process, with
 * no mention of the data directory, of the backups sitting beside it, or of the
 * fact that the data itself was very likely still intact.
 *
 * Awaiting it here is what turns that into a decision. What the decision may
 * and may not conclude is in ./errors, and the short version is that only a
 * WASM trap out of `_pg_initdb`, on a database that exists, with no other
 * process holding it, is allowed to mean "this directory will not open".
 */
async function openDatabase(): Promise<void> {
	try {
		await (db as unknown as { $client?: { waitReady?: Promise<unknown> } })
			.$client?.waitReady
	} catch (error) {
		const { summariseBackups } = await import("./backup")
		const classified = classifyDatabaseOpenFailure(error, {
			dataDir: dbConfig.dataDir,
			dbPath: dbConfig.dbPath,
			lockState: observedLockState,
			lastShutdown: previousShutdown,
			backups: summariseBackups(dbConfig.dataDir)
		})
		// Anything unrecognised keeps its own identity and its own stack.
		// Dressing an unrelated failure up as a damaged data directory would
		// send an owner looking for a backup to restore over a bug in the app.
		throw classified ?? error
	}

	// On the record as a run that has not shut down yet, from here until
	// `closeDatabase()` says otherwise.
	const written = writeShutdownMarker(metaPath, "unclean")
	openRecorded = written.ok
	if (!written.ok) {
		// Never repaired or recreated from here: that file's `cryptoSecretKey`
		// is the only copy of the key backing sessions and stored passphrases,
		// and no diagnostic is worth minting a new one. The marker is simply
		// skipped, and next boot reads "unknown".
		console.warn(
			`Warning: could not record the shutdown marker in meta.json — ${written.reason}. ` +
				"Continuing without it."
		)
	}
}

/**
 * Everything this module used to do at top level, moved into a function.
 *
 * **Why this is not a style change.** Awaiting these at module scope made this
 * an async ESM module whose own evaluation dynamically imported modules that
 * import `db` right back — `./defaults`, `messages/store`,
 * `pipelines/boot/bootstrap`, `plugins`. That is a cycle through a top-level
 * await, and in the production Rollup bundle it deadlocks: whether it happens
 * depends on which chunk each of those modules lands in, so it was invisible
 * until a chunk boundary moved. When it does happen nothing throws and nothing
 * rejects — every `await import()` of anything reaching `db` simply never
 * settles, so the request that triggered it hangs forever and any
 * fire-and-forget caller silently does nothing. Neither vitest nor `vite dev`
 * reproduces it; both skip Rollup's chunking entirely.
 *
 * Starting the promise here without awaiting it keeps this module's evaluation
 * synchronous, which breaks the cycle. The work still begins the instant the
 * module loads — what changes is that "the database is ready" is now something
 * callers state explicitly by awaiting `dbReady`, instead of a side effect they
 * inherited by importing `db`.
 */
async function initialiseDatabase(): Promise<void> {
	// A startup pass this evaluation cannot join is still running: it holds the
	// lock, the PGlite client and the migrations ledger, and nothing disposes
	// it, so there is no state here to wait for. Refuse rather than interleave.
	//
	// Deliberately WITHOUT `closeBootPass()`: the flag belongs to the pass that
	// is still running, and clearing it here would wave the NEXT reload through
	// into the same collision.
	if (overlappingBootPass) throw new Error(DEV_DOUBLE_BOOT_REFUSAL)

	try {
		await runInitialisation()
	} finally {
		// Settled either way, succeeded or thrown. A failed boot has to clear
		// this too, or fixing the error that broke startup would be answered
		// with "restart the dev server" forever. Reached only by the pass that
		// opened the flag — a refused one threw above.
		if (!building && dev) closeBootPass()
	}
}

/** The pass itself. Split out only so the guard above reads as a guard. */
async function runInitialisation(): Promise<void> {
	// First, and separately from every query below: the database has to be
	// open before "what is pending" is even a question. See openDatabase().
	if (!building) await openDatabase()

	// Put the migrations ledger back in agreement with the journal before
	// anything asks it what is pending. See ./migrationLedgerRepair for the
	// defect; what matters here is the position, and it is load-bearing twice.
	//
	// **Above the version switch, not inside `runMigrations()`.** An affected
	// database reaches `case 0` — versions match — and the
	// `hasPendingMigrations()` gate there reads the same poisoned high-water
	// mark, concludes nothing is pending and never calls `runMigrations()` at
	// all. A repair living inside it would never run on exactly the installs
	// that need it.
	//
	// **Before the pre-migration backup decides.** `backupBeforeMigrations()`
	// asks the same question, so repairing afterwards would mean the backup was
	// skipped as unnecessary and then seven migrations landed on an unprotected
	// database — the one situation that module exists to prevent.
	if (!building) {
		// Deferred like its neighbours below; nothing here needs it earlier.
		const { repairMigrationLedger } = await import(
			"./migrationLedgerRepair"
		)
		await repairMigrationLedger(db, {
			migrationsFolder: dbConfig.migrationsDir
		})
	}

	// In dev, always run migrations unconditionally — never gated by the
	// meta.json/app version comparison below. Dev iteration adds new migration
	// files constantly without bumping the app version for each one (that
	// mismatch is exactly what silently skipped a real migration for an entire
	// debugging session once already), so version-gating in dev just means
	// "sometimes skip a migration that actually needs to run." drizzle's own
	// migrate() is idempotent — safe to call every startup regardless of the
	// stored meta.json version, it only applies what isn't already applied.
	// Did this boot move the stored version? Decides the seed pass below.
	let versionChanged = false

	if (building) {
		// no-op: see the `building` guard above
	} else if (dev) {
		await runMigrations()
	} else {
		// @ts-ignore
		const appVersion = __APP_VERSION__
		if (!appVersion) {
			throw new Error(
				"App version is not defined. Please set __APP_VERSION__."
			)
		}
		const versionCompare = compareVersions(meta.version, appVersion)

		switch (versionCompare) {
			case 0: {
				// Matching versions are not proof that the schema is current.
				// A rebuild that adds a migration without bumping the version,
				// a version stamped by an earlier boot that then found more
				// work, or a restored data directory all produce "versions
				// match" with migrations still outstanding — and skipping on
				// the version alone silently never applies them. This is the
				// same failure the dev branch above refuses to risk; the only
				// difference here is that the check is cheap enough to make
				// rather than assume.
				const { hasPendingMigrations } = await import("./backup")
				if (await hasPendingMigrations(db, dbConfig.migrationsDir)) {
					console.log(
						"Versions match but migrations are pending — running them."
					)
					await runMigrations()
				} else {
					console.log("No migration needed, versions match.")
				}
				break
			}
			case -1:
				console.log("Running migrations to update database schema...")
				await runMigrations()
				break
			case 1:
				console.warn(
					`Warning: Database version (${meta.version}) is newer than app version (${appVersion}).`
				)
				// This could happen if the app version is rolled back or if the database was manually updated
				// Handle this case as needed, e.g., notify the user or log an error
				throw new Error(
					`Database version (${meta.version}) is newer than app version (${appVersion}). Please check your database integrity.`
				)
			default:
				console.error(
					"Unexpected version comparison result:",
					versionCompare
				)
				throw new Error("Unexpected version comparison result")
		}
	}

	// Stamp the version only after migrations and their data upgrades have
	// succeeded. Writing it earlier would mark the upgrade done on a boot that
	// threw halfway through it.
	if (!building) {
		// `__APP_VERSION__` is a Vite build-time define. It genuinely does not
		// exist under vitest, so this has to be a `typeof` guard rather than a
		// truthiness check — referencing an undeclared identifier throws.
		// @ts-ignore
		const appVersion: string | null =
			// @ts-ignore
			typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null
		if (appVersion && meta.version !== appVersion) {
			meta.version = appVersion
			// Read-modify-write rather than dumping the in-memory copy.
			// `meta` was parsed at module scope, before the lock heartbeat
			// wrote `meta.lock`; writing the whole object from here would
			// blank the live lock until the next beat, nine seconds later.
			const current = readMetaFile(metaPath)
			const next: Record<string, unknown> = current.ok
				? current.meta
				: {
						version: meta.version,
						cryptoSecretKey: meta.cryptoSecretKey
					}
			next.version = appVersion
			writeMetaFile(metaPath, next)
			versionChanged = true
			console.log(`Updated meta.json to version ${appVersion}.`)
		}
	}

	// Keep immutable seed rows (default prompt configs, etc.) in sync with the
	// current code.
	//
	// **In dev, every boot.** Editing seed *text* in defaults.ts without
	// bumping the app version would otherwise never take effect on restart,
	// which is the whole reason this is not version-gated there.
	//
	// **In production, only when the version actually moved.** A released build
	// cannot have its seed text edited underneath it, so re-running the sync on
	// every boot of an unchanged version is pure startup cost — and this runs
	// before the app serves its first request. sync() stays fully idempotent
	// either way; this is about not paying for it needlessly.
	if (!building && (dev || versionChanged || treatAsFreshInstall)) {
		// Imported here rather than at module scope, and the difference is a real
		// cycle rather than style: `defaults.ts` imports `db` from this module, so
		// a static import makes the two initialise in a loop. It happened to work
		// only because some *other* module in the graph pulled `db` in first;
		// deleting the legacy prompt builder removed that module and the parity
		// suite started failing with `Cannot access '__vite_ssr_import_1__' before
		// initialization` — `db` still in its temporal dead zone while `sync()`
		// ran. Deferring the import to here means this module's body has finished
		// and `db` is a real value by the time `defaults.ts` reads it.
		const { sync } = await import("./defaults")
		await sync()

		// Seed core widgets' shipped style presets and prune any that were
		// dropped (PLAN 25). Deferred-imported for the same db-cycle reason as
		// `sync` above. Plugin widgets seed their own on install/update.
		const { syncWidgetStyles } = await import("./widgetStyles")
		const { CORE_WIDGETS } = await import("@serene-pub/core-catalog")
		// `withCorePresets` attaches the app's own message style packs to core's
		// primary widget. They are app-side because every selector in them is a
		// class the app's SessionMessage authors — markup the SDK has no view of
		// (shared/widgets/corePresets.ts).
		//
		// `pruneUndeclared` is core's claim that this IS the whole set of
		// widgets with shipped styles, so a widget core has stopped declaring
		// takes its system rows with it. Only core boot may say that; a plugin
		// sync speaks for its own ids alone.
		const { withCorePresets } = await import("$lib/shared/widgets/corePresets")
		await syncWidgetStyles(
			withCorePresets(CORE_WIDGETS),
			meta.version || "0.0.0",
			{ pruneUndeclared: true }
		)

		// Prune per-instance widget settings against the current declarations,
		// so a field core stopped declaring stops being stored (PLAN 25).
		const { syncWidgetSettings } = await import("./widgetSettings")
		await syncWidgetSettings(CORE_WIDGETS)
	}
}

/**
 * Resolves once the database itself is ready: schema migrations applied and
 * seed rows synced. Nothing beyond the database is in scope here — subsystem
 * bootstraps live in `$lib/server/startup`, which awaits this first.
 *
 * Await this before the first query on any path that can run at startup.
 */
export let dbReady: Promise<void> = initialiseDatabase()

/**
 * Mark `dbReady` handled the instant it exists.
 *
 * Nothing awaits it until `$lib/server/startup` is imported, and that import is
 * dynamic — it happens on the first request. A boot failure therefore rejects
 * an unheld promise, which Node treats as an unhandled rejection and, since v15,
 * terminates the process for: the app died before it could serve the page
 * explaining why. Attaching a handler here marks the promise handled without
 * consuming anything — `dbReady` still rejects for every real awaiter, which is
 * how `startup/index.ts` learns about it.
 */
void dbReady.catch(() => {})

/**
 * Open the database again, after a recovery has put a working one in place.
 *
 * The seam the recovery routes and the CLI need, and it is here rather than in
 * the caller because everything it has to reset is module state: the `db`
 * handle (an `export let`, so importers see the replacement through the live
 * binding), `dbReady` itself, the fresh-install decision, and the
 * shutdown-marker bookkeeping. A restore that could not re-open would leave the
 * owner staring at the recovery page having successfully recovered.
 *
 * **What it deliberately does not do.** It does not touch the lock — this
 * process still holds it and has held it throughout; a boot that failed to open
 * the database still acquired the directory. It does not add a top-level await
 * (see the note under `dbReady` and the one at the bottom of this file); the
 * new promise is created and handled exactly the way the first one was. And it
 * does not run the startup tasks — those belong to `$lib/server/startup`, which
 * exports its own `restartAfterRecovery()` and calls this first.
 *
 * Resolves with the outcome instead of throwing, because both outcomes are
 * pages the recovery route has to render: "restored, come on in" and "restored,
 * and it still will not open".
 */
export async function reopenDatabase(): Promise<
	{ ok: true } | { ok: false; error: unknown }
> {
	// The failed client's WASM runtime has aborted; closing it is a courtesy
	// that usually throws the same trap back. Measured, not assumed: a second
	// PGlite on the same path in the same process opens cleanly afterwards.
	try {
		await (
			db as unknown as { $client?: { close?: () => Promise<void> } }
		).$client?.close?.()
	} catch {
		// Already dead. That is the situation this function exists for.
	}
	openRecorded = false

	// A "start fresh" recovery leaves meta.json in place and takes the database
	// away, so the seed and data-upgrade decisions have to be re-derived from
	// what is actually on disk right now. See `treatAsFreshInstall`.
	treatAsFreshInstall = !fs.existsSync(dbConfig.dbPath)

	// Re-read, because a restore can have changed it: `db/recovery.ts` carries
	// `version` and `cryptoSecretKey` over from the backup's companion file, and
	// the migration gate below compares `meta.version` against the app's. Using
	// the copy parsed at module scope would compare against the version of the
	// database that was just moved aside.
	const refreshed = readMetaFile(metaPath)
	if (refreshed.ok) meta = refreshed.meta as unknown as MetaFile

	db = drizzle(dbConfig.dbPath, { schema })
	dbReady = initialiseDatabase()
	void dbReady.catch(() => {})

	try {
		await dbReady
		return { ok: true }
	} catch (error) {
		return { ok: false, error }
	}
}

// In dev and under test, keep the original contract: importing this module
// means the database is ready. Only the *production* bundle has the Rollup
// chunking that turns this top-level await into a deadlock — `vite dev` and
// vitest both run modules unbundled, where it is exactly as safe as it always
// was.
//
// The asymmetry is deliberate but worth naming, because "behaves differently in
// the production bundle" is the same property that hid the original bug: what
// changes between the two is only *when* this is awaited, never whether it
// runs. Production awaits `appReady` per request (`hooks.server.ts`) and before
// the socket handlers register (`attachSocketServer`), which covers every entry
// point.
//
// Dev and test additionally await here so migrations and seed sync can never
// run concurrently with a test. Without this line, a test file that merely
// touches this module leaves PGlite churning in the background for the rest of
// the run, and 5s int-test budgets that used to pass start failing several
// files away from the cause — confirmed by A/B, not guessed at. Do not delete
// it as redundant.
if (dev)
	await dbReady.catch((error) => {
		// Sequencing is what this await is for, not error propagation — and a
		// database that will not open is now a state the app boots into. Let
		// this throw and the module evaluation fails, `$lib/server/startup`
		// fails with it, and there is no server left to explain anything.
		// Everything else keeps the old, loud behaviour.
		if (!isDatabaseUnopenableError(error)) throw error
	})
