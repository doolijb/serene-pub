/**
 * Round-13 audit fix (MEDIUM): sessionsSetCastSeatEnabledHandler and
 * updateSessionCharacterVisibilityHandler (retired 2026-09-27; see the last
 * describe) each re-implemented session access
 * ad-hoc as an owner-only check (eq(sessions.userId, userId)) instead of using
 * the shared checkSessionAccess() helper — the same ad-hoc-reimplementation bug
 * class round 10 fixed in summarize.ts. Net effect: a guest who brought
 * their own character into a shared session (already allowed elsewhere) could
 * not toggle that character's active status or change its visibility, even
 * though no one but that guest has any stake in it. Fixed by mirroring the
 * established "owner OR entity-owner" escalation pattern already used by
 * sessionsReassignRemovedParticipantHandler: checkSessionAccess() for base access
 * (owner or guest), then sessionAccess.isOwner || character.userId === userId
 * for the per-row escalation.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		path.join(os.tmpdir(), "serene-pub-sessionchar-ownership-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

let scenarioCounter = 0

async function makeSharedSessionWithGuestCharacter() {
	const n = scenarioCounter++
	const owner = await makeUser(`sessionchar-owner-${n}`)
	const guest = await makeUser(`sessionchar-guest-${n}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true })
		.returning()
	await testDb.insert(schema.sessionGuests).values({
		sessionId: session.id,
		userId: guest.id,
		isPlayer: true
	})
	const [guestCharacter] = await testDb
		.insert(schema.characters)
		.values({
			name: "Guest's Character",
			description: "x",
			userId: guest.id
		})
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId: guestCharacter.id,
		position: 0
	})
	return { owner, guest, session, guestCharacter }
}

describe("sessions:setCastSeatEnabled — ownership scoping (Round-13 audit fix, PGlite integration)", () => {
	test("a guest can switch the seat of a character they own", async () => {
		const { sessionsSetCastSeatEnabledHandler } = await import(
			"./sessions"
		)
		const { guest, session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()

		const res = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, characterId: guestCharacter.id, enabled: false },
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.enabled).toBe(false)

		const row = await testDb.query.sessionCharacters.findFirst({
			where: (cc, { eq, and }) =>
				and(
					eq(cc.sessionId, session.id),
					eq(cc.characterId, guestCharacter.id)
				)
		})
		expect(row?.isActive).toBe(false)
	})

	test("a guest cannot switch the seat of a character they don't own", async () => {
		const { sessionsSetCastSeatEnabledHandler } = await import(
			"./sessions"
		)
		const { owner, guest, session } =
			await makeSharedSessionWithGuestCharacter()
		const [ownerCharacter] = await testDb
			.insert(schema.characters)
			.values({
				name: "Owner's Character",
				description: "x",
				userId: owner.id
			})
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: ownerCharacter.id,
			position: 1
		})

		const res = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, characterId: ownerCharacter.id, enabled: false },
			noopEmit
		)

		expect(res.error).toMatch(/access denied/i)

		const row = await testDb.query.sessionCharacters.findFirst({
			where: (cc, { eq, and }) =>
				and(
					eq(cc.sessionId, session.id),
					eq(cc.characterId, ownerCharacter.id)
				)
		})
		expect(row?.isActive).toBe(true)
	})

	test("the session owner retains full control over a guest's character", async () => {
		const { sessionsSetCastSeatEnabledHandler } = await import(
			"./sessions"
		)
		const { owner, session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()

		const res = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, characterId: guestCharacter.id, enabled: false },
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.enabled).toBe(false)
	})

	test("a non-participant has no access at all", async () => {
		const { sessionsSetCastSeatEnabledHandler } = await import(
			"./sessions"
		)
		const { session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()
		const outsider = await makeUser("sessionchar-outsider")

		const res = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(outsider.id),
			{ sessionId: session.id, characterId: guestCharacter.id, enabled: false },
			noopEmit
		)

		expect(res.error).toMatch(/session not found/i)
	})
})

/**
 * The per-character visibility switch is retired (2026-09-27): the session's
 * `characterDetail` genre field replaced it. There is no handler to scope any
 * more, and a client still emitting the old event is answered by nothing —
 * no handler is registered under its name, so the write is ignored.
 */
describe("sessions:updateSessionCharacterVisibility — retired", () => {
	test("no handler is exported or registered for the old event", async () => {
		const mod: Record<string, unknown> = await import("./sessions")
		expect(mod.updateSessionCharacterVisibilityHandler).toBeUndefined()

		const events: string[] = []
		expect(typeof mod.registerSessionHandlers).toBe("function")
		;(mod.registerSessionHandlers as any)(
			{ user: { id: 1 }, on: () => {} },
			noopEmit,
			(_socket: unknown, handler: { event: string }) => {
				events.push(handler.event)
			}
		)
		// The seat's enabled switch next to it is still there — this is the one that went.
		expect(events).toContain("sessions:setCastSeatEnabled")
		expect(events).not.toContain("sessions:toggleSessionCharacterActive")
		expect(events).not.toContain("sessions:updateSessionCharacterVisibility")
	})
})
