import { describe, expect, it } from "vitest"
import { inject } from "vitest"
import { sql } from "drizzle-orm"
import { createTestDb, migratedTestDb, type TestDb } from "./testDb"

/**
 * A database loaded from the template equals one built by replaying every
 * migration: same tables and columns, same rows, same sequence positions, same
 * migration ledger.
 */
const rows = async (db: TestDb, query: string) =>
	(await db.execute(query)).rows as Array<Record<string, unknown>>

async function describeDatabase(db: TestDb) {
	const columns = await rows(
		db,
		`SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default
		 FROM information_schema.columns
		 WHERE table_schema IN ('public', 'drizzle')
		 ORDER BY table_schema, table_name, ordinal_position`
	)
	const tables = [
		...new Set(columns.map((c) => `${c.table_schema}.${c.table_name}`))
	]
	const counts: Record<string, number> = {}
	for (const t of tables) {
		const [{ n }] = (await rows(
			db,
			`SELECT count(*)::int AS n FROM ${t.replace(/(\w+)\.(\w+)/, '"$1"."$2"')}`
		)) as Array<{ n: number }>
		counts[t] = n
	}
	const sequences = await rows(
		db,
		`SELECT schemaname, sequencename, last_value, start_value, increment_by FROM pg_sequences
		 WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname, sequencename`
	)
	const isCalled: Record<string, unknown> = {}
	for (const s of sequences) {
		const [r] = await rows(
			db,
			`SELECT last_value, is_called FROM "${s.schemaname}"."${s.sequencename}"`
		)
		isCalled[`${s.schemaname}.${s.sequencename}`] = r
	}
	const ledger = await rows(
		db,
		`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`
	)
	return { columns, counts, sequences, isCalled, ledger }
}

describe("the test database template", () => {
	it("holds the same database as replaying every migration", async () => {
		const migrated = await migratedTestDb()
		await createTestDb() // the first call builds the file when no worker has
		const loaded = await createTestDb() // so this one certainly loads it
		const dir = inject("testDbTemplateDir")
		const { readdirSync } = process.getBuiltinModule("fs")
		expect(readdirSync(dir).filter((n) => n.endsWith(".tar"))).toHaveLength(
			1
		)

		const expected = await describeDatabase(migrated)
		const actual = await describeDatabase(loaded)
		expect(expected.ledger.length).toBeGreaterThan(100)
		expect(actual.columns).toEqual(expected.columns)
		expect(actual.counts).toEqual(expected.counts)
		expect(actual.sequences).toEqual(expected.sequences)
		expect(actual.isCalled).toEqual(expected.isCalled)
		expect(actual.ledger).toEqual(expected.ledger)

		await loaded.execute(sql`SELECT 1`)
	})
})
