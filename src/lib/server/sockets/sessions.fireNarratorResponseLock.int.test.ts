/**
 * Round-12 audit fix (HIGH): fireNarratorResponseHandler was the only
 * generation-triggering handler (Regenerate/Extend/SwipeLeft/SwipeRight/
 * triggerGenerateMessage all already do) that didn't wrap its check-then-
 * generate sequence in withSessionGenerationLock — it read
 * `session.sessionMessages.some(isGenerating)` unlocked, then inserted a new
 * narrator message and called generateResponse. Two near-simultaneous
 * "Trigger Narrator" clicks, or a narrator trigger racing any other
 * generation trigger on the same session, could both pass the stale check and
 * run concurrent generations. Fixed by wrapping the entire handler body in
 * withSessionGenerationLock(params.sessionId, ...), mirroring
 * triggerGenerateMessageHandler's shape. This test proves the handler now
 * actually queues behind an already-held lock for the same session: the
 * narrator message insert doesn't happen until the lock is released.
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

// Isolates this test from needing a full sampling/prompt/context config
// fixture (resolveNarratorPromptConfig -> getUserConfigurations throws
// "Missing required configuration" against a bare test DB with none of
// those seeded) — irrelevant to what's under test here, which is purely
// whether the handler's insert is serialized behind the session lock.
vi.mock("$lib/server/utils/resolveNarratorPromptConfig", () => ({
	resolveNarratorPromptConfig: async () => null
}))

// The reply road is mocked: the pipeline owns its row since 09-B B4, so the
// handler inserts nothing itself — what it does behind the lock is START the
// run. The order in which that happens relative to the lock holder is the
// whole subject.
const started: any[] = []
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: async (args: any) => {
		started.push(args)
		return { ok: true }
	}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-narrator-lock-int-test-")
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

describe("sessions:fireNarratorResponse — generation lock (Round-12 audit fix, PGlite integration)", () => {
	test("waits for an in-flight withSessionGenerationLock holder on the same session before inserting the narrator message", async () => {
		const { fireNarratorResponseHandler } = await import("./sessions")
		const { withSessionGenerationLock } = await import(
			"$lib/server/utils/sessionGenerationLock"
		)

		const user = await makeUser("narrator-lock-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const order: string[] = []
		let releaseLock: () => void = () => {}
		const lockHeld = new Promise<void>((resolve) => {
			releaseLock = resolve
		})

		// Hold the session's trigger lock, simulating a concurrent Regenerate/
		// Continue/Swipe/triggerGenerateMessage already in flight for this
		// session.
		const lockHolder = withSessionGenerationLock(session.id, async () => {
			order.push("lock-holder-start")
			await lockHeld
			order.push("lock-holder-end")
		})

		// fireNarratorResponse must queue behind the held lock, not run
		// immediately.
		const firePromise = fireNarratorResponseHandler
			.handler(
				fakeSocket(user.id),
				{ sessionId: session.id } as any,
				noopEmit
			)
			.then((res) => {
				order.push("trigger-done")
				return res
			})

		// Give any unlocked/immediate execution path a chance to run — if the
		// fix regressed (lock not held), the run would already have started
		// by now.
		await new Promise((r) => setTimeout(r, 20))
		expect(started.filter((g) => g.sessionId === session.id).length).toBe(0) // still queued behind the lock

		releaseLock()
		await lockHolder
		await firePromise

		expect(order).toEqual([
			"lock-holder-start",
			"lock-holder-end",
			"trigger-done"
		])

		// The run started after the lock freed — as narration, which is the
		// spec whose placeholder outlet writes the row.
		const mine = started.filter((g) => g.sessionId === session.id)
		expect(mine.length).toBe(1)
		expect(mine[0].turn.kind).toBe("narrate")
	})

	test("a second fire on the same session sees 'already generating' once the first has inserted its message", async () => {
		const { fireNarratorResponseHandler } = await import("./sessions")

		const user = await makeUser("narrator-lock-guard-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		// Simulates the first trigger's insert having already landed (the
		// lock serializes the two calls, so by the time the second one runs
		// the isGenerating row from the first is already committed).
		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "assistant",
			isNarratorResponse: true,
			isGenerating: true,
			content: ""
		})

		const res: any = await fireNarratorResponseHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id } as any,
			noopEmit
		)

		expect(res.error).toMatch(/already generating/i)
		const rows = await testDb.query.sessionMessages.findMany({
			where: eq(schema.sessionMessages.sessionId, session.id)
		})
		expect(rows.length).toBe(1) // no second message
		expect(started.some((g) => g.sessionId === session.id)).toBe(false)
	})
})
