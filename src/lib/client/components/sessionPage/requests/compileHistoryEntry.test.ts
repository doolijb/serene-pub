/**
 * 🚧 `compile-history-entry` (★S6-1) — the Chronicle's per-day Compile: the
 * by-date `scenes:compile` on the session's line, no window, core's widgets
 * only; its refusal heard by `requestId`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"

const handlers = new Map<string, (data: any) => void>()
const released: string[] = []

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => {
			released.push(key)
			handlers.delete(key)
		}
	}
}))

import {
	answerCompileHistoryEntry,
	compileByDate,
	type CompileHistoryEntryDeps
} from "./compileHistoryEntry"
import { guardWidgetRequests } from "./askers"
import { REPLY_TIMEOUT_MESSAGE } from "$lib/client/utils/awaitReply"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

beforeEach(() => {
	handlers.clear()
	released.length = 0
})
afterEach(() => vi.useRealTimers())

const reading = (over: Partial<Sockets.Sessions.StoryClock.Response> = {}) => ({
	sessionId: 7,
	lorebookId: 4,
	branchId: null,
	own: null,
	present: { year: 5 },
	linePresent: { year: 5 },
	calendar: null,
	isOwner: true,
	...over
})

function deps(r: ReturnType<typeof reading> = reading()) {
	const sent: unknown[] = []
	const d: CompileHistoryEntryDeps = {
		sessionId: () => 7,
		readStoryClock: async () => r,
		readHistory: async () => [{ id: 1, year: 4, branchId: null }],
		readLines: async () => [{ id: 12, forkedFromBranchId: null }],
		sceneList: () => [],
		opensScenes: () => true,
		compileByDate: async (ask) => {
			sent.push(ask)
		}
	}
	return { d, sent }
}

describe("answerCompileHistoryEntry", () => {
	test("sends the asked day on main, hour and minute dropped", async () => {
		const { d, sent } = deps()
		await answerCompileHistoryEntry(
			{ date: { year: 5, month: 3, day: null, hour: 14, minute: 30 } },
			d
		)
		expect(sent).toEqual([
			{
				lorebookId: 4,
				date: { year: 5, month: 3, day: null },
				branchId: null
			}
		])
	})

	test("a session on a branch line sends its branchId; a bare year is a year", async () => {
		const { d, sent } = deps(reading({ branchId: 12 }))
		await answerCompileHistoryEntry({ date: { year: 5 } }, d)
		expect(sent).toEqual([
			{
				lorebookId: 4,
				date: { year: 5, month: null, day: null },
				branchId: 12
			}
		])
	})

	test("{ date: null } sends null: the Undated scenes", async () => {
		const { d, sent } = deps()
		await answerCompileHistoryEntry({ date: null }, d)
		expect(sent).toEqual([{ lorebookId: 4, date: null, branchId: null }])
	})

	test("a bad date is refused in words and nothing is sent", async () => {
		const { d, sent } = deps()
		for (const params of [
			{ date: { year: "x" } },
			{ date: { year: 5, month: 1.5 } },
			{ date: { year: 5, hour: "9" } },
			{ date: "5" },
			{},
			undefined
		]) {
			await expect(answerCompileHistoryEntry(params, d)).rejects.toThrow(
				"compile-history-entry takes a date of whole parts, or null for Undated"
			)
		}
		expect(sent).toEqual([])
	})

	test("a session reading no lorebook is refused", async () => {
		const { d, sent } = deps(reading({ lorebookId: null }))
		await expect(
			answerCompileHistoryEntry({ date: null }, d)
		).rejects.toThrow("this session reads no lorebook")
		expect(sent).toEqual([])
	})

	test("only the lorebook's owner compiles", async () => {
		const { d, sent } = deps(reading({ isOwner: false }))
		await expect(
			answerCompileHistoryEntry({ date: null }, d)
		).rejects.toThrow("only the lorebook's owner compiles its history")
		expect(sent).toEqual([])
	})

	test("core only: a plugin's widget is refused in words and nothing is sent; core's is answered", async () => {
		expect(WIDGET_REQUEST_ASKERS["compile-history-entry"]).toBe("core")
		const { d, sent } = deps()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerCompileHistoryEntry(p, d)) as WidgetRequestHandler)
		await expect(
			ask(
				"compile-history-entry",
				{ date: null },
				{ widgetId: "acme:x", owner: "acme" }
			)
		).rejects.toThrow("only core's own widgets ask 'compile-history-entry'")
		expect(sent).toEqual([])
		await ask(
			"compile-history-entry",
			{ date: null },
			{ widgetId: "chronicle", owner: "core" }
		)
		expect(sent).toHaveLength(1)
	})
})

describe("compileByDate", () => {
	const ask = {
		lorebookId: 4,
		date: { year: 5, month: 3, day: 2 },
		branchId: 12
	}

	function setup(a: Parameters<typeof compileByDate>[1] = ask, ms?: number) {
		const emits: Array<{ event: string; params: any }> = []
		const order: string[] = []
		const socket = {
			emit: (event: string, params: any) => {
				order.push(`emit:${event}`)
				emits.push({ event, params })
			}
		}
		let settled: "pending" | "resolved" | { rejected: string } = "pending"
		const promise = compileByDate(socket as any, a, ms)
		promise.then(
			() => (settled = "resolved"),
			(e) => (settled = { rejected: e.message })
		)
		return { emits, order, promise, state: () => settled }
	}

	/** A running by-date compile of the ask's day and line, carrying `requestId` when given. */
	const running = (
		requestId?: string,
		over: Record<string, unknown> = {}
	) => ({
		kind: "compile_history_entry",
		status: "running",
		lorebookId: 4,
		branchId: 12,
		moment: null,
		byDate: { date: { year: 5, month: 3, day: 2 }, requestId },
		...over
	})
	const frame = (...activities: unknown[]) => ({ activities })
	const tick = () => new Promise((r) => setTimeout(r, 0))

	test("declares both interests before it emits the by-date ask", () => {
		const { emits } = setup()
		expect([...handlers.keys()].sort()).toEqual([
			"activity:update",
			"scenes:compile:error"
		])
		expect(emits).toHaveLength(1)
		expect(emits[0].event).toBe("scenes:compile")
		expect(emits[0].params).toMatchObject({
			lorebookId: 4,
			date: { year: 5, month: 3, day: 2 },
			branchId: 12,
			moment: null
		})
		expect(typeof emits[0].params.requestId).toBe("string")
		expect(emits[0].params.requestId).not.toBe("")
	})

	test("a refusal carrying its requestId rejects with the server's sentence", async () => {
		const { emits, promise } = setup()
		handlers.get("scenes:compile:error")!({
			error: "Not now.",
			requestId: emits[0].params.requestId
		})
		await expect(promise).rejects.toThrow("Not now.")
		expect(released.sort()).toEqual([
			"activity:update",
			"scenes:compile:error"
		])
	})

	test("a refusal with no sentence says it in words", async () => {
		const { emits, promise } = setup()
		handlers.get("scenes:compile:error")!({
			requestId: emits[0].params.requestId
		})
		await expect(promise).rejects.toThrow(
			"the day's scenes could not be compiled"
		)
	})

	test("another ask's refusal, or one with no id, is ignored", async () => {
		const { state } = setup()
		handlers.get("scenes:compile:error")!({
			error: "No.",
			requestId: "someone-else"
		})
		handlers.get("scenes:compile:error")!({ error: "No." })
		await tick()
		expect(state()).toBe("pending")
		expect(released).toEqual([])
	})

	test("a running compile carrying its requestId resolves it, and releases both keys", async () => {
		const { emits, promise } = setup()
		handlers.get("activity:update")!(
			frame(running(emits[0].params.requestId))
		)
		await expect(promise).resolves.toBeUndefined()
		expect(released.sort()).toEqual([
			"activity:update",
			"scenes:compile:error"
		])
	})

	test("it settles on its requestId alone, among other activities", async () => {
		const { emits, promise } = setup({
			lorebookId: 4,
			date: null,
			branchId: null
		})
		handlers.get("activity:update")!(
			frame(
				running("someone-else"),
				{ kind: "graph_build", status: "running" },
				running(emits[0].params.requestId, {
					branchId: null,
					byDate: {
						date: null,
						requestId: emits[0].params.requestId
					}
				})
			)
		)
		await expect(promise).resolves.toBeUndefined()
	})

	test("a running compile of the same day and line with another requestId, or none, does not settle it", async () => {
		const { state } = setup()
		const handler = handlers.get("activity:update")!
		handler(frame(running("someone-else")))
		handler(frame(running(undefined)))
		handler(frame(running(undefined, { byDate: { date: null } })))
		await tick()
		expect(state()).toBe("pending")
		expect(released).toEqual([])
	})

	test("a frame that is not a running by-date compile with its requestId does not settle it", async () => {
		const { emits, state } = setup()
		const id = emits[0].params.requestId
		const handler = handlers.get("activity:update")!
		for (const other of [
			running(id, { status: "review" }), // not running
			running(id, { status: "error" }),
			running(id, { byDate: undefined }), // an entry's compile
			running(id, { kind: "graph_build" }) // another kind
		]) {
			handler(frame(other))
		}
		handler(frame())
		handler({})
		handler(undefined)
		await tick()
		expect(state()).toBe("pending")
		expect(released).toEqual([])
	})

	test("no answer in time rejects with the timeout sentence and releases both keys", async () => {
		vi.useFakeTimers()
		const { promise } = setup(ask, 1000)
		const caught = promise.catch((e) => e)
		await vi.advanceTimersByTimeAsync(1000)
		expect(((await caught) as Error).message).toBe(REPLY_TIMEOUT_MESSAGE)
		expect(released.sort()).toEqual([
			"activity:update",
			"scenes:compile:error"
		])
	})

	test("after it settles, a late frame changes nothing", async () => {
		const { emits, promise } = setup()
		const error = handlers.get("scenes:compile:error")!
		const activity = handlers.get("activity:update")!
		const own = running(emits[0].params.requestId)
		activity(frame(own))
		await promise
		error({ error: "late", requestId: emits[0].params.requestId })
		activity(frame(own))
		expect(released).toHaveLength(2)
	})
})
