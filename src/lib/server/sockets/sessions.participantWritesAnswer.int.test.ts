/**
 * Edit Session › Participants holds every change until Save (note 34), and
 * the form closes on the ANSWERS to the writes Save sends — there is no
 * timer behind them. So every path of each write handler must answer the
 * asker on the write's own event (or its `:error` sibling), and the cast
 * seat's switch must SET the held value, never flip it: a flip from a stale
 * form would invert the seat.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-participant-writes-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function makeUser(prefix: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${prefix}-${n++}`)
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

/** Records every emit, so a test can see that the asker was answered. */
function recorder() {
	const sent: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		sent.push({ event, data })
	}
	const answers = (event: string) =>
		sent.filter((s) => s.event === event).map((s) => s.data)
	return { emit, answers }
}

async function makeSessionWithCharacter() {
	const owner = await makeUser("pw-owner")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true })
		.returning()
	const [character] = await testDb
		.insert(schema.characters)
		.values({ name: "Seat", description: "x", userId: owner.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId: character.id,
		position: 0
	})
	return { owner, session, character }
}

async function seatEnabled(sessionId: number, characterId: number) {
	const row = await testDb.query.sessionCharacters.findFirst({
		where: (cc, { eq, and }) =>
			and(eq(cc.sessionId, sessionId), eq(cc.characterId, characterId))
	})
	return row?.isActive
}

describe("sessions:setCastSeatEnabled — set, never flip", () => {
	test("a repeated set leaves the seat where it was asked to be, and answers each time", async () => {
		const { sessionsSetCastSeatEnabledHandler } = await import("./sessions")
		const { owner, session, character } = await makeSessionWithCharacter()
		const params = {
			sessionId: session.id,
			characterId: character.id,
			enabled: false
		}

		const r = recorder()
		const first = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(owner.id),
			params,
			r.emit
		)
		const second = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(owner.id),
			params,
			r.emit
		)
		expect(first).toMatchObject({ enabled: false })
		expect(first.error).toBeUndefined()
		expect(second).toMatchObject({ enabled: false })
		expect(second.error).toBeUndefined()
		// A flip would have put it back on.
		expect(await seatEnabled(session.id, character.id)).toBe(false)
		expect(r.answers("sessions:setCastSeatEnabled")).toHaveLength(2)

		// Setting the value it already has (on, from on) is no flip either.
		const on = { ...params, enabled: true }
		await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(owner.id),
			on,
			r.emit
		)
		await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(owner.id),
			on,
			r.emit
		)
		expect(await seatEnabled(session.id, character.id)).toBe(true)
		expect(r.answers("sessions:setCastSeatEnabled")).toHaveLength(4)
	}, 60_000)

	test("every refusal answers the asker on the event", async () => {
		const { sessionsSetCastSeatEnabledHandler } = await import("./sessions")
		const { owner, session, character } = await makeSessionWithCharacter()
		const outsider = await makeUser("pw-outsider")
		const guest = await makeUser("pw-guest")
		await testDb.insert(schema.sessionGuests).values({
			sessionId: session.id,
			userId: guest.id,
			isPlayer: true
		})

		const cases: [number, any, RegExp][] = [
			// No access to the session at all.
			[
				outsider.id,
				{ sessionId: session.id, characterId: character.id, enabled: false },
				/session not found/i
			],
			// No such seat in this session.
			[
				owner.id,
				{ sessionId: session.id, characterId: 999_999, enabled: false },
				/not found/i
			],
			// A guest switching a seat that is not theirs.
			[
				guest.id,
				{ sessionId: session.id, characterId: character.id, enabled: false },
				/access denied/i
			],
			// No value to set.
			[
				owner.id,
				{ sessionId: session.id, characterId: character.id },
				/on or off/i
			]
		]
		for (const [userId, params, error] of cases) {
			const r = recorder()
			const res = await sessionsSetCastSeatEnabledHandler.handler(
				fakeSocket(userId),
				params,
				r.emit
			)
			expect(res.error).toMatch(error)
			const answered = r.answers("sessions:setCastSeatEnabled")
			expect(answered).toHaveLength(1)
			expect(answered[0]).toMatchObject({
				sessionId: session.id,
				characterId: params.characterId
			})
			expect(answered[0].error).toMatch(error)
		}
		// Nothing moved.
		expect(await seatEnabled(session.id, character.id)).toBe(true)
	}, 60_000)
})

describe("sessions:setEnvoySeat — refusals answer", () => {
	test("not the owner, no access, and an undeclared slug each answer", async () => {
		const { sessionsSetEnvoySeatHandler } = await import("./sessions")
		const { owner, session } = await makeSessionWithCharacter()
		const outsider = await makeUser("pw-envoy-outsider")
		const guest = await makeUser("pw-envoy-guest")
		await testDb.insert(schema.sessionGuests).values({
			sessionId: session.id,
			userId: guest.id,
			isPlayer: true
		})

		const cases: [number, RegExp][] = [
			[outsider.id, /session not found/i],
			[guest.id, /only the session owner/i],
			// The session's genre declares no such envoy.
			[owner.id, /.+/]
		]
		for (const [userId, error] of cases) {
			const r = recorder()
			const res = await sessionsSetEnvoySeatHandler.handler(
				fakeSocket(userId),
				{ sessionId: session.id, slug: "nobody", seated: true },
				r.emit
			)
			expect(res.error).toMatch(error)
			const answered = r.answers("sessions:setEnvoySeat")
			expect(answered).toHaveLength(1)
			expect(answered[0]).toMatchObject({
				sessionId: session.id,
				slug: "nobody"
			})
		}
	}, 60_000)
})

describe("sessions:addGuest / sessions:removeGuest — refusals answer", () => {
	test("each addGuest refusal answers the asker, ids echoed", async () => {
		const { sessionsAddGuestHandler } = await import("./sessions")
		const { owner, session } = await makeSessionWithCharacter()
		const stranger = await makeUser("pw-add-stranger")
		const already = await makeUser("pw-add-already")
		const gone = await makeUser("pw-add-gone")
		await testDb.insert(schema.sessionGuests).values({
			sessionId: session.id,
			userId: already.id,
			isPlayer: true
		})
		await testDb
			.update(schema.users)
			.set({ isDeleted: true })
			.where(eq(schema.users.id, gone.id))

		const cases: [number, number, RegExp][] = [
			// Not the owner.
			[stranger.id, already.id, /only session owners/i],
			// No such user.
			[owner.id, 999_999, /unable to add/i],
			// A deleted user.
			[owner.id, gone.id, /unable to add/i],
			// Already a guest.
			[owner.id, already.id, /unable to add/i]
		]
		for (const [userId, guestUserId, error] of cases) {
			const r = recorder()
			const res = await sessionsAddGuestHandler.handler(
				fakeSocket(userId),
				{ sessionId: session.id, guestUserId },
				r.emit
			)
			expect(res.success).toBe(false)
			const answered = r.answers("sessions:addGuest")
			expect(answered).toHaveLength(1)
			expect(answered[0]).toMatchObject({
				sessionId: session.id,
				guestUserId,
				success: false
			})
			expect(answered[0].error).toMatch(error)
		}
	}, 60_000)

	test("a removeGuest refusal answers the asker, ids echoed", async () => {
		const { sessionsRemoveGuestHandler } = await import("./sessions")
		const { session } = await makeSessionWithCharacter()
		const stranger = await makeUser("pw-remove-stranger")
		const r = recorder()
		const res = await sessionsRemoveGuestHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: session.id, guestUserId: stranger.id },
			r.emit
		)
		expect(res.success).toBe(false)
		const answered = r.answers("sessions:removeGuest")
		expect(answered).toHaveLength(1)
		expect(answered[0]).toMatchObject({
			sessionId: session.id,
			guestUserId: stranger.id,
			success: false
		})
		expect(answered[0].error).toMatch(/only session owners/i)
	}, 60_000)
})
