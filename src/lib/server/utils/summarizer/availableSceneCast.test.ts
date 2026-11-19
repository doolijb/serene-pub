import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import {
	resolveCharacterRefs,
	resolveOrCreateBindingByName,
	type CastEntry
} from "./availableSceneCast"
import { insertCastMember } from "$lib/server/characters/versions"

let testDb: TestDb

// The seat readers import the app's own database lazily; it is the test's database, never a second one.
vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

async function makeLorebook(userId: number, name = "Test Book") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

/**
 * A tag of its own for each seeded member: one member per tag per book
 * (`lorebook_bindings_binding_unique`). Not a number, so it is never a cast
 * tag and never moves a book's counter.
 */
let seedTag = 0
async function makeBinding(
	lorebookId: number,
	overrides: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const binding = (
		await insertCastMember(testDb, {
			lorebookId,
			binding: `{{char:seed-${++seedTag}}}`,
			...overrides
		})
	).member
	return binding
}

describe("resolveCharacterRefs", () => {
	test("a name matching an existing cast entry resolves to that entry's id — no suggestion", () => {
		const castEntries: CastEntry[] = [
			{ name: "Aria Vance", aliases: [], id: 1 }
		]
		const result = resolveCharacterRefs([{ name: "Aria" }], castEntries)
		expect(result.ids).toEqual([1])
		expect(result.suggestedNames).toEqual([])
	})

	test("an unmatched name is returned as a suggestion, not created — castEntries is untouched", () => {
		const castEntries: CastEntry[] = []
		const result = resolveCharacterRefs(
			[{ name: "Bram the Blacksmith" }],
			castEntries
		)
		expect(result.ids).toEqual([])
		expect(result.suggestedNames).toEqual(["Bram the Blacksmith"])
		expect(castEntries).toEqual([])
	})

	test("the same unmatched name repeated across refs is deduped case-insensitively", () => {
		const castEntries: CastEntry[] = []
		const result = resolveCharacterRefs(
			[{ name: "Mysterious Stranger" }, { name: "mysterious stranger" }],
			castEntries
		)
		expect(result.suggestedNames).toEqual(["Mysterious Stranger"])
	})

	test("a castId reference resolves directly against the known cast, same as the creating variant", () => {
		const castEntries: CastEntry[] = [
			{ name: "Aria Vance", aliases: [], id: 1 }
		]
		const result = resolveCharacterRefs([{ castId: 1 }], castEntries)
		expect(result.ids).toEqual([1])
	})

	test("a castId that doesn't resolve against the known cast is skipped, not suggested", () => {
		const castEntries: CastEntry[] = []
		const result = resolveCharacterRefs([{ castId: 999999 }], castEntries)
		expect(result.ids).toEqual([])
		expect(result.suggestedNames).toEqual([])
	})
})


describe("resolveOrCreateBindingByName", () => {
	test("a name matching an existing binding resolves to its id — created:false, no new row", async () => {
		const user = await createTestUser(
			testDb,
			"resolve-or-create-known-user"
		)
		const lorebook = await makeLorebook(user.id)
		const binding = await makeBinding(lorebook.id, {
			name: "Aria Vance",
			binding: "{{char:1}}"
		})

		const result = await resolveOrCreateBindingByName(
			lorebook.id,
			"Aria",
			testDb
		)

		expect(result).toEqual({ id: binding.id, created: false })
		const rows = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		expect(rows).toHaveLength(1)
	})

	test("a name matching an existing alias resolves to its id, not a duplicate", async () => {
		const user = await createTestUser(
			testDb,
			"resolve-or-create-alias-user"
		)
		const lorebook = await makeLorebook(user.id)
		const binding = await makeBinding(lorebook.id, {
			name: "Bram",
			aliases: ["the Blacksmith"],
			binding: "{{char:1}}"
		})

		const result = await resolveOrCreateBindingByName(
			lorebook.id,
			"the Blacksmith",
			testDb
		)

		expect(result).toEqual({ id: binding.id, created: false })
	})

	test("an unmatched name creates exactly one new unbound binding", async () => {
		const user = await createTestUser(
			testDb,
			"resolve-or-create-unknown-user"
		)
		const lorebook = await makeLorebook(user.id)

		const result = await resolveOrCreateBindingByName(
			lorebook.id,
			"Brand New NPC",
			testDb
		)

		expect(result.created).toBe(true)
		const created = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, result.id)
		})
		expect(created?.name).toBe("Brand New NPC")
		// `personaId` is gone (0133): `characterId` null is now the whole
		// story for an unbound row.
		expect(created?.characterId).toBeNull()
	})

	test("two concurrent calls for the same unmatched name serialize to a single row", async () => {
		const user = await createTestUser(
			testDb,
			"resolve-or-create-concurrent-user"
		)
		const lorebook = await makeLorebook(user.id)

		const [a, b] = await Promise.all([
			resolveOrCreateBindingByName(lorebook.id, "Racing NPC", testDb),
			resolveOrCreateBindingByName(lorebook.id, "Racing NPC", testDb)
		])

		expect(a.id).toBe(b.id)
		expect([a.created, b.created].filter(Boolean)).toHaveLength(1)
		const rows = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		expect(rows).toHaveLength(1)
	})
})


