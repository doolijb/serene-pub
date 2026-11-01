/**
 * 🚧 M2a a6, the client half: a frame's `invoke` of a session action is
 * answered with its run's outcome when the run ENDS — `{ runId }`, or
 * `{ runId, halted: true, reason }` — and not `{}` at once; and the end of
 * any press's run (`sessions:runEnded` for the page's session) reaches the
 * frame as the widget event `run:ended`.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => socket }))

import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import type { PressHearing } from "$lib/shared/widgets/invokeAction"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { hearRunEnded } from "$lib/client/components/sessionPage/runEnded"
import { createPressAnswers } from "$lib/client/components/sessionPage/pressAnswers"

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()
const socket = {
	connected: true,
	on(event: string, fn: Listener) {
		listeners.set(event, [...(listeners.get(event) ?? []), fn])
	},
	off(event: string, fn: Listener) {
		listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn))
	},
	emit() {}
}
const push = (event: string, payload: unknown) => {
	for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
}

beforeEach(() => {
	listeners.clear()
	_resetInterestForTests()
	setInterestUser({ id: 1, isAdmin: false })
})

const settle = () => new Promise((r) => setTimeout(r, 20))

async function open(inputs: () => WireInputs) {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const app = mount(Fixture, { target, props: { inputs, onWire: (w: WidgetWire) => (wire = w) } })
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage({ t: "ready" })
	await settle()
	flushSync()
	return {
		got,
		send: async (m: unknown) => {
			channel.port2.postMessage(m)
			await settle()
		},
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

const travel = {
	key: "travel",
	specSlug: "acme:spec/travel",
	name: "Travel",
	venue: "session",
	origin: "plugin",
	canAct: true,
	enabled: true
}

describe("a session action's invoke is answered when its run ends", () => {
	test("ok → { runId }; halted → { runId, halted, reason }; a refusal → ok: false with the sentence; nothing at once", async () => {
		// The page's audited fire, as pressRouting does it: names the run now, answers at the run's end.
		const waiting: PressHearing[] = []
		let n = 0
		const fire = (_a: unknown, _args: unknown, hearing?: PressHearing) => {
			if (!hearing) return
			hearing.fired(`run-${++n}`)
			waiting.push(hearing)
		}
		const w = await open(() => ({
			stateKey: "k",
			session: { id: 7, name: null },
			messages: [],
			owner: "acme",
			actions: { session: { primary: [travel], overflow: [] } } as never,
			actionDispatch: { core: {}, fire }
		}))

		await w.send({ t: "invoke", key: "acme:spec/travel#travel", payload: { to: "cafe" }, requestId: "r1" })
		expect(w.got.some((m) => m.requestId === "r1")).toBe(false)   // not `{}` at once: the run has not ended
		waiting[0].answered({ ok: true, runId: "run-1" })
		await settle()
		expect(w.got.find((m) => m.requestId === "r1")).toEqual({ t: "response", requestId: "r1", ok: true, result: { runId: "run-1" } })

		await w.send({ t: "invoke", key: "acme:spec/travel#travel", requestId: "r2" })
		waiting[1].answered({ ok: true, runId: "run-2", halted: true, reason: "The ferry is not running tonight." })
		await settle()
		expect(w.got.find((m) => m.requestId === "r2")).toEqual({
			t: "response",
			requestId: "r2",
			ok: true,
			result: { runId: "run-2", halted: true, reason: "The ferry is not running tonight." }
		})

		await w.send({ t: "invoke", key: "acme:spec/travel#travel", requestId: "r3" })
		waiting[2].answered({ ok: false, error: "Wait for the reply to finish." })
		await settle()
		expect(w.got.find((m) => m.requestId === "r3")).toMatchObject({ ok: false, error: "Wait for the reply to finish." })
		w.close()
	})

	test("a press the host does not fire now (it asks first) is answered {} at once, as before", async () => {
		const w = await open(() => ({
			stateKey: "k",
			session: { id: 7, name: null },
			messages: [],
			owner: "acme",
			actions: { session: { primary: [travel], overflow: [] } } as never,
			actionDispatch: { core: {}, fire: () => {} }
		}))
		await w.send({ t: "invoke", key: "acme:spec/travel#travel", requestId: "r4" })
		expect(w.got.find((m) => m.requestId === "r4")).toEqual({ t: "response", requestId: "r4", ok: true })
		w.close()
	})
})

describe("the page's matcher (pressAnswers): every answer finds its own press", () => {
	// The page's fire as pressRouting runs it: names the run, and the answers come back as `sessions:fireAction`.
	async function openWithMatcher() {
		const answers = createPressAnswers()
		const asked: string[] = []
		let n = 0
		const fire = (_a: unknown, _args: unknown, hearing?: PressHearing) => {
			const runId = `run-${++n}`
			asked.push(runId)
			if (hearing) answers.wait(runId, "acme:spec/travel#travel", hearing)
		}
		const w = await open(() => ({
			stateKey: "k",
			session: { id: 7, name: null },
			messages: [],
			owner: "acme",
			actions: { session: { primary: [travel], overflow: [] } } as never,
			actionDispatch: { core: {}, fire }
		}))
		return { w, answers, asked }
	}
	const answer = (fields: Partial<Sockets.Sessions.FireAction.Response>): Sockets.Sessions.FireAction.Response =>
		({ sessionId: 7, action: "acme:spec/travel#travel", ...fields }) as Sockets.Sessions.FireAction.Response

	test("two presses of one action in flight get their own answers, by askedRunId — a refusal too", async () => {
		const { w, answers, asked } = await openWithMatcher()
		await w.send({ t: "invoke", key: "acme:spec/travel#travel", requestId: "a" })
		await w.send({ t: "invoke", key: "acme:spec/travel#travel", requestId: "b" })
		// the SECOND press answers first: refused before any run (no runId), but its own run id rides as askedRunId
		answers.settle(answer({ error: "Wait for the reply to finish.", askedRunId: asked[1] }))
		answers.settle(answer({ success: true, runId: asked[0], askedRunId: asked[0] }))
		await settle()
		expect(w.got.find((m) => m.requestId === "b")).toMatchObject({ ok: false, error: "Wait for the reply to finish." })
		expect(w.got.find((m) => m.requestId === "a")).toEqual({ t: "response", requestId: "a", ok: true, result: { runId: asked[0] } })
		w.close()
	})

	test("the bare park ack settles nothing; the real answer (parked: true) does", async () => {
		const { w, answers, asked } = await openWithMatcher()
		await w.send({ t: "invoke", key: "acme:spec/travel#travel", requestId: "p" })
		answers.settle(answer({ parked: true, askedRunId: asked[0] }))   // its own run waits at a review gate
		await settle()
		expect(w.got.some((m) => m.requestId === "p")).toBe(false)
		answers.settle(answer({ success: true, runId: asked[0], askedRunId: asked[0], parked: true }))
		await settle()
		expect(w.got.find((m) => m.requestId === "p")).toEqual({ t: "response", requestId: "p", ok: true, result: { runId: asked[0], parked: true } })
		w.close()
	})
})

describe("the end of any press's run reaches the frame as run:ended", () => {
	test("this session's sessions:runEnded is the frame's event; another session's is not", async () => {
		const manager = new SurfaceManager()
		const release = hearRunEnded(7, manager)
		const w = await open(() => ({ stateKey: "k", session: { id: 7, name: null }, messages: [], owner: "acme", source: manager }))
		push("sessions:runEnded", { sessionId: 7, runId: "run-9", outcome: "halt", reason: "Nobody is home." })
		push("sessions:runEnded", { sessionId: 8, runId: "run-x", outcome: "ok" })
		await settle()
		const events = w.got.filter((m) => m.t === "event").map((m) => m.event)
		expect(events).toEqual([{ kind: "run:ended", runId: "run-9", outcome: "halt", reason: "Nobody is home." }])
		release()
		w.close()
	})
})
