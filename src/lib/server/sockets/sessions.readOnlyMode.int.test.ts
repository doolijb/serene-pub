/**
 * Read-only when the mode is missing (19 §6, ruled 2026-08-23), at the
 * sockets.
 *
 * What is pinned: a session on a mode this build does not register refuses new
 * turns — the send and the generic trigger both answer with the read-only
 * sentence — while a standard session keeps working **with no registry at all**,
 * because the standard mode is the F29 floor and read-only must never make
 * ordinary sessionting worse. No bootstrap on purpose: an empty registry is the
 * harshest version of "the mode disappeared," and the floor has to hold
 * there too.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		path.join(os.tmpdir(), "serene-pub-readonly-mode-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

describe("a session whose mode is not registered", () => {
	test("refuses the send and the trigger with the read-only sentence", async () => {
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"./sessions"
		)
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")
		const { createTestUser } = await import("$lib/server/utils/testDb")

		const user = await createTestUser(testDb, "readonly-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.gone:input/vanished@1"
			} as any)
			.returning()

		const sent = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, content: "Hello?" } as any,
			noopEmit
		)
		expect(sent.error).toContain("read-only")

		const fired = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, function: "anything" },
			noopEmit
		)
		expect(fired.error).toContain("read-only")

		// Nothing was written — read-only means read-only.
		const { eq } = await import("drizzle-orm")
		const messages = await testDb.query.sessionMessages.findMany({
			where: eq(schema.sessionMessages.sessionId, session.id)
		})
		expect(messages.length).toBe(0)
	})

	test("a standard session still sends with an empty registry — the F29 floor", async () => {
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"./sessions"
		)
		const schema = await import("$lib/server/db/schema")
		const { createTestUser } = await import("$lib/server/utils/testDb")

		const user = await createTestUser(testDb, "readonly-floor")
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Floorwalker",
				description: "Still here.",
				isDefault: false
			})
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: persona.id })

		const sent = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: session.id,
				personaId: persona.id,
				content: "The floor holds."
			} as any,
			noopEmit
		)
		expect(sent.error).toBeUndefined()
		expect(sent.sessionMessage?.content).toBe("The floor holds.")
	})
})
