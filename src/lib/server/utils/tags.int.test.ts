/**
 * Round-10 audit fix (HIGH — data integrity): tags had no per-user
 * uniqueness constraint, and every process*Tags find-or-create loop only
 * did a case-sensitive exact match, so importing a card tagged "fantasy"
 * when the user already had "Fantasy" created a second, case-variant tag
 * instead of adopting the existing one. Fixed with a case-insensitive
 * unique index (tags_user_id_name_unique, schema.ts) plus a shared
 * findOrCreateTagId helper (this file) used by every add-tags loop and by
 * tagsCreate/tagsUpdate (sockets/tags.ts).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"

// This file always passes its own `testDb` explicitly to findOrCreateTagId
// (never relying on the module-level `db` default) — but importing "./tags"
// still evaluates its `import { db } from "$lib/server/db"` at module
// scope, which otherwise triggers a real connection/lock-check against the
// on-disk dev database purely as an import side effect, and can collide
// with other unmocked test files' locks when the full suite runs in
// parallel. A bare stub is enough since nothing here calls the real db.
vi.mock("$lib/server/db", () => ({ db: {} }))

import { findOrCreateTagId } from "./tags"

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-tags-int-test-")
	)
	testDb = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("findOrCreateTagId", () => {
	test("creates a new tag when truly new", async () => {
		const user = await createTestUser(testDb, "tags-create-new-user")
		const id = await findOrCreateTagId(user.id, "Steampunk", testDb)
		expect(id).not.toBeNull()
		const row = await testDb.query.tags.findFirst({
			where: (t, { eq }) => eq(t.id, id!)
		})
		expect(row?.name).toBe("Steampunk")
	})

	test("adopts an existing tag for a case-variant name", async () => {
		const user = await createTestUser(testDb, "tags-case-variant-user")
		const firstId = await findOrCreateTagId(user.id, "Fantasy", testDb)
		const secondId = await findOrCreateTagId(user.id, "fantasy", testDb)
		expect(secondId).toBe(firstId)
		const rows = await testDb.query.tags.findMany({
			where: (t, { eq }) => eq(t.userId, user.id)
		})
		expect(rows.length).toBe(1)
	})

	test("adopts an existing tag for a whitespace-variant name", async () => {
		const user = await createTestUser(testDb, "tags-whitespace-user")
		const firstId = await findOrCreateTagId(user.id, "Horror", testDb)
		const secondId = await findOrCreateTagId(user.id, "  Horror  ", testDb)
		expect(secondId).toBe(firstId)
		const rows = await testDb.query.tags.findMany({
			where: (t, { eq }) => eq(t.userId, user.id)
		})
		expect(rows.length).toBe(1)
	})

	test("returns null for an empty/whitespace-only name", async () => {
		const user = await createTestUser(testDb, "tags-empty-name-user")
		expect(await findOrCreateTagId(user.id, "   ", testDb)).toBeNull()
	})

	test("scopes tags per user — same name for two users creates two rows", async () => {
		const userA = await createTestUser(testDb, "tags-scope-user-a")
		const userB = await createTestUser(testDb, "tags-scope-user-b")
		const idA = await findOrCreateTagId(userA.id, "Isekai", testDb)
		const idB = await findOrCreateTagId(userB.id, "Isekai", testDb)
		expect(idA).not.toBe(idB)
	})
})

describe("tags_user_id_name_unique index", () => {
	test("rejects a raw case-insensitive duplicate insert bypassing findOrCreateTagId", async () => {
		const user = await createTestUser(testDb, "tags-raw-duplicate-user")
		await testDb
			.insert(schema.tags)
			.values({ name: "Cyberpunk", userId: user.id })
		await expect(
			testDb
				.insert(schema.tags)
				.values({ name: "cyberpunk", userId: user.id })
		).rejects.toThrow()
	})
})

describe("migration 0085 cleanup — merges pre-existing case-variant duplicates", () => {
	test("merges duplicate tags, repoints/dedupes associations, then the unique index applies cleanly", async () => {
		// The unique index is already active on `testDb` (createTestDb() runs
		// every migration, including 0085) — drop it so duplicate rows can be
		// seeded again, exactly the state a pre-0085 production DB could be
		// in, then re-run the migration's own cleanup+index SQL verbatim from
		// disk to prove it actually resolves that state rather than just
		// working on empty tables.
		await testDb.execute(
			sql`DROP INDEX IF EXISTS "tags_user_id_name_unique"`
		)

		const user = await createTestUser(testDb, "tags-migration-cleanup-user")
		const otherUser = await createTestUser(
			testDb,
			"tags-migration-cleanup-other-user"
		)

		// Seed 3 case/whitespace-variant duplicates for `user` — lowest id
		// ("Fantasy") is the expected keeper.
		const [keeper] = await testDb
			.insert(schema.tags)
			.values({ name: "Fantasy", userId: user.id, description: "keeper" })
			.returning()
		const [loser1] = await testDb
			.insert(schema.tags)
			.values({ name: "fantasy", userId: user.id })
			.returning()
		const [loser2] = await testDb
			.insert(schema.tags)
			.values({ name: " FANTASY ", userId: user.id })
			.returning()

		// An unrelated tag for a different user with the same name — must
		// survive untouched (per-user scoping).
		const [otherUserTag] = await testDb
			.insert(schema.tags)
			.values({ name: "Fantasy", userId: otherUser.id })
			.returning()

		// Two characters: one already has the keeper AND a loser attached
		// (exercises the DELETE-dedup branch); the other has only a loser
		// attached (exercises the UPDATE-repoint branch).
		const [charBoth] = await testDb
			.insert(schema.characters)
			.values({
				name: "Both-Tagged Char",
				description: "",
				userId: user.id
			})
			.returning()
		const [charLoserOnly] = await testDb
			.insert(schema.characters)
			.values({
				name: "Loser-Only Char",
				description: "",
				userId: user.id
			})
			.returning()

		await testDb.insert(schema.characterTags).values([
			{ characterId: charBoth.id, tagId: keeper.id },
			{ characterId: charBoth.id, tagId: loser1.id },
			{ characterId: charLoserOnly.id, tagId: loser2.id }
		])

		// Run the real migration file's cleanup + CREATE UNIQUE INDEX SQL,
		// verbatim, so this test tracks the actual migration content.
		const migrationSql = await fs.readFile(
			path.resolve(process.cwd(), "drizzle/0085_remarkable_quasimodo.sql"),
			"utf-8"
		)
		const statements = migrationSql
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean)
		for (const statement of statements) {
			await testDb.execute(sql.raw(statement))
		}

		// Only the keeper survives for `user`; other users' tags untouched.
		const userTags = await testDb.query.tags.findMany({
			where: (t, { eq }) => eq(t.userId, user.id)
		})
		expect(userTags.map((t) => t.id)).toEqual([keeper.id])
		expect(userTags[0].description).toBe("keeper")

		const otherUserTags = await testDb.query.tags.findMany({
			where: (t, { eq }) => eq(t.userId, otherUser.id)
		})
		expect(otherUserTags.map((t) => t.id)).toEqual([otherUserTag.id])

		// charBoth: still exactly one association, pointing at the keeper
		// (the duplicate loser1 association was dropped, not repointed into
		// a second row pointing at the keeper).
		const charBothTags = await testDb.query.characterTags.findMany({
			where: (ct, { eq }) => eq(ct.characterId, charBoth.id)
		})
		expect(charBothTags.map((ct) => ct.tagId)).toEqual([keeper.id])

		// charLoserOnly: its sole association was repointed onto the keeper.
		const charLoserOnlyTags = await testDb.query.characterTags.findMany({
			where: (ct, { eq }) => eq(ct.characterId, charLoserOnly.id)
		})
		expect(charLoserOnlyTags.map((ct) => ct.tagId)).toEqual([keeper.id])

		// The unique index now exists and actually enforces uniqueness again.
		await expect(
			testDb
				.insert(schema.tags)
				.values({ name: "FANTASY", userId: user.id })
		).rejects.toThrow()
	})
})
