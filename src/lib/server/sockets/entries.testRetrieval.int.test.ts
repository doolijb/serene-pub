/**
 * `entries:testRetrieval` refuses before it runs anything.
 *
 * The handler compiles a real turn against a session, which makes it one of
 * the few entry verbs whose subject is **two** objects: an entry and a
 * conversation. Both have to be the asker's to name, and the precedent for
 * getting that wrong is `triggerGenerateMessage`, where a handler that ran a
 * turn with only the caller's *session* in scope let a guest drive generations
 * they had no business driving.
 *
 * Scoped deliberately to the three refusals, and every one of them returns
 * before `runTurn` is reached — which is the property being asserted as much as
 * the sentence is. A test that got as far as the pipeline would need a
 * published spec, a connection and an embedding model to say nothing more about
 * permission than these three do.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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
		path.join(os.tmpdir(), "serene-pub-entries-test-retrieval-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

async function makeEntry(lorebookId: number, name: string) {
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			name,
			content: "The gate is sealed.",
			keys: ["gate"],
			position: 1
		} as any)
		.returning()
	return entry
}

async function makeSession(userId: number, lorebookId: number | null) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	return session
}

describe("entries:testRetrieval — permission", () => {
	test("refuses an entry the asker does not own", async () => {
		const { testEntryRetrievalHandler } = await import("./entries")
		const author = await makeUser("test-retrieval-author")
		const stranger = await makeUser("test-retrieval-stranger")
		const lorebook = await makeLorebook(author.id, "Author's Book")
		const entry = await makeEntry(lorebook.id, "The Gate")
		const session = await makeSession(author.id, lorebook.id)

		const res = await testEntryRetrievalHandler.handler(
			fakeSocket(stranger.id),
			{
				id: entry.id,
				typeId: WORLD_LORE_TYPE_ID,
				sessionId: session.id
			},
			noopEmit
		)

		expect(res.error).toBe("Entry not found or access denied.")
		expect(res.row).toBeUndefined()
	}, 60_000)

	test("refuses a session the asker cannot reach, even holding their own entry", async () => {
		const { testEntryRetrievalHandler } = await import("./entries")
		const author = await makeUser("test-retrieval-owner")
		const other = await makeUser("test-retrieval-other")
		const lorebook = await makeLorebook(author.id, "Own Book")
		const entry = await makeEntry(lorebook.id, "Own Entry")
		// Somebody else's conversation. Owning the entry is not consent to
		// compile a turn in a room the asker is neither owner nor guest of.
		const foreign = await makeSession(other.id, null)

		const res = await testEntryRetrievalHandler.handler(
			fakeSocket(author.id),
			{
				id: entry.id,
				typeId: WORLD_LORE_TYPE_ID,
				sessionId: foreign.id
			},
			noopEmit
		)

		expect(res.error).toBe("Session not found or access denied.")
	}, 60_000)

	test("refuses a conversation reading a different lorebook, with the reason", async () => {
		const { testEntryRetrievalHandler } = await import("./entries")
		const author = await makeUser("test-retrieval-mismatch")
		const bookA = await makeLorebook(author.id, "Book A")
		const bookB = await makeLorebook(author.id, "Book B")
		const entry = await makeEntry(bookA.id, "Only In A")
		const session = await makeSession(author.id, bookB.id)

		const res = await testEntryRetrievalHandler.handler(
			fakeSocket(author.id),
			{
				id: entry.id,
				typeId: WORLD_LORE_TYPE_ID,
				sessionId: session.id
			},
			noopEmit
		)

		// The sentence matters as much as the refusal: an absence with no
		// reason attached is the failure this whole surface exists to fix.
		expect(res.error).toContain("reads a different lorebook")
	}, 60_000)
})
