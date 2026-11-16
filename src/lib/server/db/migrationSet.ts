/**
 * The migration set a build was made with, and the check that boot runs it
 * against the `drizzle/` beside it.
 *
 * `drizzle/` is read at RUNTIME, not bundled: a build is server code plus
 * whatever migration files sit next to it when it starts. Server code knows
 * the migrations it was written for — data upgrades are registered by tag and
 * run between them (`dataUpgrades/`) — so a build older than the files on
 * disk runs migrations it has never heard of, and skips the upgrades that
 * belong between them. A `vite preview` of a stale `build/` did exactly that
 * to a live 0.5.3 database: it ran the new 0095 without the attic stash.
 *
 * So the build carries a fingerprint of the set (`__MIGRATION_SET__`,
 * vite.config.ts `define`), and a production boot refuses to migrate — before
 * any write — when the set on disk is a different one. Dev skips it: `vite
 * dev` reads live source, so its code and its migrations always agree.
 *
 * No `$lib` imports: vite.config.ts imports this at build time.
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { readMigrationFiles } from "drizzle-orm/migrator"

export interface MigrationSet {
	/** sha256 over each journal entry and its SQL file, in journal order. */
	fingerprint: string
	count: number
	latestTag: string | null
}

/** What drizzle's `readMigrationFiles` returns. */
export type MigrationFiles = ReturnType<typeof readMigrationFiles>

type Journal = {
	entries?: { idx: number; tag: string; when: number; breakpoints: boolean }[]
}

/**
 * Key of the set on disk: the journal's and each listed SQL file's `mtimeMs`
 * and `size` (a stat, never a read). Any edit to the set changes a stamp or a
 * size, so a stale answer is impossible; a missing file throws here, as the
 * read would have.
 */
function setKey(folder: string): { key: string; journal: Journal } {
	const journalPath = path.join(folder, "meta/_journal.json")
	const js = fs.statSync(journalPath)
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal
	let key = `${js.mtimeMs}:${js.size}`
	for (const e of journal.entries ?? []) {
		const st = fs.statSync(path.join(folder, `${e.tag}.sql`))
		key += `|${e.tag}:${st.mtimeMs}:${st.size}`
	}
	return { key, journal }
}

const filesMemo = new Map<string, { key: string; files: MigrationFiles }>()
const setMemo = new Map<string, { key: string; set: MigrationSet }>()

/**
 * Drizzle's own `readMigrationFiles`, read and hashed once per process for an
 * unchanged set. Drizzle's reader stays the only hasher: the ledger repair's
 * byte-identity guarantee rests on its hash being the one its migrator writes.
 * Memo key and invalidation: see `setKey`. One entry per folder; the array is a
 * copy, so a caller cannot reorder the cache.
 */
export function readMigrationFilesMemo(
	migrationsFolder: string
): MigrationFiles {
	const folder = path.resolve(migrationsFolder)
	const { key } = setKey(folder)
	let hit = filesMemo.get(folder)
	if (!hit || hit.key !== key) {
		hit = { key, files: readMigrationFiles({ migrationsFolder }) }
		filesMemo.set(folder, hit)
	}
	return [...hit.files]
}

/** The set in `migrationsFolder`, as its journal lists it. */
export function readMigrationSet(migrationsFolder: string): MigrationSet {
	const folder = path.resolve(migrationsFolder)
	const { key, journal } = setKey(folder)
	const hit = setMemo.get(folder)
	if (hit && hit.key === key) return { ...hit.set }
	const entries = journal.entries ?? []
	const hash = createHash("sha256")
	for (const e of entries) {
		hash.update(`${e.idx}\0${e.tag}\0${e.when}\0${e.breakpoints}\0`)
		// Line endings normalised: a Windows checkout of the same files is the
		// same set.
		const sql = fs
			.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8")
			.replace(/\r\n/g, "\n")
		hash.update(sql)
		hash.update("\0")
	}
	const set: MigrationSet = {
		fingerprint: hash.digest("hex"),
		count: entries.length,
		latestTag: entries.at(-1)?.tag ?? null
	}
	setMemo.set(folder, { key, set })
	return { ...set }
}

export const STALE_BUILD_MESSAGE =
	"This build is older (or newer) than its database migrations — run `npm run build` again."

/** Boot refused: this build was made with a different migration set than the one on disk. */
export class StaleBuildError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "StaleBuildError"
	}
}

/**
 * Throws a `StaleBuildError` when `built` — the set the build was made with —
 * is not the set in `migrationsFolder`. Nothing to compare (`built`
 * undefined: vitest, which has no `define`) passes.
 */
export function assertBuildMatchesMigrations(
	built: MigrationSet | undefined,
	migrationsFolder: string
): void {
	if (!built) return
	let onDisk: MigrationSet
	try {
		onDisk = readMigrationSet(migrationsFolder)
	} catch (error) {
		throw new StaleBuildError(
			`${STALE_BUILD_MESSAGE} The migrations beside it (${path.resolve(migrationsFolder)}) ` +
				`could not be read: ${(error as Error)?.message ?? error}. Nothing was migrated.`
		)
	}
	if (onDisk.fingerprint === built.fingerprint) return
	throw new StaleBuildError(
		`${STALE_BUILD_MESSAGE} It was built with ${built.count} migrations ` +
			`(newest ${built.latestTag ?? "none"}); ${path.resolve(migrationsFolder)} has ` +
			`${onDisk.count} (newest ${onDisk.latestTag ?? "none"}). Nothing was migrated.`
	)
}
