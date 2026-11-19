/**
 * The narrator name is read once per host (one run), never across runs
 * (perf-1 w1): two `session_cast` reads on one host call the real
 * `narratorNameFor` once; a new host sees a rename; a failed read is retried.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let sessionId: number
let calls = 0
let failNext = false

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/pipelines/runtime/host.helpers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/pipelines/runtime/host.helpers")>()
	return {
		...actual,
		narratorNameFor: async (...args: Parameters<typeof actual.narratorNameFor>) => {
			calls++
			if (failNext) {
				failNext = false
				throw new Error("narrator read failed")
			}
			return actual.narratorNameFor(...args)
		}
	}
})

const castNode = { key: "read", definitionId: "core:query/session-cast@1" } as any

const newHost = async () => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(testDb as any, { sessionId })
}
const readCast = async (host: Awaited<ReturnType<typeof newHost>>) =>
	(await host.read!("session_cast", { sessionId }, castNode)) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-narrator-memo-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
	const { STORY_GENRE_ID } = await import("@serene-pub/core-catalog")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "narrator-memo")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, genreId: STORY_GENRE_ID } as any)
		.returning()
	sessionId = session.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	calls = 0
	failNext = false
})

describe("narrator name memo (per host)", () => {
	test("one host, two session_cast reads: narratorNameFor once, same name", async () => {
		const host = await newHost()
		const a = await readCast(host)
		const b = await readCast(host)
		expect(calls).toBe(1)
		expect(a.sessionNarratorName).toBe(b.sessionNarratorName)
	})

	test("a rejected read is not remembered", async () => {
		const host = await newHost()
		failNext = true
		await expect(readCast(host)).rejects.toThrow("narrator read failed")
		expect(calls).toBe(1)
		const again = await readCast(host)
		expect(calls).toBe(2)
		expect(again.sessionNarratorName).toBeDefined()
	})

	test("a new host sees a rename made between runs", async () => {
		const before = await readCast(await newHost())
		const seeded = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(sql`${schema.pipelinePrompts.fields}->>'narratorName'`, "Narrator"))
		expect(seeded.length).toBeGreaterThan(0)
		for (const row of seeded)
			await testDb
				.update(schema.pipelinePrompts)
				.set({ fields: { ...(row.fields as Record<string, string>), narratorName: "The Chronicler" } })
				.where(eq(schema.pipelinePrompts.id, row.id))
		const after = await readCast(await newHost())
		expect(before.sessionNarratorName).toBe("Narrator")
		expect(after.sessionNarratorName).toBe("The Chronicler")
	})

	test("a write in the same run leaves the name as a fresh host reads it", async () => {
		const host = await newHost()
		const before = await readCast(host)
		await host.commit!(
			{ text: "A line.", speaker: "Narrator" },
			{ key: "say", definitionId: "core:outlet/create-message", definitionVersion: 1 } as any
		)
		const after = await readCast(host)
		expect(after.sessionNarratorName).toBe(before.sessionNarratorName)
		expect(after.sessionNarratorName).toBe((await readCast(await newHost())).sessionNarratorName)
	})
})
