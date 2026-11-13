/**
 * `makeMemberCardless` — a member that loses its card keeps what it read:
 * words, sprites, gallery pictures and stats. Through each caller: an unlink
 * from the member page, a card delete (★3, 2026-11-08) and a provided-book
 * uninstall.
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
vi.mock("$lib/server/sessions/memberSessions", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/sessions/memberSessions")
		>()
	return { ...actual, tellMemberSessions: vi.fn(async () => {}) }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const asDb = () => testDb as unknown as Db
const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit() {} }) } }) as any
const noopEmit = (() => {}) as any

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
		uniq("cardless")
	)

type Owner = "same" | "other"

/** Card C (owner O) with art and stats; book K with member M linked to C, seated in a session reading K. */
async function world(owner: Owner) {
	const { createMedia } = await import("$lib/server/media")
	const { insertCard, insertCastMember } = await import(
		"$lib/server/characters/versions"
	)
	const { addSprite, addEmptySprites } = await import("$lib/server/sprites")
	const { declareSheet } = await import("$lib/server/state/declarations")
	const O = await user()
	const B = await user()
	const guest = await user()
	const stranger = await user()
	const bookOwner = owner === "same" ? O : B

	const avatar = (
		await createMedia(asDb(), { userId: O.id, bytes: png(++n) })
	).file
	const { card } = await insertCard(asDb(), {
		userId: O.id,
		name: uniq("Mara"),
		description: "Tall, quiet.",
		firstMessage: "Hello there.",
		alternateGreetings: ["Hi again."],
		avatarMediaId: avatar.id
	} as any)

	const galleryBytes = [png(++n), png(++n)]
	const galleryFiles = []
	for (const bytes of galleryBytes)
		galleryFiles.push(
			(
				await createMedia(asDb(), {
					userId: O.id,
					characterId: card.id,
					bytes
				})
			).file
		)
	// The second gallery image is also a sprite: the gallery leaves it out.
	await addSprite(asDb(), {
		characterId: card.id,
		userId: O.id,
		label: "happy",
		bytes: galleryBytes[1],
		source: "upload"
	} as any)
	await addSprite(asDb(), {
		characterId: card.id,
		userId: O.id,
		label: "sad",
		bytes: png(++n),
		source: "upload"
	} as any)
	await addEmptySprites(asDb(), { characterId: card.id }, undefined, [
		"angry"
	])

	const sheetId = `cl${n}:sheet/a@1`
	await declareSheet(
		testDb,
		bookOwner.id,
		sheetId as any,
		{
			label: { en: "a" },
			slots: [{ id: "core:slot/hp@1" }]
		} as any
	)
	await testDb.insert(schema.ownerSheets).values({
		ownerKind: "card",
		ownerId: card.id,
		sheetId,
		position: 0
	})
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "card",
		ownerId: card.id,
		slotId: "x:slot/s1@1",
		value: { v: 4 }
	})

	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: bookOwner.id, name: uniq("Book") } as any)
		.returning()
	await testDb
		.insert(schema.lorebookShares)
		.values({ lorebookId: book.id, userId: guest.id } as any)
	const { member } = await insertCastMember(asDb(), {
		lorebookId: book.id,
		characterId: card.id,
		binding: `{{char:${++n}}}`,
		name: card.name
	} as any)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: bookOwner.id,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: book.id
		} as any)
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId: card.id,
		castMemberId: member.id
	} as any)

	const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
	const { spriteLabelsFor } = await import("$lib/server/sprites")
	const read = async () => {
		const m = (await memberAsRead(asDb(), member.id))!
		return {
			description: m.description,
			greetings: m.greetings,
			faceMediaId: m.faceMediaId
		}
	}
	const cardSprites = await testDb
		.select({ fileId: schema.sprites.fileId })
		.from(schema.sprites)
		.innerJoin(
			schema.spriteSets,
			eq(schema.spriteSets.id, schema.sprites.spriteSetId)
		)
		.where(eq(schema.spriteSets.characterId, card.id))
	return {
		O,
		B,
		guest,
		stranger,
		bookOwner,
		avatar,
		card,
		book,
		member,
		session,
		galleryFiles,
		cardSpriteFileIds: cardSprites
			.map((r) => r.fileId)
			.filter((x): x is number => x != null),
		before: await read(),
		read,
		labelsBefore: (await spriteLabelsFor(asDb(), [card.id])).get(card.id)
	}
}
type World = Awaited<ReturnType<typeof world>>

async function memberGalleryIds(memberId: number) {
	return (
		await testDb
			.select({ fileId: schema.castMemberFiles.fileId })
			.from(schema.castMemberFiles)
			.where(eq(schema.castMemberFiles.castMemberId, memberId))
	).map((r) => r.fileId)
}
async function memberSpriteFileIds(memberId: number) {
	return (
		await testDb
			.select({ fileId: schema.sprites.fileId })
			.from(schema.sprites)
			.innerJoin(
				schema.spriteSets,
				eq(schema.spriteSets.id, schema.sprites.spriteSetId)
			)
			.where(eq(schema.spriteSets.castMemberId, memberId))
	)
		.map((r) => r.fileId)
		.filter((x): x is number => x != null)
}
async function counts() {
	const out: Record<string, number> = {}
	for (const [k, t] of Object.entries({
		spriteSets: schema.spriteSets,
		sprites: schema.sprites,
		castMemberFiles: schema.castMemberFiles,
		attributeValues: schema.attributeValues,
		attributeConfigs: schema.attributeConfigs,
		ownerSheets: schema.ownerSheets,
		files: schema.files,
		characterVersions: schema.characterVersions
	}))
		out[k] = (await testDb.select().from(t as any)).length
	return out
}

/** Everything a card-less member keeps, asserted against its carded self. */
async function expectKept(w: World, owner: Owner) {
	const m = w.member.id
	expect(
		(
			await testDb
				.select({ c: schema.lorebookBindings.characterId })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, m))
		)[0].c
	).toBeNull()

	// The prompt read.
	const after = await w.read()
	expect(after.description).toBe(w.before.description)
	expect(after.greetings).toEqual(w.before.greetings)
	if (owner === "same") expect(after.faceMediaId).toBe(w.before.faceMediaId)
	else {
		// Another owner's face is the same picture as a file row of the book owner's.
		const faceRows = await testDb
			.select()
			.from(schema.files)
			.where(
				(await import("drizzle-orm")).inArray(schema.files.id, [
					w.before.faceMediaId!,
					after.faceMediaId!
				])
			)
		const [was, now] = [w.before.faceMediaId, after.faceMediaId].map(
			(id) => faceRows.find((f) => f.id === id)!
		)
		expect(now.userId).toBe(w.B.id)
		expect(now.hash).toBe(was.hash)
	}

	// Sprite choices.
	const { spriteLabelsForMembers } = await import("$lib/server/sprites")
	expect((await spriteLabelsForMembers(asDb(), [m])).get(m)).toEqual(
		w.labelsBefore
	)

	// Gallery: the pictures that are not sprites.
	const gallery = await memberGalleryIds(m)
	expect(gallery).toHaveLength(1)
	const spriteIds = await memberSpriteFileIds(m)
	expect(spriteIds).toHaveLength(2)
	for (const id of gallery) expect(spriteIds).not.toContain(id)
	const { backdropFileFor } = await import("$lib/server/sessions/backdrop")
	for (const id of gallery) {
		expect(
			await backdropFileFor(asDb(), String(id), {
				sessionId: w.session.id,
				userId: w.bookOwner.id,
				castImages: true
			})
		).toEqual({ id })
		// And as a person who owns nothing: only the member's gallery link lets it in.
		expect(
			await backdropFileFor(asDb(), String(id), {
				sessionId: w.session.id,
				userId: null,
				castImages: true
			})
		).toEqual({ id })
	}

	// Stats.
	const values = await testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.ownerKind, "cast_member"),
				eq(schema.attributeValues.ownerId, m)
			)
		)
	expect(values.map((v) => v.value)).toEqual([{ v: 4 }])
	const sheets = await testDb
		.select()
		.from(schema.ownerSheets)
		.where(
			and(
				eq(schema.ownerSheets.ownerKind, "cast_member"),
				eq(schema.ownerSheets.ownerId, m)
			)
		)
	expect(sheets).toHaveLength(1)

	// Whose files.
	const files = await testDb
		.select()
		.from(schema.files)
		.where(eq(schema.files.userId, w.bookOwner.id))
	const byId = new Map(files.map((f) => [f.id, f]))
	const cardGallery = w.galleryFiles.map((f) => f.id)
	if (owner === "same") {
		expect(spriteIds.sort()).toEqual([...w.cardSpriteFileIds].sort())
		expect(cardGallery).toContain(gallery[0])
	} else {
		for (const id of [...gallery, ...spriteIds]) {
			expect(w.cardSpriteFileIds).not.toContain(id)
			expect(cardGallery).not.toContain(id)
			const row = byId.get(id)!
			expect(row.userId).toBe(w.B.id)
			expect(row.lorebookId).toBe(w.book.id)
		}
		const hashes = async (ids: number[]) =>
			(
				await testDb
					.select({ hash: schema.files.hash })
					.from(schema.files)
					.where(
						(await import("drizzle-orm")).inArray(
							schema.files.id,
							ids
						)
					)
			)
				.map((r) => r.hash)
				.sort()
		expect(await hashes(spriteIds)).toEqual(
			await hashes(w.cardSpriteFileIds)
		)
	}

	// Who may open them: a guest with a read share, not a stranger.
	const { canViewMedia } = await import("$lib/server/media/access")
	for (const id of [...gallery, ...spriteIds]) {
		const [f] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, id))
		expect(await canViewMedia(f, w.guest.id, asDb())).toBe(true)
		expect(await canViewMedia(f, w.stranger.id, asDb())).toBe(false)
	}
}

async function expectSecondCallChangesNothing(
	w: World,
	cause: "unlink" | "card-delete" | "provided-uninstall"
) {
	const { makeMemberCardless } = await import("$lib/server/cast/cardless")
	const before = await counts()
	const out = await testDb.transaction(async (tx) =>
		makeMemberCardless(tx as unknown as Db, w.member.id, { cause })
	)
	expect(out.cardId).toBeNull()
	expect(await counts()).toEqual(before)
}

describe("unlink from the member page", () => {
	for (const owner of ["same", "other"] as const)
		it(`keeps the card's art, stats and words (book owner: ${owner})`, async () => {
			const { updateLorebookBindingHandler } = await import(
				"$lib/server/sockets/lorebooks"
			)
			const w = await world(owner)
			await updateLorebookBindingHandler.handler(
				fakeSocket(w.bookOwner.id),
				{
					lorebookBinding: { id: w.member.id, characterId: null }
				} as any,
				noopEmit
			)
			await expectKept(w, owner)
			await expectSecondCallChangesNothing(w, "unlink")
		})
})

describe("card delete (★3, 2026-11-08)", () => {
	it("makes a follower in another user's book card-less, keeps what it read, and tells its sessions", async () => {
		const { charactersDelete } = await import(
			"$lib/server/sockets/characters"
		)
		const { tellMemberSessions } = await import(
			"$lib/server/sessions/memberSessions"
		)
		const w = await world("other")
		vi.mocked(tellMemberSessions).mockClear()
		await charactersDelete.handler(
			fakeSocket(w.O.id),
			{ id: w.card.id } as any,
			noopEmit
		)
		await expectKept(w, "other")
		expect(tellMemberSessions).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			w.book.id,
			w.member.id
		)
		const [card] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, w.card.id))
		expect(card.isDeleted).toBe(true)
		await expectSecondCallChangesNothing(w, "card-delete")
	})
})

describe("provided-book uninstall", () => {
	it("makes a follower in another user's book card-less and keeps what it read", async () => {
		const { deleteProvidedBooks } = await import(
			"$lib/server/plugins/providedBooks"
		)
		const w = await world("other")
		const plugin = uniq("cl.plugin")
		await testDb
			.update(schema.characters)
			.set({
				extensions: {
					serenepub: {
						provided: { plugin, slug: "mara", uuid: w.card.uuid }
					}
				}
			} as any)
			.where(eq(schema.characters.id, w.card.id))
		const out = await deleteProvidedBooks(asDb(), plugin)
		expect(out.characters).toBe(1)
		await expectKept(w, "other")
		await expectSecondCallChangesNothing(w, "provided-uninstall")
	})
})

describe("a card-less member", () => {
	it("passed again with no card is a no-op, and a missing member throws", async () => {
		const { makeMemberCardless } = await import("$lib/server/cast/cardless")
		const { insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const O = await user()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: O.id, name: uniq("Book") } as any)
			.returning()
		const { member } = await insertCastMember(asDb(), {
			lorebookId: book.id,
			binding: `{{char:${++n}}}`,
			name: "Loner"
		} as any)
		const before = await counts()
		const out = await testDb.transaction(async (tx) =>
			makeMemberCardless(tx as unknown as Db, member.id, {
				cause: "card-delete"
			})
		)
		expect(out).toMatchObject({
			cardId: null,
			detached: 0,
			spriteSets: 0,
			galleryFiles: 0,
			sheets: 0
		})
		expect(await counts()).toEqual(before)
		await expect(
			testDb.transaction(async (tx) =>
				makeMemberCardless(tx as unknown as Db, 999_999_999, {
					cause: "unlink"
				})
			)
		).rejects.toThrow("That cast member no longer exists.")
	})
})

describe("faces and likeness pictures of a card-less member", () => {
	/** A card whose face and likeness are pictures in its gallery, and a member of a book of `bookOwner`. */
	async function faceWorld(owner: Owner) {
		const { createMedia } = await import("$lib/server/media")
		const { insertCard, insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const O = await user()
		const B = await user()
		const bookOwner = owner === "same" ? O : B
		const [face, likeImage] = [
			(
				await createMedia(asDb(), {
					userId: O.id,
					bytes: png(++n)
				})
			).file,
			(
				await createMedia(asDb(), {
					userId: O.id,
					bytes: png(++n)
				})
			).file
		]
		const { card, version } = await insertCard(asDb(), {
			userId: O.id,
			name: uniq("Mara"),
			description: "Tall, quiet.",
			avatarMediaId: face.id
		} as any)
		// The pictures live in the card's gallery.
		await testDb
			.update(schema.files)
			.set({ characterId: card.id })
			.where(eq(schema.files.id, face.id))
		await testDb
			.update(schema.files)
			.set({ characterId: card.id })
			.where(eq(schema.files.id, likeImage.id))
		await testDb
			.update(schema.characterVersions)
			.set({ likeness: { imageMediaId: likeImage.id } } as any)
			.where(eq(schema.characterVersions.id, version.id))
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: bookOwner.id, name: uniq("Book") } as any)
			.returning()
		const { member } = await insertCastMember(asDb(), {
			lorebookId: book.id,
			characterId: card.id,
			binding: `{{char:${++n}}}`,
			name: card.name
		} as any)
		return { O, B, card, book, member, face, likeImage }
	}
	const cardless = async (memberId: number) => {
		const { makeMemberCardless } = await import("$lib/server/cast/cardless")
		return testDb.transaction(async (tx) =>
			makeMemberCardless(tx as unknown as Db, memberId, {
				cause: "card-delete"
			})
		)
	}
	const wornBy = async (memberId: number) => {
		const rows = await testDb
			.select({
				face: schema.characterVersions.faceMediaId,
				likeness: schema.characterVersions.likeness
			})
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, memberId))
		return rows
	}

	it("keeps its face and likeness picture after the card owner deletes the gallery picture", async () => {
		const { deleteCharacterGalleryImage } = await import(
			"$lib/server/utils"
		)
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const w = await faceWorld("other")
		const out = await cardless(w.member.id)
		expect(out.facesRepointed).toBeGreaterThan(0)

		await deleteCharacterGalleryImage({
			characterId: w.card.id,
			userId: w.O.id,
			mediaId: w.face.id
		})
		await deleteCharacterGalleryImage({
			characterId: w.card.id,
			userId: w.O.id,
			mediaId: w.likeImage.id
		})

		const read = (await membersAsRead(asDb(), [w.member.id])).get(
			w.member.id
		)!
		expect(read.faceMediaId).not.toBeNull()
		const [row] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, read.faceMediaId!))
		expect(row.userId).toBe(w.B.id)

		const worn = await wornBy(w.member.id)
		for (const v of worn) {
			const lid = (v.likeness as any)?.imageMediaId
			expect(lid).toBeTypeOf("number")
			expect(lid).not.toBe(w.likeImage.id)
			const [lf] = await testDb
				.select()
				.from(schema.files)
				.where(eq(schema.files.id, lid))
			expect(lf.userId).toBe(w.B.id)
		}
	})

	it("shares the file rows of a same-owner card, rewrites nothing, and a second call changes nothing", async () => {
		const w = await faceWorld("same")
		const first = await cardless(w.member.id)
		expect(first.facesRepointed).toBe(0)
		expect((await wornBy(w.member.id)).map((v) => v.face)).toContain(
			w.face.id
		)
		const other = await faceWorld("other")
		await cardless(other.member.id)
		const before = await wornBy(other.member.id)
		const again = await cardless(other.member.id)
		expect(again.facesRepointed).toBe(0)
		expect(await wornBy(other.member.id)).toEqual(before)
	})
})
