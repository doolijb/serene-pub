/**
 * `lorebooks:memberOfSeat` — the cast member a session's seat seats, and how
 * far the asker can reach it: the member's page in its book (`opensInBook`),
 * or the read-only sheet (name, face and own words) when they cannot.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

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
		path.join(os.tmpdir(), "serene-pub-vitest-memberOfSeat-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`

/** The member's words: three retold (description, greetings, scenario blank), one not. */
const MEMBER_WORDS = {
	ownName: "Marenne",
	description: "Marenne in her own words.",
	personality: "Member text the card still tells.",
	scenario: "   ",
	alternateGreetings: ["Well met.", "Hello again."],
	retold: { description: true, scenario: true, alternateGreetings: true }
}

/**
 * A host with a session, a guest, and a card seated in it. `where` is the
 * book the member lives in: the host's attached book (`attached`) or the
 * session's own book (`own`, the session's lorebook being its own book).
 */
async function world(
	where: "attached" | "own",
	opts: { member?: boolean } = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const host = await createTestUser(testDb, uniq("seat-host"))
	const guest = await createTestUser(testDb, uniq("seat-guest"))
	const stranger = await createTestUser(testDb, uniq("seat-stranger"))
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: host.id,
			name: "Maren",
			description: "The card's description.",
			personality: "The card's personality."
		})
		.returning()
	let attachedId: number | null = null
	if (where === "attached") {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: host.id, name: uniq("Book") })
			.returning()
		attachedId = book!.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: host.id,
			isGroup: false,
			lorebookId: attachedId,
			genreId: "core:genre/story",
			presetId: null,
			genreFields: {}
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id } as any)
	let bookId = attachedId
	if (where === "own") {
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		bookId = (await ownBookFor(testDb as any, session!.id)).id
	}
	let memberId: number | null = null
	if (opts.member !== false) {
		const member = (
			await insertCastMember(testDb, {
				lorebookId: bookId!,
				binding: uniq("{{char:x}}"),
				characterId: card!.id,
				name: "",
				...MEMBER_WORDS
			} as any)
		).member
		memberId = member!.id
	}
	const [seat] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session!.id, characterId: card!.id, position: 0 })
		.returning()
	return {
		host,
		guest,
		stranger,
		card: card!,
		session: session!,
		bookId: bookId!,
		memberId,
		seat: seat!
	}
}

async function ask(
	userId: number,
	sessionId: number,
	ref: string,
	isAdmin = false
) {
	const { lorebookMemberOfSeatHandler } = await import(
		"$lib/server/sockets/lorebooks"
	)
	const emitted: [string, any][] = []
	const socket = { id: `s-${userId}`, user: { id: userId, isAdmin } } as never
	let res: any
	let error: unknown = null
	try {
		res = await (lorebookMemberOfSeatHandler as any).handler(
			socket,
			{ sessionId, ref },
			async (event: string, data: any) => {
				emitted.push([event, data])
			}
		)
	} catch (e) {
		error = e
	}
	return { res, error, emitted }
}

describe("lorebooks:memberOfSeat", () => {
	test("the owner, member in the attached book: opens in the book, no sheet", async () => {
		const w = await world("attached")
		const { res, emitted } = await ask(
			w.host.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res).toEqual({
			sessionId: w.session.id,
			ref: `character:${w.card.id}`,
			member: {
				castMemberId: w.memberId,
				lorebookId: w.bookId,
				opensInBook: true,
				sheet: null
			}
		})
		expect(emitted.map(([e]) => e)).toEqual(["lorebooks:memberOfSeat"])
	})

	test("the owner, a session whose lorebook is its own book: found, opens in the book", async () => {
		const w = await world("own")
		const { res } = await ask(
			w.host.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res.member).toMatchObject({
			castMemberId: w.memberId,
			lorebookId: w.bookId,
			opensInBook: true,
			sheet: null
		})
	})

	test("a guest the host's attached book is shared with opens in the book", async () => {
		const w = await world("attached")
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: w.bookId, userId: w.guest.id })
		const { res } = await ask(
			w.guest.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res.member).toMatchObject({ opensInBook: true, sheet: null })
	})

	test("a guest without a share gets the sheet: the member's own name and only the words it tells itself", async () => {
		const w = await world("attached")
		const { res } = await ask(
			w.guest.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res.member.opensInBook).toBe(false)
		expect(res.member.sheet).toEqual({
			name: "Marenne",
			nickname: null,
			shownName: "Marenne",
			faceMediaId: null,
			// personality follows the card, scenario is retold but blank
			ownWords: [
				{ field: "description", texts: ["Marenne in her own words."] },
				// Greetings are one profile field of a version: its first is
				// the opener, the rest the other greetings.
				{ field: "firstMessage", texts: ["Well met."] },
				{ field: "alternateGreetings", texts: ["Hello again."] }
			]
		})
		expect(JSON.stringify(res.member.sheet)).not.toContain("still tells")
	})

	test("a guest, member in the host session's own book: the sheet, never the book", async () => {
		const w = await world("own")
		const { res } = await ask(
			w.guest.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res.member.opensInBook).toBe(false)
		expect(res.member.sheet.shownName).toBe("Marenne")
	})

	test("an administrator who is a guest does not reach into another's session notes", async () => {
		const w = await world("own")
		const { res } = await ask(
			w.guest.id,
			w.session.id,
			`character:${w.card.id}`,
			true
		)
		expect(res.member.opensInBook).toBe(false)
		expect(res.member.sheet).not.toBeNull()
	})

	test("a seat whose card no member holds answers member: null", async () => {
		const w = await world("attached", { member: false })
		const { res } = await ask(
			w.host.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res).toEqual({
			sessionId: w.session.id,
			ref: `character:${w.card.id}`,
			member: null
		})
	})

	test("a seated-member ref resolves the same seat", async () => {
		const w = await world("attached")
		await testDb
			.update(schema.sessionCharacters)
			.set({ castMemberId: w.memberId })
			.where(
				(await import("drizzle-orm")).eq(
					schema.sessionCharacters.id,
					w.seat.id
				)
			)
		const { res } = await ask(
			w.host.id,
			w.session.id,
			`seated-member:${w.memberId}`
		)
		expect(res.member).toMatchObject({
			castMemberId: w.memberId,
			opensInBook: true
		})
	})

	test("a user with no access is refused, and nothing is emitted on the success event", async () => {
		const w = await world("attached")
		const { res, error, emitted } = await ask(
			w.stranger.id,
			w.session.id,
			`character:${w.card.id}`
		)
		expect(res).toBeUndefined()
		expect(error).toBeInstanceOf(Error)
		expect(emitted).toEqual([
			[
				"lorebooks:memberOfSeat:error",
				{
					error: "Access denied. Session not found or no permission to access."
				}
			]
		])
	})

	test("an unparsable ref or a missing session is refused", async () => {
		const w = await world("attached")
		const bad = await ask(w.host.id, w.session.id, "nonsense")
		expect(bad.error).toBeInstanceOf(Error)
		expect(bad.emitted).toEqual([
			[
				"lorebooks:memberOfSeat:error",
				{ error: "This cast member could not be read." }
			]
		])
		const missing = await ask(
			w.host.id,
			2_000_000_000,
			`character:${w.card.id}`
		)
		expect(missing.error).toBeInstanceOf(Error)
	})
})
