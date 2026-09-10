/**
 * 0109: `characters.avatar_media_id` and `personas.avatar_media_id` become real
 * foreign keys into `files`, `ON DELETE SET NULL`.
 *
 * ## Why these two columns take an FK when `files`'s own columns do not
 *
 * 28 §2 ruled no foreign keys on `files`. That ruling is about PROVENANCE:
 * `files.character_id` says which character a file came from, and a stale id
 * there is the feature — it keeps an orphan groupable, so "these 34 files
 * belonged to a character you deleted" stays an answerable question.
 *
 * An avatar pointer is the other direction and the other kind of fact. It is a
 * ROLE: the entity naming the one file it is currently wearing. There is nothing
 * to keep groupable about a role whose file no longer exists — a dangling
 * `avatar_media_id` is not evidence, it is a broken image. Same distinction the
 * codebase already draws at `pipeline_run_artifacts.entity_id` (evidence, no FK)
 * versus a role pointer.
 *
 * ## What the migration has to do that drizzle-kit could not write
 *
 * A dangling pointer was legal until this migration, and on any install that has
 * one, `ADD CONSTRAINT` fails outright. The two orphan-nulling `UPDATE`s are
 * hand-added AHEAD of the constraints for exactly that reason — the one
 * sanctioned edit to a generated file.
 *
 * ⚠ Runs against the REAL migration file, the way a real upgrade applies it.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { sql } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const MIGRATION = "drizzle/0109_avatar_media_fk.sql"

let db: TestDb
let migrationSql: string
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	migrationSql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")
	const user = await createTestUser(db, "avatar-fk-user")
	userId = user.id
}, 60_000)

/** The FK's own row in the catalog, plus its delete rule. */
async function foreignKey(table: "characters" | "personas") {
	const rows = await db.execute(sql`
		SELECT tc.constraint_name, rc.delete_rule, ccu.table_name AS referenced_table,
		       kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON kcu.constraint_name = tc.constraint_name
		JOIN information_schema.referential_constraints rc
		  ON rc.constraint_name = tc.constraint_name
		JOIN information_schema.constraint_column_usage ccu
		  ON ccu.constraint_name = tc.constraint_name
		WHERE tc.constraint_type = 'FOREIGN KEY'
		  AND tc.table_name = ${table}
		  AND kcu.column_name = 'avatar_media_id'
	`)
	return (rows.rows ?? rows) as Array<Record<string, unknown>>
}

/**
 * REGRESS: take the constraints back off, so a pre-0109 row can be written and
 * the migration has something to actually do. Without this the file would pass
 * vacuously — `createTestDb` has already applied 0109.
 */
async function dropAvatarFks() {
	for (const table of ["characters", "personas"] as const) {
		for (const fk of await foreignKey(table)) {
			await db.execute(
				sql.raw(
					`ALTER TABLE "${table}" DROP CONSTRAINT "${fk.constraint_name}"`
				)
			)
		}
	}
}

/**
 * Replay the real file the way drizzle's migrator does — one statement per
 * `--> statement-breakpoint`, in order.
 *
 * Not one `db.execute` over the whole file: PGlite refuses multiple commands in
 * a prepared statement, and more importantly, running it as one blob would not
 * be how it reaches a real install. The breakpoints are the unit of application.
 */
async function replayMigration() {
	for (const statement of migrationSql.split("--> statement-breakpoint")) {
		if (!statement.trim()) continue
		await db.execute(sql.raw(statement))
	}
}

async function makeFile(hash: string) {
	const [row] = await db
		.insert(schema.files)
		.values({ userId, kind: "image", hash })
		.returning()
	return row
}

describe("0109 turns the two avatar pointers into foreign keys", () => {
	it("declares an ON DELETE SET NULL foreign key into files on both tables", async () => {
		for (const table of ["characters", "personas"] as const) {
			const [fk] = await foreignKey(table)
			expect(
				fk,
				`${table}.avatar_media_id has no foreign key`
			).toBeTruthy()
			expect(fk.referenced_table).toBe("files")
			// SET NULL, not CASCADE: deleting a file must not delete the
			// character wearing it.
			expect(fk.delete_rule).toBe("SET NULL")
		}
	})

	it("nulls a dangling pointer before adding the constraint, so an install carrying one can still upgrade", async () => {
		// REGRESS first. `createTestDb` has already applied 0109, so a dangling
		// id cannot be written through the constraint — drop it, write the row
		// a pre-0109 install could genuinely be holding, then replay the real
		// migration over the table.
		await dropAvatarFks()

		const [character] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "Dangling Avatar",
				description: "points at a file that is gone",
				avatarMediaId: 987654321
			})
			.returning()
		const [persona] = await db
			.insert(schema.personas)
			.values({
				userId,
				isDefault: false,
				name: "Dangling Persona",
				description: "same",
				avatarMediaId: 987654321
			})
			.returning()

		// Without the hand-added backfill this line is the failure: ADD
		// CONSTRAINT refuses the table while either row still points at 987654321.
		await replayMigration()

		const after = await db.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		const afterPersona = await db.query.personas.findFirst({
			where: (p, { eq }) => eq(p.id, persona.id)
		})
		expect(after?.avatarMediaId).toBeNull()
		expect(afterPersona?.avatarMediaId).toBeNull()
		expect(await foreignKey("characters")).toHaveLength(1)
		expect(await foreignKey("personas")).toHaveLength(1)
	}, 60_000)

	it("leaves a VALID pointer alone — the backfill matches orphans, not every row", async () => {
		// Dropped and re-added rather than replayed over live constraints: ADD
		// CONSTRAINT is not idempotent, and the point here is the UPDATE's WHERE
		// clause, which a migration rewriting the column unconditionally would
		// fail.
		await dropAvatarFks()
		const file = await makeFile("valid-pointer-hash")
		const [character] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "Real Avatar",
				description: "points at a file that exists",
				avatarMediaId: file.id
			})
			.returning()

		await replayMigration()

		const after = await db.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(after?.avatarMediaId).toBe(file.id)
	}, 60_000)

	it("nulls the avatar when its file row is deleted, with no application code involved", async () => {
		const file = await makeFile("cascade-set-null-hash")
		const [character] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "Loses Its Avatar",
				description: "d",
				avatarMediaId: file.id
			})
			.returning()
		const [persona] = await db
			.insert(schema.personas)
			.values({
				userId,
				isDefault: false,
				name: "Also Loses It",
				description: "d",
				avatarMediaId: file.id
			})
			.returning()

		// The raw delete, deliberately — not `deleteFile`, not the socket
		// handler. What is under test is that the DATABASE clears the pointer,
		// which is what lets the hand-written UPDATEs in sockets/media.ts go.
		await db.execute(sql`DELETE FROM files WHERE id = ${file.id}`)

		expect(
			(
				await db.query.characters.findFirst({
					where: (c, { eq }) => eq(c.id, character.id)
				})
			)?.avatarMediaId
		).toBeNull()
		expect(
			(
				await db.query.personas.findFirst({
					where: (p, { eq }) => eq(p.id, persona.id)
				})
			)?.avatarMediaId
		).toBeNull()
	}, 60_000)

	it("refuses a new dangling pointer outright", async () => {
		await expect(
			db.insert(schema.characters).values({
				userId,
				name: "Rejected",
				description: "d",
				avatarMediaId: 123456789
			})
		).rejects.toThrow()
	}, 60_000)
})
