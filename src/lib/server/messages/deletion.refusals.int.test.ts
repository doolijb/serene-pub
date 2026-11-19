/**
 * A refused deletion, as each reader reads it (DG1d, 2026-11-17: "Regular
 * users see the error and a basic generic user friendly description of the
 * problem and a suggestion to notify admin"): a refusal marked for people
 * reads as written for everyone; any other reason is an administrator's, and
 * anyone else reads the deletion's plain sentence and the suggestion.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { ADMINISTRATOR_SUGGESTION } from "$lib/server/utils/administratorSuggestion"
import { MESSAGE_ACTION_REFUSAL } from "$lib/server/messages/permissions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let ownerId: number
let strangerId: number
let sessionId: number
let elsewhereMessageId: number
let ownMessageId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-deletion-refusals-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser, registerTestDeletion } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "del-owner")).id
	strangerId = (await createTestUser(db, "del-stranger")).id
	const [a] = await db.insert(schema.sessions).values({ userId: ownerId, isGroup: false, name: "A" }).returning()
	const [b] = await db.insert(schema.sessions).values({ userId: ownerId, isGroup: false, name: "B" }).returning()
	sessionId = a.id
	const [own] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: a.id, userId: ownerId, role: "user", content: "mine", metadata: {} } as any)
		.returning()
	ownMessageId = own.id
	const [other] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: b.id, userId: ownerId, role: "user", content: "elsewhere", metadata: {} } as any)
		.returning()
	elsewhereMessageId = other.id
	await registerTestDeletion(db, a.id)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const PLAIN = `The message was not deleted. ${ADMINISTRATOR_SUGGESTION}`

describe("a refused deletion", () => {
	it("by wiring: an administrator reads the reason, anyone else the plain sentence and the suggestion", async () => {
		const { askDeletion } = await import("$lib/server/messages/deletion")
		const ask = (isAdmin: boolean) =>
			askDeletion(db as never, { sessionId, messageId: elsewhereMessageId, userId: ownerId, reader: { isAdmin } })
		const member: any = await ask(false)
		expect(member.deleted).toBe(false)
		expect(member.refused).toBe(PLAIN)
		const admin: any = await ask(true)
		expect(admin.deleted).toBe(false)
		expect(admin.refused).not.toContain(ADMINISTRATOR_SUGGESTION)
		expect(admin.refused).toMatch(/this run is scoped to/)
		const unread: any = await askDeletion(db as never, { sessionId, messageId: elsewhereMessageId, userId: ownerId })
		expect(unread.refused).toBe(PLAIN)
	})

	it("marked for people: everyone reads the sentence as written, with no step", async () => {
		const { askDeletion } = await import("$lib/server/messages/deletion")
		for (const isAdmin of [false, true]) {
			const out: any = await askDeletion(db as never, {
				sessionId,
				messageId: ownMessageId,
				userId: strangerId,
				reader: { isAdmin }
			})
			expect(out.deleted).toBe(false)
			expect(out.refused).toBe(MESSAGE_ACTION_REFUSAL)
		}
	})
})
