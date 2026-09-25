/**
 * Firing a prepared turn (PLAN-turn-order §4.7, unit A7) — `fireTurnEntry`
 * and the `sessions:fireTurn` handler's who-may-fire gate, against a real
 * session with the order stored through the one writer (`writeTurnOrder`).
 *
 * What is pinned:
 *
 *  1. **A character head fires respond with the entry's ref and channel**;
 *     the ref's `characterId` becomes the run's, and `channel` rides along.
 *  2. **An envoy ref fires respond by `speaker`**, and a narrator entry
 *     (`ref: null`) fires respond with no speaker at all.
 *  3. **A person's entry is not fired** — shown as their turn, never
 *     generated (R15): `{ fired: false, reason: 'person' }`, nothing reaches
 *     `runReply`.
 *  4. **A subject core does not know is refused by name** ("action not
 *     enabled"), never guessed at — so a typo cannot silently become a reply
 *     and **regenerate and swipe fire nothing** through this road: firing is
 *     over respond turns and offered actions only.
 *  5. **Who may fire** (§4.7): a guest may fire the head or an entry whose
 *     character they own; picking somebody else's character out of turn is
 *     the owner's, and a stranger has no session at all.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import {
	EMPTY_TURN_ORDER,
	readTurnOrder,
	type TurnEntryV1,
	type TurnOrderV1
} from "@serene-pub/sdk"
import { writeTurnOrder } from "./turnOrder"

let db: TestDb
let userId: number

/** Captured calls to the mocked `runReply`, in order. */
const replies: Array<{ turn: unknown; channel?: unknown; auto?: boolean }> = []
vi.mock("$lib/server/db", async (importOriginal) => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: async (opts: any) => {
		replies.push({
			turn: opts.turn,
			channel: opts.channel,
			auto: opts.auto
		})
		return { ok: true, receipt: { runId: "run-fired" } }
	}
}))

const orderWith = (entry: TurnEntryV1, basedOnAt = 1000): TurnOrderV1 => ({
	...EMPTY_TURN_ORDER,
	order: [entry],
	basedOnAt,
	computedAt: basedOnAt + 1,
	runId: `run-${basedOnAt}`,
	event: "core:event/message-completed@1",
	strategy: "core:task/turn-round-robin@1"
})

async function makeSession(
	opts: {
		guestId?: number
		personaId?: number
		ownCharacterId?: number
	} = {}
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	if (opts.guestId != null)
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: opts.guestId })
	if (opts.personaId != null)
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: opts.personaId })
	if (opts.ownCharacterId != null)
		await db.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: opts.ownCharacterId,
			position: 0
		})
	return session
}

const character = (userId: number, name: string) => ({
	userId,
	name,
	description: `test character ${name}`,
	metadata: {}
})

beforeAll(async () => {
	// Rouse the `$lib/server/db` mock so `db` carries the test instance.
	await import("$lib/server/db")
	userId = (await createTestUser(db, "fire-turn-owner")).id
}, 60_000)

describe("fireTurnEntry", () => {
	beforeEach(() => (replies.length = 0))

	it("a character head fires respond with the entry's ref and channel", async () => {
		const s = await makeSession()
		const entry: TurnEntryV1 = {
			ref: "character:7",
			channel: "main",
			via: "strategy",
			subject: "core:event/message-respond@1"
		}
		await writeTurnOrder(db, s.id, orderWith(entry))
		const { fireTurnEntry, headTurnEntry } = await import("./fireTurn")
		expect(await headTurnEntry(db, s.id)).toMatchObject({
			ref: "character:7",
			channel: "main"
		})
		const out = await fireTurnEntry(db, {
			sessionId: s.id,
			userId,
			entry,
			cause: { kind: "user", userId }
		})
		expect(out).toEqual({ fired: true, runId: "run-fired" })
		expect(replies).toEqual([
			{
				turn: { kind: "respond", characterId: 7 },
				channel: "main",
				auto: false
			}
		])
	})

	it("an envoy ref fires respond by speaker, and a narrator entry fires respond with no speaker", async () => {
		const s = await makeSession()
		const { fireTurnEntry } = await import("./fireTurn")
		const envoy: TurnEntryV1 = { ref: "envoy:mascot", via: "strategy" }
		expect(
			await fireTurnEntry(db, {
				sessionId: s.id,
				userId,
				entry: envoy,
				cause: { kind: "user", userId }
			})
		).toEqual({ fired: true, runId: "run-fired" })
		const narrator: TurnEntryV1 = { ref: null, via: "voice" }
		expect(
			await fireTurnEntry(db, {
				sessionId: s.id,
				userId,
				entry: narrator,
				cause: { kind: "user", userId }
			})
		).toEqual({ fired: true, runId: "run-fired" })
		expect(replies.map((r) => r.turn)).toEqual([
			{ kind: "respond", speaker: "envoy:mascot" },
			{ kind: "respond" }
		])
	})

	it("a person's entry is never fired — shown as their turn, nothing reaches the run", async () => {
		const [persona] = await db
			.insert(schema.characters)
			.values(character(userId, "a persona"))
			.returning()
		const s = await makeSession({ personaId: persona.id })
		const { fireTurnEntry } = await import("./fireTurn")
		const out = await fireTurnEntry(db, {
			sessionId: s.id,
			userId,
			entry: { ref: `character:${persona.id}`, via: "strategy" },
			cause: { kind: "user", userId }
		})
		expect(out).toEqual({ fired: false, reason: "person" })
		expect(replies).toEqual([])
	})

	it("an unknown subject is refused by name — regenerate and swipe fire nothing through this road", async () => {
		const s = await makeSession()
		const { fireTurnEntry } = await import("./fireTurn")
		for (const subject of [
			"core:event/message-regenerated@1",
			"core:event/not-a-thing@1"
		]) {
			replies.length = 0
			const out = await fireTurnEntry(db, {
				sessionId: s.id,
				userId,
				entry: { ref: "character:7", via: "strategy", subject },
				cause: { kind: "user", userId }
			})
			expect(out).toEqual({ fired: false, reason: "action not enabled" })
			expect(replies).toEqual([])
		}
	})

	it("an action subject the user may not use is refused by the same gate", async () => {
		const s = await makeSession()
		const { fireTurnEntry } = await import("./fireTurn")
		const out = await fireTurnEntry(db, {
			sessionId: s.id,
			userId,
			entry: {
				ref: "character:7",
				via: "strategy",
				subject: "acme:spec/gated#use"
			},
			cause: { kind: "user", userId }
		})
		expect(out).toEqual({ fired: false, reason: "action not enabled" })
		expect(replies).toEqual([])
	})
})

describe("sessions:fireTurn — who may fire (§4.7)", () => {
	let guestId: number
	let otherUserId: number
	const events: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => events.push({ event, data })
	const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any

	beforeAll(async () => {
		guestId = (await createTestUser(db, "fire-turn-guest")).id
		otherUserId = (await createTestUser(db, "fire-turn-other")).id
	})

	beforeEach(() => {
		replies.length = 0
		events.length = 0
	})

	it("a guest may fire the head, or an entry whose character they own", async () => {
		const [theirChar] = await db
			.insert(schema.characters)
			.values(character(guestId, "theirs"))
			.returning()
		const s = await makeSession({ guestId, ownCharacterId: theirChar.id })
		const guestEntry: TurnEntryV1 = {
			ref: `character:${theirChar.id}`,
			via: "strategy"
		}
		// Their own character sits at the head: firing the head is the head.
		await writeTurnOrder(db, s.id, orderWith(guestEntry, 2000))
		const { sessionsFireTurnHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const head: any = await sessionsFireTurnHandler.handler(
			fakeSocket(guestId),
			{ sessionId: s.id },
			emit
		)
		expect(head.error, head.error).toBeUndefined()
		expect(head.ok).toBe(true)

		// Somebody else's character, as the head: still the guest's to fire.
		await writeTurnOrder(
			db,
			s.id,
			orderWith({ ref: "character:404", via: "strategy" }, 3000)
		)
		replies.length = 0
		const headOther: any = await sessionsFireTurnHandler.handler(
			fakeSocket(guestId),
			{ sessionId: s.id },
			emit
		)
		expect(headOther.error, headOther.error).toBeUndefined()
		expect(replies[0].turn).toEqual({ kind: "respond", characterId: 404 })
	})

	it("a guest picking somebody else's character out of turn is the owner's — refused, and nothing fires", async () => {
		const [ownerChar] = await db
			.insert(schema.characters)
			.values(character(userId, "owner's"))
			.returning()
		const s = await makeSession({ guestId, ownCharacterId: ownerChar.id })
		// Their own entry is at the head; the pick targets *another* user's.
		const [strangerChar] = await db
			.insert(schema.characters)
			.values(character(otherUserId, "stranger's"))
			.returning()
		await writeTurnOrder(
			db,
			s.id,
			orderWith({ ref: "character:404", via: "strategy" }, 4000)
		)
		const { sessionsFireTurnHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const refused: any = await sessionsFireTurnHandler.handler(
			fakeSocket(guestId),
			{
				sessionId: s.id,
				entry: {
					ref: `character:${strangerChar.id}`,
					via: "pick"
				}
			},
			emit
		)
		expect(refused.error).toBe(
			"Only the session owner can take somebody else's turn out of order."
		)
		expect(events.at(-1)?.event).toBe("sessions:fireTurn:error")
		expect(replies).toEqual([])
	})

	it("a stranger has no session: the access check sits above firing", async () => {
		const s = await makeSession()
		const { sessionsFireTurnHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const stranger = (await createTestUser(db, "fire-turn-stranger")).id
		const out: any = await sessionsFireTurnHandler.handler(
			fakeSocket(stranger),
			{ sessionId: s.id, entry: { ref: "envoy:mascot", via: "pick" } },
			emit
		)
		expect(out.error).toBe("Session not found.")
		expect(replies).toEqual([])
	})

	it("the stored order is fluent — the one-writer invariant holds", async () => {
		const s = await makeSession()
		await writeTurnOrder(
			db,
			s.id,
			orderWith({ ref: "character:7", via: "strategy" }, 5000)
		)
		expect(
			readTurnOrder(
				(
					await db
						.select({ metadata: schema.sessions.metadata })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, s.id))
				)[0]!.metadata
			).order
		).toEqual([{ ref: "character:7", via: "strategy" }])
		// Firing does not consume the order: it is the same document a view
		// reads, and the next press fires the same head until the order moves.
		const { sessionsFireTurnHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsFireTurnHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.id },
			emit
		)
		expect(replies).toHaveLength(1)
		expect(
			readTurnOrder(
				(
					await db
						.select({ metadata: schema.sessions.metadata })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, s.id))
				)[0]!.metadata
			).order
		).toEqual([{ ref: "character:7", via: "strategy" }])
	})
})
