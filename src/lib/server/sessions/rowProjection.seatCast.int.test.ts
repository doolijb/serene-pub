/**
 * 🚧 The session payload's cast fields (plan §27 S2, lane s27-S2-client): what
 * a seat's cast member shows over its card — `seatCastShownFrom`,
 * `seatCastShownForSessions`, `memberSpriteSetsBySeat` — and the last line's
 * speaker (`lastVisibleMessages`), against a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatMembersAsRead } from "$lib/server/pipelines/prompt/seatCards"
import {
	ensureCardVersion,
	insertCastMember,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { CHARACTER_PROFILE_FIELDS } from "$lib/shared/characters/profile"
import {
	lastVisibleMessages,
	memberSpriteSetsBySeat,
	seatCastShownForSessions,
	seatCastShownFrom,
	sessionsWithMemberWords
} from "./rowProjection"

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
		path.join(os.tmpdir(), "serene-pub-vitest-s27client-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `seatcast-${++n}`)
}

async function file(userId: number) {
	const [row] = await testDb
		.insert(schema.files)
		.values({
			userId,
			kind: "image",
			hash: `seatcast-${++n}`
		} as any)
		.returning()
	return row!
}

async function card(
	userId: number,
	name: string,
	over: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name,
			description: `${name}: the card's description.`,
			...over
		} as any)
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

/** A session's own book, made the way a session is born with one. */
async function ownBookOfSession(sessionId: number, userId: number) {
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	return insertOwnBook(db(), {
		sessionId,
		userId,
		name: null,
		overlayOf: null,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
}

async function member(
	lorebookId: number,
	characterId: number | null,
	over: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	// Through the versions module: the member's base is written with it.
	const { member: row } = await insertCastMember(testDb as unknown as Db, {
		lorebookId,
		characterId,
		binding: `{{char:${++n}}}`,
		name: "member",
		...over
	} as any)
	return row
}

/** A cast version dated `year` that reads everything from `cardId`'s current card version (a dated card). */
async function datedCard(
	memberId: number,
	lorebookId: number,
	cardId: number,
	year = 1
) {
	const parent = await ensureCardVersion(testDb as unknown as Db, cardId)
	await insertCharacterVersions(testDb as unknown as Db, [
		{
			castMemberId: memberId,
			lorebookId,
			parentVersionId: parent!.id,
			follows: [...CHARACTER_PROFILE_FIELDS],
			year,
			nodeState: "active",
			nodeVisibility: "normal"
		}
	])
}

/** A session whose lorebook is its own book (no attached book). */
async function ownBookSession(userId: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId: null
		} as any)
		.returning()
	const own = await ownBookOfSession(row!.id, userId)
	return { session: row!, own }
}

async function seat(
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	over: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, ...over } as any)
		.returning()
	return row!
}

async function rows(sessionId: number) {
	return testDb.query.sessionCharacters.findMany({
		where: (cc, { eq }) => eq(cc.sessionId, sessionId),
		with: { character: true },
		orderBy: (cc, { asc }) => [asc(cc.position), asc(cc.id)]
	}) as Promise<any[]>
}

/** What `sessions:list` hands the projection for one session. */
async function listed(sessionId: number) {
	return { id: sessionId, rows: await rows(sessionId) }
}

const NONE = { castNames: {}, castFaces: {} }

describe("seatCastShownForSessions", () => {
	test("a member in the session's own book names and draws the seat over its card", async () => {
		const u = await user()
		const avatar = await file(u.id)
		const face = await file(u.id)
		const c = await card(u.id, "Bianca", { avatarMediaId: avatar.id })
		const { session, own } = await ownBookSession(u.id)
		const m = await member(own.id, c.id, {
			ownName: "Bee",
			faceMediaId: face.id,
			retold: { face: true }
		})
		await seat(session.id, c.id, m.id)
		const out = await seatCastShownForSessions(db(), [
			await listed(session.id)
		])
		expect(out.get(session.id)).toEqual({
			castNames: { [c.id]: { ownName: "Bee", ownNickname: "" } },
			castFaces: { [c.id]: face.id }
		})
	})

	test("today's data sends nothing: no own words, the card's face, or no member at all", async () => {
		const u = await user()
		const avatar = await file(u.id)
		const spare = await file(u.id)
		const plain = await card(u.id, "Plain", { avatarMediaId: avatar.id })
		const alone = await card(u.id, "Alone")
		const b = await book(u.id)
		const mPlain = await member(b.id, plain.id)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, lorebookId: b.id } as any)
			.returning()
		await seat(s!.id, plain.id, mPlain.id, { position: 0 })
		await seat(s!.id, alone.id, null, { position: 1 })
		const shown = await seatCastShownForSessions(db(), [
			await listed(s!.id)
		])
		expect(shown.get(s!.id) ?? NONE).toEqual(NONE)

		// A face file the member keeps but has not retold: still the card's face.
		const b2 = await book(u.id)
		const mFace = await member(b2.id, plain.id, {
			faceMediaId: spare.id,
			retold: {}
		})
		const [s2] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, lorebookId: b2.id } as any)
			.returning()
		await seat(s2!.id, plain.id, mFace.id)
		const kept = await seatCastShownForSessions(db(), [
			await listed(s2!.id)
		])
		expect(kept.get(s2!.id) ?? NONE).toEqual(NONE)

		// The pure read agrees on the same rows.
		const seated = await rows(s!.id)
		expect(
			seatCastShownFrom(
				seated,
				await seatMembersAsRead(db(), s!.id, seated)
			)
		).toEqual(NONE)
	})

	test("an own nickname alone keeps the card's name", async () => {
		const u = await user()
		const c = await card(u.id, "Bianca")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownNickname: "B" })
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, lorebookId: b.id } as any)
			.returning()
		await seat(s!.id, c.id, m.id)
		const out = await seatCastShownForSessions(db(), [await listed(s!.id)])
		expect(out.get(s!.id)).toEqual({
			castNames: { [c.id]: { ownName: "Bianca", ownNickname: "B" } },
			castFaces: {}
		})
	})

	test("two seats on one member are each keyed by their own card", async () => {
		const u = await user()
		const c1 = await card(u.id, "Ada")
		const c2 = await card(u.id, "Ada, later")
		const b = await book(u.id)
		const m = await member(b.id, c1.id, { ownName: "Ada Prime" })
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, lorebookId: b.id } as any)
			.returning()
		await seat(s!.id, c1.id, m.id, { position: 0 })
		await seat(s!.id, c2.id, m.id, { position: 1 })
		const out = await seatCastShownForSessions(db(), [await listed(s!.id)])
		expect(out.get(s!.id)).toEqual({
			castNames: {
				[c1.id]: { ownName: "Ada Prime", ownNickname: "" },
				[c2.id]: { ownName: "Ada Prime", ownNickname: "" }
			},
			castFaces: {}
		})
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	// The seat holds card A, the clock draws the member with card B: the payload
	// shows B's name and B's face, keyed by the seat's card id (A).
	test("a seat shows its member's active card, the card the story clock draws", async () => {
		const u = await user()
		const avatarA = await file(u.id)
		const avatarB = await file(u.id)
		const a = await card(u.id, "Maren", { avatarMediaId: avatarA.id })
		const younger = await card(u.id, "Maren, younger", {
			avatarMediaId: avatarB.id
		})
		const b = await book(u.id)
		// No words of its own: its dated card alone makes the list read it.
		const m = await member(b.id, a.id)
		await datedCard(m.id, b.id, younger.id)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				lorebookId: b.id,
				storyClockYear: 10
			} as any)
			.returning()
		await seat(s!.id, a.id, m.id)
		// The clock draws the younger card for the member; the seat holds the elder.
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		expect(
			(await memberAsRead(db(), m.id, { sessionId: s!.id }))?.activeCardId
		).toBe(younger.id)
		const out = await seatCastShownForSessions(db(), [await listed(s!.id)])
		expect(out.get(s!.id)).toEqual({
			castNames: {
				[a.id]: { ownName: "Maren, younger", ownNickname: "" }
			},
			castFaces: { [a.id]: avatarB.id }
		})
		expect(out.get(s!.id)!.castNames[younger.id]).toBeUndefined()
		expect(out.get(s!.id)!.castFaces[younger.id]).toBeUndefined()
	})
})

describe("memberSpriteSetsBySeat", () => {
	test("a member's own sets with an image show by seated card; sets without one, or none, add nothing", async () => {
		const u = await user()
		const image = await file(u.id)
		const withSet = await card(u.id, "Sprited")
		const emptySet = await card(u.id, "Empty")
		const noSets = await card(u.id, "Bare")
		const b = await book(u.id)
		const mSet = await member(b.id, withSet.id)
		const mEmpty = await member(b.id, emptySet.id)
		const mBare = await member(b.id, noSets.id)
		const [casual] = await testDb
			.insert(schema.spriteSets)
			.values({
				castMemberId: mSet.id,
				name: "casual",
				isDefault: true
			})
			.returning()
		await testDb.insert(schema.sprites).values([
			{
				spriteSetId: casual!.id,
				label: "joy",
				position: 0,
				fileId: image.id
			},
			// An empty slot: no file, so it does not show.
			{ spriteSetId: casual!.id, label: "grim", position: 0 }
		])
		const [hollow] = await testDb
			.insert(schema.spriteSets)
			.values({
				castMemberId: mEmpty.id,
				name: "hollow",
				isDefault: true
			})
			.returning()
		await testDb
			.insert(schema.sprites)
			.values({ spriteSetId: hollow!.id, label: "joy", position: 0 })
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, lorebookId: b.id } as any)
			.returning()
		await seat(s!.id, withSet.id, mSet.id, { position: 0 })
		await seat(s!.id, emptySet.id, mEmpty.id, { position: 1 })
		await seat(s!.id, noSets.id, mBare.id, { position: 2 })
		const seated = await rows(s!.id)
		const out = await memberSpriteSetsBySeat(
			db(),
			seated,
			await seatMembersAsRead(db(), s!.id, seated)
		)
		expect(out).toEqual({
			[withSet.id]: [
				{
					name: "casual",
					isDefault: true,
					sprites: [
						{
							label: "joy",
							position: 0,
							file: { uuid: image.uuid, rev: image.rev }
						}
					]
				}
			]
		})
	})
})

describe("lastVisibleMessages", () => {
	test("the last line names the member of the session's own book", async () => {
		const u = await user()
		const c = await card(u.id, "Bianca")
		const { session, own } = await ownBookSession(u.id)
		const m = await member(own.id, c.id, { ownName: "Bee" })
		await seat(session.id, c.id, m.id)
		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "assistant",
			content: "Hello there.",
			characterId: c.id
		} as any)
		const last = await lastVisibleMessages(db(), [session.id])
		expect(last.get(session.id)?.speakerName).toBe("Bee")
	})
})

describe("sessionsWithMemberWords", () => {
	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	test("a member with no words of its own but a dated card is read; a plain one is not", async () => {
		const u = await user()
		const a = await card(u.id, "Maren")
		const younger = await card(u.id, "Maren, younger")
		const b = await book(u.id)
		const dated = await member(b.id, a.id)
		await datedCard(dated.id, b.id, younger.id)
		const otherCard = await card(u.id, "Otto")
		const b2 = await book(u.id)
		const plain = await member(b2.id, otherCard.id)
		const [withDate, without, playerDated] = await Promise.all(
			[b.id, b2.id, b.id].map(async (lorebookId) => {
				const [s] = await testDb
					.insert(schema.sessions)
					.values({ userId: u.id, isGroup: false, lorebookId } as any)
					.returning()
				return s!
			})
		)
		await seat(withDate!.id, a.id, dated.id)
		await seat(without!.id, otherCard.id, plain.id)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: playerDated!.id,
			personaId: a.id,
			castMemberId: dated.id
		} as any)
		const out = await sessionsWithMemberWords(db(), [
			withDate!.id,
			without!.id,
			playerDated!.id
		])
		expect([...out].sort()).toEqual([withDate!.id, playerDated!.id].sort())
	})
})

describe("lastVisibleMessages — a persona-voiced line", () => {
	// Owner ruling 2026-11-05: "a persona seat reads its cast member like every
	// seat" (★pT-1); the seat name still wins (`withSeatName`).
	async function voiced(seatName: string | null) {
		const u = await user()
		const persona = await card(u.id, "Wren", { isPersona: true })
		const younger = await card(u.id, "Wren, younger", { isPersona: true })
		const { session, own } = await ownBookSession(u.id)
		const m = await member(own.id, persona.id)
		await datedCard(m.id, own.id, younger.id)
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 10 } as any)
			.where(eq(schema.sessions.id, session.id))
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session.id,
			personaId: persona.id,
			castMemberId: m.id,
			seatName
		} as any)
		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "user",
			content: "I answer.",
			personaId: persona.id
		} as any)
		return session
	}

	test("the line is named by the player seat's member over its active card", async () => {
		const session = await voiced(null)
		const last = await lastVisibleMessages(db(), [session.id])
		expect(last.get(session.id)?.speakerName).toBe("Wren, younger")
	})

	test("a seat name wins over the member", async () => {
		const session = await voiced("Hawk")
		const last = await lastVisibleMessages(db(), [session.id])
		expect(last.get(session.id)?.speakerName).toBe("Hawk")
	})
})
