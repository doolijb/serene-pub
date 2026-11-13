/**
 * Sprite writers take an owner — a card (a bare number, or `{ characterId }`)
 * or a cast member (`{ castMemberId }`) — and `copySpriteSetsToMember` gives a
 * member its card's sets, on a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-ownerWriters-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

let seed = 9000
let n = 0

async function world(label: string) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `${label}-${++n}` })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "" })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${n}` })
		.returning()
	const member = (
		await insertCastMember(testDb, {
			lorebookId: book.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		})
	).member
	const other = (
		await insertCastMember(testDb, {
			lorebookId: book.id,
			binding: `{{char:${n + 1000}}}`,
			name: "Other"
		})
	).member
	return { user, card, book, member, other }
}

async function fileRow(userId: number, h: Db = db()) {
	const [row] = await (h as unknown as TestDb)
		.insert(schema.files)
		.values({ userId, kind: "image", hash: `own-writers-${++n}` } as any)
		.returning()
	return row
}

describe("member-owner writers", () => {
	test("sets, defaults, sprites, labels, order and deletes", async () => {
		const s = await import("$lib/server/sprites")
		const w = await world("mw")
		const owner = { castMemberId: w.member.id }

		const calm = await s.createSpriteSet(db(), owner, "Calm")
		expect(calm.isDefault).toBe(true)
		expect(calm.castMemberId).toBe(w.member.id)
		expect(calm.characterId).toBeNull()
		const cloak = await s.createSpriteSet(db(), owner, "cloak")
		expect(cloak.isDefault).toBe(false)
		await expect(s.createSpriteSet(db(), owner, "cloak")).rejects.toThrow(
			/already a sprite set/
		)

		const renamed = await s.renameSpriteSet(db(), owner, cloak.id, "hood")
		expect(renamed.name).toBe("hood")
		await s.setDefaultSpriteSet(db(), owner, cloak.id)
		const sets = await s.listSpriteSets(db(), owner)
		expect(sets.map((x) => [x.name, x.isDefault])).toEqual([
			["hood", true],
			["calm", false]
		])
		await expect(s.deleteSpriteSet(db(), owner, cloak.id)).rejects.toThrow(
			/another sprite set the default/
		)

		const first = await s.addSprite(db(), {
			...owner,
			userId: w.user.id,
			setId: calm.id,
			label: "joy",
			bytes: png(seed++),
			source: "upload"
		})
		const [file] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, first.fileId!))
		expect(file.lorebookId).toBe(w.book.id)
		expect(file.characterId).toBeNull()

		const second = await s.addSprite(db(), {
			...owner,
			userId: w.user.id,
			setId: calm.id,
			label: "joy",
			bytes: png(seed++),
			source: "upload"
		})
		expect(second.position).toBe(1)
		await s.reorderSpriteVariants(db(), owner, calm.id, "joy", [
			second.id,
			first.id
		])
		const reordered = (await s.listSpriteSets(db(), owner)).find(
			(x) => x.id === calm.id
		)!
		expect(reordered.sprites.map((p) => [p.id, p.position])).toEqual([
			[second.id, 0],
			[first.id, 1]
		])

		expect(
			await s.addEmptySprites(db(), owner, calm.id, ["joy", "wary"])
		).toBe(1)
		const relabelled = await s.relabelSprite(db(), owner, first.id, "glad")
		expect(relabelled.label).toBe("glad")
		const moved = await s.moveSprite(db(), owner, first.id, cloak.id)
		expect(moved.spriteSetId).toBe(cloak.id)

		expect(await s.spriteFileIds(db(), owner)).toEqual(
			new Set([first.fileId, second.fileId])
		)

		await s.deleteSprite(db(), owner, first.id)
		const gone = await testDb
			.select()
			.from(schema.sprites)
			.where(eq(schema.sprites.id, first.id))
		expect(gone).toHaveLength(0)
		await s.setDefaultSpriteSet(db(), owner, calm.id)
		await s.deleteSpriteSet(db(), owner, cloak.id)
		expect(
			(await s.listSpriteSets(db(), owner)).map((x) => x.name)
		).toEqual(["calm"])
	})

	test("another owner's set and sprite are refused; a card by bare number still works", async () => {
		const s = await import("$lib/server/sprites")
		const w = await world("refuse")
		const mine = { castMemberId: w.member.id }
		const set = await s.createSpriteSet(db(), mine, "calm")
		await expect(
			s.requireSpriteSet(db(), { castMemberId: w.other.id }, set.id)
		).rejects.toThrow(/not found/)
		await expect(
			s.requireSpriteSet(db(), w.card.id, set.id)
		).rejects.toThrow(/not found/)
		const sprite = await s.addSprite(db(), {
			...mine,
			userId: w.user.id,
			label: "joy",
			bytes: png(seed++),
			source: "upload"
		})
		await expect(
			s.deleteSprite(db(), w.card.id, sprite.id)
		).rejects.toThrow(/not found/)

		const cardSet = await s.createSpriteSet(db(), w.card.id, "calm")
		expect(cardSet.characterId).toBe(w.card.id)
		expect(cardSet.castMemberId).toBeNull()
		expect(
			(await s.listSpriteSets(db(), w.card.id)).map((x) => x.id)
		).toEqual([cardSet.id])
		const imp = await s.importSprites(
			db(),
			w.user.id,
			{ castMemberId: w.other.id },
			[{ label: "joy", bytes: png(seed++) }],
			"upload"
		)
		expect(imp.added).toBe(1)
	})
})

describe("copySpriteSetsToMember", () => {
	async function cardWithArt(label: string) {
		const s = await import("$lib/server/sprites")
		const w = await world(label)
		await s.importSprites(
			db(),
			w.user.id,
			w.card.id,
			[
				{ label: "joy", bytes: png(seed++) },
				{ label: "joy", bytes: png(seed++) },
				{ label: "neutral", bytes: png(seed++) },
				{ set: "armour", label: "stern", bytes: png(seed++) }
			],
			"upload"
		)
		await s.addEmptySprites(db(), w.card.id, undefined, ["wary"])
		return { s, w }
	}

	test("sets, default, labels, variants and empty sprites arrive; the card is untouched; a second call is a no-op", async () => {
		const { s, w } = await cardWithArt("copy")
		const cardLabels = (await s.spriteLabelsFor(db(), [w.card.id])).get(
			w.card.id
		)!
		const cardBefore = await s.listSpriteSets(db(), w.card.id)
		const calls: number[] = []
		const out = await testDb.transaction((tx) =>
			s.copySpriteSetsToMember(
				tx as unknown as Db,
				w.card.id,
				w.member.id,
				async (fileId) => {
					calls.push(fileId)
					return (await fileRow(w.user.id, tx as unknown as Db)).id
				}
			)
		)
		expect(out).toEqual({ sets: 2, sprites: 5 })

		const memberLabels = (
			await s.spriteLabelsForMembers(db(), [w.member.id])
		).get(w.member.id)!
		expect(memberLabels).toEqual(cardLabels)

		const mine = await s.listSpriteSets(db(), { castMemberId: w.member.id })
		expect(mine.map((x) => [x.name, x.isDefault])).toEqual([
			["default", true],
			["armour", false]
		])
		const joy = mine[0].sprites.filter((p) => p.label === "joy")
		expect(joy.map((p) => p.position)).toEqual([0, 1])
		expect(
			mine[0].sprites.find((p) => p.label === "wary")?.media
		).toBeNull()

		// fileFor ran once per filed card sprite, and its answers are what the member wears.
		expect(calls).toHaveLength(4)
		const cardFileIds = new Set(
			cardBefore.flatMap((x) => x.sprites.map((p) => p.media?.id))
		)
		for (const p of mine.flatMap((x) => x.sprites))
			if (p.media) expect(cardFileIds.has(p.media.id)).toBe(false)

		expect(await s.listSpriteSets(db(), w.card.id)).toEqual(cardBefore)

		const again = await s.copySpriteSetsToMember(
			db(),
			w.card.id,
			w.member.id,
			async (id) => id
		)
		expect(again).toEqual({ sets: 0, sprites: 0 })
		expect(calls).toHaveLength(4)
		expect(
			await s.listSpriteSets(db(), { castMemberId: w.member.id })
		).toEqual(mine)
	})

	test("a member with its own image set gets nothing", async () => {
		const { s, w } = await cardWithArt("own")
		await s.addSprite(db(), {
			castMemberId: w.member.id,
			userId: w.user.id,
			label: "calm",
			bytes: png(seed++),
			source: "upload"
		})
		const fileFor = vi.fn(async (id: number) => id)
		const out = await s.copySpriteSetsToMember(
			db(),
			w.card.id,
			w.member.id,
			fileFor
		)
		expect(out).toEqual({ sets: 0, sprites: 0 })
		expect(fileFor).not.toHaveBeenCalled()
		expect(
			(await s.listSpriteSets(db(), { castMemberId: w.member.id })).map(
				(x) => x.name
			)
		).toEqual(["default"])
	})

	test("an empty member set of the card's name is filled, and takes the default", async () => {
		const { s, w } = await cardWithArt("empty")
		const own = await s.createSpriteSet(
			db(),
			{ castMemberId: w.member.id },
			"armour"
		)
		expect(own.isDefault).toBe(true)
		await s.copySpriteSetsToMember(
			db(),
			w.card.id,
			w.member.id,
			async (id) => id
		)
		const mine = await s.listSpriteSets(db(), { castMemberId: w.member.id })
		expect(mine.map((x) => [x.name, x.isDefault])).toEqual([
			["default", true],
			["armour", false]
		])
		expect(mine[1].id).toBe(own.id)
		expect(mine[1].sprites.map((p) => p.label)).toEqual(["stern"])
	})
})

describe("releaseSpriteFile", () => {
	test("a file a member's gallery links is kept", async () => {
		const s = await import("$lib/server/sprites")
		const w = await world("gallery")
		const sprite = await s.addSprite(db(), {
			castMemberId: w.member.id,
			userId: w.user.id,
			label: "joy",
			bytes: png(seed++),
			source: "upload"
		})
		await testDb
			.insert(schema.castMemberFiles)
			.values({ castMemberId: w.other.id, fileId: sprite.fileId! })
		await s.deleteSprite(db(), { castMemberId: w.member.id }, sprite.id)
		const rows = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, sprite.fileId!))
		expect(rows).toHaveLength(1)
	})

	test("deleting a sprite keeps nothing it should not: an unshared member file goes", async () => {
		const s = await import("$lib/server/sprites")
		const w = await world("release")
		const sprite = await s.addSprite(db(), {
			castMemberId: w.member.id,
			userId: w.user.id,
			label: "joy",
			bytes: png(seed++),
			source: "upload"
		})
		await s.deleteSprite(db(), { castMemberId: w.member.id }, sprite.id)
		const rows = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, sprite.fileId!))
			.orderBy(asc(schema.files.id))
		expect(rows).toHaveLength(0)
	})
})
