/**
 * Migration 0154 (lane sense-age2, owner ruling 2026-11-11: stat time is
 * tracked relative to the session): `attribute_values` gains the five nullable
 * `story_clock_*` columns, with the same shape CHECKs as `session_messages`.
 * A 0153 install keeps every row, each reading null; there is no backfill and
 * no boot pass; and a second boot changes nothing.
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

const CLOCK_COLUMNS = [
	"story_clock_year",
	"story_clock_month",
	"story_clock_day",
	"story_clock_hour",
	"story_clock_minute"
]

describe("0154: story clock on attribute values", () => {
	it("keeps 0153 rows with null clocks, refuses a minute without an hour, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0153_loving_kingpin"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0153-shaped install ────────────────────────────────────
			expect(
				await q(
					`SELECT column_name FROM information_schema.columns WHERE table_name = 'attribute_values' AND column_name = 'story_clock_year'`
				)
			).toEqual([])
			await q(
				`INSERT INTO attribute_values (owner_kind, owner_id, slot_id, value) VALUES ('card', 1, 'core:slot/hp@1', '{"v":5}'::jsonb)`
			)

			// ── the real folder ──────────────────────────────────────────
			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			const rows = await q(
				`SELECT ${CLOCK_COLUMNS.join(", ")} FROM attribute_values`
			)
			expect(rows).toHaveLength(1)
			for (const c of CLOCK_COLUMNS) expect(rows[0][c], c).toBeNull()

			// ── the shape CHECK ──────────────────────────────────────────
			await expect(
				q(
					`INSERT INTO attribute_values (owner_kind, owner_id, slot_id, value, story_clock_year, story_clock_minute) VALUES ('card', 2, 'core:slot/hp@1', '{"v":1}'::jsonb, 1204, 30)`
				)
			).rejects.toBeTruthy()
			await q(
				`INSERT INTO attribute_values (owner_kind, owner_id, slot_id, value, story_clock_year, story_clock_month, story_clock_day, story_clock_hour, story_clock_minute) VALUES ('card', 3, 'core:slot/hp@1', '{"v":1}'::jsonb, 1204, 3, 5, 9, 30)`
			)
			await q(`DELETE FROM attribute_values WHERE owner_id = 3`)

			// ── a second boot changes nothing ────────────────────────────
			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			const columns = await q(
				`SELECT column_name FROM information_schema.columns WHERE table_name = 'attribute_values' ORDER BY ordinal_position`
			)
			const count = (
				await q(`SELECT count(*)::int AS n FROM attribute_values`)
			)[0].n
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			expect(
				await q(
					`SELECT column_name FROM information_schema.columns WHERE table_name = 'attribute_values' ORDER BY ordinal_position`
				)
			).toEqual(columns)
			expect(
				(await q(`SELECT count(*)::int AS n FROM attribute_values`))[0]
					.n
			).toBe(count)
			expect(columns.map((c: any) => c.column_name)).toEqual(
				expect.arrayContaining(CLOCK_COLUMNS)
			)
		} finally {
			await client.close()
		}
	}, 60_000)
})
