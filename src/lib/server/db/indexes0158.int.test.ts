/**
 * Migration 0158 (lane perf-K, ★P8 and ★P9, owner 2026-11-13): six indexes,
 * `system_settings.boot_markers`, and the same-as variant (`variants.path`
 * nullable, `same_as_variant_id`, `variants_same_as_check`). A 0157 install
 * keeps every row; there is no backfill; a second boot changes nothing.
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

const INDEXES = [
	"session_messages_session_id_id_idx",
	"messages_session_id_id_idx",
	"pipeline_runs_started_idx",
	"pipeline_run_nodes_err_definition_idx",
	"session_messages_generating_idx",
	"plugin_hook_invocations_finished_idx"
]

describe("0158: indexes, boot markers, same-as variants", () => {
	it("keeps 0157 rows, adds the indexes and column, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0157_legal_puppet_master"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0157-shaped install ────────────────────────────────────
			expect(
				await q(
					`SELECT column_name FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'boot_markers'`
				)
			).toEqual([])
			await q(`INSERT INTO system_settings (id) VALUES (1)`)
			const fileId = (
				await q(
					`SELECT column_name FROM information_schema.columns WHERE table_name = 'variants' AND column_name = 'file_id'`
				)
			).length
			expect(fileId).toBe(1)
			await q(
				`INSERT INTO variants (file_id, variant, mime, bytes, path, hash) VALUES (7, 'original', 'image/png', 10, 'files/a.png', 'h1')`
			)

			// ── the real folder ──────────────────────────────────────────
			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			const idx = await q(
				`SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN (${INDEXES.map((i) => `'${i}'`).join(",")})`
			)
			expect(idx.map((r: any) => r.indexname).sort()).toEqual(
				[...INDEXES].sort()
			)
			const def = (n: string) =>
				idx.find((r: any) => r.indexname === n).indexdef as string
			expect(def("pipeline_runs_started_idx")).toMatch(/WHERE/i)
			expect(def("pipeline_run_nodes_err_definition_idx")).toMatch(
				/WHERE.*err/i
			)
			expect(def("session_messages_generating_idx")).toMatch(
				/WHERE.*is_generating/i
			)

			const v = await q(`SELECT path, same_as_variant_id FROM variants`)
			expect(v).toEqual([
				{ path: "files/a.png", same_as_variant_id: null }
			])
			expect(
				(await q(`SELECT boot_markers FROM system_settings`))[0]
					.boot_markers
			).toEqual({})

			// ── the same-as CHECK ────────────────────────────────────────
			await expect(
				q(
					`INSERT INTO variants (file_id, variant, mime, bytes, hash) VALUES (7, 'thumb', 'image/webp', 1, 'h2')`
				)
			).rejects.toBeTruthy()

			// ── a second boot changes nothing ────────────────────────────
			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				indexes: await q(
					`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`
				),
				columns: await q(
					`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('variants','system_settings') ORDER BY table_name, ordinal_position`
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
