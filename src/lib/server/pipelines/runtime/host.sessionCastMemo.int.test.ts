/**
 * The `session_cast` read's per-run memo (perf-1 w2): once per host, a hit is
 * a copy, nothing is served while a call, commit or `castWrite` is in flight
 * or after one, a failed read is not remembered, and a new host (the next
 * run) never sees an older one's answer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))
// A call the test controls: `__test: "message"` writes a reply row,
// `__test: "hold"` waits for `gate`; anything else is the real `hostCall`.
let gate: Promise<void> = Promise.resolve()
vi.mock("$lib/server/pipelines/runtime/host.call", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/host.call")
		>()
	return {
		...real,
		hostCall: async (args: any, payload: any, ...rest: any[]) => {
			if (payload?.__test === "message") {
				await args.db.insert(schema.sessionMessages).values({
					sessionId: args.scope.sessionId,
					role: "assistant",
					channel: "main",
					content: "a reply",
					isGenerating: false
				})
				return { ok: true }
			}
			if (payload?.__test === "hold") {
				await gate
				return { ok: true }
			}
			return (real.hostCall as any)(args, payload, ...rest)
		}
	}
})
vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("$lib/server/pipelines/entities/sessionGenres")
			>()
		return {
			...real,
			// The cast read's `replyCount` is present only for a genre that
			// declares an author's note: this one does.
			genreFieldsFor: async (db: any, id: number) => ({
				...(await real.genreFieldsFor(db, id)),
				authorsNote: { interval: 1 }
			}),
			getSessionGenre: async (db: any, id: string) => {
				return id === "test:genre/seats-on"
					? {
							genreId: id,
							name: "Seats on",
							shape: { writes: { seats: true } }
						}
					: real.getSessionGenre(db, id)
			}
		}
	}
)

const castNode = {
	key: "read",
	definitionId: "core:query/session-cast@1"
} as never
const BENCH = {
	key: "bench",
	definitionId: "core:outlet/set-seat-bench",
	definitionVersion: 1
} as never
const stubIo = { to: () => ({ emit() {} }), emit() {} } as never

let userId: number
let characterId: number
let personaId: number
let sessionId: number
let seatId: number
let statsSessionId: number
let statsSeatId: number
let n = 0
const HP = "core:slot/hp@1"
const STATS = "test:genre/memo-stats"
const ADVANCE = {
	key: "advance",
	definitionId: "core:outlet/advance-story-clock",
	definitionVersion: 1
} as never
const RUN_TOOL = {
	key: "tool",
	definitionId: "core:oracle/run-tool",
	definitionVersion: 1
} as never

const makeHost = async (forSession?: number) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(
		db as never,
		{
			sessionId: forSession ?? sessionId,
			userId,
			runId: `memo-run-${++n}`,
			io: stubIo
		} as never
	)
}
const readOn = async (
	host: Awaited<ReturnType<typeof makeHost>>,
	forSession = sessionId
) =>
	(await host.read!(
		"session_cast",
		{ sessionId: forSession },
		castNode
	)) as any

const client = () =>
	(
		db as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client

/** Statements issued while `fn` runs. */
async function counting<T>(fn: () => Promise<T>) {
	const c = client()
	const original = c.query
	let statements = 0
	c.query = (...args: unknown[]) => {
		statements++
		return original.apply(c, args)
	}
	try {
		const value = await fn()
		return { value, statements }
	} finally {
		c.query = original
	}
}

const seatRow = (read: any) =>
	(read.sessionCharacters as any[]).find((r) => r.seatId === seatId)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-cast-memo-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "memo-owner")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character!.id
	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Bram",
			description: "",
			isPersona: true,
			aliases: []
		} as never)
		.returning()
	personaId = persona!.id
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Book" } as never)
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: "memo",
			genreId: "test:genre/seats-on",
			lorebookId: book!.id,
			genreFields: { authorsNote: { interval: 1 } },
			storyClockYear: 10,
			storyClockMonth: 4,
			storyClockDay: 1
		} as never)
		.returning()
	sessionId = session!.id
	const [seat] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, isActive: true })
		.returning()
	seatId = seat!.id
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId, userId, isActive: true } as never)
	// A session that tracks `hp`, for the state writes.
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	genreKeeping(STATS, {
		name: { en: "Memo stats" },
		family: "test",
		slots: [hp],
		events: {}
	})
	const [statsSession] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: "memo-stats",
			genreId: STATS,
			lorebookId: book!.id
		} as never)
		.returning()
	statsSessionId = statsSession!.id
	const [statsSeat] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: statsSessionId, characterId, isActive: true })
		.returning()
	statsSeatId = statsSeat!.id
	// Her own line, which a change to her anchors to.
	const [line] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: statsSessionId,
			role: "assistant",
			characterId,
			content: "…"
		})
		.returning()
	await db.insert(schema.messages).values({
		id: line!.id,
		sessionId: statsSessionId,
		characterId,
		role: "assistant"
	} as never)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("session_cast per-run memo", () => {
	it("one host, two reads: the second issues no statements and is equal", async () => {
		const host = await makeHost()
		const first = await readOn(host)
		const second = await counting(() => readOn(host))
		expect(second.statements).toBe(0)
		expect(second.value).toStrictEqual(first)
	})

	it("structuredClone keeps the value (character seat, player seat, lorebook)", async () => {
		const first = await readOn(await makeHost())
		expect((first.sessionCharacters as any[]).length).toBeGreaterThan(0)
		expect(structuredClone(first)).toStrictEqual(first)
	})

	it("mutating one read's result does not show in the next", async () => {
		const host = await makeHost()
		const first = await readOn(host)
		const before = structuredClone(first)
		first.sessionCharacters.push({ seatId: -1 })
		seatRow(first).character.name = "Mutated"
		const second = await readOn(host)
		expect(second).toStrictEqual(before)
		expect(seatRow(second).character.name).toBe("Alice")
	})

	it("a commit in the same run is seen by the next read", async () => {
		const host = await makeHost()
		expect(seatRow(await readOn(host)).enabled).toBe(true)
		const out = (await host.commit!(
			{ seat: `character:${characterId}`, benched: true },
			BENCH
		)) as Record<string, unknown>
		expect(out).toMatchObject({ written: true })
		expect(seatRow(await readOn(host)).enabled).toBe(false)
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: true })
			.where(eq(schema.sessionCharacters.id, seatId))
	})

	it("a change between runs is seen by a new host", async () => {
		const first = await readOn(await makeHost())
		expect(seatRow(first).enabled).toBe(true)
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, seatId))
		try {
			expect(seatRow(await readOn(await makeHost())).enabled).toBe(false)
		} finally {
			await db
				.update(schema.sessionCharacters)
				.set({ isActive: true })
				.where(eq(schema.sessionCharacters.id, seatId))
		}
	})

	it("a rejected read is not remembered", async () => {
		const host = await makeHost()
		const c = client()
		const original = c.query
		let failed = false
		c.query = (...args: unknown[]) => {
			if (!failed) {
				failed = true
				return Promise.reject(new Error("boom"))
			}
			return original.apply(c, args)
		}
		try {
			await expect(readOn(host)).rejects.toBeDefined()
		} finally {
			c.query = original
		}
		const again = await readOn(host)
		expect(seatRow(again).enabled).toBe(true)
	})

	it("a read is as the database holds it after every kind of write", async () => {
		// Each case warms the memo, writes through one door, then reads: the
		// read must go to the database and equal a fresh host's.
		const check = async (
			host: Awaited<ReturnType<typeof makeHost>>,
			forSession: number,
			write: () => Promise<unknown>
		) => {
			await readOn(host, forSession)
			expect(
				(await counting(() => readOn(host, forSession))).statements
			).toBe(0)
			await write()
			const after = await counting(() => readOn(host, forSession))
			expect(after.statements).toBeGreaterThan(0)
			expect(after.value).toStrictEqual(
				await readOn(await makeHost(forSession), forSession)
			)
			return after.value
		}

		// `advance-story-clock` commit
		const clockHost = await makeHost()
		const clockBefore = (await readOn(clockHost)).storyTime.now
		const afterClock = await check(clockHost, sessionId, () =>
			clockHost.commit!({ by: 1, unit: "days", cause: "action" }, ADVANCE)
		)
		expect(afterClock.storyTime.now).not.toStrictEqual(clockBefore)

		// a call that writes a reply: `replyCount` moves
		const callHost = await makeHost()
		const countBefore = (await readOn(callHost)).replyCount
		const afterCall = await check(callHost, sessionId, () =>
			callHost.call!({ __test: "message" }, castNode, {} as never)
		)
		expect(afterCall.replyCount).toBe(countBefore + 1)

		// the apply-state-changes write, through `bindings.state.ts`
		const stateHost = await makeHost(statsSessionId)
		const { stateBindings } = await import(
			"$lib/server/pipelines/runtime/bindings.state"
		)
		const setState = stateBindings({ runId: "memo-state" })[
			"core:task/set-state@1"
		]!
		await check(stateHost, statsSessionId, async () => {
			const out: any = await setState(
				{
					scope: { sessionId: statsSessionId },
					params: { mode: "apply" },
					changes: [
						{
							owner: { kind: "session_cast", id: characterId },
							slotId: HP,
							value: 14
						}
					]
				} as never,
				{ read: stateHost.read } as never
			)
			expect(out.value, JSON.stringify(out.value)).toMatchObject({
				applied: [expect.any(Number)]
			})
		})

		// the tool `propose` door, inside a call
		const doorHost = await makeHost(statsSessionId)
		await check(doorHost, statsSessionId, async () => {
			const out: any = await doorHost.call!(
				{
					tool: "set_state",
					args: { owner: "Alice", slot: "hp", value: 9 }
				},
				RUN_TOOL,
				{} as never
			)
			expect(out.error).toBeUndefined()
			expect(out.result.status).toBe("proposed")
		})
	})

	it("a read started while a call is in flight is not memoised", async () => {
		const host = await makeHost()
		await readOn(host)
		let release!: () => void
		gate = new Promise<void>((r) => (release = r))
		const held = host.call!({ __test: "hold" }, castNode, {} as never)
		try {
			const first = await counting(() => readOn(host))
			const second = await counting(() => readOn(host))
			expect(first.statements).toBeGreaterThan(0)
			expect(second.statements).toBeGreaterThan(0)
		} finally {
			release()
			await held
		}
		expect((await counting(() => readOn(host))).statements).toBeGreaterThan(
			0
		)
		expect((await counting(() => readOn(host))).statements).toBe(0)
	})

	it("a read inside a write made outside call and commit goes to the database", async () => {
		const { castWrite } = await import(
			"$lib/server/pipelines/runtime/sessionCastWrites"
		)
		const host = await makeHost()
		await readOn(host)
		await castWrite(async () => {
			expect(
				(await counting(() => readOn(host))).statements
			).toBeGreaterThan(0)
		})
		expect((await counting(() => readOn(host))).statements).toBeGreaterThan(
			0
		)
		expect((await counting(() => readOn(host))).statements).toBe(0)
	})
})
