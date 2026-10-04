/**
 * The session's RAG readout counts what Search by meaning searches: the
 * entries of the session's own lorebook (plan A1, `SEMANTIC_SEARCH_SOURCES`;
 * `getSessionRagContext` scopes the search to that one book).
 *
 * Messages, characters, personas, graph nodes, links and a cast member's own
 * lorebook are embedded by the queue but never found by meaning, so counting
 * them kept the notice up over a fully indexed lorebook, naming a backlog RAG
 * was never waiting on.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

vi.mock("$lib/server/embedding/target", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		resolveEmbeddingTarget: async () => ({ modelId: "test-model" })
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-check-rag-status-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("vectorization:checkRagStatus", () => {
	test("counts the session lorebook's entries and nothing the search does not read", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { seedEntryVectors, worldLoreValues, insertNarrativeNodeRow } =
			await import("$lib/server/pipelines/testing/fixtures")
		const user = await createTestUser(testDb, "check-rag-status")

		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Harbor", userId: user.id })
			.returning()
		const [castBook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Maren's own", userId: user.id })
			.returning()

		// The session's book: two entries embedded under the starred model,
		// one not yet, and a graph node nobody embedded.
		const entries = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues(
					["Quay", "Lamp", "Bell"].map((name) => ({
						lorebookId: book!.id,
						name,
						content: `The ${name.toLowerCase()}.`
					}))
				)
			)
			.returning()
		await seedEntryVectors(
			testDb,
			entries.slice(0, 2).map((e: any) => e.id),
			[1, 0, 0],
			"test-model"
		)
		await insertNarrativeNodeRow(testDb, book!.id, { name: "Maren" } as any)

		// A cast member with a lorebook of their own, never embedded.
		await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId: castBook!.id,
						name: "Keepsake",
						content: "A ring."
					}
				])
			)
		const [maren] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Maren",
				description: "The lamplighter.",
				lorebookId: castBook!.id
			} as any)
			.returning()

		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: "Harbor",
				lorebookId: book!.id
			} as any)
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session!.id, characterId: maren!.id } as any)

		// Past the ten-message threshold, none of it embedded.
		for (let i = 0; i < 14; i++)
			await testDb.insert(schema.sessionMessages).values({
				sessionId: session!.id,
				role: "assistant",
				content: `Line ${i}.`
			} as any)

		const { vectorizationCheckRagStatus } = await import("./vectorization")
		const res = await vectorizationCheckRagStatus.handler(
			{ user: { id: user.id } } as any,
			{ sessionId: session!.id },
			() => {}
		)

		expect(res.applicable).toBe(true)
		expect(res.lorebook).toEqual({
			total: 3,
			nullCount: 1,
			staleCount: 0,
			readyCount: 2
		})
		expect(Object.keys(res).sort()).toEqual([
			"activeModelName",
			"applicable",
			"canHide",
			"lorebook",
			"queueRunning",
			"ragIgnored"
		])
	})
})

/**
 * Hiding the notice is the session owner's to do: it hides it for everyone
 * in the session. A guest is told so, in words, and is never offered the
 * button in the first place (`canHide`).
 */
describe("hiding the RAG notice", () => {
	async function sharedSession(label: string) {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, `${label}-owner`)
		const guest = await createTestUser(testDb, `${label}-guest`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, name: label } as any)
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session!.id, userId: guest.id })
		return { owner, guest, session: session! }
	}

	test("tells the owner they can hide it, and a guest that they cannot", async () => {
		const { owner, guest, session } = await sharedSession("rag-can-hide")
		const { vectorizationCheckRagStatus } = await import("./vectorization")
		const ask = (userId: number) =>
			vectorizationCheckRagStatus.handler(
				{ user: { id: userId } } as any,
				{ sessionId: session.id },
				() => {}
			)
		expect((await ask(owner.id)).canHide).toBe(true)
		expect((await ask(guest.id)).canHide).toBe(false)
	})

	test("refuses a guest in words, and leaves the session as it was", async () => {
		const { guest, session } = await sharedSession("rag-guest-hide")
		const { vectorizationSetSessionRagIgnored } = await import(
			"./vectorization"
		)
		const emitted: { event: string; data: any }[] = []
		await vectorizationSetSessionRagIgnored
			.handler(
				{ user: { id: guest.id } } as any,
				{ sessionId: session.id, ignored: true },
				(event: string, data: any) => {
					emitted.push({ event, data })
				}
			)
			.catch(() => {})
		expect(emitted).toEqual([
			{
				event: "vectorization:setSessionRagIgnored:error",
				data: {
					error: "Only the session's owner can hide or show this notice."
				}
			}
		])
		const { eq } = await import("drizzle-orm")
		const [row] = await testDb
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect((row?.metadata as any)?.ragIgnored).toBeUndefined()
	})
})
