/**
 * Migration 0167 adds `lorebook_entries.not_common_knowledge` and
 * `narrative_relationships.knowledge_kind` with its CHECK. A 0166 install keeps
 * every entry and relationship unchanged (every entry common knowledge, every
 * relationship ordinary), ends with the same schema as a fresh install, and a
 * second boot changes nothing.
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

describe("0167: entries can be marked, relationships can be knowledge ties", () => {
	it("keeps every row, matches a fresh install, refuses a bad tie, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0166_message_firsthand_drop"
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
				`INSERT INTO users (username) SELECT 'knowledge-owner' WHERE NOT EXISTS (SELECT 1 FROM users)`
			)
			await q(
				`INSERT INTO lorebooks (user_id, name) SELECT min(id), 'Book' FROM users`
			)
			await q(
				`INSERT INTO pipeline_definition_registry (definition_id, version, kind) VALUES ('test:one', 1, 'entry-type'), ('test:two', 1, 'entry-type')`
			)
			for (const name of ["one", "two"])
				await q(
					`INSERT INTO lorebook_entries (lorebook_id, type_id, type_version, position, keys) SELECT min(id), 'test:${name}', 1, 1, ARRAY['${name}'] FROM lorebooks`
				)
			await q(
				`INSERT INTO lorebook_bindings (lorebook_id, binding, name) SELECT min(id), '{{char:1}}', 'Ana' FROM lorebooks`
			)
			await q(
				`INSERT INTO narrative_relationships (lorebook_id, from_node_id, to_entry_id, relationship_type) SELECT l.id, (SELECT min(id) FROM lorebook_bindings), (SELECT min(id) FROM lorebook_entries), 'member of' FROM lorebooks l`
			)
			await q(
				`INSERT INTO narrative_relationships (lorebook_id, from_entry_id, to_entry_id, relationship_type) SELECT l.id, (SELECT min(id) FROM lorebook_entries), (SELECT max(id) FROM lorebook_entries), 'leads to' FROM lorebooks l`
			)
			const relsBefore = await q(
				`SELECT * FROM narrative_relationships ORDER BY id`
			)
			const entriesBefore = await q(
				`SELECT id, lorebook_id, type_id, keys FROM lorebook_entries ORDER BY id`
			)
			expect(relsBefore).toHaveLength(2)
			expect(entriesBefore).toHaveLength(2)

			await migrate(db, { migrationsFolder: real })

			const marks = await q(
				`SELECT not_common_knowledge FROM lorebook_entries`
			)
			expect(marks).toHaveLength(2)
			expect(marks.every((r) => r.not_common_knowledge === false)).toBe(
				true
			)
			expect(
				await q(
					`SELECT id, lorebook_id, type_id, keys FROM lorebook_entries ORDER BY id`
				)
			).toEqual(entriesBefore)
			const relsAfter = await q(
				`SELECT * FROM narrative_relationships ORDER BY id`
			)
			expect(relsAfter.every((r) => r.knowledge_kind === null)).toBe(true)
			expect(
				relsAfter.map(({ knowledge_kind, ...rest }) => rest)
			).toEqual(relsBefore)

			const freshDb = drizzle(fresh)
			await migrate(freshDb, { migrationsFolder: real })
			const fq = async (s: string) =>
				rawRows<any>(await freshDb.execute(sql.raw(s)))
			expect(await q(COLUMNS)).toEqual(await fq(COLUMNS))
			expect(await q(INDEXES)).toEqual(await fq(INDEXES))

			// The CHECK: a kind only on a cast→entry row, and only a known kind.
			const insertKind = (from: string, kind: string) =>
				q(
					`INSERT INTO narrative_relationships (lorebook_id, ${from}, to_entry_id, relationship_type, knowledge_kind) SELECT l.id, ${
						from === "from_node_id"
							? "(SELECT min(id) FROM lorebook_bindings)"
							: "(SELECT min(id) FROM lorebook_entries)"
					}, (SELECT max(id) FROM lorebook_entries), 'x', '${kind}' FROM lorebooks l`
				)
			await expect(insertKind("from_entry_id", "knows")).rejects.toThrow()
			await expect(
				insertKind("from_node_id", "believes")
			).rejects.toThrow()
			await insertKind("from_node_id", "kept_from")
			await q(
				`DELETE FROM narrative_relationships WHERE knowledge_kind IS NOT NULL`
			)

			const snap = async () => ({
				ledger: await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				),
				entries: await q(`SELECT * FROM lorebook_entries ORDER BY id`),
				rels: await q(
					`SELECT * FROM narrative_relationships ORDER BY id`
				),
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
