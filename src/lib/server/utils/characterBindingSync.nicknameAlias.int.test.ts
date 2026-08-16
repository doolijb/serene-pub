/**
 * A nickname shadows the real name everywhere downstream.
 *
 * `resolveCharacterName` prefers the nickname, so a bound lorebookBindings row
 * is named by it and the real name is recorded nowhere a matcher can see. That
 * is how a graph build proposed a brand-new "Commander Thorne" while the bound
 * character sat right there under a shorter label.
 *
 * The fix keeps the real name in the binding's `aliases` — as part of the
 * PROJECTION this sync already performs for `name`, not as a stored edit.
 *
 * A first attempt seeded `characters.aliases` in the character save handler
 * instead. That was a side-effect: it silently rewrote a user-owned field
 * during a save made for an unrelated reason, and needed nickname-change
 * detection so that deleting the alias would stick. Deriving it here removes
 * the whole category of problem — the column is recomputed on every sync, so
 * there is nothing to remember, nothing to fight, and no user data touched.
 * The last two tests pin exactly that.
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
let userId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-nickalias-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "nick-alias-user")).id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A character bound into a fresh lorebook. Returns both ids. */
async function bind(
	name: string,
	nickname: string | null,
	aliases: string[] = []
) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, nickname, description: "d", aliases })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `lb-${name}`, userId })
		.returning()
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{char:1}}",
			characterId: character.id
		})
		.returning()
	return { character, binding }
}

async function sync(characterId: number) {
	const { syncLorebookBindingsForCharacter } = await import(
		"./characterBindingSync"
	)
	await syncLorebookBindingsForCharacter(characterId, testDb as any)
}

async function bindingRow(id: number) {
	const [row] = await testDb
		.select({
			name: schema.lorebookBindings.name,
			aliases: schema.lorebookBindings.aliases
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, id))
	return row
}

describe("the binding projection keeps the real name findable", () => {
	test("a nickname names the binding, and the real name becomes an alias", async () => {
		const { character, binding } = await bind("Maren Thorne", "Maren")
		await sync(character.id)
		expect(await bindingRow(binding.id)).toEqual({
			name: "Maren",
			aliases: ["Maren Thorne"]
		})
	})

	test("a nickname that is a SUBSET of the name still yields the alias", async () => {
		// The case an over-clever guard gets wrong: "Kiran" matches "Kiran Vos"
		// by word-subset, so the alias looks redundant. It is not — the surname
		// is exactly what a scene saying "Vos" needs, and the binding is named
		// "Kiran".
		const { character, binding } = await bind("Kiran Vos", "Kiran")
		await sync(character.id)
		expect((await bindingRow(binding.id)).aliases).toEqual(["Kiran Vos"])
	})

	test("no nickname means no derived alias", async () => {
		const { character, binding } = await bind("Corbin Rook", null, ["Corb"])
		await sync(character.id)
		expect(await bindingRow(binding.id)).toEqual({
			name: "Corbin Rook",
			aliases: ["Corb"]
		})
	})

	test("the user's own aliases are preserved alongside the derived one", async () => {
		const { character, binding } = await bind("Rhea Marlin", "Rhea", [
			"The Officer"
		])
		await sync(character.id)
		expect((await bindingRow(binding.id)).aliases).toEqual([
			"The Officer",
			"Rhea Marlin"
		])
	})

	test("syncing repeatedly is stable — no accumulation", async () => {
		const { character, binding } = await bind("Aldric Vane", "Ric")
		await sync(character.id)
		await sync(character.id)
		await sync(character.id)
		expect((await bindingRow(binding.id)).aliases).toEqual(["Aldric Vane"])
	})

	test("characters.aliases is never written to — it is user data", async () => {
		// The whole point of deriving in the projection rather than seeding the
		// source: a save the user made for another reason must not silently
		// rewrite a field they own.
		const { character } = await bind("Brix Nine", "Brix")
		await sync(character.id)
		const [row] = await testDb
			.select({ aliases: schema.characters.aliases })
			.from(schema.characters)
			.where(eq(schema.characters.id, character.id))
		expect(row.aliases).toEqual([])
	})
})
