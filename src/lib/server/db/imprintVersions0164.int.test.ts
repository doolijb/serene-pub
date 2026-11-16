/**
 * Migration 0164: `lore_imprints.subject_kind` also admits `version`. A 0163
 * install keeps its rows, a `version` row inserts, any other kind is refused,
 * and a second boot changes nothing.
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

describe("0164: a version in the per-turn record", () => {
	it("admits the version kind, refuses another, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough("0163_redline_versions")
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) => rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			await q(`INSERT INTO users (username) SELECT 'imprint-owner' WHERE NOT EXISTS (SELECT 1 FROM users)`)
			await q(`INSERT INTO lorebooks (name, user_id) SELECT 'Book', min(id) FROM users`)
			await q(`INSERT INTO sessions (user_id, is_group, lorebook_id) SELECT min(user_id), false, min(id) FROM lorebooks`)
			const imprint = (kind: string) =>
				`INSERT INTO lore_imprints (session_id, lorebook_id, subject_kind, subject_id) SELECT s.id, s.lorebook_id, '${kind}', 1 FROM sessions s`
			await q(imprint("entry"))

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			await q(imprint("version"))
			await expect(q(imprint("bogus"))).rejects.toThrow()
			expect(await q(`SELECT subject_kind FROM lore_imprints ORDER BY id`)).toEqual([
				{ subject_kind: "entry" },
				{ subject_kind: "version" }
			])

			const snap = async () => ({
				ledger: await q(`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`),
				rows: await q(`SELECT id, subject_kind, subject_id FROM lore_imprints ORDER BY id`)
			})
			const before = await snap()
			await migrate(db, { migrationsFolder: real })
			expect(await snap()).toEqual(before)
		} finally {
			await client.close()
		}
	}, 60_000)
})
