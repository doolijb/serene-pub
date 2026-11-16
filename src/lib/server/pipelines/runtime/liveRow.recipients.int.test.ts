/**
 * Who a run's frames reach is read once per run; the row the release settles
 * asks the live roster again (a guest added mid-reply sees the settled row).
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"

const mocks = vi.hoisted(() => ({
	broadcastToSessionUsers: vi.fn(async () => {})
}))

vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => mocks)
vi.mock("$lib/server/sessions/rowPush", () => ({
	broadcastSessionRow: () => {}
}))

import { createLiveRow } from "./liveRow"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "live-row-recipients")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session!.id
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("the live row's recipients", () => {
	it("are read once for the run's frames, and fresh for the released row", async () => {
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
		const stream = live.attach(row.id, "generate", {})!
		for (let i = 0; i < 4; i++) {
			await wait(140)
			stream.onChunk(`w${i} `)
			await wait(100)
		}
		// Every frame hands the helper the SAME memo object, so the roster and
		// lane reads happen once for the run (the helper fills it on first use).
		const frames = mocks.broadcastToSessionUsers.mock.calls as any[][]
		expect(frames.length).toBeGreaterThanOrEqual(4)
		const memo = frames[0]![4]?.recipients
		expect(memo).toEqual({ value: null })
		for (const call of frames) expect(call[4]?.recipients).toBe(memo)

		await live.finish({ kind: "cancelled" } as any)
		const after = mocks.broadcastToSessionUsers.mock.calls as any[][]
		const released = after[after.length - 1]!
		expect(released[3].sessionMessage.isGenerating).toBe(false)
		// The released row asks the live roster: no memo.
		expect(released[4]).toBeUndefined()
	})
})
