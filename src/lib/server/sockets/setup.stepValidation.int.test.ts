/**
 * Round-10 audit fix (LOW): setupMarkComplete's step branch was
 * if (step === "summarization") {...} else {...ragStepComplete: true...} —
 * any value other than the literal "summarization" (including a typo or a
 * forged value) fell into the else branch and silently set
 * ragStepComplete, letting a client flip that onboarding flag without ever
 * completing the rag step. Fixed by validating step is exactly
 * "summarization" or "rag" up front.
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
		path.join(os.tmpdir(), "serene-pub-setup-step-int-test-")
	)
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

describe("setup:markComplete — step validation", () => {
	test("rejects a bogus step value instead of silently completing rag", async () => {
		const { setupMarkComplete } = await import("./setup")
		const user = await makeUser("setup-step-bogus-user")

		await expect(
			setupMarkComplete.handler(
				fakeSocket(user.id),
				{ step: "not-a-real-step" } as any,
				noopEmit
			)
		).rejects.toThrow(/invalid setup step/i)

		const row = await testDb.query.setup.findFirst({
			where: (s, { eq }) => eq(s.userId, user.id)
		})
		expect(row?.ragStepComplete ?? false).toBe(false)
	})

	test('accepts "summarization" and sets only that flag', async () => {
		const { setupMarkComplete } = await import("./setup")
		const user = await makeUser("setup-step-summarization-user")

		const res = await setupMarkComplete.handler(
			fakeSocket(user.id),
			{ step: "summarization" } as any,
			noopEmit
		)
		expect(res.setup.summarizationStepComplete).toBe(true)
		expect(res.setup.ragStepComplete).toBe(false)
	})

	test('accepts "rag" and sets only that flag', async () => {
		const { setupMarkComplete } = await import("./setup")
		const user = await makeUser("setup-step-rag-user")

		const res = await setupMarkComplete.handler(
			fakeSocket(user.id),
			{ step: "rag" } as any,
			noopEmit
		)
		expect(res.setup.ragStepComplete).toBe(true)
		expect(res.setup.summarizationStepComplete).toBe(false)
	})
})
