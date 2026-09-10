/**
 * `0096_local_model_registry.sql` renames a table that holds rows a user owns.
 *
 * ## Why a fresh database cannot check the thing that matters
 *
 * Every integration suite in this repo builds an empty database, and an empty
 * database has no rows to lose. A migration that answered the rename prompt as
 * a *create* — `DROP TABLE "koboldcpp_models" CASCADE` followed by
 * `CREATE TABLE "local_models"` — produces exactly the same final schema, so
 * every other test in this repo stays green while every real upgrade silently
 * forgets which models the user had downloaded. Multi-gigabyte files left on
 * disk with no row pointing at them, discoverable only by the next scan, and
 * with every piece of provenance on the row (where it came from, what a human
 * said it was) gone for good.
 *
 * So this file does what no fresh database does: it puts the schema BACK to the
 * state an upgrading install is in, fills it with rows, and only then applies
 * the file that ships.
 *
 * ## The two new columns are not the same kind of fact
 *
 * `format` is a property of the bytes and is read off the name — which is why
 * the backfill cannot simply be the column default: this table has always
 * accepted `.safetensors`, and a `.safetensors` row claiming to be a GGUF would
 * be a falsehood about a file anyone can look at.
 *
 * `modality` is not detectable at all — the curated image models are every one
 * of them `.gguf` — so it is projected from `kind`, and `kind = 'unknown'` is
 * left NULL rather than being given a role nothing measured.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync("drizzle/0096_local_model_registry.sql", "utf8")

const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"))
	const entries = journal.entries as Array<{
		tag: string
		idx: number
		when: number
	}>
	const entry = entries.find((e) => e.tag === "0096_local_model_registry")
	expect(entry, "0096 has no journal entry, so it runs nowhere").toBeTruthy()
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
 * Put the schema back the way an install that has not run 0096 has it.
 *
 * Hand-written, and therefore checked: `expectPreMigrationState` below asserts
 * the regression actually happened, because an inverse that quietly did nothing
 * would leave every assertion in this file passing against a database that was
 * already migrated — the vacuous green this whole file exists to avoid.
 */
async function regressToPreMigration(db: TestDb) {
	await db.execute(
		`ALTER TABLE "local_models" DROP CONSTRAINT "local_models_filename_unique"`
	)
	await db.execute(`ALTER TABLE "local_models" DROP COLUMN "format"`)
	await db.execute(`ALTER TABLE "local_models" DROP COLUMN "modality"`)
	await db.execute(`ALTER TABLE "local_models" RENAME TO "koboldcpp_models"`)
	await db.execute(
		`ALTER TABLE "koboldcpp_models"
		 ADD CONSTRAINT "koboldcpp_models_filename_unique" UNIQUE("filename")`
	)
}

async function expectPreMigrationState(db: TestDb) {
	const tables = await query(
		db,
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public'
		 AND table_name IN ('koboldcpp_models', 'local_models')`
	)
	expect(tables.map((t) => t.table_name).sort()).toEqual(["koboldcpp_models"])

	const columns = await query(
		db,
		`SELECT column_name FROM information_schema.columns
		 WHERE table_name = 'koboldcpp_models'
		 AND column_name IN ('format', 'modality')`
	)
	expect(columns).toEqual([])
}

/**
 * The rows an upgrading install plausibly has: both extensions, all three
 * kinds, all four points of the trust order, and one download that was still
 * in flight.
 */
const SEED = [
	{
		filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
		modelName: "Llama 3.2 3B Instruct",
		modelUrl: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF",
		description: "A text LLM downloaded through the UI",
		quantization: "Q4_K_M",
		sizeBytes: 2019377440,
		status: "complete",
		errorMessage: null,
		kind: "text",
		kindSource: "detected"
	},
	{
		filename: "imgmodel_xl_q4_0.gguf",
		modelName: "SDXL (curated)",
		modelUrl: "https://huggingface.co/koboldcpp/imgmodel",
		description: "An image model that is also a .gguf",
		quantization: null,
		sizeBytes: 6938041344,
		status: "complete",
		errorMessage: null,
		kind: "image",
		kindSource: "detected"
	},
	{
		filename: "sd_xl_base_1.0.safetensors",
		modelName: "SDXL Base 1.0",
		modelUrl: null,
		description: "Placed in the folder by hand",
		quantization: null,
		sizeBytes: 6938078334,
		status: "complete",
		errorMessage: null,
		kind: "image",
		kindSource: "user"
	},
	{
		filename: "mystery-arch.gguf",
		modelName: "mystery-arch",
		modelUrl: null,
		description: null,
		quantization: null,
		sizeBytes: 1234567,
		status: "complete",
		errorMessage: null,
		kind: "unknown",
		kindSource: "assumed"
	},
	{
		filename: "half-downloaded.gguf",
		modelName: "half-downloaded",
		modelUrl: null,
		description: null,
		quantization: "Q8_0",
		sizeBytes: null,
		status: "error",
		errorMessage: "Server restarted during download",
		kind: "text",
		kindSource: "declared"
	}
]

const sqlText = (v: string | null) => (v === null ? "NULL" : `'${v}'`)
const sqlNum = (v: number | null) => (v === null ? "NULL" : String(v))

async function seedOldTable(db: TestDb) {
	for (const r of SEED) {
		await db.execute(
			`INSERT INTO "koboldcpp_models"
			 ("filename", "model_name", "model_url", "description",
			  "quantization", "size_bytes", "status", "error_message",
			  "kind", "kind_source")
			 VALUES (${sqlText(r.filename)}, ${sqlText(r.modelName)},
			  ${sqlText(r.modelUrl)}, ${sqlText(r.description)},
			  ${sqlText(r.quantization)}, ${sqlNum(r.sizeBytes)},
			  ${sqlText(r.status)}, ${sqlText(r.errorMessage)},
			  ${sqlText(r.kind)}, ${sqlText(r.kindSource)})`
		)
	}
}

/** A database in the state an upgrading install is in: old table, real rows. */
async function upgrading(): Promise<{ db: TestDb; before: any[] }> {
	const db = await createTestDb()
	await regressToPreMigration(db)
	await expectPreMigrationState(db)
	await seedOldTable(db)
	const before = await query(
		db,
		`SELECT * FROM "koboldcpp_models" ORDER BY "id"`
	)
	// ⚠ The regression, first. Without this the assertions after the migration
	// could all be describing an empty table.
	expect(before.length).toBe(SEED.length)
	return { db, before }
}

describe("0096 renames the table without losing what is in it", () => {
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

	it("is a rename and not a drop-and-create", () => {
		/**
		 * ⚠ The hazard this whole file exists for, pinned against the SHIPPED
		 * text rather than against a database — because the two answers to
		 * drizzle-kit's prompt reach the same final schema, and only one of them
		 * keeps the rows. If this migration is ever regenerated, the prompt must
		 * be answered "rename".
		 */
		expect(MIGRATION).toMatch(
			/ALTER TABLE "koboldcpp_models" RENAME TO "local_models"/
		)
		expect(MIGRATION).not.toMatch(/DROP TABLE/i)
	})

	it("keeps every row, with every column it had", async () => {
		const { db, before } = await upgrading()

		await applyMigration(db)

		const after = await query(db, `SELECT * FROM "local_models" ORDER BY "id"`)
		expect(after.length).toBe(SEED.length)

		// Column by column rather than a count: a migration that kept the row
		// count while blanking `model_url` and `description` would pass a
		// length check and still have thrown away everything a user cares to
		// read on the Manager screen. `id` is in here too — a connection names
		// a model by filename, but a re-created table would restart the
		// identity sequence and nothing else would notice.
		for (const [i, row] of after.entries()) {
			for (const col of [
				"id",
				"filename",
				"model_name",
				"model_url",
				"description",
				"quantization",
				"size_bytes",
				"status",
				"error_message",
				"kind",
				"kind_source",
				"created_at"
			]) {
				expect(
					String(row[col]),
					`${col} on ${row.filename}`
				).toBe(String(before[i][col]))
			}
		}
	}, 60_000)

	it("backfills format off the filename, not off the column default", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		const after = await query(
			db,
			`SELECT "filename", "format" FROM "local_models"`
		)
		const byName = new Map(after.map((r) => [r.filename, r.format]))
		expect(byName.get("sd_xl_base_1.0.safetensors")).toBe("safetensors")
		// ⚠ And the three .gguf rows are NOT all "text": the curated image model
		// is a .gguf too, which is the whole reason format and modality are
		// separate columns.
		expect(byName.get("imgmodel_xl_q4_0.gguf")).toBe("gguf")
		expect(byName.get("Llama-3.2-3B-Instruct-Q4_K_M.gguf")).toBe("gguf")
		expect(byName.get("mystery-arch.gguf")).toBe("gguf")
		expect(byName.get("half-downloaded.gguf")).toBe("gguf")
		expect(after.every((r) => r.format !== null)).toBe(true)
	}, 60_000)

	it("projects modality from kind and leaves 'unknown' with none", async () => {
		const { db } = await upgrading()

		await applyMigration(db)

		const after = await query(
			db,
			`SELECT "filename", "kind", "modality" FROM "local_models"`
		)
		const byName = new Map(after.map((r) => [r.filename, r.modality]))
		expect(byName.get("Llama-3.2-3B-Instruct-Q4_K_M.gguf")).toBe("text-gen")
		expect(byName.get("half-downloaded.gguf")).toBe("text-gen")
		expect(byName.get("imgmodel_xl_q4_0.gguf")).toBe("image-gen")
		expect(byName.get("sd_xl_base_1.0.safetensors")).toBe("image-gen")
		// NULL, not "text-gen". The classifier reaching "unknown" means it
		// looked and could not tell; a role written here would be an assertion
		// nothing measured, and an unreadable file offered as a working text
		// model fails at load time with nothing on screen to say why.
		expect(byName.get("mystery-arch.gguf")).toBeNull()

		// No row ends up with a modality its kind does not imply — the property
		// the single `modalityForKind` projection exists to hold.
		for (const r of after) {
			if (r.kind === "text") expect(r.modality).toBe("text-gen")
			if (r.kind === "image") expect(r.modality).toBe("image-gen")
			if (r.kind === "unknown") expect(r.modality).toBeNull()
		}
	}, 60_000)

	it("carries the unique filename constraint across the rename", async () => {
		// The constraint is DROPped under its old name and re-ADDed under the
		// new one, so it is genuinely gone for part of this file. A version that
		// forgot to add it back would let the scan's upsert insert a duplicate
		// row per directory instead of updating one.
		const { db } = await upgrading()

		await applyMigration(db)

		await expect(
			db.execute(
				`INSERT INTO "local_models" ("filename", "model_name")
				 VALUES ('mystery-arch.gguf', 'a duplicate')`
			)
		).rejects.toThrow(/unique/i)
	}, 60_000)

	it("leaves the identity column still handing out fresh ids", async () => {
		// A rename keeps the sequence (still named `koboldcpp_models_id_seq`,
		// which is cosmetic — Postgres tracks it by OID). Worth pinning because
		// the failure mode is a duplicate-key error on the first model anyone
		// downloads after upgrading, not anything visible at migration time.
		const { db, before } = await upgrading()

		await applyMigration(db)

		const inserted = await query(
			db,
			`INSERT INTO "local_models" ("filename", "model_name")
			 VALUES ('added-after-upgrade.gguf', 'added after upgrade')
			 RETURNING "id", "format", "modality"`
		)
		expect(Number(inserted[0].id)).toBeGreaterThan(
			Math.max(...before.map((r) => Number(r.id)))
		)
		// The column default, which is the one place a new row may take it —
		// every application writer passes `formatForFilename` instead.
		expect(inserted[0].format).toBe("gguf")
		expect(inserted[0].modality).toBeNull()
	}, 60_000)
})
