/**
 * 0190_lorebook_integrity: an upgrade over rows written before its CHECKs and
 * FKs existed must not fail — and must leave them the way the app would have.
 *
 * ⚠ It runs the REAL migrator twice over one database, the way an upgrading
 * install does: first a temp folder whose journal stops at 0189 (the `.sql`
 * files copied, only `meta/_journal.json` truncated), then the real folder.
 * Rows that would violate 0190 are planted between the two. A test that
 * migrated once and inserted afterwards could only ever prove the constraints
 * refuse new rows; the repair step at the top of 0190 is for the old ones.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestUser, type TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const TARGET = "0190_lorebook_integrity"

let tmp: string
let db: TestDb
const ids = {} as {
	lorebook: number
	branch: number
	branch2: number
	sessionA: number
	sessionB: number
	orphanValue: number
	orphanConfig: number
	liveValue: number
}

beforeAll(async () => {
	const real = path.resolve(process.cwd(), "drizzle")
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-0190-"))
	const before = path.join(tmp, "drizzle")
	await fs.mkdir(path.join(before, "meta"), { recursive: true })
	for (const f of await fs.readdir(real))
		if (f.endsWith(".sql")) await fs.copyFile(path.join(real, f), path.join(before, f))
	const journal = JSON.parse(
		await fs.readFile(path.join(real, "meta/_journal.json"), "utf8")
	)
	const at = journal.entries.findIndex((e: { tag: string }) => e.tag === TARGET)
	expect(at).toBeGreaterThan(0)
	journal.entries = journal.entries.slice(0, at)
	await fs.writeFile(
		path.join(before, "meta/_journal.json"),
		JSON.stringify(journal)
	)

	const client = new PGlite()
	db = drizzle(client, { schema }) as unknown as TestDb
	await migrate(db, { migrationsFolder: before })
	// As `createTestDb` does: an early migration seeds a user at an explicit
	// id, which the identity sequence never saw.
	await db.execute(sql`
		DO $$
		DECLARE rec RECORD;
		BEGIN
			FOR rec IN
				SELECT seq.relname AS seq_name, tab.relname AS table_name, attr.attname AS col_name
				FROM pg_class seq
				JOIN pg_namespace ns ON ns.oid = seq.relnamespace
				JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
				JOIN pg_class tab ON dep.refobjid = tab.oid
				JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
				WHERE seq.relkind = 'S' AND ns.nspname = 'public'
			LOOP
				EXECUTE format(
					'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 1))',
					rec.seq_name, rec.col_name, rec.table_name
				);
			END LOOP;
		END $$;
	`)

	// ── Rows 0189 accepted and 0190 would refuse ───────────────────────────
	const user = await createTestUser(db, "integrity-0190")
	// No year but a month and an hour: no clock at all.
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: "Before 0190",
			storyClockMonth: 3,
			storyClockHour: 25
		})
		.returning()
	ids.lorebook = book.id
	// A fork with no year; a clock with a day but no month and a bad hour.
	const [branch] = await db
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: book.id,
			name: "What if",
			forkMonth: 2,
			forkDay: 5,
			storyClockYear: 400,
			storyClockDay: 7,
			storyClockHour: 30,
			storyClockMinute: 99
		})
		.returning()
	ids.branch = branch.id
	// A fork day with no month.
	const [branch2] = await db
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "Other", forkYear: 10, forkDay: 4 })
		.returning()
	ids.branch2 = branch2.id
	const [a] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: "Minute, no hour",
			storyClockYear: 400,
			storyClockMonth: 2,
			storyClockDay: 3,
			storyClockMinute: 15
		})
		.returning()
	ids.sessionA = a.id
	const [b] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: "Minute out of range",
			storyClockYear: 400,
			storyClockHour: 10,
			storyClockMinute: 75
		})
		.returning()
	ids.sessionB = b.id
	// Stat rows: one on a branch that is gone, one on a live branch.
	const stat = (branchId: number) => ({
		ownerKind: "lorebook",
		ownerId: book.id,
		slotId: "core:slot/weather@1",
		branchId
	})
	const [orphan] = await db
		.insert(schema.attributeValues)
		.values({ ...stat(987_654), value: { v: "storm" } })
		.returning()
	ids.orphanValue = orphan.id
	const [orphanConfig] = await db
		.insert(schema.attributeConfigs)
		.values({ ...stat(987_654), config: {} })
		.returning()
	ids.orphanConfig = orphanConfig.id
	const [live] = await db
		.insert(schema.attributeValues)
		.values({ ...stat(branch.id), value: { v: "clear" } })
		.returning()
	ids.liveValue = live.id

	// ── The upgrade ─────────────────────────────────────────────────────────
	await migrate(db, { migrationsFolder: real })
})

afterAll(async () => {
	if (tmp) await fs.rm(tmp, { recursive: true, force: true })
})

describe("0190 over rows written before it", () => {
	it("normalises every stored clock to what clockColumns would have written", async () => {
		const [book] = await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, ids.lorebook))
		expect([
			book.storyClockYear,
			book.storyClockMonth,
			book.storyClockDay,
			book.storyClockHour,
			book.storyClockMinute
		]).toEqual([null, null, null, null, null])

		const [branch] = await db
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, ids.branch))
		expect([
			branch.storyClockYear,
			branch.storyClockMonth,
			branch.storyClockDay,
			branch.storyClockHour,
			branch.storyClockMinute
		]).toEqual([400, null, null, null, null])

		const [a] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, ids.sessionA))
		expect([a.storyClockYear, a.storyClockMonth, a.storyClockDay]).toEqual([
			400, 2, 3
		])
		expect([a.storyClockHour, a.storyClockMinute]).toEqual([null, null])

		const [b] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, ids.sessionB))
		expect([b.storyClockHour, b.storyClockMinute]).toEqual([10, 0])
	})

	it("narrows fork dates left to right", async () => {
		const [branch] = await db
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, ids.branch))
		expect([branch.forkYear, branch.forkMonth, branch.forkDay]).toEqual([
			null,
			null,
			null
		])
		const [other] = await db
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, ids.branch2))
		expect([other.forkYear, other.forkMonth, other.forkDay]).toEqual([
			10,
			null,
			null
		])
	})

	it("drops stat rows on a branch that no longer exists, and keeps the rest", async () => {
		const values = await db
			.select({ id: schema.attributeValues.id })
			.from(schema.attributeValues)
		expect(values.map((r) => r.id)).toContain(ids.liveValue)
		expect(values.map((r) => r.id)).not.toContain(ids.orphanValue)
		const configs = await db
			.select({ id: schema.attributeConfigs.id })
			.from(schema.attributeConfigs)
		expect(configs.map((r) => r.id)).not.toContain(ids.orphanConfig)
	})
})

describe("0190's constraints, once applied", () => {
	const refuses = async (q: Promise<unknown>) => {
		let failed = false
		try {
			await q
		} catch {
			failed = true
		}
		expect(failed).toBe(true)
	}

	it("refuses a clock or fork that narrows out of order", async () => {
		await refuses(
			db
				.update(schema.lorebooks)
				.set({ storyClockYear: 1, storyClockDay: 4 })
				.where(eq(schema.lorebooks.id, ids.lorebook))
		)
		await refuses(
			db
				.update(schema.sessions)
				.set({ storyClockYear: 1, storyClockHour: 24 })
				.where(eq(schema.sessions.id, ids.sessionA))
		)
		await refuses(
			db
				.update(schema.sessions)
				.set({ storyClockMinute: 5, storyClockHour: null })
				.where(eq(schema.sessions.id, ids.sessionA))
		)
		await refuses(
			db
				.update(schema.lorebookBranches)
				.set({ forkYear: null, forkMonth: 1 })
				.where(eq(schema.lorebookBranches.id, ids.branch))
		)
		// …and takes a well-formed one.
		await db
			.update(schema.lorebookBranches)
			.set({
				forkYear: 9,
				forkMonth: 1,
				storyClockMonth: 2,
				storyClockDay: 3,
				storyClockHour: 23,
				storyClockMinute: 59
			})
			.where(eq(schema.lorebookBranches.id, ids.branch))
	})

	it("refuses a stat row naming a branch that does not exist", async () => {
		await refuses(
			db.insert(schema.attributeValues).values({
				ownerKind: "lorebook",
				ownerId: ids.lorebook,
				slotId: "core:slot/weather@1",
				value: { v: "fog" },
				branchId: 987_654
			})
		)
	})

	it("cascades a branch's stat rows away with the branch", async () => {
		await db
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, ids.branch))
		const left = await db
			.select({ id: schema.attributeValues.id })
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, ids.liveValue))
		expect(left).toEqual([])
	})

	it("lands the FK-column indexes as partial indexes", async () => {
		const rows = (await db.execute(
			sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`
		)) as unknown as { rows: { indexname: string; indexdef: string }[] }
		const byName = new Map(rows.rows.map((r) => [r.indexname, r.indexdef]))
		for (const name of [
			"lorebook_entries_branch_id_idx",
			"lorebook_entries_anchor_entry_id_idx",
			"lorebook_entries_anchor_binding_id_idx",
			"entry_amendments_branch_id_idx",
			"entry_amendments_history_entry_id_idx",
			"cast_amendments_branch_id_idx",
			"cast_amendments_history_entry_id_idx",
			"cast_presences_branch_id_idx",
			"scenes_branch_id_idx",
			"narrative_relationships_branch_id_idx",
			"sessions_lorebook_branch_id_idx",
			"attribute_values_branch_id_idx",
			"attribute_configs_branch_id_idx"
		]) {
			expect(byName.get(name), name).toMatch(/WHERE .* IS NOT NULL/)
		}
	})
})
