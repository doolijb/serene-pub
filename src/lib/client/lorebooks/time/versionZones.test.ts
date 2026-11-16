import { describe, expect, test } from "vitest"
import { sameEverywhereQuestion } from "./versionZones"

describe("sameEverywhereQuestion", () => {
	test("singular", () => {
		expect(sameEverywhereQuestion(1)).toBe(
			"Make this the same in every version? 1 version on this line will read the value shown here."
		)
	})
	test("plural", () => {
		expect(sameEverywhereQuestion(3)).toContain("3 versions on this line")
	})
})
