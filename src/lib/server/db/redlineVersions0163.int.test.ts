/**
 * Migration 0163: `lore_redlines` takes a second subject. A 0162 install keeps
 * its entry rows (`character_version_id` null); `entry_id` is nullable; the
 * subject CHECK refuses both keys, neither, and an amendment on a card
 * version's row; a second boot changes nothing.
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

describe("0163: a character version's edit history", () => {
	it("keeps 0162 rows, guards the subject, and a second boot changes nothing", async () => {
		const { folder, dispose } =
			await migrationsFolderThrough("0162_entry_decay")
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
				`INSERT INTO lore_redlines (entry_id, changes, cause) SELECT id, '{}'::jsonb, 'save' FROM lorebook_entries`
			)

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			expect(
				await q(
					`SELECT entry_id IS NOT NULL AS has, character_version_id FROM lore_redlines`
				)
			).toEqual([{ has: true, character_version_id: null }])
			const [nullable] = await q(
				`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'lore_redlines' AND column_name = 'entry_id'`
			)
			expect(nullable.is_nullable).toBe("YES")

			// A card version to hang a row on.
			await q(
				`INSERT INTO characters (user_id, name, description) SELECT min(id), 'Card', '' FROM users`
			)
			await q(
				`INSERT INTO character_versions (card_id, number, write_order) SELECT id, 1, 1 FROM characters`
			)
			const [{ entry }] = await q(
				`SELECT min(id) AS entry FROM lorebook_entries`
			)
			const [{ version }] = await q(
				`SELECT min(id) AS version FROM character_versions`
			)
			const insert = (
				entryId: unknown,
				versionId: unknown,
				amendment = "NULL"
			) =>
				q(
					`INSERT INTO lore_redlines (entry_id, character_version_id, amendment_id, changes, cause) VALUES (${entryId ?? "NULL"}, ${versionId ?? "NULL"}, ${amendment}, '{}'::jsonb, 'save')`
				)
			await expect(insert(entry, version)).rejects.toThrow()
			await expect(insert(null, null)).rejects.toThrow()
			await expect(insert(null, version, "1")).rejects.toThrow()
			await insert(null, version)

			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				columns: await q(
					`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'lore_redlines' ORDER BY column_name`
				),
				rows: await q(
					`SELECT id, entry_id, character_version_id FROM lore_redlines ORDER BY id`
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
