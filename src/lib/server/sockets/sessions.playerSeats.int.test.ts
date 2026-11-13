/**
 * 🚧 A player seat reads its cast member like every seat (owner ruling
 * 2026-11-05, ★pT-1): "Everything in session is cast -> active card." The
 * session payload's `castNames`, the typing line's name and a removed seat's
 * `removedName` all come from the seat's member as read, a seat name still
 * winning (`withSeatName`). Driven through the real handlers on PGlite.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

const broadcasts = vi.hoisted(() => [] as { event: string; data: any }[])

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/sockets/utils/broadcastHelpers")>()
	return {
		...actual,
		// The typing line's payload, built exactly as the handler builds it.
		broadcastToSessionUsers: async (_io: any, _sessionId: number, event: string, data: any) => {
			broadcasts.push({
				event,
				data: typeof data === "function" ? await data() : data
			})
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-playerseats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function world(opts: { alsoCharacterSeat?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `playerseats-${++n}`)
	const [pia] = await testDb
		.insert(schema.characters)
		.values({ userId: u.id, name: "Pia", description: "The card." })
		.returning()
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: `Book ${n}` } as any)
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: u.id, isGroup: false, name: `Run ${n}`, lorebookId: b.id } as any)
		.returning()
	const pm = (await insertCastMember(testDb, {
			lorebookId: b.id,
			characterId: pia.id,
			binding: `{{char:${n}}}`,
			name: "Pia",
			ownName: "Pia of the Book"
		} as any)).member
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: s.id, personaId: pia.id, userId: u.id, castMemberId: pm.id } as any)
		.returning()
	if (opts.alsoCharacterSeat) {
		// The same card held by a character seat, whose member (in the session's
		// own book) is named otherwise.
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const own = await insertOwnBook(testDb as unknown as Db, {
			sessionId: s.id,
			userId: u.id,
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		const cm = (await insertCastMember(testDb, {
				lorebookId: own.id,
				characterId: pia.id,
				binding: `{{char:${++n}}}`,
				name: "Pia",
				ownName: "Pia the Character"
			} as any)).member
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: pia.id, castMemberId: cm.id } as any)
	}
	return { u, pia, s, seat, pm }
}

describe("sessions:get — castNames covers player seats", () => {
	test("a player seat's card is keyed to its member's own name", async () => {
		const { sessionsGetHandler } = await import("./sessions")
		const { u, pia, s } = await world()
		const res: any = await sessionsGetHandler.handler(
			fakeSocket(u.id),
			{ id: s.id } as any,
			noopEmit
		)
		expect(res.session.castNames).toEqual({
			[pia.id]: { ownName: "Pia of the Book", ownNickname: "" }
		})
	})

	test("a card held by a character seat and a player seat is the character seat's entry", async () => {
		const { sessionsGetHandler } = await import("./sessions")
		const { u, pia, s } = await world({ alsoCharacterSeat: true })
		const res: any = await sessionsGetHandler.handler(
			fakeSocket(u.id),
			{ id: s.id } as any,
			noopEmit
		)
		expect(res.session.castNames).toEqual({
			[pia.id]: { ownName: "Pia the Character", ownNickname: "" }
		})
	})
})

describe("sessions:typing — the typing line's name", () => {
	test("is the player seat's member's name; a seat name wins over it", async () => {
		const { sessionsTypingHandler } = await import("./sessions")
		const { u, pia, s, seat } = await world()
		broadcasts.length = 0
		await sessionsTypingHandler.handler(
			fakeSocket(u.id),
			{ sessionId: s.id, personaId: pia.id } as any,
			noopEmit
		)
		expect(broadcasts.at(-1)).toEqual({
			event: "sessions:userTyping",
			data: { sessionId: s.id, personaId: pia.id, personaName: "Pia of the Book" }
		})
		await testDb
			.update(schema.sessionPersonas)
			.set({ seatName: "Mistress Pia" })
			.where(eq(schema.sessionPersonas.id, seat.id))
		await sessionsTypingHandler.handler(
			fakeSocket(u.id),
			{ sessionId: s.id, personaId: pia.id } as any,
			noopEmit
		)
		expect(broadcasts.at(-1)?.data.personaName).toBe("Mistress Pia")
	})
})

describe("sessions:update — a removed player seat keeps its member's name", () => {
	test("removedName is the member as read; a seat name wins", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const a = await world()
		// Benched first, then removed (the name is snapshotted on removal).
		for (let pass = 0; pass < 2; pass++)
			await sessionsUpdateHandler.handler(
				fakeSocket(a.u.id),
				{ session: { id: a.s.id }, personaIds: [] } as any,
				noopEmit
			)
		const [removed] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, a.seat.id))
		expect(removed.removedAt).not.toBeNull()
		expect(removed.removedName).toBe("Pia of the Book")

		const b = await world()
		await testDb
			.update(schema.sessionPersonas)
			.set({ seatName: "Mistress Pia" })
			.where(eq(schema.sessionPersonas.id, b.seat.id))
		for (let pass = 0; pass < 2; pass++)
			await sessionsUpdateHandler.handler(
				fakeSocket(b.u.id),
				{ session: { id: b.s.id }, personaIds: [] } as any,
				noopEmit
			)
		const [named] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, b.seat.id))
		expect(named.removedName).toBe("Mistress Pia")
	})
})
