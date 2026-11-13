/**
 * 🚧 The seat filters over a card-less character seat (plan §34.2, S4): a session with one carded
 * seat, one card-less seat (`character_id` null, `cast_member_id` set) and one envoy seat.
 * `seatedCastOf`, the row projection's message names and `sessionsWithMemberWords`, and the
 * conversation gate's session card.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
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
		path.join(os.tmpdir(), "serene-pub-vitest-seatfilters-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db

/** The session: a carded seat (Verity), a card-less seat (Nobody) and an envoy seat. */
async function world(opts: { cardedSeat?: boolean } = {}) {
	const suffix = ++n
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `seatfilters-${suffix}` })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user!.id, name: "Verity", description: "" })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Book ${suffix}` })
		.returning()
	const carded = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:v${suffix}}}`,
			characterId: card!.id,
			name: "Verity"
		})
	).member!
	const cardless = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:n${suffix}}}`,
			characterId: null,
			name: "Nobody",
			ownName: "Nobody"
		})
	).member!
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user!.id,
			isGroup: true,
			lorebookId: book!.id
		} as any)
		.returning()
	const sessionId = session!.id
	const seats: Record<string, any>[] = [
		{
			sessionId,
			characterId: null,
			castMemberId: cardless.id,
			position: 1
		},
		{ sessionId, characterId: null, envoySlug: "mascot", position: 2 }
	]
	if (opts.cardedSeat !== false)
		seats.unshift({
			sessionId,
			characterId: card!.id,
			castMemberId: carded.id,
			position: 0
		})
	await testDb.insert(schema.sessionCharacters).values(seats as any)
	return { user: user!, card: card!, carded, cardless, sessionId }
}

describe("seatedCastOf", () => {
	it("lists the card-less seat (cardId null, asRead the member) and not the envoy seat", async () => {
		const { seatedCastOf } = await import("$lib/server/cast/seatedCast")
		const w = await world()
		const seated = await seatedCastOf(db(), w.sessionId)
		expect(seated.map((s) => [s.kind, s.castMemberId, s.cardId])).toEqual([
			["character", w.carded.id, w.card.id],
			["character", w.cardless.id, null]
		])
		expect(seated[1]!.asRead).toMatchObject({
			castMemberId: w.cardless.id,
			name: "Nobody",
			cardless: true
		})
	})
})

describe("the row projection", () => {
	it("a card-less line (character_id null, cast_member_id M) is named by M", async () => {
		const { lastVisibleMessages } = await import(
			"$lib/server/sessions/rowProjection"
		)
		const w = await world({ cardedSeat: false })
		await testDb.insert(schema.sessionMessages).values({
			sessionId: w.sessionId,
			role: "assistant",
			content: "Hello there.",
			characterId: null,
			castMemberId: w.cardless.id
		} as any)
		const last = (await lastVisibleMessages(db(), [w.sessionId])).get(
			w.sessionId
		)
		expect(last).toMatchObject({
			excerpt: "Hello there.",
			speakerName: "Nobody"
		})
	})

	it("sessionsWithMemberWords includes a session that only has a card-less seat", async () => {
		const { sessionsWithMemberWords } = await import(
			"$lib/server/sessions/rowProjection"
		)
		const w = await world({ cardedSeat: false })
		expect(await sessionsWithMemberWords(db(), [w.sessionId])).toEqual(
			new Set([w.sessionId])
		)
	})

	it("sessionsWithMemberWords skips a session whose only seat is an envoy's", async () => {
		const { sessionsWithMemberWords } = await import(
			"$lib/server/sessions/rowProjection"
		)
		const w = await world({ cardedSeat: false })
		await testDb
			.delete(schema.sessionCharacters)
			.where(
				(await import("drizzle-orm")).and(
					(await import("drizzle-orm")).eq(
						schema.sessionCharacters.sessionId,
						w.sessionId
					),
					(await import("drizzle-orm")).isNotNull(
						schema.sessionCharacters.castMemberId
					)
				)
			)
		expect(await sessionsWithMemberWords(db(), [w.sessionId])).toEqual(
			new Set()
		)
	})
})

describe("the conversation gate", () => {
	it("a session card reads the card-less member's own fields", async () => {
		const { attachmentCardFor } = await import(
			"$lib/server/conversations/gate"
		)
		const w = await world()
		const card = await attachmentCardFor(
			"session",
			w.sessionId,
			w.user.id,
			db()
		)
		expect(card).toMatchObject({ available: true })
		expect((card as { title: string }).title).toBe("Verity, Nobody")
		expect(
			(card as { faces: { name: string }[] }).faces.map((f) => f.name)
		).toEqual(["Verity", "Nobody"])
	})
})
