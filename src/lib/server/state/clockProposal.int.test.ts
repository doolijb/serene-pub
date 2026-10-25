/**
 * 🚧 Clock proposals (live scenes §6, ★3; lane F, 2026-10-13): the keeper's
 * clock move resolved, held, listed, described, decided and taken back — and
 * an accepted one is a time action for the boundary watcher.
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

// The watcher's own rules are its tests'; here only that an accept notes one.
const noted: number[] = []
vi.mock("$lib/server/scenes/boundaryWatcher", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/scenes/boundaryWatcher")>()
	return {
		...real,
		noteTimeAction: vi.fn(async (_db: unknown, p: { sessionId: number }) => {
			noted.push(p.sessionId)
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-clock-proposal-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

/** A session reading a free-form book, its clock at Year 412, month 3, day 5, 09:00 unless `clock` is false. */
async function world(opts: { clock?: boolean; book?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `clock-proposal-${suffix}`)
	const stranger = await createTestUser(testDb, `clock-stranger-${suffix}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: opts.book === false ? null : lorebook.id,
			...(opts.clock === false
				? {}
				: {
						storyClockYear: 412,
						storyClockMonth: 3,
						storyClockDay: 5,
						storyClockHour: 9,
						storyClockMinute: 0
					})
		})
		.returning()
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session.id, role: "assistant", content: "They walk all night." })
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy.id, sessionId: session.id, role: "assistant" })
	return { user, stranger, session, message: legacy }
}

const binding = async (id: string) => {
	const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
	return stateBindings({ runId: "run-clock" })[id]!
}
const resolveWith = async (sessionId: number, clock: unknown) =>
	((await (await binding("core:query/resolve-state-changes@1"))(
		{ scope: { sessionId }, changes: [], clock },
		{ read: async () => [] } as any
	)) as any).value

const clockOfSession = async (sessionId: number) =>
	(
		await testDb
			.select({
				day: schema.sessions.storyClockDay,
				hour: schema.sessions.storyClockHour,
				minute: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

describe("resolve-state-changes@1 — the clock port", () => {
	test("the keeper's first clock entry rides `changes` as a clock line and `clock` as the step", async () => {
		const w = await world()
		const out = await resolveWith(w.session.id, { values: [], inventory: [], clock: [{ by: 3, unit: "hours" }] })
		expect(out.changes).toEqual([{ kind: "clock", by: 3, unit: "hours" }])
		expect(out.clock).toEqual({ by: 3, unit: "hours" })
		expect(out.refused).toEqual([])
		// A bare step reads the same.
		expect((await resolveWith(w.session.id, { by: 2, unit: "days" })).clock).toEqual({ by: 2, unit: "days" })
	}, 60_000)

	test("the ordinary turn — an empty list, or a step of nothing — is no move and no sentence", async () => {
		const w = await world()
		for (const answer of [{ values: [], inventory: [], clock: [] }, { clock: [{ by: 0, unit: "hours" }] }, undefined]) {
			const out = await resolveWith(w.session.id, answer)
			expect(out.changes).toEqual([])
			expect(out.clock).toBeNull()
			expect(out.refused).toEqual([])
		}
	}, 60_000)

	test("backwards, out of bounds or an unknown unit is a sentence, never a line; a clock with nowhere to start is a skipped line (§15 G16)", async () => {
		const w = await world()
		const back = await resolveWith(w.session.id, { clock: [{ by: -2, unit: "hours" }] })
		expect(back.changes).toEqual([])
		expect(back.refused[0]).toMatch(/only moves forward/)
		expect((await resolveWith(w.session.id, { clock: [{ by: 99_999, unit: "years" }] })).refused[0]).toMatch(
			/at most/
		)
		expect((await resolveWith(w.session.id, { clock: [{ by: 2, unit: "fortnights" }] })).refused[0]).toMatch(
			/counts in/
		)
		const { NO_STORY_CLOCK_YET } = await import("./clockMoves")
		const unset = await world({ clock: false })
		const nowhere = await resolveWith(unset.session.id, { clock: [{ by: 2, unit: "hours" }] })
		// 🚧 §15 G16: well-formed, so it rides `changes` marked skipped — for
		// set-state to write to the ledger — and never `clock`: nothing moves.
		expect(nowhere.changes).toEqual([{ kind: "clock", by: 2, unit: "hours", skipped: NO_STORY_CLOCK_YET }])
		expect(nowhere.clock).toBeNull()
		expect(nowhere.refused[0]).toMatch(/no present to start from/)
		const bookless = await world({ book: false, clock: false })
		const noBook = await resolveWith(bookless.session.id, { clock: [{ by: 2, unit: "hours" }] })
		// 🚧 pr-6 (§B-3a): no shared book is the session's own book, clock unset.
		expect(noBook.refused[0]).toMatch(/no present to start from/)
		expect(noBook.changes).toEqual([{ kind: "clock", by: 2, unit: "hours", skipped: NO_STORY_CLOCK_YET }])
		// A malformed ask is the keeper's mistake: a sentence, and no line at all.
		expect(back.clock).toBeNull()
	}, 60_000)

	test("two entries: the first is taken, and the receipt says so", async () => {
		const w = await world()
		const out = await resolveWith(w.session.id, {
			clock: [
				{ by: 1, unit: "hours" },
				{ by: 5, unit: "days" }
			]
		})
		expect(out.clock).toEqual({ by: 1, unit: "hours" })
		expect(out.refused).toEqual([expect.stringMatching(/only the first was taken/)])
	}, 60_000)
})

describe("set-state@1 — a clock line", () => {
	test("propose holds it as a clock proposal under the newest reply; the clock does not move", async () => {
		const w = await world()
		const out: any = (
			(await (await binding("core:task/set-state@1"))(
				{ scope: { sessionId: w.session.id }, changes: [{ kind: "clock", by: 3, unit: "hours" }] },
				{} as any
			)) as any
		).value
		expect(out.applied).toEqual([])
		expect(out.proposed).toHaveLength(1)
		const [row] = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, out.proposed[0]))
		expect(row).toMatchObject({
			kind: "clock",
			payload: { kind: "clock", by: 3, unit: "hours" },
			status: "pending",
			messageId: w.message.id,
			proposedBy: "run:run-clock"
		})
		expect((await clockOfSession(w.session.id)).hour).toBe(9)
	}, 60_000)

	test("apply passes it over — neither applied nor refused: Advance story clock is its writer", async () => {
		const w = await world()
		const out: any = (
			(await (await binding("core:task/set-state@1"))(
				{
					scope: { sessionId: w.session.id },
					params: { mode: "apply" },
					changes: [{ kind: "clock", by: 3, unit: "hours" }]
				},
				{} as any
			)) as any
		).value
		expect(out).toMatchObject({ applied: [], proposed: [], refused: [] })
		expect((await clockOfSession(w.session.id)).hour).toBe(9)
		expect(
			await testDb.select().from(schema.stateProposals).where(eq(schema.stateProposals.sessionId, w.session.id))
		).toEqual([])
	}, 60_000)

	test("🚧 a skipped line (§15 G16) is written to the ledger in either mode — the same skipped row Advance story clock writes — once per anchor", async () => {
		const { NO_STORY_CLOCK_YET, clockLedgerRows } = await import("./clockMoves")
		const { ledgerLines } = await import("$lib/shared/state/ledgerLines")
		const { stateMoved } = await import("./announce")
		const line = { kind: "clock", by: 2, unit: "hours", skipped: NO_STORY_CLOCK_YET }
		for (const mode of ["propose", "apply"] as const) {
			const w = await world({ clock: false })
			const setState = await binding("core:task/set-state@1")
			const run = async () =>
				((await setState(
					{ scope: { sessionId: w.session.id }, params: { mode }, changes: [line] },
					{} as any
				)) as any).value
			const out: any = await run()
			expect(out.applied).toEqual([])
			expect(out.proposed).toEqual([])
			expect(out.main.skipped).toHaveLength(1)
			// What the run's trigger reads to announce `state:changed`.
			expect(
				stateMoved({ nodes: [{ definitionId: "core:task/set-state", output: out.main }] } as any)
			).toBe(true)
			const rows = await testDb
				.select()
				.from(schema.stateProposals)
				.where(eq(schema.stateProposals.sessionId, w.session.id))
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				kind: "clock",
				status: "skipped",
				messageId: w.message.id,
				payload: { kind: "clock", by: 2, unit: "hours", cause: "keeper", skipped: NO_STORY_CLOCK_YET }
			})
			// The person reads it under the reply, as Adventure's skipped steps read.
			const ledger = await clockLedgerRows(testDb as unknown as Db, w.session.id, w.session.lorebookId)
			expect(
				ledgerLines(ledger.map((m) => ({ id: m.id, kind: "clock" as const, messageId: m.messageId, ownerKey: "world", ownerLabel: "World", updatedBy: m.updatedBy, clock: m }))).map((l) => [l.messageId, l.text])
			).toEqual([[w.message.id, `Time passes: 2 hours, not on the clock. ${NO_STORY_CLOCK_YET}`]])
			// An extend re-runs the keeper over the same reply: not said twice.
			const again: any = await run()
			expect(again.main.skipped).toEqual(out.main.skipped)
			expect(
				await testDb.select().from(schema.stateProposals).where(eq(schema.stateProposals.sessionId, w.session.id))
			).toHaveLength(1)
			// Nothing moved.
			expect((await clockOfSession(w.session.id)).hour).toBeNull()
		}
	}, 60_000)

	test("the state_proposals CHECK takes `clock` and still refuses anything else", async () => {
		const w = await world()
		await expect(
			testDb.insert(schema.stateProposals).values({
				sessionId: w.session.id,
				kind: "possession",
				payload: {},
				status: "pending"
			})
		).rejects.toThrow()
	}, 60_000)
})

describe("deciding a clock proposal", () => {
	const propose = async (sessionId: number, by = 3, unit: "hours" | "days" = "hours") => {
		const { proposeClockChange } = await import("$lib/server/state/clockProposal")
		return await proposeClockChange(testDb as unknown as Db, { sessionId, updatedBy: "run:abc" }, {
			kind: "clock",
			by,
			unit
		})
	}

	test("listed and described as what accepting it would do", async () => {
		const w = await world()
		const id = await propose(w.session.id)
		const { listedProposals } = await import("$lib/server/state/write")
		const { describeProposal } = await import("$lib/shared/state/ledgerLines")
		const listed = (await listedProposals(testDb as unknown as Db, w.session.id)).find((r) => r.id === id)!
		expect(listed.kind).toBe("clock")
		expect(describeProposal(listed as any, {})).toBe("Time passes: 3 hours")
	}, 60_000)

	test("accept advances the session's clock; it is never superseded by a move in between", async () => {
		const w = await world()
		const id = await propose(w.session.id)
		// A person steps the clock first: the keeper's three hours still hold.
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		await advanceSessionStoryClock(testDb as unknown as Db, w.session.id, 1, "days")
		const { decideProposal } = await import("$lib/server/state/write")
		const decided = await decideProposal(testDb as unknown as Db, id, true, w.user.id)
		expect(decided.status).toBe("accepted")
		expect(decided.clock?.label).toBeTruthy()
		expect(await clockOfSession(w.session.id)).toEqual({ day: 6, hour: 12, minute: 0 })
		await expect(decideProposal(testDb as unknown as Db, id, true)).rejects.toThrow(/already accepted/)
	}, 60_000)

	test("reject drops it and leaves the clock alone", async () => {
		const w = await world()
		const id = await propose(w.session.id)
		const { decideProposal } = await import("$lib/server/state/write")
		expect((await decideProposal(testDb as unknown as Db, id, false)).status).toBe("rejected")
		expect((await clockOfSession(w.session.id)).hour).toBe(9)
	}, 60_000)

	test("a clock that can no longer move refuses with its own sentence and stays pending", async () => {
		const w = await world()
		const id = await propose(w.session.id)
		// The clock is cleared and nothing on the line is dated: no present.
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: null, storyClockMonth: null, storyClockDay: null, storyClockHour: null, storyClockMinute: null })
			.where(eq(schema.sessions.id, w.session.id))
		const { decideProposal } = await import("$lib/server/state/write")
		await expect(decideProposal(testDb as unknown as Db, id, true)).rejects.toThrow(/no present to start from/)
		const [row] = await testDb.select().from(schema.stateProposals).where(eq(schema.stateProposals.id, id))
		expect(row!.status).toBe("pending")
	}, 60_000)

	test("a swipe of the reply takes a pending clock proposal with it", async () => {
		const w = await world()
		const id = await propose(w.session.id)
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(testDb as unknown as Db, w.message.id)
		expect(await testDb.select().from(schema.stateProposals).where(eq(schema.stateProposals.id, id))).toEqual([])
	}, 60_000)
})

describe("state:decide — a clock proposal over the wire", () => {
	const fakeSocket = (userId: number) =>
		({
			user: { id: userId },
			io: {
				to: () => ({ emit: () => {} }),
				sockets: { adapter: { rooms: { get: () => undefined } }, get: () => undefined, values: () => [] }
			}
		}) as any

	test("accept moves the clock, answers accepted, and notes a time action", async () => {
		const w = await world()
		const { proposeClockChange } = await import("$lib/server/state/clockProposal")
		const id = await proposeClockChange(testDb as unknown as Db, { sessionId: w.session.id, updatedBy: "run:abc" }, {
			kind: "clock",
			by: 2,
			unit: "hours"
		})
		const { stateDecide, stateProposals } = await import("$lib/server/sockets/state")
		const socket = fakeSocket(w.user.id)
		const listed = await stateProposals.handler(socket, { sessionId: w.session.id }, () => {})
		expect(listed.proposals.find((p) => p.id === id)?.kind).toBe("clock")
		noted.length = 0
		const decided = await stateDecide.handler(socket, { proposalId: id, accept: true }, () => {})
		expect(decided.status).toBe("accepted")
		expect(decided.proposals.find((p) => p.id === id)).toBeUndefined()
		expect((await clockOfSession(w.session.id)).hour).toBe(11)
		expect(noted).toEqual([w.session.id])
	}, 60_000)

	test("a reject is no time action, and a stranger cannot decide one", async () => {
		const w = await world()
		const { proposeClockChange } = await import("$lib/server/state/clockProposal")
		const id = await proposeClockChange(testDb as unknown as Db, { sessionId: w.session.id, updatedBy: "run:abc" }, {
			kind: "clock",
			by: 2,
			unit: "hours"
		})
		const { stateDecide } = await import("$lib/server/sockets/state")
		await expect(
			stateDecide.handler(fakeSocket(w.stranger.id), { proposalId: id, accept: true }, () => {})
		).rejects.toThrow(/Session not found/)
		noted.length = 0
		const decided = await stateDecide.handler(fakeSocket(w.user.id), { proposalId: id, accept: false }, () => {})
		expect(decided.status).toBe("rejected")
		expect(noted).toEqual([])
		const rows = await testDb
			.select()
			.from(schema.stateProposals)
			.where(and(eq(schema.stateProposals.id, id), eq(schema.stateProposals.status, "rejected")))
		expect(rows).toHaveLength(1)
		expect((await clockOfSession(w.session.id)).hour).toBe(9)
	}, 60_000)
})
