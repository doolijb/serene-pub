/**
 * `cardNameplatesNow`: the narrow read equals `cardsNow` on the four face fields,
 * and writes nothing for a card with no version.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, newCardVersion } from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"
import { cardNameplatesNow, cardsNow } from "./seatedCast"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardfaces-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("cardNameplatesNow", () => {
	test("equals cardsNow on the face fields; no write for a version-less card", async () => {
		const [u] = await testDb
			.insert(schema.users)
			.values({ username: "cardfaces-user" })
			.returning()
		const [file] = await testDb
			.insert(schema.files)
			.values({
				userId: u!.id,
				kind: "image",
				hash: "cardfaces-face"
			} as any)
			.returning()

		const a = await insertCard(testDb, {
			userId: u!.id,
			name: "Ann",
			description: ""
		})
		await newCardVersion(testDb, a.card.id, {
			...profileOf(a.version),
			name: "Ann Vale",
			nickname: "Annie"
		})
		const b = await insertCard(testDb, {
			userId: u!.id,
			name: "Bo",
			description: ""
		})
		await newCardVersion(testDb, b.card.id, {
			...profileOf(b.version),
			faceMediaId: file!.id
		})
		const del = await insertCard(testDb, {
			userId: u!.id,
			name: "Gone",
			description: ""
		})
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, del.card.id))
		const [raw] = await testDb
			.insert(schema.characters)
			.values({
				userId: u!.id,
				name: "Raw",
				nickname: "R",
				description: ""
			})
			.returning()

		const count = async () =>
			(await testDb.select().from(schema.characterVersions)).filter(
				(v) => v.cardId === raw!.id
			).length
		expect(await count()).toBe(0)

		const ids = [a.card.id, b.card.id, del.card.id, raw!.id, 99999999]
		const faces = await cardNameplatesNow(testDb, ids)
		expect(await count()).toBe(0)
		expect(faces.has(99999999)).toBe(false)

		const now = await cardsNow(testDb, ids)
		for (const id of ids.slice(0, 4)) {
			const n = now.get(id)!
			expect(faces.get(id)).toEqual({
				id: n.id,
				name: n.name,
				nickname: n.nickname,
				avatarMediaId: n.avatarMediaId
			})
		}
		expect(faces.get(a.card.id)).toMatchObject({
			name: "Ann Vale",
			nickname: "Annie"
		})
	})
})
