/**
 * Migration 0146 (plan §32 §1, §33): the `character_versions` table and its
 * sibling columns. A 0145 install keeps every row; the table is empty; the new
 * columns hold their defaults; the table's CHECKs and unique indexes refuse the
 * shapes they are there to refuse; and a second boot changes nothing.
 */
import { afterAll, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql } from "drizzle-orm"
import { rawRows } from "./rawRows"
import { migrationsFolderThrough } from "$lib/server/utils/testDb"

const disposers: Array<() => Promise<void>> = []
afterAll(async () => {
	for (const d of disposers) await d()
})

const COUNTED = [
	"users",
	"characters",
	"lorebooks",
	"lorebook_bindings",
	"sessions",
	"session_characters",
	"messages",
	"session_messages",
	"files"
]

describe("0146: character versions schema", () => {
	it("keeps 0.6 rows, adds the table and columns, and holds the checks", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0145_seat_cast_members"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0.6-shaped install ─────────────────────────────────────
			// Migrations seed a user already; use it.
			const [{ id: userId }] = await q(
				`SELECT id FROM users ORDER BY id LIMIT 1`
			)
			for (const n of ["Ada", "Bo"]) {
				await q(
					`INSERT INTO characters (name, description, user_id) VALUES ('${n}', '', ${userId})`
				)
			}
			const [ada, bo] = (
				await q(`SELECT id FROM characters ORDER BY id`)
			).map((r) => r.id)
			await q(
				`INSERT INTO lorebooks (name, user_id) VALUES ('Book', ${userId})`
			)
			const [{ id: bookId }] = await q(`SELECT id FROM lorebooks`)
			await q(
				`INSERT INTO lorebook_bindings (lorebook_id, character_id, binding, name)
				 VALUES (${bookId}, ${ada}, '{{char:1}}', 'Ada')`
			)
			const [{ id: memberId }] = await q(
				`SELECT id FROM lorebook_bindings`
			)
			await q(
				`INSERT INTO sessions (user_id, is_group) VALUES (${userId}, true)`
			)
			const [{ id: sessionId }] = await q(`SELECT id FROM sessions`)
			await q(
				`INSERT INTO session_characters (session_id, character_id, position)
				 VALUES (${sessionId}, ${ada}, 0)`
			)
			await q(
				`INSERT INTO messages (session_id, role, character_id) VALUES (${sessionId}, 'assistant', ${ada})`
			)
			await q(
				`INSERT INTO session_messages (session_id, role, content, character_id)
				 VALUES (${sessionId}, 'character', 'hi', ${ada})`
			)
			await q(
				`INSERT INTO files (user_id, kind, hash) VALUES (${userId}, 'image', 'h1')`
			)
			const [{ id: messageId }] = await q(`SELECT id FROM messages`)

			const before: Record<string, number> = {}
			for (const t of COUNTED) {
				before[t] = (
					await q(`SELECT count(*)::int AS n FROM ${t}`)
				)[0].n
			}

			// ── the real folder ──────────────────────────────────────────
			// Through 0146, not the whole folder: 0147 drops `files.cast_member_id`,
			// which this test asserts below.
			const through = await migrationsFolderThrough(
				"0146_character_versions"
			)
			disposers.push(through.dispose)
			const real = through.folder
			await migrate(db, { migrationsFolder: real })

			// Every pre-existing row survives.
			for (const t of COUNTED) {
				expect(
					(await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n,
					t
				).toBe(before[t])
			}
			expect(
				(await q(`SELECT name FROM characters ORDER BY id`)).map(
					(r) => r.name
				)
			).toEqual(["Ada", "Bo"])

			// The table exists and is empty.
			expect(await q(`SELECT id FROM character_versions`)).toHaveLength(0)

			// The sibling columns exist with their defaults.
			const [s] = await q(
				`SELECT line_on_first_write, branch_ancestry FROM sessions`
			)
			expect(s.line_on_first_write).toBe(false)
			expect(s.branch_ancestry).toBeNull()
			for (const t of ["messages", "session_messages"]) {
				const [r] = await q(
					`SELECT origin_session_id, origin_message_id FROM ${t}`
				)
				expect(r.origin_session_id).toBeNull()
				expect(r.origin_message_id).toBeNull()
			}
			expect(
				(await q(`SELECT cast_member_id FROM files`))[0].cast_member_id
			).toBeNull()
			expect(
				(await q(`SELECT seated_by_user_id FROM session_characters`))[0]
					.seated_by_user_id
			).toBeNull()

			// ── the CHECKs and unique indexes ────────────────────────────
			// A card version inserts.
			await q(
				`INSERT INTO character_versions (card_id, number, write_order) VALUES (${ada}, 1, 1)`
			)
			const [{ id: cardVersionId }] = await q(
				`SELECT id FROM character_versions WHERE card_id = ${ada}`
			)
			// Both owners, and neither owner, are refused.
			await expect(
				q(
					`INSERT INTO character_versions (card_id, cast_member_id, number, lorebook_id, node_state, node_visibility, write_order)
					 VALUES (${bo}, ${memberId}, 1, ${bookId}, 'active', 'normal', 1)`
				)
				// Checks run in name order; with both owners the card- and
				// cast-version terms contradict before one_owner is reached.
			).rejects.toSatisfy((e: any) =>
				/character_versions_(card_version|cast_version|one_owner)_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			await expect(
				q(
					`INSERT INTO character_versions (number, write_order) VALUES (1, 1)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_one_owner_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			// A card version follows nothing, and has a number.
			await expect(
				q(
					`INSERT INTO character_versions (card_id, number, follows, write_order) VALUES (${bo}, 1, '{name}', 1)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_card_version_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			await expect(
				q(
					`INSERT INTO character_versions (card_id, write_order) VALUES (${bo}, 1)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_card_version_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			// A card version carries no book.
			await expect(
				q(
					`INSERT INTO character_versions (card_id, number, lorebook_id, write_order) VALUES (${bo}, 1, ${bookId}, 1)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_card_version_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			// A cast version needs its book.
			await expect(
				q(
					`INSERT INTO character_versions (cast_member_id, node_state, node_visibility, year, write_order)
					 VALUES (${memberId}, 'active', 'normal', 7, 1)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_cast_version_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			// (card, number) is unique.
			await expect(
				q(
					`INSERT INTO character_versions (card_id, number, write_order) VALUES (${ada}, 1, 2)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_card_number_idx/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)

			// A cast version inserts: the member's undated base.
			await q(
				`INSERT INTO character_versions (cast_member_id, lorebook_id, node_state, node_visibility, write_order)
				 VALUES (${memberId}, ${bookId}, 'active', 'normal', 2)`
			)
			// A second undated authored base for the member is refused.
			await expect(
				q(
					`INSERT INTO character_versions (cast_member_id, lorebook_id, node_state, node_visibility, write_order)
					 VALUES (${memberId}, ${bookId}, 'active', 'normal', 3)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_base_idx/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			// Follows with no parent is the writer's rule, not a CHECK: a card's
			// hard delete sets `parent_version_id` null and must not be refused.
			await q(
				`INSERT INTO character_versions (cast_member_id, lorebook_id, node_state, node_visibility, year, follows, write_order)
				 VALUES (${memberId}, ${bookId}, 'active', 'normal', 5, '{name}', 3)`
			)
			// A cast version with a parent card version may follow it.
			await q(
				`INSERT INTO character_versions (cast_member_id, lorebook_id, node_state, node_visibility, year, parent_version_id, follows, write_order)
				 VALUES (${memberId}, ${bookId}, 'active', 'normal', 5, ${cardVersionId}, '{name,description}', 4)`
			)
			// An anchor needs its source session.
			await expect(
				q(
					`INSERT INTO character_versions (cast_member_id, lorebook_id, node_state, node_visibility, year, valid_from_message_id, write_order)
					 VALUES (${memberId}, ${bookId}, 'active', 'normal', 6, ${messageId}, 5)`
				)
			).rejects.toSatisfy((e: any) =>
				/character_versions_anchor_source_check/.test(
					String(e?.cause?.message ?? e?.message)
				)
			)
			expect(await q(`SELECT id FROM character_versions`)).toHaveLength(4)

			// ── lorebooks.session_id has no FK any more (plan §33.3) ─────
			// A parent's own book outlives its session row while a branch
			// rides it, so the column names a session that may not exist.
			expect(
				await q(
					`SELECT conname FROM pg_constraint WHERE conrelid = 'lorebooks'::regclass AND contype = 'f' AND conkey = ARRAY(SELECT attnum FROM pg_attribute WHERE attrelid = 'lorebooks'::regclass AND attname = 'session_id')`
				)
			).toEqual([])
			await q(
				`INSERT INTO lorebooks (name, user_id, session_id) VALUES ('Kept notes', ${userId}, 987654)`
			)
			expect(
				await q(`SELECT id FROM lorebooks WHERE session_id = 987654`)
			).toHaveLength(1)
			await q(`DELETE FROM lorebooks WHERE session_id = 987654`)

			// ── a second boot changes nothing ────────────────────────────
			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			const counts: Record<string, number> = {}
			for (const t of [...COUNTED, "character_versions"]) {
				counts[t] = (
					await q(`SELECT count(*)::int AS n FROM ${t}`)
				)[0].n
			}
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			for (const t of Object.keys(counts)) {
				expect(
					(await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n,
					t
				).toBe(counts[t])
			}
		} finally {
			await client.close()
		}
	}, 60_000)
})
