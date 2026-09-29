import { describe, it, expect } from "vitest"
import { hookOutcome } from "./hookOutcome"

const row = (over: Partial<Parameters<typeof hookOutcome>[0]>) => ({
	hookName: "startup",
	mode: "lifecycle",
	ok: false,
	outcome: "missing",
	reason: "no such hook",
	...over
})

describe("hookOutcome", () => {
	it("a lifecycle moment the extension never declared is quiet, not a failure", () => {
		const o = hookOutcome(row({}))
		expect(o.tone).toBe("quiet")
		expect(o.text).toBe(
			"Not declared. This extension has no startup callback, so nothing ran."
		)
		expect(o.text).not.toMatch(/missing|no such hook/)
	})

	it("a missing non-lifecycle hook is still an error", () => {
		const o = hookOutcome(row({ mode: "concurrent", hookName: "render" }))
		expect(o.tone).toBe("error")
		expect(o.text).toBe("missing: no such hook")
	})

	it("a lifecycle callback that threw is an error", () => {
		expect(
			hookOutcome(row({ outcome: "error", reason: "boom" }))
		).toEqual({ tone: "error", text: "error: boom" })
	})

	it("success reads as success", () => {
		expect(
			hookOutcome(row({ ok: true, outcome: "ok", reason: null }))
		).toEqual({ tone: "success", text: "ok" })
	})
})
