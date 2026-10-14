/**
 * 🚧 Time passes… (PROPOSAL-live-scenes §6, lane D): Chat's composer action,
 * end to end over the sockets — listed with its stepper, fired with the
 * clock step the stepper picked, the session's story clock moved by it with
 * no model, and the next line's scene cue waiting (a time action). A step the
 * host refuses never starts the run.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-time-passes-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}
const TIME_PASSES = "core:spec/chat-advance-time#advance-time"

let seq = 0
async function makeWorld() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `time-passes-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Time Book ${seq}`, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2
		})
		.returning()
	return { user, lorebook, session }
}

const clockOf = async (sessionId: number) => {
	const [row] = await testDb
		.select({
			year: schema.sessions.storyClockYear,
			month: schema.sessions.storyClockMonth,
			day: schema.sessions.storyClockDay
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row
}

describe("Time passes… in Chat", () => {
	test("listed at the composer with its stepper — How much time passes?, one hour forward", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const w = await makeWorld()
		const res: any = await sessionsActionsHandler.handler(fakeSocket(w.user.id), { sessionId: w.session.id }, noopEmit)
		const composer = [...res.venues.composer.primary, ...res.venues.composer.overflow]
		const action = composer.find((a: any) => a.specSlug === "core:spec/chat-advance-time")
		expect(action).toMatchObject({
			key: "advance-time",
			name: "Time passes…",
			slash: "advance-time",
			collects: { clockStep: { label: "How much time passes?", default: { by: 1, unit: "hours" } } }
		})
	}, 60_000)

	test("fired with the stepper's step, it moves the session's clock — and leaves the next line a time-action cue", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const w = await makeWorld()
		const res: any = await sessionsFireActionHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, action: TIME_PASSES, clockStep: { by: 2, unit: "days" } },
			noopEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.success).toBe(true)
		expect(await clockOf(w.session.id)).toEqual({ year: 5, month: 1, day: 4 })
		const cues = await testDb
			.select()
			.from(schema.sceneCues)
			.where(eq(schema.sceneCues.sessionId, w.session.id))
		expect(cues).toMatchObject([{ trigger: "timeAction", state: "pending", atMessageId: null }])
		// Nothing was written in the conversation.
		const lines = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
		expect(lines).toEqual([])

		// Back is a negative step.
		const back: any = await sessionsFireActionHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, action: TIME_PASSES, clockStep: { by: -1, unit: "days" } },
			noopEmit
		)
		expect(back.success).toBe(true)
		expect(await clockOf(w.session.id)).toEqual({ year: 5, month: 1, day: 3 })
	}, 60_000)

	test("🚧 a story with no clock: the press finishes, nothing moves, and the ledger head says why (§15 G12, G13)", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { NO_STORY_CLOCK_YET } = await import("$lib/server/state/clockMoves")
		const user = await createTestUser(testDb, `time-passes-${++seq}`)
		// A book with nothing dated and no clock set: no present to start from.
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: `Undated Book ${seq}`, userId: user.id })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, lorebookId: lorebook!.id })
			.returning()
		const res: any = await sessionsFireActionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session!.id, action: TIME_PASSES, clockStep: { by: 2, unit: "hours" } },
			noopEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.success).toBe(true)
		expect(await clockOf(session!.id)).toEqual({ year: null, month: null, day: null })
		// Skipped, in the ledger: before any line, so at its head.
		const rows = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, session!.id))
		expect(rows).toMatchObject([
			{
				kind: "clock",
				status: "skipped",
				messageId: null,
				payload: { by: 2, unit: "hours", cause: "action", skipped: NO_STORY_CLOCK_YET }
			}
		])
		// Not a time action: nothing moved, so no cue.
		const cues = await testDb.select().from(schema.sceneCues).where(eq(schema.sceneCues.sessionId, session!.id))
		expect(cues).toEqual([])
	}, 60_000)

	test("a step the host cannot take is refused before any run, in words", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const w = await makeWorld()
		for (const clockStep of [undefined, { by: 0, unit: "days" }, { by: 1, unit: "weeks" }] as any[]) {
			const res: any = await sessionsFireActionHandler.handler(
				fakeSocket(w.user.id),
				{ sessionId: w.session.id, action: TIME_PASSES, ...(clockStep ? { clockStep } : {}) },
				noopEmit
			)
			expect(res.error).toMatch(/^'Time passes…' /)
		}
		expect(await clockOf(w.session.id)).toEqual({ year: 5, month: 1, day: 2 })
	}, 60_000)
})
