/** A text form's answer as words — "Answered · Ann" (round 2, 2026-10-15). */
import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))

import { formAnswerText } from "./blocks"

describe("formAnswerText", () => {
	test("the scalar values, in field order", () => {
		expect(formAnswerText({ name: "Ann" })).toBe("Ann")
		expect(formAnswerText({ name: " Ann ", age: 30, nested: { x: 1 } })).toBe("Ann, 30")
	})
	test("nothing to say is null", () => {
		expect(formAnswerText({})).toBeNull()
		expect(formAnswerText({ name: "  " })).toBeNull()
		expect(formAnswerText(null)).toBeNull()
	})
	test("capped", () => {
		expect(formAnswerText({ t: "x".repeat(200) })!.length).toBe(120)
	})
})
