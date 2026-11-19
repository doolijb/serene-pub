/**
 * Migration 0169: `lorebook_entries.entry_lock`, `scenes.scene_lock`,
 * `lorebook_bindings.cast_member_lock` (boolean, NOT NULL, default false) and
 * `lorebook_bindings.created_by` (nullable user id, SET NULL). A 0168 install
 * keeps every row at the defaults; a second boot changes nothing.
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

describe("0169: the run locks and the cast member's maker", () => {
	it("keeps 0168 rows at the defaults, nulls a deleted maker, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0168_sparkling_lethal_legion"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			await q(
				`INSERT INTO users (id, username) SELECT coalesce(max(id), 0) + 1, 'lock-owner' FROM users`
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
			await q(`INSERT INTO scenes (lorebook_id) SELECT id FROM lorebooks`)
			await q(
				`INSERT INTO lorebook_bindings (lorebook_id, binding) SELECT min(id), '{{char:1}}' FROM lorebooks`
			)

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			expect(
				await q(`SELECT entry_lock FROM lorebook_entries`)
			).toEqual([{ entry_lock: false }])
			expect(await q(`SELECT scene_lock FROM scenes`)).toEqual([
				{ scene_lock: false }
			])
			expect(
				await q(
					`SELECT cast_member_lock, created_by FROM lorebook_bindings`
				)
			).toEqual([{ cast_member_lock: false, created_by: null }])

			await q(
				`INSERT INTO users (id, username) SELECT max(id) + 1, 'maker' FROM users`
			)
			await q(
				`UPDATE lorebook_bindings SET created_by = (SELECT id FROM users WHERE username = 'maker')`
			)
			await q(`DELETE FROM users WHERE username = 'maker'`)
			expect(
				await q(`SELECT created_by FROM lorebook_bindings`)
			).toEqual([{ created_by: null }])

			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				entries: await q(`SELECT * FROM lorebook_entries ORDER BY id`),
				scenes: await q(`SELECT * FROM scenes ORDER BY id`),
				members: await q(`SELECT * FROM lorebook_bindings ORDER BY id`)
			})
			const before = await snap()
			await migrate(db, { migrationsFolder: real })
			expect(await snap()).toEqual(before)
		} finally {
			await client.close()
		}
	}, 60_000)
})
