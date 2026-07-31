import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import {
	backfillMissingBindingNames,
	resolveOrCreateBinding,
	syncLorebookBindingsForCharacter,
	syncLorebookBindingsForPersona
} from "./characterBindingSync"

let testDb: TestDb

beforeAll(async () => {
	testDb = await createTestDb()
}, 60_000)

async function getBinding(id: number) {
	return testDb.query.lorebookBindings.findFirst({
		where: eq(schema.lorebookBindings.id, id)
	})
}

describe("syncLorebookBindingsForCharacter", () => {
	test("propagates a character's current name/aliases to every bound row across multiple lorebooks", async () => {
		const user = await createTestUser(testDb, "sync-char-user")
		const [lorebookA] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book A", userId: user.id })
			.returning()
		const [lorebookB] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book B", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Old Name",
				description: "",
				aliases: ["Old Alias"]
			})
			.returning()
		const [bindingA] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebookA.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Old Name",
				aliases: ["Old Alias"]
			})
			.returning()
		const [bindingB] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebookB.id,
				characterId: character.id,
				binding: "{{char:2}}",
				name: "Old Name",
				aliases: ["Old Alias"]
			})
			.returning()
		// An unrelated unbound (background/NPC) row in the same lorebook —
		// must never be touched by a character-scoped sync.
		const [unrelated] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebookA.id,
				characterId: null,
				personaId: null,
				binding: "{{char:3}}",
				name: "Unrelated NPC",
				aliases: ["NPC Alias"]
			})
			.returning()

		await testDb
			.update(schema.characters)
			.set({ name: "New Name", nickname: "Newt", aliases: ["New Alias"] })
			.where(eq(schema.characters.id, character.id))

		await syncLorebookBindingsForCharacter(character.id, testDb)

		const afterA = await getBinding(bindingA.id)
		const afterB = await getBinding(bindingB.id)
		const afterUnrelated = await getBinding(unrelated.id)

		// resolveCharacterName prefers nickname over name.
		expect(afterA?.name).toBe("Newt")
		expect(afterA?.aliases).toEqual(["New Alias"])
		expect(afterB?.name).toBe("Newt")
		expect(afterB?.aliases).toEqual(["New Alias"])

		expect(afterUnrelated?.name).toBe("Unrelated NPC")
		expect(afterUnrelated?.aliases).toEqual(["NPC Alias"])
	})

	test("is a no-op when the character has no bound rows", async () => {
		const user = await createTestUser(testDb, "sync-char-noop-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Lonely", description: "" })
			.returning()
		// Should not throw even though nothing references this character.
		await expect(
			syncLorebookBindingsForCharacter(character.id, testDb)
		).resolves.toBeUndefined()
	})
})

describe("syncLorebookBindingsForPersona", () => {
	test("propagates a persona's current name/aliases to every bound row, leaving character-bound rows untouched", async () => {
		const user = await createTestUser(testDb, "sync-persona-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Persona Book", userId: user.id })
			.returning()
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Old Persona Name",
				description: "",
				aliases: [],
				isDefault: false
			})
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Untouched Character", description: "" })
			.returning()
		const [personaBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				personaId: persona.id,
				binding: "{{char:1}}",
				name: "Old Persona Name"
			})
			.returning()
		const [characterBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:2}}",
				name: "Untouched Character"
			})
			.returning()

		await testDb
			.update(schema.personas)
			.set({ name: "New Persona Name", aliases: ["Traveler"] })
			.where(eq(schema.personas.id, persona.id))

		await syncLorebookBindingsForPersona(persona.id, testDb)

		const afterPersona = await getBinding(personaBinding.id)
		const afterCharacter = await getBinding(characterBinding.id)

		expect(afterPersona?.name).toBe("New Persona Name")
		expect(afterPersona?.aliases).toEqual(["Traveler"])
		expect(afterCharacter?.name).toBe("Untouched Character")
	})
})

describe("resolveOrCreateBinding", () => {
	test("returns the existing binding id for a character already bound in this lorebook, without creating a duplicate", async () => {
		const user = await createTestUser(testDb, "resolve-existing-char-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Kestrel", description: "" })
			.returning()
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Kestrel"
			})
			.returning()

		const id = await resolveOrCreateBinding(
			{ lorebookId: lorebook.id, characterId: character.id },
			testDb
		)

		expect(id).toBe(binding.id)
		const all = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		expect(all).toHaveLength(1)
	})

	test("creates a new binding for a character with no existing binding in this lorebook, and syncs its name", async () => {
		const user = await createTestUser(testDb, "resolve-new-char-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Bram", description: "" })
			.returning()

		const id = await resolveOrCreateBinding(
			{ lorebookId: lorebook.id, characterId: character.id },
			testDb
		)

		const created = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, id)
		})
		expect(created?.characterId).toBe(character.id)
		expect(created?.name).toBe("Bram")
		expect(created?.binding).toBe("{{char:1}}")
	})

	test("creates a new binding for a persona the same way", async () => {
		const user = await createTestUser(testDb, "resolve-new-persona-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Traveler",
				description: "",
				aliases: [],
				isDefault: false
			})
			.returning()

		const id = await resolveOrCreateBinding(
			{ lorebookId: lorebook.id, personaId: persona.id },
			testDb
		)

		const created = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, id)
		})
		expect(created?.personaId).toBe(persona.id)
		expect(created?.name).toBe("Traveler")
	})

	test("throws when neither characterId nor personaId is given", async () => {
		const user = await createTestUser(testDb, "resolve-neither-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()

		await expect(
			resolveOrCreateBinding({ lorebookId: lorebook.id }, testDb)
		).rejects.toThrow(/characterId or personaId required/)
	})

	test("two concurrent calls for the same not-yet-bound character create only one binding, not two", async () => {
		const user = await createTestUser(testDb, "resolve-race-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Race Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Racer", description: "" })
			.returning()

		// Both calls race the same unguarded find-then-insert without the
		// advisory lock — this asserts the lock actually serializes them.
		const [idA, idB] = await Promise.all([
			resolveOrCreateBinding(
				{ lorebookId: lorebook.id, characterId: character.id },
				testDb
			),
			resolveOrCreateBinding(
				{ lorebookId: lorebook.id, characterId: character.id },
				testDb
			)
		])

		expect(idA).toBe(idB)

		const allBindings = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})
		expect(allBindings).toHaveLength(1)
	})
})

describe("backfillMissingBindingNames", () => {
	test("syncs the name for a bound row left NULL by a path that skipped sync (e.g. old imports)", async () => {
		const user = await createTestUser(testDb, "backfill-null-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Stale Name Char", description: "" })
			.returning()
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}"
				// name intentionally omitted — simulates the pre-fix import path
			})
			.returning()
		expect(binding.name).toBeFalsy()

		await backfillMissingBindingNames(testDb)

		const after = await getBinding(binding.id)
		expect(after?.name).toBe("Stale Name Char")
	})

	test("also backfills a persona-bound row left with an empty-string name", async () => {
		const user = await createTestUser(testDb, "backfill-empty-persona-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Backfilled Persona",
				description: "",
				aliases: [],
				isDefault: false
			})
			.returning()
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				personaId: persona.id,
				binding: "{{char:1}}",
				name: ""
			})
			.returning()

		await backfillMissingBindingNames(testDb)

		const after = await getBinding(binding.id)
		expect(after?.name).toBe("Backfilled Persona")
	})

	test("leaves an already-named bound row and an unbound (background/NPC) row untouched", async () => {
		const user = await createTestUser(testDb, "backfill-untouched-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Already Synced", description: "" })
			.returning()
		const [namedBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Already Synced"
			})
			.returning()
		const [npcBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: null,
				personaId: null,
				binding: "{{char:2}}",
				name: ""
			})
			.returning()

		// Should not throw or touch the unbound row despite its blank name —
		// only characterId/personaId-bound rows are ever in scope.
		await expect(
			backfillMissingBindingNames(testDb)
		).resolves.toBeUndefined()

		expect((await getBinding(namedBinding.id))?.name).toBe(
			"Already Synced"
		)
		expect((await getBinding(npcBinding.id))?.name).toBe("")
	})

	test("is idempotent — running it twice in a row is harmless", async () => {
		const user = await createTestUser(testDb, "backfill-idempotent-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Idempotent Char", description: "" })
			.returning()
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: character.id,
			binding: "{{char:1}}"
		})

		await backfillMissingBindingNames(testDb)
		await expect(
			backfillMissingBindingNames(testDb)
		).resolves.toBeUndefined()
	})
})
