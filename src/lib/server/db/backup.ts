import fs from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"

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
 * Whether any migration in the folder has not been applied yet.
 *
 * Mirrors drizzle's own rule exactly — it compares against the newest applied
 * row only, so "pending" means "has a `folderMillis` greater than the high
 * water mark", not "is absent from the table".
 */
export async function hasPendingMigrations(
	db: any,
	migrationsFolder: string
): Promise<boolean> {
	const files = readMigrationFiles({ migrationsFolder })
	if (!files.length) return false

	let applied: number
	try {
		const res = await db.execute(
			sql.raw(`select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
				order by created_at desc limit 1`)
		)
		const rows = res.rows ?? res
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
	db: any,
	{
		dataDir,
		label
	}: {
		dataDir: string
		/** Goes in the filename — normally the version being upgraded *from*. */
		label: string
	}
): Promise<BackupResult> {
	const client = (db as { $client?: any }).$client
	if (!client?.dumpDataDir) {
		throw new Error(
			"This database driver cannot produce a backup (no dumpDataDir)."
		)
	}

	const dir = path.join(dataDir, "backups")
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

	return { path: file, bytes: bytes.length }
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
	db: any,
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

	const result = await backupDatabase(db, { dataDir, label })
	console.log(
		`Database backed up before migrating: ${result.path} ` +
			`(${(result.bytes / 1024 / 1024).toFixed(1)} MB)`
	)
	return result
}
