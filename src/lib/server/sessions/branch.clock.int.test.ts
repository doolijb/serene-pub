/**
 * 🚧 Live scenes §15 G15: a branch's story clock is its parent's clock **as of
 * the fork message** — the parent's own clock now, less every recorded move
 * anchored after the fork (`stepBranchClockToFork`, a retraction's
 * arithmetic) — or the line's present when the parent follows it. The
 * parent's recorded clock moves up to the fork come across under their
 * copied lines (`copyClockMovesToBranch`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-branch-clock-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
const asDb = () => db as unknown as Db

/** A session reading a free-form book whose line's present is Year 412, month 3, day 1; its own clock day 5, 09:00 unless `follows`. */
async function world(opts: { follows?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const user = await createTestUser(db, `branch-clock-${suffix}`)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	await db
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook!.id, year: 412, month: 3, day: 1 }]))
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: lorebook!.id,
			...(opts.follows
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
	const line = (content: string) =>
		insertLegacy(asDb(), { sessionId: session!.id, userId: user.id, role: "assistant", content } as any)
	return { user, lorebook: lorebook!, session: session!, line }
}

/** A recorded move, as *Advance story clock* makes one: the clock moves and its row files at `at`. */
async function move(sessionId: number, at: number, by: number, unit: "hours" | "days") {
	const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
	const { recordClockMove } = await import("$lib/server/state/clockMoves")
	const done = await advanceSessionStoryClock(asDb(), sessionId, by, unit)
	await recordClockMove(asDb(), {
		sessionId,
		by,
		unit,
		cause: "action",
		updatedBy: "run:test",
		messageId: at,
		from: done.from,
		to: done.clock
	})
}

const clockOf = async (sessionId: number) => {
	const [row] = await db
		.select({
			year: schema.sessions.storyClockYear,
			month: schema.sessions.storyClockMonth,
			day: schema.sessions.storyClockDay,
			hour: schema.sessions.storyClockHour,
			minute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row!
}

const clockRows = (sessionId: number) =>
	db
		.select()
		.from(schema.stateProposals)
		.where(and(eq(schema.stateProposals.sessionId, sessionId), eq(schema.stateProposals.kind, "clock")))
		.orderBy(schema.stateProposals.id)

describe("a branch's clock is its parent's as of the fork", () => {
	test("the parent's clock now, less every move made after the fork message; its past moves come across", async () => {
		const { branchSession } = await import("./branch")
		const w = await world()
		const m1 = await w.line("They set out.")
		await move(w.session.id, m1.id, 2, "hours") // day 5, 11:00
		const m2 = await w.line("They camp.")
		await move(w.session.id, m2.id, 1, "days") // day 6, 11:00
		const m3 = await w.line("They climb.")
		await move(w.session.id, m3.id, 3, "hours") // day 6, 14:00
		expect(await clockOf(w.session.id)).toMatchObject({ day: 6, hour: 14 })

		// Forked at m2: m3's three hours never happened on the branch.
		const atCamp = await branchSession(asDb(), { sessionId: w.session.id, fromMessageId: m2.id })
		expect(await clockOf(atCamp.id)).toEqual({ year: 412, month: 3, day: 6, hour: 11, minute: 0 })
		expect(atCamp).toMatchObject({ storyClockDay: 6, storyClockHour: 11 })
		// The moves up to the fork, under the copies of their lines.
		const copies = await db
			.select({ id: schema.sessionMessages.id, content: schema.sessionMessages.content })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, atCamp.id))
			.orderBy(schema.sessionMessages.id)
		const copied = await clockRows(atCamp.id)
		expect(copied.map((r) => [r.messageId, r.status, (r.payload as any).by, (r.payload as any).unit])).toEqual([
			[copies[0]!.id, "applied", 2, "hours"],
			[copies[1]!.id, "applied", 1, "days"]
		])

		// Forked at m1: the day and the climb both come off.
		const atStart = await branchSession(asDb(), { sessionId: w.session.id, fromMessageId: m1.id })
		expect(await clockOf(atStart.id)).toEqual({ year: 412, month: 3, day: 5, hour: 11, minute: 0 })
		expect((await clockRows(atStart.id)).map((r) => (r.payload as any).by)).toEqual([2])

		// Forked at the newest line: nothing came after it — the parent's clock.
		const atNewest = await branchSession(asDb(), { sessionId: w.session.id, fromMessageId: m3.id })
		expect(await clockOf(atNewest.id)).toEqual(await clockOf(w.session.id))
		// The parent is untouched.
		expect(await clockOf(w.session.id)).toMatchObject({ day: 6, hour: 14 })
		expect(await clockRows(w.session.id)).toHaveLength(3)

		// A copied move goes back with its copied line, off the branch's clock.
		const { revertClockMovesAnchoredTo } = await import("$lib/server/state/clockMoves")
		await revertClockMovesAnchoredTo(asDb(), [copies[1]!.id])
		expect(await clockOf(atCamp.id)).toMatchObject({ day: 5, hour: 11 })
	})

	test("a parent that follows its line's present gives the branch the present: no clock of its own", async () => {
		const { branchSession } = await import("./branch")
		const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
		const w = await world({ follows: true })
		const m1 = await w.line("Dawn.")
		const m2 = await w.line("Noon.")
		const branch = await branchSession(asDb(), { sessionId: w.session.id, fromMessageId: m1.id })
		expect(await clockOf(branch.id)).toEqual({ year: null, month: null, day: null, hour: null, minute: null })
		expect(await sessionStoryNowOf(asDb(), branch.id)).toMatchObject({ year: 412, month: 3, day: 1 })
		expect(m2.id).toBeGreaterThan(m1.id)
	})
})
