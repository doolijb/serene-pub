import { describe, expect, test } from "vitest"
import { showsAdvancedControls } from "./advancedControls"

describe("showsAdvancedControls", () => {
	test("true when on", () =>
		expect(showsAdvancedControls({ showAdvancedControls: true })).toBe(
			true
		))
	test("false when off", () =>
		expect(showsAdvancedControls({ showAdvancedControls: false })).toBe(
			false
		))
	test("false when the field is missing", () =>
		expect(showsAdvancedControls({})).toBe(false))
	test("false for null", () =>
		expect(showsAdvancedControls(null)).toBe(false))
	test("false for undefined", () =>
		expect(showsAdvancedControls(undefined)).toBe(false))
})
