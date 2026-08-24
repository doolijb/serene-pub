/**
 * Round-13 audit fix (MEDIUM): toggleSessionCharacterActiveHandler and
 * updateSessionCharacterVisibilityHandler each re-implemented session access
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

describe("sessions:toggleSessionCharacterActive — ownership scoping (Round-13 audit fix, PGlite integration)", () => {
	test("a guest can toggle the active status of a character they own", async () => {
		const { toggleSessionCharacterActiveHandler } = await import(
			"./sessions"
		)
		const { guest, session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()

		const res = await toggleSessionCharacterActiveHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, characterId: guestCharacter.id } as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.isActive).toBe(false)

		const row = await testDb.query.sessionCharacters.findFirst({
			where: (cc, { eq, and }) =>
				and(
					eq(cc.sessionId, session.id),
					eq(cc.characterId, guestCharacter.id)
				)
		})
		expect(row?.isActive).toBe(false)
	})

	test("a guest cannot toggle the active status of a character they don't own", async () => {
		const { toggleSessionCharacterActiveHandler } = await import(
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

		const res = await toggleSessionCharacterActiveHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id, characterId: ownerCharacter.id } as any,
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
		const { toggleSessionCharacterActiveHandler } = await import(
			"./sessions"
		)
		const { owner, session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()

		const res = await toggleSessionCharacterActiveHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, characterId: guestCharacter.id } as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.isActive).toBe(false)
	})

	test("a non-participant has no access at all", async () => {
		const { toggleSessionCharacterActiveHandler } = await import(
			"./sessions"
		)
		const { session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()
		const outsider = await makeUser("sessionchar-outsider")

		const res = await toggleSessionCharacterActiveHandler.handler(
			fakeSocket(outsider.id),
			{ sessionId: session.id, characterId: guestCharacter.id } as any,
			noopEmit
		)

		expect(res.error).toMatch(/session not found/i)
	})
})

describe("sessions:updateSessionCharacterVisibility — ownership scoping (Round-13 audit fix, PGlite integration)", () => {
	test("a guest can change the visibility of a character they own", async () => {
		const { updateSessionCharacterVisibilityHandler } = await import(
			"./sessions"
		)
		const { guest, session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()

		const res = await updateSessionCharacterVisibilityHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				characterId: guestCharacter.id,
				visibility: "hidden"
			} as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()

		const row = await testDb.query.sessionCharacters.findFirst({
			where: (cc, { eq, and }) =>
				and(
					eq(cc.sessionId, session.id),
					eq(cc.characterId, guestCharacter.id)
				)
		})
		expect(row?.visibility).toBe("hidden")
	})

	test("a guest cannot change the visibility of a character they don't own", async () => {
		const { updateSessionCharacterVisibilityHandler } = await import(
			"./sessions"
		)
		const { owner, guest, session } =
			await makeSharedSessionWithGuestCharacter()
		const [ownerCharacter] = await testDb
			.insert(schema.characters)
			.values({
				name: "Owner's Character 2",
				description: "x",
				userId: owner.id
			})
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: ownerCharacter.id,
			position: 1
		})

		const res = await updateSessionCharacterVisibilityHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				characterId: ownerCharacter.id,
				visibility: "hidden"
			} as any,
			noopEmit
		)

		expect(res.error).toMatch(/access denied/i)
	})

	test("the session owner retains full control over a guest's character", async () => {
		const { updateSessionCharacterVisibilityHandler } = await import(
			"./sessions"
		)
		const { owner, session, guestCharacter } =
			await makeSharedSessionWithGuestCharacter()

		const res = await updateSessionCharacterVisibilityHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				characterId: guestCharacter.id,
				visibility: "hidden"
			} as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
	})
})
