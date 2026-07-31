/**
 * Round-12 audit fix (MEDIUM): none of the avatar/gallery/background upload
 * functions in this file checked the incoming buffer's byte length (only
 * ceiling was Socket.IO's global 100MB maxHttpBufferSize, applied per-event
 * not per-field), and handleCharacterAvatarUpload/handlePersonaAvatarUpload
 * never deleted the previous avatar file on re-upload — unbounded orphan
 * growth on disk. Fixed by capping at 10MB inside sniffImageExtension (the
 * shared choke point every upload function already calls) and deleting the
 * previous file (if any) after a successful re-upload.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
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
		path.join(os.tmpdir(), "serene-pub-avatar-upload-int-test-")
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

/** A real, CRC-valid 1x1 PNG — see sillyTavernParsers.test.ts for why this
 * is built with pngjs rather than a hand-copied base64 blob. */
function makeTestPngBuffer(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = 255
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

describe("avatar upload — byte-size cap + orphan cleanup (Round-12 audit fix, PGlite integration)", () => {
	test("rejects an oversized upload before writing anything to disk", async () => {
		const { handleCharacterAvatarUpload, getCharacterDataDir } =
			await import("./index")
		const user = await makeUser("avatar-cap-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Cap Test", description: "" })
			.returning()

		const oversized = Buffer.alloc(11 * 1024 * 1024) // 11MB > the 10MB cap

		await expect(
			handleCharacterAvatarUpload({ character, avatarFile: oversized })
		).rejects.toThrow(/too large/i)

		const avatarDir = getCharacterDataDir({
			characterId: character.id,
			userId: user.id
		})
		const filesWritten = await fs.readdir(avatarDir).catch(() => [])
		expect(filesWritten).toHaveLength(0)

		const row = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(row?.avatar).toBeNull()
	})

	test("re-uploading a character avatar deletes the previous file and keeps only the new one", async () => {
		const { handleCharacterAvatarUpload, getCharacterDataDir } =
			await import("./index")
		const user = await makeUser("avatar-cleanup-char-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Cleanup Test", description: "" })
			.returning()
		const avatarDir = getCharacterDataDir({
			characterId: character.id,
			userId: user.id
		})

		await handleCharacterAvatarUpload({
			character,
			avatarFile: makeTestPngBuffer()
		})
		const afterFirst = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		const filesAfterFirst = await fs.readdir(avatarDir)
		expect(filesAfterFirst).toHaveLength(1)

		// Second upload — pass the row as it now stands (real avatar set),
		// matching how the real call sites re-fetch/pass the current row.
		await handleCharacterAvatarUpload({
			character: afterFirst,
			avatarFile: makeTestPngBuffer()
		})

		const filesAfterSecond = await fs.readdir(avatarDir)
		expect(filesAfterSecond).toHaveLength(1) // old file gone, only the new one remains
		expect(filesAfterSecond[0]).not.toBe(filesAfterFirst[0])

		const afterSecond = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(afterSecond?.avatar).toContain(filesAfterSecond[0])
	})

	test("re-uploading a persona avatar deletes the previous file and keeps only the new one", async () => {
		const { handlePersonaAvatarUpload, getPersonaDataDir } = await import(
			"./index"
		)
		const user = await makeUser("avatar-cleanup-persona-user")
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Cleanup Persona",
				description: "",
				isDefault: false
			})
			.returning()
		const avatarDir = getPersonaDataDir({
			personaId: persona.id,
			userId: user.id
		})

		await handlePersonaAvatarUpload({
			persona,
			avatarFile: makeTestPngBuffer()
		})
		const afterFirst = await testDb.query.personas.findFirst({
			where: (p, { eq }) => eq(p.id, persona.id)
		})
		const filesAfterFirst = await fs.readdir(avatarDir)
		expect(filesAfterFirst).toHaveLength(1)

		await handlePersonaAvatarUpload({
			persona: afterFirst,
			avatarFile: makeTestPngBuffer()
		})

		const filesAfterSecond = await fs.readdir(avatarDir)
		expect(filesAfterSecond).toHaveLength(1)
		expect(filesAfterSecond[0]).not.toBe(filesAfterFirst[0])
	})

	test("the first-ever upload (no previous avatar) doesn't attempt to delete anything or error", async () => {
		const { handleCharacterAvatarUpload, getCharacterDataDir } =
			await import("./index")
		const user = await makeUser("avatar-first-upload-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "First Upload", description: "" })
			.returning()

		await handleCharacterAvatarUpload({
			character, // character.avatar is null here
			avatarFile: makeTestPngBuffer()
		})

		const avatarDir = getCharacterDataDir({
			characterId: character.id,
			userId: user.id
		})
		const files = await fs.readdir(avatarDir)
		expect(files).toHaveLength(1)
	})
})
