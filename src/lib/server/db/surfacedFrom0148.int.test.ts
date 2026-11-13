/**
 * Migration 0148 (owner ★B-3, 2026-11-08): `lorebooks.surfaced_from_session_id`,
 * the session a surfaced book came from (FK to `sessions`, ON DELETE SET NULL).
 * A 0147 install keeps every row with the column null; deleting the session
 * makes a stamped book ordinary; and a second boot changes nothing.
 *
 * No boot pass: books shared before today have no record of their session and
 * stay ordinary.
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

const COUNTED = ["users", "sessions", "lorebooks"]

describe("0148: surfaced book column", () => {
	it("keeps 0147 rows with the column null, SET NULL holds, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0147_cast_member_files"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0147-shaped install ────────────────────────────────────
			const [{ id: userId }] = await q(
				`SELECT id FROM users ORDER BY id LIMIT 1`
			)
			await q(
				`INSERT INTO sessions (user_id, name, is_group) VALUES (${userId}, 'Tale', false)`
			)
			const [{ id: sessionId }] = await q(`SELECT id FROM sessions`)
			await q(
				`INSERT INTO lorebooks (name, user_id) VALUES ('Book', ${userId})`
			)
			await q(
				`INSERT INTO lorebooks (name, user_id, session_id) VALUES ('Notes', ${userId}, ${sessionId})`
			)

			const before: Record<string, any[]> = {}
			for (const t of COUNTED)
				before[t] = await q(`SELECT id FROM ${t} ORDER BY id`)

			// ── the real folder ──────────────────────────────────────────
			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			for (const t of COUNTED)
				expect(await q(`SELECT id FROM ${t} ORDER BY id`), t).toEqual(
					before[t]
				)
			expect(
				await q(
					`SELECT id FROM lorebooks WHERE surfaced_from_session_id IS NOT NULL`
				)
			).toEqual([])

			// ── the foreign key: the session going makes the book ordinary ─
			const [{ id: bookId }] = await q(
				`SELECT id FROM lorebooks WHERE name = 'Book'`
			)
			await q(
				`UPDATE lorebooks SET surfaced_from_session_id = ${sessionId} WHERE id = ${bookId}`
			)
			await expect(
				q(
					`UPDATE lorebooks SET surfaced_from_session_id = 999999 WHERE id = ${bookId}`
				)
			).rejects.toBeTruthy()
			await q(`DELETE FROM sessions WHERE id = ${sessionId}`)
			expect(
				await q(
					`SELECT surfaced_from_session_id FROM lorebooks WHERE id = ${bookId}`
				)
			).toEqual([{ surfaced_from_session_id: null }])

			// ── a second boot changes nothing ────────────────────────────
			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			const dump: Record<string, any[]> = {}
			for (const t of COUNTED)
				dump[t] = await q(`SELECT * FROM ${t} ORDER BY id`)
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			for (const t of COUNTED)
				expect(await q(`SELECT * FROM ${t} ORDER BY id`), t).toEqual(
					dump[t]
				)
		} finally {
			await client.close()
		}
	}, 60_000)
})
