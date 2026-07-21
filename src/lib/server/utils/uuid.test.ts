import { describe, expect, test } from "vitest"
import { isValidUuid } from "./uuid"

describe("isValidUuid", () => {
	test("accepts a well-formed uuid", () => {
		expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
	})

	test("accepts uppercase hex digits", () => {
		expect(isValidUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true)
	})

	test("rejects wrong-shaped strings", () => {
		expect(isValidUuid("not-a-uuid")).toBe(false)
		expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false)
		expect(isValidUuid("550e8400-e29b-41d4-a716-44665544000")).toBe(false) // one char short
		expect(isValidUuid("550e8400-e29b-41d4-a716-4466554400000")).toBe(false) // one char long
	})

	test("rejects non-string types", () => {
		expect(isValidUuid(undefined)).toBe(false)
		expect(isValidUuid(null)).toBe(false)
		expect(isValidUuid(12345)).toBe(false)
		expect(isValidUuid({})).toBe(false)
		expect(isValidUuid(["550e8400-e29b-41d4-a716-446655440000"])).toBe(false)
	})

	test("rejects an empty string", () => {
		expect(isValidUuid("")).toBe(false)
	})
})
