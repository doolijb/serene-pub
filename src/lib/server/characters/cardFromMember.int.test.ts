/**
 * `cardFromMember` — Copy to my characters, from a cast member: a new card of
 * the asker's with the member's words (v1, no label), its art as the asker's
 * own files, its sprites, gallery, stats and (when readable) tags; and who may
 * ask, through `characters:duplicate { castMemberId }`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import zlib from "node:zlib"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	newCardVersion,
	writeCastVersion
} from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/sockets/utils/userPush", () => ({ pushToUser: vi.fn() }))
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/embedding/vectorizationQueue")
		>()
	return { ...actual, autoEnqueueCharacter: vi.fn(async () => {}) }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardfrommember-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit() {} }) } }) as any
const noopEmit = (() => {}) as any
const base = { branchId: null, date: null, personalPosition: null }

let n = 0
const uniq = (label: string) => `${label}-${++n}`

/** A real, distinct 2x2 PNG per seed (createMedia shares one row per user and bytes). */
function png(seed: number): Buffer {
	const crc32 = (buf: Buffer) => {
		let c
		let crc = ~0
		for (const b of buf) {
			c = (crc ^ b) & 0xff
			for (let k = 0; k < 8; k++)
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
			crc = (crc >>> 8) ^ c
		}
		return ~crc >>> 0
	}
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4)
		len.writeUInt32BE(data.length)
		const body = Buffer.concat([Buffer.from(type), data])
		const crc = Buffer.alloc(4)
		crc.writeUInt32BE(crc32(body))
		return Buffer.concat([len, body, crc])
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(2, 0)
	ihdr.writeUInt32BE(2, 4)
	ihdr[8] = 8
	ihdr[9] = 2
	const row = Buffer.from([0, seed & 255, (seed >> 8) & 255, 7, 1, 2, 3])
	const raw = Buffer.concat([row, row])
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0))
	])
}

const user = async () =>
	(await import("$lib/server/utils/testDb")).createTestUser(
		testDb,
		uniq("cfm")
	)

/** The owner O, a book of O's shared with the asker A, a stranger S and a guest G. */
async function people() {
	const O = await user()
	const A = await user()
	const S = await user()
	const G = await user()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: O.id, name: uniq("Book") } as any)
		.returning()
	await testDb
		.insert(schema.lorebookShares)
		.values({ lorebookId: book.id, userId: A.id } as any)
	return { O, A, S, G, book }
}
type People = Awaited<ReturnType<typeof people>>

async function memberIn(
	p: People,
	opts: {
		card?: { id: number } | null
		name?: string
		own?: Record<string, unknown>
	} = {}
) {
	const { member } = await insertCastMember(db(), {
		lorebookId: p.book.id,
		characterId: opts.card?.id ?? null,
		binding: `{{char:${++n}}}`,
		name: opts.name ?? (opts.card ? "Linked" : uniq("Bare")),
		...(opts.own ?? {})
	} as any)
	return member
}

/** Run the copy as `userId` on one transaction, as the handler does. */
async function copy(castMemberId: number, userId: number) {
	const { cardFromMember } = await import(
		"$lib/server/characters/cardFromMember"
	)
	return testDb.transaction((tx) =>
		cardFromMember(tx as unknown as Db, { castMemberId, userId })
	)
}

async function versionsOf(cardId: number) {
	return testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))
}

async function fileRow(id: number) {
	return (
		await testDb.select().from(schema.files).where(eq(schema.files.id, id))
	)[0]
}

async function spriteFiles(cardId: number) {
	return (
		await testDb
			.select({
				set: schema.spriteSets.name,
				fileId: schema.sprites.fileId
			})
			.from(schema.sprites)
			.innerJoin(
				schema.spriteSets,
				eq(schema.spriteSets.id, schema.sprites.spriteSetId)
			)
			.where(eq(schema.spriteSets.characterId, cardId))
	).filter((r) => r.fileId != null)
}

describe("cardFromMember", () => {
	it("copies a card-less member's own words into a card of the asker's, v1 with no label and no link back", async () => {
		const p = await people()
		const member = await memberIn(p, {
			name: "Orla",
			own: { description: "Tall and wry.", personality: "Dry." }
		})
		const out = await copy(member.id, p.A.id)

		expect(out.card.userId).toBe(p.A.id)
		expect(out.card.name).toBe("Orla")
		expect(out.card.description).toBe("Tall and wry.")
		expect(out.card.personality).toBe("Dry.")
		expect(out.card.lorebookId).toBeNull()
		expect(out.card.isPersona).toBe(false)
		const versions = await versionsOf(out.card.id)
		expect(versions).toHaveLength(1)
		expect(versions[0].number).toBe(1)
		expect(versions[0].label).toBeNull()
		expect(versions[0].description).toBe("Tall and wry.")
		// Nothing points at the member.
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.characterId, out.card.id))
		).toHaveLength(0)
	})

	it("a member with retold fields: its own description over its card's, the card's other fields", async () => {
		const p = await people()
		const { card } = await insertCard(db(), {
			userId: p.O.id,
			name: "Mara",
			description: "Card description.",
			personality: "Card personality."
		} as any)
		const member = await memberIn(p, { card, name: "Mara" })
		await writeCastVersion(db(), {
			member: member.id,
			changes: { description: "Member description." },
			writtenBy: `user:${p.O.id}`,
			at: base
		})
		const out = await copy(member.id, p.A.id)
		expect(out.card.description).toBe("Member description.")
		expect(out.card.personality).toBe("Card personality.")
		const [v1] = await versionsOf(out.card.id)
		expect(v1.personality).toBe("Card personality.")
		expect(v1.label).toBeNull()
	})

	it("a member behind its card copies the older version's words", async () => {
		const p = await people()
		const { card, version } = await insertCard(db(), {
			userId: p.O.id,
			name: "Mara",
			description: "Old words."
		} as any)
		const member = await memberIn(p, { card, name: "Mara" })
		await newCardVersion(db(), card.id, {
			...profileOf(version),
			description: "New words."
		})
		const out = await copy(member.id, p.A.id)
		expect(out.card.description).toBe("Old words.")
	})

	it("the face is a new file of the asker's on the copy", async () => {
		const { createMedia } = await import("$lib/server/media")
		const p = await people()
		const bytes = png(++n)
		const face = (await createMedia(db(), { userId: p.O.id, bytes })).file
		const { card } = await insertCard(db(), {
			userId: p.O.id,
			name: "Mara",
			description: "x",
			avatarMediaId: face.id
		} as any)
		const member = await memberIn(p, { card, name: "Mara" })
		const out = await copy(member.id, p.A.id)

		expect(out.card.avatarMediaId).not.toBeNull()
		expect(out.card.avatarMediaId).not.toBe(face.id)
		const row = await fileRow(out.card.avatarMediaId!)
		expect(row.userId).toBe(p.A.id)
		expect(row.characterId).toBe(out.card.id)
		const [v1] = await versionsOf(out.card.id)
		expect(v1.faceMediaId).toBe(row.id)

		// The same bytes the asker already holds come back as the asker's row.
		const again = await copy(member.id, p.A.id)
		expect(again.card.avatarMediaId).toBe(row.id)
	})

	it("stats arrive as the card's defaults; a session's value does not; a slot a card may not carry is skipped", async () => {
		const { declareSlot, declareSheet } = await import(
			"$lib/server/state/declarations"
		)
		const p = await people()
		const slot = `cfm${n}:slot/hp@1`
		const worldSlot = `cfm${n}:slot/doom@1`
		await declareSlot(
			testDb,
			p.O.id,
			slot as any,
			{
				type: "integer",
				label: { en: "HP" },
				descriptor: "Hit points.",
				appliesTo: ["cast"],
				config: { min: 0, max: 100 },
				default: 10
			} as any
		)
		await declareSlot(
			testDb,
			p.O.id,
			worldSlot as any,
			{
				type: "integer",
				label: { en: "Doom" },
				descriptor: "Doom.",
				appliesTo: ["world"],
				default: 0
			} as any
		)
		const sheetId = `cfm${n}:sheet/a@1`
		await declareSheet(
			testDb,
			p.O.id,
			sheetId as any,
			{
				label: { en: "a" },
				slots: [{ id: slot }]
			} as any
		)

		const member = await memberIn(p, { name: "Orla" })
		await testDb.insert(schema.ownerSheets).values({
			ownerKind: "cast_member",
			ownerId: member.id,
			sheetId,
			position: 0
		})
		await testDb.insert(schema.attributeConfigs).values({
			ownerKind: "cast_member",
			ownerId: member.id,
			slotId: slot,
			config: { max: 50 }
		})
		await testDb.insert(schema.attributeValues).values([
			{
				ownerKind: "cast_member",
				ownerId: member.id,
				slotId: slot,
				value: { v: 3 }
			},
			// A later write of the same slot wins (the present).
			{
				ownerKind: "cast_member",
				ownerId: member.id,
				slotId: slot,
				value: { v: 7 }
			},
			{
				ownerKind: "cast_member",
				ownerId: member.id,
				slotId: worldSlot,
				value: { v: 9 }
			}
		])
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: p.O.id,
				isGroup: false,
				name: uniq("Run"),
				lorebookId: p.book.id
			} as any)
			.returning()
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: member.id,
			slotId: slot,
			value: { v: 99 },
			sessionId: session.id
		})

		const out = await copy(member.id, p.A.id)
		expect(out).toMatchObject({
			sheets: 1,
			configs: 1,
			values: 1,
			skippedStats: 1
		})
		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "card"),
					eq(schema.attributeValues.ownerId, out.card.id)
				)
			)
		expect(
			values.map((r) => [r.slotId, (r.value as any).v, r.sessionId])
		).toEqual([[slot, 7, null]])
		const configs = await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(
				and(
					eq(schema.attributeConfigs.ownerKind, "card"),
					eq(schema.attributeConfigs.ownerId, out.card.id)
				)
			)
		expect(configs.map((r) => r.config)).toEqual([{ max: 50 }])
		const sheets = await testDb
			.select()
			.from(schema.ownerSheets)
			.where(
				and(
					eq(schema.ownerSheets.ownerKind, "card"),
					eq(schema.ownerSheets.ownerId, out.card.id)
				)
			)
		expect(sheets.map((r) => r.sheetId)).toEqual([sheetId])
	})

	it("sprite sets: the member's own are copied; with none, its card's", async () => {
		const { addSprite } = await import("$lib/server/sprites")
		const p = await people()
		const { card } = await insertCard(db(), {
			userId: p.O.id,
			name: "Mara",
			description: "x"
		} as any)
		await addSprite(db(), {
			characterId: card.id,
			userId: p.O.id,
			label: "calm",
			bytes: png(++n),
			source: "upload"
		} as any)

		const bare = await memberIn(p, { card, name: "Mara" })
		const fromCard = await copy(bare.id, p.A.id)
		expect(fromCard.spriteSets).toBe(1)
		const cardSprites = await spriteFiles(fromCard.card.id)
		expect(cardSprites.map((r) => r.set)).toEqual(["default"])
		expect((await fileRow(cardSprites[0].fileId!)).userId).toBe(p.A.id)

		const { card: other } = await insertCard(db(), {
			userId: p.O.id,
			name: "Mara",
			description: "x"
		} as any)
		const own = await memberIn(p, { card: other, name: "Mara" })
		await addSprite(db(), {
			castMemberId: own.id,
			userId: p.O.id,
			label: "wry",
			bytes: png(++n),
			source: "upload"
		} as any)
		const fromMember = await copy(own.id, p.A.id)
		const sprites = await testDb
			.select({ label: schema.sprites.label })
			.from(schema.sprites)
			.innerJoin(
				schema.spriteSets,
				eq(schema.spriteSets.id, schema.sprites.spriteSetId)
			)
			.where(eq(schema.spriteSets.characterId, fromMember.card.id))
		expect(sprites.map((r) => r.label)).toEqual(["wry"])
	})

	it("gallery: the member's own pictures, as files of the asker's on the copy", async () => {
		const { createMedia, addToMemberGallery } = await import(
			"$lib/server/media"
		)
		const p = await people()
		const member = await memberIn(p, { name: "Orla" })
		const pic = (
			await createMedia(db(), {
				userId: p.O.id,
				lorebookId: p.book.id,
				bytes: png(++n)
			})
		).file
		await addToMemberGallery(db(), member.id, [pic.id])
		const out = await copy(member.id, p.A.id)
		expect(out.galleryFiles).toBe(1)
		const files = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.characterId, out.card.id))
		expect(files).toHaveLength(1)
		expect(files[0].userId).toBe(p.A.id)
	})

	it("tags come only from a card the asker may read", async () => {
		const p = await people()
		const tagFor = async (userId: number, name: string) =>
			(
				await testDb
					.insert(schema.tags)
					.values({ userId, name })
					.returning()
			)[0]
		const tagged = async (ownerId: number) => {
			const { card } = await insertCard(db(), {
				userId: ownerId,
				name: "Mara",
				description: "x"
			} as any)
			const tag = await tagFor(ownerId, uniq("noir"))
			await testDb
				.insert(schema.characterTags)
				.values({ characterId: card.id, tagId: tag.id })
			return { card, tag }
		}
		const names = async (cardId: number) =>
			(
				await testDb.query.characterTags.findMany({
					where: eq(schema.characterTags.characterId, cardId),
					with: { tag: true }
				})
			).map((ct) => ct.tag)

		// The asker's own card: its tags are re-made as the asker's.
		const mine = await tagged(p.A.id)
		const mineMember = await memberIn(p, { card: mine.card, name: "Mara" })
		const fromMine = await copy(mineMember.id, p.A.id)
		const copied = await names(fromMine.card.id)
		expect(copied.map((t) => t.name)).toEqual([mine.tag.name])
		expect(copied[0].userId).toBe(p.A.id)

		// Another user's card the asker cannot read: no tags.
		const theirs = await tagged(p.O.id)
		const theirMember = await memberIn(p, {
			card: theirs.card,
			name: "Mara"
		})
		const fromTheirs = await copy(theirMember.id, p.A.id)
		expect(await names(fromTheirs.card.id)).toEqual([])
	})
})

describe("characters:duplicate { castMemberId }", () => {
	const cardCount = async () =>
		(await testDb.select().from(schema.characters)).length

	it("a non-reader is refused with the sentence, and nothing is written", async () => {
		const { charactersDuplicate } = await import(
			"$lib/server/sockets/characters"
		)
		const p = await people()
		const member = await memberIn(p, { name: "Orla" })
		const before = await cardCount()
		const emitted: any[] = []
		await expect(
			charactersDuplicate.handler(
				fakeSocket(p.S.id),
				{ castMemberId: member.id },
				((e: string, d: any) => emitted.push([e, d])) as any
			)
		).rejects.toThrow("Cast member not found.")
		expect(await cardCount()).toBe(before)
		const error = emitted.find(([e]) => e === "characters:duplicate:error")
		expect(error?.[1]).toMatchObject({
			error: "Cast member not found.",
			castMemberId: member.id
		})
		// Neither a bad id nor a missing member says more.
		await expect(
			charactersDuplicate.handler(
				fakeSocket(p.S.id),
				{ castMemberId: 987654 },
				noopEmit
			)
		).rejects.toThrow("Cast member not found.")
	})

	it("a reader of the book copies it", async () => {
		const { charactersDuplicate } = await import(
			"$lib/server/sockets/characters"
		)
		const p = await people()
		const member = await memberIn(p, {
			name: "Orla",
			own: { description: "Wry." }
		})
		const res = (await charactersDuplicate.handler(
			fakeSocket(p.A.id),
			{ castMemberId: member.id },
			noopEmit
		)) as any
		expect(res.character.name).toBe("Orla")
		expect(res.character.userId).toBe(p.A.id)
	})

	it("a guest in a session that seats the member copies it with no book access", async () => {
		const { charactersDuplicate } = await import(
			"$lib/server/sockets/characters"
		)
		const p = await people()
		const member = await memberIn(p, {
			name: "Orla",
			own: { description: "Wry." }
		})
		const { card } = await insertCard(db(), {
			userId: p.O.id,
			name: "Seat",
			description: "x"
		} as any)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: p.O.id,
				isGroup: false,
				name: uniq("Run"),
				lorebookId: p.book.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: card.id,
			castMemberId: member.id
		} as any)
		// Before the guest is added, the guest is refused.
		await expect(
			charactersDuplicate.handler(
				fakeSocket(p.G.id),
				{ castMemberId: member.id },
				noopEmit
			)
		).rejects.toThrow("Cast member not found.")
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: p.G.id } as any)
		const res = (await charactersDuplicate.handler(
			fakeSocket(p.G.id),
			{ castMemberId: member.id },
			noopEmit
		)) as any
		expect(res.character.userId).toBe(p.G.id)
		expect(res.character.description).toBe("Wry.")
	})
})
