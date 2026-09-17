/**
 * `0097` puts a foreign key on a column that already holds data.
 *
 * ## Why a fresh database cannot check the thing that matters
 *
 * Every integration suite in this repo builds an empty database, and an empty
 * `connections` table has nothing for a foreign key to reject. On a real
 * install that column has held a free-text format string since 0.1 — including
 * values that name no template at all: `''` from a cleared field, `'tekken'`
 * from a format that was listed in the constants but never selectable, and
 * whatever an older or newer build wrote. Adding the constraint without
 * clearing those first does not corrupt anything; it makes `ADD CONSTRAINT`
 * fail, which aborts the migration and leaves the install unbootable.
 *
 * The second thing no fresh database can see is the ORDER inside the file. The
 * seed rows are INSERTed by the migration rather than left to `db/defaults.ts`,
 * because defaults run at boot — after migrations — so at the moment the key is
 * added the parent table would otherwise be empty and EVERY connection's format
 * would be an orphan. Move the `ALTER TABLE ... ADD CONSTRAINT` above that
 * INSERT and every test here still passes on an empty database while every real
 * upgrade dies.
 *
 * So this file does what no fresh database does: it puts the schema BACK to the
 * state an upgrading install is in, fills `connections` with the values that
 * are actually out there, and only then applies the file that ships.
 *
 * ## What "preserved" means for this column
 *
 * Not "every value survives" — two classes of value deliberately do not, and
 * the difference between them is the point:
 *
 *   - a format that names a template is kept EXACTLY, because that is a choice
 *     a person made and the whole connection is unusable if it silently
 *     changes;
 *   - a format that names nothing becomes NULL, because "no template chosen" is
 *     what it already meant everywhere that read it.
 *
 * Everything else on the row — name, type, base URL, model, the extraJson bag
 * carrying the encrypted API key — must come through untouched, and is checked
 * column by column rather than by row count.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { BUILTIN_COMPLETION_TEMPLATES } from "$lib/shared/constants/completionTemplates"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync("drizzle/0097_brave_layla_miller.sql", "utf8")

const TAG = "0097_brave_layla_miller"

const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(
		readFileSync("drizzle/meta/_journal.json", "utf8")
	)
	const entries = journal.entries as Array<{
		tag: string
		idx: number
		when: number
	}>
	const entry = entries.find((e) => e.tag === TAG)
	expect(
		entry,
		`${TAG} has no journal entry, so it runs nowhere`
	).toBeTruthy()
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

async function query(db: TestDb, sql: string): Promise<any[]> {
	return rowsOf(await db.execute(sql))
}

/**
 * Put the schema back the way an install that has not run 0097 has it.
 *
 * Hand-written, and therefore checked: `expectPreMigrationState` below asserts
 * the regression actually happened, because an inverse that quietly did nothing
 * would leave every assertion in this file passing against a database that was
 * already migrated — the vacuous green this whole file exists to avoid.
 */
async function regressToPreMigration(db: TestDb) {
	await db.execute(
		`ALTER TABLE "connections"
		 DROP CONSTRAINT "connections_prompt_format_completion_templates_key_fk"`
	)
	// ⚠ And the SECOND reference to the same key, added by 0114 when the
	// endpoint/model split gave a model its own template override
	// (`connection_models.prompt_format`). Dropping the table with only the
	// first constraint released fails outright — "cannot drop table
	// completion_templates because other objects depend on it" — which is a
	// clear enough error, but a `CASCADE` here would not be: it would silently
	// take the constraint away and leave every assertion below passing against a
	// schema this file never described.
	//
	// A migration LATER than the one under test is being undone here, which is
	// the honest cost of a hand-written inverse: 0114 is not "pre-0097" state.
	// It does not weaken anything asserted below — nothing in this file reads
	// `connection_models`, and 0097's own statements never mention it.
	await db.execute(
		`ALTER TABLE "connection_models"
		 DROP CONSTRAINT "connection_models_prompt_format_completion_templates_key_fk"`
	)
	await db.execute(`DROP TABLE "completion_templates"`)
	// ⚠ And `connections.model`, dropped by 0128 when the per-connection default
	// went away. Another migration LATER than the one under test, undone for the
	// same honest reason as 0114's constraint above: the rows an upgrading
	// install actually holds carry an identifier in that column, and a fixture
	// that could not write one would be describing a table no install ever had.
	// 0097 never mentions it, so nothing asserted below is weakened — the column
	// is there to be carried through untouched, which is exactly what the
	// column-by-column check wants of it.
	await db.execute(`ALTER TABLE "connections" ADD COLUMN "model" text`)
}

async function expectPreMigrationState(db: TestDb) {
	const tables = await query(
		db,
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_name = 'completion_templates'`
	)
	expect(tables).toEqual([])

	const fks = await query(
		db,
		`SELECT constraint_name FROM information_schema.table_constraints
		 WHERE table_name = 'connections' AND constraint_type = 'FOREIGN KEY'
		 AND constraint_name
		     = 'connections_prompt_format_completion_templates_key_fk'`
	)
	expect(fks).toEqual([])

	// And the column it is about is still there and still free text.
	const col = await query(
		db,
		`SELECT data_type, is_nullable FROM information_schema.columns
		 WHERE table_name = 'connections' AND column_name = 'prompt_format'`
	)
	expect(col.length).toBe(1)
	expect(col[0].data_type).toBe("text")
}

/**
 * The `prompt_format` values an upgrading install plausibly holds.
 *
 * Four that name a template and must survive byte for byte, and four that name
 * nothing and must become NULL — including the two the constants themselves
 * produced (`'tekken'`, which was in `PromptFormats` but never in a picker) and
 * the empty string, which is what a cleared field wrote into a column with no
 * check constraint.
 */
const SEED = [
	{
		name: "Local Ollama",
		type: "ollama",
		baseUrl: "http://localhost:11434/",
		model: "llama3.2:3b",
		tokenCounter: "estimate",
		promptFormat: "vicuna"
	},
	{
		name: "KoboldCPP",
		type: "koboldcpp",
		baseUrl: "http://localhost:5001/",
		model: "mythomax-13b",
		tokenCounter: "koboldcpp",
		promptFormat: "chatml"
	},
	{
		name: "Anthropic",
		type: "anthropic",
		baseUrl: null,
		model: "claude-sonnet-4",
		tokenCounter: "estimate",
		promptFormat: "claude"
	},
	{
		name: "Session split",
		type: "openai_chat",
		baseUrl: "https://api.example.test/v1",
		model: "gpt-4o",
		tokenCounter: "estimate",
		promptFormat: "split_session"
	},
	{
		name: "Never picked one",
		type: "llamacpp",
		baseUrl: "http://localhost:8080/",
		model: null,
		tokenCounter: "estimate",
		promptFormat: null
	},
	{
		name: "Cleared the field",
		type: "lmstudio",
		baseUrl: "http://localhost:1234/v1",
		model: "local-model",
		tokenCounter: "estimate",
		promptFormat: ""
	},
	{
		name: "Picked the dead arm",
		type: "llamacpp",
		baseUrl: "http://localhost:8081/",
		model: "mistral-7b",
		tokenCounter: "estimate",
		promptFormat: "tekken"
	},
	{
		name: "From some other build",
		type: "ollama",
		baseUrl: "http://localhost:11435/",
		model: "qwen2.5:7b",
		tokenCounter: "estimate",
		promptFormat: "metharme"
	}
]

const sqlText = (v: string | null) =>
	v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`

async function seedConnections(db: TestDb) {
	for (const r of SEED) {
		await db.execute(
			`INSERT INTO "connections"
			 ("name", "type", "base_url", "model", "token_counter",
			  "prompt_format", "extra_json")
			 VALUES (${sqlText(r.name)}, ${sqlText(r.type)},
			  ${sqlText(r.baseUrl)}, ${sqlText(r.model)},
			  ${sqlText(r.tokenCounter)}, ${sqlText(r.promptFormat)},
			  '{"stream":true,"apiKey":"enc:abc123"}'::json)`
		)
	}
}

/** A database in the state an upgrading install is in: no table, real rows. */
async function upgrading(): Promise<{ db: TestDb; before: any[] }> {
	const db = await createTestDb()
	await regressToPreMigration(db)
	await expectPreMigrationState(db)
	await seedConnections(db)
	const before = await query(db, `SELECT * FROM "connections" ORDER BY "id"`)
	// ⚠ The regression, first. Without this the assertions after the migration
	// could all be describing an empty table.
	expect(before.length).toBe(SEED.length)
	return { db, before }
}

describe("0097 adds the template table and keys connections to it", () => {
	it("is ordered after everything registered before it, so an upgrade runs it", async () => {
		/**
		 * ⚠ `PgDialect.migrate` reads the last applied migration ONCE and then
		 * applies only files whose journal `when` is greater, so a file
		 * numbered at or below an already-applied index is **silently skipped**
		 * on every upgraded install. On an empty database the comparison
		 * short-circuits and every file applies regardless, which is why no
		 * ordinary integration test can see the difference — and why the
		 * checkable half is the ordering itself.
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

	it("seeds the templates before it adds the key that needs them", () => {
		/**
		 * ⚠ Pinned against the SHIPPED TEXT, because both orderings produce the
		 * same final schema and only one of them survives contact with a
		 * database that has rows. The INSERT must precede the ADD CONSTRAINT,
		 * and so must the UPDATE that clears the unmatched values.
		 */
		// Anchored on the statements themselves, not on a phrase — the file's
		// own comments talk about `ADD CONSTRAINT` too, and matching those
		// would make this pass or fail on the prose.
		const insertAt = MIGRATION.indexOf('INSERT INTO "completion_templates"')
		const updateAt = MIGRATION.indexOf(
			'UPDATE "connections"\nSET "prompt_format" = NULL'
		)
		const fkAt = MIGRATION.indexOf(
			'ALTER TABLE "connections" ADD CONSTRAINT'
		)
		expect(insertAt).toBeGreaterThan(-1)
		expect(updateAt).toBeGreaterThan(-1)
		expect(fkAt).toBeGreaterThan(-1)
		expect(insertAt).toBeLessThan(updateAt)
		expect(updateAt).toBeLessThan(fkAt)
		// And it is additive: nothing here drops a table.
		expect(MIGRATION).not.toMatch(/DROP TABLE/i)
	})

	it("keeps every connection, with every column it had", async () => {
		const { db, before } = await upgrading()

		await applyMigration(db)

		const after = await query(
			db,
			`SELECT * FROM "connections" ORDER BY "id"`
		)
		expect(after.length).toBe(SEED.length)

		// Column by column rather than a count. A migration that recreated the
		// table would keep the row count and lose the identity sequence, the
		// encrypted key in extra_json, and every base URL a user typed.
		// `prompt_format` is excluded here and checked on its own below —
		// it is the one column this file expects to change.
		for (const [i, row] of after.entries()) {
			for (const col of [
				"id",
				"name",
				"type",
				"modality",
				"base_url",
				"model",
				"token_counter",
				"extra_json"
			]) {
				expect(JSON.stringify(row[col]), `${col} on ${row.name}`).toBe(
					JSON.stringify(before[i][col])
				)
			}
		}
	}, 60_000)

	it("keeps a format that names a template and clears one that does not", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		const after = await query(
			db,
			`SELECT "name", "prompt_format" FROM "connections"`
		)
		const byName = new Map(after.map((r) => [r.name, r.prompt_format]))

		// Kept, exactly. These are choices someone made.
		expect(byName.get("Local Ollama")).toBe("vicuna")
		expect(byName.get("KoboldCPP")).toBe("chatml")
		expect(byName.get("Anthropic")).toBe("claude")
		// Not selectable, but seeded — so a connection already on it keeps it.
		expect(byName.get("Session split")).toBe("split_session")

		// Cleared, because they name nothing. NULL, not a substituted default:
		// the resolver answers absent and unresolved identically, so writing a
		// format here would be inventing a choice the user did not make.
		expect(byName.get("Never picked one")).toBeNull()
		expect(byName.get("Cleared the field")).toBeNull()
		expect(byName.get("Picked the dead arm")).toBeNull()
		expect(byName.get("From some other build")).toBeNull()
	}, 60_000)

	it("seeds every built-in immutable, with split_session unselectable", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		const rows = await query(
			db,
			`SELECT * FROM "completion_templates" ORDER BY "id"`
		)
		expect(rows.length).toBe(BUILTIN_COMPLETION_TEMPLATES.length)

		// ⚠ Every one immutable. `db/defaults.ts` re-applies a seed's full
		// contents on EVERY boot; the only thing that stops that from reverting
		// a user's edits is that the server refuses to accept an edit to an
		// immutable row in the first place.
		expect(rows.every((r) => r.is_immutable === true)).toBe(true)
		expect(rows.every((r) => r.seed_key !== null)).toBe(true)

		const byKey = new Map(rows.map((r) => [r.key, r]))
		for (const t of BUILTIN_COMPLETION_TEMPLATES) {
			const row = byKey.get(t.key)
			expect(row, `${t.key} was not seeded`).toBeTruthy()
			expect(row.seed_key).toBe(`completion-template-${t.key}`)
			expect(row.name).toBe(t.name)
			expect(row.render_mode).toBe(t.renderMode)
			expect(row.is_selectable).toBe(t.isSelectable)
			// The framing the migration wrote is the framing the renderer uses.
			// Two hand-maintained copies is how a seeded delimiter drifts from
			// the one that ships in code, and nothing at runtime compares them.
			expect(row.roles).toEqual(t.roles)
			expect(row.fallback_role).toEqual(t.fallbackRole)
			expect(row.stop_strings).toEqual(t.stopStrings)
		}

		expect(byKey.get("split_session").is_selectable).toBe(false)
		expect(byKey.get("split_session").render_mode).toBe("role_array")
	}, 60_000)

	it("clears the connection rather than deleting it when a template goes", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		// A template a user added, and a connection pointing at it.
		await db.execute(
			`INSERT INTO "completion_templates"
			 ("seed_key", "key", "name", "is_immutable", "render_mode")
			 VALUES (NULL, 'metharme', 'Metharme', false, 'flat')`
		)
		await db.execute(
			`UPDATE "connections" SET "prompt_format" = 'metharme'
			 WHERE "name" = 'From some other build'`
		)

		await db.execute(
			`DELETE FROM "completion_templates" WHERE "key" = 'metharme'`
		)

		const after = await query(
			db,
			`SELECT "prompt_format" FROM "connections"
			 WHERE "name" = 'From some other build'`
		)
		// ⚠ `set null`, following connection_defaults: the connection survives
		// with its format cleared. Cascade would have deleted a user's whole
		// connection — API key, base URL and all — because a template it
		// referenced was removed.
		expect(after.length).toBe(1)
		expect(after[0].prompt_format).toBeNull()
	}, 60_000)

	it("refuses a format that names no template", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		// The state the free-text column used to allow. It is what let `''` and
		// `'tekken'` accumulate in the first place.
		await expect(
			db.execute(
				`UPDATE "connections" SET "prompt_format" = 'not-a-template'
				 WHERE "name" = 'Local Ollama'`
			)
		).rejects.toThrow()

		await expect(
			db.execute(
				`UPDATE "connections" SET "prompt_format" = ''
				 WHERE "name" = 'Local Ollama'`
			)
		).rejects.toThrow()
	}, 60_000)
})
