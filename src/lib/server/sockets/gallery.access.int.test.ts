/**
 * `characters:listGallery` is gated (F2, 2026-10-11 — W6 ruling 4): a
 * character's gallery is listed for its owner, for anyone in a session it
 * sits in (as cast or as a voice), and for an administrator. A stranger is
 * refused with `characters:listGallery:error` — the words and the shape
 * `characters:listSprites` refuses with, the id echoed — and gets no images.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-gallery-access-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin } }) as any

async function list(userId: number, characterId: number, isAdmin = false) {
	const { charactersListGallery } = await import("./characters")
	const emits: Array<[string, any]> = []
	let refused: unknown = null
	try {
		await charactersListGallery.handler(
			fakeSocket(userId, isAdmin),
			{ characterId },
			(event: string, data: any) => emits.push([event, data])
		)
	} catch (e) {
		refused = e
	}
	return { emits, refused }
}

async function fixture(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `gallery-owner-${tag}`)
	const guest = await createTestUser(testDb, `gallery-guest-${tag}`)
	const stranger = await createTestUser(testDb, `gallery-stranger-${tag}`)
	const admin = await createTestUser(testDb, `gallery-admin-${tag}`)
	const [cast, voice] = await testDb
		.insert(schema.characters)
		.values([
			{ userId: owner.id, name: `Cast ${tag}`, description: "" },
			{
				userId: owner.id,
				name: `Voice ${tag}`,
				description: "",
				isPersona: true,
				aliases: []
			}
		])
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: `Gallery ${tag}` })
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: cast.id })
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: session.id, personaId: voice.id })
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id })
	return { owner, guest, stranger, admin, cast, voice }
}

const listed = (r: { emits: Array<[string, any]> }, characterId: number) =>
	r.emits.find(
		([event, data]) =>
			event === "characters:listGallery" &&
			data.characterId === characterId
	)?.[1]

describe("characters:listGallery — who may list a character's gallery", () => {
	test("its owner", async () => {
		const f = await fixture("own")
		const r = await list(f.owner.id, f.cast.id)
		expect(r.refused).toBeNull()
		expect(listed(r, f.cast.id)).toMatchObject({ characterId: f.cast.id })
		expect(Array.isArray(listed(r, f.cast.id).images)).toBe(true)
	})

	test("someone in a session it sits in — as cast, and as a voice", async () => {
		const f = await fixture("guest")
		for (const id of [f.cast.id, f.voice.id]) {
			const r = await list(f.guest.id, id)
			expect(r.refused).toBeNull()
			expect(listed(r, id)).toMatchObject({ characterId: id })
		}
	})

	test("a stranger is refused, with the id echoed and no images", async () => {
		const f = await fixture("stranger")
		const r = await list(f.stranger.id, f.cast.id)
		expect(r.refused).toBeInstanceOf(Error)
		expect(listed(r, f.cast.id)).toBeUndefined()
		expect(r.emits).toEqual([
			[
				"characters:listGallery:error",
				{
					error: "Character not found or access denied",
					characterId: f.cast.id
				}
			]
		])
	})

	test("an administrator", async () => {
		const f = await fixture("admin")
		const r = await list(f.admin.id, f.cast.id, true)
		expect(r.refused).toBeNull()
		expect(listed(r, f.cast.id)).toMatchObject({ characterId: f.cast.id })
	})
})
