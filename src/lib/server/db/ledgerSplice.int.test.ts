/**
 * The ledger splice (`./ledgerSplice.ts`), against ledgers a development
 * database migrated by the pre-squash 0.6 chain really holds.
 *
 * ## How the old databases are built
 *
 * The squashed chain's database *is* the pre-squash chain's, catalog for
 * catalog — that is the premise the splice rests on, and it was proven when
 * the squash was made by building both chains through every prefix
 * (`0095`…`0111`) and comparing tables, columns and their order, constraints,
 * indexes, sequences and functions. So a pre-squash database through `0109`,
 * `0110` or `0111` (data-only migrations above `0108`) is the squashed
 * chain's database with the old ledger rows: that is what these cases build,
 * from the real `drizzle/` and the pinned pre-squash hashes. Older prefixes
 * would need the pre-squash `0095` itself, which lives only in the archive.
 *
 * Built from the squashed chain as pr-1 shipped it (`0000`–`0096`), never the
 * whole of `drizzle/`: a pre-squash database never applied a migration added
 * since the squash (`0097_ner_entity_label` on). Those are what the ordinary
 * migrate after a splice applies, and one case below follows it that far.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import {
	readJournalMigrations,
	repairMigrationLedger
} from "./migrationLedgerRepair"
import { LedgerSpliceRefusal, spliceSquashedLedger } from "./ledgerSplice"
import { PRESQUASH_CHAIN, SQUASHED_CHAIN } from "./ledgerSpliceChain"
import { runMigrationsWithUpgrades } from "./dataUpgrades"

const REAL = path.resolve(process.cwd(), "drizzle")
const tagIndex = (tag: string) =>
	PRESQUASH_CHAIN.findIndex((m) => m.tag === tag)

const shipped = readJournalMigrations(REAL)
const squashEnd =
	shipped.findIndex((m) => m.tag === SQUASHED_CHAIN.at(-1)!.tag) + 1
/** What this build added since the squash, pending after a splice. */
const since = shipped.slice(squashEnd)

/** `drizzle/` through the squashed chain: what pr-1 shipped. */
let squashSet: string
beforeAll(() => {
	squashSet = fs.mkdtempSync(
		path.join(os.tmpdir(), "serene-pub-vitest-ledger-squash-set-")
	)
	const journal = JSON.parse(
		fs.readFileSync(path.join(REAL, "meta/_journal.json"), "utf8")
	)
	journal.entries = journal.entries.slice(0, squashEnd)
	fs.mkdirSync(path.join(squashSet, "meta"))
	fs.writeFileSync(
		path.join(squashSet, "meta/_journal.json"),
		JSON.stringify(journal)
	)
	for (const { tag } of journal.entries)
		fs.copyFileSync(
			path.join(REAL, `${tag}.sql`),
			path.join(squashSet, `${tag}.sql`)
		)
})

type Ledger = { hash: string; created_at: number }[]

let client: PGlite
let db: ReturnType<typeof drizzle>
const clients: PGlite[] = []

async function ledger(): Promise<Ledger> {
	return (
		await client.query<{ hash: string; created_at: string }>(
			`select hash, created_at from drizzle.__drizzle_migrations order by id`
		)
	).rows.map((r) => ({ hash: r.hash, created_at: Number(r.created_at) }))
}

/** Swap the squashed chain's rows for the pre-squash rows through `through`. */
async function presquashLedgerThrough(through: string) {
	for (const m of SQUASHED_CHAIN)
		await client.query(
			`delete from drizzle.__drizzle_migrations where hash = $1`,
			[m.hash]
		)
	for (const m of PRESQUASH_CHAIN.slice(0, tagIndex(through) + 1))
		await client.query(
			`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
			[m.hash, m.when]
		)
}

/** The tables `0097_ner_entity_label` gives an `entity_label`. */
async function labelledTables(): Promise<string[]> {
	return (
		await client.query<{ table_name: string }>(
			`select table_name from information_schema.columns
			where table_schema = 'public' and column_name = 'entity_label'
			order by table_name`
		)
	).rows.map((r) => r.table_name)
}

const splice = () =>
	spliceSquashedLedger(db as unknown as MigrationDb, {
		migrationsFolder: REAL
	})

/** The ledger of a database on the squashed chain, nothing added since. */
let squashLedger: Ledger

beforeEach(async () => {
	client = new PGlite()
	clients.push(client)
	db = drizzle(client)
	await migrate(db, { migrationsFolder: squashSet })
	squashLedger ??= await ledger()
}, 60_000)

afterAll(async () => {
	for (const c of clients) await c.close().catch(() => {})
	fs.rmSync(squashSet, { recursive: true, force: true })
})

describe("the pins", () => {
	it("name the squashed chain this build ships", () => {
		const shipped = readJournalMigrations(REAL)
		for (const pin of SQUASHED_CHAIN)
			expect(
				shipped.find((m) => m.tag === pin.tag)?.hash,
				`${pin.tag} changed — regenerate ledgerSpliceChain.ts or retire the splice`
			).toBe(pin.hash)
	})

	it("carry byte-exact copies of every file a splice may replay", () => {
		for (const m of PRESQUASH_CHAIN.slice(2))
			expect(
				createHash("sha256").update(m.sql!).digest("hex"),
				m.tag
			).toBe(m.hash)
	})
})

describe("a database the splice is not for", () => {
	it("is left alone when it is on the squashed chain", async () => {
		expect(await splice()).toEqual({ spliced: false, replayed: [] })
		expect(await ledger()).toEqual(squashLedger)
	}, 60_000)

	it("is left alone when it has applied what came after", async () => {
		await migrate(db, { migrationsFolder: REAL })
		const current = await ledger()
		expect(current.length).toBe(shipped.length)
		expect(await splice()).toEqual({ spliced: false, replayed: [] })
		expect(await ledger()).toEqual(current)
	}, 60_000)

	it("is left alone when it has no ledger yet", async () => {
		const empty = new PGlite()
		clients.push(empty)
		expect(
			await spliceSquashedLedger(
				drizzle(empty) as unknown as MigrationDb,
				{
					migrationsFolder: REAL
				}
			)
		).toEqual({ spliced: false, replayed: [] })
	})
})

describe("the whole pre-squash chain applied", () => {
	it("records the squashed chain in its place", async () => {
		await presquashLedgerThrough("0111_living_scene_look_reprojection")
		const written: string[] = []
		const result = await spliceSquashedLedger(
			db as unknown as MigrationDb,
			{
				migrationsFolder: REAL,
				beforeWrite: async () => {
					written.push("backup")
				}
			}
		)
		expect(result).toEqual({ spliced: true, replayed: [] })
		expect(written).toEqual(["backup"])
		expect(await ledger()).toEqual(squashLedger)
		// And the next boot does nothing.
		expect(await splice()).toEqual({ spliced: false, replayed: [] })
	}, 60_000)

	it("then takes what this build added since the squash, through the ordinary migrate", async () => {
		await presquashLedgerThrough("0111_living_scene_look_reprojection")
		await splice()
		expect(await labelledTables()).toEqual([])

		// Each pending only if its stamp is above the newest the splice left:
		// below it, drizzle would skip the file without a word.
		const newest = Math.max(...(await ledger()).map((r) => r.created_at))
		for (const m of since) expect(m.when, m.tag).toBeGreaterThan(newest)

		await runMigrationsWithUpgrades(db as unknown as MigrationDb, {
			migrationsFolder: REAL,
			skipUpgrades: true
		})
		expect(await ledger()).toEqual([
			...squashLedger,
			...since.map((m) => ({ hash: m.hash, created_at: m.when }))
		])
		// 0097_ner_entity_label, by what it does rather than by its row.
		expect(await labelledTables()).toEqual([
			"entry_annotations",
			"message_annotations"
		])

		// And nothing is left for the boots after.
		expect(
			await repairMigrationLedger(db as unknown as MigrationDb, {
				migrationsFolder: REAL
			})
		).toEqual({ repaired: [], unrecognised: [] })
		expect(await splice()).toEqual({ spliced: false, replayed: [] })
		const settled = await ledger()
		await runMigrationsWithUpgrades(db as unknown as MigrationDb, {
			migrationsFolder: REAL,
			skipUpgrades: true
		})
		expect(await ledger()).toEqual(settled)
	}, 60_000)
})

describe("a prefix of it applied", () => {
	it("replays what is missing, data and all, then records the squashed chain", async () => {
		await presquashLedgerThrough("0109_wave8_retrieval_reprojection")
		// Rows 0110 and 0111 rewrite. Their parents' own references are not
		// what is under test, so those rows go in unchecked.
		await client.exec(`
			SET session_replication_role = replica;
			INSERT INTO sessions (id, user_id, is_group) VALUES (9001, 9001, false);
			INSERT INTO session_messages (id, session_id, role, content, metadata)
				VALUES (9001, 9001, 'assistant', 'hi', '{"thinking":"hm","swipes":{"thinkingHistory":["a"]}}');
			INSERT INTO message_parts (message_id, type) VALUES (9001, 'core:thinking');
			INSERT INTO pipeline_configs (spec_id, name, is_immutable, seed_key)
				VALUES (1, 'Default', true, 'pipeline-default:core:spec/respond');
			SET session_replication_role = DEFAULT;
		`)

		const result = await splice()
		expect(result).toEqual({
			spliced: true,
			replayed: [
				"0110_reasoning_stored_keys",
				"0111_living_scene_look_reprojection"
			]
		})
		expect(await ledger()).toEqual(squashLedger)

		const meta = (
			await client.query<{ metadata: unknown }>(
				`select metadata from session_messages where id = 9001`
			)
		).rows[0].metadata
		expect(meta).toEqual({
			reasoning: "hm",
			swipes: { reasoningHistory: ["a"] }
		})
		expect(
			(
				await client.query(
					`select type from message_parts where message_id = 9001`
				)
			).rows
		).toEqual([{ type: "core:reasoning" }])
		expect(
			(
				await client.query(
					`select id from pipeline_configs where seed_key = 'pipeline-default:core:spec/respond'`
				)
			).rows
		).toEqual([])
	}, 60_000)
})

describe("a ledger the splice refuses", () => {
	const refused = async () => {
		const before = await ledger()
		const error = await splice().catch((e) => e)
		expect(error).toBeInstanceOf(LedgerSpliceRefusal)
		expect(await ledger()).toEqual(before)
		return (error as Error).message
	}

	it("has a hole in its pre-squash rows", async () => {
		await presquashLedgerThrough(
			"0099_drop_context_template_migration_ledger"
		)
		await client.query(
			`delete from drizzle.__drizzle_migrations where hash = $1`,
			[PRESQUASH_CHAIN[tagIndex("0097_retire_0_5_tables")].hash]
		)
		expect(await refused()).toMatch(
			/has 0099_drop_context_template_migration_ledger but not 0097_retire_0_5_tables/
		)
	}, 60_000)

	it("mixes them with the squashed chain's rows", async () => {
		await presquashLedgerThrough("0111_living_scene_look_reprojection")
		await client.query(
			`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, 1)`,
			[SQUASHED_CHAIN[1].hash]
		)
		expect(await refused()).toMatch(/mixes pre-squash rows/)
	}, 60_000)

	it("mixes them with a row of a migration added since the squash", async () => {
		await presquashLedgerThrough("0111_living_scene_look_reprojection")
		await client.query(
			`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
			[since[0].hash, since[0].when]
		)
		expect(await refused()).toMatch(
			new RegExp(`mixes pre-squash rows with ${since[0].tag}, which`)
		)
	}, 60_000)

	it("holds a row no migration here matches", async () => {
		await presquashLedgerThrough("0111_living_scene_look_reprojection")
		await client.query(
			`insert into drizzle.__drizzle_migrations (hash, created_at) values ('feedface', 1)`
		)
		expect(await refused()).toMatch(/Move the data directory aside/)
	}, 60_000)

	it("applied a pre-squash file that was edited afterwards", async () => {
		await presquashLedgerThrough("0111_living_scene_look_reprojection")
		await client.query(
			`update drizzle.__drizzle_migrations set hash = 'edited' where hash = $1`,
			[PRESQUASH_CHAIN[tagIndex("0110_reasoning_stored_keys")].hash]
		)
		expect(await refused()).toMatch(
			/0110_reasoning_stored_keys \(matched by stamp\)/
		)
	}, 60_000)
})
