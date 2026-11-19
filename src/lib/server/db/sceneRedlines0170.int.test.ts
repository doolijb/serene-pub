/**
 * Migration 0170: `lore_redlines` takes a fourth subject, a scene's cast. A
 * 0169 install keeps its entry and cast-version rows (`scene_id` null); the
 * subject CHECK admits exactly one of the three keys and refuses an amendment
 * on a scene row; `scene-compiler` is a cause; a second boot changes nothing.
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

describe("0170: a scene's edit history", () => {
	it("keeps 0169 rows, guards the subject and cause, and a second boot changes nothing", async () => {
		const { folder, dispose } =
			await migrationsFolderThrough("0169_normal_gauntlet")
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			await q(
				`INSERT INTO users (username) SELECT 'redline-owner' WHERE NOT EXISTS (SELECT 1 FROM users)`
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
			await q(
				`INSERT INTO characters (user_id, name, description) SELECT min(id), 'Card', '' FROM users`
			)
			await q(
				`INSERT INTO character_versions (card_id, number, write_order) SELECT id, 1, 1 FROM characters`
			)
			await q(
				`INSERT INTO lore_redlines (entry_id, changes, cause) SELECT min(id), '{}'::jsonb, 'save' FROM lorebook_entries`
			)
			await q(
				`INSERT INTO lore_redlines (character_version_id, changes, cause) SELECT min(id), '{}'::jsonb, 'routine' FROM character_versions`
			)

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			expect(
				await q(
					`SELECT entry_id IS NOT NULL AS entry, character_version_id IS NOT NULL AS version, scene_id, cause FROM lore_redlines ORDER BY id`
				)
			).toEqual([
				{ entry: true, version: false, scene_id: null, cause: "save" },
				{ entry: false, version: true, scene_id: null, cause: "routine" }
			])

			await q(
				`INSERT INTO scenes (lorebook_id, history_entry_id) SELECT lorebook_id, id FROM lorebook_entries`
			)
			const [{ entry }] = await q(
				`SELECT min(id) AS entry FROM lorebook_entries`
			)
			const [{ version }] = await q(
				`SELECT min(id) AS version FROM character_versions`
			)
			const [{ scene }] = await q(`SELECT min(id) AS scene FROM scenes`)
			const insert = (
				e: unknown,
				v: unknown,
				s: unknown,
				amendment = "NULL",
				cause = "scene-compiler"
			) =>
				q(
					`INSERT INTO lore_redlines (entry_id, character_version_id, scene_id, amendment_id, changes, cause) VALUES (${e ?? "NULL"}, ${v ?? "NULL"}, ${s ?? "NULL"}, ${amendment}, '{}'::jsonb, '${cause}')`
				)
			await expect(insert(entry, null, scene)).rejects.toThrow()
			await expect(insert(null, version, scene)).rejects.toThrow()
			await expect(insert(null, null, null)).rejects.toThrow()
			await expect(insert(null, null, scene, "1")).rejects.toThrow()
			await expect(
				insert(null, null, scene, "NULL", "bogus")
			).rejects.toThrow()
			await insert(null, null, scene)

			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				columns: await q(
					`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'lore_redlines' ORDER BY column_name`
				),
				constraints: await q(
					`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'lore_redlines'::regclass ORDER BY conname`
				),
				rows: await q(
					`SELECT id, entry_id, character_version_id, scene_id FROM lore_redlines ORDER BY id`
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
