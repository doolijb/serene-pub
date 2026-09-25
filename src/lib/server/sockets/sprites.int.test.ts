/**
 * Sprites — the storage layer and the `characters:*Sprite*` socket family
 * (DESIGN-sprites §3, §7), against a real PGlite database.
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-sprites-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A real PNG whose bytes differ per `seed` (uploads dedupe on hash). */
function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

async function setup(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, username)
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "" })
		.returning()
	return { user, character }
}

const socket = (userId: number) => ({ user: { id: userId } }) as any
function capture() {
	const emitted: { event: string; data: any }[] = []
	return { emitted, emit: (event: string, data: any) => emitted.push({ event, data }) }
}

describe("sprites storage", () => {
	test("the first upload creates the default set; labels normalise", async () => {
		const { charactersUploadSprite } = await import("./sprites")
		const { user, character } = await setup("sprites-first")
		const { emit } = capture()
		const res = await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "  Joy ", imageFile: png(1) },
			emit
		)
		expect(res.characterId).toBe(character.id)
		expect(res.sets).toHaveLength(1)
		expect(res.sets[0]).toMatchObject({ name: "default", isDefault: true })
		expect(res.sets[0].sprites).toHaveLength(1)
		expect(res.sets[0].sprites[0]).toMatchObject({ label: "joy", position: 0 })
		expect(res.sets[0].sprites[0].media?.uuid).toBeTruthy()
	}, 60_000)

	test("variants append under a label; the same bytes twice add nothing", async () => {
		const { charactersUploadSprite } = await import("./sprites")
		const { user, character } = await setup("sprites-variants")
		const up = (seed: number) =>
			charactersUploadSprite.handler(
				socket(user.id),
				{ characterId: character.id, label: "joy", imageFile: png(seed) },
				capture().emit
			)
		await up(10)
		await up(11)
		const res = await up(11)
		const joys = res.sets[0].sprites.filter((s) => s.label === "joy")
		expect(joys.map((s) => s.position)).toEqual([0, 1])
	}, 60_000)

	test("the standard set makes empty slots, and an upload fills its slot", async () => {
		const { charactersAddStandardSprites, charactersUploadSprite } =
			await import("./sprites")
		const { user, character } = await setup("sprites-standard")
		const added = await charactersAddStandardSprites.handler(
			socket(user.id),
			{ characterId: character.id },
			capture().emit
		)
		expect(added.added).toBe(28)
		expect(added.sets[0].sprites.every((s) => s.media === null)).toBe(true)
		const res = await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "Anger", imageFile: png(20) },
			capture().emit
		)
		const anger = res.sets[0].sprites.filter((s) => s.label === "anger")
		expect(anger).toHaveLength(1)
		expect(anger[0].media).not.toBeNull()
		// Adding the standard set again adds nothing.
		const again = await charactersAddStandardSprites.handler(
			socket(user.id),
			{ characterId: character.id },
			capture().emit
		)
		expect(again.added).toBe(0)
	}, 60_000)

	test("sets: create, rename, make default, and the default cannot be deleted while others exist", async () => {
		const {
			charactersCreateSpriteSet,
			charactersUpdateSpriteSet,
			charactersDeleteSpriteSet
		} = await import("./sprites")
		const { user, character } = await setup("sprites-sets")
		const first = await charactersCreateSpriteSet.handler(
			socket(user.id),
			{ characterId: character.id, name: "Everyday" },
			capture().emit
		)
		expect(first.sets[0]).toMatchObject({ name: "everyday", isDefault: true })
		const second = await charactersCreateSpriteSet.handler(
			socket(user.id),
			{ characterId: character.id, name: "Armour" },
			capture().emit
		)
		const armour = second.sets.find((s) => s.name === "armour")!
		expect(armour.isDefault).toBe(false)

		await expect(
			charactersCreateSpriteSet.handler(
				socket(user.id),
				{ characterId: character.id, name: " ARMOUR " },
				capture().emit
			)
		).rejects.toThrow(/already a sprite set/)

		const everyday = second.sets.find((s) => s.name === "everyday")!
		const { emitted, emit } = capture()
		await expect(
			charactersDeleteSpriteSet.handler(
				socket(user.id),
				{ characterId: character.id, setId: everyday.id },
				emit
			)
		).rejects.toThrow(/default/)
		expect(emitted[0]).toMatchObject({
			event: "characters:deleteSpriteSet:error",
			data: { characterId: character.id }
		})

		const swapped = await charactersUpdateSpriteSet.handler(
			socket(user.id),
			{ characterId: character.id, setId: armour.id, makeDefault: true, name: "Plate" },
			capture().emit
		)
		expect(swapped.sets[0]).toMatchObject({ name: "plate", isDefault: true })
		const after = await charactersDeleteSpriteSet.handler(
			socket(user.id),
			{ characterId: character.id, setId: everyday.id },
			capture().emit
		)
		expect(after.sets.map((s) => s.name)).toEqual(["plate"])
	}, 60_000)

	test("relabel, move, reorder", async () => {
		const {
			charactersUploadSprite,
			charactersCreateSpriteSet,
			charactersUpdateSprite,
			charactersReorderSprites
		} = await import("./sprites")
		const { user, character } = await setup("sprites-edit")
		const up = (label: string, seed: number) =>
			charactersUploadSprite.handler(
				socket(user.id),
				{ characterId: character.id, label, imageFile: png(seed) },
				capture().emit
			)
		await up("joy", 30)
		await up("joy", 31)
		const r = await up("sad", 32)
		const set = r.sets[0]
		const [joyA, joyB] = set.sprites.filter((s) => s.label === "joy")

		const reordered = await charactersReorderSprites.handler(
			socket(user.id),
			{ characterId: character.id, setId: set.id, label: "joy", spriteIds: [joyB.id, joyA.id] },
			capture().emit
		)
		const joys = reordered.sets[0].sprites.filter((s) => s.label === "joy")
		expect(joys.map((s) => s.id)).toEqual([joyB.id, joyA.id])

		const sad = set.sprites.find((s) => s.label === "sad")!
		const relabelled = await charactersUpdateSprite.handler(
			socket(user.id),
			{ characterId: character.id, spriteId: sad.id, label: "joy" },
			capture().emit
		)
		expect(
			relabelled.sets[0].sprites.filter((s) => s.label === "joy").map((s) => s.position)
		).toEqual([0, 1, 2])

		const created = await charactersCreateSpriteSet.handler(
			socket(user.id),
			{ characterId: character.id, name: "night" },
			capture().emit
		)
		const night = created.sets.find((s) => s.name === "night")!
		const moved = await charactersUpdateSprite.handler(
			socket(user.id),
			{ characterId: character.id, spriteId: joyA.id, setId: night.id },
			capture().emit
		)
		expect(moved.sets.find((s) => s.name === "night")!.sprites.map((s) => s.id)).toEqual([
			joyA.id
		])
	}, 60_000)

	test("deleting a sprite deletes its file, unless the file is also the avatar", async () => {
		const { charactersUploadSprite, charactersDeleteSprite } = await import("./sprites")
		const { user, character } = await setup("sprites-delete")
		const a = await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "joy", imageFile: png(40) },
			capture().emit
		)
		const joy = a.sets[0].sprites[0]
		const b = await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "neutral", imageFile: png(41) },
			capture().emit
		)
		const neutral = b.sets[0].sprites.find((s) => s.label === "neutral")!
		await testDb
			.update(schema.characters)
			.set({ avatarMediaId: neutral.media!.id })
			.where(eq(schema.characters.id, character.id))

		await charactersDeleteSprite.handler(
			socket(user.id),
			{ characterId: character.id, spriteId: joy.id },
			capture().emit
		)
		await charactersDeleteSprite.handler(
			socket(user.id),
			{ characterId: character.id, spriteId: neutral.id },
			capture().emit
		)
		const joyFile = await testDb.query.files.findFirst({
			where: eq(schema.files.id, joy.media!.id)
		})
		const avatarFile = await testDb.query.files.findFirst({
			where: eq(schema.files.id, neutral.media!.id)
		})
		expect(joyFile).toBeUndefined()
		expect(avatarFile).toBeDefined()
	}, 60_000)

	test("the gallery leaves sprites out but keeps the avatar", async () => {
		const { charactersUploadSprite } = await import("./sprites")
		const { listCharacterGallery, uploadCharacterGalleryImage } = await import(
			"$lib/server/utils"
		)
		const { user, character } = await setup("sprites-gallery")
		const gallery = await uploadCharacterGalleryImage({
			characterId: character.id,
			userId: user.id,
			imageFile: png(50)
		})
		const s1 = await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "joy", imageFile: png(51) },
			capture().emit
		)
		const s2 = await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "neutral", imageFile: png(52) },
			capture().emit
		)
		const neutralId = s2.sets[0].sprites.find((s) => s.label === "neutral")!.media!.id
		await testDb
			.update(schema.characters)
			.set({ avatarMediaId: neutralId })
			.where(eq(schema.characters.id, character.id))

		const ids = (await listCharacterGallery({ characterId: character.id })).map(
			(m) => m.id
		)
		expect(ids).toContain(gallery.file.id)
		expect(ids).toContain(neutralId)
		expect(ids).not.toContain(s1.sets[0].sprites[0].media!.id)
	}, 60_000)

	test("writes need ownership; reads need visibility; errors carry characterId", async () => {
		const { charactersUploadSprite, charactersListSprites } = await import("./sprites")
		const { character } = await setup("sprites-owner")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, "sprites-stranger")
		const { emitted, emit } = capture()
		await expect(
			charactersUploadSprite.handler(
				socket(stranger.id),
				{ characterId: character.id, label: "joy", imageFile: png(60) },
				emit
			)
		).rejects.toThrow(/access denied/)
		await expect(
			charactersListSprites.handler(socket(stranger.id), { characterId: character.id }, emit)
		).rejects.toThrow(/access denied/)
		expect(emitted.map((e) => e.event)).toEqual([
			"characters:uploadSprite:error",
			"characters:listSprites:error"
		])
		expect(emitted.every((e) => e.data.characterId === character.id)).toBe(true)
	}, 60_000)

	test("the owner can list a character that sits in no session (found in a browser walk)", async () => {
		const { charactersListSprites, charactersUploadSprite } = await import("./sprites")
		const { user, character } = await setup("sprites-owner-list")
		await charactersUploadSprite.handler(
			socket(user.id),
			{ characterId: character.id, label: "joy", imageFile: png(80) },
			capture().emit
		)
		const res = await charactersListSprites.handler(
			socket(user.id),
			{ characterId: character.id },
			capture().emit
		)
		expect(res.sets[0].sprites.map((s) => s.label)).toEqual(["joy"])
	}, 60_000)

	test("importSprites: sets by name, bad images skipped and reported", async () => {
		const { importSprites, listSpriteSets } = await import("$lib/server/sprites")
		const { user, character } = await setup("sprites-import")
		const result = await importSprites(
			testDb as any,
			user.id,
			character.id,
			[
				{ label: "joy", bytes: png(70) },
				{ set: "Armour", label: "joy", bytes: png(71) },
				{ label: "broken", bytes: Buffer.from("not an image") }
			],
			"card"
		)
		expect(result.added).toBe(2)
		expect(result.skipped.map((s) => s.label)).toEqual(["broken"])
		const sets = await listSpriteSets(testDb as any, character.id)
		expect(sets.map((s) => [s.name, s.isDefault])).toEqual([
			["default", true],
			["armour", false]
		])
	}, 60_000)
})
