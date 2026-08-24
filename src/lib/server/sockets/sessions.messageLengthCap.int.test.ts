/**
 * Round-7 audit fix: regular session messages had no length cap, unlike
 * assistant-mode sessions (assistantV2.ts already caps at 50,000 chars — dead
 * code today, but the precedent is reused here). An oversized message lands
 * in the "always-included recent messages" window every infill engine
 * re-renders/re-tokenizes from scratch on every candidate it evaluates —
 * synchronously, on Node's single event loop — so it's a single-message DoS
 * reachable by any session participant, not just the sender's own session.
 * sessions:promptTokenCount (the live draft-preview handler) and
 * sessions:triggerNarratorResponse's optional instructions field (which the
 * round-6 fix threads into the compiled prompt as extraInstructions, the
 * same token-budget recompute hot path) get the same treatment.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	MAX_CHAT_MESSAGE_LENGTH,
	MAX_NARRATOR_INSTRUCTIONS_LENGTH
} from "$lib/shared/constants/MessageLimits"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-message-length-cap-int-test-")
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
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

describe("sessionMessages:sendPersonaMessage — length cap (PGlite integration)", () => {
	test("rejects an oversized message", async () => {
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"./sessions"
		)
		const user = await makeUser("send-length-cap-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "P",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()

		const res = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: session.id,
				personaId: persona.id,
				content: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
			} as any,
			noopEmit
		)

		expect(res.error).toMatch(/too long/i)
		expect(res.sessionMessage).toBeUndefined()
	})

	test("accepts a message at exactly the limit", async () => {
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"./sessions"
		)
		const user = await makeUser("send-length-ok-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "P",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()

		const res = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: session.id,
				personaId: persona.id,
				content: "x".repeat(MAX_CHAT_MESSAGE_LENGTH)
			} as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.sessionMessage).toBeTruthy()
	})
})

describe("sessionMessages:update — length cap (PGlite integration)", () => {
	test("rejects editing a message in with oversized content", async () => {
		const { sessionMessagesUpdateHandler } = await import("./sessions")
		const user = await makeUser("update-length-cap-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const [persona] = await testDb
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "P",
				description: "",
				isDefault: false,
				aliases: []
			})
			.returning()
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "user",
				personaId: persona.id,
				content: "original"
			})
			.returning()

		const res = await sessionMessagesUpdateHandler.handler(
			fakeSocket(user.id),
			{
				id: message.id,
				content: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
			} as any,
			noopEmit
		)

		expect(res.error).toMatch(/too long/i)
	})
})

describe("sessions:promptTokenCount — length cap (PGlite integration)", () => {
	test("rejects an oversized draft before any session lookup", async () => {
		const { promptTokenCountHandler } = await import("./sessions")
		const user = await makeUser("prompttokencount-length-cap-user")

		const res = await promptTokenCountHandler.handler(
			fakeSocket(user.id),
			{
				// No real session needed — the length check runs before the
				// session-access lookup, so it must reject even a nonexistent
				// sessionId.
				sessionId: 999_999_999,
				content: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
			} as any,
			noopEmit
		)

		expect(res.error).toMatch(/too long/i)
	})
})

describe("sessions:triggerNarratorResponse — instructions length cap (PGlite integration)", () => {
	test("rejects oversized narrator instructions before any session lookup", async () => {
		const { triggerNarratorResponseHandler } = await import("./sessions")
		const user = await makeUser("narrator-instructions-cap-user")

		const res = await triggerNarratorResponseHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: 999_999_999,
				instructions: "x".repeat(MAX_NARRATOR_INSTRUCTIONS_LENGTH + 1)
			} as any,
			noopEmit
		)

		expect(res.error).toMatch(/too long/i)
	})

	test("accepts instructions at exactly the limit (fails later only on the nonexistent session)", async () => {
		const { triggerNarratorResponseHandler } = await import("./sessions")
		const user = await makeUser("narrator-instructions-ok-user")

		const res = await triggerNarratorResponseHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: 999_999_999,
				instructions: "x".repeat(MAX_NARRATOR_INSTRUCTIONS_LENGTH)
			} as any,
			noopEmit
		)

		expect(res.error).not.toMatch(/too long/i)
		expect(res.error).toMatch(/session not found/i)
	})
})
