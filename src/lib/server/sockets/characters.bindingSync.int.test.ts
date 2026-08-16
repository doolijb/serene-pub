/**
 * Name/alias sync regression (merge plan decision 2): editing a
 * character's/persona's name (or nickname/aliases) must propagate to every
 * lorebookBindings row it's bound to, across every lorebook — not just the
 * one-off data-migration script, but the live characters:update/
 * personas:update handlers themselves. Confirmed missing entirely before
 * this fix (neither handler called the sync helper), so a rename never
 * reached bound rows outside of the historical migration.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-binding-sync-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

describe("charactersUpdate — bound binding sync (PGlite integration)", () => {
	test("renaming a character propagates to its bound lorebookBindings row", async () => {
		const { charactersUpdate } = await import("./characters")
		const { createCharacterFromParsedData } = await import("./characters")
		const user = await makeUser("char-sync-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Sync Test Book", userId: user.id })
			.returning()
		const character = await createCharacterFromParsedData(
			{
				name: "Original Name",
				description: "",
				personality: "",
				scenario: "",
				first_mes: "",
				mes_example: "",
				creator_notes: "",
				system_prompt: "",
				post_history_instructions: "",
				alternate_greetings: [],
				tags: [],
				creator: "",
				character_version: "",
				extensions: {}
			} as any,
			undefined,
			user.id
		)
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Original Name"
			})
			.returning()

		await charactersUpdate.handler(
			fakeSocket(user.id),
			{
				character: {
					id: character.id,
					name: "Renamed Character",
					nickname: "Ren"
				} as any
			},
			noopEmit
		)

		const afterBinding = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, binding.id)
		})
		// resolveCharacterName prefers nickname over name.
		expect(afterBinding?.name).toBe("Ren")
	})
})

describe("personasUpdate — bound binding sync (PGlite integration)", () => {
	test("renaming a persona propagates to its bound lorebookBindings row", async () => {
		const { personasUpdate } = await import("./personas")
		const { createPersonaFromParsedData } = await import("./personas")
		const user = await makeUser("persona-sync-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Persona Sync Book", userId: user.id })
			.returning()
		const persona = await createPersonaFromParsedData(
			{ name: "Original Persona", description: "A persona" } as any,
			undefined,
			user.id
		)
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				personaId: persona.id,
				binding: "{{char:1}}",
				name: "Original Persona"
			})
			.returning()

		await personasUpdate.handler(
			fakeSocket(user.id),
			{
				persona: {
					id: persona.id,
					name: "Renamed Persona"
				} as any
			},
			noopEmit
		)

		const afterBinding = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, binding.id)
		})
		expect(afterBinding?.name).toBe("Renamed Persona")
	})
})
