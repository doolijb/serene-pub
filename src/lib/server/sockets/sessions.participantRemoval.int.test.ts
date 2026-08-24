/**
 * Round-9 audit fix (HIGH): sessionsUpdateHandler's sessionCharacters/sessionPersonas
 * removal loops used to unconditionally hard-delete any row missing from the
 * submitted array, with no ownership check at all — any guest could submit
 * characterIds: [] and strip the session owner's own characters. Fixed by:
 *  - gating removal per-row: the session owner may remove anyone's participant,
 *    a guest may only remove participants they themselves own;
 *  - switching removal from a hard delete to a soft delete (removedAt/
 *    removedName columns) so a removed participant's past messages can
 *    still resolve a speaker name, instead of silently reverting to
 *    "Unknown" the instant they're removed;
 *  - adding a new sessions:reassignRemovedParticipant handler so a new
 *    character/persona can "adopt" a removed participant's message history.
 *
 * This also covers the three non-choke-point consumers the audit's
 * correction round specifically called out as needing their own,
 * independent isNull(removedAt) filter (sessionsGetResponseOrderHandler via
 * getPromptSessionFromDb, toggleSessionCharacterActiveHandler,
 * updateSessionCharacterVisibilityHandler), plus sessionsBranchHandler's new
 * owner-only gate (a separate, lower-severity finding from the same round)
 * and its exclusion of removed participants from a branched session's copy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-participant-removal-int-test-")
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

async function makeSession(userId: number) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: true })
		.returning()
	return session
}

async function makeCharacter(userId: number, name: string) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character
}

async function addGuest(sessionId: number, userId: number) {
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId, isPlayer: true })
}

async function addCharacterToSession(
	sessionId: number,
	characterId: number,
	position = 0
) {
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, position })
}

describe("sessions:update — participant removal ownership + soft delete (PGlite integration)", () => {
	test("a guest removing another participant's character is rejected — row stays active", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("removal-owner-1")
		const guest = await makeUser("removal-guest-1")
		const session = await makeSession(owner.id)
		await addGuest(session.id, guest.id)
		const ownerChar = await makeCharacter(owner.id, "Owner's Character")
		await addCharacterToSession(session.id, ownerChar.id)

		await sessionsUpdateHandler.handler(
			fakeSocket(guest.id),
			{
				session: { id: session.id },
				characterIds: [] // guest tries to strip everyone
			} as any,
			noopEmit
		)

		const row = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, ownerChar.id)
			)
		})
		expect(row).toBeDefined()
		expect(row!.removedAt).toBeNull()
		expect(row!.isActive).toBe(true)
	})

	test("a guest removing their own character succeeds — soft-deleted with a removedName snapshot", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("removal-owner-2")
		const guest = await makeUser("removal-guest-2")
		const session = await makeSession(owner.id)
		await addGuest(session.id, guest.id)
		const guestChar = await makeCharacter(guest.id, "Guest's Character")
		await addCharacterToSession(session.id, guestChar.id)

		await sessionsUpdateHandler.handler(
			fakeSocket(guest.id),
			{
				session: { id: session.id },
				characterIds: []
			} as any,
			noopEmit
		)

		const row = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, guestChar.id)
			)
		})
		expect(row).toBeDefined()
		expect(row!.removedAt).not.toBeNull()
		expect(row!.removedName).toBe("Guest's Character")
		expect(row!.isActive).toBe(false)
	})

	test("the session owner removing anyone's participant succeeds", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("removal-owner-3")
		const guest = await makeUser("removal-guest-3")
		const session = await makeSession(owner.id)
		await addGuest(session.id, guest.id)
		const guestChar = await makeCharacter(guest.id, "Guest's Character 3")
		await addCharacterToSession(session.id, guestChar.id)

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				session: { id: session.id },
				characterIds: []
			} as any,
			noopEmit
		)

		const row = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, guestChar.id)
			)
		})
		expect(row!.removedAt).not.toBeNull()
	})

	test("re-adding a previously-removed participant clears removedAt instead of violating the unique index", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("removal-owner-4")
		const session = await makeSession(owner.id)
		const char = await makeCharacter(owner.id, "Comeback Character")
		await addCharacterToSession(session.id, char.id)

		// Remove it first.
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: session.id }, characterIds: [] } as any,
			noopEmit
		)
		const removed = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, char.id)
			)
		})
		expect(removed!.removedAt).not.toBeNull()

		// Re-add it — must not throw (would violate session_characters_pk if
		// this were a plain insert instead of an upsert).
		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(owner.id),
				{
					session: { id: session.id },
					characterIds: [char.id]
				} as any,
				noopEmit
			)
		).resolves.not.toThrow()

		const revived = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, char.id)
			)
		})
		expect(revived!.removedAt).toBeNull()
		expect(revived!.removedName).toBeNull()
		expect(revived!.isActive).toBe(true)
	})
})

describe("sessions:reassignRemovedParticipant (PGlite integration)", () => {
	async function setupRemovedParticipant() {
		const owner = await makeUser(`reassign-owner-${Math.random()}`)
		const originalOwner = await makeUser(
			`reassign-original-owner-${Math.random()}`
		)
		const session = await makeSession(owner.id)
		// The original owner must be a session guest to have added their own
		// character in the first place (sessionsUpdateHandler gates on
		// checkSessionAccess's owner-or-guest hasAccess) — matches how this
		// state is actually reached in practice, not an artificial setup.
		await addGuest(session.id, originalOwner.id)
		const oldChar = await makeCharacter(originalOwner.id, "Old Character")
		await addCharacterToSession(session.id, oldChar.id)
		// Owner removes the guest-owned character (soft delete).
		const { sessionsUpdateHandler } = await import("./sessions")
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: session.id }, characterIds: [] } as any,
			noopEmit
		)
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				characterId: oldChar.id,
				content: "Hello from the old character"
			})
			.returning()
		return { owner, originalOwner, session, oldChar, message }
	}

	test("rejects a caller who is neither the session owner nor the removed participant's original owner", async () => {
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"./sessions"
		)
		const { session, oldChar } = await setupRemovedParticipant()
		const stranger = await makeUser("reassign-stranger")
		const newChar = await makeCharacter(stranger.id, "New Character")

		const res = await sessionsReassignRemovedParticipantHandler.handler(
			fakeSocket(stranger.id),
			{
				sessionId: session.id,
				type: "character",
				oldId: oldChar.id,
				newId: newChar.id
			} as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
		expect(res.success).toBeUndefined()
	})

	test("rejects when the caller doesn't own the new target character", async () => {
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"./sessions"
		)
		const { session, oldChar, originalOwner } =
			await setupRemovedParticipant()
		const someoneElse = await makeUser("reassign-someone-else")
		const notOwnedChar = await makeCharacter(
			someoneElse.id,
			"Not Owned Character"
		)

		const res = await sessionsReassignRemovedParticipantHandler.handler(
			fakeSocket(originalOwner.id),
			{
				sessionId: session.id,
				type: "character",
				oldId: oldChar.id,
				newId: notOwnedChar.id
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/own/i)
	})

	test("on success: bulk-reassigns messages, makes the new target active, and removes the old slot", async () => {
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"./sessions"
		)
		const { session, oldChar, originalOwner, message } =
			await setupRemovedParticipant()
		const newChar = await makeCharacter(originalOwner.id, "New Character")

		const res = await sessionsReassignRemovedParticipantHandler.handler(
			fakeSocket(originalOwner.id),
			{
				sessionId: session.id,
				type: "character",
				oldId: oldChar.id,
				newId: newChar.id
			} as any,
			noopEmit
		)
		expect(res.success).toBe(true)

		const reloadedMessage = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, message.id)
		})
		expect(reloadedMessage!.characterId).toBe(newChar.id)

		const oldRow = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, oldChar.id)
			)
		})
		expect(oldRow).toBeUndefined()

		const newRow = await testDb.query.sessionCharacters.findFirst({
			where: and(
				eq(schema.sessionCharacters.sessionId, session.id),
				eq(schema.sessionCharacters.characterId, newChar.id)
			)
		})
		expect(newRow).toBeDefined()
		expect(newRow!.removedAt).toBeNull()
		expect(newRow!.isActive).toBe(true)
	})

	test("the session owner can reassign a removed participant they don't personally own", async () => {
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"./sessions"
		)
		const { session, oldChar, owner } = await setupRemovedParticipant()
		const newChar = await makeCharacter(owner.id, "Owner's New Character")

		const res = await sessionsReassignRemovedParticipantHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				type: "character",
				oldId: oldChar.id,
				newId: newChar.id
			} as any,
			noopEmit
		)
		expect(res.success).toBe(true)
	})
})

describe("sessions:getResponseOrder — removed participant choke-point filter (PGlite integration)", () => {
	test("never selects a removed character as the next turn, even when it's the only character ever added", async () => {
		const { sessionsUpdateHandler, sessionsGetResponseOrderHandler } =
			await import("./sessions")
		const owner = await makeUser("choke-point-owner")
		const session = await makeSession(owner.id)
		const persona = await testDb
			.insert(schema.personas)
			.values({
				userId: owner.id,
				name: "P1",
				description: "",
				isDefault: false
			})
			.returning()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session.id,
			personaId: persona[0].id
		})
		const char = await makeCharacter(owner.id, "Solo Character")
		await addCharacterToSession(session.id, char.id)

		// Remove the only character.
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: session.id }, characterIds: [] } as any,
			noopEmit
		)

		const res = await sessionsGetResponseOrderHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id } as any,
			noopEmit
		)
		expect(res.nextCharacterId).toBeNull()
	})

	test("selects the active character over a removed one that would otherwise be due first by position", async () => {
		const { sessionsUpdateHandler, sessionsGetResponseOrderHandler } =
			await import("./sessions")
		const owner = await makeUser("choke-point-owner-2")
		const session = await makeSession(owner.id)
		const persona = await testDb
			.insert(schema.personas)
			.values({
				userId: owner.id,
				name: "P2",
				description: "",
				isDefault: false
			})
			.returning()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session.id,
			personaId: persona[0].id
		})
		const removedChar = await makeCharacter(owner.id, "First Position")
		const activeChar = await makeCharacter(owner.id, "Second Position")
		await addCharacterToSession(session.id, removedChar.id, 0)
		await addCharacterToSession(session.id, activeChar.id, 1)

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				session: { id: session.id },
				characterIds: [activeChar.id] // drops removedChar
			} as any,
			noopEmit
		)

		const res = await sessionsGetResponseOrderHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id } as any,
			noopEmit
		)
		expect(res.nextCharacterId).toBe(activeChar.id)
	})
})

describe("sessions:branch — owner-only gate + removed participants excluded from copy (PGlite integration)", () => {
	test("a guest can no longer branch a session", async () => {
		const { sessionsBranchHandler } = await import("./sessions")
		const owner = await makeUser("branch-owner")
		const guest = await makeUser("branch-guest")
		const session = await makeSession(owner.id)
		await addGuest(session.id, guest.id)
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "user", content: "Hi" })
			.returning()

		const res = await sessionsBranchHandler.handler(
			fakeSocket(guest.id),
			{
				sessionId: session.id,
				messageId: message.id,
				title: "Branch"
			} as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
		expect(res.session).toBeUndefined()
	})

	test("a removed participant is not copied into the branched session", async () => {
		const { sessionsUpdateHandler, sessionsBranchHandler } = await import(
			"./sessions"
		)
		const owner = await makeUser("branch-owner-2")
		const session = await makeSession(owner.id)
		const activeChar = await makeCharacter(owner.id, "Stays")
		const removedChar = await makeCharacter(owner.id, "Goes")
		await addCharacterToSession(session.id, activeChar.id, 0)
		await addCharacterToSession(session.id, removedChar.id, 1)
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				session: { id: session.id },
				characterIds: [activeChar.id]
			} as any,
			noopEmit
		)
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "user", content: "Hi" })
			.returning()

		const res = await sessionsBranchHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				messageId: message.id,
				title: "Branch"
			} as any,
			noopEmit
		)
		expect(res.session).toBeDefined()
		const branchedCCs = await testDb.query.sessionCharacters.findMany({
			where: eq(schema.sessionCharacters.sessionId, res.session!.id)
		})
		const branchedCharacterIds = branchedCCs.map((cc) => cc.characterId)
		expect(branchedCharacterIds).toContain(activeChar.id)
		expect(branchedCharacterIds).not.toContain(removedChar.id)
	})
})

describe("toggle/visibility handlers — removed row excluded (PGlite integration)", () => {
	test("toggleSessionCharacterActive 404s on a removed character", async () => {
		const { sessionsUpdateHandler, toggleSessionCharacterActiveHandler } =
			await import("./sessions")
		const owner = await makeUser("toggle-owner")
		const session = await makeSession(owner.id)
		const char = await makeCharacter(owner.id, "Toggled Away")
		await addCharacterToSession(session.id, char.id)
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: session.id }, characterIds: [] } as any,
			noopEmit
		)

		const res = await toggleSessionCharacterActiveHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, characterId: char.id } as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
	})

	test("updateSessionCharacterVisibility 404s on a removed character", async () => {
		const {
			sessionsUpdateHandler,
			updateSessionCharacterVisibilityHandler
		} = await import("./sessions")
		const owner = await makeUser("visibility-owner")
		const session = await makeSession(owner.id)
		const char = await makeCharacter(owner.id, "Visibility Away")
		await addCharacterToSession(session.id, char.id)
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: session.id }, characterIds: [] } as any,
			noopEmit
		)

		const res = await updateSessionCharacterVisibilityHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				characterId: char.id,
				visibility: "hidden"
			} as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
	})
})
