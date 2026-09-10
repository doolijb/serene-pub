import fs from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import type { BackupSummary } from "./errors"
import { rawRows } from "./rawRows"

/**
 * Pre-migration database backups.
 *
 * A schema migration is the one routine operation that can destroy a user's
 * data irrecoverably, and this app's data directory is the only copy — there is
 * no managed Postgres to restore from, no point-in-time recovery, and for most
 * installs no external backup at all.
 *
 * Deliberately narrow in scope: taken **only when a migration is actually about
 * to run**, and never culled automatically. Backing up on every boot would put
 * a multi-megabyte write in front of every start for no benefit, and deleting a
 * user's backups without being asked is not a decision this module gets to
 * make. Retention controls come later.
 *
 * Note what a backup is *not* for. Because a data upgrade commits inside its
 * anchor migration's transaction (see ./dataUpgrades), a failed upgrade already
 * rolls itself back. This covers the case a transaction cannot: a migration
 * that succeeds and leaves the data wrong.
 */

const MIGRATIONS_SCHEMA = "drizzle"
const MIGRATIONS_TABLE = "__drizzle_migrations"

/**
 * The PGlite handle behind the drizzle instance, and the only driver-specific
 * thing this module needs.
 *
 * Reached through a cast because it is not on `PgDatabase` at all — and the
 * cast stays narrow on purpose: it names two methods on the CLIENT, so a driver
 * that cannot dump is refused by the `if` below with a sentence rather than
 * being excluded by a type nobody could satisfy. Nothing about a database ROW
 * passes through it, which is the difference between this and a `db as any`.
 */
type DumpableClient = {
	waitReady?: unknown
	dumpDataDir?: (compression: "gzip") => Promise<Blob>
}

/** Where dumps land, relative to the data directory. */
export const BACKUPS_DIR_NAME = "backups"

/**
 * Kept in step with `recovery.BACKUP_USERS_SUFFIX`, and spelled out here rather
 * than imported: `recovery.ts` imports *this* module, so importing it back at
 * module scope would close a cycle on the boot path. It is four characters and
 * one test pins the two together.
 */
const USERS_TIER_SUFFIX = ".users.tgz"

export interface BackupSettings {
	/** Take one a day, unattended (ruled 2026-09-10). Default on. */
	backupDaily: boolean
	/** Archive `users/` beside the dump. Default OFF — it is much larger. */
	backupIncludeUserFiles: boolean
}

export const BACKUP_SETTING_DEFAULTS: BackupSettings = {
	backupDaily: true,
	backupIncludeUserFiles: false
}

/**
 * Read the two backup settings without depending on the schema being current.
 *
 * Raw SQL and a total catch, both load-bearing. The earliest caller is
 * `backupBeforeMigrations`, which by definition runs against a database whose
 * schema is one or more migrations *behind* — including, on the upgrade that
 * introduces them, one where these columns do not exist yet. A drizzle query
 * would name them in a `select` and fail; this answers the defaults instead,
 * which is exactly the behaviour that install had a moment ago.
 */
export async function readBackupSettings(
	db: MigrationDb
): Promise<BackupSettings> {
	try {
		const rows = rawRows<{
			backup_daily: unknown
			backup_include_user_files: unknown
		}>(
			await db.execute(
				sql.raw(
					`select backup_daily, backup_include_user_files
					from "system_settings" order by id limit 1`
				)
			)
		)
		if (!rows.length) return BACKUP_SETTING_DEFAULTS
		return {
			backupDaily: rows[0].backup_daily !== false,
			backupIncludeUserFiles: rows[0].backup_include_user_files === true
		}
	} catch {
		// No table, no columns, or no database worth arguing with. The
		// defaults are the answer that keeps a backup being taken.
		return BACKUP_SETTING_DEFAULTS
	}
}

/**
 * What is in `backups/` right now, without opening anything.
 *
 * Deliberately synchronous and deliberately fs-only: its caller is the path
 * where the database refused to open, so "ask the database" is not available
 * and "throw while explaining a failure" is not acceptable. An unreadable or
 * absent directory reports zero rather than raising.
 *
 * Newest by modification time rather than by the timestamp in the filename —
 * the two agree for anything this app wrote, and mtime is still right for a
 * file the owner copied in by hand.
 */
export function summariseBackups(dataDir: string): BackupSummary {
	const backupsDir = path.join(dataDir, BACKUPS_DIR_NAME)
	let newestBackup: string | null = null
	let newestAt = -Infinity
	let backupCount = 0

	let entries: string[]
	try {
		entries = fs.readdirSync(backupsDir)
	} catch {
		return { backupsDir, backupCount: 0, newestBackup: null }
	}

	for (const name of entries) {
		if (!name.endsWith(".tgz")) continue
		// A user-file tier is a `.tgz` beside a dump, not a backup of its own.
		// Counting it would tell an owner on the recovery page that they have
		// twice as many restorable backups as they do.
		if (name.endsWith(USERS_TIER_SUFFIX)) continue
		backupCount += 1
		try {
			const at = fs.statSync(path.join(backupsDir, name)).mtimeMs
			if (at > newestAt) {
				newestAt = at
				newestBackup = name
			}
		} catch {
			// Vanished between the listing and the stat. It is still one of the
			// files that is there, it just cannot be the newest one we name.
		}
	}

	return { backupsDir, backupCount, newestBackup }
}

/**
 * Whether any migration in the folder has not been applied yet.
 *
 * Mirrors drizzle's own rule exactly — it compares against the newest applied
 * row only, so "pending" means "has a `folderMillis` greater than the high
 * water mark", not "is absent from the table".
 */
export async function hasPendingMigrations(
	db: MigrationDb,
	migrationsFolder: string
): Promise<boolean> {
	const files = readMigrationFiles({ migrationsFolder })
	if (!files.length) return false

	let applied: number
	try {
		const rows = rawRows<{ created_at: unknown }>(
			await db.execute(
				sql.raw(`select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
				order by created_at desc limit 1`)
			)
		)
		applied = rows.length ? Number(rows[0].created_at) : -1
	} catch {
		// No migrations table yet — nothing has ever been applied here.
		return true
	}
	return files.some((f) => f.folderMillis > applied)
}

export interface BackupResult {
	path: string
	bytes: number
	/** Where the user-file tier went, or null when none was asked for. */
	usersPath: string | null
	/** Its size. 0 when there is none. */
	usersBytes: number
}

/**
 * Write a compressed dump of the whole PGlite data directory.
 *
 * `dumpDataDir` is PGlite's own tar of the database, so this needs no
 * `pg_dump` binary and captures everything a restore would need — including
 * the `drizzle.__drizzle_migrations` ledger, so a restored copy knows exactly
 * which migrations it has.
 */
export async function backupDatabase(
	db: MigrationDb,
	{
		dataDir,
		label,
		includeUserFiles = false
	}: {
		dataDir: string
		/** Goes in the filename — normally the version being upgraded *from*. */
		label: string
		/** Also archive `<dataDir>/users/` beside the dump (ruled 2026-09-10). */
		includeUserFiles?: boolean
	}
): Promise<BackupResult> {
	const client = (db as { $client?: DumpableClient }).$client
	if (!client?.dumpDataDir) {
		throw new Error(
			"This database driver cannot produce a backup (no dumpDataDir)."
		)
	}

	const dir = path.join(dataDir, BACKUPS_DIR_NAME)
	fs.mkdirSync(dir, { recursive: true })

	// Colons are legal on POSIX and not on Windows, and this path is written on
	// both — so the timestamp is dashed rather than ISO.
	const stamp = new Date()
		.toISOString()
		.replace(/[:.]/g, "-")
		.replace("Z", "")
	const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "_")
	const file = path.join(dir, `serene-pub-${safeLabel}-${stamp}.tgz`)

	// PGlite boots its WASM filesystem lazily, so a dump taken before any query
	// has run finds no FS at all. In practice the pending-migration check has
	// already queried by this point, but a backup routine must not depend on
	// something else having warmed the database first.
	await client.waitReady

	const blob: Blob = await client.dumpDataDir("gzip")
	const bytes = Buffer.from(await blob.arrayBuffer())

	// Written to a temp name and renamed, so an interrupted dump can never be
	// mistaken for a usable backup — rename is atomic within a filesystem.
	const tmp = `${file}.partial`
	fs.writeFileSync(tmp, bytes)
	fs.renameSync(tmp, file)

	archiveMetaFile(dataDir, file)
	const users = includeUserFiles
		? await archiveUserFiles(dataDir, file)
		: null

	return {
		path: file,
		bytes: bytes.length,
		usersPath: users?.path ?? null,
		usersBytes: users?.bytes ?? 0
	}
}

/**
 * Write the optional user-file tier beside the dump.
 *
 * `recovery.ts` owns the packing, and it is reached by a **dynamic** import
 * because it imports this module at its own top level — a static import back
 * would close a cycle on the boot path, which `db/index.ts` documents at length
 * as the shape that deadlocks a production bundle.
 *
 * Best effort, like `archiveMetaFile` and for the same reason: a dump that
 * exists without its media is worth far more than a boot that stopped because
 * one image was unreadable. The warning names what is missing.
 */
async function archiveUserFiles(
	dataDir: string,
	archivePath: string
): Promise<{ path: string; bytes: number } | null> {
	try {
		const { packUserFiles } = await import("./recovery")
		return await packUserFiles(dataDir, archivePath)
	} catch (error) {
		console.warn(
			`Warning: could not archive user files beside ${path.basename(archivePath)} — ` +
				`${String((error as Error)?.message ?? error)}. The database backup itself is fine.`
		)
		return null
	}
}

/**
 * Keep a copy of `meta.json` beside every dump (ruling 3, 2026-09-09).
 *
 * `dumpDataDir` covers `serene-pub.db/` and nothing else, but the key that
 * decrypts every stored API passphrase is not in there — it is
 * `cryptoSecretKey` in the sibling `meta.json`. A dump restored without it
 * opens onto a database full of ciphertext nobody can read. So the pair travels
 * together.
 *
 * **Beside, not inside.** The archive stays byte-for-byte what PGlite produced,
 * because that is what `PGlite.create({ loadDataDir })` consumes, what the CLI
 * consumes, and what the by-hand `tar xzf` route in docs/troubleshooting.md
 * consumes. Rewriting the tar to inject a file would break that identity and
 * drop a foreign file into `PGDATA` on every manual restore. A companion also
 * makes "does this backup carry its key?" one `existsSync`.
 *
 * Best effort by design: a backup that exists without its companion is worth
 * far more than no backup, so a missing or unreadable `meta.json` warns and
 * carries on. `db/recovery.ts` handles the no-companion case by keeping the
 * instance's current `meta.json`.
 */
function archiveMetaFile(dataDir: string, archivePath: string): void {
	const metaPath = path.join(dataDir, "meta.json")
	try {
		if (!fs.existsSync(metaPath)) return
		const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		if (!parsed || typeof parsed !== "object") return
		// `lock` is this process's live claim on the data directory. Archiving
		// it would put a months-old lock in front of a future restore.
		delete parsed.lock
		fs.writeFileSync(
			`${archivePath}.meta.json`,
			JSON.stringify(parsed, null, 2)
		)
	} catch (error) {
		console.warn(
			`Warning: could not archive meta.json beside ${path.basename(archivePath)} — ` +
				`${String((error as Error)?.message ?? error)}. The backup itself is fine.`
		)
	}
}

/**
 * Back up before migrating, and refuse to migrate if that fails.
 *
 * Aborting is the point. A migration that proceeds after a failed backup is
 * exactly the situation the backup existed to prevent, so the error is
 * propagated rather than logged — a boot that stops with a clear reason is
 * recoverable; one that upgrades unprotected may not be.
 */
export async function backupBeforeMigrations(
	db: MigrationDb,
	{
		dataDir,
		migrationsFolder,
		label,
		isFreshInstall
	}: {
		dataDir: string
		migrationsFolder: string
		label: string
		isFreshInstall: boolean
	}
): Promise<BackupResult | null> {
	// Nothing to protect: a database created moments ago has no user data, and
	// dumping an empty one on every first run is pure noise.
	if (isFreshInstall) return null
	if (!(await hasPendingMigrations(db, migrationsFolder))) return null

	// Read before the migration runs, so on the upgrade that adds these columns
	// the answer is the defaults — see `readBackupSettings`. An owner who wants
	// their media covered gets it from the next backup onwards, which is the
	// conservative direction to be wrong in.
	const { backupIncludeUserFiles } = await readBackupSettings(db)
	const result = await backupDatabase(db, {
		dataDir,
		label,
		includeUserFiles: backupIncludeUserFiles
	})
	console.log(
		`Database backed up before migrating: ${result.path} ` +
			`(${(result.bytes / 1024 / 1024).toFixed(1)} MB)` +
			(result.usersPath
				? `, with ${(result.usersBytes / 1024 / 1024).toFixed(1)} MB of user files beside it`
				: "")
	)
	return result
}
