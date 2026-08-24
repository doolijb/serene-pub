/**
 * Round-6 audit fix: narrativeGraphLinkOrphanBindingHandler verified the
 * *binding*'s lorebook was owned by the caller, then set
 * characterId/personaId from the client with no check at all — unlike
 * lorebooks.ts's createLorebookBindingHandler/updateLorebookBindingHandler,
 * which both require verifyBindingTargetAccess (ownership or
 * canViewCharacter/canViewPersona) before accepting either field. An
 * attacker could link an orphaned/self-created binding to a guessed
 * characterId/personaId belonging to a user who never shared it with them
 * at all, and syncLorebookBindingsForCharacter/Persona would immediately
 * copy that victim's private name/aliases onto the attacker's own binding.
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
		path.join(os.tmpdir(), "serene-pub-link-orphan-binding-int-test-")
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

describe("narrativeGraph:linkOrphanBinding — character access scoping (PGlite integration)", () => {
	test("rejects linking a character never shared with the caller", async () => {
		const { narrativeGraphLinkOrphanBindingHandler } = await import(
			"./narrativeGraph"
		)
		const attacker = await makeUser("link-orphan-attacker")
		const victim = await makeUser("link-orphan-victim")

		const [attackerLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Attacker's Book", userId: attacker.id })
			.returning()
		const [orphanBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: attackerLorebook.id,
				binding: "{{char:1}}",
				name: "Orphan"
			})
			.returning()
		const [victimCharacter] = await testDb
			.insert(schema.characters)
			.values({
				userId: victim.id,
				name: "Victim's Character",
				description: "Private"
			})
			.returning()

		await expect(
			narrativeGraphLinkOrphanBindingHandler.handler(
				fakeSocket(attacker.id),
				{
					bindingId: orphanBinding.id,
					characterId: victimCharacter.id,
					personaId: null,
					skip: false
				} as any,
				noopEmit
			)
		).rejects.toThrow()

		const reloaded = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, orphanBinding.id)
		})
		expect(reloaded!.characterId).toBeNull()
	})

	test("accepts linking a character shared into a session the caller can access", async () => {
		const { narrativeGraphLinkOrphanBindingHandler } = await import(
			"./narrativeGraph"
		)
		const owner = await makeUser("link-orphan-owner")
		const sharer = await makeUser("link-orphan-sharer")

		const [ownerLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book", userId: owner.id })
			.returning()
		const [orphanBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: ownerLorebook.id,
				binding: "{{char:1}}",
				name: "Orphan"
			})
			.returning()
		const [sharedCharacter] = await testDb
			.insert(schema.characters)
			.values({
				userId: sharer.id,
				name: "Shared Character",
				description: "Shared via a session"
			})
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: sharer.id, isGroup: false })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: sharedCharacter.id
		})
		await testDb.insert(schema.sessionGuests).values({
			sessionId: session.id,
			userId: owner.id
		})

		const res = await narrativeGraphLinkOrphanBindingHandler.handler(
			fakeSocket(owner.id),
			{
				bindingId: orphanBinding.id,
				characterId: sharedCharacter.id,
				personaId: null,
				skip: false
			} as any,
			noopEmit
		)

		expect(res.success).toBe(true)
		const reloaded = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, orphanBinding.id)
		})
		expect(reloaded!.characterId).toBe(sharedCharacter.id)
	})
})
