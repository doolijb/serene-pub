/**
 * The lorebook table registry is schema-driven (plan B1): every table whose
 * rows point at a lorebook — by a foreign key into the book or one of the
 * tables it owns, or by owner kind and id — is registered, or named below
 * with the reason it is not the book's. A new table that belongs to a book
 * therefore fails here instead of silently not being copied or deleted.
 */

import { describe, expect, test } from "vitest"
import { getTableConfig, PgTable } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { LOREBOOK_TABLES } from "./tableRegistry"

/** The book and the tables it owns — a key into one makes a row the book's. */
const BOOK_TABLES = [
	"lorebooks",
	"lorebook_entries",
	"lorebook_bindings",
	"lorebook_branches",
	"scenes"
]

/**
 * Tables that point at a book table but do not belong to the book. A row
 * here READS the book, or belongs to a session or a card; the book's delete
 * sets its reference null or cascades it as the session's own concern.
 */
const NOT_THE_BOOKS: Record<string, string> = {
	characters: "a card links a book; the book does not own it",
	sessions: "a session reads a book and a line; it is its owner's",
	message_annotations: "a session message's annotation",
	state_proposals: "a session's review queue (pending owner changes go with the owner)"
}

const allTables = (Object.values(schema) as unknown[]).filter(
	(v): v is PgTable => v instanceof PgTable
)
const nameOf = (t: PgTable) => getTableConfig(t).name

describe("lorebook table registry", () => {
	test("every table that points at a book is registered, or named as not the book's", () => {
		const registered = new Set(LOREBOOK_TABLES.map((s) => nameOf(s.table)))
		const missing: string[] = []
		const found: string[] = []
		for (const table of allTables) {
			const config = getTableConfig(table)
			if (config.name === "lorebooks") continue
			const pointsAtBook = config.foreignKeys.some((fk) =>
				BOOK_TABLES.includes(getTableConfig(fk.reference().foreignTable).name)
			)
			const ownedByKind = config.columns.some((c) => c.name === "owner_kind")
			if (!pointsAtBook && !ownedByKind) continue
			found.push(config.name)
			if (registered.has(config.name) || config.name in NOT_THE_BOOKS) continue
			missing.push(config.name)
		}
		expect(missing).toEqual([])
		// No stale names: each exemption and each registered table is found.
		expect(found.sort()).toEqual([...registered, ...Object.keys(NOT_THE_BOOKS)].sort())
	})

	test("the registry names each table once, and the book's own tables first", () => {
		const names = LOREBOOK_TABLES.map((s) => nameOf(s.table))
		expect(new Set(names).size).toBe(names.length)
		for (const own of BOOK_TABLES.filter((n) => n !== "lorebooks"))
			expect(names).toContain(own)
		// The attribute tables go last: their copy maps through every owner,
		// and the purge (backwards) reaches them while the owners still exist.
		const firstPolymorphic = LOREBOOK_TABLES.findIndex((s) => typeof s.scope === "object")
		expect(
			LOREBOOK_TABLES.slice(firstPolymorphic).every((s) => typeof s.scope === "object")
		).toBe(true)
	})

	test("line-scoped means the table has a branch_id", () => {
		for (const spec of LOREBOOK_TABLES) {
			const hasBranch = getTableConfig(spec.table).columns.some((c) => c.name === "branch_id")
			expect([nameOf(spec.table), hasBranch]).toEqual([nameOf(spec.table), spec.lineScoped])
		}
	})
})
