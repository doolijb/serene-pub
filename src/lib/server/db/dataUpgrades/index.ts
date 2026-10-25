import fs from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator"
import { rawRows } from "../rawRows"

/**
 * Data upgrades — the transformations SQL can't express.
 *
 * A drizzle migration changes *shape*; a data upgrade changes *content* using
 * real JavaScript (parsing, re-encoding, calling app code). Each one is pinned
 * to the migration it must follow, because ordering against schema changes is
 * the whole reason it can't just live in a startup task: an upgrade that reads
 * a column added by one migration and rewrites it before the next makes it NOT NULL has
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
	/**
	 * Imported only when it is actually going to run.
	 *
	 * `MigrationTx` is the raw-SQL half of a transaction and nothing more,
	 * which is the doctrine below expressed as a type: an upgrade runs against
	 * the schema as it existed at its anchor migration, not today's, so it must
	 * not reach for the schema-typed table objects that drift out from under
	 * it.
	 */
	load: () => Promise<{
		/**
		 * Runs inside the anchor's transaction BEFORE the anchor's SQL, so it
		 * sees the schema of the migration just below the anchor. For content
		 * the anchor's DDL would otherwise destroy: move it aside here, put it
		 * back once the new shape exists.
		 */
		before?: (tx: MigrationTx, ctx: DataUpgradeContext) => Promise<void>
		/** Runs inside the same transaction AFTER the anchor's SQL. */
		run: (tx: MigrationTx, ctx: DataUpgradeContext) => Promise<void>
	}>
}

/** What the runner knows that an upgrade cannot read for itself. */
export interface DataUpgradeContext {
	/**
	 * The sha256 of every migration file in the chain this build ships — the
	 * hashes drizzle writes to its ledger. The 0.5.3 upgrade prunes ledger
	 * rows that match none of them.
	 */
	shippedHashes: ReadonlySet<string>
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
export const DATA_UPGRADES: DataUpgrade[] = [
	// The 0.5.3 → 0.6.0 upgrade. `before` moves every 0.5.3 table into the
	// `attic_0_5_3` schema and empties `public`, so the generated schema
	// migration only ever alters empty tables; the `attic` startup task puts
	// the rows back in the 0.6 shape. See ./0095_schema_0_6_0.ts.
	{
		afterMigration: "0095_schema_0_6_0",
		load: () => import("./0095_schema_0_6_0")
	},
	{
		afterMigration: "0107_story_genre",
		load: () => import("./0107_story_genre")
	},
	// 🚧 Registrations (PLAN-layering D7): bindings, configurations, action
	// toggles and genre tasks moved into the rows that say them now.
	{
		afterMigration: "0108_layering_registrations",
		load: () => import("./0108_layering_registrations")
	},
	// 🚧 O3: each generating model's single modality → what it writes.
	{
		afterMigration: "0109_omni_model_kinds",
		load: () => import("./0109_omni_model_kinds")
	},
	// 🚧 R50, R55 (lane F1): the pub's configuration → a pipeline's instance
	// values; Story's `applyActionChanges` removed.
	{
		afterMigration: "0110_layering_follow_ups",
		load: () => import("./0110_layering_follow_ups")
	},
	// 🚧 The Lair rewrite (PLAN-lair-build D11): old Lair sessions onto the
	// Rules preset, its retired fields and specs carried or dropped.
	{
		afterMigration: "0112_lair_rewrite",
		load: () => import("./0112_lair_rewrite")
	},
	// 🚧 Rulesets made on the pub onto check methods (PLAN-rulesets-authoring
	// D6, lane M4): the die, bands, amounts, tags and the spell-point pool.
	{
		afterMigration: "0118_rulesets_check_methods",
		load: () => import("./0118_rulesets_check_methods")
	},
	// 🚧 Rulesets as functions (PLAN-rulesets-functions D2, D5, lane A1): pub
	// rulesets into the seven sections; list-slot pieces of a ruleset moved
	// there copied into its owners' carried zones (`zone_contents`, 0119).
	{
		afterMigration: "0119_rulesets_functions",
		load: () => import("./0119_rulesets_functions")
	},
	// 🚧 Story's reply onto its `reply.prose` branch (PLAN-rulesets-functions
	// D7, merge M1): what is stored by node key for `generate`, `save` and
	// the sprite steps moves to `reply.prose.<key>`.
	{
		afterMigration: "0120_rulesets_reply_changes",
		load: () => import("./0120_rulesets_reply_changes")
	},
	// 🚧 Story's reply tail, once, after the junction (RF fix 3): the save,
	// the sprite steps and the commit back at their top-level keys.
	{
		afterMigration: "0123_story_reply_tail",
		load: () => import("./0123_story_reply_tail")
	},
	// 🚧 Genre slots retire (RF fix 8): a value a session held on a retired
	// genre slot moves onto the rules' attribute of the same tag, else into
	// the session's notes as a line; the slot's rows go.
	{
		afterMigration: "0126_genre_slots_retire",
		load: () => import("./0126_genre_slots_retire")
	},
	// 🚧 pr-6: a row Back took out before the mirror had the column carries
	// its ordinal across once (`messages.rewind_ordinal`).
	{
		afterMigration: "0127_pr6_settle_line",
		load: () => import("./0127_pr6_settle_line")
	},
	// 🚧 pr-6s2 (C4): core's runtime keys move onto annex owner `core`, the branch marker onto its columns.
	{
		afterMigration: "0128_pr6s2_core_annex",
		load: () => import("./0128_pr6s2_core_annex")
	}
]

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
 * Drizzle's own applier, which has no public type.
 *
 * `dialect` and `session` are real properties on every `PgDatabase` at runtime
 * and are marked `@internal`, so declaration emit strips them from the
 * published `.d.ts`. There is no supported alternative for what this module
 * does: `drizzle-orm/pglite/migrator`'s `migrate()` applies EVERY pending
 * migration in one go, and the whole point here is to apply them up to an
 * anchor, stop, and let a data upgrade join that transaction.
 *
 * So it is a cast — but a narrow, named, row-free one. It exposes the applier
 * and nothing else, which is what separates it from the `db: any` this
 * parameter used to be: an `any` here made every row read anywhere downstream
 * of this handle unchecked too, and this cannot.
 *
 * ⚠ If a drizzle upgrade ever moves `dialect`/`session`, this throws at the
 * first batch rather than mis-applying anything — the failure is loud and it is
 * at boot.
 */
type MigrationApplier = {
	dialect: {
		migrate(
			migrations: MigrationMeta[],
			session: unknown,
			config: { migrationsFolder: string }
		): Promise<void>
	}
	session: unknown
}

const applier = (db: MigrationDb): MigrationApplier =>
	db as MigrationDb & MigrationApplier

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
	db: MigrationDb,
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
	const ctx: DataUpgradeContext = {
		shippedHashes: new Set(files.map((f) => f.hash))
	}
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
		const { dialect, session } = applier(db)
		await dialect.migrate(metas, session, { migrationsFolder })
		batch = []
	}

	async function highWaterMark(): Promise<number> {
		const rows = rawRows<{ created_at: unknown }>(
			await db.execute(
				sql.raw(`select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
				order by created_at desc limit 1`)
			)
		)
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

		const mod = await upgrade.load()
		await db.transaction(async (tx) => {
			if (mod.before) await mod.before(tx, ctx)
			for (const stmt of meta.sql) await tx.execute(sql.raw(stmt))
			await tx.execute(
				sql.raw(`insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
					("hash", "created_at") values ('${meta.hash}', ${meta.folderMillis})`)
			)
			await mod.run(tx, ctx)
		})
		applied.push(tag)
		upgradesRun.push(tag)
		console.log(`[data-upgrade] ran ${tag}`)
	}

	await flushBatch()
	return { applied, upgradesRun }
}
