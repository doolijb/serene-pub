/**
 * 🚧 A clock target (M0, lane T1): `advance-story-clock@1` moved `to` a
 * moment of the day is ONE ledger move, by minutes, that Back takes back; `by`
 * and `to` together, and a malformed target, halt with a sentence.
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-clock-target-"))
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
	const user = await createTestUser(testDb, `clock-target-${suffix}`)
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

/** The world's clock set to HH:MM on its day. */
const at = async (sessionId: number, hour: number, minute = 0) => {
	await testDb
		.update(schema.sessions)
		.set({ storyClockHour: hour, storyClockMinute: minute })
		.where(eq(schema.sessions.id, sessionId))
}

describe("Advance story clock moves to a moment of the day", () => {
	test("sleep until 07:00 from 22:00: +540 minutes, one ledger row, and Back restores 22:00", async () => {
		const w = await world()
		await at(w.session.id, 22)
		const out: any = await (await host(w)).commit!({ to: { hour: 7 }, cause: "action" }, advance)
		expect(out.clock).toMatchObject({ year: 412, month: 3, day: 6, hour: 7, minute: 0 })
		const rows = await clockRows(w.session.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.payload).toMatchObject({ kind: "clock", by: 540, unit: "minutes" })
		const { revertClockMovesAnchoredTo } = await import("./clockMoves")
		await revertClockMovesAnchoredTo(db(), [w.message.id])
		expect(await clockOf(w.session.id)).toMatchObject({ day: 5, hour: 22, minute: 0 })
	}, 60_000)

	test("day 'today' with the moment already past is refused with the sentence", async () => {
		const w = await world()
		await at(w.session.id, 22)
		await expect(
			(await host(w)).commit!({ to: { hour: 7, minute: 5, day: "today" } }, advance)
		).rejects.toThrow("The clock already stands at or past 07:05 today, and a clock target never moves it back.")
		expect(await clockRows(w.session.id)).toHaveLength(0)
	}, 60_000)

	test("by and to together halt, naming both", async () => {
		const w = await world()
		await expect((await host(w)).commit!({ by: 1, to: { hour: 7 } }, advance)).rejects.toThrow(
			"advance: say how far to move the clock (by) or the moment to move it to (to), not both."
		)
	}, 60_000)

	test("a malformed target halts, even under onRefusal 'skip'", async () => {
		const w = await world()
		const h = await host(w)
		const sentence = "advance: to takes { hour: 0–23, minute?: 0–59, day?: 'today' | 'tomorrow' | 'next' }."
		for (const to of [{ hour: 24 }, { hour: 7, minute: 60 }, { hour: 7, day: "soon" }, "07:00", { hour: 7.5 }])
			await expect(h.commit!({ to, onRefusal: "skip" }, advance)).rejects.toThrow(sentence)
	}, 60_000)

	test("a refused target under onRefusal 'skip' moves nothing, leaves no ledger row and reports moved 0", async () => {
		const w = await world()
		await at(w.session.id, 22)
		const out: any = await (await host(w)).commit!(
			{ to: { hour: 7, day: "today" }, onRefusal: "skip", cause: "action" },
			advance
		)
		expect(out.moved).toBe(0)
		expect(out.skipped).toMatch(/already stands at or past 07:00 today/)
		expect(await clockRows(w.session.id)).toHaveLength(0)
		expect(await clockOf(w.session.id)).toMatchObject({ day: 5, hour: 22 })
	}, 60_000)

	test("day 'today' at the very minute is a no-op: no row, moved 0, no skipped sentence", async () => {
		const w = await world()
		await at(w.session.id, 22, 30)
		const out: any = await (await host(w)).commit!({ to: { hour: 22, minute: 30, day: "today" } }, advance)
		expect(out.moved).toBe(0)
		expect(out.skipped).toBe("")
		expect(await clockRows(w.session.id)).toHaveLength(0)
		expect(await clockOf(w.session.id)).toMatchObject({ day: 5, hour: 22, minute: 30 })
	}, 60_000)

	test("a moving target reports the minutes moved", async () => {
		const w = await world()
		await at(w.session.id, 22)
		const out: any = await (await host(w)).commit!({ to: { hour: 7 } }, advance)
		expect(out.moved).toBe(540)
	}, 60_000)
})
