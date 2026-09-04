/**
 * Round-13 audit fix (HIGH): userSettings had no unique constraint on
 * userId, unlike every structurally-identical singleton-per-user table
 * (passphrases, setup). Every "find or create" call site (8 total, across
 * userSettings.ts/promptConfigs.ts/contextConfigs.ts/narratorPromptConfigs.ts/
 * summarizePromptConfigs.ts x3/defaults.ts) did findFirst -> if none,
 * insert -> then an unconditional UPDATE ... WHERE userId = X. Two
 * concurrent calls for the same brand-new user could both pass the
 * findFirst check and both insert, producing two rows. Fixed with a
 * unique index on userId, plus onConflictDoNothing() at every insert call
 * site (safe: none of them read the insert's own return value — the
 * update/re-fetch that follows is always keyed by userId, not by
 * anything the insert returned).
 */
import { describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "./schema"
import { createTestDb, createTestUser, type TestDb } from "../utils/testDb"

// Each test builds a fresh DB — real work, not a statement about how fast
// that should be — so the 5s default fails under load, not on merit.
vi.setConfig({ testTimeout: 60_000 })

async function makeTestDb(): Promise<TestDb> {
	return createTestDb()
}

describe("userSettings — unique constraint on userId", () => {
	test("a raw duplicate insert for the same user is rejected by the DB", async () => {
		const testDb = await makeTestDb()
		const user = await createTestUser(testDb, "usersettings-unique-user")

		await testDb.insert(schema.userSettings).values({ userId: user.id })

		await expect(
			testDb.insert(schema.userSettings).values({ userId: user.id })
		).rejects.toThrow()
	})

	test("concurrent onConflictDoNothing() inserts for the same new user converge to exactly one row", async () => {
		const testDb = await makeTestDb()
		const user = await createTestUser(testDb, "usersettings-race-user")

		// Simulates the actual race: two concurrent "find or create" calls
		// both see no existing row (skipped here — the point under test is
		// what happens when both then try to insert), both attempt an
		// insert. Before this fix, the second insert would succeed too,
		// producing two rows for one user.
		await Promise.all([
			testDb
				.insert(schema.userSettings)
				.values({ userId: user.id, theme: "hamlindigo" })
				.onConflictDoNothing(),
			testDb
				.insert(schema.userSettings)
				.values({ userId: user.id, theme: "hamlindigo" })
				.onConflictDoNothing()
		])

		const rows = await testDb.query.userSettings.findMany({
			where: (t, { eq }) => eq(t.userId, user.id)
		})
		expect(rows.length).toBe(1)
	})

	test("the subsequent unconditional UPDATE still lands correctly regardless of which concurrent insert won", async () => {
		const testDb = await makeTestDb()
		const user = await createTestUser(
			testDb,
			"usersettings-race-update-user"
		)

		await Promise.all([
			testDb
				.insert(schema.userSettings)
				.values({ userId: user.id })
				.onConflictDoNothing(),
			testDb
				.insert(schema.userSettings)
				.values({ userId: user.id })
				.onConflictDoNothing()
		])

		// The real call sites always follow the insert with an unconditional
		// UPDATE keyed by userId (not by anything the insert returned) —
		// this must land on the single deduplicated row regardless of which
		// concurrent insert actually committed it.
		await testDb
			.update(schema.userSettings)
			.set({ darkMode: false })
			.where(eq(schema.userSettings.userId, user.id))

		const rows = await testDb.query.userSettings.findMany({
			where: (t, { eq }) => eq(t.userId, user.id)
		})
		expect(rows.length).toBe(1)
		expect(rows[0].darkMode).toBe(false)
	})
})
