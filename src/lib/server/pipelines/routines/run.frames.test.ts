/**
 * 🚧 A routine run says it is running: one `sessions:runStatus` start frame
 * once the run has lasted past `QUEUE_STATUS_DELAY_MS`, one clearing frame at
 * its end or when it parks; the session list's row status is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ctl = vi.hoisted(() => ({
	frames: [] as Array<Record<string, unknown>>,
	runs: [] as Array<{
		resolve: () => void
		reject: (e: unknown) => void
		park: () => void
	}>,
	onCall: null as (() => void) | null
}))

vi.mock("$lib/server/sessions/archive", () => ({ sessionArchivedRefusal: async () => null }))
vi.mock("$lib/server/pipelines/registrations/resolve", () => ({
	effectiveRegistrations: async () => ({
		presetId: 1,
		effective: [
			{
				key: "reg:recap",
				label: "Recap",
				pipeline: "p:recap",
				mode: "full",
				trigger: { family: "routine", cadence: { id: "turn", options: {} } }
			}
		]
	})
}))
vi.mock("$lib/server/pipelines/routines/interaction", () => ({
	capsOf: () => ({}),
	capsPause: () => null,
	countSystemClockRun: async () => undefined,
	pause: () => false,
	sessionCapsFacts: async () => ({ ownerId: 7 })
}))
vi.mock("$lib/server/pipelines/boot/bootstrap", () => ({
	loadPublished: async () => ({ version: "1.0.0", nodes: [] })
}))
vi.mock("$lib/server/pipelines/runtime/runTurn", () => ({
	sessionRulesetInput: async () => ({}),
	runSpec: (req: { onParked?: () => void }) =>
		new Promise<unknown>((resolve, reject) => {
			ctl.runs.push({
				resolve: () => resolve({}),
				reject,
				park: () => req.onParked?.()
			})
			ctl.onCall?.()
		})
}))
vi.mock("$lib/server/pipelines/runtime/sessionEvents", () => ({
	addSettleProbe: () => undefined,
	sessionEventsPending: () => false,
	sessionEventsIdle: () => Promise.resolve()
}))
vi.mock("$lib/server/pipelines/runtime/receipts", () => ({ saveReceipt: async () => undefined }))
vi.mock("$lib/server/state/announce", () => ({ announceStateChanges: async () => undefined }))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async (_io: unknown, _sessionId: number, event: string, frame: Record<string, unknown>) => {
		if (event === "sessions:runStatus") ctl.frames.push(frame)
	}
}))

import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { QUEUE_STATUS_DELAY_MS } from "$lib/server/pipelines/runtime/runStatus"
import { _resetRoutineRuns } from "./runs"
import { routineRunFramesOf, routineRunStatus, runRoutineFiring } from "./run"
import type { RoutineFiringEntry } from "./queue"

const firing = (sessionId = 1): RoutineFiringEntry =>
	({
		id: "f1",
		db: { select: () => { throw new Error("no db") } },
		io: {},
		sessionId,
		registrationKey: "reg:recap",
		pipeline: "p:recap",
		cause: { moment: "turn-ended", at: 0 },
		firedAt: {},
		depth: 0,
		queuedAt: 0,
		runNow: true
	}) as unknown as RoutineFiringEntry

/** Start a firing; resolves once `runSpec` has been called. */
async function start(sessionId = 1) {
	const called = new Promise<void>((r) => (ctl.onCall = r))
	const done = runRoutineFiring(firing(sessionId))
	await called
	return { done, run: ctl.runs.at(-1)! }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
	vi.useFakeTimers()
	ctl.frames.length = 0
	ctl.runs.length = 0
	ctl.onCall = null
	_resetRoutineRuns()
	runRegistry._reset()
})
afterEach(() => {
	vi.useRealTimers()
	runRegistry._reset()
	_resetRoutineRuns()
})

describe("a routine run's frames", () => {
	it("a run longer than the delay sends one start frame and, at its end, one clearing frame", async () => {
		const { done, run } = await start()
		expect(ctl.frames).toEqual([])
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS)
		expect(ctl.frames).toEqual([
			{ sessionId: 1, runId: expect.any(String), status: routineRunStatus("Recap"), kind: "routine", routine: { name: "Recap" } }
		])
		expect(routineRunStatus("Recap")).toEqual({ i18n: { en: "Recap is running" } })
		run.resolve()
		await settle()
		await done
		expect(ctl.frames).toHaveLength(2)
		expect(ctl.frames[1]).toMatchObject({ sessionId: 1, status: null, kind: "routine", routine: { name: "Recap" } })
		expect(ctl.frames[1].runId).toBe(ctl.frames[0].runId)
	})

	it("a run that ends before the delay sends no frame", async () => {
		const { done, run } = await start()
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS - 50)
		run.resolve()
		await settle()
		await done
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS * 2)
		expect(ctl.frames).toEqual([])
	})

	it("with nothing to send on, a run is never marked as shown", async () => {
		// A run marked shown would reach a page's first load, and no end frame
		// could ever clear it there.
		const { showRoutineRun } = await import("./run")
		const fact: any = {}
		const shown = showRoutineRun({ sessionId: 1, runId: "no-io", name: "Recap", fact })
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS * 2)
		expect(fact.shownAs).toBeUndefined()
		shown.clear()
		expect(fact.shownAs).toBeUndefined()
	})

	it("a run that parks clears at onParked, and its later end sends nothing more", async () => {
		const { done, run } = await start()
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS)
		expect(ctl.frames).toHaveLength(1)
		run.park()
		await settle()
		await done
		expect(ctl.frames).toHaveLength(2)
		expect(ctl.frames[1]).toMatchObject({ status: null, routine: { name: "Recap" } })
		run.resolve()
		await settle()
		expect(ctl.frames).toHaveLength(2)
	})

	it("a failed run clears", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined)
		const { done, run } = await start()
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS)
		run.reject(new Error("boom"))
		await settle()
		await done
		expect(ctl.frames.map((f) => f.status === null)).toEqual([false, true])
	})

	it("never sets the registry status: the session list's row status has no entry", async () => {
		const { run } = await start()
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS)
		expect(ctl.frames).toHaveLength(1)
		expect(runRegistry.statusesBySession().has(1)).toBe(false)
		run.resolve()
		await settle()
	})
})

describe("routineRunFramesOf", () => {
	it("is empty before the delay, the start frame after it, empty after park or end, empty for another session", async () => {
		const { done, run } = await start()
		expect(routineRunFramesOf(1)).toEqual([])
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS)
		expect(routineRunFramesOf(1)).toEqual([ctl.frames[0]])
		expect(routineRunFramesOf(2)).toEqual([])
		run.park()
		await settle()
		await done
		expect(routineRunFramesOf(1)).toEqual([])

		const second = await start()
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS)
		expect(routineRunFramesOf(1)).toHaveLength(1)
		second.run.resolve()
		await settle()
		await second.done
		expect(routineRunFramesOf(1)).toEqual([])
	})
})
