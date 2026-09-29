/**
 * Every case here was, or would be, a false "You have unsaved changes" — or
 * the opposite failure, a real change the warning missed.
 */
import { describe, expect, test } from "vitest"
import { sameFormValue } from "./sameFormValue"

describe("sameFormValue — no false positives", () => {
	test("key order does not matter, at any depth", () => {
		expect(
			sameFormValue(
				{ a: 1, b: { c: 2, d: [1, 2] } },
				{ b: { d: [1, 2], c: 2 }, a: 1 }
			)
		).toBe(true)
	})

	test("null, undefined, empty string, empty array and a missing key are all empty", () => {
		expect(sameFormValue({ name: "" }, { name: null })).toBe(true)
		expect(sameFormValue({ name: undefined }, {})).toBe(true)
		expect(sameFormValue({ tags: [] }, { tags: null })).toBe(true)
		expect(sameFormValue({ tags: [] }, {})).toBe(true)
		expect(sameFormValue(null, undefined)).toBe(true)
	})

	test("a numeric string from an input equals the number", () => {
		expect(sameFormValue({ topK: "5" }, { topK: 5 })).toBe(true)
		expect(sameFormValue({ t: "0.70" }, { t: 0.7 })).toBe(true)
		expect(sameFormValue({ t: "-1" }, { t: -1 })).toBe(true)
		expect(sameFormValue({ t: " 3 " }, { t: 3 })).toBe(true)
	})

	test("an array named unordered is a set", () => {
		expect(
			sameFormValue(
				{ characterIds: [3, 1, 2] },
				{ characterIds: [1, 2, 3] },
				{ unordered: ["characterIds"] }
			)
		).toBe(true)
	})

	test("unordered paths reach inside arrays of objects", () => {
		expect(
			sameFormValue(
				{ cast: [{ id: 1, tags: ["b", "a"] }] },
				{ cast: [{ id: 1, tags: ["a", "b"] }] },
				{ unordered: ["cast.tags"] }
			)
		).toBe(true)
	})

	test("ignored paths are not compared", () => {
		expect(
			sameFormValue(
				{ id: 1, updatedAt: "x" },
				{ id: 1, updatedAt: "y" },
				{ ignore: ["updatedAt"] }
			)
		).toBe(true)
	})

	test("equal dates, one of them a string", () => {
		expect(
			sameFormValue(
				new Date("2026-09-27T00:00:00.000Z"),
				"2026-09-27T00:00:00.000Z"
			)
		).toBe(true)
	})

	test("NaN equals NaN", () => {
		expect(sameFormValue({ n: NaN }, { n: NaN })).toBe(true)
	})
})

describe("sameFormValue — no missed changes", () => {
	test("a changed string", () => {
		expect(sameFormValue({ name: "Wren" }, { name: "Wren " })).toBe(false)
	})

	test("zero is not empty, and not the empty string", () => {
		expect(sameFormValue({ n: 0 }, { n: null })).toBe(false)
		expect(sameFormValue({ n: "" }, { n: 0 })).toBe(false)
	})

	test("false is not empty", () => {
		expect(sameFormValue({ on: false }, { on: null })).toBe(false)
		expect(sameFormValue({ on: false }, { on: true })).toBe(false)
	})

	test("a non-numeric string is not a number", () => {
		expect(sameFormValue({ n: "5a" }, { n: 5 })).toBe(false)
		expect(sameFormValue({ n: "5" }, { n: 6 })).toBe(false)
	})

	test("arrays are ordered unless named", () => {
		expect(sameFormValue([1, 2], [2, 1])).toBe(false)
		expect(
			sameFormValue({ order: [1, 2] }, { order: [2, 1] }, { unordered: ["other"] })
		).toBe(false)
	})

	test("an unordered set still counts members, duplicates included", () => {
		const opts = { unordered: ["ids"] }
		expect(sameFormValue({ ids: [1, 1, 2] }, { ids: [1, 2, 2] }, opts)).toBe(false)
		expect(sameFormValue({ ids: [1, 2] }, { ids: [1, 2, 3] }, opts)).toBe(false)
	})

	test("a key added or removed", () => {
		expect(sameFormValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
	})

	test("a value cleared", () => {
		expect(sameFormValue({ tags: ["a"] }, { tags: [] })).toBe(false)
		expect(sameFormValue({ name: "x" }, { name: "" })).toBe(false)
	})

	test("object vs array vs primitive", () => {
		expect(sameFormValue({}, [])).toBe(false)
		expect(sameFormValue({ a: { b: 1 } }, { a: "1" })).toBe(false)
	})
})
