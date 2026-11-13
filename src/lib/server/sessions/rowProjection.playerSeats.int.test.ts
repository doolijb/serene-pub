/**
 * 🚧 The sessions list's `castNames` / `castFaces` cover player seats (owner
 * ruling 2026-11-05, ★pT-1: "Everything in session is cast -> active card"):
 * a player seat's card is keyed to its member as read, and a card held by a
 * character seat and a player seat keeps the character seat's entry.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	createTestDb,
	createTestUser,
	releaseDataDir
} from "$lib/server/utils/testDb"
import {
	seatCastShownForSessions,
	seatCastShownFrom,
	sessionsWithMemberWords
} from "./rowProjection"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-rowprojplayerseats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
async function world(ownName: string | null) {
	const u = await createTestUser(db, `rowprojseats-${++n}`)
	const [pia] = await db
		.insert(schema.characters)
		.values({ userId: u.id, name: "Pia", description: "The card." } as any)
		.returning()
	const [b] = await db
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: `Book ${n}` } as any)
		.returning()
	// Through the versions module: the member's base is written with it.
	const { member: pm } = await insertCastMember(db as unknown as Db, {
		lorebookId: b.id,
		characterId: pia.id,
		binding: `{{char:${n}}}`,
		name: "Pia",
		ownName
	} as any)
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId: u.id, isGroup: false, name: `Run ${n}`, lorebookId: b.id } as any)
		.returning()
	// A player seat only (the sessions list's persona row is the trimmed card).
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: s.id, personaId: pia.id, userId: u.id, castMemberId: pm.id } as any)
	const personas = await db.query.sessionPersonas.findMany({
		where: (cp, { eq }) => eq(cp.sessionId, s.id),
		with: { persona: { columns: { id: true, name: true, avatarMediaId: true } } }
	})
	return {
		pia,
		s,
		rows: personas.map((cp) => ({ ...cp, character: cp.persona }))
	}
}

describe("a player seat in the sessions list", () => {
	test("its card is keyed to the member's own name; a member with none adds nothing", async () => {
		const named = await world("Pia of the Book")
		const plain = await world(null)
		const out = await seatCastShownForSessions(db as any, [
			{ id: named.s.id, rows: named.rows },
			{ id: plain.s.id, rows: plain.rows }
		])
		expect(out.get(named.s.id)).toEqual({
			castNames: { [named.pia.id]: { ownName: "Pia of the Book", ownNickname: "" } },
			castFaces: {}
		})
		expect(out.get(plain.s.id) ?? { castNames: {}, castFaces: {} }).toEqual({
			castNames: {},
			castFaces: {}
		})
	})

	test("a session whose only member words sit on a player seat is a candidate", async () => {
		const named = await world("Pia of the Book")
		const plain = await world(null)
		expect(
			await sessionsWithMemberWords(db as any, [named.s.id, plain.s.id])
		).toEqual(new Set([named.s.id]))
	})
})

describe("seatCastShownFrom — one entry per card", () => {
	const asRead = (name: string) =>
		({
			cardless: false,
			activeCardId: 7,
			name,
			nickname: null,
			followsCard: [
				"description",
				"personality",
				"scenario",
				"firstMessage",
				"alternateGreetings",
				"exampleDialogues"
			],
			faceMediaId: null
		}) as any
	const card = { id: 7, name: "Pia", nickname: null, avatarMediaId: null }

	test("the first seat to hold a card keeps it: a character seat before a player seat", () => {
		const out = seatCastShownFrom(
			[{ character: card }, { character: card }],
			[asRead("As character"), asRead("As player")]
		)
		expect(out.castNames[7]).toEqual({ ownName: "As character", ownNickname: "" })
	})

	test("a character seat that reads its card still holds it against a player seat's member", () => {
		const out = seatCastShownFrom(
			[{ character: card }, { character: card }],
			[asRead("Pia"), asRead("As player")]
		)
		expect(out.castNames).toEqual({})
	})

	test("a live seat holds a card before a departed one", () => {
		const out = seatCastShownFrom(
			[
				{ character: card, removedAt: new Date() },
				{ character: card }
			],
			[asRead("Departed"), asRead("Live")]
		)
		expect(out.castNames[7]).toEqual({ ownName: "Live", ownNickname: "" })
	})
})
