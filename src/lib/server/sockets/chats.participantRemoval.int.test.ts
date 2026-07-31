/**
 * Round-9 audit fix (HIGH): chatsUpdateHandler's chatCharacters/chatPersonas
 * removal loops used to unconditionally hard-delete any row missing from the
 * submitted array, with no ownership check at all — any guest could submit
 * characterIds: [] and strip the chat owner's own characters. Fixed by:
 *  - gating removal per-row: the chat owner may remove anyone's participant,
 *    a guest may only remove participants they themselves own;
 *  - switching removal from a hard delete to a soft delete (removedAt/
 *    removedName columns) so a removed participant's past messages can
 *    still resolve a speaker name, instead of silently reverting to
 *    "Unknown" the instant they're removed;
 *  - adding a new chats:reassignRemovedParticipant handler so a new
 *    character/persona can "adopt" a removed participant's message history.
 *
 * This also covers the three non-choke-point consumers the audit's
 * correction round specifically called out as needing their own,
 * independent isNull(removedAt) filter (chatsGetResponseOrderHandler via
 * getPromptChatFromDb, toggleChatCharacterActiveHandler,
 * updateChatCharacterVisibilityHandler), plus chatsBranchHandler's new
 * owner-only gate (a separate, lower-severity finding from the same round)
 * and its exclusion of removed participants from a branched chat's copy.
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

async function makeChat(userId: number) {
	const [chat] = await testDb
		.insert(schema.chats)
		.values({ userId, isGroup: true })
		.returning()
	return chat
}

async function makeCharacter(userId: number, name: string) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character
}

async function addGuest(chatId: number, userId: number) {
	await testDb
		.insert(schema.chatGuests)
		.values({ chatId, userId, isPlayer: true })
}

async function addCharacterToChat(
	chatId: number,
	characterId: number,
	position = 0
) {
	await testDb
		.insert(schema.chatCharacters)
		.values({ chatId, characterId, position })
}

describe("chats:update — participant removal ownership + soft delete (PGlite integration)", () => {
	test("a guest removing another participant's character is rejected — row stays active", async () => {
		const { chatsUpdateHandler } = await import("./chats")
		const owner = await makeUser("removal-owner-1")
		const guest = await makeUser("removal-guest-1")
		const chat = await makeChat(owner.id)
		await addGuest(chat.id, guest.id)
		const ownerChar = await makeCharacter(owner.id, "Owner's Character")
		await addCharacterToChat(chat.id, ownerChar.id)

		await chatsUpdateHandler.handler(
			fakeSocket(guest.id),
			{
				chat: { id: chat.id },
				characterIds: [] // guest tries to strip everyone
			} as any,
			noopEmit
		)

		const row = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, ownerChar.id)
			)
		})
		expect(row).toBeDefined()
		expect(row!.removedAt).toBeNull()
		expect(row!.isActive).toBe(true)
	})

	test("a guest removing their own character succeeds — soft-deleted with a removedName snapshot", async () => {
		const { chatsUpdateHandler } = await import("./chats")
		const owner = await makeUser("removal-owner-2")
		const guest = await makeUser("removal-guest-2")
		const chat = await makeChat(owner.id)
		await addGuest(chat.id, guest.id)
		const guestChar = await makeCharacter(guest.id, "Guest's Character")
		await addCharacterToChat(chat.id, guestChar.id)

		await chatsUpdateHandler.handler(
			fakeSocket(guest.id),
			{
				chat: { id: chat.id },
				characterIds: []
			} as any,
			noopEmit
		)

		const row = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, guestChar.id)
			)
		})
		expect(row).toBeDefined()
		expect(row!.removedAt).not.toBeNull()
		expect(row!.removedName).toBe("Guest's Character")
		expect(row!.isActive).toBe(false)
	})

	test("the chat owner removing anyone's participant succeeds", async () => {
		const { chatsUpdateHandler } = await import("./chats")
		const owner = await makeUser("removal-owner-3")
		const guest = await makeUser("removal-guest-3")
		const chat = await makeChat(owner.id)
		await addGuest(chat.id, guest.id)
		const guestChar = await makeCharacter(guest.id, "Guest's Character 3")
		await addCharacterToChat(chat.id, guestChar.id)

		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				chat: { id: chat.id },
				characterIds: []
			} as any,
			noopEmit
		)

		const row = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, guestChar.id)
			)
		})
		expect(row!.removedAt).not.toBeNull()
	})

	test("re-adding a previously-removed participant clears removedAt instead of violating the unique index", async () => {
		const { chatsUpdateHandler } = await import("./chats")
		const owner = await makeUser("removal-owner-4")
		const chat = await makeChat(owner.id)
		const char = await makeCharacter(owner.id, "Comeback Character")
		await addCharacterToChat(chat.id, char.id)

		// Remove it first.
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ chat: { id: chat.id }, characterIds: [] } as any,
			noopEmit
		)
		const removed = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, char.id)
			)
		})
		expect(removed!.removedAt).not.toBeNull()

		// Re-add it — must not throw (would violate chat_characters_pk if
		// this were a plain insert instead of an upsert).
		await expect(
			chatsUpdateHandler.handler(
				fakeSocket(owner.id),
				{
					chat: { id: chat.id },
					characterIds: [char.id]
				} as any,
				noopEmit
			)
		).resolves.not.toThrow()

		const revived = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, char.id)
			)
		})
		expect(revived!.removedAt).toBeNull()
		expect(revived!.removedName).toBeNull()
		expect(revived!.isActive).toBe(true)
	})
})

describe("chats:reassignRemovedParticipant (PGlite integration)", () => {
	async function setupRemovedParticipant() {
		const owner = await makeUser(`reassign-owner-${Math.random()}`)
		const originalOwner = await makeUser(
			`reassign-original-owner-${Math.random()}`
		)
		const chat = await makeChat(owner.id)
		// The original owner must be a chat guest to have added their own
		// character in the first place (chatsUpdateHandler gates on
		// checkChatAccess's owner-or-guest hasAccess) — matches how this
		// state is actually reached in practice, not an artificial setup.
		await addGuest(chat.id, originalOwner.id)
		const oldChar = await makeCharacter(originalOwner.id, "Old Character")
		await addCharacterToChat(chat.id, oldChar.id)
		// Owner removes the guest-owned character (soft delete).
		const { chatsUpdateHandler } = await import("./chats")
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ chat: { id: chat.id }, characterIds: [] } as any,
			noopEmit
		)
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({
				chatId: chat.id,
				role: "assistant",
				characterId: oldChar.id,
				content: "Hello from the old character"
			})
			.returning()
		return { owner, originalOwner, chat, oldChar, message }
	}

	test("rejects a caller who is neither the chat owner nor the removed participant's original owner", async () => {
		const { chatsReassignRemovedParticipantHandler } = await import(
			"./chats"
		)
		const { chat, oldChar } = await setupRemovedParticipant()
		const stranger = await makeUser("reassign-stranger")
		const newChar = await makeCharacter(stranger.id, "New Character")

		const res = await chatsReassignRemovedParticipantHandler.handler(
			fakeSocket(stranger.id),
			{
				chatId: chat.id,
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
		const { chatsReassignRemovedParticipantHandler } = await import(
			"./chats"
		)
		const { chat, oldChar, originalOwner } = await setupRemovedParticipant()
		const someoneElse = await makeUser("reassign-someone-else")
		const notOwnedChar = await makeCharacter(
			someoneElse.id,
			"Not Owned Character"
		)

		const res = await chatsReassignRemovedParticipantHandler.handler(
			fakeSocket(originalOwner.id),
			{
				chatId: chat.id,
				type: "character",
				oldId: oldChar.id,
				newId: notOwnedChar.id
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/own/i)
	})

	test("on success: bulk-reassigns messages, makes the new target active, and removes the old slot", async () => {
		const { chatsReassignRemovedParticipantHandler } = await import(
			"./chats"
		)
		const { chat, oldChar, originalOwner, message } =
			await setupRemovedParticipant()
		const newChar = await makeCharacter(originalOwner.id, "New Character")

		const res = await chatsReassignRemovedParticipantHandler.handler(
			fakeSocket(originalOwner.id),
			{
				chatId: chat.id,
				type: "character",
				oldId: oldChar.id,
				newId: newChar.id
			} as any,
			noopEmit
		)
		expect(res.success).toBe(true)

		const reloadedMessage = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, message.id)
		})
		expect(reloadedMessage!.characterId).toBe(newChar.id)

		const oldRow = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, oldChar.id)
			)
		})
		expect(oldRow).toBeUndefined()

		const newRow = await testDb.query.chatCharacters.findFirst({
			where: and(
				eq(schema.chatCharacters.chatId, chat.id),
				eq(schema.chatCharacters.characterId, newChar.id)
			)
		})
		expect(newRow).toBeDefined()
		expect(newRow!.removedAt).toBeNull()
		expect(newRow!.isActive).toBe(true)
	})

	test("the chat owner can reassign a removed participant they don't personally own", async () => {
		const { chatsReassignRemovedParticipantHandler } = await import(
			"./chats"
		)
		const { chat, oldChar, owner } = await setupRemovedParticipant()
		const newChar = await makeCharacter(owner.id, "Owner's New Character")

		const res = await chatsReassignRemovedParticipantHandler.handler(
			fakeSocket(owner.id),
			{
				chatId: chat.id,
				type: "character",
				oldId: oldChar.id,
				newId: newChar.id
			} as any,
			noopEmit
		)
		expect(res.success).toBe(true)
	})
})

describe("chats:getResponseOrder — removed participant choke-point filter (PGlite integration)", () => {
	test("never selects a removed character as the next turn, even when it's the only character ever added", async () => {
		const { chatsUpdateHandler, chatsGetResponseOrderHandler } =
			await import("./chats")
		const owner = await makeUser("choke-point-owner")
		const chat = await makeChat(owner.id)
		const persona = await testDb
			.insert(schema.personas)
			.values({
			userId: owner.id,
			name: "P1",
			description: "",
			isDefault: false
		})
			.returning()
		await testDb.insert(schema.chatPersonas).values({
			chatId: chat.id,
			personaId: persona[0].id
		})
		const char = await makeCharacter(owner.id, "Solo Character")
		await addCharacterToChat(chat.id, char.id)

		// Remove the only character.
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ chat: { id: chat.id }, characterIds: [] } as any,
			noopEmit
		)

		const res = await chatsGetResponseOrderHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id } as any,
			noopEmit
		)
		expect(res.nextCharacterId).toBeNull()
	})

	test("selects the active character over a removed one that would otherwise be due first by position", async () => {
		const { chatsUpdateHandler, chatsGetResponseOrderHandler } =
			await import("./chats")
		const owner = await makeUser("choke-point-owner-2")
		const chat = await makeChat(owner.id)
		const persona = await testDb
			.insert(schema.personas)
			.values({
				userId: owner.id,
				name: "P2",
				description: "",
				isDefault: false
			})
			.returning()
		await testDb.insert(schema.chatPersonas).values({
			chatId: chat.id,
			personaId: persona[0].id
		})
		const removedChar = await makeCharacter(owner.id, "First Position")
		const activeChar = await makeCharacter(owner.id, "Second Position")
		await addCharacterToChat(chat.id, removedChar.id, 0)
		await addCharacterToChat(chat.id, activeChar.id, 1)

		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				chat: { id: chat.id },
				characterIds: [activeChar.id] // drops removedChar
			} as any,
			noopEmit
		)

		const res = await chatsGetResponseOrderHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id } as any,
			noopEmit
		)
		expect(res.nextCharacterId).toBe(activeChar.id)
	})
})

describe("chats:branch — owner-only gate + removed participants excluded from copy (PGlite integration)", () => {
	test("a guest can no longer branch a chat", async () => {
		const { chatsBranchHandler } = await import("./chats")
		const owner = await makeUser("branch-owner")
		const guest = await makeUser("branch-guest")
		const chat = await makeChat(owner.id)
		await addGuest(chat.id, guest.id)
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({ chatId: chat.id, role: "user", content: "Hi" })
			.returning()

		const res = await chatsBranchHandler.handler(
			fakeSocket(guest.id),
			{ chatId: chat.id, messageId: message.id, title: "Branch" } as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
		expect(res.chat).toBeUndefined()
	})

	test("a removed participant is not copied into the branched chat", async () => {
		const { chatsUpdateHandler, chatsBranchHandler } = await import(
			"./chats"
		)
		const owner = await makeUser("branch-owner-2")
		const chat = await makeChat(owner.id)
		const activeChar = await makeCharacter(owner.id, "Stays")
		const removedChar = await makeCharacter(owner.id, "Goes")
		await addCharacterToChat(chat.id, activeChar.id, 0)
		await addCharacterToChat(chat.id, removedChar.id, 1)
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				chat: { id: chat.id },
				characterIds: [activeChar.id]
			} as any,
			noopEmit
		)
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({ chatId: chat.id, role: "user", content: "Hi" })
			.returning()

		const res = await chatsBranchHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id, messageId: message.id, title: "Branch" } as any,
			noopEmit
		)
		expect(res.chat).toBeDefined()
		const branchedCCs = await testDb.query.chatCharacters.findMany({
			where: eq(schema.chatCharacters.chatId, res.chat!.id)
		})
		const branchedCharacterIds = branchedCCs.map((cc) => cc.characterId)
		expect(branchedCharacterIds).toContain(activeChar.id)
		expect(branchedCharacterIds).not.toContain(removedChar.id)
	})
})

describe("toggle/visibility handlers — removed row excluded (PGlite integration)", () => {
	test("toggleChatCharacterActive 404s on a removed character", async () => {
		const { chatsUpdateHandler, toggleChatCharacterActiveHandler } =
			await import("./chats")
		const owner = await makeUser("toggle-owner")
		const chat = await makeChat(owner.id)
		const char = await makeCharacter(owner.id, "Toggled Away")
		await addCharacterToChat(chat.id, char.id)
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ chat: { id: chat.id }, characterIds: [] } as any,
			noopEmit
		)

		const res = await toggleChatCharacterActiveHandler.handler(
			fakeSocket(owner.id),
			{ chatId: chat.id, characterId: char.id } as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
	})

	test("updateChatCharacterVisibility 404s on a removed character", async () => {
		const { chatsUpdateHandler, updateChatCharacterVisibilityHandler } =
			await import("./chats")
		const owner = await makeUser("visibility-owner")
		const chat = await makeChat(owner.id)
		const char = await makeCharacter(owner.id, "Visibility Away")
		await addCharacterToChat(chat.id, char.id)
		await chatsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ chat: { id: chat.id }, characterIds: [] } as any,
			noopEmit
		)

		const res = await updateChatCharacterVisibilityHandler.handler(
			fakeSocket(owner.id),
			{
				chatId: chat.id,
				characterId: char.id,
				visibility: "hidden"
			} as any,
			noopEmit
		)
		expect(res.error).toBeTruthy()
	})
})
