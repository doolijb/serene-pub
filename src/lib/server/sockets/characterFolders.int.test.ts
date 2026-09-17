/**
 * The library's folders, and the two things a folder must never do.
 *
 * A folder is a shelf in ONE person's library. Every handler scopes its write
 * on `userId` rather than reading the row first and then writing, so naming
 * someone else's folder id changes nothing — and the test that matters is that
 * a character cannot be moved into a folder its owner cannot see, because that
 * is how one user's library would start showing another user's grouping.
 *
 * The second is the promise a delete dialog makes: deleting a folder KEEPS its
 * characters. `characters.folder_id` is `ON DELETE SET NULL`, so they return to
 * the top level — asserted here because a cascade would silently make the
 * dialog a lie.
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
		path.join(os.tmpdir(), "serene-pub-character-folders-int-test-")
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

async function makeCharacter(userId: number, name: string) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character
}

async function folderOf(characterId: number) {
	const row = await testDb.query.characters.findFirst({
		where: (c, { eq }) => eq(c.id, characterId),
		columns: { folderId: true }
	})
	return row?.folderId ?? null
}

describe("characterFolders (PGlite integration)", () => {
	test("create, list with counts, rename", async () => {
		const {
			characterFoldersCreate,
			characterFoldersList,
			characterFoldersUpdate,
			charactersSetFolder
		} = await import("./characterFolders")
		const user = await makeUser("folders-crud-user")

		const created = await characterFoldersCreate.handler(
			fakeSocket(user.id),
			{ name: "  Villains  " },
			noopEmit
		)
		// Trimmed on the way in, so a folder is never named by its whitespace.
		expect(created.folder.name).toBe("Villains")

		const character = await makeCharacter(user.id, "Grust")
		await charactersSetFolder.handler(
			fakeSocket(user.id),
			{ characterId: character.id, folderId: created.folder.id },
			noopEmit
		)

		const listed = await characterFoldersList.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)
		expect(listed.folders).toHaveLength(1)
		expect(listed.folders[0].characterCount).toBe(1)

		const renamed = await characterFoldersUpdate.handler(
			fakeSocket(user.id),
			{ id: created.folder.id, name: "Antagonists" },
			noopEmit
		)
		expect(renamed.folder.name).toBe("Antagonists")
	})

	test("a soft-deleted character is not counted", async () => {
		const { characterFoldersCreate, characterFoldersList } = await import(
			"./characterFolders"
		)
		const user = await makeUser("folders-count-user")
		const { folder } = await characterFoldersCreate.handler(
			fakeSocket(user.id),
			{ name: "Shelf" },
			noopEmit
		)

		const kept = await makeCharacter(user.id, "Kept")
		const gone = await makeCharacter(user.id, "Gone")
		await testDb
			.update(schema.characters)
			.set({ folderId: folder.id })
			.where(
				(await import("drizzle-orm")).inArray(schema.characters.id, [
					kept.id,
					gone.id
				])
			)
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where((await import("drizzle-orm")).eq(schema.characters.id, gone.id))

		const listed = await characterFoldersList.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)
		const row = listed.folders.find((f) => f.id === folder.id)
		expect(row?.characterCount).toBe(1)
	})

	test("a user cannot move a character into another user's folder", async () => {
		const { characterFoldersCreate, charactersSetFolder } = await import(
			"./characterFolders"
		)
		const owner = await makeUser("folders-owner")
		const outsider = await makeUser("folders-outsider")

		const { folder } = await characterFoldersCreate.handler(
			fakeSocket(owner.id),
			{ name: "Owner's shelf" },
			noopEmit
		)
		const theirs = await makeCharacter(outsider.id, "Theirs")

		await expect(
			charactersSetFolder.handler(
				fakeSocket(outsider.id),
				{ characterId: theirs.id, folderId: folder.id },
				noopEmit
			)
		).rejects.toThrow(/not found|not owned/i)

		expect(await folderOf(theirs.id)).toBeNull()
	})

	test("a user cannot move someone else's character into their own folder", async () => {
		const { characterFoldersCreate, charactersSetFolder } = await import(
			"./characterFolders"
		)
		const owner = await makeUser("folders-thief")
		const victim = await makeUser("folders-victim")

		const { folder } = await characterFoldersCreate.handler(
			fakeSocket(owner.id),
			{ name: "Mine" },
			noopEmit
		)
		const victimCharacter = await makeCharacter(victim.id, "Victim")

		await expect(
			charactersSetFolder.handler(
				fakeSocket(owner.id),
				{ characterId: victimCharacter.id, folderId: folder.id },
				noopEmit
			)
		).rejects.toThrow(/not found|not owned/i)

		expect(await folderOf(victimCharacter.id)).toBeNull()
	})

	test("a user cannot rename or delete another user's folder", async () => {
		const {
			characterFoldersCreate,
			characterFoldersUpdate,
			characterFoldersDelete
		} = await import("./characterFolders")
		const owner = await makeUser("folders-rename-owner")
		const outsider = await makeUser("folders-rename-outsider")

		const { folder } = await characterFoldersCreate.handler(
			fakeSocket(owner.id),
			{ name: "Private" },
			noopEmit
		)

		await expect(
			characterFoldersUpdate.handler(
				fakeSocket(outsider.id),
				{ id: folder.id, name: "Hijacked" },
				noopEmit
			)
		).rejects.toThrow(/not found|not owned/i)
		await expect(
			characterFoldersDelete.handler(
				fakeSocket(outsider.id),
				{ id: folder.id },
				noopEmit
			)
		).rejects.toThrow(/not found|not owned/i)

		const still = await testDb.query.characterFolders.findFirst({
			where: (f, { eq }) => eq(f.id, folder.id)
		})
		expect(still?.name).toBe("Private")
	})

	test("deleting a folder returns its characters to the top level", async () => {
		const {
			characterFoldersCreate,
			characterFoldersDelete,
			charactersSetFolder
		} = await import("./characterFolders")
		const user = await makeUser("folders-delete-user")

		const { folder } = await characterFoldersCreate.handler(
			fakeSocket(user.id),
			{ name: "Temporary" },
			noopEmit
		)
		const a = await makeCharacter(user.id, "Alpha")
		const b = await makeCharacter(user.id, "Beta")
		for (const c of [a, b])
			await charactersSetFolder.handler(
				fakeSocket(user.id),
				{ characterId: c.id, folderId: folder.id },
				noopEmit
			)
		expect(await folderOf(a.id)).toBe(folder.id)

		await characterFoldersDelete.handler(
			fakeSocket(user.id),
			{ id: folder.id },
			noopEmit
		)

		// KEPT, not deleted — the only thing a confirm dialog can honestly say.
		for (const c of [a, b]) {
			const row = await testDb.query.characters.findFirst({
				where: (x, { eq }) => eq(x.id, c.id)
			})
			expect(row).toBeTruthy()
			expect(row!.folderId).toBeNull()
		}
	})

	test("setting folderId to null returns one character to the top level", async () => {
		const { characterFoldersCreate, charactersSetFolder } = await import(
			"./characterFolders"
		)
		const user = await makeUser("folders-unfile-user")
		const { folder } = await characterFoldersCreate.handler(
			fakeSocket(user.id),
			{ name: "Shelf" },
			noopEmit
		)
		const character = await makeCharacter(user.id, "Filed")

		await charactersSetFolder.handler(
			fakeSocket(user.id),
			{ characterId: character.id, folderId: folder.id },
			noopEmit
		)
		await charactersSetFolder.handler(
			fakeSocket(user.id),
			{ characterId: character.id, folderId: null },
			noopEmit
		)

		expect(await folderOf(character.id)).toBeNull()
	})

	test("a folder name is unique per owner, not globally", async () => {
		const { characterFoldersCreate } = await import("./characterFolders")
		const userA = await makeUser("folders-name-a")
		const userB = await makeUser("folders-name-b")

		await characterFoldersCreate.handler(
			fakeSocket(userA.id),
			{ name: "Heroes" },
			noopEmit
		)
		// Another user may have one by the same name.
		const other = await characterFoldersCreate.handler(
			fakeSocket(userB.id),
			{ name: "Heroes" },
			noopEmit
		)
		expect(other.folder.name).toBe("Heroes")

		const emitToUser = vi.fn()
		await expect(
			characterFoldersCreate.handler(
				fakeSocket(userA.id),
				{ name: "Heroes" },
				emitToUser
			)
		).rejects.toThrow()
		expect(emitToUser).toHaveBeenCalledWith(
			"characterFolders:create:error",
			{ error: 'A folder named "Heroes" already exists.' }
		)
	})

	test("a nameless folder is refused", async () => {
		const { characterFoldersCreate } = await import("./characterFolders")
		const user = await makeUser("folders-nameless-user")
		await expect(
			characterFoldersCreate.handler(
				fakeSocket(user.id),
				{ name: "   " },
				noopEmit
			)
		).rejects.toThrow(/name is required/i)
	})
})
