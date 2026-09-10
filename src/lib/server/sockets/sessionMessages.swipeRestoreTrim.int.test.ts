/**
 * Swipe-history whitespace (2026-09-08 follow-up): `store.ts`'s
 * `trimCommittedContent` trims edge whitespace off every **committed**
 * `content` write (ruling 2026-09-08), but `metadata.swipes.history` entries
 * are written verbatim — untouched by that ruling on purpose (see the
 * `trimCommittedContent` doc comment). A history entry written before the
 * ruling (or by any future path that doesn't trim before pushing to
 * `history`) can carry edge whitespace, and swiping back to it copies that
 * whitespace straight into `content`.
 *
 * Both swipeLeft and swipeRight's pure-navigation branch (restoring an
 * already-generated history entry, as opposed to starting a new generation)
 * set `data.content` from `metadata.swipes.history[idx]` and then write the
 * whole row through `updateLegacyWhere`, which runs every patch through
 * `trimCommittedContent` before it lands. That function only skips a write
 * when `isGenerating === true` (the mid-stream-frame exemption) — and both
 * restore branches are only reachable with `isGenerating` false: swipeLeft
 * checks it explicitly before acquiring the lock, and swipeRight's
 * not-last-swipe branch never sets `isGenerating`, so it carries forward the
 * `false` already required to have a completed entry to navigate back to.
 * So the existing trim-on-write already covers this path with no change to
 * the restore code itself — this test is the proof.
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
		path.join(os.tmpdir(), "serene-pub-swipe-restore-trim-int-test-")
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

describe("swipe restore — padded history entries land trimmed (PGlite integration)", () => {
	test("swipeLeft restores a padded history entry trimmed", async () => {
		const { sessionMessagesSwipeLeftHandler } = await import("./sessions")

		const user = await makeUser("swipe-restore-trim-left-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				isNarratorResponse: true,
				content: "b",
				metadata: {
					swipes: {
						currentIdx: 1,
						// Pre-ruling entry: written verbatim, edge whitespace intact.
						history: ["  padded a  ", "b"]
					}
				}
			})
			.returning()

		const res = await sessionMessagesSwipeLeftHandler.handler(
			fakeSocket(user.id),
			{ id: message.id } as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.sessionMessage?.content).toBe("padded a")

		const after = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, message.id)
		})
		expect(after?.content).toBe("padded a")
	}, 60_000)

	test("swipeRight restores a padded history entry trimmed", async () => {
		const { sessionMessagesSwipeRightHandler } = await import("./sessions")

		const user = await makeUser("swipe-restore-trim-right-user")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				isNarratorResponse: true,
				content: "a",
				metadata: {
					swipes: {
						currentIdx: 0,
						// Pre-ruling entry: written verbatim, edge whitespace intact.
						history: ["a", "  padded b  "]
					}
				}
			})
			.returning()

		const res = await sessionMessagesSwipeRightHandler.handler(
			fakeSocket(user.id),
			{ id: message.id } as any,
			noopEmit
		)

		expect(res.error).toBeUndefined()
		expect(res.sessionMessage?.content).toBe("padded b")

		const after = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, message.id)
		})
		expect(after?.content).toBe("padded b")
	}, 60_000)
})
