/**
 * Proactive duplicate-detection regression (merge plan, "2a. Proactive
 * duplicate detection"). Candidate scope must include a bound+unbound pair
 * — an unbound "ghost" duplicating a bound character is the single most
 * common real duplicate and the whole motivation for this feature, so
 * restricting detection to unbound-vs-unbound pairs would miss it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import {
	findDuplicateCandidates,
	MAX_BINDINGS_FOR_DUPLICATE_DETECTION
} from "./duplicateBindingDetection"

let testDb: TestDb

beforeAll(async () => {
	testDb = await createTestDb()
}, 60_000)

async function makeLorebook(userId: number, name = "Test Book") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

async function makeBinding(
	lorebookId: number,
	overrides: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "", ...overrides })
		.returning()
	return binding
}

describe("findDuplicateCandidates", () => {
	test("flags a bound + unbound pair with matching names — the primary motivating case", async () => {
		const user = await createTestUser(testDb, "dup-bound-unbound-user")
		const lorebook = await makeLorebook(user.id)
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Bram", description: "" })
			.returning()
		const bound = await makeBinding(lorebook.id, {
			characterId: character.id,
			binding: "{{char:1}}",
			name: "Bram"
		})
		const unbound = await makeBinding(lorebook.id, {
			binding: "{{char:2}}",
			name: "Bram",
			aliases: ["the Blacksmith"]
		})

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)

		expect(candidates).toHaveLength(1)
		expect(
			[candidates[0].bindingIdA, candidates[0].bindingIdB].sort()
		).toEqual([bound.id, unbound.id].sort())
	})

	test("never flags two bound rows, even with identical names", async () => {
		const user = await createTestUser(testDb, "dup-both-bound-user")
		const lorebook = await makeLorebook(user.id)
		const [charA] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Twin", description: "" })
			.returning()
		const [charB] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Twin", description: "" })
			.returning()
		await makeBinding(lorebook.id, {
			characterId: charA.id,
			binding: "{{char:1}}",
			name: "Twin"
		})
		await makeBinding(lorebook.id, {
			characterId: charB.id,
			binding: "{{char:2}}",
			name: "Twin"
		})

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		expect(candidates).toHaveLength(0)
	})

	test("does not flag a pair with no name/alias similarity", async () => {
		const user = await createTestUser(testDb, "dup-nomatch-user")
		const lorebook = await makeLorebook(user.id)
		await makeBinding(lorebook.id, { binding: "{{char:1}}", name: "Aria" })
		await makeBinding(lorebook.id, { binding: "{{char:2}}", name: "Bram" })

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		expect(candidates).toHaveLength(0)
	})

	test("does not flag a pair that already has a relationship between them", async () => {
		const user = await createTestUser(testDb, "dup-related-user")
		const lorebook = await makeLorebook(user.id)
		const a = await makeBinding(lorebook.id, {
			binding: "{{char:1}}",
			name: "Bram"
		})
		const b = await makeBinding(lorebook.id, {
			binding: "{{char:2}}",
			name: "Bram"
		})
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: a.id,
			toNodeId: b.id,
			relationshipType: "ally"
		})

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		expect(candidates).toHaveLength(0)
	})

	test("does not re-flag a dismissed pair", async () => {
		const user = await createTestUser(testDb, "dup-dismissed-user")
		const lorebook = await makeLorebook(user.id)
		const a = await makeBinding(lorebook.id, {
			binding: "{{char:1}}",
			name: "Bram"
		})
		const b = await makeBinding(lorebook.id, {
			binding: "{{char:2}}",
			name: "Bram"
		})
		await testDb.insert(schema.dismissedDuplicatePairs).values({
			lorebookId: lorebook.id,
			bindingIdA: Math.min(a.id, b.id),
			bindingIdB: Math.max(a.id, b.id)
		})

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		expect(candidates).toHaveLength(0)
	})

	test("matches via absorbedAliases as well as aliases", async () => {
		const user = await createTestUser(testDb, "dup-absorbedalias-user")
		const lorebook = await makeLorebook(user.id)
		await makeBinding(lorebook.id, {
			binding: "{{char:1}}",
			name: "The Blacksmith"
		})
		await makeBinding(lorebook.id, {
			binding: "{{char:2}}",
			name: "Someone Else",
			absorbedAliases: ["The Blacksmith"]
		})

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		expect(candidates).toHaveLength(1)
	})

	// Round-7 audit fix: the nested-loop scan is O(n^2) with a fuzzy match
	// per pair — unbounded, this blocks every connected user's socket
	// handling on a lorebook with a few thousand bindings (lorebook imports
	// already allow up to 5000). Above the cap, detection is skipped
	// entirely (returns []) rather than run.
	test("skips detection entirely once binding count exceeds the cap, without running the nested loop", async () => {
		const user = await createTestUser(testDb, "dup-over-cap-user")
		const lorebook = await makeLorebook(user.id)
		const rows = Array.from(
			{ length: MAX_BINDINGS_FOR_DUPLICATE_DETECTION + 1 },
			(_, i) => ({
				lorebookId: lorebook.id,
				binding: `{{char:${i}}}`,
				// Identical names — if the cap didn't engage, this would be
				// the worst case for the nested loop AND would produce a huge
				// number of candidates.
				name: "Duplicate"
			})
		)
		await testDb.insert(schema.lorebookBindings).values(rows)

		const start = Date.now()
		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		const elapsedMs = Date.now() - start

		expect(candidates).toEqual([])
		// A coarse "didn't actually run the O(n^2) fuzzy match" signal —
		// the skip path is a single length check + early return.
		expect(elapsedMs).toBeLessThan(1000)
	})

	test("still runs normally at exactly the cap", async () => {
		const user = await createTestUser(testDb, "dup-at-cap-user")
		const lorebook = await makeLorebook(user.id)
		// Distinct, mutually non-matching filler names — a shared prefix like
		// "Filler N" would fuzzy-match its neighbors under namesMatch()'s
		// Levenshtein check and pollute the candidate count this test is
		// asserting on.
		const { randomUUID } = await import("crypto")
		const rows = Array.from(
			{ length: MAX_BINDINGS_FOR_DUPLICATE_DETECTION - 2 },
			(_, i) => ({
				lorebookId: lorebook.id,
				binding: `{{char:${i}}}`,
				name: randomUUID()
			})
		)
		await testDb.insert(schema.lorebookBindings).values(rows)
		await testDb.insert(schema.lorebookBindings).values([
			{ lorebookId: lorebook.id, binding: "{{char:a}}", name: "Bram" },
			{ lorebookId: lorebook.id, binding: "{{char:b}}", name: "Bram" }
		])

		const candidates = await findDuplicateCandidates(lorebook.id, testDb)
		expect(candidates).toHaveLength(1)
	})
})
