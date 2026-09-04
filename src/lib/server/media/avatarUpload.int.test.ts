/**
 * Avatar uploads through the media table (28).
 *
 * The predecessor of this file asserted that a re-upload DELETED the previous
 * avatar file. That behaviour is deliberately gone: blobs are deduped per user
 * and a media row can be pointed at from more than one place, so "nothing else
 * references my old avatar" is not a fact a single caller can establish.
 * Orphans are the cleanup tool's problem now — and, unlike before, they are an
 * exact query rather than a guess.
 *
 * What is asserted instead is the contract that replaced it: the size cap still
 * bites before anything is written, identical bytes dedupe to one row and one
 * file, and different bytes leave the pointer on the new row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
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

/** A real, CRC-valid PNG. `seed` varies the pixel so two calls can produce
 *  genuinely different bytes (and therefore different hashes). */
function makeTestPngBuffer(seed = 255): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = seed
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

/** Every file under a character's media directory, derived variants included. */
async function filesFor(characterId: number, userId: number) {
	const dir = path.join(
		dataDir,
		"data",
		"users",
		String(userId),
		"characters",
		String(characterId)
	)
	return fs.readdir(dir).catch(() => [] as string[])
}

async function variantsOf(fileId: number) {
	return testDb
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.fileId, fileId))
}

describe("avatar upload via media (28)", () => {
	test("rejects an oversized upload before writing anything to disk", async () => {
		const { handleCharacterAvatarUpload } = await import(
			"$lib/server/utils"
		)
		const user = await makeUser("avatar-cap-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Cap Test", description: "" })
			.returning()

		// Over MAX_MEDIA_UPLOAD_BYTES (50MB).
		const oversized = Buffer.alloc(51 * 1024 * 1024)

		await expect(
			handleCharacterAvatarUpload({ character, avatarFile: oversized })
		).rejects.toThrow(/too large/i)

		expect(await filesFor(character.id, user.id)).toHaveLength(0)

		const row = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(row?.avatarMediaId).toBeNull()
	})

	test("rejects a non-image before writing anything to disk", async () => {
		const { handleCharacterAvatarUpload } = await import(
			"$lib/server/utils"
		)
		const user = await makeUser("avatar-sniff-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Sniff Test", description: "" })
			.returning()

		// Valid UTF-8 text: it would pass the document sniff, but an avatar
		// field must not accept a document.
		await expect(
			handleCharacterAvatarUpload({
				character,
				avatarFile: Buffer.from("this is not an image at all")
			})
		).rejects.toThrow(/not a recognized image/i)

		expect(await filesFor(character.id, user.id)).toHaveLength(0)
	})

	test("sets avatarMediaId and writes the original, and only the original", async () => {
		const { handleCharacterAvatarUpload } = await import(
			"$lib/server/utils"
		)
		const user = await makeUser("avatar-first-upload-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "First Upload", description: "" })
			.returning()

		const row = await handleCharacterAvatarUpload({
			character,
			avatarFile: makeTestPngBuffer()
		})

		const after = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		// The pointer names the FILE, never a stored representation — which is
		// what lets the original be culled later without stranding it.
		expect(after?.avatarMediaId).toBe(row.file.id)

		// The file is named after its own hash — never after the uploader's
		// filename, and never with a uuid that has to be tracked separately.
		const files = await filesFor(character.id, user.id)
		expect(files).toEqual([`${row.file.hash}.png`])

		// ONE variant, and no `.thumb.webp` beside it. The predecessor of this
		// test asserted a thumbnail existed by now, because an upload encoded
		// one inline; 0182 made derivation lazy precisely so a codec problem
		// cannot stall or fail an upload, so a lone original is the healthy
		// state and asserting otherwise would re-assert the eager encode.
		const variants = await variantsOf(row.file.id)
		expect(variants.map((v) => v.variant)).toEqual([MediaVariant.ORIGINAL])

		// A web-safe PNG IS its own display form, so the pointer names the
		// original rather than a second copy of the same pixels — and the
		// denormalised mime agrees with what it points at.
		expect(row.file.displayVariantId).toBe(row.original.id)
		expect(row.file.displayMime).toBe("image/png")
	})

	test("re-uploading identical bytes dedupes to the same row and file", async () => {
		const { handleCharacterAvatarUpload } = await import(
			"$lib/server/utils"
		)
		const user = await makeUser("avatar-dedupe-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Dedupe", description: "" })
			.returning()

		const first = await handleCharacterAvatarUpload({
			character,
			avatarFile: makeTestPngBuffer()
		})
		const second = await handleCharacterAvatarUpload({
			character,
			avatarFile: makeTestPngBuffer()
		})

		expect(second.file.id).toBe(first.file.id)
		// The one original — the second upload wrote neither a new row nor a
		// new file.
		expect(await filesFor(character.id, user.id)).toHaveLength(1)
	})

	test("re-uploading different bytes repoints the avatar and leaves the old blob for cleanup", async () => {
		const { handleCharacterAvatarUpload } = await import(
			"$lib/server/utils"
		)
		const user = await makeUser("avatar-repoint-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Repoint", description: "" })
			.returning()

		const first = await handleCharacterAvatarUpload({
			character,
			avatarFile: makeTestPngBuffer(255)
		})
		const second = await handleCharacterAvatarUpload({
			character,
			avatarFile: makeTestPngBuffer(7)
		})

		expect(second.file.id).not.toBe(first.file.id)

		const after = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(after?.avatarMediaId).toBe(second.file.id)

		// Both blobs remain: the old one is still a file grouped under this
		// character (it shows in the gallery), and deleting it is an explicit
		// action, not a side effect of setting a new avatar.
		const files = await filesFor(character.id, user.id)
		expect(files).toContain(`${first.file.hash}.png`)
		expect(files).toContain(`${second.file.hash}.png`)
	})

	test("persona avatars follow the same path", async () => {
		const { handlePersonaAvatarUpload } = await import("$lib/server/utils")
		const user = await makeUser("avatar-persona-user")
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "P",
				description: "",
				isDefault: false
			})
			.returning()

		const row = await handlePersonaAvatarUpload({
			persona,
			avatarFile: makeTestPngBuffer()
		})
		const after = await testDb.query.personas.findFirst({
			where: (p, { eq }) => eq(p.id, persona.id)
		})
		expect(after?.avatarMediaId).toBe(row.file.id)
		expect(row.file.personaId).toBe(persona.id)
		// Provenance is on the file and the bytes we just wrote are its
		// original — the two halves `CreatedMedia` exists to keep apart.
		expect(row.original.isOriginal).toBe(true)
	})
})
