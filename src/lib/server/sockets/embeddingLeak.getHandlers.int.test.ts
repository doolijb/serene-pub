/**
 * Round-9 audit fix (LOW): charactersGet/personasGet had no `columns`
 * restriction on their findFirst calls, unlike their :list siblings (which
 * already allowlist columns) — the response spread the full row, including
 * the raw embedding vector/embeddingModel/vectorizedAt. Fixed by adding the
 * same exclude-style `columns` restriction the :list handlers already use.
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
		path.join(os.tmpdir(), "serene-pub-embedding-leak-int-test-")
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

describe("characters:get — no embedding leak (PGlite integration)", () => {
	test("response has no embedding/embeddingModel/vectorizedAt keys", async () => {
		const { charactersGet } = await import("./characters")
		const owner = await makeUser("embedding-leak-char-owner")
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Vectorized Character",
				description: "x",
				embedding: [0.1, 0.2, 0.3],
				embeddingModel: "test-model"
			})
			.returning()

		const res = await charactersGet.handler(
			fakeSocket(owner.id),
			{ id: character.id } as any,
			noopEmit
		)

		expect(res.character).toBeTruthy()
		expect(res.character).not.toHaveProperty("embedding")
		expect(res.character).not.toHaveProperty("embeddingModel")
		expect(res.character).not.toHaveProperty("vectorizedAt")
		expect((res.character as any).name).toBe("Vectorized Character")
	})
})

describe("personas:get — no embedding leak (PGlite integration)", () => {
	test("response has no embedding/embeddingModel/vectorizedAt keys", async () => {
		const { personasGet } = await import("./personas")
		const owner = await makeUser("embedding-leak-persona-owner")
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: owner.id,
				name: "Vectorized Persona",
				description: "x",
				isDefault: false,
				embedding: [0.4, 0.5, 0.6],
				embeddingModel: "test-model"
			})
			.returning()

		const res = await personasGet.handler(
			fakeSocket(owner.id),
			{ id: persona.id } as any,
			noopEmit
		)

		expect(res.persona).toBeTruthy()
		expect(res.persona).not.toHaveProperty("embedding")
		expect(res.persona).not.toHaveProperty("embeddingModel")
		expect(res.persona).not.toHaveProperty("vectorizedAt")
		expect((res.persona as any).name).toBe("Vectorized Persona")
	})
})
