/**
 * The runs list's columns for the Runs widget (lay-R): the registration that
 * started a run, its lineage, its end — and the session echoed back. Never
 * the receipt (the 2026-10-30 memory fix).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "runs-columns-test-secret" }
})

let admin: { id: number }
let sessionId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lay-R-runs-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	admin = await createTestUser(testDb, "runs-col-admin")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: admin.id, isGroup: false })
		.returning()
	sessionId = session.id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

describe("pipelines:runs columns", () => {
	test("a run carries its registration, lineage and end; the reply echoes the session", async () => {
		const started = new Date("2026-11-06T10:00:00.000Z")
		const ended = new Date("2026-11-06T10:00:02.000Z")
		await testDb.insert(schema.pipelineRuns).values({
			runId: "run-cols-1",
			specSlug: STORY_RESPOND_SPEC_ID,
			specVersion: "1.0.0",
			sessionId,
			userId: admin.id,
			outcome: "ok",
			triggerSource: "schedule",
			triggerFamily: "routine",
			registrationKey: "every-n-turns→story-sweep",
			parentRunId: "run-cols-parent",
			depth: 1,
			seed: "s",
			startedAt: started,
			endedAt: ended,
			elapsedMs: 2000,
			receipt: { nodes: [] }
		})
		const { pipelinesRuns } = await import("./pipelines")
		const res: any = await pipelinesRuns.handler(
			socketFor(admin.id, true),
			{ sessionId },
			() => {}
		)
		expect(res.sessionId).toBe(sessionId)
		const row = res.runs.find((r: any) => r.runId === "run-cols-1")
		expect(row).toMatchObject({
			triggerFamily: "routine",
			registrationKey: "every-n-turns→story-sweep",
			triggerSource: "schedule",
			endedAt: ended.toISOString(),
			parentRunId: "run-cols-parent",
			depth: 1
		})
		expect("receipt" in row).toBe(false)
	}, 60_000)
})
