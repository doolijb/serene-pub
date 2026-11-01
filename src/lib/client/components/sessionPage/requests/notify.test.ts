import { beforeEach, describe, expect, test, vi } from "vitest"

const toasts = vi.hoisted(() => ({
	info: vi.fn(),
	success: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
}))
const raiseLocal = vi.hoisted(() => vi.fn())

vi.mock("$lib/client/utils/toaster", () => ({ toaster: toasts }))
vi.mock("$lib/client/notifications/notifications.svelte", () => ({
	notifications: { raiseLocal }
}))
vi.mock("$lib/client/i18n/state.svelte", () => ({
	statusText: (s: { i18n: any }) =>
		typeof s.i18n === "string" ? s.i18n : (s.i18n?.en ?? "")
}))

import { NOTIFY_RATE_MS, answerNotify } from "./notify"

let clock = 1_000_000
const now = () => clock
let n = 0
const widget = () => ({ owner: "core", widgetId: `w${++n}` })

beforeEach(() => {
	vi.clearAllMocks()
	clock += 10 * NOTIFY_RATE_MS
})

describe("answerNotify", () => {
	test.each(["info", "success", "warning"] as const)("%s reaches the toaster", (kind) => {
		const from = widget()
		answerNotify({ kind, text: "Saved" }, from, 1, now)
		expect(toasts[kind]).toHaveBeenCalledTimes(1)
		expect(toasts[kind].mock.calls[0][0]).toMatchObject({
			title: "Saved",
			id: `notify:widget:core:${from.widgetId}`
		})
	})

	test("rate: second within 2 s dropped, other widget not, after 2 s passes", () => {
		const a = widget()
		const b = widget()
		answerNotify({ kind: "info", text: "one" }, a, 1, now)
		clock += 500
		answerNotify({ kind: "info", text: "two" }, a, 1, now)
		expect(toasts.info).toHaveBeenCalledTimes(1)
		answerNotify({ kind: "info", text: "other" }, b, 1, now)
		expect(toasts.info).toHaveBeenCalledTimes(2)
		clock += NOTIFY_RATE_MS
		answerNotify({ kind: "info", text: "three" }, a, 1, now)
		expect(toasts.info).toHaveBeenCalledTimes(3)
	})

	test("sticky raises a local row", () => {
		const from = widget()
		answerNotify({ kind: "warning", text: "Careful", sticky: true }, from, 7, now)
		expect(raiseLocal).toHaveBeenCalledWith(
			expect.objectContaining({
				regarding: `session:7/widget:core:${from.widgetId}`,
				level: "attention",
				href: "/sessions/7"
			})
		)
		answerNotify({ kind: "info", text: "Fine", sticky: true }, widget(), 7, now)
		expect(raiseLocal.mock.calls[1][0].level).toBe("info")
	})

	test("not sticky raises no local row", () => {
		answerNotify({ kind: "info", text: "x" }, widget(), 7, now)
		expect(raiseLocal).not.toHaveBeenCalled()
	})

	test("refusals", () => {
		expect(() =>
			answerNotify({ kind: "error" as any, text: "x" }, widget(), 1, now)
		).toThrow("A notice is info, success or warning.")
		expect(() =>
			answerNotify({ kind: "info", text: "  " }, widget(), 1, now)
		).toThrow("A notice needs some text.")
	})

	test("action still toasts", () => {
		answerNotify(
			{ kind: "info", text: "x", action: { key: "k", label: "Go" } },
			widget(),
			1,
			now
		)
		expect(toasts.info).toHaveBeenCalledTimes(1)
	})
})
