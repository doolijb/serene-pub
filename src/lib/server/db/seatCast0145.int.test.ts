/**
 * Migration 0145 (plan §27 S1): the seat-cast schema. A 0144 install keeps
 * every row; `session_characters` gains its own id, backfilled distinct; the
 * new `cast_member_id` / `merged_into` / `overlay_of` / `timbre` columns are
 * null; a sprite set belongs to a card OR a cast member; the five owner-kind
 * CHECKs also accept `seated_member`; and a second boot changes nothing.
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

const OWNER_KIND_CHECKS = [
	"attribute_carries_owner_kind_check",
	"attribute_configs_owner_kind_check",
	"attribute_values_owner_kind_check",
	"owner_sheets_owner_kind_check",
	"zone_contents_owner_kind_check"
]

describe("0145: seat-cast schema", () => {
	it("keeps 0.6 rows, backfills seat ids, and holds the new columns and checks", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0144_local_models_per_modality_key"
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
				 VALUES (${sessionId}, ${ada}, 0), (${sessionId}, ${bo}, 1)`
			)
			await q(
				`INSERT INTO session_personas (session_id, persona_id) VALUES (${sessionId}, ${bo})`
			)
			await q(
				`INSERT INTO messages (session_id, role, character_id) VALUES (${sessionId}, 'assistant', ${ada})`
			)
			await q(
				`INSERT INTO session_messages (session_id, role, content, character_id)
				 VALUES (${sessionId}, 'character', 'hi', ${ada})`
			)
			await q(
				`INSERT INTO sprite_sets (character_id, name, is_default) VALUES (${ada}, 'default', true)`
			)

			// ── the real folder ──────────────────────────────────────────
			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(db, { migrationsFolder: real })

			// session_characters: distinct ids, the next one for a new seat.
			const seats = await q(
				`SELECT id, character_id, cast_member_id, merged_into FROM session_characters ORDER BY character_id`
			)
			expect(seats).toHaveLength(2)
			expect(seats.every((s) => Number.isInteger(s.id))).toBe(true)
			expect(new Set(seats.map((s) => s.id)).size).toBe(2)
			await q(
				`INSERT INTO characters (name, description, user_id) VALUES ('Cy', '', ${userId})`
			)
			const [{ id: cy }] = await q(`SELECT max(id) AS id FROM characters`)
			await q(
				`INSERT INTO session_characters (session_id, character_id) VALUES (${sessionId}, ${cy})`
			)
			const [{ id: newId }] = await q(
				`SELECT id FROM session_characters WHERE character_id = ${cy}`
			)
			expect(newId).toBeGreaterThan(Math.max(...seats.map((s) => s.id)))
			// The (session, character) unique index still refuses a duplicate.
			await expect(
				q(
					`INSERT INTO session_characters (session_id, character_id) VALUES (${sessionId}, ${ada})`
				)
			).rejects.toThrow()

			// The new columns are null on every old row.
			expect(seats.every((s) => s.cast_member_id === null)).toBe(true)
			expect(seats.every((s) => s.merged_into === null)).toBe(true)
			for (const t of [
				"session_personas",
				"messages",
				"session_messages"
			]) {
				const rows = await q(`SELECT cast_member_id FROM ${t}`)
				expect(rows).toHaveLength(1)
				expect(rows[0].cast_member_id).toBeNull()
			}

			// Two seats of one session may share a cast member (non-unique index).
			await q(
				`UPDATE session_characters SET cast_member_id = ${memberId} WHERE session_id = ${sessionId} AND character_id IN (${ada}, ${bo})`
			)
			expect(
				await q(
					`SELECT id FROM session_characters WHERE cast_member_id = ${memberId}`
				)
			).toHaveLength(2)
			// merged_into points at a seat and nulls when that seat goes.
			await q(
				`UPDATE session_characters SET merged_into = ${newId} WHERE character_id = ${bo}`
			)
			await q(`DELETE FROM session_characters WHERE id = ${newId}`)
			expect(
				(
					await q(
						`SELECT merged_into FROM session_characters WHERE character_id = ${bo}`
					)
				)[0].merged_into
			).toBeNull()

			// sprite_sets: the old row is intact; exactly one owner.
			const old = await q(`SELECT * FROM sprite_sets`)
			expect(old).toHaveLength(1)
			expect(old[0]).toMatchObject({
				character_id: ada,
				cast_member_id: null,
				name: "default",
				is_default: true
			})
			await q(
				`INSERT INTO sprite_sets (cast_member_id, name, is_default) VALUES (${memberId}, 'default', true)`
			)
			await expect(
				q(
					`INSERT INTO sprite_sets (character_id, cast_member_id, name) VALUES (${bo}, ${memberId}, 'both')`
				)
			).rejects.toThrow()
			await expect(
				q(`INSERT INTO sprite_sets (name) VALUES ('neither')`)
			).rejects.toThrow()
			// A member's set names and its default are unique per member.
			await expect(
				q(
					`INSERT INTO sprite_sets (cast_member_id, name) VALUES (${memberId}, 'default')`
				)
			).rejects.toThrow()
			await expect(
				q(
					`INSERT INTO sprite_sets (cast_member_id, name, is_default) VALUES (${memberId}, 'second', true)`
				)
			).rejects.toThrow()

			// lorebook_bindings: timbre null by default; overlay_of SET NULL.
			await q(
				`INSERT INTO lorebook_bindings (lorebook_id, binding, name, overlay_of)
				 VALUES (${bookId}, '{{char:2}}', 'Own', ${memberId})`
			)
			const bindings = await q(
				`SELECT id, timbre, overlay_of FROM lorebook_bindings ORDER BY id`
			)
			expect(bindings.every((b) => b.timbre === null)).toBe(true)
			expect(bindings[1].overlay_of).toBe(memberId)
			// Deleting the member nulls overlay_of on the other row and
			// deletes its own sprite set, and nulls the seats' pointers.
			await q(`DELETE FROM lorebook_bindings WHERE id = ${memberId}`)
			expect(
				(
					await q(
						`SELECT overlay_of FROM lorebook_bindings WHERE binding = '{{char:2}}'`
					)
				)[0].overlay_of
			).toBeNull()
			expect(
				await q(
					`SELECT id FROM sprite_sets WHERE cast_member_id IS NOT NULL`
				)
			).toHaveLength(0)
			expect(await q(`SELECT id FROM sprite_sets`)).toHaveLength(1)
			expect(
				await q(
					`SELECT id FROM session_characters WHERE cast_member_id IS NOT NULL`
				)
			).toHaveLength(0)

			// The five owner-kind CHECKs take both spellings.
			for (const name of OWNER_KIND_CHECKS) {
				const [row] = await q(
					`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = '${name}'`
				)
				expect(row.def).toContain("'seated_member'")
				expect(row.def).toContain("'session_cast'")
			}

			// A second boot changes nothing.
			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			const seatsAfter = await q(
				`SELECT * FROM session_characters ORDER BY id`
			)
			await migrate(db, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			expect(
				await q(`SELECT * FROM session_characters ORDER BY id`)
			).toEqual(seatsAfter)
		} finally {
			await client.close()
		}
	}, 60_000)
})
