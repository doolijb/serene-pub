/**
 * `lorebooks:create` goes to every tab of the user, and its refusal to the
 * tab that asked, where several surfaces (the Lorebooks sidebar, the
 * Summarize modal) may each be waiting on one. The asker's `requestId` comes
 * back on both, so the surface that asked is the one that claims the answer.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lb-create-request-id-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	return { sent, emit: (event: string, data: any) => void sent.push({ event, data }) }
}

describe("lorebooks:create carries the asker's requestId back", () => {
	test("on the broadcast and the reply", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "lb-create-request-id")
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { sent, emit } = recorder()

		const reply = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Atlas", requestId: "modal-1" },
			emit
		)

		expect(reply.requestId).toBe("modal-1")
		const broadcast = sent.find((s) => s.event === "lorebooks:create")
		expect(broadcast?.data.requestId).toBe("modal-1")
		expect(broadcast?.data.lorebook.name).toBe("Atlas")
	}, 60_000)

	test("on the refusal", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "lb-create-request-id-refused")
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { sent, emit } = recorder()

		await expect(
			lorebooksCreateHandler.handler(
				fakeSocket(user.id),
				{ name: null as unknown as string, requestId: "modal-2" },
				emit
			)
		).rejects.toThrow()

		const refusal = sent.find((s) => s.event === "lorebooks:create:error")
		expect(refusal?.data.requestId).toBe("modal-2")
		expect(typeof refusal?.data.error).toBe("string")
	}, 60_000)

	test("a create sent without one gets none back", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "lb-create-no-request-id")
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { sent, emit } = recorder()

		await lorebooksCreateHandler.handler(fakeSocket(user.id), { name: "Plain" }, emit)

		const broadcast = sent.find((s) => s.event === "lorebooks:create")
		expect(broadcast?.data).not.toHaveProperty("requestId")
	}, 60_000)
})
