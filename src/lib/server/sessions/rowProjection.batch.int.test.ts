/**
 * 🚧 The batch member read behind `sessions:list` (lane s27-S2-cT2): for many
 * sessions at once, `seatCastShownForSessions` and `lastVisibleMessages` say
 * exactly what the per-session reads (`seatMembersAsRead`, `cardsAsSeatsRead`)
 * say, with the candidate sessions asked once (`withMemberWords`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	ensureCardVersion,
	insertCastMember,
	insertCharacterVersions,
	writeCastVersion
} from "$lib/server/characters/versions"
import { CHARACTER_PROFILE_FIELDS } from "$lib/shared/characters/profile"
import {
	cardsAsSeatsRead,
	seatMembersAsRead
} from "$lib/server/pipelines/prompt/seatCards"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	lastVisibleMessages,
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
		path.join(os.tmpdir(), "serene-pub-vitest-s27cT2batch-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function mk(table: any, values: any): Promise<any> {
	const [row] = await (testDb as any).insert(table).values(values).returning()
	return row
}
const card = (userId: number, name: string, over: any = {}) =>
	mk(schema.characters, { userId, name, description: `${name}.`, ...over })
const book = (userId: number) =>
	mk(schema.lorebooks, { userId, name: `Book ${++n}` })
// Through the versions module: the member's base is written with it.
const member = async (
	lorebookId: number,
	characterId: number | null,
	over: any = {}
) =>
	(
		await insertCastMember(testDb as unknown as Db, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		})
	).member
const seat = (
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	over: any = {}
) =>
	mk(schema.sessionCharacters, {
		sessionId,
		characterId,
		castMemberId,
		...over
	})

/** A session with an attached book, or (null) one whose lorebook is its own book. */
async function session(
	userId: number,
	lorebookId: number | null,
	over: any = {}
) {
	const s = await mk(schema.sessions, {
		userId,
		isGroup: false,
		name: `Run ${++n}`,
		lorebookId,
		...over
	})
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const own = await insertOwnBook(db(), {
		sessionId: s.id,
		userId,
		name: null,
		overlayOf: null,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	return { s, own }
}

async function say(sessionId: number, characterId: number | null) {
	await mk(schema.sessionMessages, {
		sessionId,
		role: "assistant",
		content: "Hello there.",
		characterId
	})
}

/** A seat row as `sessions:list` hands it over (a trimmed card). */
async function listed(sessionId: number) {
	const rows = (await testDb.query.sessionCharacters.findMany({
		where: (cc, { eq }) => eq(cc.sessionId, sessionId),
		with: { character: true },
		orderBy: (cc, { asc }) => [asc(cc.position), asc(cc.id)]
	})) as any[]
	return { id: sessionId, rows }
}

/** Every session the fixture makes, with the speaker of its last line. */
async function fixture() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `batch-${++n}`)
	const face = await mk(schema.files, {
		userId: u.id,
		kind: "image",
		hash: `batch-${++n}`
	})
	const sessions: Record<string, number> = {}
	const speakers: Record<string, number | null> = {}
	const add = async (name: string, id: number, speaker: number | null) => {
		sessions[name] = id
		speakers[name] = speaker
		if (speaker != null) await say(id, speaker)
	}

	// A stored member with an own name, in the attached book; two sessions
	// share the book at different story clocks (a dated name change).
	const bA = await book(u.id)
	const cA = await card(u.id, "Ann")
	const mA = await member(bA.id, cA.id, { ownName: "Annie" })
	await testDb.transaction((tx) =>
		writeCastVersion(tx as unknown as Db, {
			member: mA.id,
			changes: { name: "Annie, later" },
			writtenBy: `user:${u.id}`,
			at: {
				branchId: null,
				date: { year: 5, month: null, day: null },
				personalPosition: null
			}
		})
	)
	const early = await session(u.id, bA.id, { storyClockYear: 1 })
	await seat(early.s.id, cA.id, mA.id)
	await add("storedAttachedEarly", early.s.id, cA.id)
	const late = await session(u.id, bA.id, { storyClockYear: 10 })
	await seat(late.s.id, cA.id, mA.id)
	await add("storedAttachedLate", late.s.id, cA.id)

	// An own-book member with a face of its own; the session has no attached book.
	const cB = await card(u.id, "Bea")
	const own = await session(u.id, null)
	const mB = await member(own.own.id, cB.id, {
		faceMediaId: face.id,
		retold: { face: true }
	})
	await seat(own.s.id, cB.id, mB.id)
	await add("ownBookFace", own.s.id, cB.id)

	// A seat with no member stored: its card's member in the attached book is found.
	const bC = await book(u.id)
	const cC = await card(u.id, "Cy")
	await member(bC.id, cC.id, { ownName: "Cyrus" })
	const found = await session(u.id, bC.id)
	await seat(found.s.id, cC.id, null)
	await add("foundAttached", found.s.id, cC.id)

	// A card whose member holds it only by a dated amendment.
	const bD = await book(u.id)
	const cDold = await card(u.id, "Dee, old")
	const cD = await card(u.id, "Dee")
	const mD = await member(bD.id, cDold.id, { ownName: "Deirdre" })
	// The dated card keeps the member's own name and reads the rest from cD.
	const cDVersion = await ensureCardVersion(testDb as unknown as Db, cD.id)
	await insertCharacterVersions(testDb as unknown as Db, [
		{
			castMemberId: mD.id,
			lorebookId: bD.id,
			parentVersionId: cDVersion!.id,
			follows: CHARACTER_PROFILE_FIELDS.filter((f) => f !== "name"),
			name: "Deirdre",
			year: 1,
			nodeState: "active",
			nodeVisibility: "normal"
		}
	])
	const dated = await session(u.id, bD.id)
	await seat(dated.s.id, cD.id, null)
	await add("foundDated", dated.s.id, cD.id)

	// A stored member living in another book is untrusted: the book's own member is found.
	const bE = await book(u.id)
	const bElsewhere = await book(u.id)
	const cE = await card(u.id, "Eve")
	await member(bE.id, cE.id, { ownName: "Right" })
	const mElsewhere = await member(bElsewhere.id, cE.id, { ownName: "Wrong" })
	const elsewhere = await session(u.id, bE.id)
	await seat(elsewhere.s.id, cE.id, mElsewhere.id)
	await add("storedElsewhere", elsewhere.s.id, cE.id)

	// Two seats on one member holding different cards.
	const bF = await book(u.id)
	const cF1 = await card(u.id, "Fay")
	const cF2 = await card(u.id, "Fay, later")
	const mF = await member(bF.id, cF1.id, { ownName: "Fay Prime" })
	const two = await session(u.id, bF.id)
	await seat(two.s.id, cF1.id, mF.id, { position: 0 })
	await seat(two.s.id, cF2.id, mF.id, { position: 1 })
	await add("twoSeatsOneMember", two.s.id, cF2.id)

	// Two sessions with no attached book: their seats share batches.
	const cG = await card(u.id, "Gus")
	const g = await session(u.id, null)
	await member(g.own.id, cG.id, { ownName: "Gustav" })
	await seat(g.s.id, cG.id, null)
	await add("ownBookFound", g.s.id, cG.id)
	const cH1 = await card(u.id, "Hal")
	const cH2 = await card(u.id, "Hal, later")
	const h = await session(u.id, null)
	const mH = await member(h.own.id, cH1.id, { ownName: "Harold" })
	await seat(h.s.id, cH1.id, mH.id, { position: 0 })
	await seat(h.s.id, cH2.id, mH.id, { position: 1 })
	await add("ownBookTwoSeats", h.s.id, cH1.id)

	// A departed seat only: the speaker's card is read through it.
	const bI = await book(u.id)
	const cI = await card(u.id, "Ida")
	const mI = await member(bI.id, cI.id, { ownName: "Idabel" })
	const gone = await session(u.id, bI.id)
	await seat(gone.s.id, cI.id, mI.id, { removedAt: new Date() })
	await add("departedSeat", gone.s.id, cI.id)

	// Plain sessions: a member with no own words, no member, no seat.
	const bJ = await book(u.id)
	const cJ = await card(u.id, "Jo")
	const mJ = await member(bJ.id, cJ.id)
	const plain = await session(u.id, bJ.id)
	await seat(plain.s.id, cJ.id, mJ.id)
	await add("plainMember", plain.s.id, cJ.id)
	const cK = await card(u.id, "Kit")
	const alone = await session(u.id, null)
	await seat(alone.s.id, cK.id, null)
	await add("noMember", alone.s.id, cK.id)
	const empty = await session(u.id, null)
	await add("noSeats", empty.s.id, null)

	return sessions
}

/** What the per-session reads say for one session, as the list shows it. */
async function reference(sessionId: number) {
	const rows = (await listed(sessionId)).rows
	const full = await Promise.all(
		rows.map(async (r) => ({
			castMemberId: r.castMemberId ?? null,
			character: r.character
				? ((await testDb.query.characters.findFirst({
						where: (c, { eq }) => eq(c.id, r.character.id),
						columns: {
							id: true,
							name: true,
							nickname: true,
							avatarMediaId: true
						}
					})) ?? null)
				: null
		}))
	)
	return seatCastShownFrom(
		full,
		await seatMembersAsRead(db(), sessionId, full)
	)
}

describe("the list reads cast members in batches", () => {
	test("seatCastShownForSessions equals the per-session read, for every session", async () => {
		const sessions = await fixture()
		const ids = Object.values(sessions)
		const listedSessions = await Promise.all(ids.map(listed))
		const candidates = await sessionsWithMemberWords(db(), ids)

		const expected = new Map<number, unknown>()
		for (const id of ids)
			if (candidates.has(id)) expected.set(id, await reference(id))

		const asked = await seatCastShownForSessions(db(), listedSessions)
		const given = await seatCastShownForSessions(db(), listedSessions, {
			withMemberWords: candidates
		})
		expect(new Map(asked)).toEqual(expected)
		expect(new Map(given)).toEqual(expected)

		// The fixture is not vacuous: the words that should show do.
		const shown = (name: string) => given.get(sessions[name])
		expect(shown("storedAttachedEarly")?.castNames).toMatchObject({
			[Object.keys(shown("storedAttachedEarly")!.castNames)[0]]: {
				ownName: "Annie"
			}
		})
		expect(JSON.stringify(shown("storedAttachedLate"))).toContain(
			"Annie, later"
		)
		expect(Object.keys(shown("ownBookFace")!.castFaces)).toHaveLength(1)
		for (const name of [
			"foundAttached",
			"storedElsewhere",
			"departedSeat",
			"ownBookFound"
		])
			expect(Object.keys(shown(name)!.castNames)).toHaveLength(1)
		expect(JSON.stringify(shown("storedElsewhere"))).toContain("Right")
		expect(Object.keys(shown("twoSeatsOneMember")!.castNames)).toHaveLength(
			2
		)
		expect(Object.keys(shown("ownBookTwoSeats")!.castNames)).toHaveLength(2)
		for (const name of ["plainMember", "noMember", "noSeats"])
			expect(given.get(sessions[name])).toBeUndefined()
	})

	test("with every session named, the batch still equals the per-session read (a dated-only member is found)", async () => {
		const sessions = await fixture()
		const ids = Object.values(sessions)
		const listedSessions = await Promise.all(ids.map(listed))
		const everyone = new Set(ids)
		const given = await seatCastShownForSessions(db(), listedSessions, {
			withMemberWords: everyone
		})
		// Every session with a card is read, not only the prefilter's.
		const expected = new Map<number, unknown>()
		for (const s of listedSessions)
			if (s.rows.some((r) => r.character))
				expected.set(s.id, await reference(s.id))
		expect(new Map(given)).toEqual(expected)
		expect(JSON.stringify(given.get(sessions.foundDated))).toContain(
			"Deirdre"
		)
	})

	test("a candidate set the caller names is the only one read", async () => {
		const sessions = await fixture()
		const ids = Object.values(sessions)
		const listedSessions = await Promise.all(ids.map(listed))
		const only = new Set([sessions.foundAttached])
		const given = await seatCastShownForSessions(db(), listedSessions, {
			withMemberWords: only
		})
		expect([...given.keys()]).toEqual([sessions.foundAttached])
	})

	test("lastVisibleMessages names each speaker as its seat reads it", async () => {
		const sessions = await fixture()
		const ids = Object.values(sessions)
		const candidates = await sessionsWithMemberWords(db(), ids)

		// The per-session reference: the speaker's card through `cardsAsSeatsRead`
		// for the sessions asked about, the card as it is for the rest.
		const referenceFor = async (asked: ReadonlySet<number>) => {
			const expected = new Map<number, string>()
			for (const id of ids) {
				const [msg] = await testDb.query.sessionMessages.findMany({
					where: (m, { eq }) => eq(m.sessionId, id),
					limit: 1
				})
				if (!msg?.characterId) continue
				const speaker = await testDb.query.characters.findFirst({
					where: (c, { eq }) => eq(c.id, msg.characterId!)
				})
				const [read] = asked.has(id)
					? await cardsAsSeatsRead(db(), id, [
							{
								id: speaker!.id,
								name: speaker!.name,
								nickname: speaker!.nickname
							}
						])
					: [speaker!]
				expected.set(id, resolveCharacterName(read as any, ""))
			}
			return expected
		}
		const expected = await referenceFor(candidates)
		const everyone = new Set(ids)
		const expectedEveryone = await referenceFor(everyone)

		for (const opts of [undefined, { withMemberWords: candidates }]) {
			const last = await lastVisibleMessages(db(), ids, opts)
			expect(
				new Map([...last].map(([id, l]) => [id, l.speakerName ?? ""]))
			).toEqual(expected)
		}
		const last = await lastVisibleMessages(db(), ids, {
			withMemberWords: everyone
		})
		expect(
			new Map([...last].map(([id, l]) => [id, l.speakerName ?? ""]))
		).toEqual(expectedEveryone)
		expect(expectedEveryone.get(sessions.foundDated)).toBe("Deirdre")
		expect(expected.get(sessions.foundDated)).toBe("Dee")
		expect(expected.get(sessions.ownBookTwoSeats)).toBe("Harold")
		expect(expected.get(sessions.plainMember)).toBe("Jo")
	})
})
