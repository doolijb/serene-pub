import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, isNull } from "drizzle-orm"
import zlib from "zlib"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, updateCardVersion } from "$lib/server/characters/versions"
import { SHARED_CARD_REFUSALS } from "$lib/server/cast/sharedCardCopy"
import { GUEST_SEAT_SENTENCES } from "$lib/shared/sessions/guestSeats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

const GENRES = vi.hoisted(() => ({
	noPersonas: "test:genre/no-personas@1",
	noCharacters: "test:genre/no-characters@1"
}))

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "shared-card-seat-test-secret"
	}
})
// Two genres whose shape lacks one kind; everything else is the real registry.
vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("$lib/server/pipelines/entities/sessionGenres")
			>()
		return {
			...actual,
			getSessionGenre: async (db: any, id: string) =>
				id === GENRES.noPersonas
					? {
							genreId: id,
							name: "No personas",
							shape: { characters: { min: 0 } }
						}
					: id === GENRES.noCharacters
						? {
								genreId: id,
								name: "No characters",
								shape: { personas: { min: 0 } }
							}
						: actual.getSessionGenre(db, id)
		}
	}
)
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-sharedcardseat-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${label}-${++n}`)
}

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


async function update(
	userId: number,
	sessionId: number,
	body: Record<string, unknown>
) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	let error: string | null = null
	try {
		await sessionsUpdateHandler.handler(
			socket(userId),
			{ session: { id: sessionId }, ...body } as any,
			() => {}
		)
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	}
	return { error }
}

/** An owner, a guest who plays, a sharer, and a session with its own notes book. */
async function table(genreId?: string) {
	const owner = await user("sc-owner")
	const guest = await user("sc-guest")
	const sharer = await user("sc-sharer")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			...(genreId ? { genreId } : {})
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id, isPlayer: true })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: owner.id,
			name: `Notes ${++n}`,
			sessionId: session!.id
		} as any)
		.returning()
	return {
		owner,
		guest,
		sharer,
		sessionId: session!.id,
		bookId: book!.id
	}
}

/** A card of `userId` with an avatar and a gallery picture, shared with `to` when given. */
async function sharedCard(
	userId: number,
	to: number | null,
	name = `Mara ${++n}`
) {
	const { createMedia } = await import("$lib/server/media")
	const avatar = (
		await createMedia(testDb as any, { userId, bytes: png(++n) })
	).file
	const { card, version } = await insertCard(testDb as any, {
		userId,
		name,
		description: "Tall, quiet.",
		avatarMediaId: avatar.id
	} as any)
	const gallery = (
		await createMedia(testDb as any, {
			userId,
			characterId: card.id,
			bytes: png(++n)
		})
	).file
	if (to != null)
		await testDb
			.insert(schema.characterShares)
			.values({ characterId: card.id, userId: to })
	return { card, version, avatar, gallery }
}

const membersOf = (bookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, bookId))
		.orderBy(asc(schema.lorebookBindings.id))

const playerSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))
const characterSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))

async function snapshot(t: { sessionId: number; bookId: number }) {
	return JSON.stringify({
		members: await membersOf(t.bookId),
		ps: await playerSeats(t.sessionId),
		cs: await characterSeats(t.sessionId)
	})
}

async function refused(
	t: { sessionId: number; bookId: number },
	userId: number,
	body: Record<string, unknown>,
	sentence: string
) {
	const before = await snapshot(t)
	const { error } = await update(userId, t.sessionId, body)
	expect(error).toBe(sentence)
	expect(await snapshot(t)).toBe(before)
}

const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))

describe("a guest seats a copy of a shared card", () => {
	test("as a player seat: an unlinked member in the notes, with the card's words and art", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id, "Mara")
		const { error } = await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "player" }]
		})
		expect(error).toBeNull()

		const members = await membersOf(t.bookId)
		expect(members).toHaveLength(1)
		const m = members[0]!
		expect(m.characterId).toBeNull()
		expect(m.name).toBe("Mara")
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const read = (
			await membersAsRead(testDb as any, [m.id], {
				sessionId: t.sessionId
			})
		).get(m.id)!
		expect(read.shownName).toBe("Mara")
		expect(read.description).toBe("Tall, quiet.")
		for (const v of await versionsOf(m.id)) expect(v.parentVersionId).toBeNull()

		// The avatar is a file row of the session's owner, not the sharer's.
		const base = (await versionsOf(m.id))[0]!
		expect(base.faceMediaId).not.toBeNull()
		expect(base.faceMediaId).not.toBe(s.avatar.id)
		const [face] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, base.faceMediaId!))
		expect(face!.userId).toBe(t.owner.id)
		// The gallery picture was copied too.
		const { mediaFor } = await import("$lib/server/media")
		const gallery = await mediaFor(testDb as any, { castMemberId: m.id } as any)
		expect(gallery.length).toBeGreaterThan(0)
		for (const f of gallery) expect(f.userId).toBe(t.owner.id)

		const seats = await playerSeats(t.sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({
			personaId: null,
			castMemberId: m.id,
			userId: t.guest.id,
			seatName: "Mara"
		})
		expect(await characterSeats(t.sessionId)).toHaveLength(0)
	})

	test("editing the original card afterwards never reaches the copy", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id, "Mara")
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "player" }]
		})
		await updateCardVersion(testDb as any, s.version.id, {
			description: "Changed afterwards."
		})
		const [m] = await membersOf(t.bookId)
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const read = (
			await membersAsRead(testDb as any, [m!.id], { sessionId: t.sessionId })
		).get(m!.id)!
		expect(read.description).toBe("Tall, quiet.")
	})

	test("as a character seat: card-less, seated by the guest, is_group recomputed", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id, "Mara")
		const s2 = await sharedCard(t.sharer.id, t.guest.id, "Nell")
		const { error } = await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "character" }]
		})
		expect(error).toBeNull()
		const seats = await characterSeats(t.sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({
			characterId: null,
			seatedByUserId: t.guest.id
		})
		expect(seats[0]!.castMemberId).not.toBeNull()
		const group = async () =>
			(
				await testDb
					.select({ g: schema.sessions.isGroup })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, t.sessionId))
			)[0]!.g
		expect(await group()).toBe(false)
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s2.card.id, kind: "character" }]
		})
		expect(await characterSeats(t.sessionId)).toHaveLength(2)
		expect(await group()).toBe(true)
	})
})

describe("refusals leave no new member and no new seat", () => {
	test("a card neither owned nor shared", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, null)
		await refused(
			t,
			t.guest.id,
			{ sharedCardSeats: [{ characterId: s.card.id, kind: "player" }] },
			SHARED_CARD_REFUSALS.notShared
		)
	})

	test("the guest's own card", async () => {
		const t = await table()
		const s = await sharedCard(t.guest.id, t.guest.id)
		await refused(
			t,
			t.guest.id,
			{ sharedCardSeats: [{ characterId: s.card.id, kind: "character" }] },
			SHARED_CARD_REFUSALS.notShared
		)
	})

	test("a deleted shared card", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id)
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, s.card.id))
		await refused(
			t,
			t.guest.id,
			{ sharedCardSeats: [{ characterId: s.card.id, kind: "player" }] },
			SHARED_CARD_REFUSALS.notShared
		)
	})

	test("Guests can bring their own characters off", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id)
		await testDb
			.update(schema.sessions)
			.set({ metadata: { guestsBringOwn: false } } as any)
			.where(eq(schema.sessions.id, t.sessionId))
		await refused(
			t,
			t.guest.id,
			{ sharedCardSeats: [{ characterId: s.card.id, kind: "player" }] },
			GUEST_SEAT_SENTENCES.bringOwnOff
		)
	})

	test("a genre with no personas, for a player seat", async () => {
		const t = await table(GENRES.noPersonas)
		const s = await sharedCard(t.sharer.id, t.guest.id)
		await refused(
			t,
			t.guest.id,
			{ sharedCardSeats: [{ characterId: s.card.id, kind: "player" }] },
			"This session does not fit 'No personas': this genre has no personas — the session has 1."
		)
	})
})

describe("the copy beside the sharer's own linked member, and after", () => {
	test("both members exist and the sharer's stays linked to the card", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id, "Mara")
		const { insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const { member: linked } = await insertCastMember(testDb as any, {
			lorebookId: t.bookId,
			characterId: s.card.id,
			binding: `{{char:${++n}}}`,
			name: "Mara"
		} as any)
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "player" }]
		})
		const members = await membersOf(t.bookId)
		expect(members).toHaveLength(2)
		expect(members.find((m) => m.id === linked.id)!.characterId).toBe(
			s.card.id
		)
		expect(members.filter((m) => m.characterId === null)).toHaveLength(1)
	})

	test("a later save sending castMemberIds with the copy keeps the seat", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id)
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "character" }]
		})
		const [seat] = await characterSeats(t.sessionId)
		const { error } = await update(t.guest.id, t.sessionId, {
			castMemberIds: [seat!.castMemberId]
		})
		expect(error).toBeNull()
		const seats = await characterSeats(t.sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({ id: seat!.id, removedAt: null })
		expect(await membersOf(t.bookId)).toHaveLength(1)
	})

	test("removing the player seat leaves the member in the notes", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id)
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "player" }]
		})
		const [seat] = await playerSeats(t.sessionId)
		const { error } = await update(t.guest.id, t.sessionId, {
			playerSeatChanges: [{ playerSeatId: seat!.id, remove: true }]
		})
		expect(error).toBeNull()
		const [after] = await playerSeats(t.sessionId)
		// A first remove benches the seat (today's rule).
		expect(after).toMatchObject({ isActive: false, removedAt: null })
		expect(await membersOf(t.bookId)).toHaveLength(1)
	})

	test("removing the guest benches the player copy and hands the character copy to the owner", async () => {
		const t = await table()
		const a = await sharedCard(t.sharer.id, t.guest.id, "Mara")
		const b = await sharedCard(t.sharer.id, t.guest.id, "Nell")
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [
				{ characterId: a.card.id, kind: "player" },
				{ characterId: b.card.id, kind: "character" }
			]
		})
		const { sessionsRemoveGuestHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsRemoveGuestHandler.handler(
			socket(t.owner.id),
			{ sessionId: t.sessionId, guestUserId: t.guest.id } as any,
			() => {}
		)
		const [ps] = await playerSeats(t.sessionId)
		expect(ps).toMatchObject({ isActive: false, userId: t.guest.id })
		const [cs] = await characterSeats(t.sessionId)
		expect(cs!.seatedByUserId).toBe(t.owner.id)
		expect(await membersOf(t.bookId)).toHaveLength(2)
	})
})

describe("no link back to the card", () => {
	test("no version has a parent and the binding has no card", async () => {
		const t = await table()
		const s = await sharedCard(t.sharer.id, t.guest.id)
		await update(t.guest.id, t.sessionId, {
			sharedCardSeats: [{ characterId: s.card.id, kind: "player" }]
		})
		const rows = await testDb
			.select({
				cardId: schema.lorebookBindings.characterId,
				parent: schema.characterVersions.parentVersionId
			})
			.from(schema.lorebookBindings)
			.innerJoin(
				schema.characterVersions,
				eq(
					schema.characterVersions.castMemberId,
					schema.lorebookBindings.id
				)
			)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, t.bookId),
					isNull(schema.lorebookBindings.characterId)
				)
			)
		expect(rows.length).toBeGreaterThan(0)
		for (const r of rows) expect(r.parent).toBeNull()
	})
})
