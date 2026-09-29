/** A stored manifest's `reads` (R75), as a host may trust it. */
import { describe, expect, test } from "vitest"
import { declaredWidgetReads } from "./reads"

describe("declaredWidgetReads", () => {
	test("absent or unreadable is undefined — every section, the pre-R75 default", () => {
		expect(declaredWidgetReads(undefined)).toBeUndefined()
		expect(declaredWidgetReads("messages")).toBeUndefined()
	})

	test("keeps the base sections it names, once, and drops any other name", () => {
		expect(declaredWidgetReads(["settings", "messages", "settings", "session_full", "made-up", 3])).toEqual([
			"settings",
			"messages"
		])
		// Reading nothing is a declaration too.
		expect(declaredWidgetReads([])).toEqual([])
	})
})
