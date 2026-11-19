/**
 * DG3 (2026-11-17): "For the future, never publish raw errors directly to the
 * message body." A run that halts with its row open stores the plain reply
 * sentence; the receipt's reason is not written to the row.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"

// `persistGenerationErrorRow` writes through the module's own handle.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {}
}))
vi.mock("$lib/server/sessions/rowPush", () => ({ broadcastSessionRow: () => {} }))

import { createLiveRow } from "./liveRow"
import { plainReplyFailure } from "./haltExplanation"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const user = await createTestUser(db, "live-row-halt-wording")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session!.id
})

const open = async () => {
	const row = await insertLegacy(db, {
		sessionId,
		role: "assistant",
		content: "",
		isGenerating: true,
		metadata: {}
	})
	const live = createLiveRow({
		db: db as any,
		sessionId,
		io: {} as any,
		streamingNodes: new Set(["generate"])
	})
	live.opened(row)
	return { row, live }
}

describe("a halt with the row open", () => {
	it("stores the plain sentence, not the receipt's reason", async () => {
		const { row, live } = await open()
		await live.finish({
			kind: "halt",
			reason: "node 'respond.guard' of core:spec/message-respond@3 refused"
		} as any)
		const [stored] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, row.id))
		expect((stored!.error as any).message).toBe(plainReplyFailure())
		expect(JSON.stringify(stored!.error)).not.toMatch(/respond\.guard|core:spec/)
	})
})
