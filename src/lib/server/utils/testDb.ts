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
import os from "os"
import path from "path"
import fsp from "fs/promises"
import * as schema from "$lib/server/db/schema"
import { guardTransactions } from "$lib/server/db/transactionGuard"
import { driverErrorOf } from "$lib/server/db/errors"

export type TestDb = ReturnType<typeof drizzle<typeof schema, PGlite>>

/** Call once per test file (eg. in beforeAll) — migrations take real time (PGlite WASM startup). */
export async function createTestDb(opts?: {
	/**
	 * Leave `pipeline_definition_registry` empty.
	 *
	 * Only for the two suites that are *about* `syncDefinitionRegistry` and assert on
	 * what it inserted — a pre-published type would make their counts wrong.
	 * Every other suite wants the types, because an entry cannot be written
	 * without them.
	 */
	skipEntryTypes?: boolean
}): Promise<TestDb> {
	const client = new PGlite()
	// As the app's own handle is guarded (`db/index.ts`): an outer-handle
	// query awaited inside `db.transaction` fails the test at once, with the
	// stacks, instead of hanging it to its timeout.
	guardTransactions(client, "throw")
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
	 * The built-in completion templates, as boot's `defaults.sync()` writes
	 * them. `connections.prompt_format` is a foreign key to their `key`, so a
	 * connection naming a built-in format cannot be inserted without them.
	 */
	const { seedCompletionTemplates } = await import(
		"$lib/server/db/seedCompletionTemplates"
	)
	await seedCompletionTemplates(db)

	/**
	 * Publish the declared entry types.
	 *
	 * ⚠ **`lorebook_entries` cannot be written without them.** `type_id` +
	 * `type_version` is a real foreign key into `pipeline_definition_registry`, so
	 * the registry rows are a precondition for an entry row the way the
	 * `lorebooks` row is — not an optional boot nicety. The app gets them from
	 * `bootstrapPipelines`; a test database that skipped them would fail every
	 * entry insert with a foreign key error that says nothing about types.
	 *
	 * Importing the catalog is what registers them, which is the same
	 * fact-about-the-code route the node types take.
	 */
	if (!opts?.skipEntryTypes) {
		const { syncDefinitionRegistry } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		const { allEntryTypes } = await import("@serene-pub/sdk")
		await import("@serene-pub/core-catalog")
		await syncDefinitionRegistry(db, allEntryTypes(), { release: "test" })
	}

	return db
}

/**
 * The shipped migrations folder, cut off after `tag`.
 *
 * For a test that has to put a database in the state an older install is in:
 * migrate from this folder, write the rows such an install holds, then migrate
 * again from the real `drizzle/` — which is how an upgrading install meets the
 * migrations above it. The `.sql` files are copied byte for byte, so the ledger
 * rows drizzle writes carry the hashes the real folder produces; only
 * `meta/_journal.json` is cut, and `restamp` replaces an entry's `when` by tag.
 *
 * The caller calls `dispose`. The folder's name carries a prefix the stale-temp
 * sweep (`scripts/testTempDirs.ts`) knows, so a killed run's copy is removed by
 * the next run.
 */
export async function migrationsFolderThrough(
	tag: string,
	opts?: { restamp?: Record<string, number> }
): Promise<{ folder: string; dispose: () => Promise<void> }> {
	const real = path.resolve(process.cwd(), "drizzle")
	const journal = JSON.parse(
		await fsp.readFile(path.join(real, "meta/_journal.json"), "utf8")
	) as { entries: Array<{ tag: string; when: number }> }
	const cut = journal.entries.findIndex((e) => e.tag === tag)
	if (cut < 0) throw new Error(`No journal entry for "${tag}"`)
	const entries = journal.entries
		.slice(0, cut + 1)
		.map((e) => ({ ...e, when: opts?.restamp?.[e.tag] ?? e.when }))
	const folder = await fsp.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-migrations-")
	)
	await fsp.mkdir(path.join(folder, "meta"))
	for (const e of entries)
		await fsp.copyFile(
			path.join(real, `${e.tag}.sql`),
			path.join(folder, `${e.tag}.sql`)
		)
	await fsp.writeFile(
		path.join(folder, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries }, null, 2)
	)
	return {
		folder,
		dispose: () => fsp.rm(folder, { recursive: true, force: true })
	}
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

/**
 * 🚧 Store a tuned value where a run of this pipeline reads it (PLAN-layering
 * D5, R50): on the genre's defaults' registrations of it — the
 * administrator's instance-wide edit, what the pub-selected configuration
 * was — or, for a pipeline no genre registers, its instance values.
 * `undefined` clears the address (a delete, never a write of the default).
 */
export async function setPipelineValue(
	db: TestDb,
	slug: string,
	at: ConfigValueAddress,
	value: unknown
): Promise<void> {
	const address = { nodeKey: at.nodeKey, slot: at.slot, path: at.path ?? "" }
	const { setPipelineGenreValue } = await import(
		"$lib/server/pipelines/registrations/genreValues"
	)
	if (await setPipelineGenreValue(db as never, slug, address, value)) return
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	if (!spec) throw new Error(`setPipelineValue: no pipeline '${slug}'`)
	const { setInstanceValue } = await import("$lib/server/pipelines/registrations/instanceValues")
	await setInstanceValue(db as never, slug, address, value)
}

/** Put an address back to inheriting — `setPipelineValue`'s clear. */
export async function clearPipelineValue(
	db: TestDb,
	slug: string,
	at: ConfigValueAddress
): Promise<void> {
	await setPipelineValue(db, slug, at, undefined)
}

/**
 * ⏳ A session's retired background-task choices (`{ v: 1, tasks: { key: {
 * mode } } }`, the old `genre_fields.tasks`) written where they live now —
 * the session's routine and reply registrations and the voices' genre fields
 * (`legacyTasks.ts`, the 0108 data upgrade's mapping) — for the tests that
 * state a session's tasks the old way (the routine runtime reads them where
 * they now live, lane 6).
 */
export async function applyLegacyTasks(
	db: TestDb,
	sessionId: number,
	stored: unknown
): Promise<void> {
	const { effectiveRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	const regs = await effectiveRegistrations(db as never, sessionId)
	if (!regs) throw new Error(`applyLegacyTasks: no session #${sessionId}`)
	const { tasksAsRegistrations } = await import(
		"$lib/server/pipelines/registrations/legacyTasks"
	)
	const t = tasksAsRegistrations(stored, regs.offered, { kind: "session", sessionId }, "owner")
	const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
	for (const r of t.rows) await upsertRow(db as never, r)
	if (!Object.keys(t.fields).length) return
	const [row] = await db
		.select({ genreFields: schema.sessions.genreFields })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({ genreFields: { ...((row?.genreFields as object) ?? {}), ...t.fields } as never })
		.where(eq(schema.sessions.id, sessionId))
}

/**
 * 🚧 A session's change of a routine's cadence options (lane 6; the
 * administrator's in their own session, R36) — a session change row with
 * `cadence_options`, as the settings form writes it. The registration's
 * identity (its key) is unchanged (A8).
 */
export async function setRoutineCadenceOptions(
	db: TestDb,
	sessionId: number,
	key: string,
	options: Record<string, unknown>
): Promise<void> {
	const { rowOfChange, registrationScopeWhere } = await import("$lib/server/pipelines/registrations/rows")
	const { invalidateRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	// Onto the session's own row when it has one (its mode and values stay).
	const updated = await db
		.update(schema.registrations)
		.set({ cadenceOptions: options })
		.where(
			and(
				registrationScopeWhere({ kind: "session", sessionId }),
				eq(schema.registrations.key, key)
			)
		)
		.returning({ id: schema.registrations.id })
	if (!updated.length)
		await db.insert(schema.registrations).values({
			...rowOfChange({ key }, { kind: "session", sessionId }, "admin"),
			cadenceOptions: options
		})
	invalidateRegistrations()
}

/**
 * A query's rejection as the driver raised it, for
 * `rejects.toThrow(/constraint_name/)`.
 *
 * drizzle-orm (0.44+) re-throws every failed query as a `DrizzleQueryError`
 * whose message is the SQL; the constraint name a test pins is in the
 * driver's own message, under `.cause`.
 */
export const asDriverRejection = <T>(query: PromiseLike<T>): Promise<T> =>
	Promise.resolve(query).catch((e) => {
		throw driverErrorOf(e)
	})

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

/**
 * 🚧 Publish core's default save, `core:spec/save-message` (owner ruling
 * 2026-10-15): a person's message is saved through the pipeline, so a test
 * that sends one on a database no boot seeded publishes the save first — the
 * one spec a send needs. Idempotent.
 */
export async function publishSaveMessage(db: TestDb): Promise<void> {
	const { saveMessageSpec } = await import("@serene-pub/core-catalog")
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(db as never, saveMessageSpec() as never, {
		name: "Save message",
		publish: true
	})
}

/** 🚧 A test's deletion pipeline (RF fix 5): its id. */
export const TEST_DELETION_SPEC_ID = "test:spec/delete-asked"

/**
 * 🚧 **Deletion needs a pipeline** (RF fix 5, owner ruling 2026-10-23): core
 * registers none, so a test that deletes a message registers one on the
 * session first — the minimal deletion pipeline, `message-deletion-asked`'s
 * inlet straight into `delete-message@1`, the deletion the event carried
 * wired whole from the inlet's `main` onto the delete's `asked` — as a
 * session-scope registration row. Publishes the pipeline once per database
 * (idempotent).
 */
export async function registerTestDeletion(db: TestDb, sessionId: number): Promise<void> {
	const { compile, spec, sessionEvents } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	const doc = compile(
		spec(TEST_DELETION_SPEC_ID, { version: "1.0.0", taxonomy: { role: "action" } })
			.inlet("input", C.messageDeletionAsked.v1())
			.outlet("write", ($: any) => C.deleteMessage.v1({ asked: $.input.main }))
			.build()
	)
	await saveDocument(db as never, doc as never, { name: "Delete a message", publish: true })
	const { eventRegistration, rowOfDecl } = await import("$lib/server/pipelines/registrations/rows")
	const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
	await upsertRow(
		db as never,
		rowOfDecl(
			eventRegistration(sessionEvents.messageDeletionAsked, TEST_DELETION_SPEC_ID),
			{ kind: "session", sessionId },
			"admin"
		)
	)
}

/**
 * 🚧 Where a reply applies what it carried (*Replies carry changes*): the
 * published document's one `ruleset-resolve` step in `apply` mode — Story's
 * commit, after the `reply` junction (RF fix 3) — by its address, never spelled.
 */
export async function replyApplyKey(db: TestDb, slug: string): Promise<string> {
	const C = await import("@serene-pub/contracts")
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db as never, slug)
	if (!doc) throw new Error(`replyApplyKey: no published '${slug}'`)
	const resolve = C.rulesetResolve.id.replace(/@\d+$/, "")
	const apply = doc.nodes.filter(
		(n) => n.definitionId === resolve && (n.config as { mode?: unknown } | undefined)?.mode === "apply"
	)
	if (apply.length !== 1) throw new Error(`replyApplyKey: '${slug}' has ${apply.length} apply steps`)
	return apply[0]!.key
}

/**
 * A reply pipeline's own steps, by the addresses its published document gives
 * them — never spelled: the model call its budget is sized for
 * (`budgetedProviderOf`) and, on that call's own path or the nearest level
 * enclosing it, the write that fills its row and the sprite steps. Story's
 * call sits in its `reply` junction's prose branch (PLAN-rulesets-functions
 * D7) and its save and sprite steps after that junction, once (RF fix 3);
 * Guide's and the narrators' all on the spine.
 */
export async function replyStepKeys(
	db: TestDb,
	slug: string
): Promise<{ generate: string; save: string; spritePick?: string; spriteShow?: string }> {
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const { budgetedProviderOf } = await import("$lib/server/pipelines/runtime/specShape")
	const doc = await loadPublished(db as never, slug)
	if (!doc) throw new Error(`replyStepKeys: no published '${slug}'`)
	const call = budgetedProviderOf(doc)
	if (!call) throw new Error(`replyStepKeys: '${slug}' makes no model call`)
	// The call's own level, then each level enclosing it, out to the spine.
	const levels: Array<{ clauseId?: string; clauseChain?: string }> = []
	for (let at: { clauseId?: string; clauseChain?: string } | undefined = call; at; ) {
		levels.push({ clauseId: at.clauseId, clauseChain: at.clauseChain })
		if (!at.clauseId) break
		at = (doc.clauses ?? []).find((c) => c.id === at!.clauseId) ?? {}
	}
	const onItsPath = (definitionId: string) => {
		for (const l of levels) {
			const found = doc.nodes.find(
				(n) =>
					n.definitionId === definitionId &&
					(n.clauseId ?? undefined) === (l.clauseId ?? undefined) &&
					(n.clauseChain ?? undefined) === (l.clauseChain ?? undefined)
			)
			if (found) return found.key
		}
		return undefined
	}
	const save = onItsPath("core:outlet/update-message")
	if (!save) throw new Error(`replyStepKeys: '${slug}' fills no row beside '${call.key}'`)
	const spritePick = onItsPath("core:oracle/pick-sprite")
	const spriteShow = onItsPath("core:outlet/show-sprite")
	return {
		generate: call.key,
		save,
		...(spritePick ? { spritePick } : {}),
		...(spriteShow ? { spriteShow } : {})
	}
}
