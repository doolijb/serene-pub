/**
 * The ledger repair, against the database state that strands a real install.
 *
 * ## The failure
 *
 * drizzle applies only the files whose journal `when` exceeds the highest
 * `created_at` in the ledger. A migration that once shipped stamped ahead of
 * the clock — a round number picked by hand rather than by
 * `drizzle-kit generate` — leaves that stamp in the ledger of every database
 * that applied it, and correcting the journal afterwards fixes new installs
 * only: every honestly-stamped migration after it falls under a floor that
 * will not lift until wall time passes it, and is skipped on every boot,
 * silently. `repairMigrationLedger` moves such a row back to its file's `when`.
 *
 * ## Why the reproduction copies the real folder
 *
 * The database here is built by drizzle's own migrator from the real 0.5.3
 * migrations, out of a folder whose only difference from `drizzle/` is where
 * it stops and the stamp on its last file. Same files, same hashes, same
 * ledger. A test that dropped columns to simulate the shape would prove that
 * its own DDL is reversible and nothing about whether the repair reaches a real
 * install. It stops at 0.5.3's last migration rather than at the head of the
 * chain so that what it measures is the ledger and not whichever migration
 * comes next.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { sql, type SQL } from "drizzle-orm"
import { rawRows } from "./rawRows"
import { repairMigrationLedger } from "./migrationLedgerRepair"
import { migrationsFolderThrough } from "$lib/server/utils/testDb"

/**
 * The handle these cases build for themselves: `drizzle(client)` with no
 * schema, which is what a real migration run holds.
 */
type LedgerDb = ReturnType<typeof drizzle>

/** The last migration 0.5.3 shipped; the shipped folder here stops at it. */
const SHIPPED_THROUGH = "0093_green_bushwacker"
/** The migration whose row carries the bad stamp. */
const POISONED_TAG = "0090_illegal_payback"
/** A hand-picked stamp ahead of everything after it. */
const POISONED_WHEN = 1786600000000
/** What its journal entry says. */
const CORRECTED_WHEN = 1786337830337

/** Everything the poisoned floor buries. */
const SKIPPED_TAGS = [
	"0091_nifty_whirlwind",
	"0092_worthless_sabretooth",
	"0093_green_bushwacker"
]

const disposers: Array<() => Promise<void>> = []

async function folderThrough(
	tag: string,
	restamp: Record<string, number> = {}
): Promise<string> {
	const { folder, dispose } = await migrationsFolderThrough(tag, { restamp })
	disposers.push(dispose)
	return folder
}

async function rows<T extends Record<string, unknown>>(
	db: LedgerDb,
	query: SQL
): Promise<T[]> {
	return rawRows<T>(await db.execute(query))
}

async function hasColumn(db: LedgerDb, table: string, column: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.columns
			where table_schema = 'public' and table_name = ${table}
			and column_name = ${column}`
	)
	return found.length > 0
}

async function hasTable(db: LedgerDb, table: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.tables
			where table_schema = 'public' and table_name = ${table}`
	)
	return found.length > 0
}

async function ledger(db: LedgerDb) {
	return rows<{ id: number; hash: string; created_at: string | number }>(
		db,
		sql`select id, hash, created_at from drizzle.__drizzle_migrations
			order by created_at asc, id asc`
	)
}

/** Journal tags present in the ledger, matched by hash the way the repair does. */
function tagsFor(ledgerRows: any[], folder: string): Set<string> {
	const journal = JSON.parse(
		fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")
	) as { entries: Array<{ tag: string }> }
	const files = readMigrationFiles({ migrationsFolder: folder })
	const byHash = new Map(
		journal.entries.map((e, i) => [files[i].hash, e.tag] as const)
	)
	return new Set(
		ledgerRows
			.map((r) => byHash.get(String(r.hash)))
			.filter(Boolean) as string[]
	)
}

afterAll(async () => {
	for (const dispose of disposers) await dispose()
})

describe("a ledger poisoned by a future stamp", () => {
	let client: PGlite
	let db: LedgerDb
	let shipped: string

	beforeAll(async () => {
		shipped = await folderThrough(SHIPPED_THROUGH)
		client = new PGlite()
		db = drizzle(client)
		await migrate(db, {
			migrationsFolder: await folderThrough(POISONED_TAG, {
				[POISONED_TAG]: POISONED_WHEN
			})
		})
	}, 60_000)

	afterAll(async () => {
		await client?.close()
	})

	it("reproduces the stuck install: migrate() alone leaves the three unapplied", async () => {
		// Its own database: the only case that calls migrate() WITHOUT
		// repairing first. `db/index.ts` runs the repair before any migrate().
		const isolatedClient = new PGlite()
		const isolatedDb = drizzle(isolatedClient)
		try {
			await migrate(isolatedDb, {
				migrationsFolder: await folderThrough(POISONED_TAG, {
					[POISONED_TAG]: POISONED_WHEN
				})
			})

			// Precondition — this is what such a database looks like.
			expect(await hasTable(isolatedDb, "scene_characters")).toBe(false)
			expect(await hasColumn(isolatedDb, "prompt_configs", "seed_key")).toBe(
				false
			)
			const before = await ledger(isolatedDb)
			expect(before).toHaveLength(91)
			expect(Math.max(...before.map((r) => Number(r.created_at)))).toBe(
				POISONED_WHEN
			)

			// The defect itself: the shipped folder has three migrations stamped
			// under the poisoned floor and drizzle applies none of them, without
			// error.
			await migrate(isolatedDb, { migrationsFolder: shipped })

			expect(await hasTable(isolatedDb, "scene_characters")).toBe(false)
			const tags = tagsFor(await ledger(isolatedDb), shipped)
			for (const tag of SKIPPED_TAGS) expect(tags.has(tag)).toBe(false)
		} finally {
			await isolatedClient.close()
		}
	}, 60_000)

	it("repairs exactly the one row whose created_at disagrees with the journal", async () => {
		const result = await repairMigrationLedger(db, {
			migrationsFolder: shipped
		})

		expect(result.repaired).toEqual([
			{ tag: POISONED_TAG, from: POISONED_WHEN, to: CORRECTED_WHEN }
		])
		expect(result.unrecognised).toEqual([])

		const row = (await ledger(db)).find(
			(r) => Number(r.created_at) === CORRECTED_WHEN
		)
		expect(row).toBeDefined()
	}, 60_000)

	it("lets the three skipped migrations apply", async () => {
		await migrate(db, { migrationsFolder: shipped })

		expect(await hasTable(db, "scene_characters")).toBe(true)
		expect(await hasColumn(db, "prompt_configs", "seed_key")).toBe(true)
		expect(
			await hasColumn(db, "graph_build_configs", "node_description_system_prompt")
		).toBe(true)

		const after = await ledger(db)
		expect(after).toHaveLength(94)
		const tags = tagsFor(after, shipped)
		for (const tag of SKIPPED_TAGS) expect(tags.has(tag)).toBe(true)
	}, 60_000)

	it("repairs nothing on a second pass", async () => {
		const again = await repairMigrationLedger(db, {
			migrationsFolder: shipped
		})
		expect(again.repaired).toEqual([])
		expect(again.unrecognised).toEqual([])
	}, 60_000)
})

/**
 * The narrow cases, on a one-file synthetic folder rather than the shipped chain
 * — the behaviour under test is about a single row, and paying a full migrate
 * for it would buy nothing.
 */
describe("what the repair refuses to touch", () => {
	let dir: string
	let client: PGlite
	let db: LedgerDb

	beforeAll(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-pub-vitest-ledger-synth-"))
		fs.writeFileSync(
			path.join(dir, "0000_first.sql"),
			`CREATE TABLE "widget" ("id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY);`
		)
		fs.mkdirSync(path.join(dir, "meta"), { recursive: true })
		fs.writeFileSync(
			path.join(dir, "meta/_journal.json"),
			JSON.stringify({
				version: "7",
				dialect: "postgresql",
				entries: [
					{
						idx: 0,
						version: "7",
						when: 1000,
						tag: "0000_first",
						breakpoints: true
					}
				]
			})
		)
		client = new PGlite()
		db = drizzle(client)
	}, 60_000)

	afterAll(async () => {
		await client?.close()
		fs.rmSync(dir, { recursive: true, force: true })
	})

	it("a database with no ledger at all — nothing to disagree with", async () => {
		const result = await repairMigrationLedger(db, {
			migrationsFolder: dir
		})
		expect(result).toEqual({ repaired: [], unrecognised: [] })
		// And it must not have conjured the table: creating it here would tell
		// the migrator this database has a history it does not have.
		const present = await rows(
			db,
			sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`
		)
		expect(present[0].present).toBe(false)
	})

	it("a correctly-stamped ledger is left exactly as it is", async () => {
		await migrate(db, { migrationsFolder: dir })
		const before = await ledger(db)
		expect(before).toHaveLength(1)

		const result = await repairMigrationLedger(db, {
			migrationsFolder: dir
		})
		expect(result).toEqual({ repaired: [], unrecognised: [] })
		expect(await ledger(db)).toEqual(before)
	}, 60_000)

	it("reports a row it cannot identify rather than guessing at it", async () => {
		// A hash matching no shipped file: the file was edited after this
		// database applied it, or the row came from another build. There is no
		// entry to move it towards, and moving it on a guess could skip a
		// migration rather than unblock one.
		await db.execute(
			sql`insert into drizzle.__drizzle_migrations (hash, created_at)
				values ('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 4242)`
		)

		const result = await repairMigrationLedger(db, {
			migrationsFolder: dir
		})
		expect(result.repaired).toEqual([])
		expect(result.unrecognised).toEqual([
			{
				id: expect.any(Number),
				hash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
				createdAt: 4242
			}
		])

		const stranger = (await ledger(db)).find(
			(r) => Number(r.created_at) === 4242
		)
		expect(stranger).toBeDefined()
	})

	it("corrects a stamp that is too low as well as one that is too high", async () => {
		// The mirror failure: a row below its file's `when` makes drizzle
		// re-apply a migration that has already run, which fails outright.
		await db.execute(
			sql`update drizzle.__drizzle_migrations set created_at = 999
				where created_at = 1000`
		)

		const result = await repairMigrationLedger(db, {
			migrationsFolder: dir
		})
		expect(result.repaired).toEqual([
			{ tag: "0000_first", from: 999, to: 1000 }
		])
	})
})
