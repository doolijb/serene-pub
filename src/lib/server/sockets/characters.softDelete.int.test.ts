/**
 * Round-13 audit fix (HIGH): characters:delete did a real DELETE FROM
 * characters, cascading chatMessages.characterId -> SET NULL with no name
 * snapshot — every historical message that character ever authored
 * permanently fell back to the generic "assistant" label
 * (resolveCharacterName()). personas.isDeleted already implements a real
 * soft delete (personasDelete/personasList/personasGet); characters.isDeleted
 * existed in the schema but was dead code. Fixed by mirroring the persona
 * pattern exactly: soft delete, hide from list/get, leave existing
 * bindings/messages/roster entries untouched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		path.join(os.tmpdir(), "serene-pub-character-softdelete-int-test-")
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

describe("characters:delete — soft delete (PGlite integration)", () => {
	test("the character row survives with isDeleted: true, not a real DELETE", async () => {
		const { charactersDelete } = await import("./characters")
		const user = await makeUser("char-softdelete-survives-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ name: "Doomed", description: "x", userId: user.id })
			.returning()

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		const row = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(row).not.toBeNull()
		expect(row?.isDeleted).toBe(true)
	})

	test("charactersList/charactersGet no longer return a soft-deleted character", async () => {
		const { charactersDelete, charactersList, charactersGet } =
			await import("./characters")
		const user = await makeUser("char-softdelete-hidden-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ name: "Hidden", description: "x", userId: user.id })
			.returning()

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		const listRes = await charactersList.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)
		expect(
			listRes.characterList.find((c) => c.id === character.id)
		).toBeUndefined()

		const getRes = await charactersGet.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)
		expect(getRes.character).toBeNull()
	})

	test("a soft-deleted character's historical chat messages still resolve its real name, not the generic fallback", async () => {
		const { charactersDelete } = await import("./characters")
		const { resolveCharacterName } = await import(
			"$lib/shared/utils/resolveCharacterName"
		)
		const user = await makeUser("char-softdelete-authorship-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				name: "Original Author",
				description: "x",
				userId: user.id
			})
			.returning()
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ isGroup: false, userId: user.id })
			.returning()
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({
				chatId: chat.id,
				userId: user.id,
				characterId: character.id,
				role: "assistant",
				content: "Hello."
			})
			.returning()

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		// The message's characterId FK still resolves — a real DELETE would
		// have cascaded this to NULL.
		const reloadedMessage = await testDb.query.chatMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, message.id),
			with: { character: true }
		})
		expect(reloadedMessage?.characterId).toBe(character.id)
		expect(resolveCharacterName(reloadedMessage?.character)).toBe(
			"Original Author"
		)
	})

	test("an existing chatCharacters roster entry for a soft-deleted character keeps working", async () => {
		const { charactersDelete } = await import("./characters")
		const user = await makeUser("char-softdelete-roster-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				name: "Still In Chat",
				description: "x",
				userId: user.id
			})
			.returning()
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ isGroup: true, userId: user.id })
			.returning()
		await testDb.insert(schema.chatCharacters).values({
			chatId: chat.id,
			characterId: character.id,
			position: 0
		})

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		const roster = await testDb.query.chatCharacters.findFirst({
			where: (cc, { eq }) => eq(cc.chatId, chat.id),
			with: { character: true }
		})
		expect(roster).not.toBeNull()
		expect(roster?.characterId).toBe(character.id)
		expect(roster?.character?.name).toBe("Still In Chat")
	})

	test("deleting a character you don't own is a no-op (ownership scoping preserved)", async () => {
		const { charactersDelete, charactersGet } = await import(
			"./characters"
		)
		const owner = await makeUser("char-softdelete-owner-user")
		const attacker = await makeUser("char-softdelete-attacker-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ name: "Not Yours", description: "x", userId: owner.id })
			.returning()

		await charactersDelete.handler(
			fakeSocket(attacker.id),
			{ id: character.id },
			noopEmit
		)

		const row = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(row?.isDeleted).toBe(false)
	})
})
