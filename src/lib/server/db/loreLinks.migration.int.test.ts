/**
 * Widening an edge's endpoints, against a database that already has edges.
 *
 * The migration makes `from_node_id`/`to_node_id` nullable, adds the entry
 * halves, and adds a CHECK per side saying exactly one of the pair is set. The
 * risk is the last part: a constraint added over live rows either holds for
 * every one of them or the migration cannot apply at all. So the cast
 * relationship here is inserted **before** 0124 runs, by the migrations that
 * precede it, and read back after — the same arrangement `0120`'s own test
 * used, for the same reason.
 *
 * The constraint is then exercised in both directions it can fail: a row naming
 * a binding AND an entry on one side, and a row naming neither.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql, type SQL } from "drizzle-orm"
import { rawRows } from "./rawRows"

type MigrationDb = ReturnType<typeof drizzle>

const REAL_FOLDER = path.resolve(process.cwd(), "drizzle")

/** The migration under test, found by name so its index may move. */
const TAG_SUFFIX = "lore_links"

interface JournalEntry {
	idx: number
	version: string
	when: number
	tag: string
	breakpoints: boolean
}

const tempDirs: string[] = []

/** A migrations folder holding everything up to, but not including, `tag`. */
function folderBefore(tagSuffix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-lore-links-mig-"))
	tempDirs.push(dir)
	const journal = JSON.parse(
		fs.readFileSync(path.join(REAL_FOLDER, "meta/_journal.json"), "utf8")
	) as { entries: JournalEntry[] }
	const cut = journal.entries.findIndex((e) => e.tag.endsWith(tagSuffix))
	if (cut < 0) throw new Error(`No journal entry ending "${tagSuffix}"`)
	const entries = journal.entries.slice(0, cut)
	for (const e of entries)
		fs.copyFileSync(
			path.join(REAL_FOLDER, `${e.tag}.sql`),
			path.join(dir, `${e.tag}.sql`)
		)
	fs.mkdirSync(path.join(dir, "meta"), { recursive: true })
	fs.writeFileSync(
		path.join(dir, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries })
	)
	return dir
}

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

let client: PGlite
let db: MigrationDb
let lorebookId: number
let aliceId: number
let bobId: number
let relationshipId: number
let entryId: number

beforeAll(async () => {
	client = new PGlite()
	db = drizzle(client)
	await migrate(db, { migrationsFolder: folderBefore(TAG_SUFFIX) })

	const [user] = await rows<{ id: number }>(
		db,
		sql`select id from users order by id limit 1`
	)
	const [book] = await rows<{ id: number }>(
		db,
		sql`insert into lorebooks (name, user_id) values ('Roads', ${user.id})
			returning id`
	)
	lorebookId = book.id

	const binding = async (name: string, token: string) => {
		const [row] = await rows<{ id: number }>(
			db,
			sql`insert into lorebook_bindings (lorebook_id, binding, name)
				values (${lorebookId}, ${token}, ${name}) returning id`
		)
		return row.id
	}
	aliceId = await binding("Alice", "{{char:1}}")
	bobId = await binding("Bob", "{{char:2}}")

	const [rel] = await rows<{ id: number }>(
		db,
		sql`insert into narrative_relationships
			(lorebook_id, from_node_id, to_node_id, relationship_type)
			values (${lorebookId}, ${aliceId}, ${bobId}, 'ally') returning id`
	)
	relationshipId = rel.id

	// The entry type's FK points at `pipeline_type_registry`, which the boot
	// projection fills and the migrations do not — so this test, which runs the
	// migrator alone, declares the one type it writes rows of.
	await db.execute(
		sql`insert into pipeline_type_registry (type_id, version, kind)
			values ('core:entry/world-lore', 1, 'entry')
			on conflict do nothing`
	)

	const [entry] = await rows<{ id: number }>(
		db,
		sql`insert into lorebook_entries
			(lorebook_id, type_id, type_version, position, title, content)
			values (${lorebookId}, 'core:entry/world-lore', 1, 1, 'The Tunnel', '')
			returning id`
	)
	entryId = entry.id
}, 60_000)

afterAll(async () => {
	await client?.close()
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("0124, the endpoint widening", () => {
	it("has neither entry column before it runs", async () => {
		expect(
			await hasColumn(db, "narrative_relationships", "from_entry_id")
		).toBe(false)
		expect(
			await hasColumn(db, "narrative_relationships", "to_entry_id")
		).toBe(false)
	})

	it("applies over a lorebook that already has a cast edge", async () => {
		await migrate(db, { migrationsFolder: REAL_FOLDER })

		const [rel] = await rows<{
			from_node_id: number
			to_node_id: number
			from_entry_id: number | null
			to_entry_id: number | null
		}>(
			db,
			sql`select from_node_id, to_node_id, from_entry_id, to_entry_id
				from narrative_relationships where id = ${relationshipId}`
		)
		// Untouched: both node ids set, both entry ids null, which is exactly
		// what the two checks demand of it.
		expect(rel.from_node_id).toBe(aliceId)
		expect(rel.to_node_id).toBe(bobId)
		expect(rel.from_entry_id).toBeNull()
		expect(rel.to_entry_id).toBeNull()
	})

	it("drops the two feature columns", async () => {
		expect(await hasColumn(db, "lorebooks", "features")).toBe(false)
		expect(await hasColumn(db, "system_settings", "features_default")).toBe(
			false
		)
	})

	it("takes an edge between two entries", async () => {
		const [other] = await rows<{ id: number }>(
			db,
			sql`insert into lorebook_entries
				(lorebook_id, type_id, type_version, position, title, content)
				values (${lorebookId}, 'core:entry/world-lore', 1, 2, 'The Room', '')
				returning id`
		)
		const [edge] = await rows<{ id: number }>(
			db,
			sql`insert into narrative_relationships
				(lorebook_id, from_entry_id, to_entry_id, relationship_type)
				values (${lorebookId}, ${other.id}, ${entryId}, 'connects to')
				returning id`
		)
		expect(edge.id).toBeGreaterThan(0)
	})

	it("refuses a side that names both a binding and an entry", async () => {
		await expect(
			db.execute(
				sql`insert into narrative_relationships
					(lorebook_id, from_node_id, from_entry_id, to_node_id, relationship_type)
					values (${lorebookId}, ${aliceId}, ${entryId}, ${bobId}, 'ally')`
			)
		).rejects.toThrow(/from_endpoint_check/)
	})

	it("refuses a side that names neither", async () => {
		await expect(
			db.execute(
				sql`insert into narrative_relationships
					(lorebook_id, from_node_id, relationship_type)
					values (${lorebookId}, ${aliceId}, 'ally')`
			)
		).rejects.toThrow(/to_endpoint_check/)
	})

	it("takes the edge with the entry when the entry goes", async () => {
		const [before] = await rows<{ total: number }>(
			db,
			sql`select count(*)::int as total from narrative_relationships
				where from_entry_id = ${entryId} or to_entry_id = ${entryId}`
		)
		expect(before.total).toBeGreaterThan(0)

		await db.execute(
			sql`delete from lorebook_entries where id = ${entryId}`
		)

		const [after] = await rows<{ total: number }>(
			db,
			sql`select count(*)::int as total from narrative_relationships
				where from_entry_id = ${entryId} or to_entry_id = ${entryId}`
		)
		expect(after.total).toBe(0)
	})
})
