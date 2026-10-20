/**
 * An envoy's line in the asker's own channel lane (owner ruling 2026-10-15):
 * a player may swipe/retry the Planner's reply in their private Planner lane
 * (`parley:n`, by the genre's `dungeon-crawler-lanes` annex map), and only
 * there — the owner's lane and the Story (`main`) stay the owner's.
 * `messages/permissions.ts` `canActOnMessage(…, "rerun")`.
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
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-lane-envoy-swipe-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}

describe("rerun an envoy's line in one's own channel lane (PGlite integration)", () => {
	test("guest swipes the Planner in their lane; not in the owner's lane, not the Story's narrator", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { sessionMessagesSwipeLeftHandler, sessionMessagesDeleteHandler } = await import("./sessions")
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		const owner = await createTestUser(testDb, "lane-envoy-owner")
		const guest = await createTestUser(testDb, "lane-envoy-guest")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: true,
				genreId: "core:genre/dungeon-crawler",
				annex: {
					core: {
						"dungeon-crawler-lanes": {
							[`user:${owner.id}`]: "parley",
							[`user:${guest.id}`]: "parley:2"
						}
					}
				}
			} as any)
			.returning()
		await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id })

		const row = async (channel: string, extra: Record<string, unknown>) =>
			(
				await testDb
					.insert(schema.sessionMessages)
					.values({
						sessionId: session.id,
						role: "assistant",
						channel,
						content: "b",
						...extra,
						metadata: {
							...((extra.metadata as object) ?? {}),
							swipes: { currentIdx: 1, history: ["a", "b"] }
						}
					} as any)
					.returning()
			)[0]
		const planner = { metadata: { speaker: "envoy:planner" } }
		const guestLane = await row("parley:2", planner)
		const ownerLane = await row("parley", planner)
		const story = await row("main", { isNarratorResponse: true })

		const swipe = (id: number) =>
			sessionMessagesSwipeLeftHandler.handler(fakeSocket(guest.id), { id } as any, () => {})

		const allowed = await swipe(guestLane.id)
		expect(allowed.error).toBeUndefined()
		expect(allowed.sessionMessage?.content).toBe("a")

		expect((await swipe(ownerLane.id)).error).toMatch(/permission/i)
		expect((await swipe(story.id)).error).toMatch(/permission/i)

		// Change verbs stay the owner's, even in the guest's own lane.
		expect(await canActOnMessage(testDb as any, guestLane.id, guest.id)).toBe(false)
		expect(await canActOnMessage(testDb as any, guestLane.id, guest.id, "rerun")).toBe(true)
		const del = await sessionMessagesDeleteHandler.handler(
			fakeSocket(guest.id),
			{ id: guestLane.id } as any,
			() => {}
		)
		expect(del.error).toBeTruthy()
	}, 60_000)
})
