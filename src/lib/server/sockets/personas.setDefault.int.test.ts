/**
 * D3: personas:setDefault — clears the caller's own prior default and sets
 * the new one, transactionally. Explicitly scoped to `userId` in both
 * UPDATE statements — a bare "WHERE is_default = true" clear would wipe
 * every user's default on a multi-account instance, not just the caller's.
 * This test's core assertion is exactly that: setting user A's default
 * must never touch user B's.
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
		path.join(os.tmpdir(), "serene-pub-persona-setdefault-int-test-")
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
	return testDb.query.personas.findFirst({
		where: eq(schema.personas.id, id)
	})
}

describe("personas:setDefault (PGlite integration)", () => {
	test("switches the caller's own default between two of their personas", async () => {
		const { personasSetDefault } = await import("./personas")

		const user = await makeUser("setdefault-user")
		const [personaA] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Persona A",
				description: "",
				aliases: [],
				isDefault: true
			})
			.returning()
		const [personaB] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Persona B",
				description: "",
				aliases: [],
				isDefault: false
			})
			.returning()

		await personasSetDefault.handler(
			fakeSocket(user.id),
			{ personaId: personaB.id } as any,
			noopEmit
		)

		expect((await getPersona(personaA.id))?.isDefault).toBe(false)
		expect((await getPersona(personaB.id))?.isDefault).toBe(true)
	})

	test("does not touch another user's default persona (multi-account scoping)", async () => {
		const { personasSetDefault } = await import("./personas")

		const userA = await makeUser("setdefault-user-a")
		const userB = await makeUser("setdefault-user-b")

		const [aDefault] = await testDb
			.insert(schema.personas)
			.values({
				userId: userA.id,
				name: "A's persona",
				description: "",
				aliases: [],
				isDefault: true
			})
			.returning()
		const [aSecond] = await testDb
			.insert(schema.personas)
			.values({
				userId: userA.id,
				name: "A's second persona",
				description: "",
				aliases: [],
				isDefault: false
			})
			.returning()
		const [bDefault] = await testDb
			.insert(schema.personas)
			.values({
				userId: userB.id,
				name: "B's persona",
				description: "",
				aliases: [],
				isDefault: true
			})
			.returning()

		// User A changes their own default.
		await personasSetDefault.handler(
			fakeSocket(userA.id),
			{ personaId: aSecond.id } as any,
			noopEmit
		)

		expect((await getPersona(aDefault.id))?.isDefault).toBe(false)
		expect((await getPersona(aSecond.id))?.isDefault).toBe(true)
		// User B's default must be completely unaffected.
		expect((await getPersona(bDefault.id))?.isDefault).toBe(true)
	})

	test("rejects setting a default on a persona the caller doesn't own", async () => {
		const { personasSetDefault } = await import("./personas")

		const owner = await makeUser("setdefault-owner")
		const other = await makeUser("setdefault-other")
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: owner.id,
				name: "Owner's persona",
				description: "",
				aliases: [],
				isDefault: false
			})
			.returning()

		await expect(
			personasSetDefault.handler(
				fakeSocket(other.id),
				{ personaId: persona.id } as any,
				noopEmit
			)
		).rejects.toThrow(/not found|access denied/i)

		expect((await getPersona(persona.id))?.isDefault).toBe(false)
	})
})
