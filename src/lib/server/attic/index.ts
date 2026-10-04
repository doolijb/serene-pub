/**
 * The **attic** — the `attic_0_5_3` schema a 0.5.3 database's rows wait in
 * while the 0.6.0 schema is built on empty tables (`dataUpgrades/0095_schema_0_6_0.ts`
 * stashes them; plan `PLAN-chain-rebuild-0.5.3-upgrade-2026-09-30.md` §4).
 *
 * Its presence is the one "upgrade pending" signal. Two boot steps read it:
 *
 *   1. the **attic restore** (`restore.ts`, the `attic` startup task) puts the
 *      rows back in the 0.6 shape, in one transaction, and marks the attic
 *      `__restored`;
 *   2. the **attic wiring** (`finish.ts`, the tail of the `pipelines` task)
 *      brings the 0.5.3 configurations across into the pipeline layer — those
 *      need the specs, presets and templates the pipelines bootstrap seeds —
 *      and then drops the schema.
 *
 * A fresh install never has an attic, and every entry point here answers
 * "absent" with a no-op and no transaction.
 */
import { sql } from "drizzle-orm"
import { ATTIC_SCHEMA } from "$lib/server/db/dataUpgrades/0095_schema_0_6_0"
import { rawRows } from "$lib/server/db/rawRows"

export { ATTIC_SCHEMA }

/** Whether the attic schema exists on this database. */
export async function atticExists(db: MigrationTx): Promise<boolean> {
	const rows = rawRows<{ n: number }>(
		await db.execute(
			sql`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = ${ATTIC_SCHEMA}`
		)
	)
	return Number(rows[0]?.n ?? 0) > 0
}

/** Whether the attic holds a table of this name (an older 0.5.x may lack one). */
export async function atticHasTable(
	db: MigrationTx,
	table: string
): Promise<boolean> {
	const rows = rawRows<{ n: number }>(
		await db.execute(
			sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = ${ATTIC_SCHEMA} AND table_name = ${table}`
		)
	)
	return Number(rows[0]?.n ?? 0) > 0
}

/** When the attic restore committed, or null while it has not. */
export async function atticRestoredAt(db: MigrationTx): Promise<Date | null> {
	if (!(await atticHasTable(db, "__restored"))) return null
	const rows = rawRows<{ at: string | Date }>(
		await db.execute(
			sql.raw(`SELECT "at" FROM "${ATTIC_SCHEMA}"."__restored" LIMIT 1`)
		)
	)
	return rows[0]?.at ? new Date(rows[0].at) : null
}

/** Drop the attic, once the restore and the wiring have both finished. */
export async function dropAttic(db: MigrationTx): Promise<void> {
	await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${ATTIC_SCHEMA}" CASCADE`))
}
