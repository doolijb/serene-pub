import { describe, expect, test } from "vitest"
import {
	modelsHeadline,
	statusLine,
	activeApiTab,
	apiConnectionTabs,
	showsTabStrip,
	type ChromeFacts
} from "./connectionViewChrome"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

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

describe("an API connection's tabs", () => {
	test("a listing API gets Models then Settings", () => {
		expect(apiConnectionTabs(CONNECTION_TYPE.ANTHROPIC).map((t) => t.value)).toEqual([
			"models",
			"settings"
		])
	})

	test("an API that names only its loaded model gets Settings alone", () => {
		expect(apiConnectionTabs(CONNECTION_TYPE.LLAMACPP).map((t) => t.value)).toEqual([
			"settings"
		])
	})

	test("one tab draws no strip; two do", () => {
		expect(showsTabStrip(apiConnectionTabs(CONNECTION_TYPE.LLAMACPP))).toBe(false)
		expect(showsTabStrip(apiConnectionTabs(CONNECTION_TYPE.OPENAI))).toBe(true)
	})

	test("a picked tab is kept while it exists", () => {
		const tabs = apiConnectionTabs(CONNECTION_TYPE.OPENAI)
		expect(activeApiTab(tabs, "settings", false)).toBe("settings")
	})

	test("an unfinished connection opens on Settings, where the key goes", () => {
		const tabs = apiConnectionTabs(CONNECTION_TYPE.OPENAI)
		expect(activeApiTab(tabs, null, true)).toBe("settings")
		// A finished one opens on its models.
		expect(activeApiTab(tabs, null, false)).toBe("models")
	})

	test("a remembered tab that no longer exists falls back, never to nothing", () => {
		const tabs = apiConnectionTabs(CONNECTION_TYPE.LLAMACPP)
		expect(activeApiTab(tabs, "models", false)).toBe("settings")
	})
})
