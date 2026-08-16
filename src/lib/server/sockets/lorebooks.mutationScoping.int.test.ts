/**
 * Round-3 audit fixes, lorebook lane:
 *  - 1a: lorebooks:update used to `.set(params.lorebook)` wholesale —
 *    userId/nextBindingNumber/uuid were all writable, which could donate a
 *    lorebook into another account or rewind the binding-token counter
 *    (invalidating past merge logs' restore-safety proof — see
 *    deriveNextBindingToken). Now an explicit allowlist.
 *  - 1b: syncLorebookBindings used to delete a binding whenever its token
 *      text wasn't found in stored content — the same false-positive "ghost"
 *      heuristic already removed from the graph-rebuild path this session.
 *      Also: the surviving auto-create half now advances
 *      lorebooks.nextBindingNumber past any found-in-content token number,
 *      closing the one remaining collision path.
 *  - 1c: worldLoreEntries:update / historyEntries:update /
 *      lorebooks:updateBinding used to let a client relocate their own
 *      entry/binding into a lorebook they don't own via an unstripped
 *      lorebookId in the update payload.
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
		path.join(os.tmpdir(), "serene-pub-lorebooks-scoping-int-test-")
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

async function makeLorebook(userId: number, name = "Test Book") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

describe("lorebooks:update — mass-assignment (PGlite integration)", () => {
	test("ignores a foreign userId and an altered nextBindingNumber in the payload", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const owner = await makeUser("lorebooks-update-owner")
		const attacker = await makeUser("lorebooks-update-attacker")
		const lorebook = await makeLorebook(owner.id, "Owner's Book")

		const res = await lorebooksUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				lorebook: {
					id: lorebook.id,
					name: "Renamed",
					userId: attacker.id,
					nextBindingNumber: 9999,
					uuid: "11111111-1111-1111-1111-111111111111"
				} as any
			},
			noopEmit
		)

		expect(res.lorebook.name).toBe("Renamed")
		expect(res.lorebook.userId).toBe(owner.id)
		expect(res.lorebook.nextBindingNumber).toBe(1)
		expect(res.lorebook.uuid).not.toBe(
			"11111111-1111-1111-1111-111111111111"
		)
	})
})

describe("syncLorebookBindings — never deletes (PGlite integration)", () => {
	test("a binding whose token is no longer present in content survives", async () => {
		const { syncLorebookBindings } = await import("./lorebooks")
		const user = await makeUser("sync-survive-user")
		const lorebook = await makeLorebook(user.id, "Sync Survive Book")
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:1}}",
				name: "Ghost NPC"
			})
			.returning()
		// No world/character/history entry references {{char:1}} anywhere.

		await syncLorebookBindings({ lorebookId: lorebook.id })

		const stillThere = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, binding.id)
		})
		expect(stillThere).toBeDefined()
	})

	test("auto-creating a binding for a found token advances nextBindingNumber past it", async () => {
		const { syncLorebookBindings } = await import("./lorebooks")
		const user = await makeUser("sync-advance-user")
		const lorebook = await makeLorebook(user.id, "Sync Advance Book")
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "Entry",
			content: "Mentions {{char:50}} here.",
			keys: ""
		})

		await syncLorebookBindings({ lorebookId: lorebook.id })

		const createdBinding = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.binding, "{{char:50}}")
		})
		expect(createdBinding).toBeDefined()

		const updatedLorebook = await testDb.query.lorebooks.findFirst({
			where: eq(schema.lorebooks.id, lorebook.id)
		})
		// Must be > 50, not left at its default of 1 — otherwise a future
		// deriveNextBindingToken call could reissue {{char:50}}, silently
		// duplicating the token this test just created.
		expect(updatedLorebook!.nextBindingNumber).toBeGreaterThan(50)
	})
})

describe("cross-lorebook relocation via update — scoping (PGlite integration)", () => {
	test("worldLoreEntries:update ignores a foreign lorebookId", async () => {
		const { updateWorldLoreEntryHandler } = await import(
			"./worldLoreEntries"
		)
		const owner = await makeUser("wle-scope-owner")
		const ownLorebook = await makeLorebook(owner.id, "Own Book")
		const foreignLorebook = await makeLorebook(owner.id, "Foreign Book")
		const [entry] = await testDb
			.insert(schema.worldLoreEntries)
			.values({ lorebookId: ownLorebook.id, name: "Entry", content: "" })
			.returning()

		const res = await updateWorldLoreEntryHandler.handler(
			fakeSocket(owner.id),
			{
				worldLoreEntry: {
					id: entry.id,
					lorebookId: foreignLorebook.id,
					content: "updated"
				} as any
			},
			noopEmit
		)

		expect(res.worldLoreEntry.lorebookId).toBe(ownLorebook.id)
		expect(res.worldLoreEntry.content).toBe("updated")
	})

	test("historyEntries:update ignores a foreign lorebookId", async () => {
		const { updateHistoryEntryHandler } = await import("./historyEntries")
		const owner = await makeUser("he-scope-owner")
		const ownLorebook = await makeLorebook(owner.id, "Own History Book")
		const foreignLorebook = await makeLorebook(
			owner.id,
			"Foreign History Book"
		)
		const [entry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: ownLorebook.id })
			.returning()

		const res = await updateHistoryEntryHandler.handler(
			fakeSocket(owner.id),
			{
				historyEntry: {
					id: entry.id,
					lorebookId: foreignLorebook.id
				} as any
			},
			noopEmit
		)

		expect(res.historyEntry.lorebookId).toBe(ownLorebook.id)
	})

	test("lorebooks:updateBinding ignores a foreign lorebookId", async () => {
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		const owner = await makeUser("binding-scope-owner")
		const ownLorebook = await makeLorebook(owner.id, "Own Binding Book")
		const foreignLorebook = await makeLorebook(
			owner.id,
			"Foreign Binding Book"
		)
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: ownLorebook.id,
				binding: "{{char:1}}",
				name: "NPC"
			})
			.returning()

		const res = await updateLorebookBindingHandler.handler(
			fakeSocket(owner.id),
			{
				lorebookBinding: {
					id: binding.id,
					lorebookId: foreignLorebook.id,
					summary: "updated summary"
				} as any
			},
			noopEmit
		)

		expect(res.lorebookBinding.lorebookId).toBe(ownLorebook.id)
	})
})
