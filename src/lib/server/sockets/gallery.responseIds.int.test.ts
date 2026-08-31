/**
 * Round-7 audit fix: characters:listGallery/uploadGalleryImage/
 * deleteGalleryImage (and the persona equivalents) are delivered via
 * emitToUser, which broadcasts to every open socket/tab for the user, not
 * just the requesting one. Neither the success responses nor the error
 * responses carried an entity id, so a client with two gallery panels open
 * (or two tabs) had no way to tell which panel a given broadcast was for —
 * this asserts both the success and error response shapes now carry the
 * entity id needed to make that distinction.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

import { vi } from "vitest"
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-gallery-response-ids-int-test-")
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

function captureEmits() {
	const emitted: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => emitted.push({ event, data })
	return { emitted, emit }
}

describe("characters gallery handlers thread characterId (PGlite integration)", () => {
	test("listGallery success response includes characterId", async () => {
		const { charactersListGallery } = await import("./characters")
		const user = await makeUser("gallery-char-list-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "C", description: "" })
			.returning()

		const { emitted, emit } = captureEmits()
		const res = await charactersListGallery.handler(
			fakeSocket(user.id),
			{ characterId: character.id },
			emit
		)

		expect(res.characterId).toBe(character.id)
		const success = emitted.find(
			(e) => e.event === "characters:listGallery"
		)
		expect(success?.data.characterId).toBe(character.id)
	})

	test("uploadGalleryImage error response includes characterId", async () => {
		const { charactersUploadGalleryImage } = await import("./characters")
		const attacker = await makeUser("gallery-char-upload-attacker")
		const victim = await makeUser("gallery-char-upload-victim")
		const [victimCharacter] = await testDb
			.insert(schema.characters)
			.values({ userId: victim.id, name: "V", description: "" })
			.returning()

		const { emitted, emit } = captureEmits()
		await expect(
			charactersUploadGalleryImage.handler(
				fakeSocket(attacker.id),
				{
					characterId: victimCharacter.id,
					imageFile: new Uint8Array(),
					mimeType: "image/png"
				} as any,
				emit
			)
		).rejects.toThrow()

		const err = emitted.find(
			(e) => e.event === "characters:uploadGalleryImage:error"
		)
		expect(err?.data.characterId).toBe(victimCharacter.id)
	})

	test("deleteGalleryImage error response includes characterId", async () => {
		const { charactersDeleteGalleryImage } = await import("./characters")
		const attacker = await makeUser("gallery-char-delete-attacker")
		const victim = await makeUser("gallery-char-delete-victim")
		const [victimCharacter] = await testDb
			.insert(schema.characters)
			.values({ userId: victim.id, name: "V2", description: "" })
			.returning()

		const { emitted, emit } = captureEmits()
		await expect(
			charactersDeleteGalleryImage.handler(
				fakeSocket(attacker.id),
				{ characterId: victimCharacter.id, mediaId: 999999 },
				emit
			)
		).rejects.toThrow()

		const err = emitted.find(
			(e) => e.event === "characters:deleteGalleryImage:error"
		)
		expect(err?.data.characterId).toBe(victimCharacter.id)
	})
})

describe("personas gallery handlers thread personaId (PGlite integration)", () => {
	test("listGallery success response includes personaId", async () => {
		const { personasListGallery } = await import("./personas")
		const user = await makeUser("gallery-persona-list-user")
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "P",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()

		const { emitted, emit } = captureEmits()
		const res = await personasListGallery.handler(
			fakeSocket(user.id),
			{ personaId: persona.id },
			emit
		)

		expect(res.personaId).toBe(persona.id)
		const success = emitted.find((e) => e.event === "personas:listGallery")
		expect(success?.data.personaId).toBe(persona.id)
	})

	test("uploadGalleryImage error response includes personaId", async () => {
		const { personasUploadGalleryImage } = await import("./personas")
		const attacker = await makeUser("gallery-persona-upload-attacker")
		const victim = await makeUser("gallery-persona-upload-victim")
		const [victimPersona] = await testDb
			.insert(schema.personas)
			.values({
				userId: victim.id,
				name: "VP",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()

		const { emitted, emit } = captureEmits()
		await expect(
			personasUploadGalleryImage.handler(
				fakeSocket(attacker.id),
				{
					personaId: victimPersona.id,
					imageFile: new Uint8Array(),
					mimeType: "image/png"
				} as any,
				emit
			)
		).rejects.toThrow()

		const err = emitted.find(
			(e) => e.event === "personas:uploadGalleryImage:error"
		)
		expect(err?.data.personaId).toBe(victimPersona.id)
	})

	test("deleteGalleryImage error response includes personaId", async () => {
		const { personasDeleteGalleryImage } = await import("./personas")
		const attacker = await makeUser("gallery-persona-delete-attacker")
		const victim = await makeUser("gallery-persona-delete-victim")
		const [victimPersona] = await testDb
			.insert(schema.personas)
			.values({
				userId: victim.id,
				name: "VP2",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()

		const { emitted, emit } = captureEmits()
		await expect(
			personasDeleteGalleryImage.handler(
				fakeSocket(attacker.id),
				{ personaId: victimPersona.id, mediaId: 999999 },
				emit
			)
		).rejects.toThrow()

		const err = emitted.find(
			(e) => e.event === "personas:deleteGalleryImage:error"
		)
		expect(err?.data.personaId).toBe(victimPersona.id)
	})
})
