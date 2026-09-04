/**
 * Round-4 audit fixes, character/persona lane:
 *  - 3a: characters:setAvatar/personas:setAvatar used to write params.path
 *      straight to the avatar column with no check it's actually one of
 *      that entity's own gallery images — letting a user point avatar at
 *      an arbitrary external URL that every other viewer's browser would
 *      then fetch directly.
 *  - 3b: charactersUpdate/personasUpdate's denylist never stripped
 *      lorebookId or uuid, letting a user link their own character/persona
 *      to another user's lorebook, or collide a client-supplied uuid
 *      against the table-wide unique index.
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

async function makeCharacter(userId: number, name = "Char") {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character
}

async function makePersona(userId: number, name = "Persona") {
	const [persona] = await testDb
		.insert(schema.personas)
		.values({ userId, name, description: "", isDefault: false })
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
async function makeMedia(
	userId: number,
	parent: { characterId?: number; personaId?: number }
) {
	const [row] = await testDb
		.insert(schema.files)
		.values({
			userId,
			characterId: parent.characterId ?? null,
			personaId: parent.personaId ?? null,
			hash: `hash-${userId}-${parent.characterId ?? parent.personaId}`,
			kind: "image"
		})
		.returning()
	return row
}

describe("characters:setAvatar / personas:setAvatar — ownership scoping (PGlite integration)", () => {
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
		const { personasSetAvatar } = await import("./personas")
		const user = await makeUser("setavatar-persona-user")
		const persona = await makePersona(user.id)

		await expect(
			personasSetAvatar.handler(
				fakeSocket(user.id),
				{ personaId: persona.id, mediaId: 999999 } as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a media id grouped under the persona", async () => {
		const { personasSetAvatar } = await import("./personas")
		const user = await makeUser("setavatar-persona-user-2")
		const persona = await makePersona(user.id)
		const media = await makeMedia(user.id, { personaId: persona.id })

		const res = await personasSetAvatar.handler(
			fakeSocket(user.id),
			{ personaId: persona.id, mediaId: media.id } as any,
			noopEmit
		)

		expect(res.persona?.avatarMediaId).toBe(media.id)
	})
})

describe("characters:update / personas:update — lorebookId/uuid stripped (PGlite integration)", () => {
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

	test("ignores a foreign lorebookId on personas:update", async () => {
		const { personasUpdate } = await import("./personas")
		const owner = await makeUser("persona-update-owner")
		const other = await makeUser("persona-update-other")
		const persona = await makePersona(owner.id)
		const [foreignLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Foreign Persona Book", userId: other.id })
			.returning()

		const res = await personasUpdate.handler(
			fakeSocket(owner.id),
			{
				persona: {
					id: persona.id,
					name: "Updated Persona",
					lorebookId: foreignLorebook.id
				} as any
			},
			noopEmit
		)

		expect(res.persona?.name).toBe("Updated Persona")
		expect(res.persona?.lorebookId).toBeNull()
	})
})
