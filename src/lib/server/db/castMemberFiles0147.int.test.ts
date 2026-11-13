/**
 * Migration 0147 (plan §34.2, owner ★2 2026-11-08): the `cast_member_files`
 * link table (a cast member's gallery) and the retirement of
 * `files.cast_member_id`. A 0146 install keeps every row; the table is empty;
 * the column is gone; the link's unique index and both cascades hold; and a
 * second boot changes nothing.
 *
 * No boot pass: nothing has ever written `files.cast_member_id` (it arrived in
 * 0146 three days earlier and its one reader was the backdrop's cast-image
 * test), so the drop loses nothing.
 *
 * A fresh database is covered by every other int test: `createTestDb` applies
 * the whole chain, 0147 included.
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

const COUNTED = [
	"users",
	"characters",
	"lorebooks",
	"lorebook_bindings",
	"files"
]

describe("0147: cast member gallery table", () => {
	it("keeps 0146 rows, adds the link table, drops the column, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0146_character_versions"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0146-shaped install ────────────────────────────────────
			const [{ id: userId }] = await q(
				`SELECT id FROM users ORDER BY id LIMIT 1`
			)
			await q(
				`INSERT INTO characters (name, description, user_id) VALUES ('Ada', '', ${userId})`
			)
			const [{ id: adaId }] = await q(`SELECT id FROM characters`)
			await q(
				`INSERT INTO lorebooks (name, user_id) VALUES ('Book', ${userId})`
			)
			const [{ id: bookId }] = await q(`SELECT id FROM lorebooks`)
			await q(
				`INSERT INTO lorebook_bindings (lorebook_id, character_id, binding, name)
				 VALUES (${bookId}, ${adaId}, '{{char:1}}', 'Ada')`
			)
			const [{ id: memberId }] = await q(
				`SELECT id FROM lorebook_bindings`
			)
			await q(
				`INSERT INTO files (user_id, kind, hash) VALUES (${userId}, 'image', 'h1')`
			)
			await q(
				`INSERT INTO files (user_id, kind, hash, cast_member_id) VALUES (${userId}, 'image', 'h2', ${memberId})`
			)

			const before: Record<string, number> = {}
			for (const t of COUNTED) {
				before[t] = (
					await q(`SELECT count(*)::int AS n FROM ${t}`)
				)[0].n
			}

			// ── the real folder ──────────────────────────────────────────
			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			for (const t of COUNTED) {
				expect(
					(await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n,
					t
				).toBe(before[t])
			}
			expect(await q(`SELECT id FROM cast_member_files`)).toHaveLength(0)
			expect(
				await q(
					`SELECT column_name FROM information_schema.columns WHERE table_name = 'files' AND column_name = 'cast_member_id'`
				)
			).toEqual([])

			// ── the link table's rules ───────────────────────────────────
			const [{ id: f1 }, { id: f2 }] = await q(
				`SELECT id FROM files ORDER BY id`
			)
			await q(
				`INSERT INTO cast_member_files (cast_member_id, file_id, position) VALUES (${memberId}, ${f1}, 0)`
			)
			await q(
				`INSERT INTO cast_member_files (cast_member_id, file_id, position) VALUES (${memberId}, ${f2}, 1)`
			)
			await expect(
				q(
					`INSERT INTO cast_member_files (cast_member_id, file_id) VALUES (${memberId}, ${f1})`
				)
			).rejects.toSatisfy((e: any) =>
				/cast_member_files_member_file_uq/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			// A deleted file takes its link.
			await q(`DELETE FROM files WHERE id = ${f1}`)
			expect(
				(await q(`SELECT file_id FROM cast_member_files`)).map(
					(r) => r.file_id
				)
			).toEqual([f2])
			// A deleted member takes its links.
			await q(`DELETE FROM lorebook_bindings WHERE id = ${memberId}`)
			expect(await q(`SELECT id FROM cast_member_files`)).toHaveLength(0)

			// ── a second boot changes nothing ────────────────────────────
			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			const counts: Record<string, number> = {}
			for (const t of [...COUNTED, "cast_member_files"]) {
				counts[t] = (
					await q(`SELECT count(*)::int AS n FROM ${t}`)
				)[0].n
			}
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			for (const t of Object.keys(counts)) {
				expect(
					(await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n,
					t
				).toBe(counts[t])
			}
		} finally {
			await client.close()
		}
	}, 60_000)
})
