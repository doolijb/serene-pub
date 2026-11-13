/**
 * 🚧 A seat greets in the words of the cast member it seats, wherever the
 * member lives (plan §27 S2): the session's own book as well as an attached
 * one. `{{char}}` reads the member's own name.
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
		path.join(os.tmpdir(), "serene-pub-vitest-greetseat-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function world(where: "attached" | "own", castMemberStored: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `greetseat-${++n}`)
	const [c] = await testDb
		.insert(schema.characters)
		.values({
			userId: u.id,
			name: `Card ${n}`,
			description: "The card.",
			firstMessage: "{{char}} says the card's hello.",
			alternateGreetings: ["The card's other hello."]
		})
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: u.id, isGroup: false, name: `Run ${n}` } as any)
		.returning()
	let bookId: number
	if (where === "own") {
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		bookId = (
			await insertOwnBook(db(), {
				sessionId: s.id,
				userId: u.id,
				name: null,
				overlayOf: null,
				primaryRuleset: "core:ruleset/freeform@1",
				rulesetVersion: null
			})
		).id
	} else {
		const [b] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: `Book ${n}` } as any)
			.returning()
		bookId = b.id
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: b.id })
			.where((await import("drizzle-orm")).eq(schema.sessions.id, s.id))
	}
	const m = (
		await insertCastMember(testDb, {
			lorebookId: bookId,
			characterId: c.id,
			binding: `{{char:${n}}}`,
			name: c.name,
			ownName: `Member ${n}`,
			firstMessage: "{{char}} greets in the member's words.",
			alternateGreetings: ["The member's other hello."],
			retold: { firstMessage: true, alternateGreetings: true }
		} as any)
	).member
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: s.id,
		characterId: c.id,
		castMemberId: castMemberStored ? m.id : null
	} as any)
	return { s, c, m }
}

describe("collectSessionGreetings reads the seated member", () => {
	for (const where of ["attached", "own"] as const)
		for (const stored of [true, false])
			test(`a member of ${where === "own" ? "the session's own book" : "an attached book"} (${stored ? "seat holds the member" : "member found by the card"}) greets in their words`, async () => {
				const { s, c, m } = await world(where, stored)
				const { collectSessionGreetings } = await import(
					"$lib/server/sessions/greetings"
				)
				const out = await collectSessionGreetings(db(), s.id)
				expect(out.entries).toEqual([
					{
						characterId: c.id,
						texts: [
							`${m.ownName} greets in the member's words.`,
							"The member's other hello."
						]
					}
				])
			})

	test("a seat nobody retells greets with the card's words", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, `greetseat-${++n}`)
		const [c] = await testDb
			.insert(schema.characters)
			.values({
				userId: u.id,
				name: "Plain",
				description: "The card.",
				firstMessage: "Hello from the card."
			})
			.returning()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: "Plain run" } as any)
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id } as any)
		const { collectSessionGreetings } = await import(
			"$lib/server/sessions/greetings"
		)
		expect((await collectSessionGreetings(db(), s.id)).entries).toEqual([
			{ characterId: c.id, texts: ["Hello from the card."] }
		])
	})

	// ★pT-1 (owner, 2026-11-05): "Everything in session is cast -> active
	// card" -- the greeting's {{user}} is the player seat's member, a seat name
	// still winning.
	test("{{user}} is the player seat's member's own name; a seat name wins over it", async () => {
		const { eq } = await import("drizzle-orm")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, `greetseat-${++n}`)
		const [c] = await testDb
			.insert(schema.characters)
			.values({
				userId: u.id,
				name: "Host",
				description: "The host.",
				firstMessage: "Welcome, {{user}}."
			})
			.returning()
		const [pc] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Pia", description: "The card." })
			.returning()
		const [b] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: `Book ${n}` } as any)
			.returning()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				name: "Pia run",
				lorebookId: b.id
			} as any)
			.returning()
		const pm = (
			await insertCastMember(testDb, {
				lorebookId: b.id,
				characterId: pc.id,
				binding: `{{char:${n}}}`,
				name: "Pia",
				ownName: "Pia of the Book"
			} as any)
		).member
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id } as any)
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: pc.id,
				userId: u.id,
				castMemberId: pm.id
			} as any)
			.returning()
		const { collectSessionGreetings } = await import(
			"$lib/server/sessions/greetings"
		)
		expect((await collectSessionGreetings(db(), s.id)).entries).toEqual([
			{ characterId: c.id, texts: ["Welcome, Pia of the Book."] }
		])
		await testDb
			.update(schema.sessionPersonas)
			.set({ seatName: "Mistress Pia" })
			.where(eq(schema.sessionPersonas.id, seat.id))
		expect((await collectSessionGreetings(db(), s.id)).entries).toEqual([
			{ characterId: c.id, texts: ["Welcome, Mistress Pia."] }
		])
	})
})
