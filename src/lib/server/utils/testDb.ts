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
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import path from "path"
import fsp from "fs/promises"
import * as schema from "$lib/server/db/schema"

export type TestDb = ReturnType<typeof drizzle<typeof schema, PGlite>>

/** Call once per test file (eg. in beforeAll) — migrations take real time (PGlite WASM startup). */
export async function createTestDb(opts?: {
	/**
	 * Leave `pipeline_type_registry` empty.
	 *
	 * Only for the two suites that are *about* `syncTypeRegistry` and assert on
	 * what it inserted — a pre-published type would make their counts wrong.
	 * Every other suite wants the types, because an entry cannot be written
	 * without them.
	 */
	skipEntryTypes?: boolean
}): Promise<TestDb> {
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

	/**
	 * Publish the declared entry types.
	 *
	 * ⚠ **`lorebook_entries` cannot be written without them.** `type_id` +
	 * `type_version` is a real foreign key into `pipeline_type_registry`, so
	 * the registry rows are a precondition for an entry row the way the
	 * `lorebooks` row is — not an optional boot nicety. The app gets them from
	 * `bootstrapPipelines`; a test database that skipped them would fail every
	 * entry insert with a foreign key error that says nothing about types.
	 *
	 * Importing the catalog is what registers them, which is the same
	 * fact-about-the-code route the node types take.
	 */
	if (!opts?.skipEntryTypes) {
		const { syncTypeRegistry } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		const { allEntryTypes } = await import("@serene-pub/sdk")
		await import("@serene-pub/core-catalog")
		await syncTypeRegistry(db, allEntryTypes(), { release: "test" })
	}

	return db
}

/**
 * The address of one tuned value inside a config — a node, a slot, a field.
 *
 * The same `(node_key, slot, path)` triple `pipeline_config_values` is keyed on,
 * spelled as an object so a fixture cannot silently swap the last two.
 */
export interface ConfigValueAddress {
	nodeKey: string
	slot: string
	path?: string
}

/**
 * Store a tuned value in a config, the way the panel does.
 *
 * ⚠ An **upsert**, and it has to be. Before the deviation ruling (2026-09-10)
 * every config held a row at every declared address, so a fixture could set a
 * value with a bare `UPDATE` and be sure of hitting one. A config now stores
 * only what departs from the declared default, so at an untouched address there
 * is nothing to update: the `UPDATE` matched zero rows, the run went on
 * resolving the default, and the assertion failed pointing at the pipeline
 * rather than at the fixture.
 *
 * Named for what it is rather than mirroring `writeOption`'s signature: that
 * one takes an option handle, a viewer and an instance secret, and a fixture
 * establishing a stored value has none of those to hand.
 */
export async function setConfigValue(
	db: TestDb,
	configId: number,
	at: ConfigValueAddress,
	value: unknown
): Promise<void> {
	const row = {
		configId,
		nodeKey: at.nodeKey,
		slot: at.slot,
		path: at.path ?? "",
		value
	}
	await db
		.insert(schema.pipelineConfigValues)
		.values(row)
		.onConflictDoUpdate({
			target: [
				schema.pipelineConfigValues.configId,
				schema.pipelineConfigValues.nodeKey,
				schema.pipelineConfigValues.slot,
				schema.pipelineConfigValues.path
			],
			set: { value }
		})
}

/**
 * Put an address back to inheriting — a delete, never a write of the default.
 *
 * The fixture half of `clearOption`, and the counterpart to `setConfigValue`
 * above: a test that "restored" a value by writing the declared number back
 * would leave a row behind that the reconciler then sweeps on the next boot, so
 * the restore and the sweep would disagree about what the config holds.
 */
export async function clearConfigValue(
	db: TestDb,
	configId: number,
	at: ConfigValueAddress
): Promise<void> {
	await db
		.delete(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, at.nodeKey),
				eq(schema.pipelineConfigValues.slot, at.slot),
				eq(schema.pipelineConfigValues.path, at.path ?? "")
			)
		)
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
