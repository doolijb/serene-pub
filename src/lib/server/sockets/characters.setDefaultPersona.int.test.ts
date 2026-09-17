/**
 * D3: characters:setDefaultPersona — clears the caller's own prior default and
 * sets the new one, transactionally. Explicitly scoped to `userId` in both
 * UPDATE statements — a bare "WHERE is_default_persona" clear would wipe every
 * user's default on a multi-account instance, not just the caller's. This
 * test's core assertion is exactly that: setting user A's default must never
 * touch user B's.
 *
 * ⚠ The transaction is now load-bearing twice over. `personas` had no unique
 * index on its default flag; `characters_default_persona_unique` (0132) is a
 * partial unique index over `user_id`, so a set that ran before the clear is
 * not merely untidy — it is REFUSED. Setting the default also sets
 * `is_persona`, asserted below: a default you cannot play is not a state worth
 * having.
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
		path.join(os.tmpdir(), "serene-pub-setdefaultpersona-int-test-")
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

async function getPersona(id: number) {
	return testDb.query.characters.findFirst({
		where: eq(schema.characters.id, id)
	})
}

describe("characters:setDefaultPersona (PGlite integration)", () => {
	test("switches the caller's own default between two of their personas", async () => {
		const { charactersSetDefaultPersona } = await import("./characters")

		const user = await makeUser("setdefault-user")
		const [personaA] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Persona A",
				description: "",
				aliases: [],
				isPersona: true,
				isDefaultPersona: true
			})
			.returning()
		const [personaB] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Persona B",
				description: "",
				aliases: [],
				isPersona: true
			})
			.returning()

		await charactersSetDefaultPersona.handler(
			fakeSocket(user.id),
			{ characterId: personaB.id } as any,
			noopEmit
		)

		expect((await getPersona(personaA.id))?.isDefaultPersona).toBe(false)
		expect((await getPersona(personaB.id))?.isDefaultPersona).toBe(true)
		// Exactly one default survives — the partial unique index would have
		// refused the write outright had the clear not preceded the set.
		const defaults = await testDb.query.characters.findMany({
			where: and(
				eq(schema.characters.userId, user.id),
				eq(schema.characters.isDefaultPersona, true)
			)
		})
		expect(defaults.map((d) => d.id)).toEqual([personaB.id])
	})

	test("does not touch another user's default persona (multi-account scoping)", async () => {
		const { charactersSetDefaultPersona } = await import("./characters")

		const userA = await makeUser("setdefault-user-a")
		const userB = await makeUser("setdefault-user-b")

		const [aDefault] = await testDb
			.insert(schema.characters)
			.values({
				userId: userA.id,
				name: "A's persona",
				description: "",
				aliases: [],
				isPersona: true,
				isDefaultPersona: true
			})
			.returning()
		const [aSecond] = await testDb
			.insert(schema.characters)
			.values({
				userId: userA.id,
				name: "A's second persona",
				description: "",
				aliases: [],
				isPersona: true
			})
			.returning()
		const [bDefault] = await testDb
			.insert(schema.characters)
			.values({
				userId: userB.id,
				name: "B's persona",
				description: "",
				aliases: [],
				isPersona: true,
				isDefaultPersona: true
			})
			.returning()

		// User A changes their own default.
		await charactersSetDefaultPersona.handler(
			fakeSocket(userA.id),
			{ characterId: aSecond.id } as any,
			noopEmit
		)

		expect((await getPersona(aDefault.id))?.isDefaultPersona).toBe(false)
		expect((await getPersona(aSecond.id))?.isDefaultPersona).toBe(true)
		// User B's default must be completely unaffected.
		expect((await getPersona(bDefault.id))?.isDefaultPersona).toBe(true)
	})

	test("rejects setting a default on a persona the caller doesn't own", async () => {
		const { charactersSetDefaultPersona } = await import("./characters")

		const owner = await makeUser("setdefault-owner")
		const other = await makeUser("setdefault-other")
		const [persona] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Owner's persona",
				description: "",
				aliases: [],
				isPersona: true
			})
			.returning()

		await expect(
			charactersSetDefaultPersona.handler(
				fakeSocket(other.id),
				{ characterId: persona.id } as any,
				noopEmit
			)
		).rejects.toThrow(/not found|access denied/i)

		expect((await getPersona(persona.id))?.isDefaultPersona).toBe(false)
	})

	test("flags an unflagged character as a persona when it becomes the default", async () => {
		const { charactersSetDefaultPersona } = await import("./characters")

		const user = await makeUser("setdefault-promotes")
		const [plain] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Not yet a persona",
				description: "",
				aliases: []
			})
			.returning()
		expect(plain.isPersona).toBe(false)

		await charactersSetDefaultPersona.handler(
			fakeSocket(user.id),
			{ characterId: plain.id } as any,
			noopEmit
		)

		const after = await getPersona(plain.id)
		expect(after?.isDefaultPersona).toBe(true)
		// A default you cannot play is not a state worth having.
		expect(after?.isPersona).toBe(true)
	})
})
