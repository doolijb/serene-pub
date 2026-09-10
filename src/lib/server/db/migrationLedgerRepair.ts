import fs from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { rawRows } from "./rawRows"

/**
 * Put `drizzle.__drizzle_migrations` back in agreement with the journal.
 *
 * ## What breaks, and why nothing else can fix it
 *
 * Drizzle decides what to apply by comparing each journal entry's `when`
 * against the *highest* `created_at` in the ledger — not by asking whether a
 * given migration is present. A row recording a `created_at` above the stamp of
 * the file it came from therefore plants a floor: every later migration falls
 * under it and is skipped, silently, with no error and no log line, on every
 * boot from then on.
 *
 * That is not hypothetical. `0100_narration_split_reprojection` shipped for a
 * window stamped `1788910000000` — a round number picked by hand, about a day
 * ahead of the clock — and was corrected to the `1788827887780` it was actually
 * generated at. Correcting the journal fixed every database that had not yet
 * applied 0100 and did nothing for the ones that had: their ledger still says
 * `1788910000000`, so 0101 onward will not apply until wall time passes it.
 * The install that reported this had 101 rows, seven skipped migrations and a
 * live `column "notes" does not exist` from `connections:list`.
 *
 * A migration cannot repair this, because a migration is exactly the thing that
 * will not run. Nor can the journal: it is already correct. The stale value is
 * in the user's database, so the fix has to be a write to the user's database,
 * before drizzle is asked what is pending.
 *
 * ## How a row is matched to a file
 *
 * A ledger row holds a hash and a `created_at` — no tag, no index. The hash is
 * the sha256 of the migration file's full text, so it is the only handle there
 * is, and reproducing it exactly is what makes this repair work rather than
 * quietly match nothing. `readMigrationFiles` is drizzle's own reader, used
 * here for precisely that reason: hashing that merely *looks* right would leave
 * every affected install stuck while reporting success. See
 * ./migrationLedgerRepair.test.ts, which pins the scheme against a hash taken
 * from a real ledger.
 */

const MIGRATIONS_SCHEMA = "drizzle"
const MIGRATIONS_TABLE = "__drizzle_migrations"

const LEDGER = `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`

export interface JournalMigration {
	/** e.g. "0100_narration_split_reprojection". */
	tag: string
	/** The journal's stamp — what a correct ledger row records. */
	when: number
	/** sha256 of the file's full text, as drizzle writes it. */
	hash: string
}

export interface RepairedLedgerRow {
	tag: string
	/** The `created_at` the row held. */
	from: number
	/** The journal `when` it was set to. */
	to: number
}

export interface UnrecognisedLedgerRow {
	id: number
	hash: string
	createdAt: number
}

export interface LedgerRepairResult {
	repaired: RepairedLedgerRow[]
	unrecognised: UnrecognisedLedgerRow[]
}

/**
 * Every journal entry with the hash drizzle would write for it.
 *
 * Tags come from the journal and hashes from `readMigrationFiles`, which are
 * two reads of the same file zipped by index — safe only because that function
 * iterates `journal.entries` in order, which is also what `dataUpgrades`
 * relies on. The length check is the guard on that assumption; without it a
 * drift would mislabel every log line rather than fail.
 */
export function readJournalMigrations(
	migrationsFolder: string
): JournalMigration[] {
	const journalPath = path.join(migrationsFolder, "meta/_journal.json")
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
		entries: { tag: string; when: number }[]
	}
	const files = readMigrationFiles({ migrationsFolder })
	if (files.length !== journal.entries.length) {
		throw new Error(
			`Migration journal lists ${journal.entries.length} entries but ${files.length} files were read.`
		)
	}
	return journal.entries.map((entry, i) => ({
		tag: entry.tag,
		when: entry.when,
		hash: files[i].hash
	}))
}

/** Whether this database has a migrations ledger at all. */
async function ledgerExists(db: MigrationDb): Promise<boolean> {
	// `to_regclass` answers with NULL rather than raising for a missing schema,
	// so this stays a question rather than an exception to swallow. Catching
	// instead would also swallow a real failure — and a repair that skips
	// itself on an error nobody sees is the failure mode this module exists to
	// prevent.
	const rows = rawRows<{ present: unknown }>(
		await db.execute(
			sql.raw(`select to_regclass('${LEDGER}') is not null as present`)
		)
	)
	return rows.length ? Boolean(rows[0].present) : false
}

/**
 * Repair the ledger, and report exactly what was touched.
 *
 * Idempotent: a second call over a repaired ledger finds no disagreement and
 * writes nothing.
 *
 * **Both directions are corrected**, not just the stamps that are too high. A
 * row below its file's `when` is the mirror failure — drizzle would re-apply a
 * migration that has already run, which fails outright on the first `CREATE
 * TABLE`. Journal `when`s only increase, and drizzle applies in order, so a
 * correction toward the journal cannot step over a migration that has not run.
 *
 * **A row whose hash matches no shipped file is left alone**, and said out
 * loud. It means either that the file was edited after this database applied
 * it, or that the row came from a build this one does not contain — and in
 * both cases there is no honest way to guess which entry it belongs to. Moving
 * it on a guess could skip a migration rather than unblock one.
 */
export async function repairMigrationLedger(
	db: MigrationDb,
	{ migrationsFolder }: { migrationsFolder: string }
): Promise<LedgerRepairResult> {
	const empty: LedgerRepairResult = { repaired: [], unrecognised: [] }

	// A fresh install has no ledger yet; the migrator creates it. Nothing to
	// disagree with.
	if (!(await ledgerExists(db))) return empty

	const byHash = new Map(
		readJournalMigrations(migrationsFolder).map((m) => [m.hash, m])
	)

	const rows = rawRows<{ id: unknown; hash: unknown; created_at: unknown }>(
		await db.execute(
			sql.raw(
				`select id, hash, created_at from ${LEDGER} order by id asc`
			)
		)
	)

	// Decided in full before anything is written, so the summary below is
	// printed *before* the first UPDATE rather than after the last one. A boot
	// interrupted mid-repair then still says what it was doing.
	const plan: (RepairedLedgerRow & { id: number })[] = []
	const unrecognised: UnrecognisedLedgerRow[] = []

	for (const row of rows) {
		const createdAt = Number(row.created_at)
		const entry = byHash.get(String(row.hash))
		if (!entry) {
			unrecognised.push({
				id: Number(row.id),
				hash: String(row.hash),
				createdAt
			})
			continue
		}
		if (createdAt === entry.when) continue
		plan.push({
			id: Number(row.id),
			tag: entry.tag,
			from: createdAt,
			to: entry.when
		})
	}

	if (plan.length) {
		console.log(
			`[migration-ledger] ${plan.length} row(s) record a created_at that disagrees with the migration journal. ` +
				`Every migration stamped below the highest of them would never apply. Correcting:`
		)
	}

	const repaired: RepairedLedgerRow[] = []
	for (const item of plan) {
		// Deliberately one auto-committed statement per row rather than a
		// transaction. Each correction is toward the journal, which is the
		// target state, so a boot that dies part-way leaves a ledger the next
		// boot finishes — whereas a rollback would leave one that stays stuck.
		//
		// Parameterised rather than interpolated: `when` is read from a JSON
		// file and lands in a write to the one table the migrator trusts.
		await db.execute(
			sql`update ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}
				set created_at = ${item.to} where id = ${item.id}`
		)
		console.log(
			`[migration-ledger] repaired ${item.tag}: created_at ${item.from} -> ${item.to}`
		)
		repaired.push({ tag: item.tag, from: item.from, to: item.to })
	}

	for (const row of unrecognised) {
		console.warn(
			`[migration-ledger] ⚠ ledger row id=${row.id} (hash ${row.hash.slice(0, 12)}…, created_at ${row.createdAt}) ` +
				`matches no migration file in ${migrationsFolder} — left untouched. ` +
				`Its migration file was edited after this database applied it, or it came from a different build.`
		)
	}

	return { repaired, unrecognised }
}
