/**
 * narrativeGraph:duplicateCandidates / narrativeGraph:dismissDuplicate
 * handler wiring — findDuplicateCandidates() itself is covered directly in
 * duplicateBindingDetection.test.ts; this checks the socket-handler layer
 * (ownership guard, dismissal actually persisting and taking effect).
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
		path.join(os.tmpdir(), "serene-pub-dupdetect-int-test-")
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

describe("narrativeGraph duplicate detection handlers (PGlite integration)", () => {
	test("lists candidates for a lorebook the user owns, and dismiss removes it from later listings", async () => {
		const {
			narrativeGraphDuplicateCandidatesHandler,
			narrativeGraphDismissDuplicateHandler
		} = await import("./narrativeGraph")
		const user = await makeUser("dupdetect-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Dup Detect Book", userId: user.id })
			.returning()
		const [a] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: lorebook.id, binding: "{{char:1}}", name: "Bram" })
			.returning()
		const [b] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: lorebook.id, binding: "{{char:2}}", name: "Bram" })
			.returning()

		const listed = await narrativeGraphDuplicateCandidatesHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id },
			noopEmit
		)
		expect(listed.candidates).toHaveLength(1)

		await narrativeGraphDismissDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, bindingIdA: a.id, bindingIdB: b.id },
			noopEmit
		)

		const relisted = await narrativeGraphDuplicateCandidatesHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id },
			noopEmit
		)
		expect(relisted.candidates).toHaveLength(0)
	})

	test("refuses to list or dismiss for a lorebook the user doesn't own", async () => {
		const {
			narrativeGraphDuplicateCandidatesHandler,
			narrativeGraphDismissDuplicateHandler
		} = await import("./narrativeGraph")
		const owner = await makeUser("dupdetect-owner")
		const intruder = await makeUser("dupdetect-intruder")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Private Book", userId: owner.id })
			.returning()

		await expect(
			narrativeGraphDuplicateCandidatesHandler.handler(
				fakeSocket(intruder.id),
				{ lorebookId: lorebook.id },
				noopEmit
			)
		).rejects.toThrow(/access denied|not found/i)

		await expect(
			narrativeGraphDismissDuplicateHandler.handler(
				fakeSocket(intruder.id),
				{ lorebookId: lorebook.id, bindingIdA: 1, bindingIdB: 2 },
				noopEmit
			)
		).rejects.toThrow(/access denied|not found/i)
	})
})
