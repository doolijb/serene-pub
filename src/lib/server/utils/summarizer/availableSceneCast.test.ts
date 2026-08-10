import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { writeSceneCast } from "$lib/server/utils/sceneCast"
import {
	buildSceneCastList,
	MAX_BINDINGS_FOR_SCENE_CAST,
	reconcileParticipantsAndMentioned,
	reconcileSuggestedNames,
	resolveCharacterNamesToBindingIds,
	resolveCharacterRefs,
	resolveOrCreateBindingByName,
	type CastEntry
} from "./availableSceneCast"

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

async function makeHistoryEntry(
	lorebookId: number,
	overrides: Partial<typeof schema.historyEntries.$inferInsert> = {}
) {
	const [entry] = await testDb
		.insert(schema.historyEntries)
		.values({
			lorebookId,
			year: 1,
			month: 1,
			day: 1,
			content: "",
			keys: "",
			...overrides
		})
		.returning()
	return entry
}

async function makeScene(
	lorebookId: number,
	historyEntryId: number,
	overrides: Partial<typeof schema.scenes.$inferInsert> = {}
) {
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId,
			historyEntryId,
			name: "Scene",
			...overrides
		})
		.returning()
	return scene
}

async function makeBinding(
	lorebookId: number,
	overrides: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: "",
			...overrides
		})
		.returning()
	return binding
}

describe("resolveCharacterNamesToBindingIds", () => {
	test("a name matching an existing cast entry resolves to that entry's id — no duplicate binding created", async () => {
		const user = await createTestUser(testDb, "resolve-known-user")
		const lorebook = await makeLorebook(user.id)
		const binding = await makeBinding(lorebook.id, {
			name: "Aria Vance",
			binding: "{{char:1}}"
		})
		const castEntries: CastEntry[] = [
			{ name: "Aria Vance", aliases: [], id: binding.id }
		]

		const beforeCount = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		).length

		const ids = await resolveCharacterNamesToBindingIds(
			[{ name: "Aria" }], // fuzzy word-subset match against "Aria Vance"
			lorebook.id,
			castEntries,
			testDb
		)

		expect(ids).toEqual([binding.id])

		const afterCount = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		).length
		expect(afterCount).toBe(beforeCount)
	})

	test("an unrecognized name mints exactly one new unbound binding, with a token derived from its own id", async () => {
		const user = await createTestUser(testDb, "resolve-unknown-user")
		const lorebook = await makeLorebook(user.id)
		const castEntries: CastEntry[] = []

		const ids = await resolveCharacterNamesToBindingIds(
			[{ name: "Bram the Blacksmith" }],
			lorebook.id,
			castEntries,
			testDb
		)

		expect(ids).toHaveLength(1)
		const created = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, ids[0])
		})
		expect(created?.name).toBe("Bram the Blacksmith")
		expect(created?.characterId).toBeNull()
		expect(created?.personaId).toBeNull()
		// Token comes from the lorebook's own per-lorebook counter, not the
		// row's own global id — a fresh lorebook's first binding is always
		// {{char:1}}.
		expect(created?.binding).toBe("{{char:1}}")
		// castEntries is mutated in place so a repeated name later in the same
		// call resolves to the same row rather than minting a second one.
		expect(castEntries).toContainEqual({
			name: "Bram the Blacksmith",
			aliases: [],
			id: ids[0]
		})
	})

	test("the same unrecognized name repeated across participants+mentioned resolves to one row, not two", async () => {
		const user = await createTestUser(testDb, "resolve-repeat-user")
		const lorebook = await makeLorebook(user.id)
		const castEntries: CastEntry[] = []

		const firstCallIds = await resolveCharacterNamesToBindingIds(
			[{ name: "Mysterious Stranger" }],
			lorebook.id,
			castEntries,
			testDb
		)
		const secondCallIds = await resolveCharacterNamesToBindingIds(
			[{ name: "Mysterious Stranger" }],
			lorebook.id,
			castEntries,
			testDb
		)

		expect(secondCallIds).toEqual(firstCallIds)
	})

	test("a castId reference resolves directly against the known cast — no fuzzy matching, no duplicate", async () => {
		const user = await createTestUser(testDb, "resolve-castid-user")
		const lorebook = await makeLorebook(user.id)
		const binding = await makeBinding(lorebook.id, {
			name: "Aria Vance",
			binding: "{{char:1}}"
		})
		const castEntries: CastEntry[] = [
			{ name: "Aria Vance", aliases: [], id: binding.id }
		]

		const beforeCount = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		).length

		const ids = await resolveCharacterNamesToBindingIds(
			[{ castId: binding.id }],
			lorebook.id,
			castEntries,
			testDb
		)

		expect(ids).toEqual([binding.id])
		const afterCount = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		).length
		expect(afterCount).toBe(beforeCount)
	})

	test("a castId that doesn't resolve against the known cast (hallucinated/stale) is skipped, not fabricated", async () => {
		const user = await createTestUser(testDb, "resolve-badcastid-user")
		const lorebook = await makeLorebook(user.id)
		const castEntries: CastEntry[] = []

		const ids = await resolveCharacterNamesToBindingIds(
			[{ castId: 999999 }],
			lorebook.id,
			castEntries,
			testDb
		)

		expect(ids).toEqual([])
		const remaining = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		expect(remaining).toHaveLength(0)
	})

	test("a mix of castId and name references in one call resolves both correctly", async () => {
		const user = await createTestUser(testDb, "resolve-mixed-user")
		const lorebook = await makeLorebook(user.id)
		const binding = await makeBinding(lorebook.id, {
			name: "Kestrel",
			binding: "{{char:1}}"
		})
		const castEntries: CastEntry[] = [
			{ name: "Kestrel", aliases: [], id: binding.id }
		]

		const ids = await resolveCharacterNamesToBindingIds(
			[{ castId: binding.id }, { name: "Brand New NPC" }],
			lorebook.id,
			castEntries,
			testDb
		)

		expect(ids).toHaveLength(2)
		expect(ids).toContain(binding.id)
		const newId = ids.find((id) => id !== binding.id)!
		const created = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, newId)
		})
		expect(created?.name).toBe("Brand New NPC")
	})
})

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

describe("reconcileSuggestedNames", () => {
	test("a name suggested in both lists is kept only as a participant suggestion", () => {
		const result = reconcileSuggestedNames(["Guard Captain"], ["Guard Captain"])
		expect(result.participants).toEqual(["Guard Captain"])
		expect(result.mentioned).toEqual([])
	})

	test("dedup is case-insensitive", () => {
		const result = reconcileSuggestedNames(["Guard Captain"], ["guard captain"])
		expect(result.mentioned).toEqual([])
	})

	test("no overlap leaves both lists as given", () => {
		const result = reconcileSuggestedNames(["A"], ["B"])
		expect(result.participants).toEqual(["A"])
		expect(result.mentioned).toEqual(["B"])
	})
})

describe("resolveOrCreateBindingByName", () => {
	test("a name matching an existing binding resolves to its id — created:false, no new row", async () => {
		const user = await createTestUser(testDb, "resolve-or-create-known-user")
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
		const user = await createTestUser(testDb, "resolve-or-create-alias-user")
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
		expect(created?.characterId).toBeNull()
		expect(created?.personaId).toBeNull()
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

describe("buildSceneCastList", () => {
	test("chat characters/personas are merged in as priority entries, taking their binding's name when one exists", async () => {
		const user = await createTestUser(testDb, "cast-chat-user")
		const lorebook = await makeLorebook(user.id)
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Kestrel", description: "" })
			.returning()
		await makeBinding(lorebook.id, {
			characterId: character.id,
			name: "Kestrel",
			binding: "{{char:1}}"
		})
		const [chat] = await testDb
			.insert(schema.chats)
			.values({
				userId: user.id,
				name: "Test Chat",
				lorebookId: lorebook.id,
				isGroup: false
			})
			.returning()
		await testDb
			.insert(schema.chatCharacters)
			.values({ chatId: chat.id, characterId: character.id })

		const historyEntry = await makeHistoryEntry(lorebook.id)
		const scene = await makeScene(lorebook.id, historyEntry.id)

		const cast = await buildSceneCastList(scene.id, lorebook.id, chat.id, testDb)

		expect(cast).toHaveLength(1)
		expect(cast[0].name).toBe("Kestrel")
	})

	test("a background/NPC binding is only in scope once its own history position is at or before the current scene", async () => {
		const user = await createTestUser(testDb, "cast-timeline-user")
		const lorebook = await makeLorebook(user.id)
		const earlyEntry = await makeHistoryEntry(lorebook.id, { year: 1 })
		const lateEntry = await makeHistoryEntry(lorebook.id, { year: 10 })
		const earlyScene = await makeScene(lorebook.id, earlyEntry.id)
		const lateScene = await makeScene(lorebook.id, lateEntry.id)

		// An NPC introduced in the late scene.
		await makeBinding(lorebook.id, {
			name: "Late NPC",
			binding: "{{char:2}}",
			historyEntryId: lateEntry.id,
			sceneId: lateScene.id
		})

		const castForEarlyScene = await buildSceneCastList(
			earlyScene.id,
			lorebook.id,
			null,
			testDb
		)
		expect(castForEarlyScene.map((c) => c.name)).not.toContain("Late NPC")

		const castForLateScene = await buildSceneCastList(
			lateScene.id,
			lorebook.id,
			null,
			testDb
		)
		expect(castForLateScene.map((c) => c.name)).toContain("Late NPC")
	})

	test("a prior scene's stored ids need no name matching — the binding is already covered by the main sweep", async () => {
		const user = await createTestUser(testDb, "cast-prior-scene-user")
		const lorebook = await makeLorebook(user.id)
		const historyEntry = await makeHistoryEntry(lorebook.id)
		const priorScene = await makeScene(lorebook.id, historyEntry.id)
		const nextScene = await makeScene(lorebook.id, historyEntry.id, {
			name: "Next scene"
		})

		const npcBinding = await makeBinding(lorebook.id, {
			name: "Wandering Merchant",
			binding: "{{char:3}}",
			historyEntryId: historyEntry.id,
			sceneId: priorScene.id
		})
		await writeSceneCast(
			priorScene.id,
			{ participantCharacters: [npcBinding.id] },
			testDb as any
		)

		const cast = await buildSceneCastList(nextScene.id, lorebook.id, null, testDb)
		expect(cast.map((c) => c.id)).toContain(npcBinding.id)
	})

	test("with sceneId=null (a scene not yet created), every background/NPC binding is included regardless of timeline", async () => {
		const user = await createTestUser(testDb, "cast-null-scene-user")
		const lorebook = await makeLorebook(user.id)
		const lateEntry = await makeHistoryEntry(lorebook.id, { year: 99 })
		const lateScene = await makeScene(lorebook.id, lateEntry.id)
		await makeBinding(lorebook.id, {
			name: "Far Future NPC",
			binding: "{{char:4}}",
			historyEntryId: lateEntry.id,
			sceneId: lateScene.id
		})

		const cast = await buildSceneCastList(null, lorebook.id, null, testDb)
		expect(cast.map((c) => c.name)).toContain("Far Future NPC")
	})
})

describe("reconcileParticipantsAndMentioned", () => {
	test("unions sender ids into participants", () => {
		const result = reconcileParticipantsAndMentioned([1], [], [2, 3])
		expect(new Set(result.participants)).toEqual(new Set([1, 2, 3]))
		expect(result.mentioned).toEqual([])
	})

	test("a sender who is also LLM-extracted as a participant isn't duplicated", () => {
		const result = reconcileParticipantsAndMentioned([1, 2], [], [2])
		expect(result.participants.sort()).toEqual([1, 2])
	})

	test("a sender the LLM placed in mentioned is promoted to participant-only", () => {
		const result = reconcileParticipantsAndMentioned([1], [2], [2])
		expect(new Set(result.participants)).toEqual(new Set([1, 2]))
		expect(result.mentioned).toEqual([])
	})

	test("the LLM double-listing a non-sender in both arrays still ends up participant-only — the general invariant, not just sender-derived removal", () => {
		// id 5 is in both LLM-extracted lists but was never a message sender
		// at all (senderBindingIds is empty) — the fix must still remove it
		// from mentioned because it's already a participant, not because it
		// was auto-added.
		const result = reconcileParticipantsAndMentioned([1, 5], [5, 9], [])
		expect(new Set(result.participants)).toEqual(new Set([1, 5]))
		expect(result.mentioned).toEqual([9])
	})

	test("no senders and no overlap leaves both lists as the LLM produced them", () => {
		const result = reconcileParticipantsAndMentioned([1], [2], [])
		expect(result.participants).toEqual([1])
		expect(result.mentioned).toEqual([2])
	})

	test("empty participants + only senders still produces a full participant list", () => {
		const result = reconcileParticipantsAndMentioned([], [], [7, 8])
		expect(new Set(result.participants)).toEqual(new Set([7, 8]))
	})
})

// Round-12 audit fix (MEDIUM): mergeIntoExisting is O(entries) per call,
// and buildSceneCastList called it once per binding — net O(n^2)
// Levenshtein-based fuzzy matching with no cap, unlike the sibling
// duplicateBindingDetection.ts. Fixed by skipping the fuzzy-dedup scan
// (not the whole function) above MAX_BINDINGS_FOR_SCENE_CAST bindings.
describe("buildSceneCastList — fuzzy-dedup cap (Round-12 audit fix)", () => {
	test("above the cap, returns every binding without throwing/hanging and logs a warning", async () => {
		const user = await createTestUser(
			testDb,
			"scenecast-cap-over-user"
		)
		const lorebook = await makeLorebook(user.id, "Cap Over Book")

		const total = MAX_BINDINGS_FOR_SCENE_CAST + 1
		await testDb.insert(schema.lorebookBindings).values(
			Array.from({ length: total }, (_, i) => ({
				lorebookId: lorebook.id,
				binding: `{{char:${i + 1}}}`,
				name: `NPC ${i + 1}`
			}))
		)

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const cast = await buildSceneCastList(
			null,
			lorebook.id,
			null,
			testDb
		)

		expect(cast).toHaveLength(total)
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("skipping fuzzy dedup")
		)
		warnSpy.mockRestore()
	})

	test("under the cap, fuzzy dedup still collapses near-duplicate names as before", async () => {
		const user = await createTestUser(
			testDb,
			"scenecast-cap-under-user"
		)
		const lorebook = await makeLorebook(user.id, "Cap Under Book")

		await testDb.insert(schema.lorebookBindings).values([
			{
				lorebookId: lorebook.id,
				binding: "{{char:1}}",
				name: "Jonathan"
			},
			{
				// A near-duplicate (fuzzy match) of the row above — must
				// still collapse into one entry when under the cap.
				lorebookId: lorebook.id,
				binding: "{{char:2}}",
				name: "Jonathon"
			}
		])

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const cast = await buildSceneCastList(
			null,
			lorebook.id,
			null,
			testDb
		)

		expect(warnSpy).not.toHaveBeenCalled()
		expect(cast).toHaveLength(1)
		warnSpy.mockRestore()
	})
})
