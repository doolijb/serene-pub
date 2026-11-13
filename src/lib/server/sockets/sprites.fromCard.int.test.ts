/**
 * 🚧 A cast member's list carries `fromCard` — the card's sprite sets, read-only
 * — while the card draws the member (owner 2026-11-09: "Cast by default
 * cascades"). The rule is `memberDrawsOwnSprites`; the read rule is the
 * member's, so a reader who may read the member but not its card still gets it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let db: TestDb
let dataDir: string
let n = 0
let seed = 9000

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-spritesFromCard-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({ user: { id: userId, isAdmin: false } }) as any
const noop = () => {}

function png(): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	seed++
	return PNG.sync.write(img)
}

async function user(label: string) {
	const [u] = await db
		.insert(schema.users)
		.values({ username: `${label}-${++n}` })
		.returning()
	return u!
}

/** A card with sprites; a book (shared with `reader`) whose member is linked to it. */
async function scene(opts: { cardless?: boolean; cardSprites?: boolean } = {}) {
	const { importSprites } = await import("$lib/server/sprites")
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const owner = await user("owner")
	const reader = await user("reader")
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Verity", description: "" })
		.returning()
	if (opts.cardSprites !== false)
		await importSprites(
			db as any,
			owner.id,
			card!.id,
			[
				{ label: "joy", bytes: png() },
				{ set: "armour", label: "stern", bytes: png() }
			],
			"upload"
		)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${n}` })
		.returning()
	await db
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: reader.id })
	const { member } = await insertCastMember(
		db as any,
		{
			lorebookId: book!.id,
			...(opts.cardless ? {} : { characterId: card!.id }),
			binding: `{{char:${n}}}`,
			name: "Verity"
		} as any
	)
	return { owner, reader, card: card!, book: book!, member }
}

const list = async (userId: number, params: any) => {
	const s = await import("./sprites")
	return (await s.charactersListSprites.handler(
		socket(userId),
		params,
		noop
	)) as any
}

describe("fromCard on a cast member's list", () => {
	test("a reader who may read the member but not the card gets the card's sets, and only characterId + sets", async () => {
		const { reader, card, member } = await scene()
		const { canViewCharacter } = await import(
			"$lib/server/utils/sessionAccess"
		)
		expect(await canViewCharacter(card.id, reader.id, db as any)).toBe(
			false
		)
		const res = await list(reader.id, { castMemberId: member.id })
		expect(res.sets).toEqual([])
		expect(Object.keys(res.fromCard).sort()).toEqual([
			"characterId",
			"sets"
		])
		expect(res.fromCard.characterId).toBe(card.id)
		expect(res.fromCard.sets.map((s: any) => s.name).sort()).toEqual([
			"armour",
			"default"
		])
	})

	test("that reader can now load the card's sprite files through the member (★s4-fb-4)", async () => {
		const { reader, owner, card, member } = await scene()
		const res = await list(reader.id, { castMemberId: member.id })
		const fileId = res.fromCard.sets[0].sprites[0].media.id
		const [file] = await db
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, fileId))
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(file!, owner.id, db as any)).toBe(true)
		// ★s4-fb-4 (owner 2026-11-10): permissions cascade through the cast member.
		expect(await canViewMedia(file!, reader.id, db as any)).toBe(true)
		expect(card.id).toBeGreaterThan(0)
	})

	test("a member with its own sets with pictures gets no fromCard", async () => {
		const { owner, member } = await scene()
		const { addSprite, ensureDefaultSpriteSet } = await import(
			"$lib/server/sprites"
		)
		const own = await ensureDefaultSpriteSet(db as any, {
			castMemberId: member.id
		})
		await addSprite(
			db as any,
			{
				userId: owner.id,
				castMemberId: member.id,
				setId: own.id,
				label: "calm",
				bytes: png(),
				filename: null,
				source: "upload"
			} as any
		)
		const res = await list(owner.id, { castMemberId: member.id })
		expect(res.sets.length).toBe(1)
		expect("fromCard" in res).toBe(false)
	})

	test("a member with only empty own sets still gets fromCard", async () => {
		const { owner, member } = await scene()
		const { ensureDefaultSpriteSet } = await import("$lib/server/sprites")
		await ensureDefaultSpriteSet(db as any, { castMemberId: member.id })
		const res = await list(owner.id, { castMemberId: member.id })
		expect(res.sets.length).toBe(1)
		expect(res.fromCard.sets.length).toBe(2)
	})

	test("a card-less member gets none", async () => {
		const { owner, member } = await scene({ cardless: true })
		const res = await list(owner.id, { castMemberId: member.id })
		expect(res.sets).toEqual([])
		expect("fromCard" in res).toBe(false)
	})

	test("a linked card with no pictures sends none", async () => {
		const { owner, member } = await scene({ cardSprites: false })
		const res = await list(owner.id, { castMemberId: member.id })
		expect("fromCard" in res).toBe(false)
	})

	test("a reader who cannot read the member is still refused", async () => {
		const { member } = await scene()
		const stranger = await user("stranger")
		await expect(
			list(stranger.id, { castMemberId: member.id })
		).rejects.toThrow()
	})

	test("a card owner's list has no fromCard", async () => {
		const { owner, card } = await scene()
		const res = await list(owner.id, { characterId: card.id })
		expect(res.sets.length).toBe(2)
		expect("fromCard" in res).toBe(false)
	})

	test("after the member uploads its first sprite, the write's reply carries no fromCard", async () => {
		const { owner, member } = await scene()
		const s = await import("./sprites")
		const before = await list(owner.id, { castMemberId: member.id })
		expect(before.fromCard).toBeDefined()
		const made = (await s.charactersCreateSpriteSet.handler(
			socket(owner.id),
			{ castMemberId: member.id, name: "mine" },
			noop
		)) as any
		const setId = made.sets[0].id
		expect(made.fromCard).toBeDefined()
		const up = (await s.charactersUploadSprite.handler(
			socket(owner.id),
			{
				castMemberId: member.id,
				setId,
				label: "calm",
				imageFile: new Uint8Array(png()),
				filename: "calm.png"
			} as any,
			noop
		)) as any
		expect(up.sets.length).toBe(1)
		expect("fromCard" in up).toBe(false)
	})
})
