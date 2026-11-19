/**
 * 🚧 A routine run says it is running: one `sessions:runStatus` start frame
 * at once, one clearing frame at
 * its end (a run that parks keeps showing until then); the session list's row
 * status is never touched. Every frame carries the run's facts.
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
import { routineRunStatus, runRoutineFiring } from "./run"
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
	it("a run sends its start frame at once and, at its end, one clearing frame", async () => {
		const { done, run } = await start()
		await vi.advanceTimersByTimeAsync(0)
		expect(ctl.frames).toEqual([
			{
				sessionId: 1,
				runId: expect.any(String),
				status: routineRunStatus(),
				kind: "routine",
				routine: { name: "Recap" },
				name: "Recap",
				since: expect.any(Number),
				mayStop: true
			}
		])
		expect(routineRunStatus()).toEqual({ i18n: { en: "working" } })
		run.resolve()
		await settle()
		await done
		expect(ctl.frames).toHaveLength(2)
		expect(ctl.frames[1]).toMatchObject({ sessionId: 1, status: null, kind: "routine", routine: { name: "Recap" } })
		expect(ctl.frames[1].runId).toBe(ctl.frames[0].runId)
	})

	it("a run that ends at once sends its start frame and its end frame", async () => {
		const { done, run } = await start()
		run.resolve()
		await settle()
		await done
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS * 2)
		expect(ctl.frames.map((f) => f.status === null)).toEqual([false, true])
	})

	it("with nothing to send on, a run is never marked as shown", async () => {
		// A run marked shown would reach a page's first load, and no end frame
		// could ever clear it there.
		const { showRoutineRun } = await import("./run")
		const fact: any = {}
		const shown = showRoutineRun({ db: {} as never, sessionId: 1, runId: "no-io", name: "Recap", fact })
		await vi.advanceTimersByTimeAsync(QUEUE_STATUS_DELAY_MS * 2)
		expect(fact.shownAs).toBeUndefined()
		shown.clear()
		expect(fact.shownAs).toBeUndefined()
	})

	it("a run that parks keeps showing; its end sends the one clearing frame", async () => {
		const { done, run } = await start()
		await vi.advanceTimersByTimeAsync(0)
		expect(ctl.frames).toHaveLength(1)
		run.park()
		await settle()
		await done
		expect(ctl.frames).toHaveLength(1)
		run.resolve()
		await settle()
		expect(ctl.frames).toHaveLength(2)
		expect(ctl.frames[1]).toMatchObject({ status: null, routine: { name: "Recap" }, name: "Recap" })
	})

	it("the registry handle carries the routine's name and the line that caused it", async () => {
		const called = new Promise<void>((r) => (ctl.onCall = r))
		const done = runRoutineFiring({ ...firing(), cause: { moment: "turn-ended", at: 0, messageId: 41 } } as RoutineFiringEntry)
		await called
		const handle = runRegistry.active().find((h) => h.kind === "routine")
		expect(handle).toMatchObject({ name: "Recap", readsMessageId: 41 })
		ctl.runs.at(-1)!.resolve()
		await settle()
		await done
	})

	it("a failed run clears", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined)
		const { done, run } = await start()
		await vi.advanceTimersByTimeAsync(0)
		run.reject(new Error("boom"))
		await settle()
		await done
		expect(ctl.frames.map((f) => f.status === null)).toEqual([false, true])
	})

	it("never sets the registry status: the session list's row status has no entry", async () => {
		const { run } = await start()
		await vi.advanceTimersByTimeAsync(0)
		expect(ctl.frames).toHaveLength(1)
		expect(runRegistry.statusesBySession().has(1)).toBe(false)
		run.resolve()
		await settle()
	})
})
