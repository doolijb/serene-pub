/**
 * Round-13 audit fix (HIGH): characters:delete did a real DELETE FROM
 * characters, cascading sessionMessages.characterId -> SET NULL with no name
 * snapshot — every historical message that character ever authored
 * permanently fell back to the generic "assistant" label
 * (resolveCharacterName()). personas.isDeleted already implements a real
 * soft delete (personasDelete/personasList/personasGet); characters.isDeleted
 * existed in the schema but was dead code. Fixed by mirroring the persona
 * pattern exactly: soft delete, hide from list/get, leave existing
 * bindings/messages/roster entries untouched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-character-softdelete-int-test-")
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
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

describe("characters:delete — soft delete (PGlite integration)", () => {
	test("the character row survives with isDeleted: true, not a real DELETE", async () => {
		const { charactersDelete } = await import("./characters")
		const user = await makeUser("char-softdelete-survives-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ name: "Doomed", description: "x", userId: user.id })
			.returning()

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		const row = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(row).not.toBeNull()
		expect(row?.isDeleted).toBe(true)
	})

	test("charactersList/charactersGet no longer return a soft-deleted character", async () => {
		const { charactersDelete, charactersList, charactersGet } =
			await import("./characters")
		const user = await makeUser("char-softdelete-hidden-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ name: "Hidden", description: "x", userId: user.id })
			.returning()

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		const listRes = await charactersList.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)
		expect(
			listRes.characterList.find((c) => c.id === character.id)
		).toBeUndefined()

		const getRes = await charactersGet.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)
		expect(getRes.character).toBeNull()
	})

	test("a soft-deleted character's historical session messages still resolve its real name, not the generic fallback", async () => {
		const { charactersDelete } = await import("./characters")
		const { resolveCharacterName } = await import(
			"$lib/shared/utils/resolveCharacterName"
		)
		const user = await makeUser("char-softdelete-authorship-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				name: "Original Author",
				description: "x",
				userId: user.id
			})
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ isGroup: false, userId: user.id })
			.returning()
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				userId: user.id,
				characterId: character.id,
				role: "assistant",
				content: "Hello."
			})
			.returning()

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		// The message's characterId FK still resolves — a real DELETE would
		// have cascaded this to NULL.
		const reloadedMessage = await testDb.query.sessionMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, message.id),
			with: { character: true }
		})
		expect(reloadedMessage?.characterId).toBe(character.id)
		expect(resolveCharacterName(reloadedMessage?.character)).toBe(
			"Original Author"
		)
	})

	test("an existing sessionCharacters roster entry for a soft-deleted character keeps working", async () => {
		const { charactersDelete } = await import("./characters")
		const user = await makeUser("char-softdelete-roster-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				name: "Still In Session",
				description: "x",
				userId: user.id
			})
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ isGroup: true, userId: user.id })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: character.id,
			position: 0
		})

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: character.id },
			noopEmit
		)

		const roster = await testDb.query.sessionCharacters.findFirst({
			where: (cc, { eq }) => eq(cc.sessionId, session.id),
			with: { character: true }
		})
		expect(roster).not.toBeNull()
		expect(roster?.characterId).toBe(character.id)
		expect(roster?.character?.name).toBe("Still In Session")
	})

	test("deleting a character you don't own is a no-op (ownership scoping preserved)", async () => {
		const { charactersDelete, charactersGet } = await import("./characters")
		const owner = await makeUser("char-softdelete-owner-user")
		const attacker = await makeUser("char-softdelete-attacker-user")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ name: "Not Yours", description: "x", userId: owner.id })
			.returning()

		await charactersDelete.handler(
			fakeSocket(attacker.id),
			{ id: character.id },
			noopEmit
		)

		const row = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, character.id)
		})
		expect(row?.isDeleted).toBe(false)
	})
})

describe("characters:delete — followers are resolved first (★27-6)", () => {
	test("members following the card keep its words; the seat plays on; another's card resolves nothing", async () => {
		const { charactersDelete } = await import("./characters")
		const { insertCard, insertCastMember, insertCharacterVersions } =
			await import("$lib/server/characters/versions")
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const { seatedCastOf } = await import("$lib/server/cast/seatedCast")
		const user = await makeUser("char-delete-followers-user")
		const stranger = await makeUser("char-delete-followers-stranger")
		const { card, version: cardVersion } = await insertCard(testDb as any, {
			userId: user.id,
			name: "Ondine",
			description: "Ondine mends nets."
		})
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Ondine's book" })
			.returning()
		const { member, base } = await insertCastMember(testDb as any, {
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:ondine}}",
			name: ""
		})
		const [dated] = await insertCharacterVersions(testDb as any, [
			{
				castMemberId: member.id,
				lorebookId: book.id,
				parentVersionId: cardVersion.id,
				follows: ["name", "description"],
				nodeState: "active",
				nodeVisibility: "normal",
				year: 5,
				writtenBy: "user:0"
			}
		])
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, lorebookId: book.id })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: card.id,
			castMemberId: member.id,
			position: 0
		})
		const before = (await membersAsRead(testDb as any, [member.id])).get(
			member.id
		)!
		expect(before.name).toBe("Ondine")
		expect(before.description).toBe("Ondine mends nets.")
		const versionsOf = async () =>
			testDb
				.select()
				.from(schema.characterVersions)
				.where(
					inArray(schema.characterVersions.id, [base!.id, dated.id])
				)

		// Someone else's card: a no-op, nothing resolved.
		await charactersDelete.handler(
			fakeSocket(stranger.id),
			{ id: card.id },
			noopEmit
		)
		expect((await versionsOf()).every((v) => v.follows.length > 0)).toBe(
			true
		)
		const [kept] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, card.id))
		expect(kept.isDeleted).toBe(false)

		await charactersDelete.handler(
			fakeSocket(user.id),
			{ id: card.id },
			noopEmit
		)
		for (const v of await versionsOf()) {
			expect(v.follows).toEqual([])
			expect(v.name).toBe("Ondine")
			expect(v.description).toBe("Ondine mends nets.")
			// ★3 (2026-11-08): a card delete makes followers card-less, so the versions are detached.
			expect(v.parentVersionId).toBeNull()
		}
		const after = (await membersAsRead(testDb as any, [member.id])).get(
			member.id
		)!
		expect(after.name).toBe(before.name)
		expect(after.description).toBe(before.description)
		const seats = await seatedCastOf(testDb as any, session.id)
		expect(seats).toHaveLength(1)
		expect(seats[0].castMemberId).toBe(member.id)
		expect(seats[0].asRead?.name).toBe("Ondine")
		expect(seats[0].asRead?.description).toBe("Ondine mends nets.")
	}, 60_000)
})
