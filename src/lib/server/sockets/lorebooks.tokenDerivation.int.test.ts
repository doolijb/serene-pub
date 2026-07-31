/**
 * Token-collision regression (merge plan decision 1): a lorebookBindings
 * row's {{char:N}} token must always be derived from its own real,
 * never-reused Postgres identity id — never a recomputed max/count over
 * existing rows. The old scheme silently reused a deleted binding's number
 * for a later-created row, colliding with that old number still baked into
 * stored lore/history content. This exercises createLorebookBindingHandler,
 * one of the three call sites the plan identified as buggy.
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
		path.join(os.tmpdir(), "serene-pub-lorebooks-token-int-test-")
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

describe("createLorebookBindingHandler — token derivation (PGlite integration)", () => {
	test("a create -> delete -> create cycle never reuses the deleted row's token", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("token-cycle-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Token Test Book", userId: user.id })
			.returning()

		const first = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: null,
					personaId: null,
					name: "First NPC"
				} as any
			},
			noopEmit
		)
		const firstId = first.lorebookBinding.id
		// Numbers are per-lorebook (see the per-lorebook counter redesign) —
		// the very first binding in a fresh lorebook always gets {{char:1}},
		// regardless of the row's own global id.
		expect(first.lorebookBinding.binding).toBe("{{char:1}}")

		// Simulate the row being deleted (as the UI would after the user
		// removes it) — the old max/count-based scheme would then hand the
		// next-created row this exact number back.
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, firstId))

		const second = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: null,
					personaId: null,
					name: "Second NPC"
				} as any
			},
			noopEmit
		)
		const secondId = second.lorebookBinding.id

		expect(secondId).not.toBe(firstId)
		// The per-lorebook counter keeps advancing regardless of the delete —
		// number 1 is never handed out again in this lorebook.
		expect(second.lorebookBinding.binding).toBe("{{char:2}}")
	})

	test("binding numbers are scoped per lorebook, not shared globally — two different lorebooks both start at {{char:1}}", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("token-scope-user")
		const [lorebookA] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book A", userId: user.id })
			.returning()
		const [lorebookB] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Book B", userId: user.id })
			.returning()

		const inA = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebookA.id,
					characterId: null,
					personaId: null,
					name: "NPC in A"
				} as any
			},
			noopEmit
		)
		const inB = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebookB.id,
					characterId: null,
					personaId: null,
					name: "NPC in B"
				} as any
			},
			noopEmit
		)

		expect(inA.lorebookBinding.binding).toBe("{{char:1}}")
		expect(inB.lorebookBinding.binding).toBe("{{char:1}}")

		// A second binding in A advances only A's counter — B is unaffected.
		const secondInA = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebookA.id,
					characterId: null,
					personaId: null,
					name: "Second NPC in A"
				} as any
			},
			noopEmit
		)
		expect(secondInA.lorebookBinding.binding).toBe("{{char:2}}")
	})

	test("ignores a client-supplied binding token, but accepts a client-supplied name/aliases for an unbound row", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("token-trust-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Trust Test Book", userId: user.id })
			.returning()

		const res = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: null,
					personaId: null,
					name: "Client-Supplied Name",
					binding: "{{char:999}}",
					aliases: ["Client Alias"]
				} as any
			},
			noopEmit
		)

		// A fresh lorebook's first binding always gets {{char:1}} from the
		// per-lorebook counter — never the client-supplied {{char:999}}.
		expect(res.lorebookBinding.binding).toBe("{{char:1}}")
		// Unbound rows have no entity to sync from — the client-supplied
		// name/aliases are the only way to set them, so they must pass
		// through untouched.
		expect(res.lorebookBinding.name).toBe("Client-Supplied Name")
		expect(res.lorebookBinding.aliases).toEqual(["Client Alias"])
	})

	test("ignores a client-supplied name/aliases when the row is bound to a real character", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const { createCharacterFromParsedData } = await import(
			"./characters"
		)
		const user = await makeUser("token-bound-trust-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Bound Trust Book", userId: user.id })
			.returning()
		const character = await createCharacterFromParsedData(
			{
				name: "Real Character",
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

		const res = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: character.id,
					personaId: null,
					name: "Client-Supplied Name",
					aliases: ["Client Alias"]
				} as any
			},
			noopEmit
		)

		// A bound row's name/aliases only ever come from the entity sync —
		// the client-supplied values must never win.
		expect(res.lorebookBinding.name).toBe("Real Character")
		expect(res.lorebookBinding.aliases).not.toEqual(["Client Alias"])
	})

	test("updateLorebookBindingHandler accepts a name change for an unbound row but rejects it once the row is bound", async () => {
		const { createLorebookBindingHandler, updateLorebookBindingHandler } =
			await import("./lorebooks")
		const { createCharacterFromParsedData } = await import(
			"./characters"
		)
		const user = await makeUser("update-name-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Update Name Book", userId: user.id })
			.returning()

		const created = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: null,
					personaId: null,
					name: "Original NPC Name"
				} as any
			},
			noopEmit
		)
		const bindingId = created.lorebookBinding.id

		const renamed = await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					id: bindingId,
					name: "Updated NPC Name"
				} as any
			},
			noopEmit
		)
		expect(renamed.lorebookBinding.name).toBe("Updated NPC Name")

		const character = await createCharacterFromParsedData(
			{
				name: "Now Bound Character",
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

		const attached = await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					id: bindingId,
					characterId: character.id,
					name: "Attempted Override Name"
				} as any
			},
			noopEmit
		)
		// Attaching a character in the same call syncs the name from the
		// entity — the client-supplied override must never win.
		expect(attached.lorebookBinding.name).toBe("Now Bound Character")
	})
})
