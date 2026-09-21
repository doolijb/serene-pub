import { describe, expect, test } from "vitest"
import {
	modelsHeadline,
	statusLine,
	type ChromeFacts
} from "./connectionViewChrome"

const facts = (over: Partial<ChromeFacts> = {}): ChromeFacts => ({
	lastTest: null,
	testing: false,
	syncing: false,
	modelsSync: { at: null, error: null },
	modelCount: 0,
	missingCount: 0,
	timeAgo: () => "3 minutes ago",
	now: 1_000_000,
	...over
})

describe("statusLine — the whether, before the how", () => {
	test("nothing has asked: not checked, and what to do", () => {
		expect(statusLine(facts())).toEqual({
			dot: "quiet",
			word: "Not checked yet",
			sentence: "Test it, or ask for its models"
		})
	})
	test("the listing is the evidence when no test ran this visit", () => {
		expect(
			statusLine(facts({ modelsSync: { at: "2026-09-18", error: null } }))
		).toEqual({
			dot: "ok",
			word: "Listed",
			sentence: "Models checked 3 minutes ago"
		})
		expect(
			statusLine(
				facts({
					modelsSync: { at: "2026-09-18", error: "401 Unauthorized" }
				})
			)
		).toEqual({
			dot: "warning",
			word: "Couldn't list models",
			sentence: "401 Unauthorized"
		})
	})
	test("a test this visit outranks the listing, either way", () => {
		expect(
			statusLine(
				facts({
					modelsSync: { at: "x", error: "stale failure" },
					lastTest: { ok: true, error: null, at: 1_000_000 - 4000 }
				})
			)
		).toEqual({
			dot: "ok",
			word: "Reachable",
			sentence: "Answered just now"
		})
		expect(
			statusLine(
				facts({
					modelsSync: { at: "x", error: null },
					lastTest: {
						ok: false,
						error: "ECONNREFUSED",
						at: 1_000_000 - 90_000
					}
				})
			)
		).toEqual({
			dot: "error",
			word: "Not reachable",
			sentence: "ECONNREFUSED"
		})
	})
	test("in flight says so, and testing outranks a sync", () => {
		expect(statusLine(facts({ syncing: true })).word).toBe("Checking")
		expect(statusLine(facts({ syncing: true, testing: true })).word).toBe(
			"Testing"
		)
	})
})

test("modelsHeadline counts and names the missing", () => {
	expect(modelsHeadline({ modelCount: 1, missingCount: 0 })).toBe("1 model")
	expect(modelsHeadline({ modelCount: 12, missingCount: 2 })).toBe(
		"12 models · 2 no longer listed"
	)
})
