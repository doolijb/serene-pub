/**
 * 🚧 Clock moves (PROPOSAL-live-scenes §15 G4/G5/G7, 2026-10-13): every move
 * *Advance story clock* makes is a ledger line anchored where the world's
 * changes are, says why it moved, and goes back with its message — a delete,
 * a swipe or a regenerate — except a reply's tick on a swipe. A story with no
 * clock yet skips the move with a line instead of halting, when the spec
 * says so.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The watcher's own rules are its tests'; here only which moves note one.
const noted: Array<{ sessionId: number; cause?: string }> = []
vi.mock("$lib/server/scenes/boundaryWatcher", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/scenes/boundaryWatcher")>()
	return {
		...real,
		noteTimeAction: vi.fn(async (_db: unknown, p: { sessionId: number; cause?: string }) => {
			noted.push(p)
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-clock-moves-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
const db = () => testDb as unknown as Db

/** A session reading a free-form book, its clock at Year 412, month 3, day 5, 09:00 unless `clock` is false. */
async function world(opts: { clock?: boolean; book?: boolean; silent?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `clock-moves-${suffix}`)
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
	const line = async (content: string) => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, userId: user.id, role: "assistant", content })
			.returning()
		await testDb.insert(schema.messages).values({ id: legacy.id, sessionId: session.id, role: "assistant" })
		return legacy
	}
	// `silent`: no line at all yet (§15 G13) — `message` is then not one.
	const message = (opts.silent ? null : await line("They walk all night.")) as Awaited<
		ReturnType<typeof line>
	>
	return { user, session, message, line }
}

const host = async (w: Awaited<ReturnType<typeof world>>, specId = "test:spec/clock") => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db(), { sessionId: w.session.id, userId: w.user.id, specId, runId: `run-${specId}` } as any)
}
const advance = { key: "advance", definitionId: "core:outlet/advance-story-clock", definitionVersion: 1 } as any

const clockOf = async (sessionId: number) =>
	(
		await testDb
			.select({
				year: schema.sessions.storyClockYear,
				month: schema.sessions.storyClockMonth,
				day: schema.sessions.storyClockDay,
				hour: schema.sessions.storyClockHour,
				minute: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

const clockRows = async (sessionId: number) =>
	testDb
		.select()
		.from(schema.stateProposals)
		.where(and(eq(schema.stateProposals.sessionId, sessionId), eq(schema.stateProposals.kind, "clock")))

const linesOf = async (sessionId: number, lorebookId: number | null) => {
	const { clockLedgerRows } = await import("./clockMoves")
	const { ledgerLines } = await import("$lib/shared/state/ledgerLines")
	return ledgerLines(
		(await clockLedgerRows(db(), sessionId, lorebookId)).map((m) => ({
			id: m.id,
			kind: "clock" as const,
			messageId: m.messageId,
			ownerKey: "world",
			ownerLabel: "World",
			updatedBy: m.updatedBy,
			clock: m
		}))
	)
}

describe("Advance story clock writes the move to the ledger", () => {
	test("an applied move: anchored to the newest line, its cause, where the clock stood and stands", async () => {
		const w = await world()
		const out: any = await (await host(w)).commit!({ by: 3, unit: "hours", cause: "keeper" }, advance)
		expect(out.clock).toMatchObject({ year: 412, month: 3, day: 5, hour: 12, minute: 0 })
		expect(out.skipped).toBe("")
		const [row] = await clockRows(w.session.id)
		expect(row).toMatchObject({ status: "applied", messageId: w.message.id, proposedBy: "run:run-test:spec/clock" })
		expect(row.payload).toMatchObject({
			kind: "clock",
			by: 3,
			unit: "hours",
			cause: "keeper",
			from: { year: 412, month: 3, day: 5, hour: 9, minute: 0 },
			to: { year: 412, month: 3, day: 5, hour: 12, minute: 0 }
		})
		const [line] = await linesOf(w.session.id, w.session.lorebookId)
		expect(line.kind).toBe("clock")
		expect(line.messageId).toBe(w.message.id)
		expect(line.text).toMatch(/^Time passes: 3 hours \(.*09:00 → .*12:00\)$/)
	})

	test("why it moved is the spec's: a keeper's or an action's move is a time action, a tick never is", async () => {
		const w = await world()
		const h = await host(w)
		noted.length = 0
		// The watcher is handed the spec's word; a `tick` it never counts
		// (its own rule, `noteTimeAction`). Unwired reads as `action`.
		await h.commit!({ by: 1, unit: "minutes", cause: "tick" }, advance)
		await h.commit!({ by: 1, unit: "hours", cause: "keeper" }, advance)
		await h.commit!({ by: 1, unit: "hours" }, advance)
		expect(noted).toEqual([
			{ sessionId: w.session.id, cause: "tick" },
			{ sessionId: w.session.id, cause: "keeper" },
			{ sessionId: w.session.id, cause: "action" }
		])
		const causes = (await clockRows(w.session.id)).map((r) => (r.payload as any).cause).sort()
		expect(causes).toEqual(["action", "keeper", "tick"])
		await expect(h.commit!({ by: 1, unit: "hours", cause: "nap" }, advance)).rejects.toThrow(
			/cause takes 'action', 'keeper' or 'tick'/
		)
		await expect(h.commit!({ by: 1, unit: "hours", onRefusal: "shrug" }, advance)).rejects.toThrow(
			/onRefusal takes 'halt' or 'skip'/
		)
	})

	test("a step back reads as time going back", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: -2, unit: "hours", cause: "action" }, advance)
		const [line] = await linesOf(w.session.id, w.session.lorebookId)
		expect(line.text).toMatch(/^Time goes back: 2 hours \(.*09:00 → .*07:00\)$/)
	})
})

describe("🚧 before anything was said (§15 G13)", () => {
	test("a greeting counts: the move files under the session's newest line, whatever it is", async () => {
		const w = await world({ silent: true })
		const greeting = await w.line("Welcome, traveller.")
		await (await host(w)).commit!({ by: 1, unit: "hours", cause: "action", onRefusal: "skip" }, advance)
		const [row] = await clockRows(w.session.id)
		expect(row).toMatchObject({ status: "applied", messageId: greeting.id })
		const [line] = await linesOf(w.session.id, w.session.lorebookId)
		expect(line.messageId).toBe(greeting.id)
	})

	test("with no line at all, the move is the ledger head — above the first message, under none", async () => {
		const { ledgerHeadLines, linesByMessage } = await import("$lib/shared/state/ledgerLines")
		const w = await world({ silent: true })
		await (await host(w)).commit!({ by: 2, unit: "hours", cause: "action", onRefusal: "skip" }, advance)
		const [row] = await clockRows(w.session.id)
		expect(row).toMatchObject({ status: "applied", messageId: null })
		let lines = await linesOf(w.session.id, w.session.lorebookId)
		expect(ledgerHeadLines(lines).map((l) => l.text)).toEqual([
			expect.stringMatching(/^Time passes: 2 hours \(.*09:00 → .*11:00\)$/)
		])
		expect(linesByMessage(lines).size).toBe(0)

		// Once something is said, the next move files under it; the head keeps its own.
		const first = await w.line("Dawn breaks.")
		await (await host(w)).commit!({ by: 1, unit: "hours", cause: "action", onRefusal: "skip" }, advance)
		lines = await linesOf(w.session.id, w.session.lorebookId)
		expect(ledgerHeadLines(lines)).toHaveLength(1)
		expect(linesByMessage(lines).get(first.id)?.map((l) => l.text)).toEqual([
			expect.stringMatching(/^Time passes: 1 hour \(.*11:00 → .*12:00\)$/)
		])
	})

	test("a move the calendar cannot place, before any line, heads the ledger too", async () => {
		const { ledgerHeadLines } = await import("$lib/shared/state/ledgerLines")
		const w = await world({ silent: true, clock: false })
		// A time of day with no date cannot run past midnight (docs/lorebook-time.md).
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 1, storyClockHour: 23, storyClockMinute: 0 })
			.where(eq(schema.sessions.id, w.session.id))
		await (await host(w)).commit!({ by: 3, unit: "hours", cause: "action", onRefusal: "skip" }, advance)
		const lines = await linesOf(w.session.id, w.session.lorebookId)
		expect(ledgerHeadLines(lines).map((l) => l.text)).toEqual([
			"Time passes: 3 hours, not moved. The clock has no date at Year 1, 23:00, so it can't run past midnight."
		])
	})
})

describe("a story with no clock yet", () => {
	test("a move BY an amount starts the clock on the story's first day, stored, and records an applied move", async () => {
		const w = await world({ clock: false })
		noted.length = 0
		const out: any = await (await host(w)).commit!(
			{ by: 3, unit: "hours", cause: "action", onRefusal: "skip" },
			advance
		)
		expect(out.skipped ?? "").toBe("")
		expect(await clockOf(w.session.id)).toEqual({ year: 1, month: 1, day: 1, hour: 3, minute: 0 })
		expect(noted).not.toEqual([])
		const [row] = await clockRows(w.session.id)
		expect(row).toMatchObject({
			status: "applied",
			messageId: w.message.id,
			payload: {
				by: 3,
				unit: "hours",
				from: { year: 1, month: 1, day: 1, hour: 0, minute: 0 },
				to: { year: 1, month: 1, day: 1, hour: 3, minute: 0 }
			}
		})
		const [line] = await linesOf(w.session.id, w.session.lorebookId)
		expect(line.text).toMatch(/^Time passes: 3 hours \(.*00:00 → .*03:00\)$/)
	})

	test("a session with no shared lorebook keeps its clock in its own book: unset, it starts on the first day; set, it moves from there", async () => {
		const unset = await world({ book: false, clock: false })
		const started: any = await (await host(unset)).commit!({ by: 1, unit: "days", onRefusal: "skip" }, advance)
		expect(started.skipped ?? "").toBe("")
		expect((await clockOf(unset.session.id)).day).toBe(2)
		// Set, it moves: the session's clock is its own, whatever book it reads.
		const set = await world({ book: false })
		const moved: any = await (await host(set)).commit!({ by: 1, unit: "days", onRefusal: "skip" }, advance)
		expect(moved.skipped ?? "").toBe("")
		expect((await clockOf(set.session.id)).day).toBe(6)
	})

	test("a move TO a moment starts the clock on the story's first day, stored, and later moves go on from it (M1 E-fix T-4)", async () => {
		const w = await world({ clock: false })
		const out: any = await (await host(w)).commit!({ to: { hour: 10, minute: 0, day: "today" }, cause: "tick", onRefusal: "skip" }, advance)
		expect(out.skipped ?? "").toBe("")
		expect(await clockOf(w.session.id)).toEqual({ year: 1, month: 1, day: 1, hour: 10, minute: 0 })
		const [row] = await clockRows(w.session.id)
		expect(row).toMatchObject({ status: "applied", payload: { by: 600, unit: "minutes", from: { year: 1, month: 1, day: 1, hour: 0 } } })
		await (await host(w)).commit!({ by: 21, unit: "hours", cause: "action", onRefusal: "skip" }, advance)
		expect(await clockOf(w.session.id)).toEqual({ year: 1, month: 1, day: 2, hour: 7, minute: 0 })
	})

	test("unwired, a refusal still halts with the sentence and writes nothing", async () => {
		const w = await world({ clock: false })
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 1, storyClockHour: 23, storyClockMinute: 0 })
			.where(eq(schema.sessions.id, w.session.id))
		await expect((await host(w)).commit!({ by: 3, unit: "hours" }, advance)).rejects.toThrow(/no date/)
		expect(await clockRows(w.session.id)).toEqual([])
	})

	test("a malformed step halts even under skip: it is the spec's mistake, not the story's", async () => {
		const w = await world({ clock: false })
		await expect(
			(await host(w)).commit!({ by: 0, unit: "hours", onRefusal: "skip" }, advance)
		).rejects.toThrow(/^advance: /)
		expect(await clockRows(w.session.id)).toEqual([])
	})
})

describe("a clock move goes back with its message", () => {
	test("a swipe or a regenerate (retract) takes the keeper's move back, and its line", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: 3, unit: "hours", cause: "keeper" }, advance)
		const { retractStateAnchoredTo } = await import("./write")
		expect(await retractStateAnchoredTo(db(), w.message.id, "replaced")).toMatchObject({ clockMoved: true, changed: true })
		expect(await clockOf(w.session.id)).toMatchObject({ day: 5, hour: 9, minute: 0 })
		expect(await clockRows(w.session.id)).toEqual([])
	})

	test("… but a reply's tick stands: the re-driven reply never ticks again", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: 5, unit: "minutes", cause: "tick" }, advance)
		const { retractStateAnchoredTo } = await import("./write")
		// Nothing taken back, so nothing to announce (§15 G14).
		expect(await retractStateAnchoredTo(db(), w.message.id, "replaced")).toMatchObject({ clockMoved: false, changed: false })
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 9, minute: 5 })
		expect((await clockRows(w.session.id)).map((r) => r.status)).toEqual(["applied"])
	})

	test("a retake takes the tick back too: the turn is taken again", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: 5, unit: "minutes", cause: "tick" }, advance)
		const { revertClockMovesAnchoredTo } = await import("./clockMoves")
		expect(await revertClockMovesAnchoredTo(db(), [w.message.id])).toEqual({ sessionIds: [w.session.id] })
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 9, minute: 0 })
	})

	test("an accepted clock proposal is a move: stamped, drawn, and taken back with the reply", async () => {
		const w = await world()
		const [proposal] = await testDb
			.insert(schema.stateProposals)
			.values({
				sessionId: w.session.id,
				messageId: w.message.id,
				kind: "clock",
				payload: { kind: "clock", by: 8, unit: "hours" },
				status: "pending",
				proposedBy: "run:keeper"
			})
			.returning()
		const { decideProposal, retractStateAnchoredTo } = await import("./write")
		expect((await decideProposal(db(), proposal.id, true)).status).toBe("accepted")
		const [row] = await clockRows(w.session.id)
		expect(row.payload).toMatchObject({ cause: "keeper", from: { hour: 9 }, to: { hour: 17 } })
		const [line] = await linesOf(w.session.id, w.session.lorebookId)
		expect(line.text).toMatch(/^Time passes: 8 hours \(.*09:00 → .*17:00\)$/)
		await retractStateAnchoredTo(db(), w.message.id, "replaced")
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 9, minute: 0 })
	})

	test("a delete takes a Time passes move back, by its step: a person's move since stands", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: 2, unit: "days", cause: "action" }, advance)
		// The person moves the clock on an hour by hand afterwards.
		await testDb.update(schema.sessions).set({ storyClockHour: 10 }).where(eq(schema.sessions.id, w.session.id))
		const del = { key: "delete", definitionId: "core:outlet/delete-message", definitionVersion: 1 } as any
		await (await host(w, "core:spec/builtin-delete")).commit!({ target: w.message.id }, del)
		expect(await clockOf(w.session.id)).toMatchObject({ month: 3, day: 5, hour: 10, minute: 0 })
		expect(await clockRows(w.session.id)).toEqual([])
	})

	test("a step the clock cannot take back refuses in words, and takes nothing back", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: 2, unit: "months", cause: "keeper" }, advance)
		// Moved by hand to the first month: a free-form book moves only the
		// part named, so two months back from month 1 has nowhere to land.
		await testDb.update(schema.sessions).set({ storyClockMonth: 1 }).where(eq(schema.sessions.id, w.session.id))
		const { clockRetractProblem } = await import("./clockMoves")
		const problem = await clockRetractProblem(db(), [w.message.id], { keepTicks: true })
		expect(problem).toMatch(/^The story clock can't be taken back by 2 months: /)
		const { retractStateAnchoredTo } = await import("./write")
		await expect(retractStateAnchoredTo(db(), w.message.id, "replaced")).rejects.toThrow(/can't be taken back by 2 months/)
		expect(await clockOf(w.session.id)).toMatchObject({ month: 1, day: 5 })
		expect(await clockRows(w.session.id)).toHaveLength(1)
	})

	test("a session that follows its line's present has nothing of its own to move back", async () => {
		const w = await world()
		await (await host(w)).commit!({ by: 1, unit: "hours", cause: "keeper" }, advance)
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: null, storyClockMonth: null, storyClockDay: null, storyClockHour: null, storyClockMinute: null })
			.where(eq(schema.sessions.id, w.session.id))
		const { retractStateAnchoredTo } = await import("./write")
		// The clock stays; the move's line still goes, and that is a change (§15 G14).
		expect(await retractStateAnchoredTo(db(), w.message.id, "replaced")).toMatchObject({ clockMoved: false, changed: true })
		expect((await clockOf(w.session.id)).year).toBeNull()
	})
})

describe("why a clock move was skipped (reason)", () => {
	test("recordClockMove stores the sentence only; the ledger reads the kind off it", async () => {
		const { recordClockMove, clockLedgerRows, NO_STORY_CLOCK_YET } = await import("./clockMoves")
		const w = await world()
		const base = { sessionId: w.session.id, by: 3, unit: "hours" as const, cause: "action" as const, updatedBy: "u" }
		await recordClockMove(db(), { ...base, skipped: NO_STORY_CLOCK_YET })
		await recordClockMove(db(), { ...base, skipped: "The clock has no date at Year 1, 23:00, so it can't run past midnight." })
		const stored = (await clockRows(w.session.id)).map((r) => (r.payload as any).reason)
		expect(stored).toEqual([undefined, undefined])
		const rows = await clockLedgerRows(db(), w.session.id, w.session.lorebookId)
		expect(rows.map((r) => r.reason).sort()).toEqual(["no-clock", "refused"])
	})

	test("a row written any time reads back with the derived reason, both arms", async () => {
		const { clockLedgerRows, NO_STORY_CLOCK_YET } = await import("./clockMoves")
		const w = await world()
		const old = (skipped: string) =>
			testDb.insert(schema.stateProposals).values({
				sessionId: w.session.id,
				messageId: null,
				kind: "clock",
				payload: { kind: "clock", by: 3, unit: "hours", cause: "action", skipped },
				status: "skipped",
				proposedBy: "u",
				decidedAt: new Date()
			})
		await old(NO_STORY_CLOCK_YET)
		await old("The clock has no day at Year 1, so it can't count days.")
		const rows = await clockLedgerRows(db(), w.session.id, w.session.lorebookId)
		expect(rows.map((r) => r.reason).sort()).toEqual(["no-clock", "refused"])
	})
})

describe("a hand move this turn drops the model's own (★13a)", () => {
	test("an action move then a keeper move at the same anchor: the keeper's moves nothing, writes no row, says so", async () => {
		const { droppedKeeperMoveSentence } = await import("./clockMoves")
		const w = await world()
		const h = await host(w)
		await h.commit!({ by: 2, unit: "hours", cause: "action" }, advance)
		noted.length = 0
		const out: any = await h.commit!({ by: 3, unit: "hours", cause: "keeper", onRefusal: "skip" }, advance)
		expect(out).toMatchObject({
			clock: null,
			moved: 0,
			skipped: droppedKeeperMoveSentence({ by: 3, unit: "hours" })
		})
		expect(out.skipped).toBe(
			"Dropped: the clock was already moved by hand this turn, so the model's 3 hours was not added."
		)
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 11 })
		expect(await clockRows(w.session.id)).toHaveLength(1)
		expect(noted).toEqual([])
	})

	test("a keeper move with no hand move at its anchor still moves", async () => {
		const w = await world()
		const out: any = await (await host(w)).commit!({ by: 3, unit: "hours", cause: "keeper" }, advance)
		expect(out.skipped).toBe("")
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 12 })
		expect(await clockRows(w.session.id)).toHaveLength(1)
	})

	test("a hand move since the previous reply drops this reply's keeper move, wherever the anchors fall", async () => {
		// The real order: the press files at the previous reply, the person's
		// line lands, the reply's keeper runs — three different anchors.
		const w = await world()
		const h = await host(w)
		await h.commit!({ by: 2, unit: "hours", cause: "action" }, advance)
		await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: w.session.id, userId: w.user.id, role: "user", content: "We walk on." })
		await w.line("The road climbs.")
		const out: any = await h.commit!({ by: 3, unit: "hours", cause: "keeper" }, advance)
		expect(out.moved).toBe(0)
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 11 })
		expect(await clockRows(w.session.id)).toHaveLength(1)
	})

	test("a hand move from an earlier turn (a reply has landed since) does not drop the keeper's", async () => {
		const w = await world()
		const h = await host(w)
		await h.commit!({ by: 2, unit: "hours", cause: "action" }, advance)
		await w.line("The next morning.")
		await w.line("And the day after.")
		const out: any = await h.commit!({ by: 3, unit: "hours", cause: "keeper" }, advance)
		expect(out.skipped).toBe("")
		expect(await clockOf(w.session.id)).toMatchObject({ hour: 14 })
		expect(await clockRows(w.session.id)).toHaveLength(2)
	})
})
