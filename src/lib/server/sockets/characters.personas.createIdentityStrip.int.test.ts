/**
 * Round-8 audit fix: charactersCreate/personasCreate update handlers already
 * strip client-supplied `uuid` before writing (uuid carries a table-wide,
 * not per-user, unique index — a client-supplied value could collide with
 * another user's row and permanently block their future import of that
 * exact card), but the create handlers were missing the same strip. `id`
 * (a client-overridable identity column) had the same gap. Both must always
 * be server-generated, regardless of what a raw socket client sends.
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
		path.join(os.tmpdir(), "serene-pub-create-identity-strip-int-test-")
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

describe("charactersCreate — identity field stripping (PGlite integration)", () => {
	test("a client-supplied uuid colliding with another user's row is not used", async () => {
		const { charactersCreate } = await import("./characters")
		const victim = await makeUser("char-create-uuid-victim")
		const attacker = await makeUser("char-create-uuid-attacker")

		const [victimCharacter] = await testDb
			.insert(schema.characters)
			.values({ userId: victim.id, name: "Victim", description: "" })
			.returning()

		const res = await charactersCreate.handler(
			fakeSocket(attacker.id),
			{
				character: {
					name: "Squatter",
					description: "",
					uuid: victimCharacter.uuid
				}
			} as any,
			noopEmit
		)

		expect(res.character).toBeTruthy()
		expect(res.character!.uuid).not.toBe(victimCharacter.uuid)
	})

	test("a client-supplied id is ignored — the server always generates its own", async () => {
		const { charactersCreate } = await import("./characters")
		const user = await makeUser("char-create-id-user")

		const res = await charactersCreate.handler(
			fakeSocket(user.id),
			{
				character: {
					id: 999_999_999,
					name: "Id Spoof",
					description: ""
				}
			} as any,
			noopEmit
		)

		expect(res.character).toBeTruthy()
		expect(res.character!.id).not.toBe(999_999_999)
	})
})

describe("personasCreate — identity field stripping (PGlite integration)", () => {
	test("a client-supplied uuid colliding with another user's row is not used", async () => {
		const { personasCreate } = await import("./personas")
		const victim = await makeUser("persona-create-uuid-victim")
		const attacker = await makeUser("persona-create-uuid-attacker")

		const [victimPersona] = await testDb
			.insert(schema.personas)
			.values({
				userId: victim.id,
				name: "Victim",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()

		const res = await personasCreate.handler(
			fakeSocket(attacker.id),
			{
				persona: {
					name: "Squatter",
					description: "",
					isDefault: false,
					aliases: [],
					uuid: victimPersona.uuid
				}
			} as any,
			noopEmit
		)

		expect(res.persona).toBeTruthy()
		expect(res.persona!.uuid).not.toBe(victimPersona.uuid)
	})

	test("a client-supplied id is ignored — the server always generates its own", async () => {
		const { personasCreate } = await import("./personas")
		const user = await makeUser("persona-create-id-user")

		const res = await personasCreate.handler(
			fakeSocket(user.id),
			{
				persona: {
					id: 999_999_999,
					name: "Id Spoof",
					description: "",
					isDefault: false,
					aliases: []
				}
			} as any,
			noopEmit
		)

		expect(res.persona).toBeTruthy()
		expect(res.persona!.id).not.toBe(999_999_999)
	})
})
