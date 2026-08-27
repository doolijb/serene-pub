/**
 * The account-visibility view (design §4): from a participant's own seat, what
 * of *their* data this session exposes to everyone else, and who those others
 * are. It is the inverse of canViewCharacter/canViewPersona — proven here to
 * show each caller only their own contributions, never another participant's,
 * and to be gated by the same session access as every other read.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(() => {})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}
const noopEmit = () => {}

let n = 0

/**
 * A shared session where owner and guest have each brought one character and
 * one persona, and the guest owns the session's lorebook.
 */
async function scenario() {
	const k = n++
	const owner = await makeUser(`av-owner-${k}`)
	const guest = await makeUser(`av-guest-${k}`)

	const [ownerChar] = await testDb
		.insert(schema.characters)
		.values({ name: "Owner Char", description: "x", userId: owner.id })
		.returning()
	const [guestChar] = await testDb
		.insert(schema.characters)
		.values({ name: "Guest Char", description: "x", userId: guest.id })
		.returning()
	const [ownerPersona] = await testDb
		.insert(schema.personas)
		.values({
			name: "Owner Persona",
			description: "x",
			userId: owner.id,
			isDefault: false
		})
		.returning()
	const [guestPersona] = await testDb
		.insert(schema.personas)
		.values({
			name: "Guest Persona",
			description: "x",
			userId: guest.id,
			isDefault: false
		})
		.returning()
	const [guestLore] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Guest Lore", userId: guest.id })
		.returning()

	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, lorebookId: guestLore.id })
		.returning()
	await testDb.insert(schema.sessionGuests).values({
		sessionId: session.id,
		userId: guest.id,
		isPlayer: true
	})
	for (const [characterId, pos] of [
		[ownerChar.id, 0],
		[guestChar.id, 1]
	])
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session.id, characterId, position: pos })
	for (const [personaId, pos] of [
		[ownerPersona.id, 0],
		[guestPersona.id, 1]
	])
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId, position: pos })

	return {
		owner,
		guest,
		session,
		ownerChar,
		guestChar,
		ownerPersona,
		guestPersona,
		guestLore
	}
}

const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort()

describe("sessions:accountVisibility", () => {
	test("a guest sees only their own contributions and who else can see them", async () => {
		const { sessionsAccountVisibilityHandler } = await import("./sessions")
		const s = await scenario()

		const res = await sessionsAccountVisibilityHandler.handler(
			fakeSocket(s.guest.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.isGuest).toBe(true)
		expect(res.isOwner).toBe(false)

		// only the guest's own data — never the owner's
		expect(names(res.exposed.characters)).toEqual(["Guest Char"])
		expect(names(res.exposed.personas)).toEqual(["Guest Persona"])
		expect(names(res.exposed.lorebooks)).toEqual(["Guest Lore"])

		// the owner can see it; the guest is not listed as their own viewer
		expect(res.viewers).toHaveLength(1)
		expect(res.viewers[0]).toMatchObject({
			userId: s.owner.id,
			role: "owner"
		})
	})

	test("the owner sees their own data and the guest as a viewer", async () => {
		const { sessionsAccountVisibilityHandler } = await import("./sessions")
		const s = await scenario()

		const res = await sessionsAccountVisibilityHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)

		expect(res.isOwner).toBe(true)
		expect(res.isGuest).toBe(false)
		expect(names(res.exposed.characters)).toEqual(["Owner Char"])
		expect(names(res.exposed.personas)).toEqual(["Owner Persona"])
		// the owner does not own the lorebook, so it is not their exposure
		expect(res.exposed.lorebooks).toEqual([])
		expect(res.viewers).toHaveLength(1)
		expect(res.viewers[0]).toMatchObject({
			userId: s.guest.id,
			role: "guest"
		})
	})

	test("a user with no access to the session is refused", async () => {
		const { sessionsAccountVisibilityHandler } = await import("./sessions")
		const s = await scenario()
		const stranger = await makeUser(`av-stranger-${n}`)

		const res = await sessionsAccountVisibilityHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)

		expect(res.error).toBeTruthy()
		expect(res.exposed.characters).toEqual([])
		expect(res.viewers).toEqual([])
	})
})
