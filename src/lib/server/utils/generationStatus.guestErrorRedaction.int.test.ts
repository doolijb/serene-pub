/**
 * Round-12 audit fix (MEDIUM): persistGenerationErrorRow broadcast the raw
 * upstream provider error (friendlyErrorFromUnknown(err) — verbatim
 * err.message, eg. "HTTP 401: Unauthorized" or a KoboldCPP model-load
 * failure with an embedded response body) to the entire chat room,
 * including guests who have no relationship to the chat owner's LLM
 * connection/credentials. The stored DB row keeps the real error (the
 * owner needs it for troubleshooting); only the guest-facing broadcast is
 * now redacted to a generic message via the new
 * broadcastToChatUsersVaryingByRole helper.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-genstatus-redaction-int-test-")
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

function makeIoSpy() {
	const received: Record<string, any[]> = {}
	const io = {
		to: (room: string) => ({
			emit: (_event: string, data: any) => {
				received[room] = received[room] ?? []
				received[room].push(data)
			}
		})
	}
	return { io, received }
}

describe("persistGenerationErrorRow — guest-facing error redaction (Round-12 audit fix, PGlite integration)", () => {
	test("the chat owner receives the real provider error; a guest receives a generic message", async () => {
		const { persistGenerationErrorRow } = await import(
			"./generationStatus"
		)

		const owner = await makeUser("genstatus-redact-owner")
		const guest = await makeUser("genstatus-redact-guest")
		const [chat] = await testDb
			.insert(schema.chats)
			.values({ userId: owner.id, isGroup: true })
			.returning()
		await testDb.insert(schema.chatGuests).values({
			chatId: chat.id,
			userId: guest.id,
			isPlayer: true
		})
		const [message] = await testDb
			.insert(schema.chatMessages)
			.values({
				chatId: chat.id,
				role: "assistant",
				isGenerating: true,
				content: ""
			})
			.returning()

		const { io, received } = makeIoSpy()
		const rawError = new Error(
			"HTTP 401: Unauthorized — invalid API key sk-real-secret-fragment"
		)

		await persistGenerationErrorRow(io, chat.id, message.id, rawError)

		const ownerPayload = received[`user_${owner.id}`]?.[0]
		const guestPayload = received[`user_${guest.id}`]?.[0]

		expect(ownerPayload.chatMessage.error.message).toContain(
			"sk-real-secret-fragment"
		)
		expect(guestPayload.chatMessage.error.message).not.toContain(
			"sk-real-secret-fragment"
		)
		expect(guestPayload.chatMessage.error.message).toMatch(
			/ask the chat owner/i
		)

		// The stored DB row still keeps the real error — only the guest
		// broadcast is redacted, not the persisted data the owner can later
		// re-fetch.
		const row = await testDb.query.chatMessages.findFirst({
			where: eq(schema.chatMessages.id, message.id)
		})
		expect((row?.error as any)?.message).toContain(
			"sk-real-secret-fragment"
		)
	})
})
