/**
 * The character versions writer against a real database: card versions,
 * cast-member bases, the four ⏳ card copies, re-parenting and `resolveFollows`.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import {
	emptyCharacterProfile,
	profileOf
} from "$lib/shared/characters/profile"
import {
	ensureCardVersion,
	insertCard,
	insertCastMember,
	insertCastMemberCopy,
	insertCharacterVersions,
	isBaseVersion,
	newCardVersion,
	nextWriteOrder,
	resolveFollows,
	updateCardVersion,
	updateMemberToCardVersion,
	writeCastVersion
} from "./versions"

let db: TestDb
let userId: number
let tokens = 0

beforeAll(async () => {
	db = await createTestDb()
	userId = (await createTestUser(db, "versions-user")).id
}, 60_000)

const T = 60_000

async function book() {
	const [row] = await db
		.insert(schema.lorebooks)
		.values({ name: "Book", userId })
		.returning()
	return row.id
}

const token = () => `{{char:${++tokens}}}`

async function versionsOf(castMemberId: number) {
	return db
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, castMemberId))
}

async function cardOf(id: number) {
	const [row] = await db
		.select()
		.from(schema.characters)
		.where(eq(schema.characters.id, id))
	return row
}

describe("card versions", () => {
	it(
		"insertCard writes v1 with the card's label and its profile",
		async () => {
			const { card, version } = await insertCard(db, {
				userId,
				name: "Ada",
				description: "A mathematician.",
				characterVersion: "2.3",
				firstMessage: "Hello.",
				alternateGreetings: ["Hi."]
			})
			expect(version).toMatchObject({
				cardId: card.id,
				number: 1,
				label: "2.3",
				name: "Ada",
				description: "A mathematician.",
				greetings: [{ text: "Hello." }, { text: "Hi." }],
				follows: [],
				writtenBy: null
			})
			const other = await insertCard(
				db,
				{ userId, name: "Bo", description: "" },
				{ writtenBy: "user:1" }
			)
			expect(other.version.label).toBe("1.0")
			expect(other.version.writtenBy).toBe("user:1")
		},
		T
	)

	it(
		"ensureCardVersion lifts a raw card once, and answers null for no card",
		async () => {
			const [raw] = await db
				.insert(schema.characters)
				.values({
					userId,
					name: "Raw",
					description: "d",
					isDeleted: true
				})
				.returning()
			const first = await ensureCardVersion(db, raw.id)
			expect(first).toMatchObject({
				cardId: raw.id,
				number: 1,
				label: "1.0",
				writtenBy: "lift",
				name: "Raw"
			})
			const again = await ensureCardVersion(db, raw.id)
			expect(again?.id).toBe(first?.id)
			const rows = await db
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.cardId, raw.id))
			expect(rows).toHaveLength(1)
			expect(await ensureCardVersion(db, 999_999_999)).toBeNull()
		},
		T
	)

	it(
		"insertCharacterVersions refuses follows with no parent and an unknown follows field",
		async () => {
			const { card } = await insertCard(db, {
				userId,
				name: "X",
				description: ""
			})
			const memberBook = await book()
			const { member } = await insertCastMember(
				db,
				{ lorebookId: memberBook, binding: token(), characterId: null },
				{}
			)
			await expect(
				insertCharacterVersions(db, [
					{
						castMemberId: member.id,
						lorebookId: memberBook,
						nodeState: "active",
						nodeVisibility: "normal",
						year: 100,
						follows: ["description"]
					}
				])
			).rejects.toThrow(/needs a parent card version/)

			const v1 = await ensureCardVersion(db, card.id)
			await expect(
				insertCharacterVersions(db, [
					{
						castMemberId: member.id,
						lorebookId: memberBook,
						nodeState: "active",
						nodeVisibility: "normal",
						year: 100,
						parentVersionId: v1!.id,
						follows: ["height"]
					}
				])
			).rejects.toThrow(/"height" is not a character profile field/)
		},
		T
	)

	it(
		"insertCharacterVersions sets write_order from the id unless given, and answers in input order",
		async () => {
			const { card } = await insertCard(db, {
				userId,
				name: "W",
				description: ""
			})
			const rows = await insertCharacterVersions(db, [
				{ cardId: card.id, number: 2, ...emptyCharacterProfile() },
				{
					cardId: card.id,
					number: 3,
					writeOrder: 5,
					...emptyCharacterProfile()
				},
				{ cardId: card.id, number: 4, ...emptyCharacterProfile() }
			])
			expect(rows.map((r) => r.number)).toEqual([2, 3, 4])
			expect(rows[0].writeOrder).toBe(rows[0].id)
			expect(rows[1].writeOrder).toBe(5)
			expect(rows[2].writeOrder).toBe(rows[2].id)
			expect(rows[2].id).toBeGreaterThan(rows[0].id)
			const next = await nextWriteOrder(db)
			expect(next).toBeGreaterThan(rows[2].id)
		},
		T
	)

	it(
		"newCardVersion numbers 2 with the bumped label and writes the four card copies",
		async () => {
			const { card, version } = await insertCard(db, {
				userId,
				name: "Ada",
				description: "old",
				characterVersion: "1.0",
				personality: "calm"
			})
			const profile = {
				...emptyCharacterProfile(),
				name: "Ada Lovelace",
				nickname: "Countess",
				description: "new",
				personality: "sharp",
				faceMediaId: null
			}
			const v2 = await newCardVersion(db, card.id, profile, {
				writtenBy: "user:1"
			})
			expect(v2).toMatchObject({
				cardId: card.id,
				number: 2,
				label: "1.1",
				name: "Ada Lovelace",
				writtenBy: "user:1"
			})
			expect(v2.id).toBeGreaterThan(version.id)
			const row = await cardOf(card.id)
			expect(row).toMatchObject({
				name: "Ada Lovelace",
				nickname: "Countess",
				description: "new",
				avatarMediaId: null,
				// Not one of the four copies.
				personality: "calm"
			})

			const v3 = await newCardVersion(db, card.id, profile, { label: "" })
			expect(v3).toMatchObject({ number: 3, label: "" })
			await expect(
				newCardVersion(db, 999_999_999, profile)
			).rejects.toThrow(/does not exist/)
		},
		T
	)

	it(
		"updateCardVersion on v1 when v2 exists leaves the card copies alone; on the current one it writes them",
		async () => {
			const { card, version: v1 } = await insertCard(db, {
				userId,
				name: "Ada",
				description: "d1"
			})
			const v2 = await newCardVersion(db, card.id, {
				...emptyCharacterProfile(),
				name: "Ada",
				description: "d2"
			})
			const edited = await updateCardVersion(db, v1.id, {
				name: "Old Ada",
				description: "edited v1"
			})
			expect(edited).toMatchObject({
				id: v1.id,
				name: "Old Ada",
				description: "edited v1"
			})
			expect(await cardOf(card.id)).toMatchObject({
				name: "Ada",
				description: "d2"
			})

			await updateCardVersion(db, v2.id, {
				name: "New Ada",
				description: "edited v2",
				nickname: "N"
			})
			expect(await cardOf(card.id)).toMatchObject({
				name: "New Ada",
				description: "edited v2",
				nickname: "N"
			})

			await expect(
				updateCardVersion(db, 999_999_999, {})
			).rejects.toThrow(/does not exist/)
			const { base } = await insertCastMember(db, {
				lorebookId: await book(),
				binding: token(),
				characterId: null
			})
			await expect(
				updateCardVersion(db, base!.id, { name: "x" })
			).rejects.toThrow(/not a card version/)
		},
		T
	)
})

describe("cast members", () => {
	it(
		"insertCastMember writes a base with the parent and the follows",
		async () => {
			const { card, version } = await insertCard(db, {
				userId,
				name: "Ada",
				description: "d"
			})
			const bookId = await book()
			const { member, base } = await insertCastMember(db, {
				lorebookId: bookId,
				binding: token(),
				characterId: card.id,
				aliases: ["Countess"],
				ownNickname: "A",
				nodeState: "departed"
			})
			expect(base).toMatchObject({
				castMemberId: member.id,
				cardId: null,
				lorebookId: bookId,
				branchId: null,
				year: null,
				sourceSessionId: null,
				personalPosition: null,
				parentVersionId: version.id,
				number: null,
				nodeState: "departed",
				nodeVisibility: "normal",
				aliases: ["Countess"],
				nickname: "A"
			})
			expect(base!.follows).toContain("name")
			expect(base!.follows).toContain("description")
			expect(base!.follows).not.toContain("nickname")
			expect(base!.writeOrder).toBe(base!.id)
			expect(await versionsOf(member.id)).toHaveLength(1)
		},
		T
	)

	it(
		"insertCastMember lifts an uncarded-version card on the way",
		async () => {
			const [raw] = await db
				.insert(schema.characters)
				.values({ userId, name: "Raw", description: "r" })
				.returning()
			const { base } = await insertCastMember(db, {
				lorebookId: await book(),
				binding: token(),
				characterId: raw.id
			})
			const v1 = await ensureCardVersion(db, raw.id)
			expect(base!.parentVersionId).toBe(v1!.id)
		},
		T
	)

	it(
		"insertCastMember writes a card-less base with no parent and everything own",
		async () => {
			const { member, base } = await insertCastMember(db, {
				lorebookId: await book(),
				binding: token(),
				characterId: null,
				name: "Stranger",
				description: "A stranger."
			})
			expect(base).toMatchObject({
				castMemberId: member.id,
				parentVersionId: null,
				name: "Stranger",
				description: "A stranger.",
				follows: []
			})
		},
		T
	)

	it(
		"insertCastMember writes no base for an overlay row",
		async () => {
			const bookId = await book()
			const { member: main } = await insertCastMember(db, {
				lorebookId: bookId,
				binding: token(),
				characterId: null,
				name: "Main"
			})
			const { member, base } = await insertCastMember(db, {
				lorebookId: bookId,
				binding: token(),
				characterId: null,
				name: "Overlay",
				overlayOf: main.id
			})
			expect(base).toBeNull()
			expect(await versionsOf(member.id)).toHaveLength(0)
		},
		T
	)

	it(
		"updateMemberToCardVersion re-parents only versions on older versions of the same card",
		async () => {
			const bookId = await book()
			const { card: a, version: a1 } = await insertCard(db, {
				userId,
				name: "A",
				description: "a"
			})
			const { version: b1 } = await insertCard(db, {
				userId,
				name: "B",
				description: "b"
			})
			const a2 = await newCardVersion(db, a.id, {
				...emptyCharacterProfile(),
				name: "A",
				description: "a2"
			})
			const a3 = await newCardVersion(db, a.id, {
				...emptyCharacterProfile(),
				name: "A",
				description: "a3"
			})
			const { member, base } = await insertCastMember(db, {
				lorebookId: bookId,
				binding: token(),
				characterId: a.id
			})
			expect(base!.parentVersionId).toBe(a3.id)

			const dated = (
				parentVersionId: number,
				year: number,
				follows: string[] = []
			) => ({
				castMemberId: member.id,
				lorebookId: bookId,
				nodeState: "active" as const,
				nodeVisibility: "normal" as const,
				parentVersionId,
				year,
				follows,
				...emptyCharacterProfile()
			})
			const [onA1, onA2, onA3, onB1] = await insertCharacterVersions(db, [
				dated(a1.id, 10, ["description"]),
				dated(a2.id, 20),
				dated(a3.id, 30),
				dated(b1.id, 40)
			])

			const moved = await updateMemberToCardVersion(db, member.id, a3.id)
			expect(moved).toBe(2)
			const after = new Map(
				(await versionsOf(member.id)).map((v) => [v.id, v])
			)
			expect(after.get(onA1.id)!.parentVersionId).toBe(a3.id)
			expect(after.get(onA2.id)!.parentVersionId).toBe(a3.id)
			expect(after.get(onA3.id)!.parentVersionId).toBe(a3.id)
			expect(after.get(onB1.id)!.parentVersionId).toBe(b1.id)

			expect(await updateMemberToCardVersion(db, member.id, a3.id)).toBe(
				0
			)
			expect(await updateMemberToCardVersion(db, member.id, a1.id)).toBe(
				0
			)
			await expect(
				updateMemberToCardVersion(db, member.id, base!.id)
			).rejects.toThrow(/cast member's version/)
		},
		T
	)

	it(
		"updateMemberToCardVersion's retire step: a row a branch reads is retired and its copy re-parented; a row no branch reads moves in place; a retired row is never touched",
		async () => {
			const bookId = await book()
			const { card, version: a1 } = await insertCard(db, {
				userId,
				name: "R",
				description: "r"
			})
			const { member } = await insertCastMember(db, {
				lorebookId: bookId,
				binding: token(),
				characterId: card.id
			})
			const { genreKeeping } = await import("$lib/server/utils/testGenre")
			genreKeeping("test:genre/versions-retire", {
				name: { en: "Versions retire" },
				family: "test",
				slots: [],
				events: {}
			})
			const session = async (name: string) => {
				const [row] = await db
					.insert(schema.sessions)
					.values({
						userId,
						isGroup: false,
						name,
						genreId: "test:genre/versions-retire",
						lorebookId: bookId,
						storyClockYear: 5,
						storyClockMonth: 1,
						storyClockDay: 1
					})
					.returning()
				return row
			}
			const written = async (name: string, summary: string) => {
				const s = await session(name)
				await db.insert(schema.messages).values({
					sessionId: s.id,
					role: "assistant",
					content: "…"
				} as any)
				const out = await writeCastVersion(db, {
					member: member.id,
					changes: { summary },
					writtenBy: `run:${s.id}`,
					session: { id: s.id }
				})
				return { session: s, version: out.version }
			}
			const read = await written("Read", "Read by a branch.")
			const unread = await written("Unread", "No branch reads it.")
			const gone = await written("Gone", "Already retired.")
			const [branch] = await db
				.insert(schema.sessions)
				.values({
					userId,
					isGroup: false,
					name: "Branch",
					genreId: "test:genre/versions-retire",
					lorebookId: bookId,
					branchAncestry: [
						{
							sessionId: read.session.id,
							mark: read.version.writeOrder
						}
					],
					storyClockYear: 5,
					storyClockMonth: 1,
					storyClockDay: 1
				})
				.returning()
			await db.insert(schema.sessionMessages).values({
				sessionId: branch.id,
				role: "assistant",
				content: "copied",
				originSessionId: read.session.id,
				originMessageId: read.version.sourceMessageId
			} as any)
			await db
				.update(schema.characterVersions)
				.set({ retiredOrder: await nextWriteOrder(db) })
				.where(eq(schema.characterVersions.id, gone.version.id))
			for (const w of [read, unread, gone])
				expect(w.version.parentVersionId).toBe(a1.id)

			const rowOf = async (id: number) =>
				(
					await db
						.select()
						.from(schema.characterVersions)
						.where(eq(schema.characterVersions.id, id))
				)[0]!
			const goneBefore = await rowOf(gone.version.id)
			const a2 = await newCardVersion(db, card.id, {
				...emptyCharacterProfile(),
				name: "R",
				description: "r2"
			})

			const moved = await updateMemberToCardVersion(db, member.id, a2.id)

			const retired = await rowOf(read.version.id)
			expect(retired.retiredOrder).not.toBeNull()
			expect(retired.parentVersionId).toBe(a1.id)
			const copies = (await versionsOf(member.id)).filter(
				(r) =>
					r.sourceSessionId === read.session.id &&
					r.id !== read.version.id
			)
			expect(copies).toHaveLength(1)
			expect(copies[0]).toMatchObject({
				parentVersionId: a2.id,
				retiredOrder: null,
				summary: "Read by a branch.",
				sourceSessionId: read.session.id,
				sourceMessageId: read.version.sourceMessageId,
				year: read.version.year,
				writtenBy: read.version.writtenBy
			})
			const inPlace = await rowOf(unread.version.id)
			expect(inPlace.parentVersionId).toBe(a2.id)
			expect(inPlace.retiredOrder).toBeNull()
			expect(await rowOf(gone.version.id)).toEqual(goneBefore)
			expect(moved).toBe(
				// the base, the unread row and the retired-and-copied row
				3
			)
		},
		T
	)
})

describe("resolveFollows", () => {
	async function carded() {
		const bookId = await book()
		const { card, version } = await insertCard(db, {
			userId,
			name: "Ada",
			description: "From the card.",
			personality: "calm",
			firstMessage: "Hello."
		})
		const { member, base } = await insertCastMember(db, {
			lorebookId: bookId,
			binding: token(),
			characterId: card.id,
			description: "mine",
			retold: { description: true }
		})
		return { card, version, member, base: base! }
	}

	it(
		"by card: copies the followed values, clears follows, keeps the parent",
		async () => {
			const { card, version, member, base } = await carded()
			expect(base.follows).toContain("personality")
			expect(base.personality).toBeNull()
			const changed = await resolveFollows(db, { cardId: card.id })
			expect(changed).toBe(1)
			const [after] = await versionsOf(member.id)
			expect(after).toMatchObject({
				id: base.id,
				name: "Ada",
				description: "mine",
				personality: "calm",
				greetings: [{ text: "Hello." }],
				follows: [],
				parentVersionId: version.id
			})
			expect(await resolveFollows(db, { cardId: card.id })).toBe(0)
		},
		T
	)

	it(
		"by member with detach: copies, clears follows and the parent",
		async () => {
			const { member, base } = await carded()
			const changed = await resolveFollows(
				db,
				{ castMemberId: member.id },
				{ detach: true }
			)
			expect(changed).toBe(1)
			const [after] = await versionsOf(member.id)
			expect(after).toMatchObject({
				id: base.id,
				personality: "calm",
				follows: [],
				parentVersionId: null
			})
		},
		T
	)

	it(
		"detach also clears the parent of a version that follows nothing",
		async () => {
			const { member, version } = await carded()
			await resolveFollows(db, { castMemberId: member.id })
			const [still] = await versionsOf(member.id)
			expect(still.parentVersionId).toBe(version.id)
			expect(
				await resolveFollows(
					db,
					{ castMemberId: member.id },
					{ detach: true }
				)
			).toBe(1)
			expect((await versionsOf(member.id))[0].parentVersionId).toBeNull()
		},
		T
	)

	it(
		"a follower whose parent is gone gets the empty values",
		async () => {
			const { member, version, base } = await carded()
			await db
				.delete(schema.characterVersions)
				.where(eq(schema.characterVersions.id, version.id))
			const [orphan] = await versionsOf(member.id)
			expect(orphan.parentVersionId).toBeNull()
			expect(orphan.follows.length).toBeGreaterThan(0)
			expect(await resolveFollows(db, { castMemberId: member.id })).toBe(
				1
			)
			const [after] = await versionsOf(member.id)
			expect(after).toMatchObject({
				id: base.id,
				name: null,
				personality: null,
				greetings: [],
				strokes: [],
				extensions: {},
				follows: [],
				// Its own value is kept.
				description: "mine"
			})
		},
		T
	)

	it(
		"needs a scope, and leaves another card's followers alone",
		async () => {
			await expect(resolveFollows(db, {})).rejects.toThrow(/needs a card/)
			const one = await carded()
			const two = await carded()
			expect(await resolveFollows(db, { cardId: one.card.id })).toBe(1)
			const [untouched] = await versionsOf(two.member.id)
			expect(untouched.follows.length).toBeGreaterThan(0)
		},
		T
	)

	it(
		"strips U+0000 from a card version's profile on insert and on update",
		async () => {
			const { card, version: first } = await insertCard(db, {
				userId,
				name: "Nul",
				description: "clean"
			})
			const version = await newCardVersion(db, card.id, {
				...profileOf(first),
				description: "a\u0000b",
				extensions: { deep: { s: "c\u0000d" } }
			})
			expect(version.description).toBe("ab")
			expect(version.extensions).toEqual({ deep: { s: "cd" } })
			const edited = await updateCardVersion(db, version.id, {
				description: "e\u0000f",
				extensions: { list: ["g\u0000h"] }
			})
			expect(edited.description).toBe("ef")
			expect(edited.extensions).toEqual({ list: ["gh"] })
		},
		T
	)
})

describe("insertCard and the member copy", () => {
	it(
		"insertCard strips U+0000 from a card's text and json before it inserts",
		async () => {
			const { card, version } = await insertCard(db, {
				userId,
				name: "Nul\u0000l",
				description: "Has a\u0000 NUL.",
				alternateGreetings: ["Hi\u0000."],
				extensions: { serenepub: { note: "a\u0000b" } }
			})
			expect(card.description).toBe("Has a NUL.")
			expect(card.name).toBe("Null")
			expect(card.alternateGreetings).toEqual(["Hi."])
			expect(card.extensions).toEqual({ serenepub: { note: "ab" } })
			expect(version.description).toBe("Has a NUL.")
			const stored = await cardOf(card.id)
			expect(stored.description).toBe("Has a NUL.")
			expect(stored.extensions).toEqual({ serenepub: { note: "ab" } })
		},
		T
	)

	it(
		"insertCastMemberCopy inserts a member with no base; isBaseVersion names the base",
		async () => {
			const lorebookId = await book()
			const copy = await insertCastMemberCopy(db, {
				lorebookId,
				binding: token(),
				name: "Copied"
			})
			expect(await versionsOf(copy.id)).toEqual([])
			const { member, base } = await insertCastMember(db, {
				lorebookId,
				binding: token(),
				name: "Made"
			})
			expect(isBaseVersion(base!)).toBe(true)
			expect(await versionsOf(member.id)).toHaveLength(1)
		},
		T
	)
})
