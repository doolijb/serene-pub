/**
 * The progress card's receipts (Dungeon Crawler walk, round 2, 2026-10-15):
 * "Answer finished" / "Respond finished" lingered above the composer after
 * the reply had landed, and a reload drew a receipt for a run long over.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import { runProgress } from "$lib/client/stores/runProgress.svelte"
import RunProgressCard from "./RunProgressCard.svelte"
import { _forgetFiredActions, rememberFiredAction } from "./actionRetry"

const SESSION_ID = 7
let app: ReturnType<typeof mount> | null = null
let newest = $state(10)
const emitted: Array<[string, unknown]> = []

beforeEach(() => {
	newest = 10
	runProgress.clearAll()
	emitted.length = 0
	_forgetFiredActions()
	setSocket({
		connected: true,
		id: "t",
		on() {},
		off() {},
		emit(event: string, params: unknown) {
			emitted.push([event, params])
		}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	runProgress.clearAll()
	document.body.innerHTML = ""
})

function place() {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(RunProgressCard, {
		target,
		props: {
			sessionId: SESSION_ID,
			channel: "main",
			get newestRowId() {
				return newest
			}
		}
	})
	flushSync()
}
const text = () => document.body.textContent ?? ""

describe("a finished run's card", () => {
	test("a run that ended ok goes with its row — no 'finished' card", () => {
		place()
		runProgress.started({ runId: "r1", sessionId: SESSION_ID, label: "respond" } as never)
		flushSync()
		expect(text()).toMatch(/respond/i)
		newest = 11 // the reply row lands before the terminal frame
		runProgress.apply({ runId: "r1", sessionId: SESSION_ID, done: true, outcome: "ok" } as never)
		flushSync()
		expect(text()).not.toMatch(/respond/i)
	})

	test("a run that ended ok with no row leaves no card either", () => {
		place()
		runProgress.started({ runId: "r2", sessionId: SESSION_ID, label: "rest" } as never)
		flushSync()
		runProgress.apply({ runId: "r2", sessionId: SESSION_ID, done: true, outcome: "ok" } as never)
		flushSync()
		expect(text()).not.toMatch(/rest/i)
	})

	test("a failure watched here stands until the next row lands", () => {
		place()
		runProgress.started({ runId: "r3", sessionId: SESSION_ID, label: "answer" } as never)
		flushSync()
		runProgress.apply({
			runId: "r3",
			sessionId: SESSION_ID,
			done: true,
			outcome: "err",
			error: "boom"
		} as never)
		flushSync()
		expect(text()).toMatch(/answer/i)
		newest = 12
		flushSync()
		expect(text()).not.toMatch(/answer/i)
	})

	test("first paint never draws a run that ended before the card did", () => {
		runProgress.started({ runId: "r4", sessionId: SESSION_ID, label: "reveal" } as never)
		runProgress.apply({
			runId: "r4",
			sessionId: SESSION_ID,
			done: true,
			outcome: "err",
			error: "boom"
		} as never)
		place()
		expect(text()).not.toMatch(/reveal/i)
	})
})

describe("🚧 a halted action run offers Retry (2026-10-16)", () => {
	const press = { sessionId: SESSION_ID, action: "core:spec/dc-answer#answer", messageId: 4, payload: { choice: "Thief" } }
	const halt = (runId: string) => {
		runProgress.started({ runId, sessionId: SESSION_ID, label: "answer" } as never)
		flushSync()
		runProgress.apply({ runId, sessionId: SESSION_ID, done: true, outcome: "halt", haltNodeKey: "ask" } as never)
		flushSync()
	}
	const retryButton = () =>
		[...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry")) as HTMLButtonElement | undefined

	test("Retry fires the same action with the same params under a new run id", () => {
		place()
		rememberFiredAction({ ...press, runId: "run-a" })
		halt("run-a")
		expect(text()).toMatch(/answer/i)
		const button = retryButton()
		expect(button).toBeDefined()
		button!.click()
		flushSync()
		const fires = emitted.filter(([e]) => e === "sessions:fireAction")
		expect(fires).toHaveLength(1)
		const sent = fires[0][1] as Record<string, unknown>
		expect(sent).toMatchObject(press)
		expect(sent.runId).toBeTypeOf("string")
		expect(sent.runId).not.toBe("run-a")
	})

	test("no Retry for a run this page did not fire (a reply, another tab)", () => {
		place()
		halt("run-b")
		expect(text()).toMatch(/answer/i)
		expect(retryButton()).toBeUndefined()
	})
})
