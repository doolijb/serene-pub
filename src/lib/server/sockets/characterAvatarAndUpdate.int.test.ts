/**
 * Round-4 audit fixes, character lane:
 *  - 3a: characters:setAvatar used to write params.path straight to the
 *      avatar column with no check it's actually one of that character's own
 *      gallery images — letting a user point avatar at an arbitrary external
 *      URL that every other viewer's browser would then fetch directly.
 *  - 3b: charactersUpdate's denylist never stripped lorebookId or uuid,
 *      letting a user link their own character to another user's lorebook,
 *      or collide a client-supplied uuid against the table-wide unique index.
 *
 * Each case was written twice — once for a character, once for a persona —
 * because there were two tables and two handlers. 0133 folded them, so the
 * persona half of every pair is kept as the SAME case against a character
 * with `isPersona` set: the entity it defends is still reachable by that
 * route, and dropping the case because the handler merged would be dropping
 * coverage, not duplication.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
		path.join(
			os.tmpdir(),
			"serene-pub-char-persona-avatar-update-int-test-"
		)
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

/** A real, CRC-valid PNG. `seed` varies the pixel so two calls produce
 *  genuinely different bytes, and therefore two different media rows. */
function makeTestPngBuffer(seed = 255): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = seed
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

async function makeCharacter(userId: number, name = "Char") {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character
}

/** A character the user plays — the persona half of every pair below. */
async function makePersona(userId: number, name = "Persona") {
	const [persona] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "", isPersona: true })
		.returning()
	return persona
}

/** Insert a file row directly — enough to be "one of this entity's own
 *  images" without going through an upload.
 *
 *  No variant row goes with it, and that is not a shortcut: the ownership check
 *  under test reads provenance off the FILE (0182 moved the bytes, the mime and
 *  the path onto a variant), so a file with no stored representation at all is
 *  still a legitimate subject for it. */
async function makeMedia(userId: number, parent: { characterId: number }) {
	const [row] = await testDb
		.insert(schema.files)
		.values({
			userId,
			characterId: parent.characterId,
			hash: `hash-${userId}-${parent.characterId}`,
			kind: "image"
		})
		.returning()
	return row
}

describe("characters:setAvatar — ownership scoping (PGlite integration)", () => {
	test("rejects a media id that is not one of the character's own images", async () => {
		const { charactersSetAvatar } = await import("./characters")
		const user = await makeUser("setavatar-char-user")
		const character = await makeCharacter(user.id)

		await expect(
			charactersSetAvatar.handler(
				fakeSocket(user.id),
				// Not this character's media — and, since 28, there is no
				// longer anywhere to put an external URL at all: an avatar is
				// an id into `media`.
				{ characterId: character.id, mediaId: 999999 } as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a media id grouped under the character", async () => {
		const { charactersSetAvatar } = await import("./characters")
		const user = await makeUser("setavatar-char-user-2")
		const character = await makeCharacter(user.id)
		const media = await makeMedia(user.id, { characterId: character.id })

		const res = await charactersSetAvatar.handler(
			fakeSocket(user.id),
			{ characterId: character.id, mediaId: media.id } as any,
			noopEmit
		)

		expect(res.character?.avatarMediaId).toBe(media.id)
	})

	test("rejects a media id that is not one of the persona's own images", async () => {
		const { charactersSetAvatar } = await import("./characters")
		const user = await makeUser("setavatar-persona-user")
		const persona = await makePersona(user.id)

		await expect(
			charactersSetAvatar.handler(
				fakeSocket(user.id),
				{ characterId: persona.id, mediaId: 999999 } as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a media id grouped under the persona", async () => {
		const { charactersSetAvatar } = await import("./characters")
		const user = await makeUser("setavatar-persona-user-2")
		const persona = await makePersona(user.id)
		const media = await makeMedia(user.id, { characterId: persona.id })

		const res = await charactersSetAvatar.handler(
			fakeSocket(user.id),
			{ characterId: persona.id, mediaId: media.id } as any,
			noopEmit
		)

		expect(res.character?.avatarMediaId).toBe(media.id)
	})
})

describe("characters:update — lorebookId/uuid stripped (PGlite integration)", () => {
	test("ignores a foreign lorebookId on characters:update", async () => {
		const { charactersUpdate } = await import("./characters")
		const owner = await makeUser("char-update-owner")
		const other = await makeUser("char-update-other")
		const character = await makeCharacter(owner.id)
		const [foreignLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Foreign Book", userId: other.id })
			.returning()

		const res = await charactersUpdate.handler(
			fakeSocket(owner.id),
			{
				character: {
					id: character.id,
					name: "Updated Name",
					lorebookId: foreignLorebook.id
				} as any
			},
			noopEmit
		)

		expect(res.character?.name).toBe("Updated Name")
		expect(res.character?.lorebookId).toBeNull()
	})

	test("ignores a foreign lorebookId on a persona's update", async () => {
		const { charactersUpdate } = await import("./characters")
		const owner = await makeUser("persona-update-owner")
		const other = await makeUser("persona-update-other")
		const persona = await makePersona(owner.id)
		const [foreignLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Foreign Persona Book", userId: other.id })
			.returning()

		const res = await charactersUpdate.handler(
			fakeSocket(owner.id),
			{
				character: {
					id: persona.id,
					name: "Updated Persona",
					lorebookId: foreignLorebook.id
				} as any
			},
			noopEmit
		)

		expect(res.character?.name).toBe("Updated Persona")
		expect(res.character?.lorebookId).toBeNull()
		// The flag is not collateral damage of an unrelated save.
		expect(res.character?.isPersona).toBe(true)
	})

	/** A folder that is not yours is not a destination — it is dropped. */
	test("ignores a foreign folderId on characters:update", async () => {
		const { charactersUpdate } = await import("./characters")
		const owner = await makeUser("char-update-folder-owner")
		const other = await makeUser("char-update-folder-other")
		const character = await makeCharacter(owner.id)
		const [foreignFolder] = await testDb
			.insert(schema.characterFolders)
			.values({ userId: other.id, name: "Not Yours" })
			.returning()

		const res = await charactersUpdate.handler(
			fakeSocket(owner.id),
			{
				character: {
					id: character.id,
					name: "Filed",
					folderId: foreignFolder.id
				} as any
			},
			noopEmit
		)

		expect(res.character?.folderId).toBeNull()
	})
})

describe("characters:update — tags untouched when absent (PGlite integration)", () => {
	test(
		"an update with no tags array leaves existing tags alone",
		async () => {
			const { charactersCreate, charactersUpdate } = await import(
				"./characters"
			)
			const user = await makeUser("char-update-tags-user")

			const created = await charactersCreate.handler(
				fakeSocket(user.id),
				{
					character: {
						name: "Tagged",
						description: "",
						tags: ["alpha", "beta"]
					} as any
				},
				noopEmit
			)
			const characterId = created.character!.id!

			const res = await charactersUpdate.handler(
				fakeSocket(user.id),
				{
					character: {
						id: characterId,
						isPersona: true
					} as any
				},
				noopEmit
			)

			expect(res.character?.isPersona).toBe(true)

			const characterTags = await testDb.query.characterTags.findMany({
				where: eq(schema.characterTags.characterId, characterId),
				with: { tag: true }
			})
			expect(characterTags.map((ct) => ct.tag.name).sort()).toEqual([
				"alpha",
				"beta"
			])
		},
		60_000
	)
})

/**
 * What the broadcast has to say after an avatar upload.
 *
 * `.returning()` answers with the row as the UPDATE statement left it, and the
 * avatar upload writes `avatarMediaId` in a statement of its own afterwards —
 * so a broadcast built from the returned row names the avatar the character
 * wore before the save. Every open session applies that faithfully and keeps
 * rendering the old face until a reload.
 *
 * The joined `avatarMedia` is the second half: a by-id URL cannot be busted
 * when a media row changes in place, so the payload carries the uuid and the
 * cache token the immutable URL is built from.
 */
describe("characters:update — the avatar on the wire", () => {
	/**
	 * A collecting `emitToUser`, thunk-aware.
	 *
	 * The cascades in characters.ts hand their payload over LAZILY
	 * (socket-interest plan, ruling 4): `emitToUser` receives a thunk and runs
	 * it only when some socket declared the key. A collector that recorded the
	 * thunk itself would record a function where the assertions below want a
	 * payload, so this evaluates it exactly as the ungated path does — and
	 * returns the promise the handler awaits, so the emit still lands before
	 * the handler returns.
	 */
	function captureEmits() {
		const emitted: { event: string; data: any }[] = []
		return {
			emitted,
			emit: (event: string, data: any) => {
				if (typeof data !== "function") {
					emitted.push({ event, data })
					return
				}
				return Promise.resolve(data()).then((value) => {
					emitted.push({ event, data: value })
				})
			}
		}
	}

	function lastOf(
		emitted: { event: string; data: any }[],
		event: string
	): any {
		return emitted.filter((e) => e.event === event).at(-1)?.data
	}

	async function fileOf(id: number) {
		return testDb.query.files.findFirst({
			where: (f, { eq }) => eq(f.id, id)
		})
	}

	test("a second upload broadcasts the NEW avatar, with its uuid and rev", async () => {
		const { charactersUpdate } = await import("./characters")
		const user = await makeUser("char-avatar-broadcast")
		const character = await makeCharacter(user.id, "Verity")

		await charactersUpdate.handler(
			fakeSocket(user.id),
			{
				character: { id: character.id, name: "Verity" },
				avatarFile: makeTestPngBuffer(10)
			} as any,
			noopEmit
		)
		const afterFirst = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		const firstAvatarId = afterFirst!.avatarMediaId
		expect(firstAvatarId).toBeTruthy()

		const capture = captureEmits()
		await charactersUpdate.handler(
			fakeSocket(user.id),
			{
				character: { id: character.id, name: "Verity" },
				avatarFile: makeTestPngBuffer(200)
			} as any,
			capture.emit
		)

		const stored = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(stored!.avatarMediaId).not.toBe(firstAvatarId)

		const broadcast = lastOf(capture.emitted, "characters:update")
		expect(broadcast.character.avatarMediaId).toBe(stored!.avatarMediaId)

		const file = await fileOf(stored!.avatarMediaId!)
		expect(broadcast.character.avatarMedia).toEqual({
			uuid: file!.uuid,
			rev: file!.rev,
			// Joined alongside the address so "adjust crop" opens on the stored
			// crop rather than on the default rule.
			frame: file!.frame
		})
	})

	test("a persona's second upload does the same", async () => {
		const { charactersUpdate } = await import("./characters")
		const user = await makeUser("persona-avatar-broadcast")
		const persona = await makePersona(user.id, "Jody")

		await charactersUpdate.handler(
			fakeSocket(user.id),
			{
				character: { id: persona.id, name: "Jody" },
				avatarFile: makeTestPngBuffer(10)
			} as any,
			noopEmit
		)
		const afterFirst = await testDb.query.characters.findFirst({
			where: (p, { eq }) => eq(p.id, persona.id)
		})
		const firstAvatarId = afterFirst!.avatarMediaId
		expect(firstAvatarId).toBeTruthy()

		const capture = captureEmits()
		await charactersUpdate.handler(
			fakeSocket(user.id),
			{
				character: { id: persona.id, name: "Jody" },
				avatarFile: makeTestPngBuffer(200)
			} as any,
			capture.emit
		)

		const stored = await testDb.query.characters.findFirst({
			where: (p, { eq }) => eq(p.id, persona.id)
		})
		expect(stored!.avatarMediaId).not.toBe(firstAvatarId)

		const broadcast = lastOf(capture.emitted, "characters:update")
		expect(broadcast.character.avatarMediaId).toBe(stored!.avatarMediaId)

		const file = await fileOf(stored!.avatarMediaId!)
		expect(broadcast.character.avatarMedia).toEqual({
			uuid: file!.uuid,
			rev: file!.rev,
			// Joined alongside the address so "adjust crop" opens on the stored
			// crop rather than on the default rule.
			frame: file!.frame
		})
	})

	test("picking a gallery image as the avatar reaches open sessions too", async () => {
		const { charactersSetAvatar } = await import("./characters")
		const user = await makeUser("char-setavatar-broadcast")
		const character = await makeCharacter(user.id, "Verity")
		const media = await makeMedia(user.id, { characterId: character.id })

		const capture = captureEmits()
		await charactersSetAvatar.handler(
			fakeSocket(user.id),
			{ characterId: character.id, mediaId: media.id } as any,
			capture.emit
		)

		const broadcast = lastOf(capture.emitted, "characters:update")
		expect(broadcast.character.avatarMediaId).toBe(media.id)
		expect(broadcast.character.avatarMedia).toEqual({
			uuid: media.uuid,
			rev: media.rev,
			// Joined alongside the address so "adjust crop" opens on the stored
			// crop rather than on the default rule.
			frame: media.frame
		})
	})
})
