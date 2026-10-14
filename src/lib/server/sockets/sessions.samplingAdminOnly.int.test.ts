/**
 * A session's sampling pick is its pipeline panel row (Pipelines card ›
 * Sampling), which only an admin writes. `sessions:update` carries no sampling
 * field: an old client that still posts `samplingConfigId` is not refused, the
 * rest of its save lands, and no sampling pick is written — for an owner who
 * is not an admin, and for an admin alike.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
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

/** The session's sampling picks, on any pipeline. */
async function samplingPicks(sessionId: number) {
	return testDb
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.scopeKind, "session"),
				eq(schema.pipelineNodeOverrides.scopeId, sessionId),
				eq(schema.pipelineNodeOverrides.slot, "sampling")
			)
		)
}

describe("sessions:update — no sampling is set through it", () => {
	test("a non-admin owner's old field is dropped in silence and the rest of the save lands", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("sampling-owner-1")
		const wanted = await makeSampling("Wanted")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false })
			.returning()

		const emitted: Array<[string, any]> = []
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id, false),
			{
				session: { id: session.id, name: "Renamed", samplingConfigId: wanted.id }
			} as any,
			(e: string, d: any) => emitted.push([e, d])
		)

		expect(emitted.find(([e]) => e === "sessions:update:error")).toBeUndefined()
		const [row] = await testDb
			.select({ name: schema.sessions.name })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect(row.name).toBe("Renamed")
		expect(await samplingPicks(session.id)).toEqual([])
	})

	test("an admin's old field writes no pick either: the panel row is the one session layer", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const admin = await makeUser("sampling-admin-1", true)
		const wanted = await makeSampling("Wanted 2")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: admin.id, isGroup: false })
			.returning()

		await sessionsUpdateHandler.handler(
			fakeSocket(admin.id, true),
			{ session: { id: session.id, samplingConfigId: wanted.id } } as any,
			() => {}
		)
		expect(await samplingPicks(session.id)).toEqual([])
	})
})
