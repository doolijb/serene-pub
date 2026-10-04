/**
 * Part A of the 0.5.3 → 0.6.0 upgrade (./0095_schema_0_6_0.ts) against the
 * real migrations folder: a database built from `0000`–`0093` exactly as a
 * 0.5.3 install holds it, then the shipped chain on top.
 */
import { afterEach, describe, expect, test } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import path from "path"
import { runMigrationsWithUpgrades } from "./index"
import { ATTIC_LEDGER_PRUNED, ATTIC_SCHEMA } from "./0095_schema_0_6_0"
import { readJournalMigrations } from "../migrationLedgerRepair"
import { createTestDb, migrationsFolderThrough } from "$lib/server/utils/testDb"

const REAL = path.resolve(process.cwd(), "drizzle")

let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
	await dispose?.()
	dispose = undefined
})

async function atticExists(client: PGlite): Promise<boolean> {
	const r = await client.query(
		`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
		[ATTIC_SCHEMA]
	)
	return r.rows.length === 1
}

async function count(client: PGlite, table: string): Promise<number> {
	const r = await client.query<{ n: number }>(
		`SELECT count(*)::int AS n FROM ${table}`
	)
	return r.rows[0].n
}

/** A 0.5.3 database with a few rows in tables the 0.6 DDL renames or drops. */
async function old053(): Promise<PGlite> {
	const through = await migrationsFolderThrough("0093_green_bushwacker")
	dispose = through.dispose
	const client = new PGlite()
	await migrate(drizzle(client), { migrationsFolder: through.folder })
	await client.exec(`
		INSERT INTO personas (user_id, is_default, name, description) VALUES (1, true, 'Me', '');
		INSERT INTO characters (user_id, name, description) VALUES (1, 'Ana', 'a'), (1, 'Bo', 'b');
		INSERT INTO chats (user_id, is_group, name) VALUES (1, false, 'First');
		INSERT INTO chat_messages (chat_id, role, content)
			SELECT id, 'user', 'hello' FROM chats;
		INSERT INTO chat_messages (chat_id, role, content)
			SELECT id, 'assistant', 'hi' FROM chats;
	`)
	return client
}

describe("0.5.3 database", () => {
	test("every public table is stashed in the attic and emptied before the 0.6 DDL", async () => {
		const client = await old053()
		const db = drizzle(client)

		const res = await runMigrationsWithUpgrades(db, { migrationsFolder: REAL })

		expect(res.upgradesRun).toEqual(["0095_schema_0_6_0"])
		expect(await atticExists(client)).toBe(true)
		expect(await count(client, `${ATTIC_SCHEMA}.chats`)).toBe(1)
		expect(await count(client, `${ATTIC_SCHEMA}.chat_messages`)).toBe(2)
		expect(await count(client, `${ATTIC_SCHEMA}.personas`)).toBe(1)
		expect(await count(client, `${ATTIC_SCHEMA}.characters`)).toBe(2)
		expect(await count(client, `${ATTIC_SCHEMA}.users`)).toBe(1)

		const manifest = await client.query<{ table_name: string; row_count: string }>(
			`SELECT table_name, row_count::text FROM ${ATTIC_SCHEMA}.__manifest`
		)
		const byName = Object.fromEntries(
			manifest.rows.map((r) => [r.table_name, Number(r.row_count)])
		)
		expect(byName.chat_messages).toBe(2)
		expect(byName.chats).toBe(1)
		// Every 0.5.3 table is listed, the empty ones included.
		expect(byName.koboldcpp_models).toBe(0)

		// The DDL ran on empty tables and left the 0.6 shape.
		expect(await count(client, "public.sessions")).toBe(0)
		expect(await count(client, "public.session_messages")).toBe(0)
		expect(await count(client, "public.characters")).toBe(0)
		expect(await count(client, "public.users")).toBe(0)
		const personas = await client.query(
			`SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'personas'`
		)
		expect(personas.rows).toHaveLength(0)
	}, 60_000)

	test("a second boot neither re-stashes nor fails", async () => {
		const client = await old053()
		const db = drizzle(client)
		await runMigrationsWithUpgrades(db, { migrationsFolder: REAL })

		const second = await runMigrationsWithUpgrades(db, {
			migrationsFolder: REAL
		})

		expect(second.upgradesRun).toEqual([])
		expect(await count(client, `${ATTIC_SCHEMA}.chats`)).toBe(1)
	}, 60_000)
})

/** Stray ledger rows of the kind 0.5.x's old and dev chains left. */
const STRAY = [
	{ hash: "0".repeat(64), createdAt: 1_700_000_000_000 },
	{ hash: "f".repeat(64), createdAt: 1_700_000_000_001 }
]

async function addStray(client: PGlite, rows = STRAY): Promise<void> {
	for (const r of rows)
		await client.query(
			`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
			[r.hash, r.createdAt]
		)
}

async function ledgerHashes(client: PGlite): Promise<string[]> {
	const r = await client.query<{ hash: string }>(
		`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
	)
	return r.rows.map((x) => x.hash)
}

describe("the ledger prune (owner ruling 2026-10-02)", () => {
	const shipped = new Set(readJournalMigrations(REAL).map((m) => m.hash))

	test("a 0.5.3 upgrade prunes the rows no shipped file matches, once, and keeps them for the note", async () => {
		const client = await old053()
		await addStray(client)
		const db = drizzle(client)

		await runMigrationsWithUpgrades(db, { migrationsFolder: REAL })

		const after = await ledgerHashes(client)
		expect(after.filter((h) => !shipped.has(h))).toEqual([])
		// Every shipped migration is still recorded, each once.
		expect(new Set(after)).toEqual(shipped)
		expect(after).toHaveLength(shipped.size)
		const kept = await client.query<{ hash: string; created_at: string }>(
			`SELECT hash, created_at::text FROM ${ATTIC_SCHEMA}.${ATTIC_LEDGER_PRUNED} ORDER BY created_at`
		)
		expect(kept.rows).toEqual(
			STRAY.map((r) => ({ hash: r.hash, created_at: String(r.createdAt) }))
		)

		// Once: a row that turns up after the upgrade is left alone.
		await addStray(client, [STRAY[0]])
		const second = await runMigrationsWithUpgrades(db, { migrationsFolder: REAL })
		expect(second.upgradesRun).toEqual([])
		expect((await ledgerHashes(client)).filter((h) => !shipped.has(h))).toEqual([
			STRAY[0].hash
		])
	}, 60_000)

	test("a 0.5.3 ledger with nothing stray prunes nothing and leaves no record", async () => {
		const client = await old053()
		await runMigrationsWithUpgrades(drizzle(client), { migrationsFolder: REAL })
		const t = await client.query(
			`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
			[ATTIC_SCHEMA, ATTIC_LEDGER_PRUNED]
		)
		expect(t.rows).toHaveLength(0)
		expect(await ledgerHashes(client)).toHaveLength(shipped.size)
	}, 60_000)

	test("a fresh pub never prunes", async () => {
		const client = new PGlite()
		const db = drizzle(client)
		await runMigrationsWithUpgrades(db, { migrationsFolder: REAL, skipUpgrades: true })
		await addStray(client)
		await runMigrationsWithUpgrades(db, { migrationsFolder: REAL, skipUpgrades: true })
		expect((await ledgerHashes(client)).filter((h) => !shipped.has(h))).toEqual(
			STRAY.map((r) => r.hash)
		)
	}, 60_000)

	test("a pub already on 0.6 never prunes", async () => {
		const client = new PGlite()
		const db = drizzle(client)
		await runMigrationsWithUpgrades(db, { migrationsFolder: REAL, skipUpgrades: true })
		await addStray(client)
		const res = await runMigrationsWithUpgrades(db, { migrationsFolder: REAL })
		expect(res.upgradesRun).toEqual([])
		expect((await ledgerHashes(client)).filter((h) => !shipped.has(h))).toEqual(
			STRAY.map((r) => r.hash)
		)
		expect(await atticExists(client)).toBe(false)
	}, 60_000)
})

describe("fresh installs never touch the attic", () => {
	test("skipUpgrades applies the chain with no attic", async () => {
		const client = new PGlite()
		const res = await runMigrationsWithUpgrades(drizzle(client), {
			migrationsFolder: REAL,
			skipUpgrades: true
		})
		expect(res.upgradesRun).toEqual([])
		expect(await atticExists(client)).toBe(false)
	}, 60_000)

	test("createTestDb has no attic", async () => {
		const db = await createTestDb({ skipEntryTypes: true })
		const r = await db.execute(
			`SELECT 1 FROM information_schema.schemata WHERE schema_name = '${ATTIC_SCHEMA}'`
		)
		expect(r.rows).toHaveLength(0)
	}, 60_000)

	test("a database already at 0.6 does not enter the upgrade", async () => {
		const client = new PGlite()
		const db = drizzle(client)
		await runMigrationsWithUpgrades(db, {
			migrationsFolder: REAL,
			skipUpgrades: true
		})

		const res = await runMigrationsWithUpgrades(db, { migrationsFolder: REAL })

		expect(res.upgradesRun).toEqual([])
		expect(await atticExists(client)).toBe(false)
	}, 60_000)
})
