/**
 * `0103_curvy_cannonball.sql` adds a table that holds user decisions.
 *
 * ## Why a fresh database cannot check the thing that matters
 *
 * Every integration suite in this repo builds an empty database, and every one
 * of them therefore sees this migration apply against a schema that has never
 * had a `binding_suggestions` row in it. Two facts about the shipped file are
 * invisible from there, and both of them are the difference between an upgrade
 * that works and one that fails on the user's machine at boot:
 *
 *  1. **Does it run at all on an install that already has the schema-before?**
 *     A statement that assumes something already dropped, or an index over a
 *     column that does not exist yet, fails identically on every install and on
 *     no test. So this file puts the schema *back* to where an upgrading install
 *     is — no table — and applies the shipped text against that.
 *  2. **Does it lose anything?** Nothing here is a rename, so the row-preserving
 *     hazard `localModelRegistry.int.test.ts` was written for is not this
 *     migration's. Its hazard is the *other* half of the same rule: the rows
 *     this table holds are the only copy of what a human decided, so the file
 *     must be additive, must not touch the annotation tables it derives from,
 *     and must not cascade a suggestion's death from anything but its lorebook.
 *     Those are checked against the shipped text and against a real database
 *     seeded with rows.
 *
 * ⚠ `regressToPreMigration` is hand-written and therefore checked —
 * `expectPreMigrationState` asserts the regression actually happened. An inverse
 * that quietly did nothing would leave every assertion below passing against a
 * database that was already migrated, which is the vacuous green this whole file
 * exists to avoid.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync("drizzle/0103_curvy_cannonball.sql", "utf8")

const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(
		readFileSync("drizzle/meta/_journal.json", "utf8")
	)
	const entries = journal.entries as Array<{
		tag: string
		idx: number
		when: number
	}>
	const entry = entries.find((e) => e.tag === "0103_curvy_cannonball")
	expect(entry, "0103 has no journal entry, so it runs nowhere").toBeTruthy()
	return {
		JOURNAL_WHEN: entry!.when,
		PRECEDING_MAX: Math.max(
			...entries.filter((e) => e.idx < entry!.idx).map((e) => e.when)
		)
	}
})()

/** Apply it the way the migrator does — statement by statement. */
async function applyMigration(db: TestDb) {
	for (const statement of MIGRATION.split("--> statement-breakpoint"))
		if (statement.trim()) await db.execute(statement)
}

const rowsOf = (res: any): any[] => (res.rows ?? res) as any[]

const query = async (db: TestDb, sql: string): Promise<any[]> =>
	rowsOf(await db.execute(sql))

/** Put the schema back the way an install that has not run 0103 has it. */
async function regressToPreMigration(db: TestDb) {
	await db.execute(`DROP TABLE "binding_suggestions"`)
}

async function expectPreMigrationState(db: TestDb) {
	const tables = await query(
		db,
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_name = 'binding_suggestions'`
	)
	expect(tables).toEqual([])

	// ⚠ And the tables it derives from are untouched by the regression, so a
	// later assertion that they survived the migration means something.
	const annotations = await query(
		db,
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public'
		 AND table_name IN ('entry_annotations', 'message_annotations')`
	)
	expect(annotations.map((t) => t.table_name).sort()).toEqual([
		"entry_annotations",
		"message_annotations"
	])
}

/** A user, a lorebook, and a binding — the rows a suggestion hangs on. */
async function seedOwners(db: TestDb) {
	const [user] = await query(
		db,
		`INSERT INTO "users" ("username") VALUES ('mig-0103') RETURNING "id"`
	)
	const [book] = await query(
		db,
		`INSERT INTO "lorebooks" ("name", "user_id")
		 VALUES ('Ashguard', ${user.id}) RETURNING "id"`
	)
	const [binding] = await query(
		db,
		`INSERT INTO "lorebook_bindings" ("lorebook_id", "binding", "name")
		 VALUES (${book.id}, '{{char:1}}', 'Emberfall') RETURNING "id"`
	)
	return { userId: user.id, bookId: book.id, bindingId: binding.id }
}

/**
 * The rows an install plausibly has once someone has used the feature: one of
 * each status, one dismissal with a decision time, one accepted row pointing at
 * the binding it minted.
 */
async function seedSuggestions(
	db: TestDb,
	o: { bookId: number; bindingId: number }
) {
	await db.execute(
		`INSERT INTO "binding_suggestions"
		 ("lorebook_id", "entity_key", "surface", "status", "occurrences",
		  "source_count", "first_seen_at", "last_seen_at", "example_context",
		  "example_source_kind", "example_source_id", "resolved_binding_id",
		  "decided_at")
		 VALUES
		 (${o.bookId}, 'open:emberfall', 'Emberfall', 'added', 12, 3,
		  '2026-01-02 03:04:05', '2026-02-03 04:05:06',
		  'Riders out of Emberfall.', 'entry', 41, ${o.bindingId},
		  '2026-03-04 05:06:07'),
		 (${o.bookId}, 'open:the salt road', 'the Salt Road', 'ignored', 2, 1,
		  '2026-01-05 00:00:00', '2026-01-06 00:00:00',
		  'It runs to the coast.', 'message', 77, NULL,
		  '2026-03-05 00:00:00'),
		 (${o.bookId}, 'open:vell', 'Vell', 'pending', 1, 1,
		  '2026-01-07 00:00:00', '2026-01-07 00:00:00',
		  'Vell said nothing.', 'message', 78, NULL, NULL)`
	)
}

/** A database in the state an upgrading install is in: no table. */
async function upgrading(): Promise<{ db: TestDb }> {
	const db = await createTestDb()
	await regressToPreMigration(db)
	await expectPreMigrationState(db)
	return { db }
}

describe("0103 adds the suggestions table to an install that has none", () => {
	it("is ordered after everything registered before it, so an upgrade runs it", async () => {
		/**
		 * ⚠ `PgDialect.migrate` reads the last applied migration ONCE and then
		 * applies only files whose journal `when` is greater, so a file numbered
		 * at or below an already-applied index is **silently skipped** on every
		 * upgraded install. On an empty database the comparison short-circuits
		 * and every file applies regardless, which is why no ordinary
		 * integration test can see the difference — and why the checkable half
		 * is the ordering itself.
		 */
		const db = await createTestDb()
		const applied = await query(
			db,
			`SELECT created_at FROM drizzle.__drizzle_migrations
			 ORDER BY created_at ASC`
		)
		expect(applied.map((r) => Number(r.created_at))).toContain(JOURNAL_WHEN)
		expect(PRECEDING_MAX).toBeLessThan(JOURNAL_WHEN)
	}, 60_000)

	it("is additive — it drops nothing and alters nothing that already exists", () => {
		/**
		 * Pinned against the SHIPPED text. This table holds the only copy of
		 * what a human said about a candidate, and the annotation tables beside
		 * it hold work a background lane spent real time producing; a
		 * regenerated file that answered a prompt as a drop-and-create would
		 * reach the same final schema and lose both.
		 */
		expect(MIGRATION).not.toMatch(/DROP\s+TABLE/i)
		expect(MIGRATION).not.toMatch(/DROP\s+COLUMN/i)
		expect(MIGRATION).not.toMatch(/TRUNCATE/i)
		expect(MIGRATION).not.toMatch(/entry_annotations|message_annotations/i)
		expect(MIGRATION).toMatch(/CREATE TABLE "binding_suggestions"/)
	}, 60_000)

	it("runs against the pre-migration schema and creates what the app expects", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		const columns = await query(
			db,
			`SELECT column_name, data_type, is_nullable, column_default
			 FROM information_schema.columns
			 WHERE table_name = 'binding_suggestions'
			 ORDER BY column_name`
		)
		const byName = new Map(columns.map((c) => [c.column_name, c]))
		expect([...byName.keys()].sort()).toEqual([
			"created_at",
			"decided_at",
			"entity_key",
			"example_context",
			"example_source_id",
			"example_source_kind",
			"first_seen_at",
			"id",
			"last_seen_at",
			"lorebook_id",
			"occurrences",
			"resolved_binding_id",
			"source_count",
			"status",
			"surface",
			"updated_at"
		])

		// A new row is a proposition nobody has answered yet. If `status`
		// defaulted to anything else, every scan-inserted candidate would arrive
		// pre-decided.
		expect(byName.get("status")!.column_default).toMatch(/'pending'/)
		expect(byName.get("status")!.is_nullable).toBe("NO")
		// ⚠ Nullable, and it has to be: "nobody has decided" is a real state,
		// and a NOT NULL default of now() would date every pending row to its
		// own creation and make the log unreadable.
		expect(byName.get("decided_at")!.is_nullable).toBe("YES")
		// Provenance, not a reference — the snippet is a frozen copy.
		expect(byName.get("example_source_id")!.is_nullable).toBe("YES")
	}, 60_000)

	it("carries the identity index the scan upserts on", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		const indexes = await query(
			db,
			`SELECT indexname, indexdef FROM pg_indexes
			 WHERE tablename = 'binding_suggestions'`
		)
		const names = indexes.map((i) => i.indexname).sort()
		expect(names).toContain("binding_suggestions_book_key_uq")
		expect(names).toContain("binding_suggestions_book_status_idx")
		const uq = indexes.find(
			(i) => i.indexname === "binding_suggestions_book_key_uq"
		)!
		// ⚠ UNIQUE and on both columns. `reconcileSuggestions` upserts on this
		// pair; without the constraint the ON CONFLICT clause raises, and with
		// it on `entity_key` alone two lorebooks could not both have a candidate
		// called "emberfall".
		expect(uq.indexdef).toMatch(/CREATE UNIQUE INDEX/)
		expect(uq.indexdef).toMatch(/lorebook_id/)
		expect(uq.indexdef).toMatch(/entity_key/)

		const o = await seedOwners(db)
		await seedSuggestions(db, o)
		await expect(
			db.execute(
				`INSERT INTO "binding_suggestions"
				 ("lorebook_id", "entity_key", "status")
				 VALUES (${o.bookId}, 'open:emberfall', 'pending')`
			)
		).rejects.toThrow()
	}, 60_000)

	it("keeps every decision through a second run of the migrator", async () => {
		const { db } = await upgrading()
		await applyMigration(db)
		const o = await seedOwners(db)
		await seedSuggestions(db, o)

		const before = await query(
			db,
			`SELECT * FROM "binding_suggestions" ORDER BY "id"`
		)
		// ⚠ The regression, first. Without this the assertions after could all
		// be describing an empty table.
		expect(before.length).toBe(3)

		// Drizzle records the file as applied and never re-runs it; what this
		// checks is that nothing later in the boot path — the defaults sync, the
		// entry projection — clears the table on a machine that already had it.
		const { migrate } = await import("drizzle-orm/pglite/migrator")
		const path = await import("path")
		await migrate(db, {
			migrationsFolder: path.resolve(process.cwd(), "drizzle")
		})

		const after = await query(
			db,
			`SELECT * FROM "binding_suggestions" ORDER BY "id"`
		)
		expect(after.length).toBe(3)
		// Column by column rather than a count: a pass that kept the rows while
		// blanking `example_context` and `decided_at` would satisfy a length
		// check and still have thrown away the log.
		for (const [i, row] of after.entries())
			for (const col of Object.keys(row))
				expect(String(row[col]), `${col} on row ${i}`).toBe(
					String(before[i][col])
				)
	}, 60_000)

	it("cascades from the lorebook and only from the lorebook", async () => {
		const { db } = await upgrading()
		await applyMigration(db)
		const o = await seedOwners(db)
		await seedSuggestions(db, o)

		/**
		 * ⚠ Deleting the binding an accepted suggestion created must NOT delete
		 * the suggestion — `SET NULL`, not cascade. The decision was made, and a
		 * log that vanished when its subject did would be no log at all.
		 */
		await db.execute(
			`DELETE FROM "lorebook_bindings" WHERE "id" = ${o.bindingId}`
		)
		const survivors = await query(
			db,
			`SELECT "entity_key", "status", "resolved_binding_id"
			 FROM "binding_suggestions" ORDER BY "id"`
		)
		expect(survivors.length).toBe(3)
		expect(survivors[0].status).toBe("added")
		expect(survivors[0].resolved_binding_id).toBeNull()

		// Deleting the book, on the other hand, takes them: they are scoped to
		// it and mean nothing without it.
		await db.execute(`DELETE FROM "lorebooks" WHERE "id" = ${o.bookId}`)
		expect(await query(db, `SELECT * FROM "binding_suggestions"`)).toEqual(
			[]
		)
	}, 60_000)

	it("the schema drizzle generates from is the schema that ships", async () => {
		/**
		 * The snapshot chain is the source of truth for the next generation, so
		 * a hand-edit to the SQL that the declaration does not also carry would
		 * drift silently. Comparing the shipped file against the columns the
		 * declaration produces is the cheap half of noticing.
		 */
		const db = await createTestDb()
		const { bindingSuggestions } = await import("./schema")
		const declared = Object.values(bindingSuggestions).flatMap((c: any) =>
			c && typeof c === "object" && typeof c.name === "string"
				? [c.name]
				: []
		)
		const actual = (
			await query(
				db,
				`SELECT column_name FROM information_schema.columns
				 WHERE table_name = 'binding_suggestions'`
			)
		).map((r) => r.column_name)
		expect(declared.length).toBeGreaterThan(0)
		expect([...declared].sort()).toEqual([...actual].sort())
	}, 60_000)
})
