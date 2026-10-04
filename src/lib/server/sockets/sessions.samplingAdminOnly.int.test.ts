/**
 * A session's sampling override is an admin's to set (owner ruling): a
 * session owner who is not an admin is refused with a sentence and the stored
 * value stays; an admin may set it; and a form that posts the stored value
 * back unchanged is not a write and is not refused.
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
		path.join(os.tmpdir(), "serene-pub-sampling-admin-only-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string, isAdmin = false) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin })
		.returning()
	return user
}

function fakeSocket(userId: number, isAdmin: boolean) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

async function makeSampling(name: string) {
	const [row] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name })
		.returning()
	return row
}

async function storedSampling(sessionId: number) {
	const [row] = await testDb
		.select({ samplingConfigId: schema.sessions.samplingConfigId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row.samplingConfigId
}

describe("sessions:update — the sampling override is admin-only", () => {
	test("a non-admin owner is refused with a sentence and the stored value stays", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("sampling-owner-1")
		const kept = await makeSampling("Kept")
		const wanted = await makeSampling("Wanted")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, samplingConfigId: kept.id })
			.returning()

		const emitted: Array<[string, any]> = []
		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(owner.id, false),
				{ session: { id: session.id, samplingConfigId: wanted.id } } as any,
				(e: string, d: any) => emitted.push([e, d])
			)
		).rejects.toThrow()

		const refusal = emitted.find(([e]) => e === "sessions:update:error")
		expect(refusal?.[1].error).toMatch(/Only an admin can change a session's sampling/)
		expect(await storedSampling(session.id)).toBe(kept.id)
	})

	test("a non-admin owner posting the stored value back unchanged is not refused", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("sampling-owner-2")
		const kept = await makeSampling("Kept 2")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, samplingConfigId: kept.id })
			.returning()

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id, false),
			{
				session: { id: session.id, name: "Renamed", samplingConfigId: kept.id }
			} as any,
			() => {}
		)
		expect(await storedSampling(session.id)).toBe(kept.id)
		const [row] = await testDb
			.select({ name: schema.sessions.name })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect(row.name).toBe("Renamed")
	})

	test("an admin owner may set it", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const admin = await makeUser("sampling-admin-1", true)
		const wanted = await makeSampling("Wanted 3")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: admin.id, isGroup: false })
			.returning()

		await sessionsUpdateHandler.handler(
			fakeSocket(admin.id, true),
			{ session: { id: session.id, samplingConfigId: wanted.id } } as any,
			() => {}
		)
		expect(await storedSampling(session.id)).toBe(wanted.id)
	})
})
