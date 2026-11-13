/**
 * Migration 0143 (§0-D): `lorebook_bindings.own_name` / `own_nickname`. An
 * install at 0142 holds a carded member; the real folder adds both columns as
 * NULL and changes nothing else; a second boot changes nothing.
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

describe("0143: a member's own names", () => {
	it("adds both columns as NULL, leaves the row alone, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0142_scenes_unfiled_default_names"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			await q(
				`INSERT INTO users (id, username) SELECT COALESCE(MAX(id), 0) + 1, 'own-names-0143' FROM users`
			)
			await q(
				`INSERT INTO lorebooks (name, user_id) SELECT 'Book', id FROM users ORDER BY id DESC LIMIT 1`
			)
			await q(
				`INSERT INTO characters (name, description, user_id) SELECT 'Verity', 'd', id FROM users ORDER BY id DESC LIMIT 1`
			)
			await q(
				`INSERT INTO lorebook_bindings (lorebook_id, character_id, binding, name)
				 SELECT l.id, c.id, '{{char:1}}', 'Verity' FROM lorebooks l, characters c LIMIT 1`
			)
			const before = (await q(`SELECT * FROM lorebook_bindings`))[0]
			expect("own_name" in before).toBe(false)

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })
			const after = (await q(`SELECT * FROM lorebook_bindings`))[0]
			expect(after.own_name).toBeNull()
			expect(after.own_nickname).toBeNull()
			// Later migrations add their own columns (0145: `overlay_of`, `timbre`);
			// 0143 must keep every column the row had before it.
			const rest = Object.fromEntries(
				Object.keys(before).map((k) => [k, after[k]])
			)
			expect(rest).toEqual(before)

			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			expect((await q(`SELECT * FROM lorebook_bindings`))[0]).toEqual(
				after
			)
		} finally {
			await client.close()
		}
	}, 120_000)
})
