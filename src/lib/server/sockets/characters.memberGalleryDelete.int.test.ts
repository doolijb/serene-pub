/**
 * 🚧 Delete a picture from a cast member's gallery (★cp-del): whoever may edit
 * the member's lorebook removes the link, and the file goes only when nothing
 * else uses it. Nobody else changes anything.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let db: TestDb
let dataDir: string
let n = 0
let nextPicture = 1

function picture(): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(200)
	img.data[0] = nextPicture % 256
	img.data[1] = Math.floor(nextPicture / 256) % 256
	img.data[3] = 0
	nextPicture++
	return PNG.sync.write(img)
}

const socket = (userId: number) =>
	({ user: { id: userId, isAdmin: false } }) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-memberGalleryDelete-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function user(label: string) {
	const [u] = await db
		.insert(schema.users)
		.values({ username: `${label}-${++n}` })
		.returning()
	return u!
}

async function world() {
	const owner = await user("owner")
	const reader = await user("reader")
	const stranger = await user("stranger")
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${n}` })
		.returning()
	await db
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: reader.id })
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const make = async (name: string) =>
		(
			await insertCastMember(
				db as any,
				{
					lorebookId: book!.id,
					binding: `{{char:${++n}}}`,
					name
				} as any
			)
		).member
	return {
		owner,
		reader,
		stranger,
		book: book!,
		member: await make("Verity"),
		other: await make("Echo")
	}
}

async function pictureFor(
	w: Awaited<ReturnType<typeof world>>,
	memberIds: number[]
) {
	const { createMedia, addToMemberGallery } = await import(
		"$lib/server/media"
	)
	const { file } = await createMedia(db, {
		userId: w.owner.id,
		lorebookId: w.book.id,
		bytes: picture()
	})
	for (const id of memberIds) await addToMemberGallery(db, id, [file.id])
	return file
}

const fileGone = async (id: number) =>
	!(await db.query.files.findFirst({ where: eq(schema.files.id, id) }))
const links = async (castMemberId: number) =>
	db
		.select()
		.from(schema.castMemberFiles)
		.where(eq(schema.castMemberFiles.castMemberId, castMemberId))

async function del(userId: number, params: any) {
	const { charactersDeleteGalleryImage } = await import("./characters")
	const emits: Array<[string, any]> = []
	let refused: any = null
	try {
		await charactersDeleteGalleryImage.handler(
			socket(userId),
			params,
			(event: string, data: any) => emits.push([event, data])
		)
	} catch (e) {
		refused = e
	}
	return { emits, refused }
}

describe("characters:deleteGalleryImage on a cast member", () => {
	test("an editor deletes the picture: link and file go, the reply carries castMemberId and the list is re-sent", async () => {
		const w = await world()
		const file = await pictureFor(w, [w.member.id])
		const { emits, refused } = await del(w.owner.id, {
			castMemberId: w.member.id,
			mediaId: file.id
		})
		expect(refused).toBeNull()
		expect(await links(w.member.id)).toHaveLength(0)
		expect(await fileGone(file.id)).toBe(true)
		const ok = emits.find(([e]) => e === "characters:deleteGalleryImage")
		expect(ok![1]).toEqual({ success: true, castMemberId: w.member.id })
		expect(emits.some(([e]) => e === "characters:listGallery")).toBe(true)
	})

	test("a file a card, a sprite, another member or a version face uses is unlinked but kept", async () => {
		const w = await world()
		const viaCard = await pictureFor(w, [w.member.id])
		await db
			.update(schema.files)
			.set({ characterId: 1 })
			.where(eq(schema.files.id, viaCard.id))
		const viaSprite = await pictureFor(w, [w.member.id])
		const { ensureDefaultSpriteSet } = await import("$lib/server/sprites")
		const set = await ensureDefaultSpriteSet(db, {
			castMemberId: w.other.id
		})
		await db.insert(schema.sprites).values({
			spriteSetId: set.id,
			label: "neutral",
			fileId: viaSprite.id
		})
		const viaMember = await pictureFor(w, [w.member.id, w.other.id])
		for (const f of [viaCard, viaSprite, viaMember]) {
			const { refused } = await del(w.owner.id, {
				castMemberId: w.member.id,
				mediaId: f.id
			})
			expect(refused).toBeNull()
			expect(await fileGone(f.id)).toBe(false)
		}
		expect(await links(w.member.id)).toHaveLength(0)
		expect(await links(w.other.id)).toHaveLength(1)
	})

	test("a reader and a stranger are refused and nothing changes", async () => {
		const w = await world()
		const file = await pictureFor(w, [w.member.id])
		for (const who of [w.reader, w.stranger]) {
			const { refused } = await del(who.id, {
				castMemberId: w.member.id,
				mediaId: file.id
			})
			expect(refused).toBeInstanceOf(Error)
		}
		expect(await links(w.member.id)).toHaveLength(1)
		expect(await fileGone(file.id)).toBe(false)
	})

	test("a picture not in that member's gallery is refused and kept", async () => {
		const w = await world()
		const file = await pictureFor(w, [w.other.id])
		const { refused, emits } = await del(w.owner.id, {
			castMemberId: w.member.id,
			mediaId: file.id
		})
		expect(refused.message).toBe(
			"That picture is not in this cast member's gallery."
		)
		const err = emits.find(
			([e]) => e === "characters:deleteGalleryImage:error"
		)
		expect(err![1].castMemberId).toBe(w.member.id)
		expect(await links(w.other.id)).toHaveLength(1)
		expect(await fileGone(file.id)).toBe(false)
	})
})
