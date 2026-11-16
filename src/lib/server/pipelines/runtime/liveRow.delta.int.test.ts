/**
 * A run's frames go out as `sessionMessageDelta` once the run's recipients are
 * known; the first frame, a frame after a failed lookup and every settled row
 * go out as the full `sessionMessage`.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"

const mocks = vi.hoisted(() => ({
	broadcastToSessionUsers: vi.fn(async (..._args: any[]): Promise<void> => {})
}))

vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => mocks)
// The error row is written through the global db (`persistGenerationErrorRow`),
// so the test's db IS the global one.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/sessions/rowPush", () => ({
	broadcastSessionRow: () => {}
}))

import { createLiveRow } from "./liveRow"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const user = await createTestUser(db, "live-row-delta")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session!.id
})

beforeEach(() => {
	mocks.broadcastToSessionUsers.mockReset()
	// Like the helper: the first broadcast with a memo fills it.
	mocks.broadcastToSessionUsers.mockImplementation(async (...args: any[]) => {
		const memo = args[4]?.recipients
		if (memo && memo.value === null) memo.value = [1]
	})
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const calls = () => mocks.broadcastToSessionUsers.mock.calls as any[][]

async function start() {
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
	return { row, live, stream }
}

async function frame(stream: { onChunk: (c: string) => void }, text: string) {
	await wait(140)
	stream.onChunk(text)
	await wait(100)
}

describe("the live row's frames", () => {
	it("first frame is the full row with the memo; later frames are deltas on the same memo", async () => {
		const { row, stream } = await start()
		for (let i = 0; i < 4; i++) await frame(stream, `w${i} `)
		const frames = calls()
		expect(frames.length).toBeGreaterThanOrEqual(4)
		expect(frames[0]![2]).toBe("sessionMessage")
		const memo = frames[0]![4].recipients
		frames.slice(1).forEach((c, i) => {
			expect(c[2]).toBe("sessionMessageDelta")
			expect(c[4].recipients).toBe(memo)
			expect(Object.keys(c[3]).sort()).toEqual([
				"content",
				"id",
				"reasoning",
				"sessionId"
			])
			expect(c[3].sessionId).toBe(sessionId)
			expect(c[3].id).toBe(row.id)
			expect(c[3].content).toBe(
				Array.from({ length: i + 2 }, (_, k) => `w${k}`).join(" ")
			)
		})
	})

	it("a cleared memo sends the next frame as a full row again", async () => {
		const { stream } = await start()
		await frame(stream, "a ")
		await frame(stream, "b ")
		expect(calls().map((c) => c[2])).toEqual([
			"sessionMessage",
			"sessionMessageDelta"
		])
		calls()[0]![4].recipients.value = null
		await frame(stream, "c ")
		expect(calls()[2]![2]).toBe("sessionMessage")
		expect(calls()[2]![3].sessionMessage.content).toBe("a b c")
	})

	it("carries the reasoning the frame wrote, and null when it wrote none", async () => {
		const row2 = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "",
			isGenerating: true,
			metadata: {}
		})
		const reasoning = createLiveRow({
			db: db as any,
			sessionId,
			io: {} as any,
			streamingNodes: new Set(["generate"])
		})
		reasoning.opened(row2)
		const s = reasoning.attach(row2.id, "generate", {})!
		mocks.broadcastToSessionUsers.mockClear()
		s.onReasoning("Think")
		await wait(300)
		s.onChunk("Sure.")
		await wait(300)
		s.onReasoning("ing")
		await wait(300)
		const deltas = calls().filter((c) => c[2] === "sessionMessageDelta")
		expect(deltas.length).toBeGreaterThanOrEqual(1)
		expect(deltas.every((c) => typeof c[3].reasoning === "string")).toBe(
			true
		)
		expect(deltas[0]![3].reasoning).toContain("Think")

		// a run with no reasoning at all
		const plain = await start()
		mocks.broadcastToSessionUsers.mockClear()
		await frame(plain.stream, "a ")
		await frame(plain.stream, "b ")
		const d = calls().find((c) => c[2] === "sessionMessageDelta")!
		expect(d[3].reasoning).toBeNull()
	})

	it("flush then cancel: exactly one sessionMessage after the frames, the released row, no memo", async () => {
		const { stream, live } = await start()
		await frame(stream, "a ")
		await frame(stream, "b ")
		stream.onChunk("c ")
		await live.flush()
		const before = calls().length
		await live.finish({ kind: "cancelled" } as any)
		const after = calls().slice(before)
		expect(after.map((c) => c[2])).toEqual(["sessionMessage"])
		expect(after[0]![3].sessionMessage.isGenerating).toBe(false)
		expect(after[0]![4]).toBeUndefined()
		// the flushed frame was a delta
		expect(calls()[before - 1]![2]).toBe("sessionMessageDelta")
	})

	it("the error path still emits a full sessionMessage row", async () => {
		const { stream, live } = await start()
		await frame(stream, "a ")
		const before = calls().length
		live.failedWith(new Error("boom"))
		await live.finish({ kind: "err", reason: "boom" } as any)
		const after = calls().slice(before)
		expect(after.length).toBeGreaterThanOrEqual(1)
		const last = after[after.length - 1]!
		expect(last[2]).toBe("sessionMessage")
		expect(last[3].sessionMessage.isGenerating).toBe(false)
	})

	it("a delta cannot be built without its scope (type level)", () => {
		// @ts-expect-error `sessionId` is required
		const missing: Sockets.SessionMessageDelta.Response = {
			id: 1,
			content: "",
			reasoning: null
		}
		expect(missing.id).toBe(1)
	})
})
