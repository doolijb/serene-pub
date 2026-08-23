/**
 * Test-only helper — not used by the running app. Spins up a fresh
 * in-memory PGlite database with the real Drizzle migrations applied, for
 * integration tests that need to exercise actual DB-backed handler logic
 * (uuid dedup, conflict resolution, cascading restores) rather than mocking
 * $lib/server/db out entirely, which the codebase's other `*.int.test.ts`
 * files do. Each instance is fully isolated and in-memory — no relation to
 * the app's real on-disk data directory.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import path from "path"
import fsp from "fs/promises"
import * as schema from "$lib/server/db/schema"

export type TestDb = ReturnType<typeof drizzle<typeof schema, PGlite>>

/** Call once per test file (eg. in beforeAll) — migrations take real time (PGlite WASM startup). */
export async function createTestDb(): Promise<TestDb> {
	const client = new PGlite()
	const db = drizzle(client, { schema })
	await migrate(db, {
		migrationsFolder: path.resolve(process.cwd(), "drizzle")
	})

	// A couple of migrations (eg. 0012_good_baron_zemo.sql) seed a row with
	// an explicit id (a default admin user, id 1) rather than going through
	// the identity column's own sequence — Postgres never advances an
	// identity sequence for an explicitly-provided value, so without this,
	// the very next default-generated insert into that table collides on
	// the same id. Resyncing every identity sequence to its table's current
	// max id after migrations mirrors what a real deployed instance
	// effectively does over time (rows get created through the sequence from
	// then on, once past the seeded id).
	await db.execute(`
		DO $$
		DECLARE
			rec RECORD;
		BEGIN
			FOR rec IN
				SELECT seq.relname AS seq_name, tab.relname AS table_name, attr.attname AS col_name
				FROM pg_class seq
				JOIN pg_namespace ns ON ns.oid = seq.relnamespace
				JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
				JOIN pg_class tab ON dep.refobjid = tab.oid
				JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
				WHERE seq.relkind = 'S' AND ns.nspname = 'public'
			LOOP
				EXECUTE format(
					'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 1))',
					rec.seq_name, rec.col_name, rec.table_name
				);
			END LOOP;
		END $$;
	`)

	return db
}

/** Creates a bare test user row — most handlers require a valid userId FK. */
export async function createTestUser(db: TestDb, username?: string) {
	const [user] = await db
		.insert(schema.users)
		.values({
			username:
				username ?? `test-user-${Math.random().toString(36).slice(2)}`
		})
		.returning()
	return user
}

/**
 * Tear down a temp data directory a test pointed `SERENE_PUB_DATA_DIR` at.
 *
 * ⚠ Only call this from a file that has already loaded `$lib/server/db` — every
 * caller mocks it with `importOriginal`, so the dynamic import below resolves to
 * that file's own mock. From a file that never touched the module it would
 * *open* the real database in the directory being deleted, which is the
 * opposite of the point.
 *
 * Why it exists: the real module runs a lock heartbeat that writes `meta.json`
 * every four seconds. Deleting the directory under a live timer meant the file
 * could be written back into it part-way through the walk, so the final `rmdir`
 * hit `ENOTEMPTY` — a flake that moved between files and took out roughly one
 * full run in three. Stopping the writer first is the fix; the retries are for
 * anything else still holding a handle.
 */
export async function releaseDataDir(dir: string): Promise<void> {
	try {
		const mod = (await import("$lib/server/db")) as {
			closeDatabase?: () => Promise<void>
		}
		await mod.closeDatabase?.()
	} catch {
		// A suite that replaced the module wholesale has nothing to close.
	}
	await fsp.rm(dir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50
	})
}
