/**
 * Round-8 audit fix: the update handler already strips a client-supplied
 * `uuid` before writing (uuid carries a table-wide, not per-user, unique
 * index — a client-supplied value could collide with another user's row and
 * permanently block their future import of that exact card), but the create
 * handler was missing the same strip. `id` (a client-overridable identity
 * column) had the same gap. Both must always be server-generated, regardless
 * of what a raw socket client sends.
 *
 * The second half was `personasCreate` until 0133 folded the two tables
 * together. It is kept — retargeted at `characters:create` WITH the persona
 * flags set — because the strip has to hold for the persona-shaped create
 * too: that path now carries two extra client-supplied booleans, and the one
 * of them that is dangerous (`isDefaultPersona`) is asserted here as well.
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

describe("charactersCreate as a persona — identity field stripping", () => {
	test("a client-supplied uuid colliding with another user's row is not used", async () => {
		const { charactersCreate } = await import("./characters")
		const victim = await makeUser("persona-create-uuid-victim")
		const attacker = await makeUser("persona-create-uuid-attacker")

		const [victimPersona] = await testDb
			.insert(schema.characters)
			.values({
				userId: victim.id,
				name: "Victim",
				description: "",
				isPersona: true,
				aliases: []
			})
			.returning()

		const res = await charactersCreate.handler(
			fakeSocket(attacker.id),
			{
				character: {
					name: "Squatter",
					description: "",
					isPersona: true,
					aliases: [],
					uuid: victimPersona.uuid
				}
			} as any,
			noopEmit
		)

		expect(res.character).toBeTruthy()
		expect(res.character!.uuid).not.toBe(victimPersona.uuid)
		expect(res.character!.isPersona).toBe(true)
	})

	test("a client-supplied id is ignored — the server always generates its own", async () => {
		const { charactersCreate } = await import("./characters")
		const user = await makeUser("persona-create-id-user")

		const res = await charactersCreate.handler(
			fakeSocket(user.id),
			{
				character: {
					id: 999_999_999,
					name: "Id Spoof",
					description: "",
					isPersona: true,
					aliases: []
				}
			} as any,
			noopEmit
		)

		expect(res.character).toBeTruthy()
		expect(res.character!.id).not.toBe(999_999_999)
	})

	/**
	 * `isDefaultPersona` on a CREATE is the setup wizard's own shape — it
	 * makes a starter persona and claims the default in one call. Written
	 * straight into the INSERT it would be refused the moment the user
	 * already had one, so the handler lifts it out and applies it through the
	 * same clear-then-set transaction `characters:setDefaultPersona` uses.
	 */
	test("claiming the default on create replaces the existing one rather than failing", async () => {
		const { charactersCreate } = await import("./characters")
		const user = await makeUser("persona-create-default-user")

		const [incumbent] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Incumbent",
				description: "",
				isPersona: true,
				isDefaultPersona: true,
				aliases: []
			})
			.returning()

		const res = await charactersCreate.handler(
			fakeSocket(user.id),
			{
				character: {
					name: "Starter",
					description: "",
					isPersona: true,
					isDefaultPersona: true,
					aliases: []
				}
			} as any,
			noopEmit
		)

		expect(res.character!.isDefaultPersona).toBe(true)
		const defaults = await testDb.query.characters.findMany({
			where: (c, { and, eq }) =>
				and(eq(c.userId, user.id), eq(c.isDefaultPersona, true)),
			columns: { id: true }
		})
		expect(defaults.map((d) => d.id)).toEqual([res.character!.id])
		const before = await testDb.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, incumbent.id),
			columns: { isDefaultPersona: true }
		})
		expect(before?.isDefaultPersona).toBe(false)
	})

	/** A folder that is not yours is not a destination — it files at top level. */
	test("a client-supplied folderId belonging to someone else is dropped", async () => {
		const { charactersCreate } = await import("./characters")
		const owner = await makeUser("persona-create-folder-owner")
		const outsider = await makeUser("persona-create-folder-outsider")

		const [folder] = await testDb
			.insert(schema.characterFolders)
			.values({ userId: owner.id, name: "Mine" })
			.returning()

		const res = await charactersCreate.handler(
			fakeSocket(outsider.id),
			{
				character: {
					name: "Interloper",
					description: "",
					folderId: folder.id
				}
			} as any,
			noopEmit
		)

		expect(res.character!.folderId).toBeNull()
	})
})
