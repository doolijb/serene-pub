/**
 * Migration 0091's data conversion, exercised against realistic legacy data.
 *
 * Every other integration test runs the migration against an empty `scenes`
 * table, which proves the SQL parses but nothing about what it does to a real
 * lorebook. This one re-creates the pre-0091 shape (the two JSON columns),
 * seeds the three forms those columns could physically hold — binding ids,
 * pre-merge NAME STRINGS, and junk that resolves to nothing — then runs the
 * conversion statements verbatim and checks what survived.
 *
 * This is the only part of the join-table change that rewrites existing user
 * data irreversibly, so it gets a direct test rather than inference.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

beforeAll(async () => {
	testDb = await createTestDb()
	// Put back the columns 0091 dropped so we can seed them as they existed.
	await testDb.execute(
		sql`ALTER TABLE "scenes" ADD COLUMN "participant_characters" json NOT NULL DEFAULT '[]'::json`
	)
	await testDb.execute(
		sql`ALTER TABLE "scenes" ADD COLUMN "mentioned_characters" json NOT NULL DEFAULT '[]'::json`
	)
}, 60_000)

afterAll(async () => {
	await testDb.execute(sql`DROP TABLE IF EXISTS "scene_characters_probe"`)
})

/**
 * The migration runs exactly once against a freshly created table. These tests
 * share one database, so the table is cleared first — otherwise a later test's
 * conversion would re-process an earlier test's still-populated legacy columns
 * and collide on the unique index, which says nothing about the migration.
 */
async function runConversionOnce() {
	await testDb.execute(sql`DELETE FROM "scene_characters"`)
	await runConversion("participant")
	await runConversion("mentioned")
}

/** The conversion statements from drizzle/0091, verbatim in shape. */
async function runConversion(role: "participant" | "mentioned") {
	const column =
		role === "participant" ? "participant_characters" : "mentioned_characters"
	await testDb.execute(
		sql.raw(`
INSERT INTO "scene_characters" ("scene_id", "binding_id", "role", "ordinal")
WITH expanded AS (
	SELECT s."id" AS scene_id, s."lorebook_id" AS lorebook_id, e.val, e.ord
	FROM "scenes" s
	CROSS JOIN LATERAL json_array_elements(s."${column}") WITH ORDINALITY AS e(val, ord)
	WHERE json_typeof(s."${column}") = 'array'
),
matched AS (
	SELECT DISTINCT ON (x.scene_id, x.ord) x.scene_id, b."id" AS binding_id, x.ord
	FROM expanded x
	JOIN "lorebook_bindings" b ON b."lorebook_id" = x.lorebook_id AND (
		(json_typeof(x.val) = 'number' AND b."id" = (x.val #>> '{}')::int)
		OR (json_typeof(x.val) = 'string'
			AND btrim(b."name") <> ''
			AND lower(btrim(b."name")) = lower(btrim(x.val #>> '{}')))
	)
	ORDER BY x.scene_id, x.ord, b."id"
),
deduped AS (
	SELECT DISTINCT ON (scene_id, binding_id) scene_id, binding_id, ord
	FROM matched
	ORDER BY scene_id, binding_id, ord
)
SELECT scene_id, binding_id, '${role}', (ord - 1)::int FROM deduped;`)
	)
}

describe("migration 0091 — legacy cast conversion", () => {
	test("converts ids, resolves legacy name strings, and drops what cannot resolve", async () => {
		const user = await createTestUser(testDb, "cast-migration-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Legacy Book", userId: user.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const [aria] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:1}}",
				name: "Aria"
			})
			.returning()
		const [bram] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:2}}",
				name: "Bram"
			})
			.returning()
		// A binding in someone else's lorebook — must never be pulled in.
		const other = await createTestUser(testDb, "cast-migration-other")
		const [otherBook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Other", userId: other.id })
			.returning()
		const [foreign] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: otherBook.id,
				binding: "{{char:1}}",
				name: "Aria"
			})
			.returning()

		async function makeScene(participants: unknown[], mentioned: unknown[]) {
			const [row] = await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id
				})
				.returning()
			await testDb.execute(
				sql`UPDATE "scenes" SET "participant_characters" = ${JSON.stringify(participants)}::json, "mentioned_characters" = ${JSON.stringify(mentioned)}::json WHERE "id" = ${row.id}`
			)
			return row
		}

		// 1. Modern: real binding ids, deliberately not in ascending order.
		const idScene = await makeScene([bram.id, aria.id], [aria.id])
		// 2. Pre-merge: name strings, mixed case/whitespace.
		const nameScene = await makeScene(["aria", " Bram "], ["Aria"])
		// 3. Mixed, plus entries that cannot resolve: a deleted-binding id, a
		//    name nobody has, and a foreign-lorebook id.
		const messyScene = await makeScene(
			[aria.id, 999_999, "Nobody", foreign.id],
			[]
		)

		await runConversionOnce()

		const { readSceneCast } = await import("$lib/server/utils/sceneCast")

		// Ids convert as-is, and stored order is preserved — export bytes are
		// compared on re-import, so a reordered migration would mark every
		// lorebook conflicted.
		const idCast = await readSceneCast(idScene.id, testDb as any)
		expect(idCast.participantCharacters).toEqual([bram.id, aria.id])
		expect(idCast.mentionedCharacters).toEqual([aria.id])

		// Legacy names resolve case- and whitespace-insensitively. This is what
		// makes the separate "fix pre-merge scenes" tooling unnecessary.
		const nameCast = await readSceneCast(nameScene.id, testDb as any)
		expect(nameCast.participantCharacters).toEqual([aria.id, bram.id])
		expect(nameCast.mentionedCharacters).toEqual([aria.id])

		// Unresolvable entries are dropped rather than migrated — they could
		// not have been used anyway; every consumer already had to skip them.
		// The foreign id is dropped by the lorebook-scoped join specifically.
		const messyCast = await readSceneCast(messyScene.id, testDb as any)
		expect(messyCast.participantCharacters).toEqual([aria.id])
	})

	test("a binding in both arrays converts to both roles without violating the unique index", async () => {
		const user = await createTestUser(testDb, "cast-migration-both")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Both Roles", userId: user.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const [solo] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:9}}",
				name: "Solo"
			})
			.returning()
		const [row] = await testDb
			.insert(schema.scenes)
			.values({ lorebookId: lorebook.id, historyEntryId: historyEntry.id })
			.returning()
		await testDb.execute(
			sql`UPDATE "scenes" SET "participant_characters" = ${JSON.stringify([solo.id])}::json, "mentioned_characters" = ${JSON.stringify([solo.id])}::json WHERE "id" = ${row.id}`
		)

		await runConversionOnce()

		const { readSceneCast } = await import("$lib/server/utils/sceneCast")
		const cast = await readSceneCast(row.id, testDb as any)
		// Real, reachable data (absorb remaps each array independently), and
		// exactly why the unique index is on (scene, binding, ROLE) — a
		// role-less constraint would have failed this migration outright.
		expect(cast.participantCharacters).toEqual([solo.id])
		expect(cast.mentionedCharacters).toEqual([solo.id])
	})
})
