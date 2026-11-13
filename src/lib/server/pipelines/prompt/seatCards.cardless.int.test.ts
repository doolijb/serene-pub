/**
 * 🚧 Card-less seats read as their member (S4, lane s4-seat w2):
 * `cardlessSeatCard`, the `cardless` option of `seatMembersAsRead` /
 * `seatCardsAsRead`, and `getPromptSessionFromDb` handing a card-less seat's
 * row an id-less card-shaped `character`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCastMember,
	updateCastVersion
} from "$lib/server/characters/versions"
import { memberAsRead } from "$lib/server/cast/memberAsRead"
import {
	cardlessSeatCard,
	seatCardsAsRead,
	seatMembersAsRead
} from "./seatCards"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatcards-cardless-")
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
	return createTestUser(testDb, `seatcards-cl-${++n}`)
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

async function session(userId: number, lorebookId: number | null) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId
		} as any)
		.returning()
	return row!
}

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

/** A card-less member with its own words. */
async function cardlessMember(lorebookId: number, name: string) {
	const { member, base } = await insertCastMember(db(), {
		lorebookId,
		characterId: null,
		binding: `{{char:${++n}}}`,
		name,
		ownName: name
	} as any)
	await updateCastVersion(db(), base!.id, {
		changes: {
			description: `${name}: own description.`,
			personality: `${name}: own personality.`,
			postHistoryInstructions: `${name}: own post-history.`,
			greetings: [{ text: `${name} says hello.` }]
		}
	})
	return member!
}

describe("cardlessSeatCard", () => {
	test("is card-shaped from the member, with no id and no userId", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await cardlessMember(b.id, "Wren")
		const s = await session(u.id, b.id)
		const asRead = (await memberAsRead(db(), m.id, { sessionId: s.id }))!
		const card = cardlessSeatCard(asRead)
		expect("id" in card).toBe(false)
		expect("userId" in card).toBe(false)
		expect(card.cardless).toBe(true)
		expect(card.name).toBe("Wren")
		expect(card.description).toBe("Wren: own description.")
		expect(card.personality).toBe("Wren: own personality.")
		expect(card.firstMessage).toBe("Wren says hello.")
		expect(card.postHistoryInstructions).toBe("Wren: own post-history.")
	})
})

describe("seatCardsAsRead / seatMembersAsRead { cardless: true }", () => {
	test("without the option, a card-less row and a player row come back unchanged", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await cardlessMember(b.id, "Off")
		const s = await session(u.id, b.id)
		const rows = [
			{ castMemberId: m.id, character: null },
			{ castMemberId: m.id, persona: null, character: null }
		]
		const out = await seatCardsAsRead(db(), s.id, rows)
		expect(out[0]).toBe(rows[0])
		expect(out[1]).toBe(rows[1])
		expect(await seatMembersAsRead(db(), s.id, rows)).toEqual([null, null])
	})

	test("a card-less seat whose member lives in the own book reads that member", async () => {
		const u = await user()
		const s = await session(u.id, null)
		const own = await ownBookOfSession(s.id, u.id)
		const m = await cardlessMember(own.id, "Ember")
		const rows = [{ castMemberId: m.id, character: null }]
		const [out] = await seatCardsAsRead(db(), s.id, rows, {
			cardless: true
		})
		const character = out!.character as any
		expect(character.name).toBe("Ember")
		expect("id" in character).toBe(false)
		expect(character.cardless).toBe(true)
		expect(out!.castMemberId).toBe(m.id)
	})

	test("a card-less seat whose member lives in the attached book reads that member", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await cardlessMember(b.id, "Attached")
		const s = await session(u.id, b.id)
		const [asRead] = await seatMembersAsRead(
			db(),
			s.id,
			[{ castMemberId: m.id, character: null }],
			{ cardless: true }
		)
		expect(asRead?.name).toBe("Attached")
	})

	test("a branch's card-less seat whose member lives in the parent's own book reads that member", async () => {
		const u = await user()
		const parent = await session(u.id, null)
		const parentOwn = await ownBookOfSession(parent.id, u.id)
		const m = await cardlessMember(parentOwn.id, "Heir")
		const [branch] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				name: `Branch ${++n}`,
				lorebookId: null,
				branchAncestry: [{ sessionId: parent.id, mark: 1_000_000 }]
			} as any)
			.returning()
		await ownBookOfSession(branch!.id, u.id)
		const [asRead] = await seatMembersAsRead(
			db(),
			branch!.id,
			[{ castMemberId: m.id, character: null }],
			{ cardless: true }
		)
		expect(asRead?.name).toBe("Heir")
	})

	test("a member in an unrelated book does not read", async () => {
		const u = await user()
		const other = await book(u.id)
		const m = await cardlessMember(other.id, "Stranger")
		const s = await session(u.id, null)
		await ownBookOfSession(s.id, u.id)
		const rows = [{ castMemberId: m.id, character: null }]
		const out = await seatCardsAsRead(db(), s.id, rows, { cardless: true })
		expect(out[0]).toBe(rows[0])
		expect(
			await seatMembersAsRead(db(), s.id, rows, { cardless: true })
		).toEqual([null])
	})
})

describe("getPromptSessionFromDb with a card-less seat", () => {
	test("the row's character is the member, has no id, and an envoy's departed row is not removed-cast", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await cardlessMember(b.id, "Sable")
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			castMemberId: m.id,
			seatedByUserId: u.id,
			position: 0
		} as any)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			envoySlug: "mascot",
			removedAt: new Date(),
			position: 1
		} as any)
		const { getPromptSessionFromDb } = await import(
			"$lib/server/sockets/sessions"
		)
		const session_: any = await getPromptSessionFromDb(s.id, u.id)
		expect(session_.sessionCharacters).toHaveLength(1)
		const row = session_.sessionCharacters[0]
		expect(row.character.name).toBe("Sable")
		expect(row.character.id).toBeUndefined()
		expect(row.castMemberId).toBe(m.id)
		expect(session_.removedSessionCharacters).toEqual([])
	})
})
