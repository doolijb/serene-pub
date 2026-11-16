/**
 * Migration 0166 drops `session_messages.firsthand_cast_member_ids`. A 0165
 * install keeps every message (id and content), loses only the column, and ends
 * with the same schema as a fresh install; a second boot changes nothing.
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

const COLUMNS = `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`
const INDEXES = `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`

describe("0166: the per-message seated set is dropped", () => {
	it("keeps messages, drops the column, matches a fresh install, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0165_message_firsthand"
		)
		disposers.push(dispose)
		const real = path.resolve(process.cwd(), "drizzle")
		const client = new PGlite()
		const fresh = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			await q(
				`INSERT INTO users (username) SELECT 'firsthand-owner' WHERE NOT EXISTS (SELECT 1 FROM users)`
			)
			await q(
				`INSERT INTO sessions (user_id, is_group) SELECT min(id), false FROM users`
			)
			await q(
				`INSERT INTO session_messages (session_id, role, content, firsthand_cast_member_ids) SELECT min(id), 'user', 'stamped', '{3,7}' FROM sessions`
			)
			await q(
				`INSERT INTO session_messages (session_id, role, content) SELECT min(id), 'user', 'plain' FROM sessions`
			)
			const messagesBefore = await q(
				`SELECT id, content FROM session_messages ORDER BY id`
			)
			expect(messagesBefore).toHaveLength(2)

			await migrate(db, { migrationsFolder: real })

			const dropped = await q(
				`SELECT column_name FROM information_schema.columns WHERE table_name = 'session_messages' AND column_name = 'firsthand_cast_member_ids'`
			)
			expect(dropped).toEqual([])
			expect(
				await q(`SELECT id, content FROM session_messages ORDER BY id`)
			).toEqual(messagesBefore)

			const freshDb = drizzle(fresh)
			await migrate(freshDb, { migrationsFolder: real })
			const fq = async (s: string) =>
				rawRows<any>(await freshDb.execute(sql.raw(s)))
			expect(await q(COLUMNS)).toEqual(await fq(COLUMNS))
			expect(await q(INDEXES)).toEqual(await fq(INDEXES))

			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				rows: await q(`SELECT * FROM session_messages ORDER BY id`),
				columns: await q(COLUMNS)
			})
			const before = await snap()
			await migrate(db, { migrationsFolder: real })
			expect(await snap()).toEqual(before)
		} finally {
			await client.close()
			await fresh.close()
		}
	}, 120_000)
})
