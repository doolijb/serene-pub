import { describe, expect, test } from "vitest"
import type { Completion } from "$lib/shared/utils/templateAssist"
import type { TemplateDiagnostic } from "$lib/shared/utils/templateDiagnostics"
import {
	completionDetail,
	completionInfo,
	toCmDiagnostics,
	toCompletionResult,
	visibleDiagnostics
} from "./templateAssistBridge"

const item = (over: Partial<Completion>): Completion => ({
	label: "name",
	insert: "name",
	kind: "variable",
	start: 2,
	end: 4,
	...over
})

describe("completions cross the seam", () => {
	test("an empty list is no result; a list keeps the app's order unfiltered", () => {
		expect(toCompletionResult([])).toBeNull()
		const r = toCompletionResult([
			item({ label: "zeta", start: 4 }),
			item({ label: "alpha", start: 2 })
		])!
		expect(r.from).toBe(2)
		expect(r.filter).toBe(false)
		expect(r.options.map((o) => o.label)).toEqual(["zeta", "alpha"])
	})

	test("kinds map to CodeMirror's icons; detail is the signature or the type", () => {
		const r = toCompletionResult([
			item({ kind: "helper", detail: "(list, n)" }),
			item({ kind: "field", type: "string", optional: true }),
			item({ kind: "block" })
		])!
		expect(r.options.map((o) => o.type)).toEqual(["function", "property", "keyword"])
		expect(r.options[0]!.detail).toBe("(list, n)")
		expect(r.options[1]!.detail).toBe("string?")
		expect(completionDetail(item({}))).toBeUndefined()
	})

	test("the info line is the description, then who supplies it", () => {
		expect(completionInfo(item({ description: "The cast.", declarer: "Build template context" }))).toBe(
			"The cast.\nFrom Build template context"
		)
		expect(completionInfo(item({}))).toBeUndefined()
	})
})

describe("diagnostics cross the seam", () => {
	const diag = (over: Partial<TemplateDiagnostic>): TemplateDiagnostic => ({
		start: 3,
		end: 9,
		severity: "error",
		message: "no such name",
		...over
	})

	test("a syntax finding is held back while the field has focus", () => {
		const all = [diag({ kind: "syntax" }), diag({ kind: "unknown-path" as any, start: 12, end: 14 })]
		expect(visibleDiagnostics(all, true)).toHaveLength(1)
		expect(visibleDiagnostics(all, false)).toHaveLength(2)
	})

	test("ranges are clamped to the document and a fix becomes an action", () => {
		const [d] = toCmDiagnostics(
			[diag({ end: 50, fix: { label: 'Use "message"', start: 3, end: 9, text: "message" } })],
			20
		)
		expect(d!.from).toBe(3)
		expect(d!.to).toBe(20)
		expect(d!.actions?.[0]?.name).toBe('Use "message"')
	})

	test("a read-only field offers no fix", () => {
		const [d] = toCmDiagnostics(
			[diag({ fix: { label: "Use x", start: 3, end: 9, text: "x" } })],
			20,
			true
		)
		expect(d!.actions).toBeUndefined()
	})
})
