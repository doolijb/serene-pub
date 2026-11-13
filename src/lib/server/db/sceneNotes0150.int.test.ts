/**
 * Migration 0150: `scenes.notes`, the notes a run set down on a scene (jsonb,
 * null when none). A 0149 install keeps every scene with the column null; a
 * note array reads back as written; and a second boot changes nothing.
 *
 * No boot pass: scenes made before have no notes.
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

const COUNTED = ["users", "sessions", "lorebooks", "scenes"]

describe("0150: scene notes column", () => {
	it("keeps 0149 scenes with notes null, a note array reads back, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0149_familiar_silk_fever"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0149-shaped install ────────────────────────────────────
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
			const [{ id: bookId }] = await q(`SELECT id FROM lorebooks`)
			await q(
				`INSERT INTO scenes (session_id, lorebook_id) VALUES (${sessionId}, ${bookId})`
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
			expect(await q(`SELECT id FROM scenes WHERE notes IS NULL`)).toEqual(
				before.scenes
			)

			// ── a note array reads back ──────────────────────────────────
			await q(
				`UPDATE scenes SET notes = '[{"text":"x","runId":null,"messageId":null,"at":"2026-11-10T00:00:00.000Z"}]'::jsonb`
			)
			expect(await q(`SELECT notes FROM scenes`)).toEqual([
				{
					notes: [
						{
							text: "x",
							runId: null,
							messageId: null,
							at: "2026-11-10T00:00:00.000Z"
						}
					]
				}
			])

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
