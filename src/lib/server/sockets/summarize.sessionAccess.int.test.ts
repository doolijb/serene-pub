/**
 * Round-10 audit fix (LOW): sessionsSummarizeHandler/sessionsSetLorebookHandler
 * reimplemented session ownership inline instead of using the shared
 * checkSessionAccess helper (utils/sessionAccess.ts), whose own comment warns
 * against ad-hoc reimplementations — this is how a prior guest-lockout bug
 * happened. Effect is equivalent today (owner-only for both handlers), so
 * this is a maintainability alignment — verified here as a behavior
 * regression guard: a non-owner, non-guest user must still be rejected.
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
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-summarize-sessionaccess-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeSessionWithOwner(ownerUsername: string) {
	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: ownerUsername })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ isGroup: false, userId: owner.id })
		.returning()
	return { owner, session }
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: false } } as any
}

const noopEmit = () => {}

describe("sessions:summarize — ownership check", () => {
	test("a non-owner, non-guest user is rejected", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const { owner, session } = await makeSessionWithOwner(
			"sessionaccess-summarize-owner"
		)
		const [stranger] = await testDb
			.insert(schema.users)
			.values({ username: "sessionaccess-summarize-stranger" })
			.returning()

		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(stranger.id),
				{
					sessionId: session.id,
					messageIds: "all",
					loreType: "world"
				} as any,
				noopEmit
			)
		).rejects.toThrow(/not found or access denied/i)
	})
})

describe("sessions:setLorebook — ownership check", () => {
	test("a non-owner, non-guest user is rejected", async () => {
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const { owner, session } = await makeSessionWithOwner(
			"sessionaccess-setlorebook-owner"
		)
		const [stranger] = await testDb
			.insert(schema.users)
			.values({ username: "sessionaccess-setlorebook-stranger" })
			.returning()

		await expect(
			sessionsSetLorebookHandler.handler(
				fakeSocket(stranger.id),
				{ sessionId: session.id, lorebookId: null } as any,
				noopEmit
			)
		).rejects.toThrow(/not found or access denied/i)
	})

	test("the owner can attach a lorebook they own", async () => {
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const { owner, session } = await makeSessionWithOwner(
			"sessionaccess-setlorebook-happy-owner"
		)
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Lorebook", userId: owner.id })
			.returning()

		const res = await sessionsSetLorebookHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, lorebookId: lorebook.id } as any,
			noopEmit
		)
		expect(res.session.lorebookId).toBe(lorebook.id)
	})
})
