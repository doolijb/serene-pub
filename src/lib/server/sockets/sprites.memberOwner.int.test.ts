/**
 * `characters:*Sprite*` and the gallery handlers with `{ castMemberId }`: a
 * cast member's own sets and pictures, read by whoever may read its book and
 * written by whoever may edit it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-vitest-memberOwnerSockets-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

const socket = (userId: number) => ({ user: { id: userId } }) as any
const noop = () => {}
let seed = 31000
let n = 0

async function world() {
	const mk = async (label: string) =>
		(
			await testDb
				.insert(schema.users)
				.values({ username: `${label}-${++n}` })
				.returning()
		)[0]!
	const owner = await mk("owner")
	const reader = await mk("reader")
	const stranger = await mk("stranger")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${n}` })
		.returning()
	await testDb
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: reader.id })
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book!.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		})
		.returning()
	const [other] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book!.id,
			binding: `{{char:${n + 500}}}`,
			name: "Other"
		})
		.returning()
	return {
		owner,
		reader,
		stranger,
		book: book!,
		member: member!,
		other: other!
	}
}

const WRITE_REFUSAL =
	"Only someone who can edit this cast member's lorebook can change its sprites."
const PICTURE_REFUSAL =
	"Only someone who can edit this cast member's lorebook can change its pictures."

describe("member sprite sets over the sprite socket family", () => {
	test("the book's owner creates a set, uploads a sprite and lists; replies carry castMemberId", async () => {
		const s = await import("./sprites")
		const w = await world()
		const created = await s.charactersCreateSpriteSet.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id, name: "armour" },
			noop
		)
		expect(created).toMatchObject({ castMemberId: w.member.id })
		expect("characterId" in created).toBe(false)
		const uploaded = await s.charactersUploadSprite.handler(
			socket(w.owner.id),
			{
				castMemberId: w.member.id,
				setId: created.sets[0]!.id,
				label: "joy",
				imageFile: png(seed++),
				filename: "joy.png"
			},
			noop
		)
		expect(uploaded.sets[0]!.sprites).toHaveLength(1)
		// The file is the book's: provenance the book, owned by the book's owner.
		const [file] = await testDb.select().from(schema.files)
		expect(file).toMatchObject({
			userId: w.owner.id,
			lorebookId: w.book.id
		})
		// The other member of the book has none of it.
		const others = await s.charactersListSprites.handler(
			socket(w.owner.id),
			{ castMemberId: w.other.id },
			noop
		)
		expect(others.sets).toEqual([])
		const listed = await s.charactersListSprites.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id },
			noop
		)
		expect(listed).toMatchObject({ castMemberId: w.member.id })
		expect(listed.sets.map((x) => x.name)).toEqual(["armour"])
	})

	test("a reader lists but cannot write; the error carries castMemberId and says what to do", async () => {
		const s = await import("./sprites")
		const w = await world()
		await s.charactersCreateSpriteSet.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id, name: "armour" },
			noop
		)
		const listed = await s.charactersListSprites.handler(
			socket(w.reader.id),
			{ castMemberId: w.member.id },
			noop
		)
		expect(listed.sets).toHaveLength(1)
		const emitted: [string, any][] = []
		await expect(
			s.charactersCreateSpriteSet.handler(
				socket(w.reader.id),
				{ castMemberId: w.member.id, name: "cloak" },
				(e: string, d: any) => emitted.push([e, d])
			)
		).rejects.toThrow(WRITE_REFUSAL)
		expect(emitted).toEqual([
			[
				"characters:createSpriteSet:error",
				{ error: WRITE_REFUSAL, castMemberId: w.member.id }
			]
		])
	})

	test("a stranger is refused as if the member did not exist; both ids and neither are refused", async () => {
		const s = await import("./sprites")
		const w = await world()
		await expect(
			s.charactersListSprites.handler(
				socket(w.stranger.id),
				{ castMemberId: w.member.id },
				noop
			)
		).rejects.toThrow("Cast member not found.")
		await expect(
			s.charactersCreateSpriteSet.handler(
				socket(w.stranger.id),
				{ castMemberId: w.member.id, name: "x" },
				noop
			)
		).rejects.toThrow("Cast member not found.")
		const both = "Name a character or a cast member, not both."
		await expect(
			s.charactersListSprites.handler(
				socket(w.owner.id),
				{ castMemberId: w.member.id, characterId: 1 },
				noop
			)
		).rejects.toThrow(both)
		await expect(
			s.charactersListSprites.handler(socket(w.owner.id), {} as any, noop)
		).rejects.toThrow(both)
	})
})

describe("member gallery over the gallery handlers", () => {
	test("the owner uploads and reorders; sprite files stay out of the list; replies carry castMemberId", async () => {
		const s = await import("./sprites")
		const c = await import("./characters")
		const w = await world()
		const set = await s.charactersCreateSpriteSet.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id, name: "armour" },
			noop
		)
		await s.charactersUploadSprite.handler(
			socket(w.owner.id),
			{
				castMemberId: w.member.id,
				setId: set.sets[0]!.id,
				label: "joy",
				imageFile: png(seed++)
			},
			noop
		)
		const first = await c.charactersUploadGalleryImage.handler(
			socket(w.owner.id),
			{
				castMemberId: w.member.id,
				imageFile: png(seed++),
				mimeType: "image/png"
			},
			noop
		)
		const second = await c.charactersUploadGalleryImage.handler(
			socket(w.owner.id),
			{
				castMemberId: w.member.id,
				imageFile: png(seed++),
				mimeType: "image/png"
			},
			noop
		)
		expect(first).toMatchObject({
			success: true,
			castMemberId: w.member.id
		})
		expect("characterId" in first).toBe(false)
		const listed = await c.charactersListGallery.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id },
			noop
		)
		expect(listed.castMemberId).toBe(w.member.id)
		expect(listed.images.map((i) => i.id)).toEqual([
			first.media.id,
			second.media.id
		])
		const reordered = await c.charactersReorderGallery.handler(
			socket(w.owner.id),
			{
				castMemberId: w.member.id,
				mediaIds: [second.media.id, first.media.id]
			},
			noop
		)
		expect(reordered.castMemberId).toBe(w.member.id)
		expect(reordered.images.map((i) => i.id)).toEqual([
			second.media.id,
			first.media.id
		])
		const links = await testDb.select().from(schema.castMemberFiles)
		expect(
			links.filter((l) => l.castMemberId === w.member.id)
		).toHaveLength(2)
	})

	test("a reader lists but cannot upload or reorder; a stranger and both ids are refused", async () => {
		const c = await import("./characters")
		const w = await world()
		const up = await c.charactersUploadGalleryImage.handler(
			socket(w.owner.id),
			{
				castMemberId: w.member.id,
				imageFile: png(seed++),
				mimeType: "image/png"
			},
			noop
		)
		const listed = await c.charactersListGallery.handler(
			socket(w.reader.id),
			{ castMemberId: w.member.id },
			noop
		)
		expect(listed.images).toHaveLength(1)
		await expect(
			c.charactersUploadGalleryImage.handler(
				socket(w.reader.id),
				{
					castMemberId: w.member.id,
					imageFile: png(seed++),
					mimeType: "image/png"
				},
				noop
			)
		).rejects.toThrow(PICTURE_REFUSAL)
		await expect(
			c.charactersReorderGallery.handler(
				socket(w.reader.id),
				{ castMemberId: w.member.id, mediaIds: [up.media.id] },
				noop
			)
		).rejects.toThrow(PICTURE_REFUSAL)
		await expect(
			c.charactersListGallery.handler(
				socket(w.stranger.id),
				{ castMemberId: w.member.id },
				noop
			)
		).rejects.toThrow("Cast member not found.")
		await expect(
			c.charactersListGallery.handler(
				socket(w.owner.id),
				{ castMemberId: w.member.id, characterId: 1 },
				noop
			)
		).rejects.toThrow("Name a character or a cast member, not both.")
	})
})
