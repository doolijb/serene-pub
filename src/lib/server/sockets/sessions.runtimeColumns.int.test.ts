/**
 * Core's runtime columns never reach a client (`sessions.turn_order`,
 * `turn_tally`, `lane_reads`, `ruleset_decks`): `sessions:list` and
 * `sessions:get` both leave them out of the session row, whoever asks. Read
 * marks are every member's, and a deck's state lets a player work out the
 * next card.
 *
 * Pinned: all four columns written on a session, neither payload carries any
 * of the four keys anywhere, and the session's own fields still arrive.
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-sessions-runtime-columns-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const RUNTIME_KEYS = ["turnOrder", "turnTally", "laneReads", "rulesetDecks"]

/** Every key at every depth of a payload. */
function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(value)) for (const v of value) keysDeep(v, out)
	else if (value && typeof value === "object")
		for (const [k, v] of Object.entries(value)) {
			out.add(k)
			keysDeep(v, out)
		}
	return out
}

describe("sessions:list and sessions:get carry no runtime column", () => {
	test("all four columns written: neither payload has any of them, and the session's own fields arrive", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "runtime-columns-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: "Runtime columns",
				turnOrder: { v: 1, order: [{ ref: "user:1", via: "strategy" }] },
				turnTally: { v: 1, lanes: {} },
				laneReads: { "1": { main: 4 } },
				rulesetDecks: { cards: { scene: null, shuffle: 0, drawn: 2 } }
			} as never)
			.returning()
		// The columns are really stored (the test would pass vacuously otherwise).
		expect(session!.turnOrder).toBeTruthy()
		expect(session!.turnTally).toBeTruthy()
		expect(session!.laneReads).toBeTruthy()
		expect(session!.rulesetDecks).toBeTruthy()

		const { sessionsListHandler, sessionsGetHandler } = await import("./sessions")
		const emitted: unknown[] = []
		const emit = ((_event: string, data: unknown) => {
			emitted.push(data)
		}) as any

		const list = await sessionsListHandler.handler(fakeSocket(owner.id), {}, emit)
		const row = list!.sessionList.find((s) => s.id === session!.id)!
		expect(row.name).toBe("Runtime columns")
		for (const k of RUNTIME_KEYS) expect(k in row).toBe(false)

		const got = await sessionsGetHandler.handler(
			fakeSocket(owner.id),
			{ id: session!.id } as any,
			emit
		)
		expect((got as any).session.name).toBe("Runtime columns")
		expect((got as any).session.id).toBe(session!.id)

		// Whole payloads, every depth, returned and emitted.
		for (const payload of [list, got, ...emitted]) {
			const keys = keysDeep(JSON.parse(JSON.stringify(payload)))
			for (const k of RUNTIME_KEYS) expect(keys.has(k), k).toBe(false)
		}
	}, 60_000)

	test("a query node's `sessions` read (plugin-facing) carries none of them either", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "runtime-columns-host-read")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: "Runtime columns, host read",
				turnOrder: { v: 1, order: [] },
				turnTally: { v: 1, lanes: {} },
				laneReads: { "1": { main: 4 } },
				rulesetDecks: { cards: { scene: null, shuffle: 0, drawn: 2 } }
			} as never)
			.returning()
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = await createHost(
			testDb as never,
			{
				sessionId: session!.id,
				userId: owner.id,
				specId: "acme:spec/reader",
				runId: "run-runtime-columns-host-read"
			} as any
		)
		const rows = (await host.read!(
			"sessions" as any,
			{},
			{ key: "reader", definitionId: "acme:query/reader@1" } as any
		)) as Record<string, unknown>[]
		expect(rows).toHaveLength(1)
		expect(rows[0]!.name).toBe("Runtime columns, host read")
		for (const k of RUNTIME_KEYS) expect(k in rows[0]!, k).toBe(false)
	}, 60_000)
})
