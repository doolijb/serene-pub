/**
 * Migration 0162: `lorebook_entries.decay_rate` (real, NOT NULL, default 0).
 * A 0161 install keeps every row, each reading 0; a second boot changes nothing.
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

describe("0162: an entry's decay rate", () => {
	it("keeps 0161 rows at rate 0, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0161_flowery_bishop"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			const column = `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'lorebook_entries' AND column_name = 'decay_rate'`
			expect(await q(column)).toEqual([])
			await q(
				`INSERT INTO users (username) SELECT 'decay-owner' WHERE NOT EXISTS (SELECT 1 FROM users)`
			)
			await q(
				`INSERT INTO lorebooks (name, user_id) SELECT 'Book', min(id) FROM users`
			)
			await q(
				`INSERT INTO pipeline_definition_registry (definition_id, version, kind) VALUES ('core:entry/world-lore', 1, 'entry')`
			)
			await q(
				`INSERT INTO lorebook_entries (lorebook_id, type_id, type_version, position) SELECT id, 'core:entry/world-lore', 1, 1 FROM lorebooks`
			)

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			const [col] = await q(column)
			expect(col.data_type).toBe("real")
			expect(col.is_nullable).toBe("NO")
			expect(String(col.column_default)).toMatch(/^0/)
			expect(await q(`SELECT decay_rate FROM lorebook_entries`)).toEqual([
				{ decay_rate: 0 }
			])

			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				column: await q(column),
				rows: await q(
					`SELECT id, decay_rate FROM lorebook_entries ORDER BY id`
				)
			})
			const before = await snap()
			await migrate(db, { migrationsFolder: real })
			expect(await snap()).toEqual(before)
		} finally {
			await client.close()
		}
	}, 60_000)
})
