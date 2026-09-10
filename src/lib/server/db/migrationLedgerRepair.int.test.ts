/**
 * The ledger repair, against the exact database state that broke a real install.
 *
 * ## What went wrong out there
 *
 * `0100_narration_split_reprojection` shipped for a while stamped
 * `when: 1788910000000` — a round number roughly a day ahead of the clock,
 * picked by hand rather than by `drizzle-kit generate`. Databases that migrated
 * during that window recorded that number as the row's `created_at`, and
 * drizzle applies only files whose journal `when` exceeds the *highest*
 * recorded `created_at`. Correcting the journal to `1788827887780` fixed new
 * installs and did nothing at all for those databases: every migration
 * generated since is stamped honestly, so every one of them falls under a
 * floor that will not lift until wall time passes it. 0101 through 0107 are
 * skipped on every boot, silently, forever — the reported symptom being
 * `column "notes" does not exist` from `connections:list`.
 *
 * ## Why the reproduction copies the real folder
 *
 * The database here is not a hand-built approximation: it is the real
 * migrations 0000–0100, applied by drizzle's own migrator out of a folder whose
 * only difference from `drizzle/` is that it stops at 0100 and carries 0100's
 * original stamp. Same files, same hashes, same ledger. A test that instead
 * dropped columns to simulate the shape would prove that its own DDL is
 * reversible and nothing about whether the repair reaches a real install.
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

/**
 * The handle these cases build for themselves: `drizzle(client)` with no
 * schema, which is what a real migration run holds.
 *
 * Spelled as drizzle's own return type rather than `MigrationDb` because
 * `migrate()` from the pglite migrator asks for the driver's database
 * specifically — and this satisfies `MigrationDb` too, so the raw-SQL helpers
 * below still take the narrow parameter.
 */
type LedgerDb = ReturnType<typeof drizzle>

const REAL_FOLDER = path.resolve(process.cwd(), "drizzle")

/** The last migration the broken installs got. */
const POISONED_TAG = "0100_narration_split_reprojection"
/** What its journal entry said when they applied it. */
const POISONED_WHEN = 1788910000000
/** What its journal entry says now. */
const CORRECTED_WHEN = 1788827887780

/** Everything that has been inert on those databases since. */
const SKIPPED_TAGS = [
	"0101_connection_notes",
	"0102_summarize_batch_budget",
	"0103_curvy_cannonball",
	"0104_ice_scene_cast_extraction",
	"0105_llamacpp_service_type",
	"0106_continuation_prefill_reprojection",
	"0107_pipeline_run_artifacts"
]

interface JournalEntry {
	idx: number
	version: string
	when: number
	tag: string
	breakpoints: boolean
}

const tempDirs: string[] = []

/**
 * A real migrations folder truncated at `tag`, optionally re-stamping entries.
 *
 * The `.sql` files are copied byte for byte, so the hashes drizzle writes into
 * the ledger are the same hashes the shipped folder produces — which is the
 * whole point: the repair matches rows to files by hash.
 */
function folderThrough(
	tag: string,
	restamp: Record<string, number> = {}
): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-ledger-mig-"))
	tempDirs.push(dir)
	const journal = JSON.parse(
		fs.readFileSync(path.join(REAL_FOLDER, "meta/_journal.json"), "utf8")
	) as { entries: JournalEntry[] }
	const cut = journal.entries.findIndex((e) => e.tag === tag)
	if (cut < 0) throw new Error(`No journal entry for "${tag}"`)
	const entries = journal.entries
		.slice(0, cut + 1)
		.map((e) => ({ ...e, when: restamp[e.tag] ?? e.when }))
	for (const e of entries) {
		fs.copyFileSync(
			path.join(REAL_FOLDER, `${e.tag}.sql`),
			path.join(dir, `${e.tag}.sql`)
		)
	}
	fs.mkdirSync(path.join(dir, "meta"), { recursive: true })
	fs.writeFileSync(
		path.join(dir, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries })
	)
	return dir
}

/** A migration-time handle: `drizzle(client)`, no schema, raw SQL only. */
async function rows<T extends Record<string, unknown>>(
	db: MigrationDb,
	query: SQL
): Promise<T[]> {
	return rawRows<T>(await db.execute(query))
}

async function hasColumn(db: MigrationDb, table: string, column: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.columns
			where table_schema = 'public' and table_name = ${table}
			and column_name = ${column}`
	)
	return found.length > 0
}

async function hasTable(db: MigrationDb, table: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.tables
			where table_schema = 'public' and table_name = ${table}`
	)
	return found.length > 0
}

async function ledger(db: MigrationDb) {
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
	) as { entries: JournalEntry[] }
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

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("a ledger poisoned by a future stamp", () => {
	let client: PGlite
	let db: LedgerDb

	beforeAll(async () => {
		const folder = folderThrough(POISONED_TAG, {
			[POISONED_TAG]: POISONED_WHEN
		})
		client = new PGlite()
		db = drizzle(client)
		await migrate(db, { migrationsFolder: folder })
	}, 60_000)

	afterAll(async () => {
		await client?.close()
	})

	it("reproduces the stuck install: migrate() alone leaves the seven unapplied", async () => {
		// ⚠ ITS OWN DATABASE, not the shared one, and the assertions below are
		// about the SEVEN rather than about a ledger count. Both because this is
		// the only case that calls migrate() WITHOUT repairing first, and what
		// that does has changed with the calendar.
		//
		// 0100's poisoned stamp is 2026-09-08T23:26:40Z. Wall time passed it,
		// so a migration generated from now on is stamped honestly AND above the
		// floor, and drizzle correctly applies it here — which raises this
		// ledger's high-water mark above 0101-0108 and buries them for every
		// case after this one, including the repair's. That is not the defect
		// under test and it is not reachable in production either: `db/index.ts`
		// runs `repairMigrationLedger` BEFORE any migrate(), so a real poisoned
		// install has its ledger corrected before a newer migration can land on
		// it out of order.
		const isolatedClient = new PGlite()
		const isolatedDb = drizzle(isolatedClient)
		try {
			await migrate(isolatedDb, {
				migrationsFolder: folderThrough(POISONED_TAG, {
					[POISONED_TAG]: POISONED_WHEN
				})
			})

			// Precondition — this is what such a database looks like.
			expect(await hasColumn(isolatedDb, "connections", "notes")).toBe(
				false
			)
			expect(await hasTable(isolatedDb, "pipeline_run_artifacts")).toBe(
				false
			)
			expect(
				await hasColumn(isolatedDb, "pipeline_runs", "message_id")
			).toBe(true)

			const before = await ledger(isolatedDb)
			expect(before).toHaveLength(101)
			expect(Math.max(...before.map((r) => Number(r.created_at)))).toBe(
				POISONED_WHEN
			)

			// The defect itself: the real folder has seven migrations stamped
			// under the poisoned floor and drizzle applies none of them, without
			// error.
			await migrate(isolatedDb, { migrationsFolder: REAL_FOLDER })

			expect(await hasColumn(isolatedDb, "connections", "notes")).toBe(
				false
			)
			const tags = tagsFor(await ledger(isolatedDb), REAL_FOLDER)
			for (const tag of SKIPPED_TAGS) expect(tags.has(tag)).toBe(false)
		} finally {
			await isolatedClient.close()
		}
	}, 60_000)

	it("repairs exactly the one row whose created_at disagrees with the journal", async () => {
		const result = await repairMigrationLedger(db, {
			migrationsFolder: REAL_FOLDER
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

	it("lets the seven skipped migrations apply", async () => {
		await migrate(db, { migrationsFolder: REAL_FOLDER })

		expect(await hasColumn(db, "connections", "notes")).toBe(true)
		expect(await hasTable(db, "pipeline_run_artifacts")).toBe(true)
		expect(await hasColumn(db, "pipeline_runs", "message_id")).toBe(false)

		const after = await ledger(db)
		// Every journal entry, whatever the folder holds today — a literal here
		// would break on the next migration for a reason that has nothing to do
		// with the repair.
		const journalLength = (
			JSON.parse(
				fs.readFileSync(
					path.join(REAL_FOLDER, "meta/_journal.json"),
					"utf8"
				)
			) as { entries: unknown[] }
		).entries.length
		expect(after).toHaveLength(journalLength)
		const tags = tagsFor(after, REAL_FOLDER)
		for (const tag of SKIPPED_TAGS) expect(tags.has(tag)).toBe(true)
	}, 60_000)

	it("repairs nothing on a second pass", async () => {
		const again = await repairMigrationLedger(db, {
			migrationsFolder: REAL_FOLDER
		})
		expect(again.repaired).toEqual([])
		expect(again.unrecognised).toEqual([])
	}, 60_000)
})

/**
 * The narrow cases, on a two-file synthetic folder rather than the shipped 108
 * — the behaviour under test is about a single row, and paying a full migrate
 * for it would buy nothing.
 */
describe("what the repair refuses to touch", () => {
	let dir: string
	let client: PGlite
	let db: LedgerDb

	beforeAll(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-ledger-synth-"))
		tempDirs.push(dir)
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
