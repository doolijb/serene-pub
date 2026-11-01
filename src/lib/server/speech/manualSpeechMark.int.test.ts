/**
 * A manual Read aloud / Say it as… marks its line pending the way the
 * automatic path does, and clears only its own marker (speech polish D1).
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	endManualSpeech,
	isSpeakRun,
	markManualSpeech
} from "$lib/server/speech/onMessageSettled"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number
let messageId: number

beforeAll(async () => {
	db = await createTestDb()
	const [user] = await db.insert(schema.users).values({ username: "manual-mark", isAdmin: false }).returning()
	const [c] = await db
		.insert(schema.characters)
		.values({ userId: user!.id, name: "Alice", description: "A knight." })
		.returning()
	const [s] = await db.insert(schema.sessions).values({ userId: user!.id, isGroup: false } as never).returning()
	sessionId = s!.id
	const [m] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "A line.", characterId: c!.id } as never)
		.returning()
	messageId = m!.id
})

const pendingOf = async () => {
	const [row] = await db
		.select({ metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
	return (row!.metadata as { spoken?: { pending?: { runId: string } } } | null)?.spoken?.pending
}

describe("manual speech marking", () => {
	it("recognises the speak-message spec, versioned or not, and nothing else", () => {
		expect(isSpeakRun("core:spec/speak-message")).toBe(true)
		expect(isSpeakRun("core:spec/speak-message@1.0.0")).toBe(true)
		expect(isSpeakRun("core:spec/story-respond")).toBe(false)
		expect(isSpeakRun(undefined)).toBe(false)
	})

	it("marks the line with its run, and clears only a marker that is still its own", async () => {
		expect(await markManualSpeech(db, undefined, sessionId, messageId, "run-a")).toBe(true)
		expect((await pendingOf())?.runId).toBe("run-a")
		// A newer press took the line: the older run's ending must not clear it.
		await markManualSpeech(db, undefined, sessionId, messageId, "run-b")
		await endManualSpeech(db, undefined, sessionId, messageId, "run-a")
		expect((await pendingOf())?.runId).toBe("run-b")
		await endManualSpeech(db, undefined, sessionId, messageId, "run-b")
		expect(await pendingOf()).toBeUndefined()
	})
})
