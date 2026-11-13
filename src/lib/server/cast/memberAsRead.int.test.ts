/**
 * 🚧 `membersAsRead` / `seatedCastOf` over a real database (plan §27 S2), and
 * the card profile's `lorebooks:bindingsForCharacter` payload
 * (`followsCard`, `memberName`) — driven through the exported handler.
 */
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import {
	ensureCardVersion,
	insertCastMember,
	insertCharacterVersions,
	isBaseVersion,
	nextWriteOrder
} from "$lib/server/characters/versions"
import { memberAsRead, membersAsRead } from "./memberAsRead"
import { seatedCastOf } from "./seatedCast"

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
		path.join(os.tmpdir(), "serene-pub-vitest-memberAsRead-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("mar-user") })
		.returning()
	return row!
}

async function card(
	userId: number,
	name: string,
	extra: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name,
			description: `${name} card description.`,
			...extra
		})
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const { member: row } = await insertCastMember(db(), {
		lorebookId,
		binding: uniq("{{char:x}}"),
		characterId,
		name: "",
		...extra
	})
	return row
}

/** From `year`, draw the member with another card: a dated copy of its base, parented on that card's current version. */
async function drawnWithFrom(
	lorebookId: number,
	memberId: number,
	cardId: number,
	year: number
) {
	const [base] = (
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, memberId))
	).filter(isBaseVersion)
	const { id: _id, ...rest } = base!
	await insertCharacterVersions(db(), [
		{
			...rest,
			lorebookId,
			parentVersionId: (await ensureCardVersion(db(), cardId))!.id,
			year,
			writeOrder: await nextWriteOrder(db())
		}
	])
}

describe("membersAsRead", () => {
	test("carded, card-less, retold and dated members in one batch; unknown ids absent", async () => {
		const u = await user()
		const b = await book(u.id)
		const maren = await card(u.id, "Maren", {
			nickname: "Mare",
			firstMessage: "Card hello.",
			groupOnlyGreetings: ["Card group hello."],
			extensions: { serenepub: { timbre: { description: "card alto" } } }
		})
		const young = await card(u.id, "Verity young")
		const old = await card(u.id, "Verity old")
		const other = await card(u.id, "Verita card")
		const tag = (
			await testDb
				.insert(schema.tags)
				.values({ userId: u.id, name: "smith" })
				.returning()
		)[0]!
		await testDb
			.insert(schema.characterTags)
			.values({ characterId: maren.id, tagId: tag.id })

		const carded = await member(b.id, maren.id, { name: "Maren" })
		const bare = await member(b.id, null, {
			name: "Old Tom",
			description: "Tom's own words.",
			retold: { description: false }
		})
		const retold = await member(b.id, other.id, {
			name: "Verity",
			firstMessage: "Member hello.",
			retold: { firstMessage: true },
			ownName: "Verita"
		})
		const dated = await member(b.id, old.id, { name: "Verity" })
		await drawnWithFrom(b.id, dated.id, young.id, 20)

		const head = await membersAsRead(
			db(),
			[carded.id, bare.id, retold.id, dated.id, 987654],
			{ reading: MAIN_HEAD }
		)
		expect([...head.keys()].sort((a, b) => a - b)).toEqual(
			[carded.id, bare.id, retold.id, dated.id].sort((a, b) => a - b)
		)

		expect(head.get(carded.id)).toMatchObject({
			cardless: false,
			activeCardId: maren.id,
			linkedCardId: maren.id,
			name: "Maren",
			shownName: "Mare",
			firstMessage: "Card hello.",
			groupOnlyGreetings: ["Card group hello."],
			tags: ["smith"],
			voiceFrom: "card",
			timbre: { description: "card alto" }
		})
		expect(head.get(bare.id)).toMatchObject({
			cardless: true,
			activeCardId: null,
			name: "Old Tom",
			description: "Tom's own words.",
			followsCard: [],
			voiceFrom: null,
			timbre: null
		})
		expect(head.get(retold.id)).toMatchObject({
			name: "Verita",
			firstMessage: "Member hello.",
			groupOnlyGreetings: [],
			// Greetings are one profile field: retelling the first message
			// retells the other greetings too.
			followsCard: [
				"description",
				"personality",
				"scenario",
				"exampleDialogues",
				"face",
				"postHistoryInstructions",
				"creatorNotes",
				"likeness"
			]
		})

		// MAIN_HEAD: every dated row applies, so the dated card draws them.
		expect(head.get(dated.id)).toMatchObject({
			linkedCardId: old.id,
			activeCardId: young.id,
			name: "Verity young"
		})

		const before = await membersAsRead(db(), [dated.id], {
			reading: { ...MAIN_HEAD, moment: { year: 5 } }
		})
		expect(before.get(dated.id)).toMatchObject({
			linkedCardId: old.id,
			activeCardId: old.id,
			name: "Verity old"
		})
		const past = await membersAsRead(db(), [dated.id], {
			reading: { ...MAIN_HEAD, moment: { year: 25 } }
		})
		expect(past.get(dated.id)).toMatchObject({
			linkedCardId: old.id,
			activeCardId: young.id,
			name: "Verity young"
		})
	})

	test("no ids: an empty map; memberAsRead of an unknown id is null", async () => {
		expect((await membersAsRead(db(), [])).size).toBe(0)
		expect(await memberAsRead(db(), 987654)).toBeNull()
	})

	test("a session's reading moves the active card with its story clock", async () => {
		const u = await user()
		const b = await book(u.id)
		const young = await card(u.id, "Ines young")
		const old = await card(u.id, "Ines old")
		const m = await member(b.id, old.id, { name: "Ines" })
		await drawnWithFrom(b.id, m.id, young.id, 20)
		const mk = async (year: number) =>
			(
				await testDb
					.insert(schema.sessions)
					.values({
						userId: u.id,
						isGroup: false,
						name: uniq("Run"),
						lorebookId: b.id,
						storyClockYear: year
					})
					.returning()
			)[0]!
		const early = await mk(5)
		const late = await mk(30)
		expect(
			(await memberAsRead(db(), m.id, { sessionId: early.id }))
				?.activeCardId
		).toBe(old.id)
		expect(
			(await memberAsRead(db(), m.id, { sessionId: late.id }))
				?.activeCardId
		).toBe(young.id)
	})

	test("a member's timbre beats the card's", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Voiced", {
			extensions: { serenepub: { timbre: { description: "card voice" } } }
		})
		const m = await member(b.id, c.id, {
			name: "Voiced",
			timbre: { description: "member voice", voice: "tom" }
		})
		const r = await memberAsRead(db(), m.id)
		expect(r).toMatchObject({
			voiceFrom: "member",
			timbre: { description: "member voice", voice: "tom" }
		})
	})

	test("a member's own sprite set beats the card's sets", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Sprited")
		const withOwn = await member(b.id, c.id, { name: "Own" })
		const b2 = await book(u.id)
		const withCard = await member(b2.id, c.id, { name: "Card" })
		const none = await member(b.id, null, { name: "None" })
		await testDb.insert(schema.spriteSets).values([
			{
				characterId: c.id,
				name: "card-calm",
				isDefault: true,
				position: 0
			},
			{ characterId: c.id, name: "card-grim", position: 1 },
			{ castMemberId: withOwn.id, name: "own-set", isDefault: true }
		])
		const read = await membersAsRead(db(), [
			withOwn.id,
			withCard.id,
			none.id
		])
		expect(read.get(withOwn.id)).toMatchObject({ spriteSetsFrom: "member" })
		expect(read.get(withOwn.id)!.spriteSets.map((s) => s.name)).toEqual([
			"own-set"
		])
		expect(read.get(withCard.id)).toMatchObject({ spriteSetsFrom: "card" })
		expect(read.get(withCard.id)!.spriteSets.map((s) => s.name)).toEqual([
			"card-calm",
			"card-grim"
		])
		expect(read.get(none.id)).toMatchObject({
			spriteSetsFrom: null,
			spriteSets: []
		})
	})

	test("a soft-deleted card still reads", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Gone", { isDeleted: true })
		const m = await member(b.id, c.id, { name: "Gone" })
		expect(await memberAsRead(db(), m.id)).toMatchObject({
			cardless: false,
			activeCardId: c.id,
			name: "Gone"
		})
	})
})

describe("seatedCastOf", () => {
	test("live character and player seats, in order; envoy and departed seats excluded", async () => {
		const u = await user()
		const b = await book(u.id)
		const a = await card(u.id, "Alder")
		const w = await card(u.id, "Wren")
		const p = await card(u.id, "Player card")
		const gone = await card(u.id, "Gone")
		const ma = await member(b.id, a.id, { name: "Alder" })
		const mp = await member(b.id, p.id, { name: "Player card" })
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: true,
				name: uniq("Run"),
				lorebookId: b.id
			})
			.returning()
		const [seatW, seatA] = await testDb
			.insert(schema.sessionCharacters)
			.values([
				// Wren: no member yet (a session's own book mints none).
				{ sessionId: s!.id, characterId: w.id, position: 0 },
				{
					sessionId: s!.id,
					characterId: a.id,
					castMemberId: ma.id,
					position: 1
				}
			])
			.returning()
		await testDb.insert(schema.sessionCharacters).values([
			{ sessionId: s!.id, envoySlug: "mascot", position: 2 },
			{
				sessionId: s!.id,
				characterId: gone.id,
				position: 3,
				removedAt: new Date()
			}
		])
		const [seatP, seatBare] = await testDb
			.insert(schema.sessionPersonas)
			.values([
				{
					sessionId: s!.id,
					personaId: p.id,
					castMemberId: mp.id,
					position: 0
				},
				{
					sessionId: s!.id,
					personaId: null,
					seatName: "Nameless",
					position: 1
				}
			])
			.returning()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s!.id,
			personaId: gone.id,
			position: 2,
			removedAt: new Date()
		})

		const cast = await seatedCastOf(db(), s!.id)
		expect(
			cast.map((e) => [
				e.kind,
				e.seatId,
				e.castMemberId,
				e.cardId,
				e.position
			])
		).toEqual([
			["character", seatW!.id, null, w.id, 0],
			["character", seatA!.id, ma.id, a.id, 1],
			["player", seatP!.id, mp.id, p.id, 0],
			["player", seatBare!.id, null, null, 1]
		])
		expect(cast[0]!.asRead).toBeNull()
		expect(cast[1]!.asRead).toMatchObject({
			castMemberId: ma.id,
			activeCardId: a.id,
			name: "Alder"
		})
		expect(cast[2]!.asRead).toMatchObject({
			castMemberId: mp.id,
			activeCardId: p.id
		})
		expect(cast[3]!.asRead).toBeNull()
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	// A seat does not keep the card it holds when the clock draws the member
	// with a dated one; two seats on one member read the same thing.
	test("each seat reads its member over the member's active card, two seats on one member included", async () => {
		const u = await user()
		const b = await book(u.id)
		const old = await card(u.id, "Verity old")
		const young = await card(u.id, "Verity young")
		const m = await member(b.id, old.id, { name: "Verity" })
		await drawnWithFrom(b.id, m.id, young.id, 20)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: true,
				name: uniq("Run"),
				lorebookId: b.id,
				storyClockYear: 30
			})
			.returning()
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: s!.id,
				characterId: old.id,
				castMemberId: m.id,
				position: 0
			},
			{
				sessionId: s!.id,
				characterId: young.id,
				castMemberId: m.id,
				position: 1
			}
		])
		const cast = await seatedCastOf(db(), s!.id)
		expect(
			cast.map((e) => [e.cardId, e.asRead?.activeCardId, e.asRead?.name])
		).toEqual([
			[old.id, young.id, "Verity young"],
			[young.id, young.id, "Verity young"]
		])
	}, 60_000)

	test("a session with no seats seats nobody", async () => {
		const u = await user()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: uniq("Run") })
			.returning()
		expect(await seatedCastOf(db(), s!.id)).toEqual([])
	})
})

describe("lorebooks:bindingsForCharacter payload", () => {
	async function call(userId: number, characterId: number) {
		const { lorebookBindingsForCharacterHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const socket = {
			id: `s-${userId}`,
			user: { id: userId, isAdmin: false }
		} as never
		return (lorebookBindingsForCharacterHandler as any).handler(
			socket,
			{ characterId },
			async () => {}
		)
	}

	test("each member row says which fields it follows the card on, and the member's name", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Maren")
		const plain = await member(b.id, c.id, { name: "Maren" })
		const b2 = await book(u.id)
		const [face] = await testDb
			.insert(schema.files)
			.values({ userId: u.id, kind: "image", hash: uniq("face") })
			.returning()
		const tuned = await member(b2.id, c.id, {
			name: "Maren (synced)",
			ownName: "Marenne",
			faceMediaId: face!.id,
			retold: { description: true, face: true }
		})
		const res = await call(u.id, c.id)
		const rows = new Map<number, any>(
			res.members.map((m: any) => [m.castId, m])
		)
		expect(rows.get(plain.id)).toMatchObject({
			retold: [],
			followsCard: [
				"description",
				"personality",
				"scenario",
				"firstMessage",
				"alternateGreetings",
				"exampleDialogues",
				"face",
				"postHistoryInstructions",
				"creatorNotes",
				"likeness"
			],
			memberName: "Maren"
		})
		expect(rows.get(tuned.id)).toMatchObject({
			retold: ["description", "face"],
			followsCard: [
				"personality",
				"scenario",
				"firstMessage",
				"alternateGreetings",
				"exampleDialogues",
				"postHistoryInstructions",
				"creatorNotes",
				"likeness"
			],
			memberName: "Marenne"
		})
	})
})
