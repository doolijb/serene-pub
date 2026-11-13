/**
 * `sessions:setSpriteSet` against a seat's cast member (plan §27 S2): a member
 * with sprite sets of its own is picked from its own, else from the card's.
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
		path.join(os.tmpdir(), "serene-pub-vitest-memberSetsSocket-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 120_000)

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

const socket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noop = () => {}

let seed = 9000
let n = 0

/** A card with "default" and "armour" sets, a book member linked to it, a session seating the card. */
async function scene(
	label: string,
	opts: { memberless?: boolean; ownSets?: boolean; playerSeat?: boolean } = {}
) {
	const { importSprites } = await import("$lib/server/sprites")
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `${label}-${++n}` })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "" })
		.returning()
	await importSprites(
		db(),
		user.id,
		card.id,
		[
			{ label: "joy", bytes: png(seed++) },
			{ set: "armour", label: "stern", bytes: png(seed++) }
		],
		"upload"
	)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Ashfall ${n}` })
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book.id,
			characterId: card.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	if (opts.playerSeat) {
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session.id,
			personaId: card.id,
			castMemberId: member.id,
			position: 0
		})
	} else {
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: card.id,
			castMemberId: opts.memberless ? null : member.id,
			position: 0
		})
	}
	if (opts.ownSets) {
		const [donor] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: `Donor ${++n}`, description: "" })
			.returning()
		await importSprites(
			db(),
			user.id,
			donor.id,
			[
				{ label: "calm", bytes: png(seed++) },
				{ set: "cloak", label: "hooded", bytes: png(seed++) }
			],
			"upload"
		)
		await testDb
			.update(schema.spriteSets)
			.set({ characterId: null, castMemberId: member.id })
			.where(eq(schema.spriteSets.characterId, donor.id))
	}
	return { user, card, session }
}

async function pick(
	s: { user: { id: number }; card: { id: number }; session: { id: number } },
	set: string | null
) {
	const { sessionsSetSpriteSet } = await import("./sprites")
	return sessionsSetSpriteSet.handler(
		socket(s.user.id),
		{ sessionId: s.session.id, characterId: s.card.id, set },
		noop
	)
}

describe("sessions:setSpriteSet with a seat's cast member", () => {
	test("accepts a member's own set name and refuses a card-only name when the member has sets", async () => {
		const s = await scene("mss-own", { ownSets: true })
		expect(await pick(s, "cloak")).toMatchObject({ set: "cloak" })
		expect((await pick(s, "cloak")).error).toBeUndefined()
		const refused = await pick(s, "armour")
		expect(refused.error).toBe('There is no sprite set named "armour".')
		expect(refused.set).toBeNull()
		expect((await pick(s, null)).error).toBeUndefined()
	})

	test("with no member, or a member with no sets of its own, the card's names apply", async () => {
		for (const opts of [{ memberless: true }, {}]) {
			const s = await scene("mss-card", opts)
			expect(await pick(s, "armour")).toMatchObject({ set: "armour" })
			const refused = await pick(s, "cloak")
			expect(refused.error).toBe('There is no sprite set named "cloak".')
		}
	})

	test("a character that is not seated is refused, and so is a player seat on the card", async () => {
		const stranger = await scene("mss-stranger")
		await testDb
			.delete(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, stranger.session.id))
		expect((await pick(stranger, "armour")).error).toBe(
			"That character isn't in this session."
		)

		const player = await scene("mss-player", { playerSeat: true })
		expect((await pick(player, "armour")).error).toBe(
			"That character isn't in this session."
		)
	})

	test("a card with a departed character seat and a live player seat still takes a set (as before S2)", async () => {
		const s = await scene("mss-both", { playerSeat: true })
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.session.id,
			characterId: s.card.id,
			position: 1,
			removedAt: new Date()
		})
		expect(await pick(s, "armour")).toMatchObject({ set: "armour" })
	})

	test("a member whose own sets have no image yet reads the card's names, as the picker does", async () => {
		const s = await scene("mss-empty")
		const [m] = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.innerJoin(
				schema.sessionCharacters,
				eq(schema.sessionCharacters.castMemberId, schema.lorebookBindings.id)
			)
			.where(eq(schema.sessionCharacters.sessionId, s.session.id))
		await testDb
			.insert(schema.spriteSets)
			.values({ castMemberId: m!.id, name: "bare", isDefault: true, position: 0 })
		expect(await pick(s, "armour")).toMatchObject({ set: "armour" })
		expect((await pick(s, "bare")).error).toBe('There is no sprite set named "bare".')
	})
})
