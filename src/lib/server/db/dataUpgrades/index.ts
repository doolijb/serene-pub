import fs from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"

/**
 * Data upgrades — the transformations SQL can't express.
 *
 * A drizzle migration changes *shape*; a data upgrade changes *content* using
 * real JavaScript (parsing, re-encoding, calling app code). Each one is pinned
 * to the migration it must follow, because ordering against schema changes is
 * the whole reason it can't just live in a startup task: an upgrade that reads
 * a column added by `0160` and rewrites it before `0161` makes it NOT NULL has
 * exactly one valid position in the sequence.
 *
 * **Atomic with its anchor.** The anchor migration's SQL, the upgrade, and
 * drizzle's own ledger row all commit in a single transaction. That is what
 * makes a crash safe: there is no window in which the schema has advanced past
 * an upgrade that never ran. Either the pair lands or neither does, and the
 * next boot retries both.
 *
 * **Never run on a fresh install.** A new database is created at the current
 * schema with no legacy content to transform, so every upgrade would be a
 * no-op at best and a misfire at worst. The caller decides this — see
 * `skipUpgrades` — from whether meta.json had a version before this boot.
 */
export interface DataUpgrade {
	/**
	 * Journal tag of the migration this must run immediately after, e.g.
	 * "0160_servers_and_tunnels". Not a filename and not an index — tags are
	 * stable, and index/order both shift when a migration is inserted.
	 */
	afterMigration: string
	/** Imported only when it is actually going to run. */
	load: () => Promise<{ run: (tx: any) => Promise<void> }>
}

/**
 * The registry, in no particular order — position is decided by
 * `afterMigration`, so entries can be listed however reads best.
 *
 * Adding one:
 *   1. Write `./<tag>.ts` exporting `run(tx)`.
 *   2. Add `{ afterMigration: "<tag>", load: () => import("./<tag>") }`.
 *
 * Keep them narrow. An upgrade runs against the schema as it existed at its
 * anchor migration, not today's — so it must not import app modules whose
 * queries drift with the schema. Raw SQL through `tx` ages far better.
 */
export const DATA_UPGRADES: DataUpgrade[] = []

function tagsInJournalOrder(migrationsFolder: string): string[] {
	const journalPath = path.join(migrationsFolder, "meta/_journal.json")
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"))
	const entries: { tag: string; when: number }[] = journal.entries

	// A `when` that is not strictly increasing makes a migration silently never
	// apply — drizzle compares against the newest applied row only, so anything
	// with a lower value looks like it is already in the past. The journal is
	// maintained by hand here (see the migration workflow), which is exactly
	// the situation where this happens and is invisible until data is missing.
	for (let i = 1; i < entries.length; i++) {
		if (entries[i].when <= entries[i - 1].when) {
			throw new Error(
				`Migration journal is out of order: "${entries[i].tag}" (when=${entries[i].when}) ` +
					`is not after "${entries[i - 1].tag}" (when=${entries[i - 1].when}). ` +
					`Later migrations would never be applied.`
			)
		}
	}
	return entries.map((e) => e.tag)
}

const MIGRATIONS_SCHEMA = "drizzle"
const MIGRATIONS_TABLE = "__drizzle_migrations"

/**
 * Apply pending migrations, running each data upgrade inside the same
 * transaction as the migration it is anchored to.
 *
 * Migrations without an upgrade are handed to drizzle in batches, so its own
 * applier and pending-detection stay in charge of the ordinary path. Only an
 * anchored migration is applied here directly, and only so the upgrade can join
 * its transaction.
 */
export async function runMigrationsWithUpgrades(
	db: any,
	{
		migrationsFolder,
		upgrades = DATA_UPGRADES,
		skipUpgrades = false
	}: {
		migrationsFolder: string
		upgrades?: DataUpgrade[]
		skipUpgrades?: boolean
	}
): Promise<{ applied: string[]; upgradesRun: string[] }> {
	const tags = tagsInJournalOrder(migrationsFolder)
	const files = readMigrationFiles({ migrationsFolder })
	if (files.length !== tags.length) {
		throw new Error(
			`Migration journal lists ${tags.length} entries but ${files.length} files were read.`
		)
	}

	const byTag = new Map(upgrades.map((u) => [u.afterMigration, u]))
	for (const tag of byTag.keys()) {
		if (!tags.includes(tag)) {
			// A typo here would otherwise mean an upgrade that silently never
			// runs — the failure mode this whole module exists to avoid.
			throw new Error(
				`Data upgrade is anchored to "${tag}", which is not in the migration journal.`
			)
		}
	}

	await db.execute(
		sql.raw(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`)
	)
	await db.execute(
		sql.raw(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
			id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`)
	)

	const applied: string[] = []
	const upgradesRun: string[] = []
	let batch: number[] = []

	async function flushBatch() {
		if (!batch.length) return
		const metas = batch.map((i) => files[i])
		await db.dialect.migrate(metas, db.session, { migrationsFolder })
		batch = []
	}

	async function highWaterMark(): Promise<number> {
		const res = await db.execute(
			sql.raw(`select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
				order by created_at desc limit 1`)
		)
		const rows = res.rows ?? res
		return rows.length ? Number(rows[0].created_at) : -1
	}

	for (let i = 0; i < files.length; i++) {
		const tag = tags[i]
		const upgrade = byTag.get(tag)
		if (!upgrade || skipUpgrades) {
			batch.push(i)
			continue
		}

		// Everything before the anchor goes through drizzle normally.
		await flushBatch()

		const meta = files[i]
		if ((await highWaterMark()) >= meta.folderMillis) continue // already applied

		await db.transaction(async (tx: any) => {
			for (const stmt of meta.sql) await tx.execute(sql.raw(stmt))
			await tx.execute(
				sql.raw(`insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
					("hash", "created_at") values ('${meta.hash}', ${meta.folderMillis})`)
			)
			const mod = await upgrade.load()
			await mod.run(tx)
		})
		applied.push(tag)
		upgradesRun.push(tag)
		console.log(`[data-upgrade] ran ${tag}`)
	}

	await flushBatch()
	return { applied, upgradesRun }
}
