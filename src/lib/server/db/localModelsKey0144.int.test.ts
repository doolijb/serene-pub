/**
 * Migration 0144: `local_models.filename` is no longer UNIQUE across the whole
 * table. A GGUF/safetensors file stays one row by filename; an ONNX row is one
 * per (Hub id, modality). An install at 0143 keeps its rows untouched, and a
 * second boot changes nothing.
 */
import { afterAll, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql } from "drizzle-orm"
import path from "node:path"
import { rawRows } from "./rawRows"
import { migrationsFolderThrough } from "$lib/server/utils/testDb"

const disposers: Array<() => Promise<void>> = []
afterAll(async () => {
	for (const d of disposers) await d()
})

describe("0144: local models keyed per modality", () => {
	it("keeps the rows, keys GGUF by filename and ONNX by filename + modality, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0143_lorebook_bindings_own_names"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			await q(
				`INSERT INTO local_models (filename, model_name, format, modality, kind, status)
				 VALUES ('model-a.gguf', 'model-a', 'gguf', 'text-gen', 'text', 'complete')`
			)
			await q(
				`INSERT INTO local_models (filename, model_name, format, modality, kind, status)
				 VALUES ('Xenova/all-MiniLM-L6-v2', 'all-MiniLM-L6-v2', 'onnx', 'embeddings', 'unknown', 'complete')`
			)
			const before = await q(`SELECT * FROM local_models ORDER BY id`)
			expect(before).toHaveLength(2)

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })
			expect(await q(`SELECT * FROM local_models ORDER BY id`)).toEqual(
				before
			)

			// The same Hub id for another modality is a second row.
			await q(
				`INSERT INTO local_models (filename, model_name, format, modality, kind, status)
				 VALUES ('Xenova/all-MiniLM-L6-v2', 'all-MiniLM-L6-v2', 'onnx', 'ner', 'unknown', 'complete')`
			)
			// A second row for the same GGUF file is refused, whatever its modality.
			await expect(
				q(
					`INSERT INTO local_models (filename, model_name, format, modality, kind, status)
					 VALUES ('model-a.gguf', 'model-a', 'gguf', 'image-gen', 'image', 'complete')`
				)
			).rejects.toThrow()
			// So is a second row for the same (Hub id, modality).
			await expect(
				q(
					`INSERT INTO local_models (filename, model_name, format, modality, kind, status)
					 VALUES ('Xenova/all-MiniLM-L6-v2', 'x', 'onnx', 'embeddings', 'unknown', 'complete')`
				)
			).rejects.toThrow()

			const rows = await q(`SELECT * FROM local_models ORDER BY id`)
			expect(rows).toHaveLength(3)
			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			expect(await q(`SELECT * FROM local_models ORDER BY id`)).toEqual(
				rows
			)
		} finally {
			await client.close()
		}
	}, 120_000)
})
