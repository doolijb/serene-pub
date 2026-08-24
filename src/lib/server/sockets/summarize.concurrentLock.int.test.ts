/**
 * Round-10 audit fix (MEDIUM): sessionsSummarizeHandler ran unguarded, unlike
 * every other LLM-triggering handler in sessions.ts (regenerate/continue/
 * swipeRight, all wrapped in withSessionTriggerLock) — concurrent
 * sessions:summarize requests for the same session (double-click, multiple tabs)
 * each independently ran the full batch+synthesis LLM pipeline, multiplying
 * cost/latency. Fixed by rejecting a second concurrent request outright rather
 * than queuing it to run right after the first.
 *
 * The guard has since moved from a per-session `inFlightSummarizeSessionIds` set into
 * activityStore.startSessionSummarize, keyed per session AND lore type — a world-lore
 * run should no longer block a character-lore one. The rejection itself is
 * deliberately kept: superseding would silently kill a run another tab is
 * watching, and once a run reaches `review` its result is unsaved work.
 *
 * Two contract changes came with that move:
 *  - pipeline failures now emit `sessions:summarize:error` and resolve null
 *    (matching scenes:process) instead of rejecting, so the client's socket
 *    listener sees them rather than the generic handler;
 *  - the guard is cleared by the activity reaching a terminal state, not by a
 *    `finally`, so the leak check below asserts that instead.
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
		path.join(os.tmpdir(), "serene-pub-summarize-lock-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUserWithLorebookSession(username: string) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Test Lorebook", userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ isGroup: false, userId: user.id, lorebookId: lorebook.id })
		.returning()
	return { user, session }
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: false } } as any
}

const noopEmit = () => {}

function summarizeParams(sessionId: number, loreType = "world"): any {
	return {
		sessionId,
		messageIds: "all",
		loreType
	}
}

/** Collects emitted socket events so error-path assertions can read them. */
function capturingEmit() {
	const events: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		events.push({ event, data })
	}
	return { emit, events }
}

describe("sessions:summarize — concurrent-request guard", () => {
	test("a second concurrent call for the same session and lore type is rejected outright, not queued", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const { user, session } = await makeUserWithLorebookSession(
			"summarize-lock-concurrent-user"
		)
		const { emit } = capturingEmit()

		const results = await Promise.allSettled([
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(session.id),
				emit
			),
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(session.id),
				emit
			)
		])

		// Exactly one must be rejected by the guard. The other reached the real
		// pipeline (proving it was never blocked from starting) and failed for
		// the unrelated "no messages" reason — which now resolves null after
		// emitting, rather than rejecting.
		const guardRejections = results.filter(
			(r) =>
				r.status === "rejected" &&
				/already running/i.test(String(r.reason?.message ?? r.reason))
		)
		expect(guardRejections.length).toBe(1)

		const reachedPipeline = results.filter((r) => r.status === "fulfilled")
		expect(reachedPipeline.length).toBe(1)
	})

	test("a different lore type on the same session is NOT blocked", async () => {
		// The whole point of moving the guard off a bare sessionId: summarizing
		// world lore should not lock the user out of character lore.
		const { sessionsSummarizeHandler } = await import("./summarize")
		const { user, session } = await makeUserWithLorebookSession(
			"summarize-lock-per-type-user"
		)
		const { emit } = capturingEmit()

		const results = await Promise.allSettled([
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(session.id, "world"),
				emit
			),
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(session.id, "character"),
				emit
			)
		])

		const guardRejections = results.filter(
			(r) =>
				r.status === "rejected" &&
				/already running|waiting to be saved/i.test(
					String(r.reason?.message ?? r.reason)
				)
		)
		expect(guardRejections.length).toBe(0)
	})

	test("a sequential call after the first fails is not blocked by a stale guard entry", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const { user, session } = await makeUserWithLorebookSession(
			"summarize-lock-sequential-user"
		)
		const first = capturingEmit()

		// Resolves null after emitting the error — the pipeline path.
		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(session.id),
				first.emit
			)
		).resolves.toBeNull()
		expect(
			first.events.some(
				(e) =>
					e.event === "sessions:summarize:error" &&
					/no messages found/i.test(e.data?.error ?? "")
			)
		).toBe(true)

		// The failed run left its activity in `error`, which the next call must
		// supersede. If the guard leaked, this would reject with "already
		// running" and lock the session out of summarization permanently.
		const second = capturingEmit()
		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				summarizeParams(session.id),
				second.emit
			)
		).resolves.toBeNull()
		expect(
			second.events.some(
				(e) =>
					e.event === "sessions:summarize:error" &&
					/no messages found/i.test(e.data?.error ?? "")
			)
		).toBe(true)
	})
})
