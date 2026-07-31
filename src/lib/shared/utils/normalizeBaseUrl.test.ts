import { describe, expect, test } from "vitest"
import { normalizeBaseUrl } from "./normalizeBaseUrl"

describe("normalizeBaseUrl", () => {
	test("strips a single trailing slash", () => {
		expect(normalizeBaseUrl("http://localhost:5001/")).toBe(
			"http://localhost:5001"
		)
	})

	test("strips multiple trailing slashes", () => {
		expect(normalizeBaseUrl("http://localhost:5001///")).toBe(
			"http://localhost:5001"
		)
	})

	test("leaves a URL with no trailing slash unchanged", () => {
		expect(normalizeBaseUrl("http://localhost:5001")).toBe(
			"http://localhost:5001"
		)
	})

	test("does not touch slashes that are part of the path", () => {
		expect(normalizeBaseUrl("http://localhost:5001/v1/")).toBe(
			"http://localhost:5001/v1"
		)
	})

	test("trims surrounding whitespace", () => {
		expect(normalizeBaseUrl("  http://localhost:5001/  ")).toBe(
			"http://localhost:5001"
		)
	})

	test("returns empty string for null, undefined, and empty input", () => {
		expect(normalizeBaseUrl(null)).toBe("")
		expect(normalizeBaseUrl(undefined)).toBe("")
		expect(normalizeBaseUrl("")).toBe("")
	})

	test("supports the `normalizeBaseUrl(x) || fallback` pattern", () => {
		expect(normalizeBaseUrl(undefined) || "http://fallback").toBe(
			"http://fallback"
		)
		expect(normalizeBaseUrl("http://real/") || "http://fallback").toBe(
			"http://real"
		)
	})
})
