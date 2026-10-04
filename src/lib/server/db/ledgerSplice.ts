import { createHash } from "crypto"
import { sql } from "drizzle-orm"
import { rawRows } from "./rawRows"
import { ledgerExists, readJournalMigrations } from "./migrationLedgerRepair"
import {
	PRESQUASH_CHAIN,
	SQUASHED_CHAIN,
	type PresquashMigration
} from "./ledgerSpliceChain"

/**
 * The ledger splice: carry a development database migrated by the pre-squash
 * 0.6 chain onto the squashed one.
 *
 * ⏳ Transitional (NOMENCLATURE §19). Before tagging 0.6.0-pr-1 the 0.6
 * migrations `0095`–`0111` were squashed into one generated
 * `0095_schema_0_6_0` (owner ruling 2026-10-03; the old files are archived in
 * `~/.claude/plans/ARCHIVE-drizzle-migrations-0094-0111-pr1.tar.gz`). No
 * released install ever applied the old chain, but a development data
 * directory has, and drizzle matches ledger rows by hash: to it the new `0095`
 * would be pending, and it would try to create every 0.6 table again.
 *
 * ## What it does
 *
 * Only a ledger holding pre-squash rows is touched; everything else returns
 * at once, so a fresh pub, a 0.5.3 database and one already on the squashed
 * chain never get past the first query.
 *
 * - **The whole pre-squash chain applied** (`0094`–`0111`): the schema is the
 *   squashed chain's, catalog for catalog (proven when the squash was made —
 *   tables, columns and their order, constraints, indexes, sequences,
 *   functions). Only the ledger changes: the pre-squash rows go, and the
 *   squashed chain's rows go in with its journal stamps.
 * - **A prefix of it applied** (through at least the old `0095`): the missing
 *   pre-squash files are replayed first, from the byte-exact copies in
 *   `./ledgerSpliceChain.ts`, and then the ledger is rewritten as above. Both
 *   in one transaction, so a failure leaves the database as it was.
 * - **Anything else** — a gap in the pre-squash rows, a squashed-chain row
 *   beside them, a row no build here knows: refused before anything is
 *   written, with one line telling the owner to move the data directory aside.
 *
 * Runs before `repairMigrationLedger` and before the pre-migration backup is
 * decided, so `beforeWrite` (the boot passes a backup) is how the one write it
 * makes is protected.
 */

export interface LedgerSpliceResult {
	/** Whether the ledger was rewritten. */
	spliced: boolean
	/** Pre-squash migrations replayed before the rewrite, in order. */
	replayed: string[]
}

/** Boot refused: a pre-squash ledger this build cannot carry across. */
export class LedgerSpliceRefusal extends Error {
	constructor(message: string) {
		super(message)
		this.name = "LedgerSpliceRefusal"
	}
}

const LEDGER = `"drizzle"."__drizzle_migrations"`
const BREAKPOINT = "--> statement-breakpoint"

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

export async function spliceSquashedLedger(
	db: MigrationDb,
	{
		migrationsFolder,
		dataDir,
		beforeWrite
	}: {
		migrationsFolder: string
		/** Named in the refusal, so the owner knows which directory to move. */
		dataDir?: string
		/** Called once, just before the first write. */
		beforeWrite?: () => Promise<void>
	}
): Promise<LedgerSpliceResult> {
	const nothing: LedgerSpliceResult = { spliced: false, replayed: [] }
	if (!(await ledgerExists(db))) return nothing

	const squashedHashes = new Set(SQUASHED_CHAIN.map((m) => m.hash))
	const presquashAt = new Map(PRESQUASH_CHAIN.map((m, i) => [m.hash, i]))
	// Only the old chain has these; the files the two chains share
	// (`0094_entry_keys_text`, `0096_link_description_not_null`) prove nothing.
	const retired = new Set(
		PRESQUASH_CHAIN.filter((m) => !squashedHashes.has(m.hash)).map(
			(m) => m.hash
		)
	)

	const ledgerRows = rawRows<{ hash: unknown; created_at: unknown }>(
		await db.execute(
			sql.raw(`select hash, created_at from ${LEDGER} order by id asc`)
		)
	).map((r) => ({ hash: String(r.hash), createdAt: Number(r.created_at) }))
	const rows = ledgerRows.map((r) => r.hash)
	if (!rows.some((h) => retired.has(h))) return nothing

	function refuse(reason: string): never {
		const where = dataDir ? ` (${dataDir})` : ""
		throw new LedgerSpliceRefusal(
			`[migration-ledger] This database was migrated by the pre-squash 0.6 development chain and cannot be carried onto this build's migrations: ${reason}. ` +
				`Nothing was changed. Move the data directory${where} aside (keep it — the build that made it can still open it) and start again.`
		)
	}

	// The squashed chain this splice was written for must be the one shipped.
	const shipped = readJournalMigrations(migrationsFolder)
	const firstSquashed = shipped.findIndex(
		(m) => m.tag === SQUASHED_CHAIN[0].tag
	)
	const target = SQUASHED_CHAIN.map((pin, i) => {
		const entry = firstSquashed < 0 ? undefined : shipped[firstSquashed + i]
		if (!entry || entry.tag !== pin.tag || entry.hash !== pin.hash)
			refuse(
				`this build's ${pin.tag} is not the file the ledger splice was written for`
			)
		return entry
	})
	// Everything shipped before the squashed chain: 0.5.3's 0000–0093.
	const base = new Set(shipped.slice(0, firstSquashed).map((m) => m.hash))

	const applied = new Set<number>()
	for (const { hash, createdAt } of ledgerRows) {
		const at = presquashAt.get(hash)
		if (at !== undefined) applied.add(at)
		else if (!base.has(hash)) {
			if (
				squashedHashes.has(hash) ||
				shipped.some((m) => m.hash === hash)
			)
				refuse(
					`its ledger mixes pre-squash rows with rows of the squashed chain`
				)
			// Stamped like a pre-squash file but hashed unlike it: that file was
			// edited after this database applied it, and what ran is unknown.
			const byStamp = PRESQUASH_CHAIN.find((m) => m.when === createdAt)
			refuse(
				byStamp
					? `its ledger row for ${byStamp.tag} (matched by stamp) has another hash — the file was edited after this database applied it`
					: `its ledger holds a row (hash ${hash.slice(0, 12)}…) no migration here matches`
			)
		}
	}
	// drizzle applies in order, so what ran is a prefix: 0094, 0095, … up to
	// the newest. Anything with a hole in it came from somewhere else.
	const through = Math.max(...applied)
	for (let i = 0; i <= through; i++)
		if (!applied.has(i))
			refuse(
				`its ledger has ${PRESQUASH_CHAIN[through].tag} but not ${PRESQUASH_CHAIN[i].tag}`
			)

	const missing: PresquashMigration[] = PRESQUASH_CHAIN.slice(through + 1)
	for (const m of missing)
		if (m.sql === undefined || sha256(m.sql) !== m.hash)
			refuse(`the copy of ${m.tag} it would replay is missing or altered`)

	console.log(
		`[migration-ledger] This database was migrated by the pre-squash 0.6 chain (through ${PRESQUASH_CHAIN[through].tag}). ` +
			(missing.length
				? `Replaying ${missing.length} pre-squash migration(s) it had not applied, then recording the squashed chain in its place.`
				: `Its schema is the squashed chain's; recording that chain in its place.`)
	)
	await beforeWrite?.()

	const allKnown = [
		...new Set([...PRESQUASH_CHAIN.map((m) => m.hash), ...squashedHashes])
	]
	await db.transaction(async (tx) => {
		for (const m of missing)
			for (const statement of m.sql!.split(BREAKPOINT))
				await tx.execute(sql.raw(statement))
		await tx.execute(
			sql`delete from ${sql.identifier("drizzle")}.${sql.identifier("__drizzle_migrations")}
				where hash in (${sql.join(
					allKnown.map((h) => sql`${h}`),
					sql`, `
				)})`
		)
		for (const m of target)
			await tx.execute(
				sql`insert into ${sql.identifier("drizzle")}.${sql.identifier("__drizzle_migrations")}
					(hash, created_at) values (${m.hash}, ${m.when})`
			)
	})

	const replayed = missing.map((m) => m.tag)
	console.log(
		`[migration-ledger] spliced: ${replayed.length ? `replayed ${replayed.join(", ")}; ` : ""}` +
			`the ledger now records ${target.map((m) => m.tag).join(", ")}.`
	)
	return { spliced: true, replayed }
}
