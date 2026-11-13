/**
 * A seated character's sprite sets come from the cast member, own over card
 * (plan §27 S2, owner 2026-11-05): `spriteLabelsForMembers`, and
 * `spriteChoicesFor` reading the seat's member — against a real database.
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
import {
	insertCastMember,
	isBaseVersion,
	updateCastVersion
} from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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
		path.join(os.tmpdir(), "serene-pub-vitest-memberSprites-")
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

let seed = 5000
let n = 0

/**
 * A card with a default set ("joy", "neutral") and an "armour" set, a book with
 * a member linked to it, and a session in that book seating the card. The
 * seat's `cast_member_id` is set unless `memberless`.
 */
async function scene(
	label: string,
	opts: { memberless?: boolean; ownSets?: boolean } = {}
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
			{ label: "neutral", bytes: png(seed++) },
			{ set: "armour", label: "stern", bytes: png(seed++) }
		],
		"upload"
	)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Ashfall ${n}` })
		.returning()
	const member = (
		await insertCastMember(testDb, {
			lorebookId: book.id,
			characterId: card.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		})
	).member
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	const [seat] = await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: session.id,
			characterId: card.id,
			castMemberId: opts.memberless ? null : member.id,
			position: 0
		})
		.returning()
	if (opts.ownSets) await giveMemberSets(user.id, member.id)
	return { user, card, book, member, session, seat }
}

/**
 * The member's own sets: "default" (calm, wary) and "cloak" (hooded), made
 * as a donor card's sets, then re-owned by the member.
 */
async function giveMemberSets(userId: number, memberId: number) {
	const { importSprites } = await import("$lib/server/sprites")
	const [donor] = await testDb
		.insert(schema.characters)
		.values({ userId, name: `Donor ${++n}`, description: "" })
		.returning()
	await importSprites(
		db(),
		userId,
		donor.id,
		[
			{ label: "calm", bytes: png(seed++) },
			{ label: "wary", bytes: png(seed++) },
			{ set: "cloak", label: "hooded", bytes: png(seed++) }
		],
		"upload"
	)
	await testDb
		.update(schema.spriteSets)
		.set({ characterId: null, castMemberId: memberId })
		.where(eq(schema.spriteSets.characterId, donor.id))
}

describe("spriteLabelsForMembers", () => {
	test("a member's own sets, keyed by member id; the card's reader does not include them", async () => {
		const { spriteLabelsFor, spriteLabelsForMembers } = await import(
			"$lib/server/sprites"
		)
		const { card, member } = await scene("msp-labels", { ownSets: true })
		const mine = await spriteLabelsForMembers(db(), [member.id])
		expect(mine.size).toBe(1)
		const entry = mine.get(member.id)!
		expect(entry.defaultSet).toBe("default")
		expect([...entry.sets.keys()].sort()).toEqual(["cloak", "default"])
		expect(entry.sets.get("default")!.sort()).toEqual(["calm", "wary"])
		expect(entry.sets.get("cloak")).toEqual(["hooded"])

		const cards = await spriteLabelsFor(db(), [card.id])
		expect([...cards.get(card.id)!.sets.keys()].sort()).toEqual([
			"armour",
			"default"
		])
		expect(cards.get(card.id)!.sets.get("default")!.sort()).toEqual([
			"joy",
			"neutral"
		])
		expect(await spriteLabelsForMembers(db(), [])).toEqual(new Map())
	})
})

describe("spriteChoicesFor reads the seat's member", () => {
	test("a member with its own sets offers its default set, not the card's, and no card", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card } = await scene("msp-own", { ownSets: true })
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({
			characterId: null,
			set: "default",
			defaultSet: "default",
			labels: ["calm", "wary"],
			decidedBy: "default"
		})
	})

	test("a session pick of a member's set shows it; a card-only name is missing, asked by the override", async () => {
		const { spriteChoicesFor, setSessionSpriteSet } = await import(
			"$lib/server/sprites/choices"
		)
		const { session, card } = await scene("msp-override", { ownSets: true })
		await setSessionSpriteSet(db(), {
			sessionId: session.id,
			characterId: card.id,
			set: "cloak",
			updatedBy: "user"
		})
		const picked = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(picked).toMatchObject({
			characterId: null,
			set: "cloak",
			labels: ["hooded"],
			decidedBy: "override"
		})
		expect(picked.missing).toBeUndefined()

		await setSessionSpriteSet(db(), {
			sessionId: session.id,
			characterId: card.id,
			set: "armour",
			updatedBy: "user"
		})
		const missing = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(missing).toMatchObject({
			set: "default",
			labels: ["calm", "wary"],
			decidedBy: "default",
			missing: "armour",
			missingAskedBy: "override"
		})
	})

	test("the member's spriteSet naming one of its own sets is the amendment rung", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card, member } = await scene("msp-amendment", {
			ownSets: true
		})
		// The member's chosen set is its base version's own (the column is frozen).
		const [base] = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.castMemberId, member.id))
		).filter(isBaseVersion)
		await updateCastVersion(db(), base!.id, {
			changes: { spriteSet: "cloak" }
		})
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({
			characterId: null,
			set: "cloak",
			labels: ["hooded"],
			decidedBy: "amendment"
		})
	})

	test("a seat with no member yet reads the card's sets as before", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card } = await scene("msp-memberless", {
			memberless: true
		})
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({
			characterId: card.id,
			set: "default",
			defaultSet: "default",
			labels: ["joy", "neutral"],
			decidedBy: "default"
		})
	})

	test("a member with no sets of its own reads the card's sets", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card } = await scene("msp-cardsets")
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({
			characterId: card.id,
			set: "default",
			defaultSet: "default",
			labels: ["joy", "neutral"],
			decidedBy: "default"
		})
	})

	test("a member with no sets of its own still draws the dated card a card-swap amendment brings", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { importSprites } = await import("$lib/server/sprites")
		const { session, card, member, book, user } = await scene("msp-dated")
		const [keeper] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "The Lamp Keeper",
				description: ""
			})
			.returning()
		await importSprites(
			db(),
			user.id,
			keeper.id,
			[{ label: "lamp", bytes: png(seed++) }],
			"upload"
		)
		await insertDatedCardVersion(testDb, member.id, keeper.id, 20)
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({ characterId: keeper.id, labels: ["lamp"] })
	})

	test("a card-less member's own set is its art, though the seat holds an unrelated card with art of its own", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { user, book, session, card, seat } = await scene("msp-cardless")
		const cardless = (
			await insertCastMember(testDb, {
				lorebookId: book.id,
				characterId: null,
				binding: `{{char:cl${++n}}}`,
				name: "Wren"
			})
		).member
		await giveMemberSets(user.id, cardless.id)
		await testDb
			.update(schema.sessionCharacters)
			.set({ castMemberId: cardless.id })
			.where(eq(schema.sessionCharacters.id, seat.id))
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({
			characterId: null,
			castMemberId: cardless.id,
			set: "default",
			labels: ["calm", "wary"]
		})
	})
})
